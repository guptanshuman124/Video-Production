// Slide types: the bridge between templates and the generation layer.
//
// A template declares the slide type(s) it renders in `meta.slide` (an object
// or a list of them). That one spec is the source of truth for:
//
//   - the structured-output schema the LLM fills        (llmSchema)
//   - the content checks on what comes back              (checkSlideData)
//   - the narration markers the narrator must place     (requiredMarkers)
//   - the cue times written into the template's data    (applyCues)
//   - the catalog line the slide planner reads           (catalogLine)
//
// Spec shape:
//
//   slide: {
//     type: 'definition',                 // slide_type the planner picks
//     name: 'Definition', use: 'when to pick it (one line)',
//     image: 'none' | 'optional' | 'required', ratios: ['3:4', '1:1'],
//     fields: {                            // what the LLM writes, with limits
//       definition: { required: true, words: 30 },
//       points: { items: [0, 3], words: 12 },
//       rows: { items: [0, 4], words: 8 },            // list of lists: words per cell
//       sections: { items: [1, 3], fields: { heading: { words: 6 } } },
//     },
//     reveal: [                            // spoken order; marker b<k> per entry
//       { field: 'definition', cue: 'cues.definition' },
//       { field: 'points', each: true, cue: 'cues.points' },          // b2.1, b2.2 …
//       { field: 'rows', each: true, parts: ['myth', 'fact'], cue: 'cues.rows' }, // b1.1.1 …
//     ],
//     derive: [{ cue: 'cues.table', from: 'cues.rows', index: 0, offset: -0.6 }],
//     narrationWords: [220, 320], question: false,
//     defaults: { problemLabel: 'QUESTION' }, rules: ['tableShape'],
//   }

import { validate } from './templates.js';
import katex from 'katex';
import { wrapBareMath, mathOutside } from './validators/math.js';
import 'katex/contrib/mhchem';

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// ---- registry -----------------------------------------------------------------

// { <pack>: { <slide_type>: { type, templateId, spec, schema, check } } }
export function slideTypes(build) {
  const out = {};
  for (const t of Object.values(build.registry)) {
    const specs = [t.meta.slide || []].flat();
    if (!specs.length) continue;
    const pack = t.id.includes('/') ? t.id.split('/')[0] : null;
    if (!pack) continue;
    for (const spec of specs) {
      out[pack] ??= {};
      if (out[pack][spec.type]) {
        throw new Error(`slide type "${spec.type}" is declared by both ${out[pack][spec.type].templateId} and ${t.id}`);
      }
      out[pack][spec.type] = { type: spec.type, templateId: t.id, spec: normSpec(spec), schema: t.schema, check: t.check };
    }
  }
  return out;
}

function normSpec(s) {
  return {
    name: s.type, use: '', image: 'none', ratios: [], fields: {}, reveal: [], derive: [],
    narrationWords: [200, 320], question: false, defaults: {}, rules: [], ...s,
  };
}

export const needsImage = (spec) => spec.image === 'required';
export const takesImage = (spec) => spec.image !== 'none';

// ---- LLM output schema ----------------------------------------------------------

function norm(spec) {
  if (typeof spec === 'string') {
    const required = spec.endsWith('!');
    return { type: required ? spec.slice(0, -1) : spec, required };
  }
  if (Array.isArray(spec)) return { type: 'list', of: spec[0] };
  if (spec && !spec.type) return { type: 'object', fields: spec };
  return spec;
}

const nullable = (s, optional) => (optional ? { ...s, type: [s.type, 'null'].flat() } : s);

function limitText(lim = {}) {
  const bits = [];
  if (lim.items) bits.push(`${lim.items[0]}–${lim.items[1]} items`);
  if (lim.words) bits.push(`max ${lim.words} words${lim.items ? ' each' : ''}`);
  if (lim.note) bits.push(lim.note);
  return bits.join('; ');
}

// Template schema field -> OpenAI strict-mode JSON Schema (only keywords strict
// mode accepts; limits go in `description` and are enforced by checkSlideData).
function toJson(field, lim = {}) {
  const f = norm(field);
  const desc = [f.description, limitText(lim)].filter(Boolean).join(' — ') || undefined;
  const d = (o) => (desc ? { ...o, description: desc } : o);
  switch (f.type) {
    case 'text': case 'color': return d({ type: 'string' });
    case 'number': return d({ type: 'number' });
    case 'boolean': return d({ type: 'boolean' });
    case 'enum': return d({ type: 'string', enum: f.values });
    case 'list': return d({ type: 'array', items: toJson(f.of, { words: lim.words, fields: lim.fields }) });
    case 'object': return d(objectSchema(f.fields, lim.fields || {}, Object.keys(f.fields)));
    default: return lim.json ? d(lim.json) : d({ type: 'string' });
  }
}

function objectSchema(fields, limits, keys) {
  const properties = {};
  for (const k of keys) {
    const f = norm(fields[k]);
    const lim = limits[k] || {};
    const optional = !(lim.required || f.required);
    properties[k] = nullable(lim.json || toJson(f, lim), optional);
  }
  return { type: 'object', additionalProperties: false, required: keys, properties };
}

// The `data` object the LLM writes for one slide of this type.
export function llmSchema(st) {
  const keys = ['title', ...Object.keys(st.spec.fields).filter((k) => k !== 'title')];
  const limits = { title: { required: true, words: 8 }, ...st.spec.fields };
  for (const k of keys) if (!st.schema[k]) throw new Error(`${st.templateId}: meta.slide field "${k}" is not in the template schema`);
  return objectSchema(st.schema, limits, keys);
}

// ---- content checks ---------------------------------------------------------------

export function stripNulls(v) {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  }
  return v;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// Named cross-field rules a spec can opt into.
export const RULES = {
  tableShape(d) {
    const cols = d.columns?.length ?? 0;
    const errs = [];
    if (d.rows?.length && !cols) errs.push('rows given without columns');
    (d.rows || []).forEach((r, i) => { if (Array.isArray(r) && r.length !== cols) errs.push(`rows[${i}] has ${r.length} cells, expected ${cols}`); });
    return errs;
  },
  mcq(d) {
    const errs = [];
    const n = d.options?.length ?? 0;
    if (n !== 4) errs.push(`an MCQ has exactly 4 options (got ${n})`);
    if (!d.answer) errs.push('answer is required');
    if ((d.wrong || []).length !== 1) errs.push('mark exactly one trap option in `wrong`');
    if (d.wrong?.[0] && d.wrong[0] === d.answer) errs.push('the trap option cannot be the answer');
    if (d.answer && LETTERS.indexOf(d.answer) >= n) errs.push(`answer "${d.answer}" is beyond the options`);
    return errs;
  },
  assertion(d) {
    const errs = [];
    if (!d.answer) errs.push('answer is required');
    if ((d.wrong || []).includes(d.answer)) errs.push('`wrong` cannot contain the answer');
    return errs;
  },
};

function checkWords(v, lim, path, issues) {
  if (v == null) return;
  if (Array.isArray(v)) {
    if (lim.items && (v.length < lim.items[0] || v.length > lim.items[1])) {
      issues.push({ code: 'ITEM_COUNT', severity: 'error', path, message: `${path}: ${v.length} items, allowed ${lim.items[0]}–${lim.items[1]}` });
    }
    v.forEach((x, i) => checkWords(x, { words: lim.words, fields: lim.fields }, `${path}[${i}]`, issues));
    return;
  }
  if (typeof v === 'object') {
    for (const [k, sub] of Object.entries(lim.fields || {})) checkWords(v[k], sub, `${path}.${k}`, issues);
    return;
  }
  // Word limits are a teaching guide with a 25% tolerance (warning); the hard
  // on-screen limit is the template's character `max`, checked separately.
  const n = words(v);
  if (lim.words && n > Math.floor(lim.words * 1.25)) {
    issues.push({ code: 'TOO_LONG', severity: 'error', path, message: `${path}: ${n} words, max ${lim.words}` });
  } else if (lim.words && n > lim.words) {
    issues.push({ code: 'TOO_LONG', severity: 'warning', path, message: `${path}: ${n} words, aim for ${lim.words}` });
  }
}

function texIssues(s, path) {
  const out = [];
  const spans = [...String(s).matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
  for (const tex of spans) {
    try { katex.renderToString(tex, { throwOnError: true }); } catch (e) {
      out.push({ code: 'BAD_LATEX', severity: 'error', path, message: `${path}: ${e.message.split('\n')[0]}` });
    }
  }
  return out;
}

// Names of spec fields that hold bare LaTeX (`latex: true`), including nested item fields.
function latexFields(fields = {}) {
  return Object.entries(fields).flatMap(([k, f]) => [...(f?.latex ? [k] : []), ...latexFields(f?.fields)]);
}

// Copy of v with every string replaced by fn(string, path).
function mapStrings(v, path, fn) {
  if (typeof v === 'string') return fn(v, path);
  if (Array.isArray(v)) return v.map((x, i) => mapStrings(x, `${path}[${i}]`, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, `${path}.${k}`, fn)]));
  return v;
}

function walkStrings(v, path, fn) {
  if (typeof v === 'string') fn(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}.${k}`, fn);
}

// Validates the LLM's `data` for one slide; returns { data, issues }. `data`
// is normalized (nulls stripped, spec defaults applied) and ready for build.
// formulaFields hold bare LaTeX (no $…$); every other string is text in which
// maths must sit inside $…$ — LaTeX left outside is wrapped here (LATEX_WRAPPED)
// when KaTeX can render it, otherwise it is an error the writer must fix.
export function checkSlideData(st, raw, { where = 'slide', formulaFields = ['formula', 'symbol'] } = {}) {
  const issues = [];
  // Plus every field the template marks `latex: true` (e.g. derivation `goal`), at any depth.
  const keys = [...formulaFields, ...latexFields(st.spec.fields)];
  const isFormula = (p) => keys.some((f) => p.endsWith(`.${f}`) || new RegExp(`\\.${f}\\[\\d+\\]$`).test(p));
  const data = mapStrings({ ...st.spec.defaults, ...stripNulls(raw || {}) }, where, (s, p) => {
    if (isFormula(p)) {
      // Bare LaTeX by design: drop stray $ delimiters (a literal \$ stays).
      const bare = s.replace(/(?<!\\)\$/g, '').trim();
      if (bare !== s) issues.push({ code: 'LATEX_UNWRAPPED', severity: 'warning', path: p, message: `${p}: $ delimiters removed from a maths field`, autoFixed: true });
      return bare;
    }
    const r = wrapBareMath(s);
    if (r.changed) issues.push({ code: 'LATEX_WRAPPED', severity: 'warning', path: p, message: `${p}: maths put inside $…$: "${r.text.slice(0, 80)}"`, autoFixed: true });
    const bare = mathOutside(r.text);
    if (bare.length) issues.push({ code: 'LATEX_OUTSIDE_MATH', severity: 'error', path: p, message: `${p}: LaTeX outside $…$ shows as raw text on screen (${bare.slice(0, 3).join(' ')}) — write maths as $…$, e.g. "$\\omega$ – angular speed (rad $s^{-1}$)"` });
    return r.text;
  });
  for (const k of Object.keys(data)) {
    if (k !== 'title' && !(k in st.spec.fields) && !(k in st.spec.defaults)) {
      issues.push({ code: 'UNKNOWN_FIELD', severity: 'error', path: `${where}.${k}`, message: `${where}: "${k}" is not a field of ${st.type}` });
    }
  }
  // Template-level shape and length limits (image is attached later, at build).
  const r = validate(st.schema, data, { where });
  for (const e of r.errors) issues.push({ code: 'TEMPLATE_SCHEMA', severity: 'error', path: where, message: e });
  const limits = { title: { required: true, words: 8 }, ...st.spec.fields };
  for (const [k, lim] of Object.entries(limits)) {
    if (lim.required && isEmpty(data[k])) issues.push({ code: 'MISSING_FIELD', severity: 'error', path: `${where}.${k}`, message: `${where}.${k} is required` });
    checkWords(data[k], lim, `${where}.${k}`, issues);
  }
  for (const name of st.spec.rules) {
    for (const m of RULES[name]?.(data) || [`unknown rule "${name}"`]) issues.push({ code: 'RULE', severity: 'error', path: where, message: `${where}: ${m}` });
  }
  if (!r.errors.length && st.check) {
    for (const m of [st.check(r.value) || []].flat()) issues.push({ code: 'TEMPLATE_CHECK', severity: 'error', path: where, message: `${where}: ${m}` });
  }
  walkStrings(data, where, (s, p) => {
    issues.push(...texIssues(s, p));
    if (isFormula(p)) {
      try { katex.renderToString(s, { throwOnError: true }); } catch (e) {
        issues.push({ code: 'BAD_LATEX', severity: 'error', path: p, message: `${p}: ${e.message.split('\n')[0]}` });
      }
    }
  });
  return { data, issues };
}

// ---- narration markers --------------------------------------------------------------

// Marker ids in the order they must be spoken, for this slide's actual data.
export function requiredMarkers(spec, data) {
  const out = [];
  spec.reveal.forEach((r, k) => {
    const v = data[r.field];
    if (isEmpty(v)) return;
    const id = `b${k + 1}`;
    if (!r.each) { out.push(id); return; }
    v.forEach((_, i) => {
      if (r.parts) r.parts.forEach((_, p) => out.push(`${id}.${i + 1}.${p + 1}`));
      else out.push(`${id}.${i + 1}`);
    });
  });
  return out;
}

// What each marker reveals, for the narrator's prompt: [{ id, what }].
export function markerGuide(spec, data) {
  const out = [];
  spec.reveal.forEach((r, k) => {
    const v = data[r.field];
    if (isEmpty(v)) return;
    const id = `b${k + 1}`;
    const brief = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.map(brief).join(' | ') : Object.values(x).filter((y) => typeof y === 'string').join(' — '));
    if (!r.each) { out.push({ id, what: `${r.field}: ${brief(v)}${r.hint ? ` — ${r.hint}` : ''}` }); return; }
    v.forEach((item, i) => {
      if (r.parts) r.parts.forEach((part, p) => out.push({ id: `${id}.${i + 1}.${p + 1}`, what: `${r.field}[${i + 1}].${part}: ${item[part] ?? ''}` }));
      else out.push({ id: `${id}.${i + 1}`, what: `${r.field}[${i + 1}]: ${brief(item)}` });
    });
  });
  return out;
}

export const MARKER_RE = /\{\{(b\d+(?:\.\d+){0,2})\}\}/g;
export const markersIn = (text) => [...String(text).matchAll(MARKER_RE)].map((m) => m[1]);
export const stripMarkers = (text) => String(text).replace(MARKER_RE, '').replace(/[ \t]{2,}/g, ' ').trim();

// ---- cues ----------------------------------------------------------------------------

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

// Writes cue times into `data` (copy returned). `times` maps marker id ->
// seconds into the slide's narration clip; `toAbs(t)` turns that into
// absolute video-timeline seconds (lead and scene offset applied by caller).
export function applyCues(spec, data, times, toAbs) {
  const out = structuredClone(data);
  const at = (id) => (times[id] == null ? null : toAbs(times[id]));
  spec.reveal.forEach((r, k) => {
    const v = out[r.field];
    if (isEmpty(v) || !r.cue) return;
    const id = `b${k + 1}`;
    if (!r.each) { const t = at(id); if (t != null) setPath(out, r.cue, t); return; }
    const list = v.map((_, i) => (r.parts
      ? r.parts.map((_, p) => at(`${id}.${i + 1}.${p + 1}`))
      : at(`${id}.${i + 1}`)));
    if (list.flat().some((t) => t != null)) setPath(out, r.cue, list);
  });
  for (const d of spec.derive) {
    let src = getPath(out, d.from);
    if (Array.isArray(src)) src = src[d.index ?? 0];
    if (Array.isArray(src)) src = src[0];
    if (typeof src === 'number') setPath(out, d.cue, Math.max(0, Math.round((src + (d.offset || 0)) * 100) / 100));
  }
  return out;
}

// ---- planner catalog -------------------------------------------------------------------

export function catalogLine(st) {
  const s = st.spec;
  const img = s.image === 'required' ? `needs an image (${s.ratios.join(' or ')})`
    : s.image === 'optional' ? `image optional (${s.ratios.join(' or ')})` : 'no image';
  const fields = Object.entries(s.fields).map(([k, l]) => `${k}${l.required ? '*' : ''}${l.items ? ` [${l.items.join('–')}]` : ''}`).join(', ');
  return `- ${st.type} — ${s.name}: ${s.use} (${img}; fields: ${fields}; narration ${s.narrationWords.join('–')} words${s.question ? '; question slide' : ''})`;
}
