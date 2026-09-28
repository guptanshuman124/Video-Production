// Generation gates. Each takes a layer's output plus context and returns
// issues (and, where a rule-based fix is safe, the fixed output). Issue
// shape: { code, severity: 'error' | 'warning', path, message, autoFixed? }.
//
//   G0 input · G1 chapter plan · G2 lecture plan · G3 slide content
//   G4 English narration · G5 Hinglish narration · G6 reviewer findings

import { checkContract } from '../contracts/index.js';
import { packIssues } from '../curriculum/index.js';
import { checkSlideData, requiredMarkers, markersIn, needsImage, takesImage } from '../slides.js';
import { fitsRatio } from '../generation/prepare.js';
import {
  wordCount, sentences, scriptShare, romanHindiHits, devEnglishHits, formalHindiHits, longestSharedRun, slideStrings, issue,
} from './text.js';

const pct = (a, b) => (b ? Math.abs(a - b) / b : 0);

// ---- G0 input ----------------------------------------------------------------------

export function gateInput(chapter, installedPacks) {
  const issues = checkContract('chapter-input', chapter);
  if (!issues.length) issues.push(...packIssues(chapter, installedPacks));
  return issues;
}

// G0 for a textbook lecture: before any LLM spend, is this row usable?
export function gateLectureInput(input, installedPacks) {
  if (input.unmapped) {
    return [issue('COURSE_UNMAPPED', 'error', '/course_id', `course ${input.course_id} is not in config/courses.yaml — class, subject and pack unknown`)];
  }
  if (!input.pack) {
    return [issue('MODULE_PACK_UNKNOWN', 'error', '/pack', `chapter ${input.module_id} of course ${input.course_id} has no pack (Science chapters need physics / chemistry / biology in courses.yaml modules)`)];
  }
  const issues = checkContract('lecture-input', input);
  if (!issues.length) issues.push(...packIssues(input, installedPacks));
  if (input.pack_review) issues.push(issue('PACK_NEEDS_REVIEW', 'warning', '/pack', `chapter ${input.module_id}: pack/variant "${input.pack}${input.variant ? `/${input.variant}` : ''}" was auto-classified with low confidence — confirm it in config/courses.yaml`));
  if (!input.blocks?.length) issues.push(issue('NO_CONTENT', 'error', '/blocks', 'the lecture has no readable content'));
  if (input.format === 'text') issues.push(issue('PLAIN_TEXT_SOURCE', 'warning', '/content', 'content is plain text (no headings or images); sections are cut by paragraph'));
  if (input.summary_placeholder) issues.push(issue('SUMMARY_PLACEHOLDER', 'warning', '/mini_lecture', 'mini_lecture is an unfilled template ("[insert …]"); ignored — no summary, and neighbours get no recap/preview from it'));
  return issues;
}

export function gatePreparedLecture(prepared, input) {
  const issues = [];
  const w = prepared.totalWords;
  if (w < 120) issues.push(issue('TOO_LITTLE_SOURCE', 'error', '/content', `only ${w} words of teaching text — too little for a lecture video (merge it with a neighbour?)`));
  else if (w < 250) issues.push(issue('THIN_SOURCE', 'warning', '/content', `${w} words of teaching text; the video will be short (${prepared.budget.minutes} min)`));
  const d = prepared.descriptionWords;
  if (d > 0 && d / (d + w) > 0.6) {
    issues.push(issue('MOSTLY_IMAGE_DESCRIPTIONS', 'warning', '/content', `${Math.round((100 * d) / (d + w))}% of this lecture is AI image descriptions, not textbook text — check the source`));
  }
  const text = prepared.sections.map((s) => s.text).join(' ');
  const dev = scriptShare(text);
  if (input.slide_language === 'hindi' && dev < 0.3) issues.push(issue('LANGUAGE_MISMATCH', 'warning', '/content', `course is marked Hindi but the source is ${Math.round(dev * 100)}% Devanagari`));
  if (input.slide_language !== 'hindi' && dev > 0.3) issues.push(issue('LANGUAGE_MISMATCH', 'warning', '/content', `source is ${Math.round(dev * 100)}% Devanagari but the course has English slides — should slide_language be hindi?`));
  return issues;
}

export function gatePrepared(prepared, cfg) {
  const issues = [];
  const n = cfg.curriculum.lectures_per_chapter;
  if (prepared.sections.length < n) {
    issues.push(issue('TOO_FEW_SECTIONS', 'error', '/sections', `only ${prepared.sections.length} sections for ${n} lectures — is the source text complete?`));
  }
  const perLecture = prepared.totalWords / n;
  if (perLecture < 400) {
    issues.push(issue('THIN_SOURCE', 'warning', '/source_text', `~${Math.round(perLecture)} source words per lecture; 20-minute lectures will lean on explanation depth`));
  }
  return issues;
}

// ---- G1 chapter plan -------------------------------------------------------------------

export function gateChapterPlan(plan, prepared, cfg) {
  const issues = [...checkContract('chapter-plan', plan)];
  if (issues.length) return { plan, issues };
  const out = structuredClone(plan);
  const n = cfg.curriculum.lectures_per_chapter;
  const L = out.lectures;
  if (L.length !== n) issues.push(issue('LECTURE_COUNT', 'error', '/lectures', `${L.length} lectures, expected ${n}`));

  const order = new Map(prepared.sections.map((s, i) => [s.id, i]));
  const words = new Map(prepared.sections.map((s) => [s.id, s.words]));
  const seen = new Map();
  let last = -1;
  L.forEach((lec, i) => {
    lec.index = i + 1;
    if (!lec.title?.trim()) issues.push(issue('NO_TITLE', 'error', `/lectures/${i}`, `lecture ${i + 1} has no title`));
    if (!lec.section_ids.length) issues.push(issue('EMPTY_LECTURE', 'error', `/lectures/${i}`, `lecture ${i + 1} covers no sections`));
    for (const id of lec.section_ids) {
      if (!order.has(id)) { issues.push(issue('UNKNOWN_SECTION', 'error', `/lectures/${i}`, `lecture ${i + 1}: unknown section "${id}"`)); continue; }
      if (seen.has(id)) issues.push(issue('SECTION_REPEATED', 'error', `/lectures/${i}`, `section ${id} is in lecture ${seen.get(id)} and lecture ${i + 1}`));
      seen.set(id, i + 1);
      if (order.get(id) < last) issues.push(issue('SECTION_ORDER', 'error', `/lectures/${i}`, `lecture ${i + 1}: section ${id} is out of reading order`));
      last = Math.max(last, order.get(id));
    }
    if (i === 0 && lec.recap) { lec.recap = null; issues.push({ ...issue('RECAP_ON_FIRST', 'warning', '/lectures/0', 'lecture 1 has no previous lecture; recap cleared'), autoFixed: true }); }
    if (i === L.length - 1 && lec.preview) { lec.preview = null; issues.push({ ...issue('PREVIEW_ON_LAST', 'warning', `/lectures/${i}`, 'last lecture has no next lecture; preview cleared'), autoFixed: true }); }
    if (i > 0 && !lec.recap) issues.push(issue('NO_RECAP', 'warning', `/lectures/${i}`, `lecture ${i + 1} has no recap of the previous lecture`));
    if (lec.goals.length < 2 || lec.goals.length > 6) issues.push(issue('GOAL_COUNT', 'warning', `/lectures/${i}`, `lecture ${i + 1} has ${lec.goals.length} goals (2–6 expected)`));
  });
  for (const s of prepared.sections) {
    if (!seen.has(s.id)) issues.push(issue('SECTION_UNCOVERED', 'error', '/lectures', `section ${s.id} "${s.heading}" is in no lecture`));
  }
  const loads = L.map((lec) => lec.section_ids.reduce((a, id) => a + (words.get(id) || 0), 0));
  const mean = loads.reduce((a, b) => a + b, 0) / (loads.length || 1);
  loads.forEach((w, i) => {
    const d = pct(w, mean);
    if (d > 0.4) issues.push(issue('UNBALANCED', 'error', `/lectures/${i}`, `lecture ${i + 1} carries ${w} source words vs ~${Math.round(mean)} average (±40% max)`));
    else if (d > 0.25) issues.push(issue('UNBALANCED', 'warning', `/lectures/${i}`, `lecture ${i + 1} carries ${w} source words vs ~${Math.round(mean)} average`));
  });
  return { plan: out, issues };
}

// ---- G2 lecture plan -------------------------------------------------------------------

const STOP = new Set(('the a an and or of to in on for with from by at as is are was were be this that these those it its into which ' +
  'image shows show showing diagram figure picture illustration labelled labeled simple typical student students textbook page ' +
  'there their them they also used using use can how what when where why about each two one some such than then very').split(' '));
const contentWords = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, '')));
// How well an image's description matches what a slide is about (shared content words).
export function imageMatch(slide, img) {
  const a = contentWords([slide.title, slide.purpose, ...(slide.key_points || [])].join(' '));
  let n = 0;
  for (const w of contentWords(img.description)) if (a.has(w)) n++;
  return n;
}

// Slides generated by code when the plan does not open with them.
function openingSlide(type, ctx) {
  if (type === 'intro') {
    return { slide_type: 'intro', title: ctx.lectureTitle || 'Introduction', purpose: 'welcome the student to this lecture and say what it covers',
             key_points: (ctx.sectionHeadings || []).slice(0, 4), source_refs: [], image_id: null };
  }
  if (type === 'chapter_index') {
    return { slide_type: 'chapter_index', title: ctx.chapterTitle || 'Chapter overview', purpose: 'roadmap of the lectures in this chapter',
             key_points: (ctx.chapterLectures || []).slice(0, 10), source_refs: [], image_id: null };
  }
  return null;
}

const OPENERS = new Set(['intro', 'chapter_index']);
// Image slide types that can stand in for each other when a figure's shape
// does not fit the planned one (first fitting type wins).
const IMAGE_SWAP = ['labeled_diagram', 'image_points', 'definition', 'mechanism'];
const NO_SOURCE_OK = new Set(['intro', 'chapter_index', 'quick_revision', 'formula_sheet']);

// ctx: { lecture (1-based), lectures, sectionIds, images (usable figures),
// types (pack slide types), pack (pack.json), budget, lectureTitle,
// chapterTitle, chapterLectures, sectionHeadings }
export function gateLecturePlan(plan, ctx) {
  const issues = [...checkContract('lecture-plan', plan)];
  if (issues.length) return { plan, issues };
  const out = structuredClone(plan);
  const catalog = new Map(ctx.images.map((im) => [im.id, im]));
  const allowed = new Set(ctx.sectionIds);
  const at = (i) => `/slides/${i}`;
  const fix = (code, i, message) => issues.push({ ...issue(code, 'warning', at(i), message), autoFixed: true });

  // Opening sequence (pack.json flow …opening): every lecture starts with the
  // intro, lecture 1 continues with the chapter index. Missing or misplaced
  // openers are put in place by code.
  const flow0 = ctx.pack.flow || {};
  const opening = (ctx.lecture === 1 ? flow0.firstLecture?.opening : null) || flow0.everyLecture?.opening || [];
  opening.forEach((type, k) => {
    if (!ctx.types[type]) return;
    if (out.slides[k]?.slide_type === type) return;
    const j = out.slides.findIndex((x) => x.slide_type === type);
    const slide = j >= 0 ? out.slides.splice(j, 1)[0] : openingSlide(type, ctx);
    if (!slide) return;
    out.slides.splice(k, 0, slide);
    fix('OPENING_FIXED', k, `slide ${k + 1} must be ${type}; ${j >= 0 ? 'moved into place' : 'added'}`);
  });
  const S = out.slides;

  // Too few practice MCQs (pack.json types.mcq.min) and room in the budget:
  // append them before the planner is asked again. The writer builds each
  // question from the lecture's own topics and sections.
  const mcqMin = ctx.pack.types?.mcq?.min || 0;
  const teaching = () => S.filter((x) => !OPENERS.has(x.slide_type)).length;
  const topics = S.filter((x) => !OPENERS.has(x.slide_type) && !['mcq', 'quick_revision', 'formula_sheet'].includes(x.slide_type)).map((x) => x.title);
  while (ctx.types.mcq && S.filter((x) => x.slide_type === 'mcq').length < mcqMin && teaching() < ctx.budget.max) {
    S.push({ slide_type: 'mcq', title: 'Check Your Understanding', purpose: 'practice question on what this lecture taught',
             key_points: topics.slice(-4).length ? topics.slice(-4) : ['this lecture'], source_refs: [...ctx.sectionIds], image_id: null });
    fix('MCQ_ADDED', S.length - 1, `added a practice MCQ (at least ${mcqMin} per lecture)`);
  }

  const lt = String(out.lecture_title || '').trim();
  if (!lt) issues.push(issue('NO_LECTURE_TITLE', 'error', '/lecture_title', 'give the lecture a clean on-screen title'));
  else if (lt.split(/\s+/).length > 8 || lt.length > 60) issues.push(issue('LECTURE_TITLE_LONG', 'error', '/lecture_title', `lecture title "${lt}" is too long (≤ 8 words, ≤ 60 characters — it sits in every slide header)`));
  // The intro and chapter index are short openers: not counted in the budget.
  const content = S.filter((x) => !OPENERS.has(x.slide_type)).length;
  if (content < ctx.budget.min || content > ctx.budget.max) {
    issues.push(issue('SLIDE_COUNT', 'error', '/slides', `${content} teaching slides (besides the opening); this lecture needs ${ctx.budget.min}–${ctx.budget.max}`));
  }

  // Images, in four passes: (1) check the planner's picks, (2) fill image
  // slots the planner left empty with the best-matching unused figure —
  // required slots first, (3) switch still-imageless required types to their
  // fallback, (4) insist the lecture actually shows its figures.
  S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st || s.image_id == null) return;
    const img = catalog.get(s.image_id);
    if (!takesImage(st.spec)) { fix('IMAGE_NOT_ALLOWED', i, `slide ${i + 1}: ${s.slide_type} shows no image; image_id cleared`); s.image_id = null; }
    else if (!img) { fix('IMAGE_NOT_IN_CATALOG', i, `slide ${i + 1}: "${s.image_id}" is not a usable figure in the catalog; cleared`); s.image_id = null; }
    else if (!fitsRatio(img, st.spec.ratios)) {
      // The planner matched the figure to the slide; only the shape is wrong.
      // Keep the figure and switch to a sibling image type that takes that
      // shape — clearing it would let autofill put another figure here.
      const to = IMAGE_SWAP.includes(s.slide_type)
        && IMAGE_SWAP.find((t) => t !== s.slide_type && ctx.types[t] && takesImage(ctx.types[t].spec) && fitsRatio(img, ctx.types[t].spec.ratios));
      if (to) { fix('IMAGE_TYPE_SWITCHED', i, `slide ${i + 1}: ${img.id} is ${img.ratio}, which ${s.slide_type} cannot show; switched the slide to ${to}`); s.slide_type = to; }
      else { fix('IMAGE_RATIO', i, `slide ${i + 1}: ${img.id} is ${img.ratio}, ${s.slide_type} needs ${st.spec.ratios.join('/')}; cleared`); s.image_id = null; }
    }
  });
  const usedIds = new Set(S.map((s) => s.image_id).filter(Boolean));
  const autofill = (requiredOnly, minScore) => S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st || s.image_id != null || !takesImage(st.spec) || needsImage(st.spec) !== requiredOnly) return;
    const best = ctx.images.filter((im) => !usedIds.has(im.id) && fitsRatio(im, st.spec.ratios))
      .map((im) => ({ im, score: imageMatch(s, im) })).sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= minScore) {
      s.image_id = best.im.id;
      usedIds.add(best.im.id);
      fix('IMAGE_AUTOFILLED', i, `slide ${i + 1}: no image chosen for ${s.slide_type}; used ${best.im.id} (its description matches the slide, score ${best.score})`);
    }
  });
  autofill(true, 1);
  autofill(false, 3);
  S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st || !needsImage(st.spec) || s.image_id != null) return;
    const to = ctx.pack.fallbacks?.[s.slide_type];
    if (to && ctx.types[to]) { fix('IMAGE_FALLBACK', i, `slide ${i + 1}: no suitable image for ${s.slide_type}; switched to ${to}`); s.slide_type = to; }
    else issues.push(issue('IMAGE_REQUIRED', 'error', at(i), `slide ${i + 1}: ${s.slide_type} needs an image and none fits`));
  });
  const minUsed = Math.min(ctx.pack.images?.minUsed ?? 1, ctx.images.length);
  const shown = S.filter((s) => s.image_id).length;
  if (shown < minUsed) {
    issues.push(issue('IMAGES_UNUSED', 'error', '/slides', `the catalog has ${ctx.images.length} usable figure(s) (${ctx.images.map((im) => im.id).join(', ')}) but the plan shows ${shown} — put the matching figures on labeled_diagram / image_points / mechanism / definition slides`));
  } else if (shown < Math.min(ctx.images.length, 3)) {
    issues.push(issue('IMAGES_FEW', 'warning', '/slides', `${shown} of ${ctx.images.length} usable figures shown`));
  }

  const used = new Map();
  S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st) { issues.push(issue('UNKNOWN_TYPE', 'error', at(i), `slide ${i + 1}: "${s.slide_type}" is not a ${ctx.pack.name} slide type`)); return; }
    if (s.image_id) {
      if (used.has(s.image_id)) issues.push(issue('IMAGE_REUSED', 'warning', at(i), `slide ${i + 1}: ${s.image_id} already used on slide ${used.get(s.image_id)}`));
      used.set(s.image_id, i + 1);
    }
    for (const r of s.source_refs) if (!allowed.has(r)) issues.push(issue('REF_OUTSIDE_LECTURE', 'error', at(i), `slide ${i + 1}: source "${r}" is not one of this lecture's sections (${ctx.sectionIds.join(', ')})`));
    if (!s.source_refs.length && !NO_SOURCE_OK.has(s.slide_type)) {
      issues.push(issue('NO_SOURCE', 'warning', at(i), `slide ${i + 1}: cites no source section`));
    }
    if (!s.key_points.length && !OPENERS.has(s.slide_type)) issues.push(issue('NO_KEY_POINTS', 'error', at(i), `slide ${i + 1}: no key points to write from`));
  });
  const cited = new Set(S.flatMap((s) => s.source_refs));
  for (const id of ctx.sectionIds) if (!cited.has(id)) issues.push(issue('SECTION_UNUSED', 'warning', '/slides', `section ${id} is assigned to this lecture but no slide covers it`));

  // pack.json: per-type counts and flow.
  const types = S.map((s) => s.slide_type);
  const count = (t) => types.filter((x) => x === t).length;
  for (const [t, lim] of Object.entries(ctx.pack.types || {})) {
    const n = count(t);
    if (lim.max != null && n > lim.max) issues.push(issue('TYPE_MAX', 'error', '/slides', `${n} × ${t}; at most ${lim.max} per lecture`));
    if (lim.min != null && n < lim.min) issues.push(issue('TYPE_MIN', 'error', '/slides', `${n} × ${t}; at least ${lim.min} per lecture`));
  }
  const flow = ctx.pack.flow || {};
  const first = ctx.lecture === 1, lastLec = ctx.lecture === ctx.lectures;
  const Q = new Set(ctx.pack.questionTypes || []);
  if (first && flow.firstLecture?.startsWith && !flow.firstLecture.startsWith.includes(types[0])) {
    issues.push(issue('FLOW_START', 'error', '/slides/0', `lecture 1 must open with ${flow.firstLecture.startsWith.join(' or ')}`));
  }
  opening.forEach((t, k) => { if (ctx.types[t] && types[k] !== t) issues.push(issue('FLOW_START', 'error', at(k), `slide ${k + 1} must be ${t}`)); });
  if (!first) for (const t of Object.keys(flow.otherLectures?.notAt || {})) {
    if (types.includes(t)) issues.push(issue('FLOW_NOT_HERE', 'error', '/slides', `${t} belongs only in lecture 1`));
  }
  const every = flow.everyLecture || {};
  if (every.endsWithAnyOf && !every.endsWithAnyOf.includes(types.at(-1))) {
    issues.push(issue('FLOW_END', 'error', `/slides/${S.length - 1}`, `a lecture ends on practice: ${every.endsWithAnyOf.join(' / ')}`));
  }
  const needs = [...(every.includes || []), ...(lastLec ? flow.lastLecture?.includes || [] : [])];
  for (const t of new Set(needs)) if (!types.includes(t)) issues.push(issue('FLOW_MISSING', 'error', '/slides', `this lecture needs a ${t} slide`));
  const anyOf = [every.includesAnyOf, lastLec ? flow.lastLecture?.includesAnyOf : null].filter(Boolean);
  for (const set of anyOf) if (!set.some((t) => types.includes(t))) issues.push(issue('FLOW_MISSING', 'error', '/slides', `this lecture needs one of: ${set.join(' / ')}`));
  if (lastLec && flow.lastLecture?.minTrailingQuestions) {
    let k = 0;
    for (let i = types.length - 1; i >= 0 && Q.has(types[i]); i--) k++;
    if (k < flow.lastLecture.minTrailingQuestions) issues.push(issue('FLOW_PRACTICE', 'error', '/slides', `the chapter's last lecture closes with at least ${flow.lastLecture.minTrailingQuestions} practice questions (has ${k})`));
  }
  let run = 1;
  for (let i = 1; i < types.length; i++) {
    run = types[i] === types[i - 1] ? run + 1 : 1;
    if (flow.maxConsecutiveSameType && run > flow.maxConsecutiveSameType) {
      issues.push(issue('FLOW_REPEAT', 'error', at(i), `${run} × ${types[i]} in a row (max ${flow.maxConsecutiveSameType})`));
    }
  }
  if (flow.questionAfterDefinitions) {
    let defs = 0;
    types.forEach((t, i) => {
      defs = t === 'definition' ? defs + 1 : Q.has(t) ? 0 : defs;
      if (defs === flow.questionAfterDefinitions) issues.push(issue('FLOW_CONSOLIDATE', 'warning', at(i), `${defs} definition slides without a question in between`));
    });
  }
  return { plan: out, issues };
}

// ---- G3 slide content --------------------------------------------------------------------

const NUM = /\b\d+(?:[.:]\d+)*\b/g;

// written: [{ slide_type, data }] aligned with planSlides.
export function gateSlides(written, planSlides, types, sectionText, { slideLanguage = 'english' } = {}) {
  const issues = [];
  const langCheck = (data, where) => {
    const text = slideStrings(data).join(' ');
    if (slideLanguage === 'hindi') {
      if (scriptShare(text) < 0.5) issues.push(issue('SLIDE_LANGUAGE', 'warning', where, `${where}: slides for this course are in Hindi (Devanagari); this one is mostly Latin script`));
    } else if (/\p{Script=Devanagari}/u.test(text)) {
      issues.push(issue('SLIDE_LANGUAGE', 'error', where, `${where}: slide text must be English — Devanagari found`));
    }
  };
  const slides = written.map((w, i) => {
    const p = planSlides[i];
    const where = `s${String(i + 1).padStart(2, '0')}`;
    if (!p) { issues.push(issue('EXTRA_SLIDE', 'error', where, `${where}: not in the plan`)); return w; }
    if (w.slide_type !== p.slide_type) issues.push(issue('TYPE_CHANGED', 'error', where, `${where}: planned ${p.slide_type}, written as ${w.slide_type}`));
    const st = types[p.slide_type];
    const { data, issues: di } = checkSlideData(st, w.data, { where });
    issues.push(...di);
    langCheck(data, where);
    const src = p.source_refs.map((r) => sectionText[r] || '').join('\n');
    if (src) {
      for (const n of new Set(slideStrings(data).join(' ').match(NUM) || [])) {
        if (n.length > 1 && !src.includes(n)) issues.push(issue('NUMBER_NOT_IN_SOURCE', 'warning', where, `${where}: "${n}" does not appear in the cited NCERT text`));
      }
    }
    return { slide_type: p.slide_type, data };
  });
  if (written.length < planSlides.length) issues.push(issue('MISSING_SLIDES', 'error', '/', `${planSlides.length - written.length} planned slides were not written`));
  return { slides, issues };
}

// ---- G4 narration ----------------------------------------------------------------------------
//
// Narration is written straight in Hinglish (config narration.mode: direct),
// so this gate checks the teaching (markers, length, question pause, no
// reading out the slide) and the Hinglish script together. In via-english
// mode it checks the English draft and G5 checks the conversion.

const BANNED = [
  [/<[a-z/][^>]*>/i, 'SSML/HTML tag'], [/\[(pause|break|music|sfx)[^\]]*\]/i, 'bracketed stage direction'],
  [/\*\*|^#+\s|^\s*[-•]\s/m, 'markdown formatting'], [/\bas an ai\b/i, 'assistant phrasing'],
  [/\bslide (number|\d+)\b/i, 'slide numbering'],
];

// opts.language: 'hinglish' | 'english'; opts.wordFactor scales the slide
// type's English word range (Hinglish runs a little longer for the same content).
// opts.hindiSubject: Hindi-literature lectures quote Hindi lines, so a
// Devanagari-heavy mix is expected.
export function gateNarration(text, st, data, where = 'slide', { language = 'hinglish', wordFactor = 1, hindiSubject = false } = {}) {
  const issues = [];
  const expected = requiredMarkers(st.spec, data);
  const got = markersIn(text);
  const dup = got.filter((m, i) => got.indexOf(m) !== i);
  if (dup.length) issues.push(issue('MARKER_DUPLICATE', 'error', where, `${where}: markers used twice: ${[...new Set(dup)].join(', ')}`));
  const missing = expected.filter((m) => !got.includes(m));
  const unknown = got.filter((m) => !expected.includes(m));
  if (missing.length) issues.push(issue('MARKER_MISSING', 'error', where, `${where}: missing markers ${missing.map((m) => `{{${m}}}`).join(' ')}`));
  if (unknown.length) issues.push(issue('MARKER_UNKNOWN', 'error', where, `${where}: unknown markers ${unknown.map((m) => `{{${m}}}`).join(' ')} (allowed: ${expected.join(', ') || 'none'})`));
  if (!missing.length && !unknown.length && !dup.length && got.join() !== expected.join()) {
    issues.push(issue('MARKER_ORDER', 'error', where, `${where}: markers must appear in order ${expected.join(' → ')} (got ${got.join(' → ')})`));
  }
  // Every reveal needs some narration of its own before the next one.
  const pieces = text.split(/\{\{b\d+(?:\.\d+){0,2}\}\}/);
  pieces.slice(1, -1).forEach((p, i) => {
    if (wordCount(p) < 6) issues.push(issue('MARKERS_CROWDED', 'warning', where, `${where}: only ${wordCount(p)} words after {{${got[i]}}} before the next reveal`));
  });
  const n = wordCount(text);
  const [lo, hi] = st.spec.narrationWords.map((w) => Math.round(w * wordFactor));
  if (n < lo * 0.85 || n > hi * 1.25) issues.push(issue('NARRATION_LENGTH', 'error', where, `${where}: ${n} words; ${st.type} needs ${lo}–${hi}`));
  else if (n < lo || n > hi) issues.push(issue('NARRATION_LENGTH', 'warning', where, `${where}: ${n} words; aim for ${lo}–${hi}`));
  if (st.spec.question && got.length) {
    const before = pieces[0];
    if (!before.includes('?')) issues.push(issue('NO_QUESTION_PAUSE', 'error', where, `${where}: pose the question (a "?") and let the student think before {{${got[0]}}}`));
  }
  if (language === 'english' && /\p{Script=Devanagari}/u.test(text)) issues.push(issue('NOT_ENGLISH', 'error', where, `${where}: the English narration contains Devanagari`));
  if (language === 'hinglish') issues.push(...hinglishScript(text, where, hindiSubject ? { maxShare: 0.97, warnShare: 0.92 } : {}));
  for (const [re, what] of BANNED) if (re.test(text)) issues.push(issue('BANNED_CONTENT', 'error', where, `${where}: ${what} is not allowed in narration`));
  const run = longestSharedRun(slideStrings(data).join(' . '), text);
  if (run >= 14) issues.push(issue('READS_THE_SLIDE', 'warning', where, `${where}: ${run} consecutive words copied from the slide text — explain, don't read out`));
  const sents = sentences(text).map((s) => s.toLowerCase());
  const repeats = sents.filter((s, i) => s.split(' ').length > 4 && sents.indexOf(s) !== i);
  if (repeats.length) issues.push(issue('REPEATED_SENTENCE', 'warning', where, `${where}: repeats "${repeats[0].slice(0, 60)}…"`));
  return issues;
}

// ---- G5 Hinglish conversion (via-english mode only) ----------------------------------------

export function gateHinglish(english, hinglish, where = 'slide') {
  const issues = [];
  const a = markersIn(english), b = markersIn(hinglish);
  if (a.join() !== b.join()) issues.push(issue('MARKERS_CHANGED', 'error', where, `${where}: Hinglish markers ${b.join(' → ') || 'none'} must match English ${a.join(' → ') || 'none'} exactly`));
  const se = sentences(english).length, sh = sentences(hinglish).length;
  const d = Math.abs(se - sh);
  if (d > Math.max(2, se * 0.25)) issues.push(issue('SENTENCE_DRIFT', 'error', where, `${where}: ${sh} Hinglish sentences vs ${se} English — convert, don't rewrite`));
  else if (d > Math.max(1, se * 0.1)) issues.push(issue('SENTENCE_DRIFT', 'warning', where, `${where}: ${sh} Hinglish sentences vs ${se} English`));
  const ratio = wordCount(hinglish) / Math.max(1, wordCount(english));
  if (ratio < 0.75 || ratio > 1.8) issues.push(issue('LENGTH_DRIFT', 'error', where, `${where}: Hinglish is ${ratio.toFixed(2)}× the English length — content was dropped or added`));
  issues.push(...hinglishScript(hinglish, where));
  return issues;
}

// ---- Hinglish script (G4 in direct mode, G5 in via-english mode) ----------------------------

// Mixed script as the voice engine needs it: Hindi in Devanagari, English in
// Latin, nothing it cannot say.
export function hinglishScript(hinglish, where = 'slide', { maxShare = 0.9, warnShare = 0.8 } = {}) {
  const issues = [];
  const roman = romanHindiHits(hinglish);
  if (roman.length >= 2) issues.push(issue('ROMANIZED_HINDI', 'error', where, `${where}: Hindi written in Latin script (${[...new Set(roman)].slice(0, 6).join(', ')}) — Hindi words go in Devanagari`));
  else if (roman.length) issues.push(issue('ROMANIZED_HINDI', 'warning', where, `${where}: "${roman[0]}" looks like Hindi in Latin script`));
  const dev = devEnglishHits(hinglish);
  if (dev.length >= 2) issues.push(issue('DEVANAGARI_ENGLISH', 'error', where, `${where}: English spelt in Devanagari (${dev.slice(0, 6).join(', ')}) — keep English words in Latin script`));
  else if (dev.length) issues.push(issue('DEVANAGARI_ENGLISH', 'warning', where, `${where}: "${dev[0]}" is English spelt in Devanagari`));
  const formal = formalHindiHits(hinglish);
  if (formal.length >= 3) issues.push(issue('FORMAL_HINDI', 'warning', where, `${where}: bookish Hindi (${formal.slice(0, 5).join(', ')}) — a teacher would say these in English`));
  const share = scriptShare(hinglish);
  if (share < 0.08 || share > maxShare) issues.push(issue('SCRIPT_MIX', 'error', where, `${where}: ${(share * 100).toFixed(0)}% Devanagari — Hinglish mixes Devanagari connectives with Latin terms`));
  else if (share < 0.2 || share > warnShare) issues.push(issue('SCRIPT_MIX', 'warning', where, `${where}: ${(share * 100).toFixed(0)}% Devanagari is unusual for Hinglish`));
  const bare = hinglish.replace(/\{\{b\d+(?:\.\d+){0,2}\}\}/g, '');
  const odd = [...new Set(bare.match(/[$\\{}<>[\]#*_|~^]/g) || [])];
  if (odd.length) issues.push(issue('UNSPEAKABLE', 'error', where, `${where}: TTS cannot speak ${odd.join(' ')} — write it in words`));
  const bad = sentences(hinglish).filter((s) => !/[.!?।…]["'”’)]*$/.test(s));
  if (bad.length) issues.push(issue('SENTENCE_END', 'warning', where, `${where}: ${bad.length} sentence(s) without an ending mark (। . ! ?)`));
  return issues;
}

// ---- G6 reviewer findings ----------------------------------------------------------------

export function gateReview(review) {
  return (review.issues || []).map((r) => issue(
    `REVIEW_${r.code}`, r.severity,
    r.slide == null ? '/' : `s${String(r.slide).padStart(2, '0')}`,
    `${r.slide == null ? 'lecture' : `s${String(r.slide).padStart(2, '0')}`}: ${r.message}`,
  ));
}
