import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplates, loadPacks } from '../src/templates.js';
import { slideTypes, checkSlideData, requiredMarkers } from '../src/slides.js';
import { gateLecturePlan, gateNarration, gateHinglish, gateChapterPlan } from '../src/validators/generation.js';

const build = await buildTemplates();
const T = slideTypes(build).biology;
const pack = loadPacks().biology;
const codes = (issues) => issues.filter((i) => i.severity === 'error').map((i) => i.code);

// ---- G3 slide content ----------------------------------------------------------

test('G3: a correct MCQ passes', () => {
  const r = checkSlideData(T.mcq, { title: 'Quick check', question: 'Which organelle makes ATP?', options: ['Mitochondrion', 'Ribosome', 'Chloroplast', 'Golgi body'], answer: 'A', wrong: ['C'], description: 'Aerobic respiration happens in mitochondria.' });
  assert.deepEqual(codes(r.issues), []);
});

test('G3: MCQ with 3 options and the trap on the answer fails', () => {
  const r = checkSlideData(T.mcq, { title: 'Q', question: 'Which?', options: ['a', 'b', 'c'], answer: 'A', wrong: ['A'], description: 'x' });
  assert.ok(codes(r.issues).includes('RULE'));
  assert.ok(r.issues.some((i) => /exactly 4 options/.test(i.message)));
  assert.ok(r.issues.some((i) => /trap option cannot be the answer/.test(i.message)));
  assert.ok(codes(r.issues).includes('ITEM_COUNT'));
});

test('G3: word limits, unknown fields and broken LaTeX are caught', () => {
  const r = checkSlideData(T.characteristics, {
    title: 'Features',
    items: Array.from({ length: 7 }, (_, i) => ({ title: `Point ${i}`, text: 'short' })),
    extra: 'nope',
  });
  assert.ok(codes(r.issues).includes('ITEM_COUNT'));
  assert.ok(codes(r.issues).includes('UNKNOWN_FIELD'));
  const d = checkSlideData(T.definition, { title: 'T', definition: 'Speed is $\\frac{d}{t$ over time' });
  assert.ok(codes(d.issues).includes('BAD_LATEX'));
  const long = checkSlideData(T.definition, { title: 'T', definition: Array(40).fill('word').join(' ') });
  assert.ok(codes(long.issues).includes('TOO_LONG'));
});

// ---- G2 lecture plan --------------------------------------------------------------

const ctx = (over = {}) => ({
  lecture: 2, lectures: 5, sectionIds: ['s04', 's05'], pack, types: T, budget: { min: 3, max: 14 },
  images: [{ id: 'img_wide', width: 1600, height: 1200, ratio: '4:3', description: 'x' }, { id: 'img_sq', width: 1000, height: 1000, ratio: '1:1', description: 'y' }],
  ...over,
});
const slide = (slide_type, extra = {}) => ({ slide_type, title: 't', purpose: 'p', key_points: ['k'], source_refs: ['s04'], image_id: null, ...extra });

test('G2: an image-required slide without an image falls back to its image-free type', () => {
  const plan = { lecture_title: 'Transport in Plants', slides: [slide('definition'), slide('labeled_diagram'), slide('quick_revision', { source_refs: [] }), slide('mcq'), slide('definition'), slide('mcq')] };
  const r = gateLecturePlan(plan, ctx());
  const types = r.plan.slides.map((x) => x.slide_type);
  assert.equal(types[0], 'intro', 'the intro is put in front by code');
  assert.ok(types.includes('characteristics') && !types.includes('labeled_diagram'));
  assert.ok(r.issues.some((i) => i.code === 'IMAGE_FALLBACK' && i.autoFixed));
});

test('G2: invented image ids and wrong ratios are cleared, not trusted', () => {
  const plan = { lecture_title: 'Transport in Plants', slides: [slide('definition', { image_id: 'img_made_up' }), slide('mcq', { image_id: 'img_wide' }), slide('quick_revision', { source_refs: [] }), slide('mcq')] };
  const r = gateLecturePlan(plan, ctx());
  assert.equal(r.plan.slides[0].image_id, null);
  assert.equal(r.plan.slides[1].image_id, null, '4:3 does not fit the 3:4/1:1 MCQ panel');
  assert.ok(r.issues.some((i) => i.code === 'IMAGE_NOT_IN_CATALOG'));
  assert.ok(r.issues.some((i) => i.code === 'IMAGE_RATIO'));
});

test('G2: flow and count rules from pack.json', () => {
  const r = gateLecturePlan({ lecture_title: 'Transport in Plants', slides: [slide('chapter_index'), slide('definition'), slide('definition'), slide('definition'), slide('comparison', { source_refs: ['s99'] })] }, ctx());
  const c = codes(r.issues);
  for (const code of ['FLOW_NOT_HERE', 'FLOW_MISSING', 'FLOW_REPEAT', 'REF_OUTSIDE_LECTURE']) assert.ok(c.includes(code), code);
  assert.ok(r.issues.some((i) => i.code === 'MCQ_ADDED' && i.autoFixed), 'missing MCQs are appended when the budget has room');
  const first = gateLecturePlan({ lecture_title: 'Transport in Plants', slides: [slide('definition'), slide('quick_revision', { source_refs: [] }), slide('mcq'), slide('mcq')] }, ctx({ lecture: 1 }));
  assert.equal(first.plan.slides[0].slide_type, 'intro', 'the intro is added by code');
  assert.equal(first.plan.slides[1].slide_type, 'definition', 'then straight into the first topic — no roadmap slide');
  assert.ok(first.issues.some((i) => i.code === 'OPENING_FIXED' && i.autoFixed));
});

// ---- G1 chapter plan --------------------------------------------------------------------

test('G1: every section exactly once, in order, balanced', () => {
  const prepared = { sections: ['s01', 's02', 's03', 's04', 's05', 's06'].map((id) => ({ id, heading: id, words: 100 })) };
  const cfg = { curriculum: { lectures_per_chapter: 3 } };
  const L = (ids, i) => ({ index: i, title: 't', section_ids: ids, goals: ['a', 'b'], recap: i > 1 ? 'r' : null, preview: i < 3 ? 'p' : null });
  assert.deepEqual(codes(gateChapterPlan({ lectures: [L(['s01', 's02'], 1), L(['s03', 's04'], 2), L(['s05', 's06'], 3)] }, prepared, cfg).issues), []);
  const bad = gateChapterPlan({ lectures: [L(['s01', 's03'], 1), L(['s02', 's03'], 2), L(['s05'], 3)] }, prepared, cfg);
  const c = codes(bad.issues);
  for (const code of ['SECTION_REPEATED', 'SECTION_ORDER', 'SECTION_UNCOVERED']) assert.ok(c.includes(code), code);
});

// ---- G4 narration ----------------------------------------------------------------------

const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 17}`).join(' ') + '.';
const EN_OPTS = { language: 'english' };
const defData = { title: 'Osmosis', definition: 'Water moves across a membrane.', points: ['No energy needed', 'Only water crosses'] };

test('G4 (english draft): markers must all appear, once, in order', () => {
  const ok = `${words(40)} {{b1}} ${words(90)} {{b2.1}} ${words(60)} {{b2.2}} ${words(60)}`;
  assert.deepEqual(requiredMarkers(T.definition.spec, defData), ['b1', 'b2.1', 'b2.2']);
  assert.deepEqual(codes(gateNarration(ok, T.definition, defData, 'slide', EN_OPTS)), []);
  const missing = `${words(100)} {{b1}} ${words(150)} {{b2.2}} ${words(40)}`;
  assert.ok(codes(gateNarration(missing, T.definition, defData, 'slide', EN_OPTS)).includes('MARKER_MISSING'));
  const order = `${words(40)} {{b2.1}} ${words(90)} {{b1}} ${words(60)} {{b2.2}} ${words(60)}`;
  assert.ok(codes(gateNarration(order, T.definition, defData, 'slide', EN_OPTS)).includes('MARKER_ORDER'));
  const unknown = `${words(40)} {{b1}} ${words(90)} {{b2.1}} ${words(60)} {{b2.2}} ${words(30)} {{b9}} ${words(30)}`;
  assert.ok(codes(gateNarration(unknown, T.definition, defData, 'slide', EN_OPTS)).includes('MARKER_UNKNOWN'));
});

test('G4 (english draft): length, question pause, SSML and Devanagari are enforced', () => {
  const short = `${words(10)} {{b1}} ${words(10)} {{b2.1}} ${words(10)} {{b2.2}} ${words(10)}`;
  assert.ok(codes(gateNarration(short, T.definition, defData, 'slide', EN_OPTS)).includes('NARRATION_LENGTH'));
  const mcqData = { title: 'Q', question: 'Which?', options: ['a', 'b', 'c', 'd'], answer: 'A', wrong: ['B'], description: 'Because.' };
  const noPause = `${words(80)} {{b1}} ${words(80)} {{b2}} ${words(80)}`;
  assert.ok(codes(gateNarration(noPause, T.mcq, mcqData, 'slide', EN_OPTS)).includes('NO_QUESTION_PAUSE'));
  const tagged = `<break time="1s"/> ${words(80)} {{b1}} ${words(90)} {{b2.1}} ${words(50)} {{b2.2}} तो ${words(50)}`;
  const c = codes(gateNarration(tagged, T.definition, defData, 'slide', EN_OPTS));
  assert.ok(c.includes('BANNED_CONTENT'));
  assert.ok(c.includes('NOT_ENGLISH'));
});

// ---- G5 Hinglish --------------------------------------------------------------------------

const EN = 'Osmosis is the movement of water across a membrane. {{b1}} It needs no energy at all. Notice how water moves toward the concentrated side.';

test('G5: good mixed-script Hinglish passes', () => {
  const hi = 'Osmosis का मतलब है membrane के आर-पार water का movement। {{b1}} इसमें किसी energy की ज़रूरत नहीं होती। ध्यान दो, water concentrated side की तरफ़ जाता है।';
  assert.deepEqual(codes(gateHinglish(EN, hi)), []);
});

test('G5: romanized Hindi, Devanagari English, lost markers and symbols fail', () => {
  const roman = 'Osmosis ka matlab hai membrane ke paar water ka movement. {{b1}} Isme koi energy nahi lagti. Dekho water concentrated side ki taraf jata hai.';
  assert.ok(codes(gateHinglish(EN, roman)).includes('ROMANIZED_HINDI'));
  const devEng = 'ऑस्मोसिस में ब्लड और सेल की बात नहीं, वॉटर का मूवमेंट है। {{b1}} इसमें एनर्जी की ज़रूरत नहीं। पानी कंसन्ट्रेटेड साइड की तरफ़ जाता है।';
  assert.ok(codes(gateHinglish(EN, devEng)).includes('DEVANAGARI_ENGLISH'));
  const lost = 'Osmosis का मतलब है membrane के आर-पार water का movement। इसमें energy नहीं लगती। Water concentrated side की तरफ़ जाता है।';
  assert.ok(codes(gateHinglish(EN, lost)).includes('MARKERS_CHANGED'));
  const sym = 'Osmosis में $H_2O$ membrane के आर-पार जाता है। {{b1}} इसमें energy नहीं लगती। Water concentrated side की तरफ़ जाता है।';
  assert.ok(codes(gateHinglish(EN, sym)).includes('UNSPEAKABLE'));
});

// ---- G4 direct Hinglish (default mode) -------------------------------------------------------

const HI_OPTS = { language: 'hinglish', wordFactor: 1.1 };
const hiWords = (n) => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 'है' : i % 3 === 1 ? 'membrane' : 'और')).join(' ') + '।';

test('G4 (direct): well-formed Hinglish narration passes teaching and script checks together', () => {
  const text = `${hiWords(45)} {{b1}} ${hiWords(95)} {{b2.1}} ${hiWords(65)} {{b2.2}} ${hiWords(65)}`;
  assert.deepEqual(codes(gateNarration(text, T.definition, defData, 'slide', HI_OPTS)), []);
});

test('G4 (direct): romanized Hindi and missing markers fail in the same pass', () => {
  const roman = Array.from({ length: 280 }, (_, i) => ['toh', 'membrane', 'hai', 'aur', 'water', 'ka'][i % 6]).join(' ');
  const c = codes(gateNarration(`${roman} {{b1}} ${roman.slice(0, 40)}.`, T.definition, defData, 'slide', HI_OPTS));
  assert.ok(c.includes('ROMANIZED_HINDI'));
  assert.ok(c.includes('MARKER_MISSING'));
});

test('G4 (direct): the word range is scaled for Hinglish', () => {
  // 230 words: inside the English 220–320 range but under the Hinglish 242–352 range → warning, not error.
  const text = `${hiWords(40)} {{b1}} ${hiWords(70)} {{b2.1}} ${hiWords(60)} {{b2.2}} ${hiWords(58)}`;
  const issues = gateNarration(text, T.definition, defData, 'slide', HI_OPTS);
  assert.ok(issues.some((i) => i.code === 'NARRATION_LENGTH' && i.severity === 'warning' && /242/.test(i.message)));
});

test('G2: the planner must give a clean, short lecture title (it sits in every slide header)', () => {
  const slides = [slide('definition'), slide('quick_revision', { source_refs: [] }), slide('mcq'), slide('mcq')];
  assert.ok(codes(gateLecturePlan({ lecture_title: '', slides }, ctx()).issues).includes('NO_LECTURE_TITLE'));
  const long = gateLecturePlan({ lecture_title: 'Transport of water minerals and food in plants and animals explained', slides }, ctx());
  assert.ok(codes(long.issues).includes('LECTURE_TITLE_LONG'));
});

// ---- images ------------------------------------------------------------------------------

test('G2: empty image slots are filled with the figure whose description matches; unused figures fail the plan', () => {
  const images = [
    { id: 'img_ely', width: 1200, height: 1000, ratio: '1:1', kind: 'figure', description: 'This image shows an experimental setup for the electrolysis of water with two electrodes collecting gas' },
    { id: 'img_other', width: 1000, height: 1000, ratio: '1:1', kind: 'figure', description: 'This image shows a plant leaf under sunlight' },
  ];
  const s = (slide_type, extra = {}) => ({ slide_type, title: 't', purpose: 'p', key_points: ['k'], source_refs: ['s04'], image_id: null, ...extra });
  const plan = { lecture_title: 'Decomposition', slides: [
    s('mechanism', { title: 'Electrolysis of Water', purpose: 'how electrolysis splits water', key_points: ['electrodes', 'hydrogen and oxygen gas collected'] }),
    s('definition'), s('quick_revision', { source_refs: [] }), s('mcq'), s('mcq'),
  ] };
  const r = gateLecturePlan(plan, ctx({ images }));
  const mech = r.plan.slides.find((x) => x.slide_type === 'mechanism');
  assert.equal(mech.image_id, 'img_ely');
  assert.ok(r.issues.some((i) => i.code === 'IMAGE_AUTOFILLED'));
  assert.ok(!codes(r.issues).includes('IMAGES_UNUSED'));

  const none = gateLecturePlan({ lecture_title: 'X', slides: [s('definition'), s('characteristics'), s('quick_revision', { source_refs: [] }), s('mcq'), s('mcq')] }, ctx({ images }));
  assert.ok(codes(none.issues).includes('IMAGES_UNUSED'), 'figures exist but none is shown');
});

test('G2: a well-matched figure in the wrong shape keeps its slide — the type switches, figures are not swapped', () => {
  // Lecture 2853: the planner put the wide rods figure on image_points and the
  // tall electroscope on labeled_diagram. Clearing both let autofill swap them.
  const images = [
    { id: 'img_rods', width: 478, height: 199, ratio: '21:9', kind: 'figure', description: 'Rods: like charges repel and unlike charges attract' },
    { id: 'img_scope', width: 275, height: 407, ratio: '2:3', kind: 'figure', description: 'A gold leaf electroscope with metal knob and leaves' },
  ];
  const plan = { lecture_title: 'Introduction', slides: [
    slide('image_points', { title: 'Attraction and Repulsion', image_id: 'img_rods' }),
    slide('labeled_diagram', { title: 'Gold-Leaf Electroscope', image_id: 'img_scope' }),
    slide('quick_revision', { source_refs: [] }), slide('mcq'), slide('mcq'),
  ] };
  const r = gateLecturePlan(plan, ctx({ images }));
  const byTitle = Object.fromEntries(r.plan.slides.map((x) => [x.title, x]));
  assert.equal(byTitle['Attraction and Repulsion'].image_id, 'img_rods');
  assert.equal(byTitle['Attraction and Repulsion'].slide_type, 'labeled_diagram');
  assert.equal(byTitle['Gold-Leaf Electroscope'].image_id, 'img_scope');
  assert.notEqual(byTitle['Gold-Leaf Electroscope'].slide_type, 'labeled_diagram');
  assert.equal(r.issues.filter((i) => i.code === 'IMAGE_TYPE_SWITCHED').length, 2);
  assert.ok(!r.issues.some((i) => i.code === 'IMAGE_AUTOFILLED'));
});

test('images: screenshots of problems, tables and equations are not figures', async () => {
  const { isTextLike } = await import('../src/generation/prepare.js');
  assert.ok(isTextLike('This image contains a chemistry example problem regarding the calculation of mole fraction'));
  assert.ok(isTextLike('The image shows a table titled "Table 1.1: Types of Solutions"'));
  assert.ok(isTextLike('This image shows a chemical equation representing a decomposition reaction'));
  assert.ok(!isTextLike('This image shows an experimental setup for the electrolysis of water'));
  assert.ok(!isTextLike('This image shows the correct way to heat a boiling tube'));
});
