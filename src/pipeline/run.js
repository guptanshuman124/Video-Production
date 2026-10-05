// The pipeline: one chapter in, validated lecture videos out.
//
//   chapter stages:  prepare (G0) → chapter-plan (G1)
//   lecture stages:  slide-plan (G2) → slide-write (G3) → narrate (G4) →
//                    [hinglish (G5), via-english mode only] → review (G6) → assemble (C1) →
//                    voice (A1) → build (A2) → render → qa (V1)
//
// Every stage writes its output to the job directory and a gate report next
// to it. A stage whose output exists is reused, so a run resumes where the
// last one stopped; `from` clears that stage and everything after it. A gate
// that still fails after repair stops that lecture and lands in the review
// queue; the other lectures carry on.

import fs from 'node:fs';
import path from 'node:path';
import { gateReport } from '../contracts/index.js';
import { buildTemplates, loadPacks, packFor } from '../templates.js';
import { slideTypes } from '../slides.js';
import { BAND_NOTES } from '../curriculum/index.js';
import { createLLM } from '../llm/index.js';
import { prepareChapter, prepareLecture, imageSizeCache } from '../generation/prepare.js';
import { planChapter } from '../generation/layers/chapter-plan.js';
import { planLecture } from '../generation/layers/slide-plan.js';
import { writeSlides } from '../generation/layers/slide-write.js';
import { narrateSlides, narrationLanguage } from '../generation/layers/narrate.js';
import { toHinglish } from '../generation/layers/hinglish.js';
import { reviewLecture } from '../generation/layers/review.js';
import { assembleLecture } from '../generation/assemble.js';
import { gateInput, gatePrepared, gateLectureInput, gatePreparedLecture } from '../validators/generation.js';
import { gateAudio, gateSync, gateVideo } from '../validators/media.js';
import { synthesizeLecture } from '../sound/index.js';
import { duration as wavDuration } from '../sound/wav.js';
import { buildProject } from '../build/project.js';
import { artAvailable } from '../generation/art.js';
import { normalizeProject, loadProject, timeline } from '../project.js';
import { renderProject } from '../render.js';
import { probeAll, blackSegments, revealCheck } from '../qa.js';
import { JobStore } from './store.js';

export const CHAPTER_STAGES = ['prepare', 'chapter-plan'];
export const LECTURE_STAGES = ['slide-plan', 'slide-write', 'narrate', 'hinglish', 'review', 'assemble', 'voice', 'build', 'render', 'qa'];
export const STAGES = [...CHAPTER_STAGES, ...LECTURE_STAGES];

// Output files per stage (relative to the unit dir); removed by `from`.
const OUTPUTS = {
  prepare: ['prepared.json'], 'chapter-plan': ['chapter-plan.json'],
  'slide-plan': ['slide-plan.json'], 'slide-write': ['slides.json'], narrate: ['narration-en.json', 'narration-hi.json'],
  hinglish: ['narration-hi.json'], review: ['review.json'], assemble: ['content.json'],
  voice: ['voice.json', 'voice'], build: ['project.json', 'cues.json', 'assets'], render: ['lecture.mp4'], qa: ['qa.json'],
};
const GATE = { prepare: 'G0', 'chapter-plan': 'G1', 'slide-plan': 'G2', 'slide-write': 'G3', narrate: 'G4', hinglish: 'G5', review: 'G6', assemble: 'C1', voice: 'A1', build: 'A2', render: 'R1', qa: 'V1' };

class StageFailed extends Error {}

// Records a gate report, logs one line, and throws StageFailed on 'fail'.
function makeGate(store, unitLabel, log) {
  return (unit, stage, issues, extra) => {
    const report = gateReport(GATE[stage], unitLabel(unit), issues);
    store.record(unit, stage, report, extra);
    const e = report.issues.filter((i) => i.severity === 'error').length;
    const w = report.issues.length - e;
    log(`  ${report.status === 'pass' ? '✓' : report.status === 'warn' ? '!' : '✗'} ${unit.padEnd(7)} ${stage.padEnd(12)} ${GATE[stage]}` +
        `${e ? `  ${e} error(s)` : ''}${w ? `  ${w} warning(s)` : ''}${extra?.attempts > 1 ? `  (${extra.attempts} attempts)` : ''}`);
    if (report.status === 'fail') {
      for (const i of report.issues.filter((x) => x.severity === 'error').slice(0, 8)) log(`      [${i.code}] ${i.message}`);
      throw new StageFailed(`${unit} ${stage} failed ${GATE[stage]}`);
    }
    return report;
  };
}

// Everything the generation layers need about one prepared unit.
function layerContext(prepared, { cfg, llm, build, packs, lectures }) {
  const pack = packFor(packs[prepared.chapter.pack], prepared.chapter.variant);
  const types = slideTypes(build)[prepared.chapter.pack];
  if (!pack || !types) throw new Error(`templates/${prepared.chapter.pack}/ has no slide types installed`);
  const vars = {
    class: prepared.chapter.class, subject: prepared.chapter.subject, chapter_title: prepared.chapter.title,
    lectures, lecture_minutes: prepared.budget.minutes ?? cfg.curriculum.lecture_minutes,
    band_note: BAND_NOTES[prepared.band], pack: prepared.chapter.pack, variant: prepared.chapter.variant, pack_name: pack.name,
    slide_min: prepared.budget.min, slide_max: prepared.budget.max, slide_language: prepared.chapter.slide_language || 'english',
  };
  const sectionText = Object.fromEntries(prepared.sections.map((x) => [x.id, `${x.heading}\n${x.text}`]));
  return { cfg, llm, prepared, pack, packId: prepared.chapter.pack, types, sectionText, lectures, vars };
}

export async function runChapter(chapter, opts) {
  const { cfg } = opts;
  const log = opts.log || ((l) => console.log(l));
  const from = opts.from ? STAGES.indexOf(opts.from) : -1;
  const to = opts.to ? STAGES.indexOf(opts.to) : STAGES.length - 1;
  if (opts.from && from < 0) throw new Error(`unknown stage "${opts.from}" (stages: ${STAGES.join(', ')})`);
  if (opts.to && to < 0) throw new Error(`unknown stage "${opts.to}"`);
  const skip = new Set(opts.skip || []);
  const inRange = (stage) => STAGES.indexOf(stage) <= to && !skip.has(stage);

  const store = new JobStore(cfg.paths.jobs, chapter.chapter_id || 'unknown');
  store.write('input.json', chapter);
  const lecturesAll = Array.from({ length: cfg.curriculum.lectures_per_chapter }, (_, i) => i + 1);
  const selected = opts.lectures?.length ? opts.lectures : lecturesAll;

  // `from`: clear that stage and everything downstream.
  if (from >= 0) {
    for (const stage of STAGES.slice(from)) {
      if (CHAPTER_STAGES.includes(stage)) OUTPUTS[stage].forEach((f) => store.remove(f));
      else for (const n of (CHAPTER_STAGES.includes(opts.from) ? lecturesAll : selected)) OUTPUTS[stage].forEach((f) => store.remove(`L${n}/${f}`));
    }
  }

  const gate = makeGate(store, (unit) => (unit === 'chapter' ? chapter.chapter_id : `${chapter.chapter_id}/${unit}`), log);

  const build = await buildTemplates();
  const packs = loadPacks();
  const llm = opts.llm || createLLM(cfg, { cacheDir: path.join(store.root, '.cache', 'llm'), logFile: store.path('llm.jsonl') });
  const summary = { chapter: chapter.chapter_id, lectures: {} };

  // ---- chapter stages ------------------------------------------------------------
  try {
    if (!store.has('prepared.json') && inRange('prepare')) {
      const pre = gateInput(chapter, packs);
      if (pre.some((i) => i.severity === 'error')) gate('chapter', 'prepare', pre);
      const { prepared, issues } = await prepareChapter(chapter, cfg, { offline: opts.offline });
      gate('chapter', 'prepare', [...pre, ...issues, ...gatePrepared(prepared, cfg)]);
      store.write('prepared.json', prepared);
    }
    if (!store.has('prepared.json')) return { ...summary, stoppedAt: 'prepare' };
    const prepared = store.read('prepared.json');
    const G0 = layerContext(prepared, { cfg, llm, build, packs, lectures: cfg.curriculum.lectures_per_chapter });
    const baseVars = G0.vars;

    if (!store.has('chapter-plan.json') && inRange('chapter-plan')) {
      const r = await planChapter(G0);
      store.write('chapter-plan.draft.json', r.value);
      gate('chapter', 'chapter-plan', r.issues, { attempts: r.attempts });
      store.write('chapter-plan.json', r.value);
      store.remove('chapter-plan.draft.json');
    }
    if (!store.has('chapter-plan.json')) return { ...summary, stoppedAt: 'chapter-plan' };
    const chapterPlan = store.read('chapter-plan.json');

    // ---- lecture stages ------------------------------------------------------------
    for (const n of selected) {
      const lecture = chapterPlan.lectures[n - 1];
      if (!lecture) continue;
      const G = { ...G0, lecture, vars: { ...baseVars, lecture: n, lecture_title: lecture.title } };
      const unit = `L${n}`;
      const rel = (f) => `${unit}/${f}`;
      const dir = store.unitDir(n);
      try {
        await runLecture({ G, store, unit, rel, dir, cfg, gate, inRange, opts, log });
        summary.lectures[n] = 'ok';
      } catch (e) {
        if (!(e instanceof StageFailed)) throw e;
        summary.lectures[n] = e.message;
      }
    }
  } catch (e) {
    if (!(e instanceof StageFailed)) throw e;
    summary.stoppedAt = e.message;
  }
  summary.reviewQueue = store.readOr('review-queue.json', []).length;
  summary.dir = store.dir;
  return summary;
}

// One textbook lecture (sources/textbook.js) -> one video. The lecture split
// already exists in the data, so there is no chapter-plan step: prepare, then
// the shared lecture stages. Jobs live in jobs/c<course>/m<module>/l<lecture>/.
export async function runLectureJob(input, opts) {
  const { cfg } = opts;
  const log = opts.log || ((l) => console.log(l));
  const stages = STAGES.filter((x) => x !== 'chapter-plan');
  const from = opts.from ? stages.indexOf(opts.from) : -1;
  const to = opts.to ? stages.indexOf(opts.to) : stages.length - 1;
  if (opts.from && from < 0) throw new Error(`unknown stage "${opts.from}" (stages: ${stages.join(', ')})`);
  if (opts.to && to < 0) throw new Error(`unknown stage "${opts.to}"`);
  const skip = new Set(opts.skip || []);
  const inRange = (stage) => stages.indexOf(stage) <= to && !skip.has(stage);

  const store = new JobStore(path.join(cfg.paths.jobs, `c${input.course_id}`, `m${input.module_id}`), `l${input.lecture_id}`);
  store.write('input.json', input);
  if (from >= 0) for (const stage of stages.slice(from)) OUTPUTS[stage].forEach((file) => store.remove(file));
  const label = `c${input.course_id}/m${input.module_id}/l${input.lecture_id}`;
  // opts.onEvent({type:'stage'|'gate'|'render', …}): live progress for a
  // caller such as the factory worker. Gate events carry the full report.
  const emit = opts.onEvent || (() => {});
  const gate0 = makeGate(store, () => label, log);
  const gate = (unit, stage, issues, extra) => {
    try {
      const r = gate0(unit, stage, issues, extra);
      emit({ type: 'gate', stage, report: r, extra });
      return r;
    } catch (e) {
      emit({ type: 'gate', stage, report: store.readOr(`reports/${stage}.json`, null), extra });
      throw e;
    }
  };
  const summary = { lecture_id: input.lecture_id, unit: label, dir: store.dir };

  const build = await buildTemplates();
  const packs = loadPacks();
  const cacheRoot = path.join(path.resolve(cfg.paths.jobs), '.cache');
  const llm = opts.llm || createLLM(cfg, { cacheDir: path.join(cacheRoot, 'llm'), logFile: store.path('llm.jsonl') });
  try {
    if (!store.has('prepared.json') && inRange('prepare')) {
      emit({ type: 'stage', stage: 'prepare' });
      const pre = gateLectureInput(input, packs);
      if (pre.some((i) => i.severity === 'error')) gate('lecture', 'prepare', pre);
      const sizes = imageSizeCache(path.join(cacheRoot, 'image-sizes.json'));
      const { prepared, issues } = await prepareLecture(input, cfg, { offline: opts.offline, sizes });
      gate('lecture', 'prepare', [...pre, ...issues, ...gatePreparedLecture(prepared, input)]);
      store.write('prepared.json', prepared);
    }
    if (!store.has('prepared.json')) return { ...summary, status: 'stopped at prepare' };
    const prepared = store.read('prepared.json');
    const L = prepared.lecture;
    const base = layerContext(prepared, { cfg, llm, build, packs, lectures: L.position.count });
    const G = {
      ...base,
      targetMinutes: prepared.budget.minutes,
      lecture: {
        index: L.position.index, title: L.title, section_ids: prepared.sections.map((x) => x.id),
        goals: L.keywords || [], summary: L.summary, recap: L.recap, preview: L.preview,
      },
      vars: { ...base.vars, lecture: L.position.index, lecture_title: L.title },
    };
    await runLecture({ G, store, unit: 'lecture', rel: (file) => file, dir: store.dir, cfg, gate, inRange, opts, log, emit });
    summary.status = 'ok';
  } catch (e) {
    if (!(e instanceof StageFailed)) throw e;
    summary.status = e.message;
  }
  summary.reviewQueue = store.readOr('review-queue.json', []).length;
  return summary;
}

async function runLecture({ G, store, unit, rel, dir, cfg, gate, inRange, opts, log, emit = () => {} }) {
  const step = async (stage, file, fn) => {
    if (store.has(rel(file))) return store.read(rel(file));
    if (!inRange(stage)) return null;
    emit({ type: 'stage', stage });
    const r = await fn();
    store.write(rel(file.replace(/\.json$/, '.draft.json')), r.value);   // inspectable even if the gate fails
    gate(unit, stage, r.issues, { attempts: r.attempts });
    store.write(rel(file), r.value);
    store.remove(rel(file.replace(/\.json$/, '.draft.json')));
    return r.value;
  };

  const plan = await step('slide-plan', 'slide-plan.json', () => planLecture(G));
  if (!plan) return;
  const slides = await step('slide-write', 'slides.json', () => writeSlides(G, plan));
  if (!slides) return;
  // direct (default): the narrator writes Hinglish itself — one LLM step.
  // via-english: English draft, then the Hinglish conversion step.
  const direct = narrationLanguage(cfg) === 'hinglish';
  let english = null;
  let hinglish;
  if (direct) {
    hinglish = await step('narrate', 'narration-hi.json', () => narrateSlides(G, plan, slides));
  } else {
    english = await step('narrate', 'narration-en.json', () => narrateSlides(G, plan, slides));
    if (!english) return;
    hinglish = await step('hinglish', 'narration-hi.json', () => toHinglish(G, english));
  }
  if (!hinglish) return;
  // Review, and fix what it finds: slides the reviewer flags are rewritten
  // (content, then narration) with its findings as repair notes, re-checked by
  // G3/G4, and the lecture is reviewed again — up to llm.review_repair_rounds.
  // Only what still fails after that goes to the review queue.
  if (inRange('review') && !store.has(rel('review.json'))) {
    emit({ type: 'stage', stage: 'review' });
    const maxRounds = cfg.llm.review_repair_rounds ?? 1;
    for (let round = 0; ; round++) {
      const r = await reviewLecture(G, plan, slides, english || hinglish);
      const errors = r.issues.filter((i) => i.severity === 'error');
      const bySlide = new Map();
      for (const i of errors) {
        const m = /^s(\d+)/.exec(i.path || '');
        if (m) bySlide.set(Number(m[1]), [...(bySlide.get(Number(m[1])) || []), i]);
      }
      const targetable = errors.length && errors.every((i) => /^s\d+/.test(i.path || ''));
      if (!errors.length || round >= maxRounds || !targetable) {
        gate(unit, 'review', r.issues, { rounds: round });
        store.write(rel('review.json'), r.value);
        break;
      }
      const indices = [...bySlide.keys()].sort((a, b) => a - b);
      log(`    review: ${errors.length} finding(s) on slide(s) ${indices.join(', ')} — rewriting them (round ${round + 1})`);
      const w = await writeSlides(G, plan, { indices, initial: { issues: bySlide, previous: new Map(indices.map((i) => [i, slides[i - 1]])) } });
      if (w.issues.some((i) => i.severity === 'error')) gate(unit, 'slide-write', w.issues);
      indices.forEach((i, k) => { slides[i - 1] = w.value[k]; });
      store.write(rel('slides.json'), slides);
      const voiced = english || hinglish;
      const n = await narrateSlides(G, plan, slides, { indices, initial: { issues: bySlide, previous: new Map(indices.map((i) => [i, voiced[i - 1]])) } });
      if (n.issues.some((i) => i.severity === 'error')) gate(unit, 'narrate', n.issues);
      indices.forEach((i, k) => { voiced[i - 1] = n.value[k]; });
      if (english) {
        store.write(rel('narration-en.json'), english);
        const h = await toHinglish(G, english);
        if (h.issues.some((i) => i.severity === 'error')) gate(unit, 'hinglish', h.issues);
        hinglish = h.value;
      }
      store.write(rel('narration-hi.json'), hinglish);
    }
  }
  if (!store.has(rel('content.json')) && inRange('assemble')) {
    emit({ type: 'stage', stage: 'assemble' });
    const gates = Object.fromEntries(['slide-plan', 'slide-write', 'narrate', 'hinglish', 'review']
      .filter((s) => store.has(rel(`reports/${s}.json`))).map((s) => [s, store.read(rel(`reports/${s}.json`)).status]));
    const { content, issues } = assembleLecture(G, { plan, slides, english, hinglish, gates, promptHashes: {} });
    gate(unit, 'assemble', issues);
    store.write(rel('content.json'), content);
  }
  if (!store.has(rel('content.json'))) return;
  const content = store.read(rel('content.json'));

  // ---- voice → build → render → qa ---------------------------------------------------
  if (!store.has(rel('voice.json')) && inRange('voice')) {
    emit({ type: 'stage', stage: 'voice' });
    log(`    voicing ${content.slides.length} slides with ${cfg.tts.provider}…`);
    let voice;
    try {
      // opts.ttsCacheDir: the factory keeps clips inside the job folder, so they go when it does.
      voice = await synthesizeLecture(content, cfg, { dir, cacheDir: opts.ttsCacheDir || path.join(path.resolve(cfg.paths.jobs), '.cache', 'tts'), provider: opts.tts, logFile: store.path(rel('llm.jsonl')) });
    } catch (e) {
      // A provider failure after all retries: record it for this lecture
      // (review queue) instead of stopping the whole run. Clips already made
      // are cached, so a re-run only pays for what is missing.
      gate(unit, 'voice', [{ code: 'TTS_FAILED', severity: 'error', path: '/', message: `${cfg.tts.provider}: ${e.message.slice(0, 300)}` }]);
    }
    gate(unit, 'voice', gateAudio(voice, cfg, { targetMinutes: G.targetMinutes }));
    store.write(rel('voice.json'), voice);
  }
  if (!store.has(rel('voice.json'))) return;
  const voice = store.read(rel('voice.json'));

  if (!store.has(rel('project.json')) && inRange('build')) {
    emit({ type: 'stage', stage: 'build' });
    // Pictures only with a real text model (mock runs and tests stay offline) and an API key.
    const art = { enabled: G.llm.name !== 'mock' && artAvailable(cfg), cacheDir: path.join(path.resolve(cfg.paths.jobs), '.cache', 'art'), logFile: store.path(rel('llm.jsonl')) };
    const enhance = cfg.images?.enhance?.enabled ? cfg.images.enhance : null;
    const built = await buildProject(content, voice, G.types, cfg, { dir, enhance, art });
    const { project, cues, required } = built;
    const issues = [...built.issues];
    try { await normalizeProject(structuredClone(project), dir, 'project'); } catch (e) {
      issues.push({ code: 'PROJECT_INVALID', severity: 'error', path: '/', message: e.message });
    }
    const track = path.join(dir, 'voice', 'track.wav');
    issues.push(...gateSync(project, cues, required, cfg, { trackDuration: fs.existsSync(track) ? wavDuration(fs.readFileSync(track)) : null }));
    store.write(rel('cues.json'), cues);
    gate(unit, 'build', issues);
    store.write(rel('project.json'), project);
  }
  if (!store.has(rel('project.json'))) return;

  if (!store.has(rel('lecture.mp4')) && inRange('render')) {
    const project = await loadProject(store.path(rel('project.json')));
    emit({ type: 'stage', stage: 'render' });
    log(`    rendering ${(timeline(project).duration / 60000).toFixed(1)} min…`);
    const v = cfg.video;
    let last = 0;
    const r = await renderProject(project, {
      out: store.path(rel('lecture.mp4')), jobs: opts.jobs ?? v.jobs, capture: v.capture, crf: v.crf, preset: v.preset, tune: v.tune,
      threads: v.encode_threads, lookahead: v.lookahead,
      draft: !!opts.draft,
      onFrame: (done, count) => {
        if (Date.now() - last < 2000 && done < count) return;
        last = Date.now();
        emit({ type: 'render', done, count });
      },
    });
    gate(unit, 'render', [], { seconds: Math.round(r.seconds), frames: r.count, shot: r.captured });
  }
  if (!store.has(rel('lecture.mp4'))) return;

  if (!store.has(rel('qa.json')) && inRange('qa')) {
    emit({ type: 'stage', stage: 'qa' });
    const file = store.path(rel('lecture.mp4'));
    const project = await loadProject(store.path(rel('project.json')));
    const probe = probeAll(file);
    const black = blackSegments(file);
    const reveals = opts.revealCheck === false ? [] : await revealCheck(project, store.read(rel('cues.json')));
    const issues = gateVideo(probe, {
      duration: timeline(project).duration / 1000, fps: project.video.fps, width: project.video.width, height: project.video.height,
    }, { black, reveals, fadeIn: project.fadeIn, fadeOut: project.fadeOut });
    gate(unit, 'qa', issues);
    store.write(rel('qa.json'), { duration: Number(probe.format.duration), size: Number(probe.format.size), black, reveals: reveals.length, at: new Date().toISOString() });
  }
}
