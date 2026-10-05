// Summary videos (src/summary/): length and budget, the outline and part-plan
// gates, and a mock end-to-end run of a 3-lecture chapter up to the render
// project (dark theme, title card, part dividers, one voice track).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, merge } from '../src/config.js';
import { buildTemplates, loadPacks } from '../src/templates.js';
import { slideTypes } from '../src/slides.js';
import { checkContract } from '../src/contracts/index.js';
import { summaryMinutes, slidesFor } from '../src/summary/prepare.js';
import { summaryInput } from '../src/summary/input.js';
import { gateOutline, gatePartPlan } from '../src/summary/gates.js';
import { runSummaryJob } from '../src/summary/run.js';

const cfg = merge(loadConfig(), { llm: { provider: 'mock' }, tts: { provider: 'mock', cache: false } });
const T = slideTypes(await buildTemplates());
const errors = (issues) => issues.filter((i) => i.severity === 'error').map((i) => i.code);

test('summary length: the target, never longer than the lectures, never under the minimum', () => {
  assert.equal(summaryMinutes([20, 20, 20, 20], cfg), 60);
  assert.equal(summaryMinutes([12, 14, 10], cfg), 36);
  assert.equal(summaryMinutes([5, 6], cfg), 11, 'a small chapter: never longer than its lectures');
  assert.equal(summaryMinutes([30, 30, 25], cfg), 60);
  const b = slidesFor(60, cfg);
  assert.ok(b.min >= 28 && b.max <= 40, JSON.stringify(b));
});

const sections = ['L1.s01', 'L1.s02', 'L2.s01', 'L2.s02', 'L3.s01'].map((id, i) => ({ id, heading: `Heading ${i + 1}`, words: 300, lecture: Number(id[1]) }));
const lectures = [1, 2, 3].map((index) => ({ index, title: `Lecture ${index}` }));
const kp = ['a', 'b', 'c', 'd'];

test('outline gate: every section once, in order; minutes scaled to the video', () => {
  const good = { parts: [
    { title: 'One', lectures: [1], section_ids: ['L1.s01', 'L1.s02'], minutes: 20, key_points: kp, must_include: [] },
    { title: 'Two', lectures: [2], section_ids: ['L2.s01', 'L2.s02'], minutes: 20, key_points: kp, must_include: [] },
    { title: 'Three', lectures: [3], section_ids: ['L3.s01'], minutes: 10, key_points: kp, must_include: [] },
  ] };
  const r = gateOutline(good, { sections, lectures, minutes: 60, cfg });
  assert.deepEqual(errors(r.issues), []);
  assert.ok(r.issues.some((i) => i.code === 'MINUTES_SCALED'));
  assert.equal(Math.round(r.value.parts.reduce((a, p) => a + p.minutes, 0)), 60);
  assert.ok(r.value.parts.every((p) => p.budget.min > 0));
  const bad = structuredClone(good);
  bad.parts[1].section_ids = ['L2.s02', 'L2.s01'];
  bad.parts[2].section_ids = ['L1.s01'];
  const e = errors(gateOutline(bad, { sections, lectures, minutes: 60, cfg }).issues);
  assert.ok(e.includes('PART_ORDER') && e.includes('SECTION_TWICE') && e.includes('SECTIONS_UNCOVERED'), e.join());
});

test('part plan gate: ends on a recap or check; the last part ends on the chapter check (MCQs added when there is room)', () => {
  const pack = loadPacks().biology;
  const types = T.biology;
  const slide = (slide_type) => ({ slide_type, title: 'Respiration in plants', purpose: 'p', key_points: ['k'], source_refs: ['L1.s01'], image_id: null });
  const ctx = (over) => ({ part: 1, partCount: 3, sectionIds: ['L1.s01'], images: [], types, pack, budget: { min: 3, max: 8 }, cfg, final: false, ...over });
  assert.ok(errors(gatePartPlan({ slides: [slide('definition'), slide('comparison'), slide('definition')] }, ctx()).issues).includes('PART_END'));
  assert.deepEqual(errors(gatePartPlan({ slides: [slide('definition'), slide('comparison'), slide('quick_revision')] }, ctx()).issues), []);
  const fin = gatePartPlan({ slides: [slide('definition'), slide('comparison'), slide('quick_revision')] }, ctx({ final: true }));
  assert.deepEqual(errors(fin.issues), []);
  assert.deepEqual(fin.plan.slides.slice(-2).map((s) => s.slide_type), ['mcq', 'mcq']);
});

// A small chapter: three lectures of a few sections each.
const SENT = 'Living organisms need energy for every life process, and they obtain it by breaking down food in their cells through a series of controlled chemical steps.';
const lectureInput = (n) => ({
  lecture_id: 9000 + n, module_id: 777, course_id: 55, class: 10, subject: 'Science', pack: 'biology', variant: null,
  slide_language: 'english', narration_language: 'hinglish',
  chapter_title: 'Life Processes', chapter_number: 6, course_title: 'Science', title: `Part ${n} of Life`, title_from_db: true,
  chapter_lectures: ['Part 1 of Life', 'Part 2 of Life', 'Part 3 of Life'], position: { index: n, count: 3 }, format: 'doc',
  blocks: [1, 2, 3].flatMap((h) => [{ kind: 'heading', text: `Topic ${n}.${h} Nutrition and Respiration` }, { kind: 'text', text: Array(9).fill(SENT).join(' ') }]),
  keywords: [], summary: null,
});

test('summary (mock): a 3-lecture chapter -> outline, parts, content, voice, dark-theme project', { timeout: 600000 }, async () => {
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-sum-'));
  const c = merge(cfg, { paths: { jobs }, summary: { target_minutes: 20, min_minutes: 8 } });
  const input = summaryInput([3, 1, 2].map(lectureInput));
  assert.deepEqual(input.lectures.map((l) => l.position.index), [1, 2, 3]);
  const logs = [];
  const r = await runSummaryJob(input, { cfg: c, to: 'build', offline: true, log: (l) => logs.push(l) });
  const dir = path.join(jobs, 'summaries', 'c55', 'm777');
  assert.equal(r.status, 'stopped at render', logs.join('\n'));
  const content = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8'));
  assert.deepEqual(checkContract('summary-content-v1', content), []);
  assert.equal(content.slides[0].slide_type, 'summary_title');
  assert.equal(content.slides[1].slide_type, 'summary_part');
  assert.equal(content.slides.filter((s) => s.slide_type === 'summary_part').length, content.parts.length);
  assert.ok(content.parts.length >= 3);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  assert.equal(project.theme, 'dark');
  assert.equal(project.scenes[0].template, 'summary/title');
  assert.equal(project.scenes.length, content.slides.length);
  assert.ok(fs.existsSync(path.join(dir, 'voice', 'track.wav')));
  fs.rmSync(jobs, { recursive: true, force: true });
});

test('summary (mock): review findings are repaired or settled — the video is still made', { timeout: 600000 }, async () => {
  const { createLLM } = await import('../src/llm/index.js');
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-sum2-'));
  const c = merge(cfg, { paths: { jobs }, summary: { target_minutes: 20, min_minutes: 8, review_rounds: 2 } });
  const base = createLLM(c);
  const calls = [];
  // A stubborn reviewer: a part-level coverage gap that never goes away, and a
  // fact error that stays on slide 3 of part 1.
  const llm = { ...base, call: async (req) => {
    if (req.task !== 'summary-review') return base.call(req);
    calls.push(req.unit);
    const issues = [{ slide: null, code: 'COVERAGE', severity: 'error', message: 'The definition of nutrition is missing.' }];
    if (req.unit.endsWith('/P1')) issues.push({ slide: 3, code: 'FACT', severity: 'error', message: 'This statement contradicts NCERT.' });
    return { data: { issues }, usage: {}, promptHash: 'x' };
  } };
  const input = summaryInput([1, 2, 3].map(lectureInput));
  const logs = [];
  const r = await runSummaryJob(input, { cfg: c, llm, to: 'build', offline: true, log: (l) => logs.push(l) });
  assert.equal(r.status, 'stopped at render', logs.join('\n'));
  const dir = path.join(jobs, 'summaries', 'c55', 'm777');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'P1', 'reports', 'review.json'), 'utf8'));
  assert.equal(report.status, 'warn');
  assert.ok(report.issues.some((i) => i.code === 'SLIDE_DROPPED'), JSON.stringify(report.issues));
  assert.ok(report.issues.some((i) => i.code === 'REVIEW_COVERAGE' && i.severity === 'warning'));
  assert.ok(calls.filter((u) => u.endsWith('/P1')).length === 3, 'reviewed, repaired twice, then settled');
  fs.rmSync(jobs, { recursive: true, force: true });
});

test('summary (mock, factory mode): the render is handed off as pieces, labelled by part', { timeout: 600000 }, async () => {
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-sum3-'));
  const c = merge(cfg, { paths: { jobs }, summary: { target_minutes: 20, min_minutes: 8, render_piece_seconds: 120 } });
  const r = await runSummaryJob(summaryInput([1, 2, 3].map(lectureInput)), { cfg: c, distributed: true, offline: true, log: () => {} });
  assert.equal(r.status, 'render-pending');
  const plan = r.renderPlan;
  assert.ok(plan.pieces.length >= 2);
  assert.equal(plan.pieces[0].from, 0);
  assert.equal(plan.pieces.at(-1).to, plan.count);
  plan.pieces.slice(1).forEach((p, i) => assert.equal(p.from, plan.pieces[i].to, 'pieces are contiguous'));
  assert.equal(plan.pieces[0].label, 'Opening');
  assert.ok(plan.pieces.slice(1).every((p) => /^Part \d$/.test(p.label)));
  assert.ok(plan.pieces.every((p) => p.done === false));
  // Planned once: a second run of the job finds the same plan (and would join the pieces once all are done).
  const again = await runSummaryJob(summaryInput([1, 2, 3].map(lectureInput)), { cfg: c, distributed: true, offline: true, log: () => {} });
  assert.equal(again.renderPlan.key, plan.key);
  fs.rmSync(jobs, { recursive: true, force: true });
});
