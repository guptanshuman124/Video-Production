// S2 — part planner: one part of the outline -> its slide list, from the
// subject pack's slide types (minus the ones summaries never use). The part
// divider and the video's title card are added by code. Gate: gatePartPlan.

import { needsImage, takesImage } from '../../slides.js';
import { fitsRatio } from '../../generation/prepare.js';
import { slideCatalog } from '../../generation/prompts.js';
import { callWithRepair } from '../../generation/repair.js';
import { summaryPrompt, partRules } from '../prompts.js';
import { gatePartPlan } from '../gates.js';

const str = { type: 'string' };

export async function planPart(G, k) {
  const { cfg, llm, prepared, outline, types, pack } = G;
  const part = outline.parts[k];
  const n = outline.parts.length;
  const final = k === n - 1;
  const ratios = [...new Set(Object.values(types).flatMap((st) => (takesImage(st.spec) ? st.spec.ratios : [])))];
  // This part's figures: from its lectures, real figures only, in a shape some slot takes.
  const images = prepared.images.filter((im) => part.lectures.includes(im.lecture) && (im.kind || 'figure') === 'figure' && fitsRatio(im, ratios));
  const schema = {
    type: 'object', additionalProperties: false, required: ['slides'],
    properties: { slides: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['slide_type', 'title', 'purpose', 'key_points', 'source_refs', 'image_id'],
      properties: {
        slide_type: { type: 'string', enum: Object.keys(types) },
        title: str, purpose: str,
        key_points: { type: 'array', items: str },
        source_refs: { type: 'array', items: str },
        image_id: { type: ['string', 'null'], enum: [...images.map((im) => im.id), null] },
      },
    } } },
  };
  const vars = {
    ...G.vars, part: k + 1, part_title: part.title, part_minutes: part.minutes, slide_min: part.budget.min, slide_max: part.budget.max,
    part_end_types: cfg.summary.part_end_types.filter((t) => types[t]).join(' / '),
    final_note: final ? `- **This is the last part.** After its recap, end the video with at least ${cfg.summary.final_questions} question slides on the whole chapter (the chapter check).` : '',
  };
  const user = [
    `CHAPTER: ${prepared.chapter.title}`,
    `PART ${k + 1} of ${n}: ${part.title} — about ${part.minutes} min, ${part.budget.min}–${part.budget.max} slides`,
    '',
    '# THE WHOLE SUMMARY (for continuity — plan only this part)',
    ...outline.parts.map((p, i) => `${i + 1}. ${p.title}${i === k ? '  ← THIS PART' : ''} — ${p.key_points.slice(0, 4).join('; ')}`),
    '',
    '# THIS PART — key points',
    ...part.key_points.map((x) => `- ${x}`),
    '# THIS PART — must include',
    ...(part.must_include.length ? part.must_include.map((x) => `- ${x}`) : ['- (nothing extra)']),
    '',
    '# THIS PART\'S SECTIONS',
    ...part.section_ids.map((id) => { const s = G.sectionById.get(id); return `## ${id} — ${s.heading}\n${s.text}`; }),
    '',
    '# IMAGE CATALOG (id · shape · size · description)',
    images.length ? images.map((im) => `- ${im.id} · ${im.ratio} · ${im.width}×${im.height}px${im.lowRes ? ' (low-res)' : ''} · ${im.description || '(no description)'}`).join('\n') : '(no figures for this part — plan only types that work without one)',
  ].join('\n');
  const typeHints = Object.fromEntries(Object.entries(types).map(([t, st]) => [t, { needsImage: needsImage(st.spec), takesImage: takesImage(st.spec), fits: (im) => fitsRatio(im, st.spec.ratios) }]));
  const ctx = { part: k + 1, partCount: n, sectionIds: part.section_ids, images, types, pack, budget: part.budget, cfg, final };
  const r = await callWithRepair({
    llm, cfg,
    req: {
      task: 'summary-plan', unit: `${prepared.chapter.chapter_id}/P${k + 1}`,
      system: summaryPrompt('plan', vars, [slideCatalog(types), partRules(pack, types, { partEndTypes: cfg.summary.part_end_types, final, finalQuestions: cfg.summary.final_questions })]),
      user, schema, schemaName: 'summary_part_plan',
      context: { part: k + 1, parts: n, final, sections: part.section_ids.map((id) => G.sectionById.get(id)), images, types: typeHints, budget: part.budget,
                 endTypes: cfg.summary.part_end_types, finalQuestions: cfg.summary.final_questions, questionTypes: pack.questionTypes || ['mcq'] },
    },
    check: (data) => { const g = gatePartPlan(data, ctx); return { value: g.plan, issues: g.issues }; },
  });
  return r;
}
