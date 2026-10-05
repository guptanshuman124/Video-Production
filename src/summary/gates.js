// Gates of the summary pipeline (S1 outline, S2 part plans). Slide content
// (S3) and narration (S4) use the shared per-slide gates (gateSlides,
// gateNarration); media gates (A1, A2, V1) are shared too.

import { needsImage, takesImage } from '../slides.js';
import { fitsRatio } from '../generation/prepare.js';
import { imageMatch } from '../validators/generation.js';
import { slidesFor } from './prepare.js';

const issue = (code, severity, path, message) => ({ code, severity, path, message });
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

// S1 — the outline: parts in order, every section exactly once, minutes that
// add up. Minutes are normalised to the video's length by code (a warning),
// and each part gets its slide budget.
export function gateOutline(outline, { sections, lectures, minutes, cfg }) {
  const issues = [];
  const out = structuredClone(outline || {});
  const parts = Array.isArray(out.parts) ? out.parts : [];
  const [pmin, pmax] = cfg.summary.parts;
  const fewest = Math.min(pmin, sections.length);
  if (parts.length < fewest || parts.length > pmax) issues.push(issue('PART_COUNT', 'error', '/parts', `${parts.length} parts; the summary needs ${fewest}–${pmax}`));
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const seen = new Map();
  let last = -1;
  parts.forEach((p, i) => {
    const at = `/parts/${i}`;
    if (!String(p.title || '').trim()) issues.push(issue('NO_TITLE', 'error', at, `part ${i + 1} has no title`));
    else if (words(p.title) > 9) issues.push(issue('TITLE_LONG', 'error', at, `part ${i + 1}: title "${p.title}" is too long (at most 6 words)`));
    if (!p.section_ids?.length) issues.push(issue('PART_EMPTY', 'error', at, `part ${i + 1} covers no sections`));
    for (const id of p.section_ids || []) {
      if (!order.has(id)) { issues.push(issue('UNKNOWN_SECTION', 'error', at, `part ${i + 1}: "${id}" is not a section of this chapter`)); continue; }
      if (seen.has(id)) issues.push(issue('SECTION_TWICE', 'error', at, `section ${id} is in part ${seen.get(id)} and part ${i + 1}`));
      seen.set(id, i + 1);
      if (order.get(id) < last) issues.push(issue('PART_ORDER', 'error', at, `part ${i + 1}: section ${id} is out of NCERT order`));
      last = Math.max(last, order.get(id));
    }
    if ((p.key_points || []).length < 3) issues.push(issue('FEW_KEY_POINTS', 'error', at, `part ${i + 1}: give 6–12 key points (got ${(p.key_points || []).length})`));
    const valid = new Set(lectures.map((l) => l.index));
    p.lectures = (p.lectures || []).filter((n) => valid.has(n));
    // The lectures follow from the sections, whatever the model wrote.
    const fromSections = [...new Set((p.section_ids || []).map((id) => Number(/^L(\d+)\./.exec(id)?.[1])).filter(Boolean))];
    if (fromSections.length) p.lectures = fromSections;
  });
  const missing = sections.filter((s) => !seen.has(s.id)).map((s) => s.id);
  if (missing.length) issues.push(issue('SECTIONS_UNCOVERED', 'error', '/parts', `sections not in any part: ${missing.join(', ')}`));

  // Minutes: proportional to what the model gave, scaled to the video's length.
  if (parts.length) {
    const given = parts.map((p) => (Number(p.minutes) > 0 ? Number(p.minutes) : 1));
    const sum = given.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - minutes) > minutes * 0.1) {
      issues.push({ ...issue('MINUTES_SCALED', 'warning', '/parts', `parts added up to ${sum.toFixed(1)} min; scaled to ${minutes} min`), autoFixed: true });
    }
    const [lo, hi] = cfg.summary.part_minutes;
    parts.forEach((p, i) => {
      p.minutes = Math.round((given[i] / sum) * minutes * 10) / 10;
      if (p.minutes < lo * 0.6 || p.minutes > hi * 1.4) issues.push(issue('PART_LENGTH', 'warning', `/parts/${i}`, `part ${i + 1} gets ${p.minutes} min (usual ${lo}–${hi})`));
      p.budget = slidesFor(p.minutes, cfg);
    });
    // The last part also carries the chapter check: room for its content, a recap and the questions.
    const lastB = parts.at(-1).budget;
    const need = (cfg.summary.final_questions ?? 2) + 3;
    if (lastB.max < need) parts.at(-1).budget = { min: Math.max(lastB.min, need - 1), max: need };
  }
  out.parts = parts;
  return { value: out, issues };
}

// S2 — one part's slide plan. ctx: { part (1-based), partCount, sectionIds,
// images (catalog figures offered), types (allowed in summaries), pack,
// budget, cfg, final }.
export function gatePartPlan(plan, ctx) {
  const issues = [];
  const out = structuredClone(plan || {});
  const S = Array.isArray(out.slides) ? out.slides : [];
  out.slides = S;
  const at = (i) => `/slides/${i}`;
  const fix = (code, i, message) => issues.push({ ...issue(code, 'warning', at(i), message), autoFixed: true });
  const catalog = new Map(ctx.images.map((im) => [im.id, im]));
  const allowed = new Set(ctx.sectionIds);
  const Q = new Set(ctx.pack.questionTypes || ['mcq']);
  const { cfg } = ctx;

  // The chapter check: the last part closes on enough questions; add MCQs when there is room.
  if (ctx.final && ctx.types.mcq) {
    const trailing = () => { let k = 0; for (let i = S.length - 1; i >= 0 && Q.has(S[i].slide_type); i--) k++; return k; };
    const topics = S.filter((x) => !Q.has(x.slide_type) && x.slide_type !== 'quick_revision').map((x) => x.title).slice(-4);
    while (trailing() < cfg.summary.final_questions && S.length < ctx.budget.max) {
      S.push({ slide_type: 'mcq', title: 'Chapter Check', purpose: 'a question on the whole chapter', key_points: topics.length ? topics : ['this chapter'], source_refs: [...ctx.sectionIds.slice(-2)], image_id: null });
      fix('MCQ_ADDED', S.length - 1, `added a chapter-check MCQ (the last part ends on ${cfg.summary.final_questions} questions)`);
    }
  }

  if (S.length < ctx.budget.min || S.length > ctx.budget.max) issues.push(issue('SLIDE_COUNT', 'error', '/slides', `${S.length} slides in part ${ctx.part}; it needs ${ctx.budget.min}–${ctx.budget.max}`));

  // Images: picks must be real figures of this part that fit the slot; empty
  // required slots get the best-matching unused figure, else the image-free fallback.
  const used = new Set();
  S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st || s.image_id == null) return;
    const img = catalog.get(s.image_id);
    if (!takesImage(st.spec)) { fix('IMAGE_NOT_ALLOWED', i, `slide ${i + 1}: ${s.slide_type} shows no image; cleared`); s.image_id = null; }
    else if (!img) { fix('IMAGE_NOT_IN_CATALOG', i, `slide ${i + 1}: "${s.image_id}" is not a figure of this part; cleared`); s.image_id = null; }
    else if (!fitsRatio(img, st.spec.ratios)) { fix('IMAGE_RATIO', i, `slide ${i + 1}: ${img.id} is ${img.ratio}, ${s.slide_type} needs ${st.spec.ratios.join('/')}; cleared`); s.image_id = null; }
    else if (used.has(img.id)) { fix('IMAGE_REUSED', i, `slide ${i + 1}: ${img.id} is already shown in this part; cleared`); s.image_id = null; }
    else used.add(img.id);
  });
  S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st || s.image_id != null || !needsImage(st.spec)) return;
    const best = ctx.images.filter((im) => !used.has(im.id) && fitsRatio(im, st.spec.ratios)).map((im) => ({ im, score: imageMatch(s, im) })).sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 1) { s.image_id = best.im.id; used.add(best.im.id); fix('IMAGE_AUTOFILLED', i, `slide ${i + 1}: used ${best.im.id} (matches the slide)`); return; }
    const to = ctx.pack.fallbacks?.[s.slide_type];
    if (to && ctx.types[to]) { fix('IMAGE_FALLBACK', i, `slide ${i + 1}: no figure for ${s.slide_type}; switched to ${to}`); s.slide_type = to; }
    else issues.push(issue('IMAGE_REQUIRED', 'error', at(i), `slide ${i + 1}: ${s.slide_type} needs a figure and none fits`));
  });

  // Optional figure slots: a clearly matching unused figure goes on (the
  // reviewer otherwise flags a textbook figure the summary never shows).
  S.forEach((s, i) => {
    const st = ctx.types[s.slide_type];
    if (!st || s.image_id != null || !takesImage(st.spec) || needsImage(st.spec)) return;
    const best = ctx.images.filter((im) => !used.has(im.id) && fitsRatio(im, st.spec.ratios)).map((im) => ({ im, score: imageMatch(s, im) })).sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 3) { s.image_id = best.im.id; used.add(best.im.id); fix('IMAGE_AUTOFILLED', i, `slide ${i + 1}: shows ${best.im.id} (its description matches the slide)`); }
  });

  S.forEach((s, i) => {
    if (!ctx.types[s.slide_type]) { issues.push(issue('UNKNOWN_TYPE', 'error', at(i), `slide ${i + 1}: "${s.slide_type}" is not a summary slide type of this subject`)); return; }
    for (const r of s.source_refs || []) if (!allowed.has(r)) issues.push(issue('REF_OUTSIDE_PART', 'error', at(i), `slide ${i + 1}: "${r}" is not a section of this part (${ctx.sectionIds.join(', ')})`));
    if (!s.key_points?.length) issues.push(issue('NO_KEY_POINTS', 'error', at(i), `slide ${i + 1}: no key points to write from`));
  });
  const cited = new Set(S.flatMap((s) => s.source_refs || []));
  for (const id of ctx.sectionIds) if (!cited.has(id)) issues.push(issue('SECTION_UNUSED', 'warning', '/slides', `section ${id} is in this part but no slide cites it`));

  // Per-type limits (the pack's per-lecture max, per part), runs and order.
  const types = S.map((s) => s.slide_type);
  for (const [t, lim] of Object.entries(ctx.pack.types || {})) {
    const n = types.filter((x) => x === t).length;
    if (lim.max != null && n > lim.max && ctx.types[t]) issues.push(issue('TYPE_MAX', 'error', '/slides', `${n} × ${t} in this part; at most ${lim.max}`));
  }
  const flow = ctx.pack.flow || {};
  let run = 1;
  for (let i = 1; i < types.length; i++) {
    run = types[i] === types[i - 1] ? run + 1 : 1;
    if (flow.maxConsecutiveSameType && run > flow.maxConsecutiveSameType) issues.push(issue('FLOW_REPEAT', 'error', at(i), `${run} × ${types[i]} in a row (max ${flow.maxConsecutiveSameType})`));
  }
  for (const [t, before] of Object.entries(flow.mustFollow || {})) {
    types.forEach((x, i) => { if (x === t && !before.includes(types[i - 1])) issues.push(issue('FLOW_ORDER', 'error', at(i), `slide ${i + 1}: a ${t} slide must come right after a ${before.join(' or ')} slide`)); });
  }
  const ends = cfg.summary.part_end_types.filter((t) => ctx.types[t]);
  if (types.length && ends.length && !ends.includes(types.at(-1))) issues.push(issue('PART_END', 'error', at(S.length - 1), `part ${ctx.part} ends on a recap or a check: ${ends.join(' / ')}`));
  if (ctx.final) {
    let k = 0;
    for (let i = types.length - 1; i >= 0 && Q.has(types[i]); i--) k++;
    if (k < cfg.summary.final_questions) issues.push(issue('FINAL_QUESTIONS', 'error', '/slides', `the last part ends with at least ${cfg.summary.final_questions} question slides (has ${k})`));
  }
  return { plan: out, issues };
}
