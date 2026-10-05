// The summary-video pipeline: one chapter in (all of its lectures at once),
// one ~1-hour revision video out, in the dark theme.
//
//   prepare (S0) → outline (S1, the whole chapter in one call) →
//   per part, in parallel: plan (S2) → write (S3) → narrate (S4) → review (S5, + fixes) →
//   assemble (C1) → voice (A1) → build (A2) → render (R1) → qa (V1)
//
// A separate pipeline from the lecture videos (src/pipeline/run.js): its own
// prompts (prompts/summary/), gates (summary/gates.js), contract
// (summary-content-v1) and job folders (jobs/summaries/c<course>/m<module>/).
// It shares the subject templates, the per-slide content and narration gates,
// the voice, build, render and QA code. Every stage writes its output and a
// gate report; a stage whose output exists is reused, so a retry resumes;
// `from` clears that stage and everything after it.

import fs from 'node:fs';
import path from 'node:path';
import { gateReport } from '../contracts/index.js';
import { buildTemplates, loadPacks, packFor } from '../templates.js';
import { slideTypes, takesImage } from '../slides.js';
import { fitsRatio } from '../generation/prepare.js';
import { imageMatch } from '../validators/generation.js';
import { BAND_NOTES, VOICE_LANGUAGE_NAME, slideLanguageName } from '../curriculum/index.js';
import { createLLM } from '../llm/index.js';
import { imageSizeCache } from '../generation/prepare.js';
import { gateAudio, gateSync, gateVideo } from '../validators/media.js';
import { synthesizeLecture } from '../sound/index.js';
import { duration as wavDuration } from '../sound/wav.js';
import { buildProject } from '../build/project.js';
import { artAvailable } from '../generation/art.js';
import { normalizeProject, loadProject, timeline } from '../project.js';
import { piecePlan, renderPiece, joinPieces } from '../render.js';
import crypto from 'node:crypto';
import { probeAll, blackSegments, revealCheckLong } from '../qa.js';
import { JobStore } from '../pipeline/store.js';
import { prepareSummary } from './prepare.js';
import { gateSummaryInput, gatePreparedSummary } from './input.js';
import { outlineSummary } from './layers/outline.js';
import { planPart } from './layers/plan.js';
import { writePart } from './layers/write.js';
import { narratePart } from './layers/narrate.js';
import { reviewPart } from './layers/review.js';
import { partSlides, assembleSummary } from './assemble.js';

export const SUMMARY_STAGES = ['prepare', 'outline', 'plan', 'write', 'narrate', 'review', 'assemble', 'voice', 'build', 'render', 'qa'];
const GATE = { prepare: 'S0', outline: 'S1', plan: 'S2', write: 'S3', narrate: 'S4', review: 'S5', assemble: 'C1', voice: 'A1', build: 'A2', render: 'R1', qa: 'V1' };
const PART_FILES = { plan: 'plan.json', write: 'slides.json', narrate: 'narration.json', review: 'review.json' };
const FILES = { prepare: ['prepared.json'], outline: ['outline.json'], assemble: ['content.json'], voice: ['voice.json', 'voice'], build: ['project.json', 'cues.json', 'assets'], render: ['summary.mp4', 'render-plan.json', 'pieces'], qa: ['qa.json'] };
export const SUMMARY_VIDEO = 'summary.mp4';

// ---- render pieces ---------------------------------------------------------------------------
// The render is cut into pieces (render-plan.json, pieces/piece-NNN.mp4 + .done).
// In the factory (opts.distributed) the job stops after planning them and the
// central hands the pieces to any free worker (renderSummaryPiece); once all are
// done the job runs again and joins them. On the CLI the job renders them itself.

export const pieceFile = (dir, idx) => path.join(dir, 'pieces', `piece-${String(idx).padStart(3, '0')}.mp4`);
export const pieceDone = (dir, idx) => fs.existsSync(`${pieceFile(dir, idx)}.done`) && fs.existsSync(pieceFile(dir, idx));

// The part each piece starts in, for the dashboard ("Part 3").
function pieceLabels(project, plan) {
  const starts = [];
  let t = 0;
  project.scenes.forEach((s, i) => { if (i > 0) t += project.scenes[i - 1].duration - (s.transition?.duration ?? 700); starts.push({ t, part: s.data?.partNumber ? s.data.partNumber : null, divider: s.template === 'summary/part' }); });
  return plan.pieces.map((p) => {
    const at = (p.from / plan.fps) * 1000;
    let part = 0;
    for (const s of starts) { if (s.t > at) break; if (s.divider) part = s.part; }
    return { ...p, label: part ? `Part ${part}` : 'Opening' };
  });
}

async function ensureRenderPlan(store, project, cfg) {
  const key = crypto.createHash('sha256').update(JSON.stringify([project.scenes, project.audio, project.video, cfg.summary.render_piece_seconds])).digest('hex').slice(0, 16);
  const old = store.readOr('render-plan.json', null);
  if (old?.key === key) return old;
  store.remove('pieces');
  const plan = await piecePlan(project, { pieceSeconds: cfg.summary.render_piece_seconds ?? 300 });
  const out = { key, ...plan, pieces: pieceLabels(project, plan), at: new Date().toISOString() };
  store.write('render-plan.json', out);
  return out;
}

// How much memory this process may use (the container's limit), in MB; null when unlimited / unknown.
function memoryLimitMb() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      const n = Number(v);
      if (v !== 'max' && n > 0 && n < 2 ** 50) return Math.floor(n / 1048576);
    } catch { /* not this cgroup version */ }
  }
  return null;
}

// Pages per piece: as many as fit the worker's memory (measured 2026-10-05: one
// browser ~450 MB + ~400 MB per page with its encoder, + the Node processes),
// at most video.jobs (WORKER_RENDER_JOBS). A bigger server gets more automatically.
export function piecePages(cfg, { limitMb = memoryLimitMb() } = {}) {
  const S = cfg.summary;
  const max = Math.max(1, Number(S.piece_max_pages ?? cfg.video.jobs ?? 1));
  if (!limitMb) return max;
  const fit = Math.floor((limitMb * 0.85 - (S.piece_base_mb ?? 800)) / (S.piece_page_mb ?? 450));
  return Math.max(1, Math.min(max, fit));
}

const renderOpts = (cfg, opts = {}) => {
  const v = cfg.video, S = cfg.summary;
  return { jobs: opts.jobs ?? piecePages(cfg), capture: v.capture, crf: v.crf, preset: v.preset, tune: v.tune,
           threads: S.piece_encode_threads ?? v.encode_threads, lookahead: S.piece_lookahead ?? v.lookahead };
};

// One piece of a summary's render (a factory worker, src/factory/piece-job.js).
// Writes pieces/piece-NNN.mp4 and its .done marker. Returns { frames, seconds }.
export async function renderSummaryPiece({ dir, idx, cfg, jobs, onFrame }) {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'render-plan.json'), 'utf8'));
  const piece = plan.pieces.find((p) => p.idx === idx);
  if (!piece) throw new Error(`piece ${idx} is not in the render plan`);
  if (pieceDone(dir, idx)) return { frames: piece.to - piece.from, seconds: 0, already: true };
  const project = await loadProject(path.join(dir, 'project.json'));
  const out = pieceFile(dir, idx);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp.mp4`;
  fs.rmSync(tmp, { force: true });
  const r = await renderPiece(project, { from: piece.from, to: piece.to, out: tmp, ...renderOpts(cfg, { jobs }), onFrame });
  fs.renameSync(tmp, out);
  fs.writeFileSync(`${out}.done`, JSON.stringify({ ...piece, ...r, at: new Date().toISOString() }));
  return r;
}

class StageFailed extends Error {}

// Where a chapter's summary job lives.
export const summaryDir = (jobsRoot, input) => path.join(jobsRoot, 'summaries', `c${input.course_id}`, `m${input.module_id}`);

// Runs `fn` over items with at most n at a time; returns results in order.
async function limit(n, items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function runSummaryJob(input, opts) {
  const { cfg } = opts;
  const log = opts.log || ((l) => console.log(l));
  const emit = opts.onEvent || (() => {});
  const from = opts.from ? SUMMARY_STAGES.indexOf(opts.from) : -1;
  const to = opts.to ? SUMMARY_STAGES.indexOf(opts.to) : SUMMARY_STAGES.length - 1;
  if (opts.from && from < 0) throw new Error(`unknown stage "${opts.from}" (stages: ${SUMMARY_STAGES.join(', ')})`);
  if (opts.to && to < 0) throw new Error(`unknown stage "${opts.to}"`);
  const inRange = (stage) => SUMMARY_STAGES.indexOf(stage) <= to;

  const store = new JobStore(path.join(cfg.paths.jobs, 'summaries', `c${input.course_id}`), `m${input.module_id}`);
  store.write('input.json', input);
  const partDirs = () => fs.readdirSync(store.dir).filter((d) => /^P\d+$/.test(d));
  if (from >= 0) {
    for (const stage of SUMMARY_STAGES.slice(from)) {
      for (const f of FILES[stage] || []) store.remove(f);
      if (PART_FILES[stage]) for (const d of partDirs()) store.remove(`${d}/${PART_FILES[stage]}`);
      if (stage === 'outline') for (const d of partDirs()) store.remove(d);
    }
  }
  const label = `summary c${input.course_id}/m${input.module_id}`;
  // Gate: report + log line + event; throws StageFailed on 'fail'. unit: 'summary' or 'P<k>'.
  const gate = (unit, stage, issues, extra = {}) => {
    const report = gateReport(GATE[stage], unit === 'summary' ? label : `${label}/${unit}`, issues);
    store.record(unit, stage, report, extra);
    const e = report.issues.filter((i) => i.severity === 'error').length;
    const w = report.issues.length - e;
    log(`  ${report.status === 'pass' ? '✓' : report.status === 'warn' ? '!' : '✗'} ${unit.padEnd(7)} ${stage.padEnd(9)} ${GATE[stage]}${e ? `  ${e} error(s)` : ''}${w ? `  ${w} warning(s)` : ''}${extra.attempts > 1 ? `  (${extra.attempts} attempts)` : ''}`);
    emit({ type: 'gate', stage, part: unit === 'summary' ? null : unit, report, extra });
    if (report.status === 'fail') {
      for (const i of report.issues.filter((x) => x.severity === 'error').slice(0, 8)) log(`      [${i.code}] ${i.message}`);
      throw new StageFailed(`${unit} ${stage} failed ${GATE[stage]}`);
    }
    return report;
  };
  const summary = { module_id: input.module_id, unit: label, dir: store.dir };

  const build = await buildTemplates();
  const packs = loadPacks();
  const cacheRoot = path.join(path.resolve(cfg.paths.jobs), '.cache');
  const llm = opts.llm || createLLM(cfg, { cacheDir: path.join(cacheRoot, 'llm'), logFile: store.path('llm.jsonl') });

  try {
    // ---- S0 prepare --------------------------------------------------------------------
    if (!store.has('prepared.json') && inRange('prepare')) {
      emit({ type: 'stage', stage: 'prepare' });
      const pre = gateSummaryInput(input, packs);
      if (pre.some((i) => i.severity === 'error')) gate('summary', 'prepare', pre);
      const sizes = imageSizeCache(path.join(cacheRoot, 'image-sizes.json'));
      const { prepared, issues } = await prepareSummary(input, cfg, { offline: opts.offline, sizes });
      gate('summary', 'prepare', [...pre, ...issues, ...gatePreparedSummary(prepared, cfg)]);
      store.write('prepared.json', prepared);
    }
    if (!store.has('prepared.json')) return { ...summary, status: 'stopped at prepare' };
    const prepared = store.read('prepared.json');
    const G = context(prepared, { cfg, llm, build, packs });

    // ---- S1 outline: the whole chapter in one call ---------------------------------------
    if (!store.has('outline.json') && inRange('outline')) {
      emit({ type: 'stage', stage: 'outline' });
      const r = await outlineSummary(G);
      store.write('outline.draft.json', r.value);
      gate('summary', 'outline', r.issues, { attempts: r.attempts });
      store.write('outline.json', r.value);
      store.remove('outline.draft.json');
    }
    if (!store.has('outline.json')) return { ...summary, status: 'stopped at outline' };
    G.outline = store.read('outline.json');
    G.vars.part_count = G.outline.parts.length;
    const n = G.outline.parts.length;

    // ---- S2–S5 per part, in parallel -------------------------------------------------------
    const partOut = await limit(cfg.summary.part_concurrency || 3, G.outline.parts, async (_, k) => {
      try { return { ok: true, ...(await runPart(G, k, { store, gate, inRange, emit, log, cfg })) }; } catch (e) {
        if (!(e instanceof StageFailed)) throw e;
        return { ok: false, error: e.message };
      }
    });
    const failed = partOut.filter((p) => !p.ok);
    if (failed.length) throw new StageFailed(failed.map((p) => p.error).join('; '));
    if (partOut.some((p) => !p.done)) return { ...summary, status: 'stopped before assemble' };

    // ---- C1 assemble -----------------------------------------------------------------------
    if (!store.has('content.json') && inRange('assemble')) {
      emit({ type: 'stage', stage: 'assemble' });
      const gates = Object.fromEntries(Object.entries(store.readOr('status.json', {})).map(([k, v]) => [k, v.status]));
      const { content, issues } = assembleSummary(G, partOut, { gates });
      gate('summary', 'assemble', issues);
      store.write('content.json', content);
    }
    if (!store.has('content.json')) return { ...summary, status: 'stopped at assemble' };
    const content = store.read('content.json');

    // ---- A1 voice --------------------------------------------------------------------------
    if (!store.has('voice.json') && inRange('voice')) {
      emit({ type: 'stage', stage: 'voice' });
      log(`    voicing ${content.slides.length} slides (${content.narration_language}) with ${cfg.tts.provider}…`);
      let voice;
      try {
        voice = await synthesizeLecture(content, cfg, { dir: store.dir, cacheDir: opts.ttsCacheDir || path.join(cacheRoot, 'tts'), provider: opts.tts, logFile: store.path('llm.jsonl') });
      } catch (e) {
        gate('summary', 'voice', [{ code: 'TTS_FAILED', severity: 'error', path: '/', message: `${cfg.tts.provider}: ${e.message.slice(0, 300)}` }]);
      }
      const audioCfg = { ...cfg, duration: { ...cfg.duration, band: cfg.summary.band ?? cfg.duration.band } };
      gate('summary', 'voice', gateAudio(voice, audioCfg, { targetMinutes: content.minutes }).map((i) => ({ ...i, message: i.message.replace(/^lecture runs/, 'summary runs') })));
      store.write('voice.json', voice);
    }
    if (!store.has('voice.json')) return { ...summary, status: 'stopped at voice' };
    const voice = store.read('voice.json');

    // ---- A2 build (dark theme) --------------------------------------------------------------
    if (!store.has('project.json') && inRange('build')) {
      emit({ type: 'stage', stage: 'build' });
      const art = { enabled: llm.name !== 'mock' && artAvailable(cfg), cacheDir: path.join(cacheRoot, 'art'), logFile: store.path('llm.jsonl') };
      const enhance = cfg.images?.enhance?.enabled ? cfg.images.enhance : null;
      const buildCfg = { ...cfg, art: { ...cfg.art, max_per_lecture: cfg.summary.art_max ?? cfg.art?.max_per_lecture } };
      const headerTitle = `${content.title} · ${content.slide_language === 'hindi' ? 'सारांश' : 'Summary'}`;
      const built = await buildProject(content, voice, G.allTypes, buildCfg, { dir: store.dir, enhance, art, theme: cfg.summary.theme || 'dark', headerTitle });
      const { project, cues, required } = built;
      project.title = `${content.subject} · Class ${content.class} · ${content.title} · Summary`;
      const issues = [...built.issues];
      try { await normalizeProject(structuredClone(project), store.dir, 'project'); } catch (e) {
        issues.push({ code: 'PROJECT_INVALID', severity: 'error', path: '/', message: e.message });
      }
      const track = store.path('voice', 'track.wav');
      issues.push(...gateSync(project, cues, required, cfg, { trackDuration: fs.existsSync(track) ? wavDuration(fs.readFileSync(track)) : null }));
      store.write('cues.json', cues);
      gate('summary', 'build', issues);
      store.write('project.json', project);
    }
    if (!store.has('project.json')) return { ...summary, status: 'stopped at build' };

    // ---- R1 render (in pieces), V1 qa ---------------------------------------------------------
    if (!store.has(SUMMARY_VIDEO) && inRange('render')) {
      const project = await loadProject(store.path('project.json'));
      emit({ type: 'stage', stage: 'render' });
      const plan = await ensureRenderPlan(store, project, cfg);
      const missing = plan.pieces.filter((p) => !pieceDone(store.dir, p.idx));
      log(`    render: ${(plan.duration / 60000).toFixed(1)} min in ${plan.pieces.length} pieces (${plan.pieces.length - missing.length} done)`);
      if (missing.length && opts.distributed) {
        // The central spreads the pieces over the workers, then runs this job again to join them.
        return { ...summary, status: 'render-pending', renderPlan: { ...plan, pieces: plan.pieces.map((p) => ({ ...p, done: pieceDone(store.dir, p.idx) })) } };
      }
      const t0 = Date.now();
      let base = plan.pieces.filter((p) => pieceDone(store.dir, p.idx)).reduce((a, p) => a + p.to - p.from, 0);
      let last = 0;
      for (const p of missing) {
        await renderSummaryPiece({ dir: store.dir, idx: p.idx, cfg, jobs: opts.jobs, onFrame: (d) => {
          if (Date.now() - last < 2000) return; last = Date.now(); emit({ type: 'render', done: base + d, count: plan.count });
        } });
        base += p.to - p.from;
      }
      const audio = project.audio ? path.resolve(project.dir, project.audio) : null;
      await joinPieces({ files: plan.pieces.map((p) => pieceFile(store.dir, p.idx)), out: store.path(SUMMARY_VIDEO), audio: audio && fs.existsSync(audio) ? audio : null });
      gate('summary', 'render', [], { seconds: Math.round((Date.now() - t0) / 1000), frames: plan.count, pieces: plan.pieces.length });
    }
    if (!store.has(SUMMARY_VIDEO)) return { ...summary, status: 'stopped at render' };
    if (!store.has('qa.json') && inRange('qa')) {
      emit({ type: 'stage', stage: 'qa' });
      const file = store.path(SUMMARY_VIDEO);
      const project = await loadProject(store.path('project.json'));
      const probe = probeAll(file);
      const black = blackSegments(file);
      const reveals = opts.revealCheck === false ? [] : await revealCheckLong(project, store.read('cues.json'));
      gate('summary', 'qa', gateVideo(probe, { duration: timeline(project).duration / 1000, fps: project.video.fps, width: project.video.width, height: project.video.height }, { black, reveals, fadeIn: project.fadeIn, fadeOut: project.fadeOut }));
      store.write('qa.json', { duration: Number(probe.format.duration), size: Number(probe.format.size), black, reveals: reveals.length, at: new Date().toISOString() });
    }
    summary.status = store.has('qa.json') ? 'ok' : 'stopped at qa';
  } catch (e) {
    if (!(e instanceof StageFailed)) throw e;
    summary.status = e.message;
  }
  summary.reviewQueue = store.readOr('review-queue.json', []).length;
  return summary;
}

// Everything the summary layers need.
function context(prepared, { cfg, llm, build, packs }) {
  const ch = prepared.chapter;
  const pack = packFor(packs[ch.pack], ch.variant);
  const all = slideTypes(build);
  if (!pack || !all[ch.pack]) throw new Error(`templates/${ch.pack}/ has no slide types installed`);
  if (!all.summary?.summary_title || !all.summary?.summary_part) throw new Error('templates/summary/ (title + part) is missing');
  const exclude = new Set(cfg.summary.exclude_types || []);
  // The subject's slide types a summary uses: all but the excluded ones and those this variant switches off.
  const types = Object.fromEntries(Object.entries(all[ch.pack]).filter(([t]) => !exclude.has(t) && pack.types?.[t]?.max !== 0));
  const lang = ch.narration_language || 'hinglish';
  return {
    cfg, llm, prepared, pack, packId: ch.pack, types, allTypes: { ...types, ...all.summary },
    sectionById: new Map(prepared.sections.map((s) => [s.id, s])),
    sectionText: Object.fromEntries(prepared.sections.map((s) => [s.id, `${s.heading}\n${s.text}`])),
    vars: {
      class: ch.class, subject: ch.subject, chapter_title: ch.title, band_note: BAND_NOTES[prepared.band],
      pack: ch.pack, variant: ch.variant, pack_name: pack.name,
      slide_language: ch.slide_language || 'english', narration_language: lang,
      slide_language_name: slideLanguageName(ch.slide_language), voice_language_name: VOICE_LANGUAGE_NAME[lang],
      summary_minutes: prepared.budget.minutes, lecture_count: prepared.summary.lectures.length, part_count: '3–8',
      part_min: cfg.summary.parts[0], part_max: cfg.summary.parts[1],
      part_minutes_min: cfg.summary.part_minutes[0], part_minutes_max: cfg.summary.part_minutes[1],
      // Lecture-pipeline modules shared here read these.
      lectures: prepared.summary.lectures.length, lecture_minutes: prepared.budget.minutes,
    },
  };
}

// One part: plan → write → narrate → review (with fixes). Returns { plan, slides, narration, done }.
async function runPart(G, k, { store, gate, inRange, emit, log, cfg }) {
  const unit = `P${k + 1}`;
  const rel = (f) => `${unit}/${f}`;
  const step = async (stage, file, fn) => {
    if (store.has(rel(file))) return store.read(rel(file));
    if (!inRange(stage)) return null;
    emit({ type: 'stage', stage, part: unit });
    const r = await fn();
    store.write(rel(file.replace(/\.json$/, '.draft.json')), r.value);
    gate(unit, stage, r.issues, { attempts: r.attempts });
    store.write(rel(file), r.value);
    store.remove(rel(file.replace(/\.json$/, '.draft.json')));
    return r.value;
  };
  const plan = await step('plan', 'plan.json', () => planPart(G, k));
  if (!plan) return { done: false };
  let written = await step('write', 'slides.json', () => writePart(G, k, plan));
  if (!written) return { done: false };
  let slides = partSlides(G, k, written);
  let narration = await step('narrate', 'narration.json', () => narratePart(G, k, slides, plan));
  if (!narration) return { done: false };

  // Review, then repair what it finds and review again (summary.review_rounds):
  //   - every finding goes to a slide: its own, or — for part-level findings —
  //     the slide whose content it is most about;
  //   - a missing figure gets the part's best-matching unused figure (the slide
  //     switches to a figure type if it cannot show one);
  //   - flagged slides are rewritten and re-narrated; a rewrite that fails its
  //     own gate keeps the previous version.
  // After the last round, coverage / quality findings stay as warnings, and a
  // slide that is still wrong is dropped (when the part still closes properly).
  // Only an error with no slide to drop stops the video.
  if (inRange('review') && !store.has(rel('review.json'))) {
    emit({ type: 'stage', stage: 'review', part: unit });
    const maxRounds = cfg.summary.review_rounds ?? 3;
    const notes = [];
    const note = (code, message) => notes.push({ code, severity: 'warning', path: '/', message: `${unit}: ${message}`, autoFixed: true });
    for (let round = 0; ; round++) {
      const lead = slides.length - plan.slides.length;
      const r = await reviewPart(G, k, slides, narration);
      const errors = r.issues.filter((i) => i.severity === 'error');
      const bySlide = new Map();
      for (const i of errors) { const j = slideFor(G, i, slides, lead); bySlide.set(j, [...(bySlide.get(j) || []), { ...i, path: `s${String(j).padStart(2, '0')}` }]); }
      if (!errors.length || round >= maxRounds) {
        const final = settleReview(G, k, { errors, warnings: r.issues.filter((i) => i.severity !== 'error'), plan, written, narration, slides, lead, rounds: round, note, unit });
        written = final.written; narration = final.narration; slides = partSlides(G, k, written);
        store.write(rel('plan.json'), plan);
        store.write(rel('slides.json'), written);
        store.write(rel('narration.json'), narration);
        gate(unit, 'review', [...final.issues, ...notes], { rounds: round });
        store.write(rel('review.json'), { ...r.value, settled: final.summary });
        break;
      }
      const flagged = [...bySlide.keys()].sort((a, b) => a - b);
      log(`    ${unit} review: ${errors.length} finding(s) on slide(s) ${flagged.join(', ')} — repairing them (round ${round + 1})`);
      // Figures: the planner picks them, so a rewrite alone cannot add one.
      const before = new Map();
      for (const j of flagged.filter((x) => x > lead)) {
        const list = bySlide.get(j);
        if (!list.some((i) => FIGURE_FINDING.test(i.message))) continue;
        before.set(j - lead, structuredClone(plan.slides[j - lead - 1]));
        const got = attachFigure(G, k, plan, j - lead, list.map((i) => i.message).join(' '));
        if (got) note('FIGURE_ADDED', `slide ${j}: ${got}`);
      }
      const contentIdx = flagged.filter((j) => j > lead).map((j) => j - lead);
      if (contentIdx.length) {
        const w = await writePart(G, k, plan, { indices: contentIdx, initial: { issues: new Map(contentIdx.map((i) => [i, bySlide.get(i + lead)])), previous: new Map(contentIdx.map((i) => [i, written[i - 1]])) } });
        contentIdx.forEach((i, x) => {
          const bad = w.issues.some((e) => e.severity === 'error' && e.path?.startsWith(`s${String(i).padStart(2, '0')}`));
          if (bad) {
            if (before.has(i)) plan.slides[i - 1] = before.get(i);
            note('REWRITE_KEPT', `slide ${i + lead}: the rewrite broke a slide rule; kept the previous version`);
          } else written[i - 1] = w.value[x];
        });
        store.write(rel('plan.json'), plan);
        store.write(rel('slides.json'), written);
        slides = partSlides(G, k, written);
      }
      const nn = await narratePart(G, k, slides, plan, { indices: flagged, initial: { issues: bySlide, previous: new Map(flagged.map((j) => [j, narration[j - 1]])) } });
      flagged.forEach((j, x) => {
        const bad = nn.issues.some((e) => e.severity === 'error' && e.path?.startsWith(`s${String(j).padStart(2, '0')}`));
        if (bad) note('RENARRATE_KEPT', `slide ${j}: the new narration broke a narration rule; kept the previous one`);
        else narration[j - 1] = nn.value[x];
      });
      store.write(rel('narration.json'), narration);
    }
  }
  if (!store.has(rel('review.json'))) return { plan, slides, narration, done: false };
  return { plan, slides, narration, done: true };
}

// ---- review repair helpers ------------------------------------------------------------------

const FIGURE_FINDING = /\b(fig(ure)?s?\.?|diagram|image|picture|illustration|photo|graph|map)\b/i;
const FIGURE_TYPES = ['labeled_diagram', 'image_points', 'definition', 'mechanism', 'cause_effect', 'concept_intro'];
const tokens = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
const overlap = (a, b) => { const B = tokens(b); let n = 0; for (const w of tokens(a)) if (B.has(w)) n++; return n; };

// Which slide (1-based in the part's full list) a finding is about: its own
// when it names one, else the content slide its message is most about.
function slideFor(G, issue, slides, lead) {
  const m = /^s(\d+)/.exec(issue.path || '');
  const n = m ? Number(m[1]) : null;
  if (n && n >= 1 && n <= slides.length) return n;
  let best = null, score = -1;
  slides.forEach((s, i) => {
    if (i < lead) return;
    const sc = overlap(issue.message, JSON.stringify(s.data));
    if (sc > score) { best = i + 1; score = sc; }
  });
  return best || slides.length;
}

// Puts the part's best-matching unused figure on content slide idx (1-based
// in plan.slides); switches the slide to a figure type when its own type
// cannot show it. Returns what it did, or null.
function attachFigure(G, k, plan, idx, message) {
  const part = G.outline.parts[k];
  const used = new Set(plan.slides.map((s) => s.image_id).filter(Boolean));
  const s = plan.slides[idx - 1];
  const probe = { title: s.title, purpose: `${s.purpose} ${message}`, key_points: s.key_points };
  const pool = G.prepared.images.filter((im) => part.lectures.includes(im.lecture) && (im.kind || 'figure') === 'figure' && !used.has(im.id));
  const ranked = pool.map((im) => ({ im, score: imageMatch(probe, im) })).filter((x) => x.score >= 1).sort((a, b) => b.score - a.score);
  for (const { im } of ranked) {
    const own = G.types[s.slide_type];
    if (own && takesImage(own.spec) && fitsRatio(im, own.spec.ratios)) { s.image_id = im.id; return `added figure ${im.id} (${(im.description || '').slice(0, 60)})`; }
    const count = (t) => plan.slides.filter((x) => x.slide_type === t).length;
    const to = FIGURE_TYPES.find((t) => G.types[t] && takesImage(G.types[t].spec) && fitsRatio(im, G.types[t].spec.ratios) && count(t) < (G.pack.types?.[t]?.max ?? Infinity));
    if (to) { const from = s.slide_type; s.slide_type = to; s.image_id = im.id; return `switched ${from} → ${to} to show figure ${im.id} (${(im.description || '').slice(0, 60)})`; }
  }
  return null;
}

// After the last review round. Coverage, repetition, level and language
// findings stay as warnings (the slides are still correct). A slide still
// carrying a FACT or ANSWER error is dropped when the part keeps at least two
// content slides and still closes on a recap or check (and, in the last part,
// on the chapter-check questions). What cannot be settled stays an error.
const SOFT = new Set(['REVIEW_COVERAGE', 'REVIEW_REPETITION', 'REVIEW_LEVEL', 'REVIEW_LANGUAGE', 'REVIEW_OTHER']);
function settleReview(G, k, { errors, warnings, plan, written, narration, slides, lead, rounds, note }) {
  const cfg = G.cfg;
  const issues = [...warnings];
  const hard = [];
  const drop = new Set();
  for (const i of errors) {
    if (SOFT.has(i.code)) { issues.push({ ...i, severity: 'warning', message: `${i.message} (left as a warning after ${rounds} review round${rounds === 1 ? '' : 's'})` }); continue; }
    const j = slideFor(G, i, slides, lead);
    if (j > lead) drop.add(j - lead); else hard.push(i);
  }
  let out = { written, narration };
  if (drop.size) {
    const keep = plan.slides.map((_, i) => i + 1).filter((i) => !drop.has(i));
    const types = keep.map((i) => plan.slides[i - 1].slide_type);
    const Q = new Set(G.pack.questionTypes || ['mcq']);
    const ends = cfg.summary.part_end_types.filter((t) => G.types[t]);
    let trailing = 0;
    for (let i = types.length - 1; i >= 0 && Q.has(types[i]); i--) trailing++;
    const final = k === G.outline.parts.length - 1;
    const ok = keep.length >= 2 && (!ends.length || ends.includes(types.at(-1))) && (!final || trailing >= cfg.summary.final_questions);
    if (ok) {
      const reasons = errors.filter((i) => !SOFT.has(i.code));
      for (const i of [...drop].sort((a, b) => b - a)) {
        note('SLIDE_DROPPED', `slide ${i + lead} ("${plan.slides[i - 1].title}") dropped: still wrong after ${rounds} review rounds — ${reasons.map((x) => x.message).join(' | ').slice(0, 300)}`);
        plan.slides.splice(i - 1, 1);
        written.splice(i - 1, 1);
        narration.splice(i + lead - 1, 1);
      }
      out = { written, narration };
    } else {
      for (const i of errors) if (!SOFT.has(i.code)) hard.push(i);
    }
  }
  return { ...out, issues: [...issues, ...hard], summary: { rounds, dropped: drop.size && !hard.length ? [...drop] : [], softened: errors.filter((i) => SOFT.has(i.code)).length } };
}
