// Product commands: the chapter pipeline and its inspection tools.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, merge } from './config.js';
import { runChapter, runLectureJob, STAGES } from './pipeline/run.js';
import { runSummaryJob } from './summary/run.js';
import { summaryInputs } from './summary/input.js';
import { loadRows, lectureInputs, exportRows } from './sources/textbook.js';
import { courseLookup, parseAs, loadCourses } from './curriculum/courses.js';
import { loadCatalog, buildCourses, textbookRowsLite, exportCatalog } from './sources/catalog.js';
import YAML from 'yaml';
import { lectureMinutes } from './curriculum/index.js';
import { sectionsFromBlocks } from './generation/prepare.js';
import { gateLectureInput, gatePreparedLecture } from './validators/generation.js';
import { JobStore } from './pipeline/store.js';
import { buildTemplates, loadPacks, packFor } from './templates.js';
import { slideTypes, catalogLine, llmSchema } from './slides.js';
import { systemPrompt, LAYERS, slideCatalog, flowRules, typeSpecs } from './generation/prompts.js';
import { BAND_NOTES, PACKS, VOICE_LANGUAGE_NAME, slideLanguageName } from './curriculum/index.js';

// Flags shared by run/generate: config file, mocks, offline.
export function configFrom(flag, has) {
  let cfg = loadConfig(typeof flag('config', null) === 'string' ? flag('config') : null);
  const mock = has('mock');
  if (mock || has('mock-llm')) cfg = merge(cfg, { llm: { provider: 'mock' } });
  if (mock || has('mock-tts')) cfg = merge(cfg, { tts: { provider: 'mock' } });
  if (typeof flag('jobs-dir', null) === 'string') cfg = merge(cfg, { paths: { jobs: flag('jobs-dir') } });
  return cfg;
}

const lectureList = (v) => (typeof v === 'string' ? v.split(',').map(Number).filter(Boolean) : null);

export async function run(file, flag, has, { to = null } = {}) {
  const cfg = configFrom(flag, has);
  const chapter = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  console.log(`\n  ${chapter.chapter_id} · Class ${chapter.class} ${chapter.subject} · ${chapter.title}`);
  console.log(`  llm ${cfg.llm.provider}${cfg.llm.model ? ` (${cfg.llm.model})` : ''} · tts ${cfg.tts.provider} · jobs in ${cfg.paths.jobs}/\n`);
  const summary = await runChapter(chapter, {
    cfg,
    from: typeof flag('from', null) === 'string' ? flag('from') : null,
    to: to || (typeof flag('to', null) === 'string' ? flag('to') : null),
    lectures: lectureList(flag('lecture', null)),
    skip: typeof flag('skip', null) === 'string' ? flag('skip').split(',') : [],
    offline: has('offline'),
    draft: has('draft'),
    jobs: flag('jobs', undefined),
    revealCheck: !has('no-reveal-check'),
  });
  console.log(`\n  lectures: ${Object.entries(summary.lectures).map(([n, s]) => `L${n} ${s === 'ok' ? '✓' : '✗'}`).join('  ') || '—'}` +
              `${summary.stoppedAt ? `\n  stopped: ${summary.stoppedAt}` : ''}` +
              `\n  review queue: ${summary.reviewQueue} item(s) · ${path.relative(process.cwd(), summary.dir)}\n`);
  if (summary.stoppedAt || Object.values(summary.lectures).some((s) => s !== 'ok')) process.exitCode = 2;
}

// ---- textbook lectures (tutorai.textbook_raw) ---------------------------------------------

const idList = (v) => (typeof v === 'string' ? v.split(',').map(Number).filter(Number.isFinite) : null);
const sourceArg = (flag) => {
  const s = flag('source', null);
  if (typeof s !== 'string') throw new Error('--source <export.jsonl | db> is required');
  return s;
};
const filterFrom = (flag) => ({ course: idList(flag('course', null)), module: idList(flag('module', null)), lecture: idList(flag('lecture', null)) });

// One video per textbook lecture. --shard i/n splits the selection across machines.
export async function lectures(flag, has) {
  const cfg = configFrom(flag, has);
  const filter = filterFrom(flag);
  const rows = await loadRows(sourceArg(flag), filter);
  const lookup = courseLookup({ as: parseAs(typeof flag('as', null) === 'string' ? flag('as') : null) });
  let inputs = lectureInputs(rows, lookup, filter);
  // Say why a requested lecture is not produced (orphan / inactive in the course tables).
  for (const e of inputs.excluded || []) {
    if (!filter.lecture || filter.lecture.includes(e.lecture_id)) {
      if (filter.lecture) console.log(`  · skipped c${e.course_id}/m${e.module_id}/l${e.lecture_id}: ${e.reason}`);
    }
  }
  if (!filter.lecture && inputs.excluded?.length) console.log(`  · ${inputs.excluded.length} row(s) left out (orphan or inactive in the course tables)`);
  if (typeof flag('shard', null) === 'string') {
    const [k, n] = flag('shard').split('/').map(Number);
    if (!(k >= 1 && n >= 1 && k <= n)) throw new Error('--shard must look like 2/8');
    inputs = inputs.filter((_, i) => i % n === k - 1);
  }
  if (!inputs.length) throw new Error('no lectures match that selection');
  console.log(`\n  ${inputs.length} lecture(s) · llm ${cfg.llm.provider}${cfg.llm.model ? ` (${cfg.llm.model})` : ''} · tts ${cfg.tts.provider} · jobs in ${cfg.paths.jobs}/\n`);
  const results = [];
  for (const input of inputs) {
    console.log(`  ── c${input.course_id}/m${input.module_id}/l${input.lecture_id} · ${input.chapter_title} · lecture ${input.position.index}/${input.position.count}: ${input.title}`);
    const r = await runLectureJob(input, {
      cfg,
      from: typeof flag('from', null) === 'string' ? flag('from') : null,
      to: typeof flag('to', null) === 'string' ? flag('to') : null,
      skip: typeof flag('skip', null) === 'string' ? flag('skip').split(',') : [],
      offline: has('offline'), draft: has('draft'), jobs: flag('jobs', undefined), revealCheck: !has('no-reveal-check'),
    });
    results.push(r);
  }
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\n  ${ok}/${results.length} lecture(s) passed every stage run`);
  for (const r of results.filter((x) => x.status !== 'ok')) console.log(`  ✗ ${r.unit}: ${r.status}`);
  console.log();
  if (ok < results.length) process.exitCode = 2;
}

// Chapter summary videos (src/summary/): one ~1-hour revision video per
// chapter, from all of its lectures at once. --module picks the chapter(s).
export async function summaries(flag, has) {
  const cfg = configFrom(flag, has);
  const filter = filterFrom(flag);
  const rows = await loadRows(sourceArg(flag), filter);
  const lookup = courseLookup({ as: parseAs(typeof flag('as', null) === 'string' ? flag('as') : null) });
  const inputs = summaryInputs(rows, lookup, filter.module ? { module: filter.module } : {});
  if (!inputs.length) throw new Error('no chapters match that selection');
  console.log(`\n  ${inputs.length} chapter summary video(s) · llm ${cfg.llm.provider}${cfg.llm.model ? ` (${cfg.llm.model})` : ''} · tts ${cfg.tts.provider} · jobs in ${cfg.paths.jobs}/summaries/\n`);
  const results = [];
  for (const input of inputs) {
    console.log(`  ── c${input.course_id}/m${input.module_id} · ${input.chapter_title} · ${input.lectures.length} lecture(s)`);
    results.push(await runSummaryJob(input, {
      cfg,
      from: typeof flag('from', null) === 'string' ? flag('from') : null,
      to: typeof flag('to', null) === 'string' ? flag('to') : null,
      offline: has('offline'), draft: has('draft'), jobs: flag('jobs', undefined), revealCheck: !has('no-reveal-check'),
    }));
  }
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\n  ${ok}/${results.length} summary video(s) passed every stage run`);
  for (const r of results.filter((x) => x.status !== 'ok')) console.log(`  ✗ ${r.unit}: ${r.status}`);
  console.log();
  if (ok < results.length) process.exitCode = 2;
}

// Parse every row and report what would pass G0, with no LLM, TTS or network.
export async function sourceAudit(flag, has) {
  const cfg = configFrom(flag, has);
  const filter = filterFrom(flag);
  const rows = await loadRows(sourceArg(flag), filter);
  const lookup = courseLookup({ as: parseAs(typeof flag('as', null) === 'string' ? flag('as') : null) });
  const inputs = lectureInputs(rows, lookup, filter);
  const packs = loadPacks();
  const byCourse = new Map();
  const codes = new Map();
  for (const input of inputs) {
    const c = byCourse.get(input.course_id) || { lectures: 0, formats: {}, words: [], minutes: 0, images: 0, errors: 0, warnings: 0, mapped: !input.unmapped };
    const { sections, images } = sectionsFromBlocks(input.blocks, input.lecture_id);
    const words = sections.reduce((a, s) => a + s.words, 0);
    const minutes = lectureMinutes(words, cfg);
    const prepared = { totalWords: words, descriptionWords: images.reduce((a, im) => a + im.description.split(/\s+/).length, 0), sections, budget: { minutes } };
    const issues = [...gateLectureInput(input, packs), ...(input.unmapped ? [] : gatePreparedLecture(prepared, input))];
    for (const i of issues) codes.set(`${i.severity}:${i.code}`, (codes.get(`${i.severity}:${i.code}`) || 0) + 1);
    c.lectures++; c.formats[input.format] = (c.formats[input.format] || 0) + 1; c.words.push(words); c.minutes += minutes; c.images += images.length;
    c.errors += issues.some((i) => i.severity === 'error') ? 1 : 0;
    c.warnings += issues.some((i) => i.severity === 'warning') ? 1 : 0;
    byCourse.set(input.course_id, c);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)] ?? 0; };
  console.log('\n  course  mapped  lectures  median words  video hours  images  blocked  warned  formats');
  let hours = 0, blocked = 0;
  for (const [id, c] of [...byCourse.entries()].sort((a, b) => a[0] - b[0])) {
    hours += c.minutes / 60; blocked += c.errors;
    console.log(`  ${String(id).padEnd(7)} ${(c.mapped ? 'yes' : 'no').padEnd(7)} ${String(c.lectures).padStart(8)}  ${String(med(c.words)).padStart(12)}  ${(c.minutes / 60).toFixed(1).padStart(11)}  ${String(c.images).padStart(6)}  ${String(c.errors).padStart(7)}  ${String(c.warnings).padStart(6)}  ${Object.entries(c.formats).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  console.log(`\n  ${inputs.length} lectures · ~${hours.toFixed(0)} hours of video at the configured duration · ${blocked} blocked at G0`);
  const why = {};
  for (const e of inputs.excluded || []) why[e.reason] = (why[e.reason] || 0) + 1;
  if (Object.keys(why).length) console.log('  left out by the course tables:', Object.entries(why).map(([k, v]) => `${k} ×${v}`).join(' · '));
  console.log('  issues:', [...codes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(' · ') || 'none');
  const out = path.resolve(typeof flag('out', null) === 'string' ? flag('out') : 'out/source-audit.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), lectures: inputs.length, hours, courses: Object.fromEntries(byCourse), issues: Object.fromEntries(codes) }, null, 2));
  console.log(`  report: ${path.relative(process.cwd(), out)}\n`);
}

// config/courses.yaml from the catalog tables (classes, subjects,
// class_subject_mapping). Courses marked `reviewed: true` in the existing file
// are kept exactly as they are.
export async function sourceCourses(flag) {
  const catalogSrc = typeof flag('catalog', null) === 'string' ? flag('catalog') : 'db';
  const catalog = await loadCatalog(catalogSrc);
  const src = sourceArg(flag);
  const rows = src === 'db' ? await loadRows('db') : await textbookRowsLite(src);
  const { courses, report } = buildCourses(catalog, rows);
  const out = path.resolve(typeof flag('out', null) === 'string' ? flag('out') : 'config/courses.yaml');
  const existing = fs.existsSync(out) ? loadCourses(out) : {};
  let kept = 0;
  for (const [id, c] of Object.entries(existing)) if (c?.reviewed) { courses[id] = c; kept++; }
  // chapter_start is set by hand (the database cannot tell it); keep it on regeneration.
  for (const [id, c] of Object.entries(existing)) if (c?.chapter_start && courses[id] && !courses[id].reviewed) courses[id] = { ...courses[id], chapter_start: c.chapter_start };
  const header = `# Course metadata for tutorai.textbook_raw — GENERATED by \`hvr source courses\` on ${new Date().toISOString().slice(0, 10)}
# from classes + subjects + class_subject_mapping. Edit freely; set \`reviewed: true\` on a course to keep
# your edits when this file is regenerated.
#
# modules: per-chapter pack (Science) or variant (Chemistry), auto-classified from the chapter text.
#          \`review: true\` = low confidence — check these first. Courses not listed are blocked at G0.
# chapter_start: NCERT number of the book's first chapter, for books printed in parts that continue the
#          numbering (Class 12 Mathematics Part II starts at 7). Left out = 1. Kept when this file is regenerated.
# narration_language: what the voice-over is spoken in — hinglish (default), hindi (Hindi courses: taught in
#          Hindi) or english (English courses: taught in English). English and Hindi use the \`language\` pack.
#
# Not in the catalog (blocked): ${report.unmappedCourses.map((c) => `${c.id} (${c.lectures})`).join(', ') || 'none'}
`;
  fs.writeFileSync(out, `${header}\n${YAML.stringify({ courses }, { lineWidth: 0 })}`);
  const reviewLines = report.review.map((r) => `    c${r.course}/m${r.module} "${r.title}" → ${r.guess}  ${JSON.stringify(r.scores)}`);
  console.log(`\n  ✓ ${path.relative(process.cwd(), out)}: ${Object.keys(courses).length} courses (${report.mapped} enabled${kept ? `, ${kept} kept as reviewed` : ''})`);
  if (report.disabled.length) console.log(`  disabled (NEET-UG): ${report.disabled.join(', ')}`);
  if (report.emptyCourses.length) console.log(`  in catalog but no lectures: ${report.emptyCourses.join(', ')}`);
  if (report.conflicts.length) console.log(`  ! conflicting class/subject: ${JSON.stringify(report.conflicts)}`);
  console.log(`  not in catalog (stay blocked): ${report.unmappedCourses.map((c) => `${c.id}(${c.lectures})`).join(' ')} — ${report.unmappedCourses.reduce((a, c) => a + c.lectures, 0)} lectures`);
  console.log(`  chapters to review (${report.review.length}):\n${reviewLines.join('\n') || '    none'}\n`);
}

export async function sourceExport(flag) {
  const url = process.env.TEXTBOOK_DB_URL;
  if (!url) throw new Error('TEXTBOOK_DB_URL is not set (mysql://user:pass@host:port/tutorai)');
  const out = path.resolve(typeof flag('out', null) === 'string' ? flag('out') : 'out/textbook.jsonl');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const n = await exportRows(url, out, filterFrom(flag));
  console.log(`\n  ✓ ${n} rows → ${path.relative(process.cwd(), out)}`);
  const cat = path.resolve(typeof flag('catalog-out', null) === 'string' ? flag('catalog-out') : out.replace(/\.jsonl$/, '') + '.catalog.jsonl');
  console.log(`  ✓ ${await exportCatalog(url, cat)} catalog rows → ${path.relative(process.cwd(), cat)}\n`);
}

// Every chapter JSON in a folder, one after another. `--shard i/n` takes
// every n-th file starting at i (1-based), so n containers can split a
// folder with no coordination; each chapter resumes from its job dir.
export async function batch(dir, flag, has) {
  const files = fs.readdirSync(path.resolve(dir)).filter((f) => f.endsWith('.json')).sort();
  const shard = typeof flag('shard', null) === 'string' ? flag('shard').split('/').map(Number) : [1, 1];
  const [k, n] = shard;
  if (!(k >= 1 && n >= 1 && k <= n)) throw new Error('--shard must look like 2/8');
  const mine = files.filter((_, i) => i % n === k - 1);
  console.log(`\n  batch ${dir}: ${mine.length} of ${files.length} chapter(s) in shard ${k}/${n}`);
  const results = [];
  for (const f of mine) {
    try {
      await run(path.join(dir, f), flag, has);
      results.push([f, process.exitCode === 2 ? 'needs review' : 'ok']);
    } catch (e) {
      results.push([f, `error: ${e.message}`]);
      console.error(`  ✗ ${f}: ${e.message}`);
    }
    process.exitCode = 0;
  }
  console.log('\n  batch summary');
  for (const [f, r] of results) console.log(`  ${r === 'ok' ? '✓' : '✗'} ${f}  ${r === 'ok' ? '' : r}`);
  if (results.some(([, r]) => r !== 'ok')) process.exitCode = 2;
}

export function status(id, flag, has) {
  const cfg = configFrom(flag, has);
  // Chapter jobs are one folder (jobs/<chapter_id>); textbook lecture jobs are
  // nested (jobs/c29/m83/l379), addressed as "c29/m83/l379".
  const parts = String(id).split(/[\\/]/);
  const store = new JobStore(path.join(cfg.paths.jobs, ...parts.slice(0, -1)), parts.at(-1));
  if (!store.has('status.json')) throw new Error(`no job for "${id}" in ${cfg.paths.jobs}/`);
  const st = store.read('status.json');
  console.log(`\n  ${id}\n`);
  for (const [k, v] of Object.entries(st).sort(([a], [b]) => {
    const [ua, sa] = a.split('/'), [ub, sb] = b.split('/');
    return ua === ub ? STAGES.indexOf(sa) - STAGES.indexOf(sb) : ua.localeCompare(ub, 'en', { numeric: true });
  })) {
    const mark = v.status === 'pass' ? '✓' : v.status === 'warn' ? '!' : '✗';
    console.log(`  ${mark} ${k.padEnd(20)} ${v.gate.padEnd(3)} ${v.errors ? `${v.errors} err ` : ''}${v.warnings ? `${v.warnings} warn` : ''}`);
  }
  const q = store.readOr('review-queue.json', []);
  if (q.length) {
    console.log('\n  review queue:');
    for (const item of q) {
      console.log(`  ✗ ${item.unit} ${item.stage} (${item.gate})`);
      for (const e of item.errors.slice(0, 5)) console.log(`      [${e.code}] ${e.message}`);
    }
  }
  console.log();
}

export async function packs() {
  const build = await buildTemplates();
  const installed = loadPacks();
  const types = slideTypes(build);
  console.log();
  for (const [id, p] of Object.entries(PACKS)) {
    const t = types[id];
    console.log(`  ${installed[id] ? '▦' : '·'} ${id.padEnd(12)} ${p.subjects.join(', ')}${p.variants.length ? `  [variants: ${p.variants.join(', ')}]` : ''}`);
    if (!installed[id]) { console.log('      (templates not installed yet)\n'); continue; }
    for (const st of Object.values(t || {})) console.log(`    ${catalogLine(st).slice(2)}\n      → ${st.templateId}`);
    console.log();
  }
}

// Print a layer's assembled system prompt (and optionally its output schema)
// for a pack, with sample values for the chapter-specific placeholders.
export async function prompt(layer, flag, has) {
  if (!LAYERS[layer]) throw new Error(`layers: ${Object.keys(LAYERS).join(', ')}`);
  const packId = String(flag('pack', 'biology'));
  const build = await buildTemplates();
  const variant = flag('variant', null);
  const pack = packFor(loadPacks()[packId], variant);
  const all = slideTypes(build)[packId];
  if (!all || !pack) throw new Error(`pack "${packId}" is not installed`);
  // As the planner sees them: types switched off for this pack / variant (max 0) are left out.
  const types = Object.fromEntries(Object.entries(all).filter(([k]) => pack.types?.[k]?.max !== 0));
  const cls = Number(flag('class', 11));
  const vars = {
    class: cls, subject: pack.subjects?.[0] || packId, chapter_title: '<chapter title>', lectures: 5, lecture_minutes: 20,
    band_note: BAND_NOTES[cls <= 8 ? '6-8' : cls <= 10 ? '9-10' : '11-12'], pack: packId, variant,
    pack_name: pack.name, lecture: 2, lecture_title: '<lecture title>', slide_min: 10, slide_max: 14,
    // --language hinglish|hindi|english (default: the language courses speak their own language).
    narration_language: String(flag('language', variant === 'hindi' ? 'hindi' : variant === 'english' ? 'english' : 'hinglish')),
    slide_language: variant === 'hindi' ? 'hindi' : 'english',
  };
  vars.slide_language_name = slideLanguageName(vars.slide_language);
  vars.voice_language_name = VOICE_LANGUAGE_NAME[vars.narration_language];
  const extra = layer === 'slide-plan' ? [slideCatalog(types), flowRules(pack)]
    : layer === 'slide-write' ? [`# SLIDE TYPE SPECS\n\n${typeSpecs(types, packId, variant)}`] : [];
  console.log(systemPrompt(layer, vars, extra));
  if (has('schema') && layer === 'slide-write') {
    const t = String(flag('type', Object.keys(types)[0]));
    console.log(`\n\n--- data schema for ${t} ---\n${JSON.stringify(llmSchema(types[t]), null, 2)}`);
  }
}
