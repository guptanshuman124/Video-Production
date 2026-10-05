// Prompts of the summary pipeline: its own task modules (prompts/summary/),
// with the subject pack's knowledge (role, notation, slide usage) and the
// voice-over language module. Assembled by the shared composer.

import { composePrompt } from '../generation/prompts.js';

export const SUMMARY_LAYERS = {
  outline: ['summary/role.md', 'pack:role.md', 'summary/outline.md'],
  plan: ['summary/role.md', 'pack:role.md', 'pack:notation.md', 'pack:slide-usage.md', 'summary/planner.md'],
  write: ['summary/role.md', 'pack:role.md', 'pack:notation.md', 'summary/writer.md'],
  narrate: ['summary/role.md', '_base/narration.md', '_base/narration-style.md', 'lang:narration', 'pack:role.md', 'summary/narrator.md'],
  review: ['summary/role.md', 'pack:role.md', 'pack:notation.md', 'summary/reviewer.md'],
};

export function summaryPrompt(layer, vars, extra = []) {
  const mods = SUMMARY_LAYERS[layer];
  if (!mods) throw new Error(`no summary prompt layer "${layer}"`);
  return composePrompt(mods, vars, extra, { slideText: layer !== 'outline' });
}

// Per-part flow rules, as the planner reads them (checked by gates.js).
export function partRules(pack, types, { partEndTypes, final, finalQuestions }) {
  const lines = [];
  for (const t of Object.keys(types)) {
    const max = pack.types?.[t]?.max;
    if (max != null) lines.push(`- ${t}: at most ${max} in this part`);
  }
  const f = pack.flow || {};
  if (f.maxConsecutiveSameType) lines.push(`- Never more than ${f.maxConsecutiveSameType} slides of the same type in a row.`);
  for (const [t, before] of Object.entries(f.mustFollow || {})) if (types[t]) lines.push(`- A ${t} slide comes right after a ${before.join(' or ')} slide.`);
  lines.push(`- The part's last slide is one of: ${partEndTypes.filter((t) => types[t]).join(' / ')}.`);
  if (final) lines.push(`- This is the last part: it ends with at least ${finalQuestions} question slides in a row (${(pack.questionTypes || ['mcq']).filter((t) => types[t]).join(' / ')}) — the chapter check.`);
  return `# FLOW RULES FOR THIS PART (checked by code)\n\n${lines.join('\n')}`;
}
