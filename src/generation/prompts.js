// Prompt assembly. Prompts are markdown modules under prompts/; each layer's
// system prompt is a fixed list of modules plus text generated from the
// template specs (slide-type catalog, per-type field specs, examples), so the
// prompt and the validators always describe the same rules.
//
// {{name}} placeholders are filled from `vars`; unknown ones are left alone,
// which keeps narration markers like {{b1}} intact.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogLine } from '../slides.js';

export const PROMPTS_DIR = fileURLToPath(new URL('../../prompts/', import.meta.url));

const read = (rel) => {
  const f = path.join(PROMPTS_DIR, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
};

export const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));

// Modules per layer, in order. `pack:` entries resolve to prompts/packs/<pack>/…
// and, if present, prompts/packs/<pack>/variants/<variant>/… after it.
export const LAYERS = {
  'chapter-plan': ['_base/role.md', 'profiles/cbse.md', 'pack:role.md', 'steps/chapter-planner.md'],
  'slide-plan': ['_base/role.md', 'profiles/cbse.md', '_base/continuity.md', 'pack:role.md', 'pack:notation.md',
                 'pack:slide-usage.md', 'pack:flow.md', 'steps/slide-planner.md'],
  'slide-write': ['_base/role.md', 'profiles/cbse.md', 'pack:role.md', 'pack:notation.md', 'steps/slide-writer.md'],
  // narration.mode direct (default): Hinglish straight away.
  // Voiced narration in the course's language (lang:narration → language/<narration_language>.md).
  narrate: ['_base/role.md', 'profiles/cbse.md', '_base/continuity.md', '_base/narration.md', '_base/narration-style.md',
            'lang:narration', 'pack:role.md', 'steps/narrator.md'],
  // narration.mode via-english: English draft, converted by the hinglish layer.
  'narrate-english': ['_base/role.md', 'profiles/cbse.md', '_base/continuity.md', '_base/narration.md', '_base/narration-style.md',
                      'language/english.md', 'pack:role.md', 'steps/narrator.md'],
  hinglish: ['language/hinglish.md', 'steps/hinglish-converter.md'],
  review: ['_base/role.md', 'profiles/cbse.md', 'pack:role.md', 'pack:notation.md', 'steps/reviewer.md'],
};

// lang:narration — the voiced-language module: Hinglish, Hindi (Hindi courses)
// or spoken English (English courses).
const NARRATION_MODULE = { hinglish: 'language/hinglish.md', hindi: 'language/hindi.md', english: 'language/english-spoken.md' };

function resolve(entry, { pack, variant, narration_language: lang }) {
  if (entry === 'lang:narration') return [read(NARRATION_MODULE[lang] || NARRATION_MODULE.hinglish)];
  if (!entry.startsWith('pack:')) return [read(entry)];
  const name = entry.slice(5);
  return [read(`packs/${pack}/${name}`), variant ? read(`packs/${pack}/variants/${variant}/${name}`) : null];
}

// Layers that produce or read slide text get the Hindi slide rule for
// Hindi-subject courses.
const SLIDE_TEXT_LAYERS = new Set(['slide-plan', 'slide-write', 'narrate', 'narrate-english', 'review']);

export function systemPrompt(layer, vars, extra = []) {
  const mods = LAYERS[layer];
  if (!mods) throw new Error(`no prompt layer "${layer}"`);
  return composePrompt(mods, vars, extra, { slideText: SLIDE_TEXT_LAYERS.has(layer) });
}

// A system prompt from a list of modules (paths under prompts/, `pack:<name>`,
// `lang:narration`), filled with `vars`. Other pipelines (src/summary/) keep
// their own module lists and use this to assemble them.
export function composePrompt(mods, vars, extra = [], { slideText = false } = {}) {
  const parts = mods.flatMap((m) => resolve(m, vars)).filter(Boolean);
  if (vars.slide_language === 'hindi' && slideText) parts.push(read('language/slides-hindi.md'));
  return fill([...parts, ...extra.filter(Boolean)].join('\n\n---\n\n'), vars);
}

export function repairBlock(issues, previous) {
  const list = issues.filter((i) => i.severity === 'error').map((i) => `- [${i.code}] ${i.message}`).join('\n');
  return `\n\n---\n\n${read('_base/repair.md')}\n${list}\n\nYour previous answer:\n${JSON.stringify(previous)}`;
}

// ---- generated sections ---------------------------------------------------------

export function slideCatalog(types) {
  return `# SLIDE TYPES\n\n${Object.values(types).map(catalogLine).join('\n')}`;
}

export function flowRules(pack) {
  const f = pack.flow || {};
  const lines = [];
  for (const [t, lim] of Object.entries(pack.types || {})) {
    if (lim.max === 0) continue;   // switched off: not offered to the planner at all
    const b = [lim.min != null && `at least ${lim.min}`, lim.max != null && `at most ${lim.max}`].filter(Boolean).join(', ');
    if (b) lines.push(`- ${t}: ${b} per lecture`);
  }
  if (f.firstLecture?.startsWith) lines.push(`- Lecture 1 starts with ${f.firstLecture.startsWith.join(' or ')}.`);
  if (f.everyLecture?.includes) lines.push(`- Every lecture includes ${f.everyLecture.includes.join(', ')}.`);
  if (f.everyLecture?.includesAnyOf) lines.push(`- Every lecture includes one of ${f.everyLecture.includesAnyOf.join(' / ')} (the recap).`);
  if (f.everyLecture?.endsWithAnyOf) lines.push(`- Every lecture ends with ${f.everyLecture.endsWithAnyOf.join(' / ')}.`);
  if (f.lastLecture?.minTrailingQuestions) lines.push(`- The last lecture ends with at least ${f.lastLecture.minTrailingQuestions} question slides in a row.`);
  if (f.maxConsecutiveSameType) lines.push(`- Never more than ${f.maxConsecutiveSameType} slides of the same type in a row.`);
  for (const [t, before] of Object.entries(f.mustFollow || {})) lines.push(`- A ${t} slide comes right after a ${before.join(' or ')} slide.`);
  for (const [t, after] of Object.entries(f.mustPrecede || {})) if (pack.types?.[t]?.max !== 0) lines.push(`- A ${t} slide is followed right away by its worked solution: a ${after.join(' / ')} slide that solves exactly that problem.`);
  if (f.firstLecture?.opening?.length > 1) lines.push(`- Lecture 1 of a chapter opens: ${f.firstLecture.opening.join(' → ')}. Other lectures open with ${(f.everyLecture?.opening || ['intro']).join(' → ')}.`);
  return `# FLOW RULES (checked by code)\n\n${lines.join('\n')}`;
}

// Item fields of a list, nested lists included, with their notes:
// { date ≤4w, lines* [2–5] { account* ≤6w (…), … }, narration* ≤14w (…) }
function itemFields(fields) {
  return `{ ${Object.entries(fields).map(([k, l]) => `${k}${l.required ? '*' : ''}${l.items ? ` [${l.items.join('–')}]` : ''}${l.words ? ` ≤${l.words}w` : ''}`
    + `${l.fields ? ` ${itemFields(l.fields)}` : ''}${l.note ? ` (${l.note})` : ''}`).join(', ')} }`;
}

function limits(lim) {
  const b = [];
  if (lim.required) b.push('required');
  if (lim.items) b.push(`${lim.items[0]}–${lim.items[1]} items`);
  if (lim.words) b.push(`≤ ${lim.words} words${lim.items ? ' each' : ''}`);
  if (lim.fields) b.push(`each item: ${itemFields(lim.fields)}`);
  if (lim.note) b.push(lim.note);
  return b.join('; ');
}

// A slide type's prompt example: the variant's own (e.g. Hindi data for Hindi
// courses, prompts/packs/<pack>/variants/<variant>/examples/) before the pack's.
const exampleOf = (pack, variant, type) => (variant && read(`packs/${pack}/variants/${variant}/examples/${type}.json`)) || read(`packs/${pack}/examples/${type}.json`);

// Full field spec + example for the slide types in one batch.
export function typeSpecs(types, pack, variant = null) {
  return Object.values(types).map((st) => {
    const s = st.spec;
    const fields = Object.entries({ title: { required: true, words: 8 }, ...s.fields }).map(([k, l]) => `  - \`${k}\`: ${limits(l)}`).join('\n');
    const ex = exampleOf(pack, variant, st.type);
    const example = ex ? `\n  Example data:\n\`\`\`json\n${JSON.stringify(JSON.parse(ex).data, null, 1)}\n\`\`\`` : '';
    return `## ${st.type} — ${s.name}\n${s.use}\n${fields}${example}`;
  }).join('\n\n');
}

// Narration examples in the language being written: `narration_hinglish`
// (Hinglish), `narration_hindi` (Hindi courses), `narration` (English: English
// courses and the via-english draft).
const EXAMPLE_KEY = { hinglish: 'narration_hinglish', hindi: 'narration_hindi', english: 'narration' };
export function narrationExamples(types, pack, language = 'hinglish', variant = null) {
  const out = [];
  for (const st of Object.values(types)) {
    const ex = exampleOf(pack, variant, st.type);
    if (!ex) continue;
    const j = JSON.parse(ex);
    const text = j[EXAMPLE_KEY[language] || 'narration_hinglish'];
    if (text) out.push(`## Example — ${st.type}\n${text}`);
  }
  return out.length
    ? `# NARRATION EXAMPLES\n\nThese show marker placement, tone and script only. They are shorter than your slides' word ranges — your narration must still reach its own range.\n\n${out.join('\n\n')}`
    : null;
}
