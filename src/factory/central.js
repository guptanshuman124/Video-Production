// Central pod: backend + scheduler + dashboard on one port.
//
//   - knows every lecture (catalog from the course tables) and its state (factory DB)
//   - class queues: "Start class 10" queues its lectures in course order; a
//     paused class is skipped; "Run next" jumps a lecture to the front
//   - hands lectures to worker pods (claim), follows their progress (events,
//     heartbeats), requeues a lecture if its worker disappears
//   - final validation of every uploaded video, then stores it in the library
//     (LIBRARY_DIR/Class N/Subject/[Book/]Chapter K - …/Lecture M - ….mp4), uploads it to
//     OneDrive / SharePoint in the same folders (onedrive.js), and
//     records it in the `videos` table; the worker then deletes its files
//   - serves the dashboard (web/dist) and live updates (Server-Sent Events)
//
// env: PORT, FACTORY_DB_URL, TEXTBOOK_DB_URL, SOURCE_DB_URL, LIBRARY_DIR, WEB_DIR

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { waitForDb, json, parse, getSetting, setSetting } from './db.js';
import { loadCatalog, inputFor } from './catalog.js';
import { syncSource } from './sync.js';
import { probeAll } from '../qa.js';
import * as k8s from './k8s.js';
import * as onedrive from './onedrive.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const LIBRARY = path.resolve(process.env.LIBRARY_DIR || path.join(ROOT, 'library'));
const WEB = path.resolve(process.env.WEB_DIR || path.join(ROOT, 'web', 'dist'));
const WORKER_LOST_S = 120;     // no heartbeat for this long → the lecture goes back to the queue
const WORKER_OFFLINE_S = 45;
const MAX_CRASH_RETRIES = 2;   // automatic requeues after a crash / lost worker; gate failures wait for a person

// Share of the progress bar per stage (render is most of the wall-clock time).
const WEIGHTS = { prepare: 2, 'slide-plan': 8, 'slide-write': 10, narrate: 10, hinglish: 0, review: 10, assemble: 1, voice: 12, build: 3, render: 40, qa: 4 };
const ORDER = Object.keys(WEIGHTS);
const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
const progressAt = (stage, frac = 0) => {
  const i = ORDER.indexOf(stage);
  if (i < 0) return 0;
  const before = ORDER.slice(0, i).reduce((a, s) => a + WEIGHTS[s], 0);
  return Math.min(99, Math.round(((before + WEIGHTS[stage] * frac) / TOTAL) * 1000) / 10);
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const now = () => new Date();

let db;
let catalog = { classes: [], lectures: new Map(), at: null };
let sync = { running: false, progress: null, error: null, last: null };

// ---- live updates -------------------------------------------------------------------------

const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const JOB_COLS = 'lecture_id, status, stage, progress, from_stage, priority, attempts, worker, error_code, error_stage, error_message, cost_usd, queued_at, started_at, finished_at, stages';
const compact = (r) => r && ({
  lecture_id: r.lecture_id, status: r.status, stage: r.stage, progress: r.progress, from_stage: r.from_stage, priority: r.priority,
  attempts: r.attempts, worker: r.worker, error_code: r.error_code, error_stage: r.error_stage,
  error_message: r.error_message ? String(r.error_message).slice(0, 400) : null, cost_usd: r.cost_usd,
  queued_at: r.queued_at, started_at: r.started_at, finished_at: r.finished_at, stages: parse(r.stages) || {},
});
async function jobRow(id) {
  const [[r]] = await db.query(`SELECT ${JOB_COLS} FROM jobs WHERE lecture_id = ?`, [id]);
  return r || null;
}
async function pushJob(id) {
  const r = await jobRow(id);
  broadcast('job', r ? compact(r) : { lecture_id: id, status: null });
}
async function event(id, level, stage, message) {
  await db.query('INSERT INTO job_events (lecture_id, at, level, stage, message) VALUES (?, ?, ?, ?, ?)', [id, now(), level, stage || null, String(message).slice(0, 4000)]);
  broadcast('log', { lecture_id: id, at: Date.now(), level, stage, message: String(message).slice(0, 600) });
}

// ---- queue --------------------------------------------------------------------------------

// Lectures matching a scope. scope: { class_no, subject, course_id, module_id, lecture_ids }
function lecturesIn(scope) {
  const ids = scope.lecture_ids ? new Set(scope.lecture_ids.map(Number)) : null;
  return [...catalog.lectures.values()].filter((l) =>
    (scope.class_no == null || l.class_no === Number(scope.class_no))
    && (scope.subject == null || l.subject === scope.subject)
    && (scope.course_id == null || l.course_id === Number(scope.course_id))
    && (scope.module_id == null || l.module_id === Number(scope.module_id))
    && (!ids || ids.has(l.lecture_id)));
}

async function enqueue(scope, { redo = false, resume = false } = {}) {
  const wanted = lecturesIn(scope);
  const [jobs] = await db.query('SELECT lecture_id, status FROM jobs');
  const state = new Map(jobs.map((j) => [j.lecture_id, j.status]));
  const [vids] = await db.query('SELECT lecture_id FROM videos');
  const done = new Set(vids.map((v) => v.lecture_id));
  const t = now();
  const skipped = { unsupported: 0, done: 0, active: 0, failed: 0 };
  const add = [];
  for (const l of wanted) {
    const s = state.get(l.lecture_id);
    if (!l.supported) { skipped.unsupported++; continue; }
    if (s === 'queued' || s === 'running' || s === 'validating') { skipped.active++; continue; }
    if (!redo && (done.has(l.lecture_id) || s === 'done')) { skipped.done++; continue; }
    if (!redo && s === 'failed' && !scope.lecture_ids) { skipped.failed++; continue; }   // retried explicitly, not by "start class"
    add.push(l);
  }
  for (const l of add) {
    await db.query(`INSERT INTO jobs (lecture_id, course_id, module_id, class_no, subject, book, chapter_no, chapter_title, lecture_no, lecture_count, lecture_title, seq, status, stage, progress, from_stage, priority, attempts, queued_at, stages, issues)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, 0, ?, 0, 0, ?, '{}', NULL)
      ON DUPLICATE KEY UPDATE status='queued', stage=NULL, progress=0, from_stage=VALUES(from_stage), priority=0, attempts=0, worker=NULL,
        error_code=NULL, error_stage=NULL, error_message=NULL, stages='{}', issues=NULL, cost_usd=0, queued_at=VALUES(queued_at), started_at=NULL, finished_at=NULL,
        course_id=VALUES(course_id), module_id=VALUES(module_id), class_no=VALUES(class_no), subject=VALUES(subject), book=VALUES(book), chapter_no=VALUES(chapter_no),
        chapter_title=VALUES(chapter_title), lecture_no=VALUES(lecture_no), lecture_count=VALUES(lecture_count), lecture_title=VALUES(lecture_title), seq=VALUES(seq)`,
    [l.lecture_id, l.course_id, l.module_id, l.class_no, l.subject, l.book, l.chapter_no, l.chapter_title, l.lecture_no, l.lecture_count, l.lecture_title, l.seq, redo ? 'prepare' : null, t]);
  }
  // A class seen for the first time gets a running queue. Queueing never un-pauses a
  // paused class — only Start (resume: true) and Resume do.
  for (const c of new Set(add.map((l) => l.class_no))) {
    if (resume) await setQueue(c, 'running', { quiet: true });
    else await db.query("INSERT IGNORE INTO class_queues (class_no, state, updated_at) VALUES (?, 'running', ?)", [c, now()]);
  }
  if (add.length) {
    log(`queued ${add.length} lecture(s)`, JSON.stringify(scope));
    broadcast('refresh', { what: 'jobs' });
  }
  return { queued: add.length, skipped };
}

async function setQueue(classNo, state, { quiet = false } = {}) {
  await db.query('INSERT INTO class_queues (class_no, state, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = VALUES(updated_at)', [classNo, state, now()]);
  if (!quiet) log(`class ${classNo} queue ${state}`);
  broadcast('queue', { class_no: Number(classNo), state });
}

// One claim at a time (single central process).
let claiming = Promise.resolve();
function claim(worker) {
  const run = claiming.then(async () => {
    const [[j]] = await db.query(`SELECT j.lecture_id FROM jobs j LEFT JOIN class_queues q ON q.class_no = j.class_no
      WHERE j.status = 'queued' AND COALESCE(q.state, 'running') = 'running'
      ORDER BY j.priority DESC, j.queued_at ASC, j.seq ASC LIMIT 1`);
    if (!j) return null;
    const lecture = catalog.lectures.get(j.lecture_id);
    if (!lecture) {
      await db.query("UPDATE jobs SET status='failed', error_code='NOT_IN_SOURCE', error_message='this lecture is no longer in the course tables', finished_at=? WHERE lecture_id=?", [now(), j.lecture_id]);
      await pushJob(j.lecture_id);
      return null;
    }
    let input;
    try { input = await inputFor(lecture); } catch (e) {
      await db.query("UPDATE jobs SET status='failed', error_code='SOURCE_ERROR', error_message=?, finished_at=? WHERE lecture_id=?", [e.message, now(), j.lecture_id]);
      await event(j.lecture_id, 'error', 'prepare', e.message);
      await pushJob(j.lecture_id);
      return null;
    }
    const [[row]] = await db.query('SELECT from_stage, attempts FROM jobs WHERE lecture_id = ?', [j.lecture_id]);
    // from_stage is used once: a lecture requeued after a crash resumes instead of starting over again.
    await db.query("UPDATE jobs SET status='running', worker=?, attempts=attempts+1, from_stage=NULL, started_at=?, heartbeat_at=?, finished_at=NULL, error_code=NULL, error_stage=NULL, error_message=NULL WHERE lecture_id=?",
      [worker, now(), now(), j.lecture_id]);
    await db.query("UPDATE workers SET status='busy', lecture_id=? WHERE name=?", [j.lecture_id, worker]);
    await event(j.lecture_id, 'info', null, `assigned to ${worker}${row.from_stage ? ` (from ${row.from_stage})` : ''} · attempt ${row.attempts + 1}`);
    await pushJob(j.lecture_id);
    pushWorkers();
    return {
      lecture_id: j.lecture_id, input, from_stage: row.from_stage,
      label: `Class ${lecture.class_no} ${lecture.subject} · Ch ${lecture.chapter_no} L${lecture.lecture_no}: ${lecture.lecture_title}`,
    };
  });
  claiming = run.catch(() => {});
  return run;
}

async function seen(worker, busyWith) {
  if (!worker) return;
  await db.query(`INSERT INTO workers (name, status, lecture_id, started_at, last_seen) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)${busyWith === undefined ? '' : ', status = VALUES(status), lecture_id = VALUES(lecture_id)'}`,
  [worker, busyWith ? 'busy' : 'idle', busyWith || null, now(), now()]);
}

let workersPushed = 0;
async function pushWorkers(force = false) {
  if (!force && Date.now() - workersPushed < 1000) return;
  workersPushed = Date.now();
  broadcast('workers', await workersState());
}
async function workersState() {
  const [rows] = await db.query('SELECT name, status, lecture_id, started_at, last_seen, jobs_done, jobs_failed FROM workers ORDER BY name');
  const cutoff = Date.now() - WORKER_OFFLINE_S * 1000;
  let scale = null;
  try { scale = await getScaleCached(); } catch { scale = null; }
  return {
    // Pods get new names on every redeploy: only live workers are shown.
    workers: rows.map((w) => ({ ...w, online: new Date(w.last_seen).getTime() >= cutoff })).filter((w) => w.online),
    scale, k8s: k8s.available(),
  };
}
let scaleCache = { at: 0, v: null };
async function getScaleCached() {
  if (Date.now() - scaleCache.at < 5000) return scaleCache.v;
  scaleCache = { at: Date.now(), v: await k8s.getWorkerScale() };
  return scaleCache.v;
}

// Worker progress events → job row.
async function applyEvents(id, worker, events) {
  const r = await jobRow(id);
  if (!r || r.status !== 'running') return;
  const stages = parse(r.stages) || {};
  let { stage, progress } = r;
  for (const e of events) {
    if (e.type === 'stage') {
      stage = e.stage;
      progress = Math.max(progress, progressAt(e.stage));
      stages[e.stage] = { ...(stages[e.stage] || {}), status: 'running', started: e.at };
      await event(id, 'info', e.stage, `${e.stage} started`);
    } else if (e.type === 'gate') {
      const errors = (e.issues || []).filter((i) => i.severity === 'error');
      const warnings = (e.issues || []).filter((i) => i.severity === 'warning');
      stages[e.stage] = { ...(stages[e.stage] || {}), status: e.status, gate: e.gate, errors: errors.length, warnings: warnings.length, finished: e.at,
                          attempts: e.extra?.attempts, issues: (e.issues || []).slice(0, 30) };
      if (e.status !== 'fail') progress = Math.max(progress, progressAt(e.stage, 1));
      await event(id, e.status === 'fail' ? 'error' : e.status === 'warn' ? 'warn' : 'info', e.stage,
        `${e.gate} ${e.status}${errors.length ? ` · ${errors.length} error(s)` : ''}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}${errors.length ? `: ${errors.slice(0, 2).map((i) => `[${i.code}] ${i.message}`).join(' ')}` : ''}`);
    } else if (e.type === 'render') {
      progress = Math.max(progress, progressAt('render', e.count ? e.done / e.count : 0));
      stages.render = { ...(stages.render || {}), status: 'running', frames: e.done, total: e.count };
    } else if (e.type === 'log' && /review:|voicing|rendering/.test(e.line)) {
      await event(id, 'info', stage, e.line.trim());
    }
  }
  await db.query('UPDATE jobs SET stage=?, progress=?, stages=?, heartbeat_at=? WHERE lecture_id=?', [stage, progress, json(stages), now(), id]);
  broadcast('job', compact({ ...r, stage, progress, stages: json(stages) }));
}

// ---- final validation + library -----------------------------------------------------------

function validateVideo(file, meta) {
  const errors = [];
  let probe;
  try { probe = probeAll(file); } catch (e) { return { errors: [`ffprobe could not read the file: ${e.message}`] }; }
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  if (!v) errors.push('no video stream');
  else {
    if (v.width !== 1920 || v.height !== 1080) errors.push(`resolution is ${v.width}×${v.height}, expected 1920×1080`);
    if (v.codec_name !== 'h264') errors.push(`video codec is ${v.codec_name}, expected h264`);
  }
  if (!a) errors.push('no audio track');
  if (!(duration > 60)) errors.push(`duration ${duration}s is too short for a lecture`);
  if (meta?.qa?.duration && Math.abs(meta.qa.duration - duration) > 2) errors.push(`duration ${duration.toFixed(1)}s differs from the worker's QA (${meta.qa.duration.toFixed(1)}s) — upload incomplete?`);
  const failed = Object.entries(meta?.stages || {}).filter(([, s]) => s.status === 'fail').map(([k]) => k.replace(/^lecture\//, ''));
  if (failed.length) errors.push(`stages failed on the worker: ${failed.join(', ')}`);
  if (!meta?.qa) errors.push('the worker sent no QA report (V1)');
  return { errors, probe, duration, width: v?.width, height: v?.height };
}

async function receiveVideo(req, id, worker) {
  const lecture = catalog.lectures.get(id);
  const r = await jobRow(id);
  if (!lecture || !r) return { status: 404, body: { error: 'unknown lecture' } };
  const meta = req.headers['x-meta'] ? JSON.parse(Buffer.from(String(req.headers['x-meta']), 'base64').toString('utf8')) : {};
  const incoming = path.join(LIBRARY, '.incoming');
  fs.mkdirSync(incoming, { recursive: true });
  const tmp = path.join(incoming, `${id}.${Date.now()}.mp4`);
  await db.query("UPDATE jobs SET status='validating', stage='qa', progress=99, heartbeat_at=? WHERE lecture_id=?", [now(), id]);
  await pushJob(id);
  await pipeline(req, fs.createWriteStream(tmp));
  const expected = Number(req.headers['content-length'] || 0);
  const got = fs.statSync(tmp).size;
  const check = validateVideo(tmp, meta);
  if (expected && got !== expected) check.errors.unshift(`received ${got} of ${expected} bytes`);
  if (check.errors.length) {
    fs.rmSync(tmp, { force: true });
    await db.query("UPDATE jobs SET status='failed', error_code='VIDEO_INVALID', error_stage='qa', error_message=?, finished_at=?, cost_usd=? WHERE lecture_id=?",
      [check.errors.join('; '), now(), meta.cost_usd || 0, id]);
    await db.query("UPDATE workers SET status='idle', lecture_id=NULL, jobs_failed=jobs_failed+1 WHERE name=?", [worker]);
    await event(id, 'error', 'qa', `final validation failed: ${check.errors.join('; ')}`);
    await pushJob(id); pushWorkers(true);
    return { status: 422, body: { error: `final validation failed: ${check.errors.join('; ')}` } };
  }
  // Into the library. A regenerated lecture replaces its old file (also when its title changed).
  const rel = lecture.library_path;
  const dest = path.join(LIBRARY, ...rel.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const [[old]] = await db.query('SELECT path, remote_id FROM videos WHERE lecture_id = ?', [id]);
  if (old && old.path !== rel) {
    removeFromLibrary(old.path);
    // The old OneDrive copy sits at the old path (the title changed): remove it.
    if (old.remote_id && onedrive.configured()) onedrive.remove(old.remote_id).catch((e) => log(`old OneDrive copy of ${id}: ${e.message}`));
  }
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  await db.query(`INSERT INTO videos (lecture_id, course_id, module_id, class_no, path, bytes, duration_s, width, height, slides, cost_usd, qa, created_at, storage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local') ON DUPLICATE KEY UPDATE path=VALUES(path), bytes=VALUES(bytes), duration_s=VALUES(duration_s),
    width=VALUES(width), height=VALUES(height), slides=VALUES(slides), cost_usd=VALUES(cost_usd), qa=VALUES(qa), created_at=VALUES(created_at),
    storage='local', remote_error=NULL`,
  [id, lecture.course_id, lecture.module_id, lecture.class_no, rel, got, check.duration, check.width, check.height, meta.slides ?? null, meta.cost_usd ?? 0, json(meta.qa), now()]);
  await db.query("UPDATE jobs SET status='done', stage='qa', progress=100, finished_at=?, cost_usd=?, stages=? WHERE lecture_id=?",
    [now(), meta.cost_usd || 0, json(mergeStages(parse(r.stages), meta.stages)), id]);
  await db.query("UPDATE workers SET status='idle', lecture_id=NULL, jobs_done=jobs_done+1 WHERE name=?", [worker]);
  await event(id, 'info', 'qa', `validated and stored: ${rel} (${(check.duration / 60).toFixed(1)} min, ${(got / 1048576).toFixed(0)} MB)`);
  await pushJob(id); pushWorkers(true);
  broadcast('video', await videoRow(id));
  log(`stored lecture ${id} → ${rel}`);
  queueUpload(id);
  return { status: 200, body: { ok: true, path: rel } };
}

// ---- OneDrive ---------------------------------------------------------------------------
// Every validated video is uploaded to OneDrive / SharePoint (src/factory/onedrive.js) in
// the same folder structure. Once it is there the local copy is deleted (LIBRARY_KEEP_LOCAL=true
// keeps it) and the player streams from OneDrive. Two uploads at a time, 3 tries each; a
// failed upload keeps the local file and can be retried from the dashboard.
const KEEP_LOCAL = /^(1|true|yes)$/i.test(process.env.LIBRARY_KEEP_LOCAL || '');
const uploadQueue = [];
const uploading = new Map();     // lecture_id -> { done, total }
const UPLOADS_AT_ONCE = 2;

function queueUpload(id) {
  if (!onedrive.configured() || uploading.has(id) || uploadQueue.includes(id)) return;
  uploadQueue.push(id);
  pumpUploads();
}
function pumpUploads() {
  while (uploading.size < UPLOADS_AT_ONCE && uploadQueue.length) {
    const id = uploadQueue.shift();
    uploading.set(id, { done: 0, total: 0 });
    uploadOne(id).catch((e) => log(`upload ${id}: ${e.message}`)).finally(() => { uploading.delete(id); pumpUploads(); });
  }
}

async function uploadOne(id) {
  const v = await videoRow(id);
  if (!v) return;
  const file = path.join(LIBRARY, ...v.path.split('/'));
  if (!fs.existsSync(file)) {
    if (v.storage !== 'onedrive') await setStorage(id, 'failed', { remote_error: 'the local file is missing — regenerate this lecture' });
    return;
  }
  await setStorage(id, 'uploading');
  let lastPush = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const item = await onedrive.upload(file, v.path, {
        onProgress: (done, total) => {
          uploading.set(id, { done, total });
          if (Date.now() - lastPush > 1000 || done === total) { lastPush = Date.now(); broadcast('upload', { lecture_id: id, done, total }); }
        },
      });
      await db.query("UPDATE videos SET storage='onedrive', remote_id=?, remote_url=?, remote_error=NULL, uploaded_at=? WHERE lecture_id=?", [item.id, item.webUrl, now(), id]);
      if (!KEEP_LOCAL) removeFromLibrary(v.path);
      await event(id, 'info', 'qa', `uploaded to OneDrive: ${onedrive.remotePath(v.path)}${KEEP_LOCAL ? '' : ' (local copy removed)'}`);
      broadcast('video', await videoRow(id));
      log(`uploaded lecture ${id} → OneDrive`);
      return;
    } catch (e) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 15000 * attempt)); continue; }
      await setStorage(id, 'failed', { remote_error: e.message.slice(0, 2000) });
      await event(id, 'error', 'qa', `OneDrive upload failed: ${e.message.slice(0, 600)}`);
      return;
    }
  }
}

async function setStorage(id, storage, { remote_error = null } = {}) {
  await db.query('UPDATE videos SET storage=?, remote_error=? WHERE lecture_id=?', [storage, remote_error, id]);
  broadcast('video', await videoRow(id));
}

let storageInfo = { provider: 'local' };
async function loadStorageInfo() {
  if (!onedrive.configured()) { storageInfo = { provider: 'local', keepLocal: true }; return; }
  try {
    const d = await onedrive.drive();
    storageInfo = { provider: 'onedrive', site: d.siteName, library: d.driveName, root: onedrive.remotePath('').replace(/\/$/, ''), rootUrl: await onedrive.rootUrl(), keepLocal: KEEP_LOCAL, ok: true };
  } catch (e) {
    storageInfo = { provider: 'onedrive', ok: false, error: e.message, keepLocal: KEEP_LOCAL };
    log(`OneDrive: ${e.message}`);
  }
}

// status.json from the worker ('lecture/<stage>': {status,…}) folded into the dashboard's stage map.
function mergeStages(current, fromWorker) {
  const out = { ...(current || {}) };
  for (const [k, v] of Object.entries(fromWorker || {})) {
    const stage = k.replace(/^lecture\//, '');
    out[stage] = { ...(out[stage] || {}), status: v.status, gate: v.gate, errors: v.errors, warnings: v.warnings };
  }
  return out;
}

async function workerFailed(id, worker, body) {
  const r = await jobRow(id);
  if (!r) return;
  await db.query("UPDATE workers SET status='idle', lecture_id=NULL, jobs_failed=jobs_failed+? WHERE name=?", [body.cancelled ? 0 : 1, worker]);
  if (body.cancelled || r.status === 'cancelling') {
    await db.query('DELETE FROM jobs WHERE lecture_id = ?', [id]);
    await event(id, 'warn', r.stage, 'cancelled');
    await pushJob(id); pushWorkers(true);
    return;
  }
  const stages = mergeStages(parse(r.stages), body.stages);
  const failedStage = Object.entries(body.stages || {}).find(([, s]) => s.status === 'fail')?.[0]?.replace(/^lecture\//, '') || r.stage;
  const errors = (body.reviewQueue || []).flatMap((q) => q.errors || []);
  if (body.crashed && /worker pod stopped/.test(body.status || '')) {
    await db.query("UPDATE jobs SET status='queued', worker=NULL, stages=?, attempts=GREATEST(attempts-1,0) WHERE lecture_id=?", [json(stages), id]);
    await event(id, 'warn', r.stage, 'worker pod stopped; requeued — the next worker resumes from the last finished stage');
  } else if (body.crashed && r.attempts <= MAX_CRASH_RETRIES) {
    await db.query("UPDATE jobs SET status='queued', worker=NULL, stages=?, error_code='CRASHED', error_stage=?, error_message=? WHERE lecture_id=?",
      [json(stages), r.stage, String(body.status).slice(0, 2000), id]);
    await event(id, 'warn', r.stage, `crashed (${body.status}); requeued automatically`);
  } else {
    const message = errors.length ? errors.slice(0, 5).map((i) => `[${i.code}] ${i.message}`).join('\n') : String(body.status || 'failed');
    await db.query("UPDATE jobs SET status='failed', worker=NULL, stages=?, issues=?, error_code=?, error_stage=?, error_message=?, finished_at=?, cost_usd=? WHERE lecture_id=?",
      [json(stages), json(errors), body.crashed ? 'CRASHED' : 'GATE_FAILED', failedStage, message.slice(0, 4000), now(), body.cost_usd || 0, id]);
    await event(id, 'error', failedStage, `${body.crashed ? 'crashed' : `failed at ${failedStage}`}: ${message.slice(0, 1500)}`);
    if (body.error) await event(id, 'error', failedStage, body.error.slice(0, 3000));
  }
  await pushJob(id); pushWorkers(true);
}

// Lectures whose worker went quiet go back to the queue; quiet workers are marked offline.
async function sweep() {
  const cutoff = new Date(Date.now() - WORKER_LOST_S * 1000);
  const [lost] = await db.query("SELECT lecture_id, worker, attempts, stage FROM jobs WHERE status IN ('running','cancelling','validating') AND heartbeat_at < ?", [cutoff]);
  for (const j of lost) {
    if (j.attempts > MAX_CRASH_RETRIES) {
      await db.query("UPDATE jobs SET status='failed', error_code='WORKER_LOST', error_stage=?, error_message=?, worker=NULL, finished_at=? WHERE lecture_id=?",
        [j.stage, `${j.worker} stopped responding ${j.attempts} times`, now(), j.lecture_id]);
      await event(j.lecture_id, 'error', j.stage, `${j.worker} stopped responding; giving up after ${j.attempts} attempts`);
    } else {
      await db.query("UPDATE jobs SET status='queued', worker=NULL WHERE lecture_id=?", [j.lecture_id]);
      await event(j.lecture_id, 'warn', j.stage, `${j.worker} stopped responding; requeued (the next worker resumes from the last finished stage)`);
    }
    await pushJob(j.lecture_id);
  }
  await db.query("UPDATE workers SET status='offline', lecture_id=NULL WHERE last_seen < ? AND status <> 'offline'", [new Date(Date.now() - WORKER_OFFLINE_S * 1000)]);
  await db.query('DELETE FROM workers WHERE last_seen < ?', [new Date(Date.now() - 10 * 60e3)]);
  pushWorkers(true);
}

// ---- source data --------------------------------------------------------------------------

async function reloadCatalog() {
  catalog = await loadCatalog();
  log(`catalog: ${catalog.lectures.size} lectures`);
  broadcast('refresh', { what: 'catalog' });
}

async function runSync() {
  if (sync.running) return;
  sync = { ...sync, running: true, error: null, progress: { table: 'starting', done: 0, total: 0 } };
  broadcast('sync', sync);
  try {
    const counts = await syncSource({
      log,
      onProgress: (p) => {
        sync.progress = p;
        if (!sync._t || Date.now() - sync._t > 700) { sync._t = Date.now(); broadcast('sync', { ...sync, _t: undefined }); }
      },
    });
    sync = { running: false, progress: null, error: null, last: { at: new Date().toISOString(), counts } };
    await setSetting(db, 'last_sync', sync.last);
    await reloadCatalog();
  } catch (e) {
    log(`sync failed: ${e.message}`);
    sync = { ...sync, running: false, error: e.message };
  }
  broadcast('sync', { ...sync, _t: undefined });
}

async function sourceReady() {
  try {
    const conn = await (await import('mysql2/promise')).createConnection({ uri: process.env.TEXTBOOK_DB_URL });
    const [[r]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'textbook_raw'");
    await conn.end();
    return r.n > 0;
  } catch { return false; }
}

// ---- HTTP ---------------------------------------------------------------------------------

async function readJson(req) {
  let data = '';
  for await (const c of req) { data += c; if (data.length > 5e6) throw Object.assign(new Error('body too large'), { status: 413 }); }
  return data ? JSON.parse(data) : {};
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const VIDEO_COLS = 'lecture_id, course_id, module_id, class_no, path, bytes, duration_s, width, height, slides, cost_usd, created_at, storage, remote_url, remote_error, uploaded_at';
const withUpload = (v) => (uploading.has(v.lecture_id) ? { ...v, upload: uploading.get(v.lecture_id) } : v);
async function videoRow(id) {
  const [[v]] = await db.query(`SELECT ${VIDEO_COLS} FROM videos WHERE lecture_id = ?`, [id]);
  return v ? withUpload(v) : null;
}

function streamFile(req, res, file, type) {
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'content-length': size });
    fs.createReadStream(file).pipe(res);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let file = path.join(WEB, decodeURIComponent(pathname));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('dashboard not built (npm run web:build)'); return; }
  const ext = path.extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
}

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

// Dashboard data
route('GET', '/api/catalog', async () => ({ classes: catalog.classes, at: catalog.at, lectures: Object.fromEntries(catalog.lectures) }));
route('GET', '/api/state', async () => {
  const [jobs] = await db.query(`SELECT ${JOB_COLS} FROM jobs`);
  const [videos] = (await db.query(`SELECT ${VIDEO_COLS} FROM videos`)).map((x, i) => (i === 0 ? x.map(withUpload) : x));
  const [queues] = await db.query('SELECT class_no, state FROM class_queues');
  return {
    jobs: jobs.map(compact), videos, queues, workers: await workersState(),
    sync: { ...sync, _t: undefined, last: sync.last || await getSetting(db, 'last_sync') }, library: LIBRARY_HOST_HINT, storage: storageInfo,
  };
});
route('GET', '/api/jobs/:id', async ({ id }) => {
  const [[j]] = await db.query('SELECT * FROM jobs WHERE lecture_id = ?', [Number(id)]);
  const [events] = await db.query('SELECT at, level, stage, message FROM job_events WHERE lecture_id = ? ORDER BY id DESC LIMIT 300', [Number(id)]);
  return { lecture: catalog.lectures.get(Number(id)) || null, job: j ? { ...compact(j), issues: parse(j.issues) } : null, events: events.reverse(), video: await videoRow(Number(id)) };
});
route('GET', '/api/activity', async () => {
  const [rows] = await db.query('SELECT lecture_id, at, level, stage, message FROM job_events ORDER BY id DESC LIMIT 80');
  return rows;
});

// Queue control
route('POST', '/api/queue', async (_, body) => enqueue(body.scope || {}, { redo: !!body.redo, resume: !!body.start }));
route('POST', '/api/classes/:n/pause', async ({ n }) => { await setQueue(Number(n), 'paused'); return { ok: true }; });
route('POST', '/api/classes/:n/resume', async ({ n }) => { await setQueue(Number(n), 'running'); return { ok: true }; });
route('POST', '/api/unqueue', async (_, body) => {
  const ids = lecturesIn(body.scope || {}).map((l) => l.lecture_id);
  if (!ids.length) return { removed: 0 };
  const [r] = await db.query(`DELETE FROM jobs WHERE status = 'queued' AND lecture_id IN (${ids.map(() => '?').join(',')})`, ids);
  broadcast('refresh', { what: 'jobs' });
  return { removed: r.affectedRows };
});
route('POST', '/api/retry-failed', async (_, body) => {
  const ids = lecturesIn(body.scope || {}).map((l) => l.lecture_id);
  if (!ids.length) return { retried: 0 };
  const [r] = await db.query(`UPDATE jobs SET status='queued', from_stage=NULL, priority=0, attempts=0, worker=NULL, queued_at=? WHERE status = 'failed' AND lecture_id IN (${ids.map(() => '?').join(',')})`, [now(), ...ids]);
  broadcast('refresh', { what: 'jobs' });
  return { retried: r.affectedRows };
});
route('POST', '/api/jobs/:id/retry', async ({ id }, body) => {
  const r = await jobRow(Number(id));
  if (!r) return enqueue({ lecture_ids: [Number(id)] }, { redo: !!body.fresh });
  if (['queued', 'running', 'validating', 'cancelling'].includes(r.status)) throw Object.assign(new Error('this lecture is already queued or running'), { status: 409 });
  const from = body.fresh ? 'prepare' : body.from || null;
  await db.query("UPDATE jobs SET status='queued', from_stage=?, priority=?, attempts=0, worker=NULL, queued_at=?, finished_at=NULL, progress=0, stage=NULL WHERE lecture_id=?",
    [from, body.next ? await topPriority() : 0, now(), Number(id)]);
  await event(Number(id), 'info', from, `retry requested${from ? ` from ${from}` : ' (resume from the failed stage)'}`);
  await pushJob(Number(id));
  return { ok: true };
});
async function topPriority() {
  const [[m]] = await db.query("SELECT COALESCE(MAX(priority), 0) AS p FROM jobs WHERE status = 'queued'");
  return m.p + 1;
}
route('POST', '/api/jobs/:id/next', async ({ id }) => {
  await db.query("UPDATE jobs SET priority=? WHERE lecture_id=? AND status='queued'", [await topPriority(), Number(id)]);
  await pushJob(Number(id));
  return { ok: true };
});
route('POST', '/api/jobs/:id/cancel', async ({ id }) => {
  const r = await jobRow(Number(id));
  if (!r) return { ok: true };
  if (r.status === 'queued' || r.status === 'failed') await db.query('DELETE FROM jobs WHERE lecture_id = ?', [Number(id)]);
  else if (r.status === 'running') {
    await db.query("UPDATE jobs SET status='cancelling' WHERE lecture_id=?", [Number(id)]);
    await event(Number(id), 'warn', r.stage, 'cancel requested — stopping the worker');
  }
  await pushJob(Number(id));
  return { ok: true };
});
// Removes a library file and the chapter/subject/class folders it leaves empty.
function removeFromLibrary(rel) {
  const file = path.join(LIBRARY, ...rel.split('/'));
  fs.rmSync(file, { force: true });
  for (let d = path.dirname(file); d.startsWith(LIBRARY) && d !== LIBRARY; d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }   // not empty
  }
}

route('DELETE', '/api/videos/:id', async ({ id }) => {
  const [[v]] = await db.query('SELECT path, remote_id FROM videos WHERE lecture_id = ?', [Number(id)]);
  if (v) removeFromLibrary(v.path);
  if (v?.remote_id && onedrive.configured()) await onedrive.remove(v.remote_id);
  await db.query('DELETE FROM videos WHERE lecture_id = ?', [Number(id)]);
  await db.query("DELETE FROM jobs WHERE lecture_id = ? AND status IN ('done','failed')", [Number(id)]);
  broadcast('video', { lecture_id: Number(id), deleted: true });
  await pushJob(Number(id));
  return { ok: true };
});

// Workers + source
route('POST', '/api/workers/scale', async (_, body) => { const s = await k8s.setWorkerScale(body.replicas); scaleCache = { at: Date.now(), v: s }; pushWorkers(true); return s; });
route('POST', '/api/sync', async () => { runSync(); return { started: true }; });
route('POST', '/api/videos/:id/upload', async ({ id }) => { queueUpload(Number(id)); return { queued: true }; });
route('POST', '/api/uploads/retry', async () => {
  const [rows] = await db.query("SELECT lecture_id FROM videos WHERE storage IN ('failed','local')");
  rows.forEach((r) => queueUpload(r.lecture_id));
  return { queued: rows.length };
});

// Worker API
route('POST', '/api/worker/claim', async (_, __, { worker }) => { await seen(worker, null); const job = await claim(worker); return job || null; });
route('POST', '/api/worker/heartbeat', async (_, body, { worker }) => {
  await seen(worker, body.lecture_id);
  const r = await jobRow(Number(body.lecture_id));
  if (r && r.status === 'running') await db.query('UPDATE jobs SET heartbeat_at=? WHERE lecture_id=?', [now(), r.lecture_id]);
  pushWorkers();
  return { cancel: !r || r.status === 'cancelling' || r.worker !== worker };
});
route('POST', '/api/worker/events/:id', async ({ id }, body, { worker }) => { await seen(worker, Number(id)); await applyEvents(Number(id), worker, body.events || []); return { ok: true }; });
route('POST', '/api/worker/failed/:id', async ({ id }, body, { worker }) => { await workerFailed(Number(id), worker, body); return { ok: true }; });
route('POST', '/api/worker/bye', async (_, __, { worker }) => { await db.query('DELETE FROM workers WHERE name = ?', [worker]); pushWorkers(true); return { ok: true }; });

// Where the library is on the host (shown on the dashboard).
const LIBRARY_HOST_HINT = process.env.LIBRARY_HOST_PATH || LIBRARY;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const worker = req.headers['x-worker'] ? String(req.headers['x-worker']) : null;
  try {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    let m = /^\/api\/videos\/(\d+)\/file$/.exec(url.pathname);
    if (m && req.method === 'GET') {
      // Local copy while it exists (before / without the OneDrive upload); otherwise a
      // redirect to OneDrive's short-lived download URL (the player follows it, seeking works).
      const [[v]] = await db.query('SELECT path, remote_id FROM videos WHERE lecture_id = ?', [Number(m[1])]);
      const file = v && path.join(LIBRARY, ...v.path.split('/'));
      if (file && fs.existsSync(file)) return streamFile(req, res, file, 'video/mp4');
      if (v?.remote_id && onedrive.configured()) {
        res.writeHead(302, { location: await onedrive.downloadUrl(v.remote_id), 'cache-control': 'no-store' });
        return res.end();
      }
      return send(res, 404, { error: 'video not found' });
    }
    m = /^\/api\/worker\/video\/(\d+)$/.exec(url.pathname);
    if (m && req.method === 'PUT') {
      await seen(worker, Number(m[1]));
      const r = await receiveVideo(req, Number(m[1]), worker);
      return send(res, r.status, r.body);
    }
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const hit = r.re.exec(url.pathname);
        if (!hit) continue;
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
        const out = await r.fn(hit.groups || {}, body, { worker, query: url.searchParams });
        if (out === null) { res.writeHead(204); res.end(); return; }
        return send(res, 200, out);
      }
      return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    log(`! ${req.method} ${url.pathname}: ${e.stack || e.message}`);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    else res.end();
  }
});

export async function runCentral() {
  db = await waitForDb(process.env.FACTORY_DB_URL, { log });
  if (!(await sourceReady())) {
    log('source tables missing in the cluster database — copying them from SOURCE_DB_URL');
    await runSync();
  } else {
    await reloadCatalog();
  }
  sync.last = await getSetting(db, 'last_sync');
  setInterval(() => sweep().catch((e) => log(`sweep: ${e.message}`)), 20000);
  await loadStorageInfo();
  // Videos stored while OneDrive was unreachable (or the central restarted mid-upload) go up now.
  const [pending] = await db.query("SELECT lecture_id FROM videos WHERE storage IN ('local','uploading')");
  for (const p of pending) queueUpload(p.lecture_id);
  server.listen(PORT, () => log(`central listening on :${PORT} · library ${LIBRARY} · storage ${storageInfo.provider}${storageInfo.ok === false ? ' (unreachable)' : ''}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCentral();
