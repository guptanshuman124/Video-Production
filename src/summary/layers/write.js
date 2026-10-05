// S3 — summary slide writer: one part's planned slides -> template data, a few
// slides per call. Checked by the shared per-slide content gate (G3 rules:
// template schema, word limits, item counts, LaTeX, numbers in the source).

import { llmSchema } from '../../slides.js';
import { gateSlides } from '../../validators/generation.js';
import { typeSpecs } from '../../generation/prompts.js';
import { perSlideWithRepair, batchRepairText } from '../../generation/repair.js';
import { tooLongTargets, shortenStrings, applyShortened } from '../../generation/shorten.js';
import { summaryPrompt } from '../prompts.js';

// opts.indices: only these slides (1-based within the part); opts.initial: review findings to fix first.
export async function writePart(G, k, plan, opts = {}) {
  const { cfg, llm, prepared, types, packId } = G;
  const catalog = new Map(prepared.images.map((im) => [im.id, im]));
  const unit = `${prepared.chapter.chapter_id}/P${k + 1}`;
  const indices = opts.indices || plan.slides.map((_, i) => i + 1);
  const sectionText = G.sectionText;
  const slideLanguage = prepared.chapter.slide_language;

  const checkOne = (i, raw) => {
    const r = gateSlides([{ slide_type: raw.slide_type, data: raw.data }], [plan.slides[i - 1]], types, sectionText, { slideLanguage });
    const where = `s${String(i).padStart(2, '0')}`;
    return { value: r.slides[0], issues: r.issues.map((x) => ({ ...x, path: x.path.replace(/^s01/, where), message: x.message.replace(/^s01/, where) })) };
  };

  const runBatch = async (batch, repair, attempt) => {
    const batchTypes = Object.fromEntries(batch.map((i) => plan.slides[i - 1].slide_type).map((t) => [t, types[t]]));
    const schema = {
      type: 'object', additionalProperties: false, required: ['slides'],
      properties: { slides: { type: 'array', items: { anyOf: Object.values(batchTypes).map((st) => ({
        type: 'object', additionalProperties: false, required: ['index', 'slide_type', 'data'],
        properties: { index: { type: 'integer' }, slide_type: { type: 'string', enum: [st.type] }, data: llmSchema(st) },
      })) } } },
    };
    const user = batch.map((i) => {
      const p = plan.slides[i - 1];
      const img = p.image_id ? catalog.get(p.image_id) : null;
      return [
        `## Slide ${i} — ${p.slide_type}`,
        `Title: ${p.title}`,
        `Purpose: ${p.purpose}`,
        `Key points:\n${p.key_points.map((x) => `- ${x}`).join('\n')}`,
        img ? (img.description ? `Image shown on this slide: ${img.description}` : 'An image is shown on this slide, but it has no description: set `caption` to null.') : 'No image on this slide.',
        `Source (${p.source_refs.join(', ') || 'this part'}):\n${p.source_refs.map((r) => sectionText[r]).filter(Boolean).join('\n\n') || G.outline.parts[k].key_points.join('; ')}`,
      ].join('\n');
    }).join('\n\n') + batchRepairText(repair, batch);
    const res = await llm.call({
      task: 'summary-write', unit: `${unit}/s${batch.join(',')}`,
      system: summaryPrompt('write', G.vars, [`# SLIDE TYPE SPECS\n\n${typeSpecs(batchTypes, packId, G.vars.variant)}`]),
      user, schema, schemaName: 'summary_slides', salt: attempt,
      context: { slides: batch.map((i) => ({ index: i, st: types[plan.slides[i - 1].slide_type], plan: plan.slides[i - 1] })),
                 words: batch.flatMap((i) => plan.slides[i - 1].source_refs.map((r) => sectionText[r] || '')).join(' ').split(/\s+/) },
    });
    const map = new Map((res.data.slides || []).filter((s) => batch.includes(s.index)).map((s) => [s.index, s]));
    for (const [i, raw] of map) {
      const targets = tooLongTargets(checkOne(i, raw).issues, raw.data || {});
      if (!targets.length) continue;
      const short = await shortenStrings(llm, targets, { unit: `${unit}/s${i}`, system: 'You edit on-screen text for CBSE revision slides. Be precise and concise.' });
      map.set(i, { ...raw, data: applyShortened(raw.data, short) });
    }
    return { map, promptHash: res.promptHash };
  };

  const { results, attempts, promptHashes } = await perSlideWithRepair({ indices, cfg, runBatch, checkOne, initial: opts.initial });
  return { value: indices.map((i) => results.get(i).value), issues: indices.flatMap((i) => results.get(i).issues), attempts, promptHashes };
}
