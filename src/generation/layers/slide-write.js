// L3 — slide writer: planned slides -> template data, a few slides per call.

import { llmSchema } from '../../slides.js';
import { gateSlides } from '../../validators/generation.js';
import { systemPrompt, typeSpecs } from '../prompts.js';
import { perSlideWithRepair, batchRepairText } from '../repair.js';
import { tooLongTargets, shortenStrings, applyShortened } from '../shorten.js';
import { fillOpeners } from '../openers.js';

// opts.indices: only these slides (1-based); opts.initial: review findings to fix first.
export async function writeSlides(G, plan, opts = {}) {
  const { cfg, llm, prepared, lecture, types, packId } = G;
  const catalog = new Map(prepared.images.map((im) => [im.id, im]));
  const unit = `${prepared.chapter.chapter_id}/L${lecture.index}`;
  const indices = opts.indices || plan.slides.map((_, i) => i + 1);
  const sectionText = G.sectionText;

  const runBatch = async (batch, repair, attempt) => {
    const batchTypes = Object.fromEntries(batch.map((i) => plan.slides[i - 1].slide_type).map((t) => [t, types[t]]));
    const schema = {
      type: 'object', additionalProperties: false, required: ['slides'],
      properties: {
        slides: {
          type: 'array',
          items: {
            anyOf: Object.values(batchTypes).map((st) => ({
              type: 'object', additionalProperties: false, required: ['index', 'slide_type', 'data'],
              properties: { index: { type: 'integer' }, slide_type: { type: 'string', enum: [st.type] }, data: llmSchema(st) },
            })),
          },
        },
      },
    };
    const user = batch.map((i) => {
      const p = plan.slides[i - 1];
      const img = p.image_id ? catalog.get(p.image_id) : null;
      return [
        `## Slide ${i} — ${p.slide_type}`,
        `Title: ${p.title}`,
        `Purpose: ${p.purpose}`,
        `Key points:\n${p.key_points.map((k) => `- ${k}`).join('\n')}`,
        img ? (img.description ? `Image shown on this slide: ${img.description}` : 'An image is shown on this slide, but it has no description: set `caption` to null.') : 'No image on this slide.',
        `Source (${p.source_refs.join(', ') || 'lecture overview'}):\n${p.source_refs.map((r) => sectionText[r]).join('\n\n') || lecture.goals.join('; ')}`,
      ].join('\n');
    }).join('\n\n') + batchRepairText(repair, batch);

    const res = await llm.call({
      task: 'slide-write', unit: `${unit}/s${batch.join(',')}`,
      system: systemPrompt('slide-write', G.vars, [`# SLIDE TYPE SPECS\n\n${typeSpecs(batchTypes, packId)}`]),
      user, schema, schemaName: 'slides', salt: attempt,
      context: { slides: batch.map((i) => ({ index: i, st: types[plan.slides[i - 1].slide_type], plan: plan.slides[i - 1] })),
                 words: batch.flatMap((i) => plan.slides[i - 1].source_refs.map((r) => sectionText[r])).join(' ').split(/\s+/) },
    });
    const map = new Map((res.data.slides || []).filter((s) => batch.includes(s.index)).map((s) => [s.index, s]));
    // Strings over their word limit are shortened on their own (one small
    // call) before any whole-slide repair is spent on them.
    for (const [i, raw] of map) {
      const targets = tooLongTargets(checkOne(i, raw).issues, raw.data || {});
      if (!targets.length) continue;
      const short = await shortenStrings(llm, targets, { unit: `${unit}/s${i}`, system: 'You edit on-screen text for CBSE lecture slides. Be precise and concise.' });
      map.set(i, { ...raw, data: applyShortened(raw.data, short) });
    }
    return { map, promptHash: res.promptHash };
  };

  const checkOne = (i, raw) => {
    const r = gateSlides([{ slide_type: raw.slide_type, data: raw.data }], [plan.slides[i - 1]], types, sectionText, { slideLanguage: prepared.chapter.slide_language });
    const where = `s${String(i).padStart(2, '0')}`;
    return { value: r.slides[0], issues: r.issues.map((x) => ({ ...x, path: x.path.replace(/^s01/, where), message: x.message.replace(/^s01/, where) })) };
  };

  // codeOnly types (the intro title card) have nothing for the model to write:
  // code builds them, fillOpeners below adds the course-table facts.
  const codeOnly = (i) => !!types[plan.slides[i - 1].slide_type]?.spec.codeOnly;
  const llmIndices = indices.filter((i) => !codeOnly(i));
  const { results, attempts, promptHashes } = llmIndices.length
    ? await perSlideWithRepair({ indices: llmIndices, cfg, runBatch, checkOne, initial: opts.initial })
    : { results: new Map(), attempts: 0, promptHashes: [] };
  for (const i of indices.filter(codeOnly)) results.set(i, checkOne(i, { slide_type: plan.slides[i - 1].slide_type, data: { title: 'Intro' } }));
  // Intro / chapter-index facts come from the course tables, not the model.
  const filled = fillOpeners(G, plan, indices.map((i) => results.get(i).value));
  return {
    value: filled,
    issues: indices.flatMap((i) => results.get(i).issues),
    attempts, promptHashes,
  };
}
