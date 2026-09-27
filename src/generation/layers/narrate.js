// L4 — narrator: slides -> voice-over with reveal markers.
//
// narration.mode direct (default): written straight in Hinglish, checked by
// G4 for teaching and script together — one LLM step.
// narration.mode via-english: an English draft, converted by L5 (hinglish.js).

import { markerGuide, stripNulls } from '../../slides.js';
import { gateNarration } from '../../validators/generation.js';
import { systemPrompt, narrationExamples } from '../prompts.js';
import { perSlideWithRepair, batchRepairText } from '../repair.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slides'],
  properties: { slides: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['index', 'narration'],
    properties: { index: { type: 'integer' }, narration: { type: 'string' } },
  } } },
};

export const narrationLanguage = (cfg) => ((cfg.narration?.mode || 'direct') === 'via-english' ? 'english' : 'hinglish');

// opts.indices: only these slides (1-based); opts.initial: review findings to fix first.
export async function narrateSlides(G, plan, slides, opts = {}) {
  const { cfg, llm, prepared, lecture, types, packId } = G;
  const language = narrationLanguage(cfg);
  const wordFactor = language === 'hinglish' ? (cfg.narration?.hinglish_word_factor ?? 1.1) : 1;
  const range = (st) => st.spec.narrationWords.map((w) => Math.round(w * wordFactor));
  const unit = `${prepared.chapter.chapter_id}/L${lecture.index}`;
  const indices = opts.indices || slides.map((_, i) => i + 1);
  const n = slides.length;
  const examples = narrationExamples(types, packId, language);

  const runBatch = async (batch, repair, attempt) => {
    const user = [
      lecture.recap ? `Recap of the previous lecture (for slide 1's callback only): ${lecture.recap}` : 'This is lecture 1 — no callback.',
      lecture.preview ? `Next lecture covers (for slide ${n}'s pointer only): ${lecture.preview}` : 'This is the last lecture — no forward pointer.',
      '',
      ...batch.map((i) => {
        const s = slides[i - 1];
        const st = types[s.slide_type];
        const guide = markerGuide(st.spec, s.data);
        return [
          `## Slide ${i} of ${n} — ${s.slide_type}${st.spec.question ? ' (question slide)' : ''}`,
          `Content: ${JSON.stringify(stripNulls(s.data))}`,
          `Word range: ${range(st).join('–')} words`,
          guide.length ? `Markers, in this order:\n${guide.map((g) => `- {{${g.id}}} → ${g.what}`).join('\n')}` : 'Markers: none — everything is on screen from the start.',
        ].join('\n');
      }),
    ].join('\n') + batchRepairText(repair, batch);

    const res = await llm.call({
      task: 'narrate', unit: `${unit}/s${batch.join(',')}`,
      system: systemPrompt(language === 'hinglish' ? 'narrate' : 'narrate-english', G.vars, [examples]),
      user, schema: SCHEMA, schemaName: 'narration', salt: attempt,
      context: {
        language,
        slides: batch.map((i) => ({ index: i, st: types[slides[i - 1].slide_type], range: range(types[slides[i - 1].slide_type]), data: slides[i - 1].data, markers: markerGuide(types[slides[i - 1].slide_type].spec, slides[i - 1].data) })),
        words: plan.slides.flatMap((p) => p.key_points).join(' ').split(/\s+/).concat(lecture.section_ids.map((id) => G.sectionText[id]).join(' ').split(/\s+/)),
      },
    });
    return { map: new Map((res.data.slides || []).filter((s) => batch.includes(s.index)).map((s) => [s.index, s.narration])), promptHash: res.promptHash };
  };

  const checkOne = (i, text) => {
    const s = slides[i - 1];
    return { value: text, issues: gateNarration(String(text ?? ''), types[s.slide_type], s.data, `s${String(i).padStart(2, '0')}`, { language, wordFactor, hindiSubject: prepared.chapter.slide_language === 'hindi' }) };
  };

  const { results, attempts, promptHashes } = await perSlideWithRepair({ indices, cfg, runBatch, checkOne, initial: opts.initial });
  return { value: indices.map((i) => results.get(i).value), issues: indices.flatMap((i) => results.get(i).issues), attempts, promptHashes, language };
}
