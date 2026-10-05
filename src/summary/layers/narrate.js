// S4 — summary narrator: one part's slides (its divider first; the video's
// title card too, in part 1) -> voice-over with reveal markers, in the
// course's narration language. Checked by the shared narration gate (G4
// rules: markers, length, question pause, script of the language).

import { markerGuide, stripNulls } from '../../slides.js';
import { gateNarration, pictureOf, pictureNote } from '../../validators/generation.js';
import { narrationExamples } from '../../generation/prompts.js';
import { perSlideWithRepair, batchRepairText } from '../../generation/repair.js';
import { wordFactorOf } from '../../generation/layers/narrate.js';
import { summaryPrompt } from '../prompts.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slides'],
  properties: { slides: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['index', 'narration'],
    properties: { index: { type: 'integer' }, narration: { type: 'string' } },
  } } },
};

// slides: this part's full slide list ([title], divider, content), each { slide_type, data };
// plan: the part's slide plan (its figures), the planned slides being the last of `slides`.
// opts.indices: only these (1-based within `slides`); opts.initial: review findings to fix first.
export async function narratePart(G, k, slides, plan, opts = {}) {
  const { cfg, llm, prepared, packId, outline } = G;
  const types = G.allTypes;   // the subject's types + the summary's own title card and divider
  const language = prepared.chapter.narration_language || 'hinglish';
  const wordFactor = wordFactorOf(cfg, language);
  // Revision narration is tighter than a lecture's (summary.narration_scale); the
  // title card and part dividers keep their own short ranges.
  const scale = cfg.summary.narration_scale ?? 1;
  const range = (st) => st.spec.narrationWords.map((w) => Math.round(w * wordFactor * (st.spec.codeOnly ? 1 : scale)));
  const n = outline.parts.length;
  const part = outline.parts[k];
  const unit = `${prepared.chapter.chapter_id}/P${k + 1}`;
  const indices = opts.indices || slides.map((_, i) => i + 1);
  const examples = narrationExamples(types, packId, language, G.vars.variant);
  const last = k === n - 1;
  // The picture each slide shows: the planner's NCERT figure, or the illustration.
  const catalog = new Map((prepared.images || []).map((im) => [im.id, im]));
  const lead = slides.length - (plan?.slides?.length ?? 0);
  const picture = (i) => {
    const p = i > lead ? plan.slides[i - lead - 1] : null;
    return pictureOf(p?.image_id ? catalog.get(p.image_id) : null, slides[i - 1].data);
  };

  const note = (s, i) => {
    if (s.slide_type === 'summary_title') return `SUMMARY TITLE CARD (about 40 seconds): welcome the student to the summary of chapter ${prepared.summary.chapter_number || ''} "${prepared.chapter.title}" — the whole chapter revised in ${n} parts — then name each part at its marker in one short line. No teaching yet.`;
    if (s.slide_type === 'summary_part') return `PART DIVIDER: one or two sentences — this is part ${k + 1} of ${n}, "${part.title}", and what it revises.${k ? ` (Part ${k} was "${outline.parts[k - 1].title}".)` : ''} No markers.`;
    if (last && i === slides.length) return 'LAST SLIDE OF THE VIDEO: end with one closing sentence wishing the student well for the exam.';
    return null;
  };

  const runBatch = async (batch, repair, attempt) => {
    const user = [
      `Chapter summary: "${prepared.chapter.title}" — part ${k + 1} of ${n}: ${part.title}.`,
      k + 1 < n ? `Next part: "${outline.parts[k + 1].title}" (do not revise it here).` : 'This is the last part of the video.',
      '',
      ...batch.map((i) => {
        const s = slides[i - 1];
        const st = types[s.slide_type];
        const guide = markerGuide(st.spec, s.data);
        return [
          `## Slide ${i} of ${slides.length} — ${s.slide_type}${st.spec.question ? ' (question slide)' : ''}`,
          `Content: ${JSON.stringify(stripNulls(s.data))}`,
          `Word range: ${range(st).join('–')} words`,
          pictureNote(picture(i)),
          note(s, i),
          guide.length ? `Markers, in this order:\n${guide.map((g) => `- {{${g.id}}} → ${g.what}`).join('\n')}` : 'Markers: none — everything is on screen from the start.',
        ].filter(Boolean).join('\n');
      }),
    ].join('\n') + batchRepairText(repair, batch);
    const res = await llm.call({
      task: 'summary-narrate', unit: `${unit}/s${batch.join(',')}`,
      system: summaryPrompt('narrate', { ...G.vars, narration_language: language }, [examples]),
      user, schema: SCHEMA, schemaName: 'summary_narration', salt: attempt,
      context: {
        language, lecture: 1,
        slides: batch.map((i) => ({ index: i, st: types[slides[i - 1].slide_type], range: range(types[slides[i - 1].slide_type]), data: slides[i - 1].data, markers: markerGuide(types[slides[i - 1].slide_type].spec, slides[i - 1].data) })),
        words: part.section_ids.map((id) => G.sectionText[id] || '').join(' ').split(/\s+/),
      },
    });
    return { map: new Map((res.data.slides || []).filter((s) => batch.includes(s.index)).map((s) => [s.index, s.narration])), promptHash: res.promptHash };
  };

  const checkOne = (i, text) => {
    const s = slides[i - 1];
    const where = `s${String(i).padStart(2, '0')}`;
    const st = types[s.slide_type];
    return { value: text, issues: gateNarration(String(text ?? ''), st, s.data, where, { language, wordFactor: wordFactor * (st.spec.codeOnly ? 1 : scale), picture: picture(i) }) };
  };

  const { results, attempts, promptHashes } = await perSlideWithRepair({ indices, cfg, runBatch, checkOne, initial: opts.initial });
  return { value: indices.map((i) => results.get(i).value), issues: indices.flatMap((i) => results.get(i).issues), attempts, promptHashes, language };
}
