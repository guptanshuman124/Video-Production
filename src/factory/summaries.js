// Summary videos in the factory: a queue, workers, validation and library of
// their own, next to the lecture videos (central.js) but not mixed with them.
//
//   summaries          one row per chapter summary queued (module_id), its state and stages
//   summary_events     its activity log
//   summary_videos     the finished videos, in their own tree — LIBRARY_DIR/<CBSE Summaries>/… and
//                      the OneDrive root SHAREPOINT_SUMMARY_ROOT ("CBSE Summaries") — with the
//                      lectures' folders: Class N/Subject/[Book/]Chapter K - Title/…
//   settings.summary_queue   running | paused (one switch for all summaries)
//
// Workers claim from one endpoint; the central hands out a lecture or a
// summary, whichever is first by priority, then by the time it was queued.
// A summary runs in the worker as src/factory/summary-job.js (src/summary/run.js).

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { json, parse, getSetting, setSetting } from './db.js';
import { summaryInputFor } from './catalog.js';

const WEIGHTS = { prepare: 2, outline: 6, plan: 6, write: 8, narrate: 8, review: 8, assemble: 1, voice: 12, build: 3, render: 42, qa: 4 };
const ORDER = Object.keys(WEIGHTS);
const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
const progressAt = (stage, frac = 0) => {
  const i = ORDER.indexOf(stage);
  if (i < 0) return 0;
  const before = ORDER.slice(0, i).reduce((a, s) => a + WEIGHTS[s], 0);
  return Math.min(99, Math.round(((before + WEIGHTS[stage] * frac) / TOTAL) * 1000) / 10);
};
const RANK = { fail: 3, running: 2, warn: 1, pass: 0 };
const MAX_CRASH_RETRIES = 2;
const WORKER_LOST_S = 180;    // summaries render for a long time; heartbeats keep coming meanwhile
const COLS = 'module_id, status, stage, progress, from_stage, priority, attempts, worker, error_code, error_stage, error_message, cost_usd, queued_at, started_at, finished_at, stages';
const VIDEO_COLS = 'module_id, course_id, class_no, path, bytes, duration_s, width, height, slides, parts, cost_usd, created_at, storage, remote_url, remote_error, uploaded_at, yt_status, yt_video_id, yt_playlist_id, yt_error, yt_warning, yt_uploaded_at, yt_replaces';

// ytProgressOf(id): the central's YouTube upload progress for this summary video (central.js publishes them).
export function summaryService({ getDb, broadcast, route, getCatalog, library, keepLocal, onedrive, validateVideo, streamFile, log, ytProgressOf = () => null, ytReplaced = async () => {} }) {
  const db = () => getDb();
  const now = () => new Date();
  const SUMMARY_ROOT = onedrive.SUMMARY_ROOT;
  const ROOT = path.join(library, SUMMARY_ROOT);
  const compact = (r) => r && ({
    module_id: r.module_id, status: r.status, stage: r.stage, progress: r.progress, from_stage: r.from_stage, priority: r.priority,
    attempts: r.attempts, worker: r.worker, error_code: r.error_code, error_stage: r.error_stage,
    error_message: r.error_message ? String(r.error_message).slice(0, 400) : null, cost_usd: r.cost_usd,
    queued_at: r.queued_at, started_at: r.started_at, finished_at: r.finished_at, stages: parse(r.stages) || {},
  });
  const row = async (id) => { const [[r]] = await db().query(`SELECT ${COLS} FROM summaries WHERE module_id = ?`, [id]); return r || null; };
  const push = async (id) => { const r = await row(id); broadcast('summary', r ? compact(r) : { module_id: id, status: null }); };
  const event = async (id, level, stage, message) => {
    await db().query('INSERT INTO summary_events (module_id, at, level, stage, message) VALUES (?, ?, ?, ?, ?)', [id, now(), level, stage || null, String(message).slice(0, 4000)]);
    broadcast('summary-log', { module_id: id, at: Date.now(), level, stage, message: String(message).slice(0, 600) });
  };
  const withProgress = (v) => {
    let out = uploading.has(v.module_id) ? { ...v, upload: uploading.get(v.module_id) } : v;
    if (ytProgressOf(v.module_id)) out = { ...out, yt: ytProgressOf(v.module_id) };
    return out;
  };
  const videoRow = async (id) => {
    const [[v]] = await db().query(`SELECT ${VIDEO_COLS} FROM summary_videos WHERE module_id = ?`, [id]);
    return v ? withProgress(v) : null;
  };
  const queueState = async () => (await getSetting(db(), 'summary_queue', 'running')) || 'running';

  // ---- queue ---------------------------------------------------------------------------------

  // Chapters matching a scope: { class_no, subject, course_id, module_ids }.
  const chaptersIn = (scope) => {
    const ids = scope.module_ids ? new Set(scope.module_ids.map(Number)) : null;
    return [...getCatalog().chapters.values()].filter((c) =>
      (scope.class_no == null || c.class_no === Number(scope.class_no))
      && (scope.subject == null || c.subject === scope.subject)
      && (scope.course_id == null || c.course_id === Number(scope.course_id))
      && (!ids || ids.has(c.module_id)));
  };

  async function enqueue(scope, { redo = false } = {}) {
    const wanted = chaptersIn(scope);
    const [rows] = await db().query('SELECT module_id, status FROM summaries');
    const state = new Map(rows.map((r) => [r.module_id, r.status]));
    const [vids] = await db().query('SELECT module_id FROM summary_videos');
    const done = new Set(vids.map((v) => v.module_id));
    const skipped = { unsupported: 0, done: 0, active: 0, failed: 0 };
    const add = [];
    for (const c of wanted) {
      const s = state.get(c.module_id);
      if (!c.supported) { skipped.unsupported++; continue; }
      if (['queued', 'running', 'rendering', 'validating', 'cancelling'].includes(s)) { skipped.active++; continue; }
      if (!redo && (done.has(c.module_id) || s === 'done')) { skipped.done++; continue; }
      if (!redo && s === 'failed' && !scope.module_ids) { skipped.failed++; continue; }
      add.push(c);
    }
    const t = now();
    for (const c of add) {
      await db().query(`INSERT INTO summaries (module_id, course_id, class_no, subject, book, chapter_no, chapter_title, lecture_count, seq, status, stage, progress, from_stage, priority, attempts, queued_at, stages, issues)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, 0, ?, 0, 0, ?, '{}', NULL)
        ON DUPLICATE KEY UPDATE status='queued', stage=NULL, progress=0, from_stage=VALUES(from_stage), priority=0, attempts=0, worker=NULL,
          error_code=NULL, error_stage=NULL, error_message=NULL, stages='{}', issues=NULL, cost_usd=0, cost_detail=NULL, queued_at=VALUES(queued_at), started_at=NULL, finished_at=NULL,
          course_id=VALUES(course_id), class_no=VALUES(class_no), subject=VALUES(subject), book=VALUES(book), chapter_no=VALUES(chapter_no),
          chapter_title=VALUES(chapter_title), lecture_count=VALUES(lecture_count), seq=VALUES(seq)`,
      [c.module_id, c.course_id, c.class_no, c.subject, c.book, c.chapter_no, c.chapter_title, c.lecture_count, c.seq, redo ? 'prepare' : null, t]);
    }
    if (add.length) { log(`queued ${add.length} summary video(s)`, JSON.stringify(scope)); broadcast('refresh', { what: 'summaries' }); }
    return { queued: add.length, skipped };
  }

  const topPriority = async () => { const [[m]] = await db().query("SELECT COALESCE(MAX(priority), 0) AS p FROM summaries WHERE status = 'queued'"); return m.p + 1; };

  // The first queued summary (when the summary queue runs), for the central's claim.
  async function next() {
    if ((await queueState()) !== 'running') return null;
    const [[s]] = await db().query("SELECT module_id, priority, queued_at FROM summaries WHERE status = 'queued' ORDER BY priority DESC, queued_at ASC, seq ASC LIMIT 1");
    return s || null;
  }

  async function claim(id, worker) {
    const chapter = getCatalog().chapters.get(id);
    if (!chapter) {
      await db().query("UPDATE summaries SET status='failed', error_code='NOT_IN_SOURCE', error_message='this chapter is no longer in the course tables', finished_at=? WHERE module_id=?", [now(), id]);
      await push(id);
      return null;
    }
    let input;
    try { input = await summaryInputFor(chapter); } catch (e) {
      await db().query("UPDATE summaries SET status='failed', error_code='SOURCE_ERROR', error_message=?, finished_at=? WHERE module_id=?", [e.message, now(), id]);
      await event(id, 'error', 'prepare', e.message);
      await push(id);
      return null;
    }
    const [[r]] = await db().query('SELECT from_stage, attempts FROM summaries WHERE module_id = ?', [id]);
    await db().query("UPDATE summaries SET status='running', worker=?, attempts=attempts+1, from_stage=NULL, started_at=?, heartbeat_at=?, finished_at=NULL, error_code=NULL, error_stage=NULL, error_message=NULL WHERE module_id=?",
      [worker, now(), now(), id]);
    await db().query("UPDATE workers SET status='busy', lecture_id=NULL, summary_id=? WHERE name=?", [id, worker]);
    await event(id, 'info', null, `assigned to ${worker}${r.from_stage ? ` (from ${r.from_stage})` : ''} · attempt ${r.attempts + 1}`);
    await push(id);
    return {
      kind: 'summary', module_id: id, input, from_stage: r.from_stage,
      label: `Class ${chapter.class_no} ${chapter.subject} · Ch ${chapter.chapter_no} summary: ${chapter.chapter_title}`,
    };
  }

  // ---- worker progress --------------------------------------------------------------------------

  async function applyEvents(id, events) {
    const r = await row(id);
    if (!r || r.status !== 'running') return;
    const stages = parse(r.stages) || {};
    let { stage, progress } = r;
    const fold = (st) => {   // a stage's overall state from its parts
      const parts = Object.values(st.parts || {});
      if (!parts.length) return st;
      const worst = parts.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'pass');
      return { ...st, status: worst, done: parts.filter((p) => p !== 'running').length };
    };
    for (const e of events) {
      if (e.type === 'stage') {
        stage = e.stage;
        progress = Math.max(progress, progressAt(e.stage));
        const st = stages[e.stage] || {};
        stages[e.stage] = e.part ? fold({ ...st, parts: { ...(st.parts || {}), [e.part]: 'running' }, started: st.started || e.at }) : { ...st, status: 'running', started: e.at };
        if (!e.part) await event(id, 'info', e.stage, `${e.stage} started`);
      } else if (e.type === 'gate') {
        const errors = (e.issues || []).filter((i) => i.severity === 'error');
        const warnings = (e.issues || []).filter((i) => i.severity === 'warning');
        const st = stages[e.stage] || {};
        const base = { ...st, gate: e.gate, finished: e.at, attempts: e.extra?.attempts };
        const issues = [...(st.part_issues || []).filter((i) => i.part !== e.part), ...(e.issues || []).slice(0, 20).map((i) => ({ ...i, part: e.part || null }))].slice(-40);
        stages[e.stage] = e.part
          ? fold({ ...base, parts: { ...(st.parts || {}), [e.part]: e.status }, errors: (st.errors || 0) + errors.length, warnings: (st.warnings || 0) + warnings.length, part_issues: issues, issues })
          : { ...base, status: e.status, errors: errors.length, warnings: warnings.length, issues: (e.issues || []).slice(0, 30) };
        if (e.status !== 'fail' && !e.part) progress = Math.max(progress, progressAt(e.stage, 1));
        await event(id, e.status === 'fail' ? 'error' : e.status === 'warn' ? 'warn' : 'info', e.stage,
          `${e.part ? `${e.part} · ` : ''}${e.gate} ${e.status}${errors.length ? ` · ${errors.length} error(s)` : ''}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}${errors.length ? `: ${errors.slice(0, 2).map((i) => `[${i.code}] ${i.message}`).join(' ')}` : ''}`);
      } else if (e.type === 'render') {
        progress = Math.max(progress, progressAt('render', e.count ? e.done / e.count : 0));
        stages.render = { ...(stages.render || {}), status: 'running', frames: e.done, total: e.count };
      } else if (e.type === 'log' && /review:|voicing|rendering/.test(e.line)) {
        const kind = /review:/.test(e.line) ? 'review' : /voicing/.test(e.line) ? 'voice' : 'render';
        await event(id, 'info', kind, e.line.trim());
      }
    }
    await db().query('UPDATE summaries SET stage=?, progress=?, stages=?, heartbeat_at=? WHERE module_id=?', [stage, progress, json(stages), now(), id]);
    broadcast('summary', compact({ ...r, stage, progress, stages: json(stages) }));
  }

  // status.json ('summary/<stage>' or 'P<k>/<stage>': {status,…}) folded into the stage map.
  function mergeStages(current, fromWorker) {
    const out = { ...(current || {}) };
    for (const [k, v] of Object.entries(fromWorker || {})) {
      const [unit, stage] = k.split('/');
      const st = out[stage] || {};
      if (unit === 'summary') out[stage] = { ...st, status: v.status, gate: v.gate, errors: v.errors, warnings: v.warnings };
      else out[stage] = { ...st, parts: { ...(st.parts || {}), [unit]: v.status }, gate: v.gate };
    }
    for (const [k, st] of Object.entries(out)) {
      const parts = Object.values(st.parts || {});
      if (parts.length) out[k] = { ...st, status: parts.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'pass') };
    }
    return out;
  }

  async function receiveVideo(req, id, worker) {
    const chapter = getCatalog().chapters.get(id);
    const r = await row(id);
    if (!chapter || !r) return { status: 404, body: { error: 'unknown summary' } };
    const meta = req.headers['x-meta'] ? JSON.parse(Buffer.from(String(req.headers['x-meta']), 'base64').toString('utf8')) : {};
    const incoming = path.join(library, '.incoming');
    fs.mkdirSync(incoming, { recursive: true });
    const tmp = path.join(incoming, `summary-${id}.${Date.now()}.mp4`);
    await db().query("UPDATE summaries SET status='validating', stage='qa', progress=99, heartbeat_at=? WHERE module_id=?", [now(), id]);
    await push(id);
    await pipeline(req, fs.createWriteStream(tmp));
    const expected = Number(req.headers['content-length'] || 0);
    const got = fs.statSync(tmp).size;
    const check = validateVideo(tmp, { ...meta, stages: Object.fromEntries(Object.entries(meta.stages || {}).filter(([, s]) => s.status === 'fail')) });
    if (expected && got !== expected) check.errors.unshift(`received ${got} of ${expected} bytes`);
    if (check.errors.length) {
      fs.rmSync(tmp, { force: true });
      await db().query("UPDATE summaries SET status='failed', error_code='VIDEO_INVALID', error_stage='qa', error_message=?, finished_at=?, cost_usd=?, cost_detail=? WHERE module_id=?",
        [check.errors.join('; '), now(), meta.cost_usd || 0, json(meta.cost), id]);
      await db().query("UPDATE workers SET status='idle', summary_id=NULL, jobs_failed=jobs_failed+1 WHERE name=?", [worker]);
      await event(id, 'error', 'qa', `final validation failed: ${check.errors.join('; ')}`);
      await push(id);
      return { status: 422, body: { error: `final validation failed: ${check.errors.join('; ')}` } };
    }
    const rel = chapter.summary_path;
    const dest = path.join(ROOT, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const [[old]] = await db().query('SELECT path, remote_id, yt_video_id, yt_replaces FROM summary_videos WHERE module_id = ?', [id]);
    if (old && old.path !== rel) {
      removeFile(old.path);
      if (old.remote_id && onedrive.configured()) onedrive.remove(old.remote_id).catch((e) => log(`old OneDrive copy of summary ${id}: ${e.message}`));
    }
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
    await db().query(`INSERT INTO summary_videos (module_id, course_id, class_no, path, bytes, duration_s, width, height, slides, parts, cost_usd, cost_detail, qa, created_at, storage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local') ON DUPLICATE KEY UPDATE path=VALUES(path), bytes=VALUES(bytes), duration_s=VALUES(duration_s),
      width=VALUES(width), height=VALUES(height), slides=VALUES(slides), parts=VALUES(parts), cost_usd=VALUES(cost_usd), cost_detail=VALUES(cost_detail), qa=VALUES(qa),
      created_at=VALUES(created_at), storage='local', remote_error=NULL`,
    [id, chapter.course_id, chapter.class_no, rel, got, check.duration, check.width, check.height, meta.slides ?? null, meta.parts ?? null, meta.cost_usd ?? 0, json(meta.cost), json(meta.qa), now()]);
    await dropPieces(id);
    await db().query("UPDATE summaries SET status='done', stage='qa', progress=100, finished_at=?, cost_usd=?, cost_detail=?, stages=? WHERE module_id=?",
      [now(), meta.cost_usd || 0, json(meta.cost), json(mergeStages(parse(r.stages), meta.stages)), id]);
    await db().query("UPDATE workers SET status='idle', summary_id=NULL, jobs_done=jobs_done+1 WHERE name=?", [worker]);
    await event(id, 'info', 'qa', `validated and stored: ${SUMMARY_ROOT}/${rel} (${(check.duration / 60).toFixed(1)} min, ${(got / 1048576).toFixed(0)} MB)`);
    await push(id);
    broadcast('summary-video', await videoRow(id));
    log(`stored summary ${id} → ${SUMMARY_ROOT}/${rel}`);
    await ytReplaced(id, old);       // was on YouTube: offered as "Re-upload to YouTube"
    queueUpload(id);
    return { status: 200, body: { ok: true, path: rel } };
  }

  async function failed(id, worker, body) {
    const r = await row(id);
    if (!r) return;
    await db().query("UPDATE workers SET status='idle', summary_id=NULL, jobs_failed=jobs_failed+? WHERE name=?", [body.cancelled ? 0 : 1, worker]);
    if (body.cancelled || r.status === 'cancelling') {
      await db().query('DELETE FROM summaries WHERE module_id = ?', [id]);
      await event(id, 'warn', r.stage, 'cancelled');
      await push(id);
      return;
    }
    const stages = mergeStages(parse(r.stages), body.stages);
    const failedStage = Object.entries(body.stages || {}).find(([, s]) => s.status === 'fail')?.[0]?.split('/')[1] || r.stage;
    const errors = (body.reviewQueue || []).flatMap((q) => (q.errors || []).map((i) => ({ ...i, part: q.unit === 'summary' ? null : q.unit })));
    if (body.crashed && /worker pod stopped/.test(body.status || '')) {
      await db().query("UPDATE summaries SET status='queued', worker=NULL, stages=?, attempts=GREATEST(attempts-1,0) WHERE module_id=?", [json(stages), id]);
      await event(id, 'warn', r.stage, 'worker pod stopped; requeued — the next worker resumes from the last finished stage');
    } else if (body.crashed && r.attempts <= MAX_CRASH_RETRIES) {
      await db().query("UPDATE summaries SET status='queued', worker=NULL, stages=?, error_code='CRASHED', error_stage=?, error_message=? WHERE module_id=?", [json(stages), r.stage, String(body.status).slice(0, 2000), id]);
      await event(id, 'warn', r.stage, `crashed (${body.status}); requeued automatically`);
    } else {
      const message = errors.length ? errors.slice(0, 5).map((i) => `${i.part ? `${i.part} ` : ''}[${i.code}] ${i.message}`).join('\n') : String(body.status || 'failed');
      await db().query("UPDATE summaries SET status='failed', worker=NULL, stages=?, issues=?, error_code=?, error_stage=?, error_message=?, finished_at=?, cost_usd=?, cost_detail=? WHERE module_id=?",
        [json(stages), json(errors), body.crashed ? 'CRASHED' : 'GATE_FAILED', failedStage, message.slice(0, 4000), now(), body.cost_usd || 0, json(body.cost), id]);
      await event(id, 'error', failedStage, `${body.crashed ? 'crashed' : `failed at ${failedStage}`}: ${message.slice(0, 1500)}`);
      if (body.error) await event(id, 'error', failedStage, body.error.slice(0, 3000));
    }
    await push(id);
  }

  async function sweep() {
    await sweepPieces();
    const cutoff = new Date(Date.now() - WORKER_LOST_S * 1000);
    const [lost] = await db().query("SELECT module_id, worker, attempts, stage FROM summaries WHERE status IN ('running','cancelling','validating') AND heartbeat_at < ?", [cutoff]);
    for (const j of lost) {
      if (j.attempts > MAX_CRASH_RETRIES) {
        await db().query("UPDATE summaries SET status='failed', error_code='WORKER_LOST', error_stage=?, error_message=?, worker=NULL, finished_at=? WHERE module_id=?", [j.stage, `${j.worker} stopped responding ${j.attempts} times`, now(), j.module_id]);
        await event(j.module_id, 'error', j.stage, `${j.worker} stopped responding; giving up after ${j.attempts} attempts`);
      } else {
        await db().query("UPDATE summaries SET status='queued', worker=NULL WHERE module_id=?", [j.module_id]);
        await event(j.module_id, 'warn', j.stage, `${j.worker} stopped responding; requeued (the next worker resumes from the last finished stage)`);
      }
      await push(j.module_id);
    }
  }


  // ---- render pieces ----------------------------------------------------------------------------
  //
  // A summary that reaches its render reports a piece plan (summary-render-plan);
  // the summary goes to status 'rendering' and its pieces to render_pieces. Any
  // free worker claims a piece (they come before new lectures and summaries, so
  // a started summary finishes first). A lost or failed piece is retried
  // (PIECE_ATTEMPTS). When the last piece is done the summary is queued again,
  // at the front, and its job joins the pieces, runs QA and uploads the video.

  const PIECE_ATTEMPTS = 3;
  const PIECE_LOST_S = 90;
  const piecesOf = async (id) => (await db().query('SELECT idx, frame_from, frame_to, label, status, worker, attempts, frames_done FROM render_pieces WHERE module_id = ? ORDER BY idx', [id]))[0];

  // The summary's render progress from its pieces: stages.render + progress.
  async function refreshRender(id, { log: line = null } = {}) {
    const r = await row(id);
    if (!r) return;
    const pieces = await piecesOf(id);
    const total = pieces.reduce((a, p) => a + p.frame_to - p.frame_from, 0) || 1;
    const frames = pieces.reduce((a, p) => a + (p.status === 'done' ? p.frame_to - p.frame_from : Math.min(p.frames_done, p.frame_to - p.frame_from)), 0);
    const stages = parse(r.stages) || {};
    const done = pieces.filter((p) => p.status === 'done').length;
    stages.render = {
      ...(stages.render || {}), status: 'running', frames, total, count: pieces.length, done,
      pieces: Object.fromEntries(pieces.map((p) => [p.idx, p.status === 'running' ? 'active' : p.status === 'done' ? 'pass' : p.status === 'failed' ? 'fail' : 'pending'])),
    };
    const progress = Math.max(r.progress, progressAt('render', frames / total));
    await db().query('UPDATE summaries SET stages=?, progress=?, heartbeat_at=? WHERE module_id=?', [json(stages), progress, now(), id]);
    broadcast('summary', compact({ ...r, progress, stages: json(stages) }));
    if (line) await event(id, 'info', 'render', line);
  }

  async function receiveRenderPlan(id, worker, body) {
    const r = await row(id);
    if (!r || r.status !== 'running') return;
    const plan = body.plan;
    await db().query('DELETE FROM render_pieces WHERE module_id = ?', [id]);
    for (const p of plan.pieces) {
      await db().query('INSERT INTO render_pieces (module_id, idx, frame_from, frame_to, label, status, frames_done, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, p.idx, p.from, p.to, p.label || null, p.done ? 'done' : 'queued', p.done ? p.to - p.from : 0, p.done ? now() : null]);
    }
    const stages = mergeStages(parse(r.stages), body.stages);
    await db().query("UPDATE summaries SET status='rendering', worker=NULL, stage='render', stages=?, cost_usd=?, cost_detail=?, heartbeat_at=? WHERE module_id=?", [json(stages), body.cost_usd || 0, json(body.cost), now(), id]);
    await db().query("UPDATE workers SET status='idle', summary_id=NULL, task=NULL WHERE name=?", [worker]);
    const left = plan.pieces.filter((p) => !p.done).length;
    await refreshRender(id, { log: `render: ${(plan.duration / 60000).toFixed(1)} min in ${plan.pieces.length} pieces of ~${Math.round((plan.pieces[0].to - plan.pieces[0].from) / plan.fps / 60)} min — ${left} to render, shared across the workers` });
    if (!left) await allPiecesDone(id);
  }

  async function allPiecesDone(id) {
    const pieces = await piecesOf(id);
    if (!pieces.length || pieces.some((p) => p.status !== 'done')) return;
    await db().query("UPDATE summaries SET status='queued', from_stage=NULL, priority=?, attempts=0, worker=NULL, queued_at=? WHERE module_id=?", [await topPriority(), now(), id]);
    await event(id, 'info', 'render', `all ${pieces.length} pieces rendered — joining them into the video`);
    await push(id);
  }

  // The first piece to render (pieces before new work; the summary queue switch applies).
  async function nextPiece() {
    if ((await queueState()) !== 'running') return null;
    const [[p]] = await db().query(`SELECT p.module_id, p.idx FROM render_pieces p JOIN summaries s ON s.module_id = p.module_id
      WHERE p.status = 'queued' AND s.status = 'rendering' ORDER BY s.priority DESC, s.queued_at ASC, p.idx ASC LIMIT 1`);
    return p || null;
  }

  async function claimPiece({ module_id: id, idx }, worker) {
    const [res] = await db().query("UPDATE render_pieces SET status='running', worker=?, attempts=attempts+1, frames_done=0, error=NULL, started_at=?, heartbeat_at=? WHERE module_id=? AND idx=? AND status='queued'", [worker, now(), now(), id, idx]);
    if (!res.affectedRows) return null;
    const chapter = getCatalog().chapters.get(id);
    const [[p]] = await db().query('SELECT label, attempts FROM render_pieces WHERE module_id=? AND idx=?', [id, idx]);
    const [[{ n }]] = await db().query('SELECT COUNT(*) AS n FROM render_pieces WHERE module_id=?', [id]);
    const task = `Summary · Ch ${chapter?.chapter_no ?? '?'} · piece ${idx + 1}/${n}`;
    await db().query("UPDATE workers SET status='busy', lecture_id=NULL, summary_id=?, task=? WHERE name=?", [id, task, worker]);
    await event(id, 'info', 'render', `piece ${idx + 1}/${n} (${p.label || ''}) → ${worker}${p.attempts > 1 ? ` · attempt ${p.attempts}` : ''}`);
    await refreshRender(id);
    return {
      kind: 'piece', module_id: id, idx, pieces: n, label: `${chapter ? `Class ${chapter.class_no} ${chapter.subject} · Ch ${chapter.chapter_no} summary` : `summary ${id}`} · ${p.label || ''}`,
      input: { course_id: chapter?.course_id, module_id: id },
    };
  }

  let lastPush = new Map();
  async function pieceHeartbeat(worker, body) {
    const id = Number(body.module_id), idx = Number(body.idx);
    await db().query('UPDATE workers SET last_seen=? WHERE name=?', [now(), worker]);
    const [[p]] = await db().query('SELECT status, worker FROM render_pieces WHERE module_id=? AND idx=?', [id, idx]);
    const r = await row(id);
    const cancel = !p || p.status !== 'running' || p.worker !== worker || !r || r.status !== 'rendering';
    if (!cancel) {
      await db().query('UPDATE render_pieces SET heartbeat_at=?, frames_done=? WHERE module_id=? AND idx=?', [now(), Number(body.frames_done) || 0, id, idx]);
      if (Date.now() - (lastPush.get(id) || 0) > 3000) { lastPush.set(id, Date.now()); await refreshRender(id); }
    }
    return { cancel };
  }

  async function pieceDone(id, idx, worker, body) {
    await db().query("UPDATE render_pieces SET status='done', frames_done=frame_to-frame_from, finished_at=?, worker=NULL WHERE module_id=? AND idx=? AND status='running'", [now(), id, idx]);
    await db().query("UPDATE workers SET status='idle', summary_id=NULL, task=NULL WHERE name=?", [worker]);
    const pieces = await piecesOf(id);
    await refreshRender(id, { log: `piece ${idx + 1}/${pieces.length} rendered by ${worker} (${Math.round(Number(body.seconds) || 0)} s) · ${pieces.filter((p) => p.status === 'done').length}/${pieces.length} done` });
    await allPiecesDone(id);
  }

  async function failSummary(id, code, message) {
    await db().query("UPDATE summaries SET status='failed', worker=NULL, error_code=?, error_stage='render', error_message=?, finished_at=? WHERE module_id=?", [code, message.slice(0, 4000), now(), id]);
    await db().query("UPDATE render_pieces SET status='queued', worker=NULL WHERE module_id=? AND status='running'", [id]);
    await event(id, 'error', 'render', message.slice(0, 1500));
    await push(id);
  }

  async function pieceFailed(id, idx, worker, body) {
    await db().query("UPDATE workers SET status='idle', summary_id=NULL, task=NULL WHERE name=?", [worker]);
    const [[p]] = await db().query('SELECT attempts, status FROM render_pieces WHERE module_id=? AND idx=?', [id, idx]);
    const r = await row(id);
    if (!p || !r || r.status !== 'rendering') return;   // cancelled or retried meanwhile
    const why = String(body.status || 'failed');
    if (/worker pod stopped/.test(why) || p.attempts < PIECE_ATTEMPTS) {
      await db().query("UPDATE render_pieces SET status='queued', worker=NULL, error=?, attempts=? WHERE module_id=? AND idx=?", [why, /worker pod stopped/.test(why) ? Math.max(0, p.attempts - 1) : p.attempts, id, idx]);
      await refreshRender(id, { log: `piece ${idx + 1} on ${worker}: ${why.slice(0, 300)} — queued again` });
      return;
    }
    await db().query("UPDATE render_pieces SET status='failed', worker=NULL, error=? WHERE module_id=? AND idx=?", [`${why}\n${body.error || ''}`.slice(0, 4000), id, idx]);
    await failSummary(id, 'RENDER_PIECE_FAILED', `piece ${idx + 1} failed ${p.attempts} times: ${why}${body.error ? `\n${String(body.error).slice(0, 1500)}` : ''}`);
  }

  async function sweepPieces() {
    const [lost] = await db().query("SELECT module_id, idx, worker, attempts FROM render_pieces WHERE status='running' AND heartbeat_at < ?", [new Date(Date.now() - PIECE_LOST_S * 1000)]);
    for (const p of lost) {
      if (p.attempts >= PIECE_ATTEMPTS) {
        await db().query("UPDATE render_pieces SET status='failed', worker=NULL, error='worker stopped responding' WHERE module_id=? AND idx=?", [p.module_id, p.idx]);
        await failSummary(p.module_id, 'RENDER_PIECE_FAILED', `piece ${p.idx + 1}: ${p.worker} stopped responding ${p.attempts} times`);
      } else {
        await db().query("UPDATE render_pieces SET status='queued', worker=NULL WHERE module_id=? AND idx=?", [p.module_id, p.idx]);
        await refreshRender(p.module_id, { log: `piece ${p.idx + 1}: ${p.worker} stopped responding — queued again` });
      }
    }
  }
  const dropPieces = (id) => db().query('DELETE FROM render_pieces WHERE module_id = ?', [id]);

  // ---- library + OneDrive -------------------------------------------------------------------------

  function removeFile(rel) {
    const file = path.join(ROOT, ...rel.split('/'));
    fs.rmSync(file, { force: true });
    for (let d = path.dirname(file); d.startsWith(ROOT) && d !== ROOT; d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
  }
  const uploadQueue = [];
  const uploading = new Map();
  function queueUpload(id) {
    if (!onedrive.configured() || uploading.has(id) || uploadQueue.includes(id)) return;
    uploadQueue.push(id);
    pump();
  }
  function pump() {
    while (uploading.size < 1 && uploadQueue.length) {
      const id = uploadQueue.shift();
      uploading.set(id, { done: 0, total: 0 });
      uploadOne(id).catch((e) => log(`summary upload ${id}: ${e.message}`)).finally(() => { uploading.delete(id); pump(); });
    }
  }
  const setStorage = async (id, storage, remoteError = null) => {
    await db().query('UPDATE summary_videos SET storage=?, remote_error=? WHERE module_id=?', [storage, remoteError, id]);
    broadcast('summary-video', await videoRow(id));
  };
  async function uploadOne(id) {
    const v = await videoRow(id);
    if (!v) return;
    const file = path.join(ROOT, ...v.path.split('/'));
    if (!fs.existsSync(file)) { if (v.storage !== 'onedrive') await setStorage(id, 'failed', 'the local file is missing — regenerate this summary'); return; }
    await setStorage(id, 'uploading');
    let lastPush = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        const item = await onedrive.upload(file, v.path, {
          root: onedrive.SUMMARY_ROOT,
          onProgress: (done, total) => {
            uploading.set(id, { done, total });
            if (Date.now() - lastPush > 1000 || done === total) { lastPush = Date.now(); broadcast('summary-upload', { module_id: id, done, total }); }
          },
        });
        await db().query("UPDATE summary_videos SET storage='onedrive', remote_id=?, remote_url=?, remote_error=NULL, uploaded_at=? WHERE module_id=?", [item.id, item.webUrl, now(), id]);
        if (!keepLocal) removeFile(v.path);
        await event(id, 'info', 'qa', `uploaded to OneDrive: ${onedrive.remotePath(v.path, onedrive.SUMMARY_ROOT)}${keepLocal ? '' : ' (local copy removed)'}`);
        broadcast('summary-video', await videoRow(id));
        return;
      } catch (e) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 15000 * attempt)); continue; }
        await setStorage(id, 'failed', e.message.slice(0, 2000));
        await event(id, 'error', 'qa', `OneDrive upload failed: ${e.message.slice(0, 600)}`);
        return;
      }
    }
  }

  // ---- HTTP --------------------------------------------------------------------------------------

  route('GET', '/api/summaries', async () => {
    const [rows] = await db().query(`SELECT ${COLS} FROM summaries`);
    const [videos] = await db().query(`SELECT ${VIDEO_COLS} FROM summary_videos`);
    return { summaries: rows.map(compact), videos: videos.map(withProgress), queue: await queueState(), root: SUMMARY_ROOT };
  });
  route('GET', '/api/summaries/:id', async ({ id }) => {
    const [[j]] = await db().query('SELECT * FROM summaries WHERE module_id = ?', [Number(id)]);
    const [events] = await db().query('SELECT at, level, stage, message FROM summary_events WHERE module_id = ? ORDER BY id DESC LIMIT 300', [Number(id)]);
    const [[vc]] = await db().query('SELECT cost_detail FROM summary_videos WHERE module_id = ?', [Number(id)]);
    return { chapter: getCatalog().chapters.get(Number(id)) || null, job: j ? { ...compact(j), issues: parse(j.issues) } : null, events: events.reverse(), video: await videoRow(Number(id)), cost: parse(j?.cost_detail) || parse(vc?.cost_detail) || null };
  });
  route('POST', '/api/summaries/queue', async (_, body) => enqueue(body.scope || {}, { redo: !!body.redo }));
  route('POST', '/api/summaries/pause', async () => { await setSetting(db(), 'summary_queue', 'paused'); broadcast('summary-queue', { state: 'paused' }); return { ok: true }; });
  route('POST', '/api/summaries/resume', async () => { await setSetting(db(), 'summary_queue', 'running'); broadcast('summary-queue', { state: 'running' }); return { ok: true }; });
  route('POST', '/api/summaries/retry-failed', async (_, body) => {
    const ids = chaptersIn(body.scope || {}).map((c) => c.module_id);
    if (!ids.length) return { retried: 0 };
    const [r] = await db().query(`UPDATE summaries SET status='queued', from_stage=NULL, priority=0, attempts=0, worker=NULL, queued_at=? WHERE status = 'failed' AND module_id IN (${ids.map(() => '?').join(',')})`, [now(), ...ids]);
    await db().query(`DELETE p FROM render_pieces p JOIN summaries s ON s.module_id = p.module_id WHERE s.status = 'queued' AND p.module_id IN (${ids.map(() => '?').join(',')})`, ids);
    broadcast('refresh', { what: 'summaries' });
    return { retried: r.affectedRows };
  });
  route('POST', '/api/summaries/unqueue', async (_, body) => {
    const ids = chaptersIn(body.scope || {}).map((c) => c.module_id);
    if (!ids.length) return { removed: 0 };
    const [r] = await db().query(`DELETE FROM summaries WHERE status = 'queued' AND module_id IN (${ids.map(() => '?').join(',')})`, ids);
    broadcast('refresh', { what: 'summaries' });
    return { removed: r.affectedRows };
  });
  route('POST', '/api/summaries/:id/retry', async ({ id }, body) => {
    const r = await row(Number(id));
    if (!r) return enqueue({ module_ids: [Number(id)] }, { redo: !!body.fresh });
    if (['queued', 'running', 'rendering', 'validating', 'cancelling'].includes(r.status)) throw Object.assign(new Error('this summary is already queued or running'), { status: 409 });
    const from = body.fresh ? 'prepare' : body.from || null;
    await dropPieces(Number(id));
    await db().query("UPDATE summaries SET status='queued', from_stage=?, priority=?, attempts=0, worker=NULL, queued_at=?, finished_at=NULL, progress=0, stage=NULL WHERE module_id=?",
      [from, body.next ? await topPriority() : 0, now(), Number(id)]);
    await event(Number(id), 'info', from, `retry requested${from ? ` from ${from}` : ' (resume from the failed stage)'}`);
    await push(Number(id));
    return { ok: true };
  });
  route('POST', '/api/summaries/:id/next', async ({ id }) => {
    await db().query("UPDATE summaries SET priority=? WHERE module_id=? AND status='queued'", [await topPriority(), Number(id)]);
    await push(Number(id));
    return { ok: true };
  });
  route('POST', '/api/summaries/:id/cancel', async ({ id }) => {
    const r = await row(Number(id));
    if (!r) return { ok: true };
    if (r.status === 'queued' || r.status === 'failed' || r.status === 'rendering') {
      // A rendering summary has no job of its own: its piece workers stop at their next heartbeat.
      await dropPieces(Number(id));
      await db().query('DELETE FROM summaries WHERE module_id = ?', [Number(id)]);
      if (r.status === 'rendering') await event(Number(id), 'warn', 'render', 'cancelled while rendering — the piece workers stop');
    } else if (r.status === 'running') {
      await db().query("UPDATE summaries SET status='cancelling' WHERE module_id=?", [Number(id)]);
      await event(Number(id), 'warn', r.stage, 'cancel requested — stopping the worker');
    }
    await push(Number(id));
    return { ok: true };
  });
  route('DELETE', '/api/summary-videos/:id', async ({ id }) => {
    const [[v]] = await db().query('SELECT path, remote_id FROM summary_videos WHERE module_id = ?', [Number(id)]);
    if (v) removeFile(v.path);
    if (v?.remote_id && onedrive.configured()) await onedrive.remove(v.remote_id);
    await db().query('DELETE FROM summary_videos WHERE module_id = ?', [Number(id)]);
    await db().query("DELETE FROM summaries WHERE module_id = ? AND status IN ('done','failed')", [Number(id)]);
    await dropPieces(Number(id));
    broadcast('summary-video', { module_id: Number(id), deleted: true });
    await push(Number(id));
    return { ok: true };
  });
  route('POST', '/api/summary-videos/:id/upload', async ({ id }) => { queueUpload(Number(id)); return { queued: true }; });

  // Worker API
  route('POST', '/api/worker/summary-heartbeat', async (_, body, { worker }) => {
    const id = Number(body.module_id);
    await db().query("UPDATE workers SET last_seen=?, status='busy', summary_id=? WHERE name=?", [now(), id, worker]);
    const r = await row(id);
    if (r && r.status === 'running') await db().query('UPDATE summaries SET heartbeat_at=? WHERE module_id=?', [now(), id]);
    return { cancel: !r || r.status === 'cancelling' || r.worker !== worker };
  });
  route('POST', '/api/worker/summary-events/:id', async ({ id }, body) => { await applyEvents(Number(id), body.events || []); return { ok: true }; });
  route('POST', '/api/worker/summary-failed/:id', async ({ id }, body, { worker }) => { await failed(Number(id), worker, body); return { ok: true }; });
  route('POST', '/api/worker/summary-render-plan/:id', async ({ id }, body, { worker }) => { await receiveRenderPlan(Number(id), worker, body); return { ok: true }; });
  route('POST', '/api/worker/piece-heartbeat', async (_, body, { worker }) => pieceHeartbeat(worker, body));
  route('POST', '/api/worker/piece-done/:id/:idx', async ({ id, idx }, body, { worker }) => { await pieceDone(Number(id), Number(idx), worker, body); return { ok: true }; });
  route('POST', '/api/worker/piece-failed/:id/:idx', async ({ id, idx }, body, { worker }) => { await pieceFailed(Number(id), Number(idx), worker, body); return { ok: true }; });
  route('GET', '/api/summaries/:id/pieces', async ({ id }) => piecesOf(Number(id)));

  // Raw-body / streaming routes (the central's server handler calls these).
  async function serveFile(req, res, id, send) {
    const [[v]] = await db().query('SELECT path, remote_id FROM summary_videos WHERE module_id = ?', [id]);
    const file = v && path.join(ROOT, ...v.path.split('/'));
    if (file && fs.existsSync(file)) return streamFile(req, res, file, 'video/mp4');
    if (v?.remote_id && onedrive.configured()) { res.writeHead(302, { location: await onedrive.downloadUrl(v.remote_id), 'cache-control': 'no-store' }); return res.end(); }
    return send(res, 404, { error: 'video not found' });
  }

  async function resumeUploads() {
    const [pending] = await db().query("SELECT module_id FROM summary_videos WHERE storage IN ('local','uploading')");
    for (const p of pending) queueUpload(p.module_id);
  }

  // For the central's YouTube publishing: the row, the local file path, the activity log.
  const fileOf = (rel) => path.join(ROOT, ...rel.split('/'));

  return { next, claim, nextPiece, claimPiece, receiveVideo, serveFile, sweep, resumeUploads, videoRow, fileOf, event };
}
