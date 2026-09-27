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
  narrate: ['_base/role.md', 'profiles/cbse.md', '_base/continuity.md', '_base/narration.md', '_base/narration-style.md',
            'language/hinglish.md', 'pack:role.md', 'steps/narrator.md'],
  // narration.mode via-english: English draft, converted by the hinglish layer.
  'narrate-english': ['_base/role.md', 'profiles/cbse.md', '_base/continuity.md', '_base/narration.md', '_base/narration-style.md',
                      'language/english.md', 'pack:role.md', 'steps/narrator.md'],
  hinglish: ['language/hinglish.md', 'steps/hinglish-converter.md'],
  review: ['_base/role.md', 'profiles/cbse.md', 'pack:role.md', 'pack:notation.md', 'steps/reviewer.md'],
};

function resolve(entry, { pack, variant }) {
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
  const parts = mods.flatMap((m) => resolve(m, vars)).filter(Boolean);
  if (vars.slide_language === 'hindi' && SLIDE_TEXT_LAYERS.has(layer)) parts.push(read('language/slides-hindi.md'));
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
    const b = [lim.min != null && `at least ${lim.min}`, lim.max != null && `at most ${lim.max}`].filter(Boolean).join(', ');
    if (b) lines.push(`- ${t}: ${b} per lecture`);
  }
  if (f.firstLecture?.startsWith) lines.push(`- Lecture 1 starts with ${f.firstLecture.startsWith.join(' or ')}.`);
  if (f.everyLecture?.includes) lines.push(`- Every lecture includes ${f.everyLecture.includes.join(', ')}.`);
  if (f.everyLecture?.includesAnyOf) lines.push(`- Every lecture includes one of ${f.everyLecture.includesAnyOf.join(' / ')} (the recap).`);
  if (f.everyLecture?.endsWithAnyOf) lines.push(`- Every lecture ends with ${f.everyLecture.endsWithAnyOf.join(' / ')}.`);
  if (f.lastLecture?.minTrailingQuestions) lines.push(`- The last lecture ends with at least ${f.lastLecture.minTrailingQuestions} question slides in a row.`);
  if (f.maxConsecutiveSameType) lines.push(`- Never more than ${f.maxConsecutiveSameType} slides of the same type in a row.`);
  return `# FLOW RULES (checked by code)\n\n${lines.join('\n')}`;
}

function limits(lim) {
  const b = [];
  if (lim.required) b.push('required');
  if (lim.items) b.push(`${lim.items[0]}–${lim.items[1]} items`);
  if (lim.words) b.push(`≤ ${lim.words} words${lim.items ? ' each' : ''}`);
  if (lim.fields) b.push(`each item: { ${Object.entries(lim.fields).map(([k, l]) => `${k}${l.required ? '*' : ''}${l.words ? ` ≤${l.words}w` : ''}`).join(', ')} }`);
  if (lim.note) b.push(lim.note);
  return b.join('; ');
}

// Full field spec + example for the slide types in one batch.
export function typeSpecs(types, pack) {
  return Object.values(types).map((st) => {
    const s = st.spec;
    const fields = Object.entries({ title: { required: true, words: 8 }, ...s.fields }).map(([k, l]) => `  - \`${k}\`: ${limits(l)}`).join('\n');
    const ex = read(`packs/${pack}/examples/${st.type}.json`);
    const example = ex ? `\n  Example data:\n\`\`\`json\n${JSON.stringify(JSON.parse(ex).data, null, 1)}\n\`\`\`` : '';
    return `## ${st.type} — ${s.name}\n${s.use}\n${fields}${example}`;
  }).join('\n\n');
}

// Narration examples in the language being written: `narration_hinglish`
// for direct mode, `narration` (English) for via-english.
export function narrationExamples(types, pack, language = 'hinglish') {
  const out = [];
  for (const st of Object.values(types)) {
    const ex = read(`packs/${pack}/examples/${st.type}.json`);
    if (!ex) continue;
    const j = JSON.parse(ex);
    const text = language === 'hinglish' ? j.narration_hinglish : j.narration;
    if (text) out.push(`## Example — ${st.type}\n${text}`);
  }
  return out.length
    ? `# NARRATION EXAMPLES\n\nThese show marker placement, tone and script only. They are shorter than your slides' word ranges — your narration must still reach its own range.\n\n${out.join('\n\n')}`
    : null;
}
