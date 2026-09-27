import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseContent, normalizeMath } from '../src/sources/content.js';
import { lectureInputs, isPlaceholderSummary } from '../src/sources/textbook.js';
import { courseLookup, parseAs } from '../src/curriculum/courses.js';
import { lectureMinutes, lectureBudget } from '../src/curriculum/index.js';
import { sectionsFromBlocks } from '../src/generation/prepare.js';
import { gateLectureInput, gatePreparedLecture, gateSlides } from '../src/validators/generation.js';
import { loadConfig, merge } from '../src/config.js';
import { loadPacks, buildTemplates } from '../src/templates.js';
import { slideTypes } from '../src/slides.js';
import { runLectureJob } from '../src/pipeline/run.js';

const cfg = loadConfig();
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const p = (...content) => ({ type: 'paragraph', content });
const para = (words, seed = 0) => p(t(Array.from({ length: words }, (_, i) => ['cells', 'divide', 'and', 'grow', 'in', 'tissues', 'of', 'plants'][(i + seed) % 8]).join(' ') + '.'));
const doc = (...content) => JSON.stringify({ type: 'doc', content });

test('content: editor JSON — headings, bold headings, image + description taken out of the text, maths', () => {
  const raw = doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('1.1 The Flower')] },
    p(t('Energy is \\(E = mc^2\\) here.')),
    { type: 'image', attrs: { src: 'https://res.cloudinary.com/x/a.png' } },
    p(),
    p(t('This image shows a flower with its parts labelled.')),
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('1. Petal: attracts insects'))] }] },
    p(t('Stamen and pistil', ['bold'])),
    p(t('The stamen makes pollen.')),
  );
  const { format, blocks } = parseContent(raw);
  assert.equal(format, 'doc');
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'text', 'image', 'heading', 'text']);
  assert.equal(blocks[1].text, 'Energy is $E = mc^2$ here.');
  assert.match(blocks[2].description, /^This image shows a flower/);
  assert.match(blocks[2].description, /Petal: attracts insects/);
  assert.ok(!blocks.some((b) => b.kind === 'text' && /This image shows/.test(b.text)), 'description is not teaching text');
  assert.equal(blocks[3].text, 'Stamen and pistil');
});

test('content: HTML string and plain text rows', () => {
  const html = JSON.stringify('<p><strong>3.3 Medical Termination&nbsp;</strong></p><p>Intentional termination of pregnancy &amp; its rules.</p><img src="https://x/y.png"><p>The image shows a chart.</p>');
  const h = parseContent(html);
  assert.equal(h.format, 'html');
  assert.deepEqual(h.blocks.map((b) => b.kind), ['heading', 'text', 'image']);
  assert.equal(h.blocks[1].text, 'Intentional termination of pregnancy & its rules.');
  assert.equal(h.blocks[2].description, 'The image shows a chart.');
  const txt = parseContent('\n\nGLOSSARY\n\nAgriculture\nThe science of cultivating the soil.');
  assert.equal(txt.format, 'text');
  assert.equal(txt.blocks[0].kind, 'heading');
  assert.equal(normalizeMath('\\[ a^2 + b^2 \\]'), '$a^2 + b^2$');
});

test('lecture inputs: order, position, neighbour summaries as recap/preview, placeholders dropped', () => {
  const S = (x) => `A proper summary of lecture ${x} that is long enough to be used as a recap.`;
  const rows = [
    { course_id: 58, module_id: 338, lecture_id: 1719, content: doc(para(50)), mini_lecture: S(3), keywords: '""' },
    { course_id: 58, module_id: 338, lecture_id: 1717, content: doc(para(50)), mini_lecture: S(1), keywords: '["flower"]' },
    { course_id: 58, module_id: 338, lecture_id: 1718, content: doc(para(50)), mini_lecture: 'The lecture covers key concepts related to [insert main topic], including definitions.', keywords: null },
  ];
  const ins = lectureInputs(rows, courseLookup({ courses: { 58: { class: 12, subject: 'Biology', pack: 'biology' } } }));
  assert.deepEqual(ins.map((i) => i.lecture_id), [1717, 1718, 1719]);
  assert.deepEqual(ins.map((i) => i.position), [{ index: 1, count: 3 }, { index: 2, count: 3 }, { index: 3, count: 3 }]);
  assert.equal(ins[0].recap, null);
  assert.equal(ins[0].preview, null, "the next lecture's summary is a placeholder");
  assert.equal(ins[1].summary, null);
  assert.equal(ins[1].summary_placeholder, true);
  assert.equal(ins[2].recap, null);
  assert.equal(ins[0].keywords[0], 'flower');
  assert.ok(isPlaceholderSummary('covers [specific topics] and more'));
  assert.ok(!isPlaceholderSummary('Plants reproduce sexually through flowers [Fig. 1.2].'));
  const unmapped = lectureInputs(rows, courseLookup({ courses: {} }));
  assert.ok(unmapped.every((i) => i.unmapped));
  assert.deepEqual(parseAs('class=12,subject=Biology,pack=biology,variant=null'), { class: 12, subject: 'Biology', pack: 'biology', variant: null });
});

test('duration scales with source words, clamped', () => {
  assert.equal(lectureMinutes(100, cfg), 8);
  assert.equal(lectureMinutes(2000, cfg), 20);
  assert.equal(lectureMinutes(15000, cfg), 25);
  const b = lectureBudget(15.5, cfg);
  assert.ok(b.min >= 4 && b.max > b.min && b.max <= 10);
});

test('sections: figure references in place, tiny sections merged, descriptions excluded from word counts', () => {
  const { blocks } = parseContent(doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('A')] }, para(120),
    { type: 'image', attrs: { src: 'https://x/1.png' } }, p(t('This image shows ' + 'word '.repeat(200))),
    { type: 'heading', attrs: { level: 2 }, content: [t('Tiny')] }, para(10),
    { type: 'heading', attrs: { level: 2 }, content: [t('B')] }, para(90, 3),
  ));
  const { sections, images } = sectionsFromBlocks(blocks, 7);
  assert.deepEqual(sections.map((s) => s.heading), ['A', 'B']);
  assert.match(sections[0].text, /\[Figure img_7_1: This image shows/);
  assert.equal(sections[0].words, 131, '120 + 10 merged words + the merged heading "Tiny"; the 200-word description does not count');
  assert.equal(images[0].id, 'img_7_1');
  assert.ok(images[0].description.split(' ').length <= 61);
});

test('G0 (lecture): unmapped course, too little source, mostly image descriptions', () => {
  const packs = loadPacks();
  assert.equal(gateLectureInput({ unmapped: true, course_id: 99 }, packs)[0].code, 'COURSE_UNMAPPED');
  const base = { class: 12, slide_language: 'english', budget: { minutes: 8 } };
  const tiny = gatePreparedLecture({ ...base, totalWords: 60, descriptionWords: 0, sections: [{ text: 'x' }], budget: { minutes: 8 } }, base);
  assert.equal(tiny[0].code, 'TOO_LITTLE_SOURCE');
  const imgy = gatePreparedLecture({ totalWords: 300, descriptionWords: 900, sections: [{ text: 'cells' }], budget: { minutes: 8 } }, base);
  assert.ok(imgy.some((i) => i.code === 'MOSTLY_IMAGE_DESCRIPTIONS'));
});

test('G3: slide language — Devanagari on an English course fails; Hindi course expects Devanagari', async () => {
  const T = slideTypes(await buildTemplates()).biology;
  const plan = [{ slide_type: 'definition', source_refs: [] }];
  const en = gateSlides([{ slide_type: 'definition', data: { title: 'Cell', definition: 'कोशिका is the unit of life.' } }], plan, T, {});
  assert.ok(en.issues.some((i) => i.code === 'SLIDE_LANGUAGE' && i.severity === 'error'));
  const hi = gateSlides([{ slide_type: 'definition', data: { title: 'कबीर की साखी', definition: 'साखी एक दोहा है।' } }], plan, T, {}, { slideLanguage: 'hindi' });
  assert.ok(!hi.issues.some((i) => i.code === 'SLIDE_LANGUAGE'));
});

test('lecture job (mock): one textbook row -> content, voice, project; resumable', { timeout: 300000 }, async () => {
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-lec-'));
  const c = merge(cfg, { llm: { provider: 'mock' }, tts: { provider: 'mock' }, paths: { jobs } });
  const blocks = [];
  for (let s = 0; s < 6; s++) blocks.push({ type: 'heading', attrs: { level: 2 }, content: [t(`1.${s + 1} Topic ${s + 1}`)] }, para(160, s), para(120, s + 2));
  const rows = [
    { course_id: 58, module_id: 338, lecture_id: 1, content: doc(...blocks), mini_lecture: 'This lecture introduces the flower and its parts in some detail for students.', keywords: null },
    { course_id: 58, module_id: 338, lecture_id: 2, content: doc(...blocks), mini_lecture: 'This lecture explains pollination and the agents that carry pollen between flowers.', keywords: null },
  ];
  const [input] = lectureInputs(rows, courseLookup({ courses: { 58: { class: 12, subject: 'Biology', pack: 'biology' } } }), { lecture: [1] });
  const logs = [];
  const r = await runLectureJob(input, { cfg: c, to: 'build', offline: true, log: (l) => logs.push(l) });
  assert.equal(r.status, 'ok', logs.join('\n'));
  const dir = path.join(jobs, 'c58', 'm338', 'l1');
  const content = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8'));
  assert.deepEqual(content.source, { course_id: 58, module_id: 338, lecture_id: 1 });
  assert.equal(content.slides[0].slide_type, 'chapter_index', 'first lecture of its chapter');
  assert.ok(fs.existsSync(path.join(dir, 'project.json')));
  const prepared = JSON.parse(fs.readFileSync(path.join(dir, 'prepared.json'), 'utf8'));
  assert.equal(prepared.lecture.preview, rows[1].mini_lecture);
  const again = [];
  await runLectureJob(input, { cfg: c, to: 'build', offline: true, log: (l) => again.push(l) });
  assert.equal(again.length, 0, 'second run reuses every stage');
  fs.rmSync(jobs, { recursive: true, force: true });
});

// ---- catalog -> courses.yaml -------------------------------------------------------------

test('catalog: class/subject/pack from the mapping tables; Science chapters and Chemistry variants classified', async () => {
  const { buildCourses, classify } = await import('../src/sources/catalog.js');
  const catalog = [
    { class_title: 'CLASS 10', class_slug: 'class-10', exam_id: 1, subject: 'SCIENCE', subject_slug: 'science', is_active: 1, course_ids: [29] },
    { class_title: 'CLASS 12', class_slug: 'class-12-pcb', exam_id: 1, subject: 'CHEMISTRY', subject_slug: 'chemistry', is_active: 1, course_ids: [65] },
    { class_title: 'CLASS 9', class_slug: 'class-9', exam_id: 1, subject: 'HINDI', subject_slug: 'hindi', is_active: 1, course_ids: [131] },
    { class_title: 'NEET-UG', class_slug: 'neet-ug', exam_id: 2, subject: 'NEET-BOTANY', subject_slug: 'neet-botany', is_active: 1, course_ids: [116] },
  ];
  const txt = (s) => doc(p(t(s)));
  const rows = [
    { course_id: 29, module_id: 91, lecture_id: 1, content: txt('Light reflection mirror lens refraction '.repeat(10)) },
    { course_id: 29, module_id: 89, lecture_id: 2, content: txt('Reproduction in plant and animal cell tissue organism '.repeat(10)) },
    { course_id: 65, module_id: 386, lecture_id: 3, content: txt('Aldehyde ketone carboxylic alcohol iupac isomer '.repeat(10)) },
    { course_id: 131, module_id: 1, lecture_id: 4, content: txt('कबीर की साखी') },
    { course_id: 999, module_id: 1, lecture_id: 5, content: txt('orphan') },
  ];
  const { courses, report } = buildCourses(catalog, rows);
  assert.equal(courses[29].pack, 'science');
  assert.equal(courses[29].modules[91].pack, 'physics');
  assert.equal(courses[29].modules[89].pack, 'biology');
  assert.equal(courses[65].pack, 'chemistry');
  assert.equal(courses[65].modules[386].variant, 'organic');
  assert.equal(courses[131].slide_language, 'hindi');
  assert.equal(courses[116].enabled, false);
  assert.deepEqual(report.unmappedCourses, [{ id: 999, lectures: 1 }]);
  assert.equal(classify('the the the', { a: ['x'], b: ['y'] }).review, true);

  // courses.yaml modules drive each lecture's pack; a Science chapter without one is blocked.
  const lookup = courseLookup({ courses });
  const ins = lectureInputs(rows.filter((r) => r.course_id === 29), lookup);
  assert.deepEqual(ins.map((i) => i.pack).sort(), ['biology', 'physics']);
  const noPack = lectureInputs([{ ...rows[0], module_id: 555 }], lookup)[0];
  assert.equal(gateLectureInput(noPack, loadPacks())[0].code, 'MODULE_PACK_UNKNOWN');
});
