// L5 — Hinglish converter: English narration -> mixed-script Hinglish for TTS.

import { gateHinglish } from '../../validators/generation.js';
import { systemPrompt } from '../prompts.js';
import { perSlideWithRepair, batchRepairText } from '../repair.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slides'],
  properties: { slides: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['index', 'hinglish'],
    properties: { index: { type: 'integer' }, hinglish: { type: 'string' } },
  } } },
};

export async function toHinglish(G, english) {
  const { cfg, llm, prepared, lecture } = G;
  const unit = `${prepared.chapter.chapter_id}/L${lecture.index}`;
  const indices = english.map((_, i) => i + 1);

  const runBatch = async (batch, repair, attempt) => {
    const user = batch.map((i) => `## Slide ${i}\n${english[i - 1]}`).join('\n\n') + batchRepairText(repair, batch);
    const res = await llm.call({
      task: 'hinglish', unit: `${unit}/s${batch.join(',')}`,
      system: systemPrompt('hinglish', G.vars), user, schema: SCHEMA, schemaName: 'hinglish', salt: attempt,
      context: { slides: batch.map((i) => ({ index: i, english: english[i - 1] })) },
    });
    return { map: new Map((res.data.slides || []).filter((s) => batch.includes(s.index)).map((s) => [s.index, s.hinglish])), promptHash: res.promptHash };
  };

  const checkOne = (i, text) => ({ value: text, issues: gateHinglish(english[i - 1], String(text ?? ''), `s${String(i).padStart(2, '0')}`) });

  const { results, attempts, promptHashes } = await perSlideWithRepair({ indices, cfg, runBatch, checkOne });
  return { value: indices.map((i) => results.get(i).value), issues: indices.flatMap((i) => results.get(i).issues), attempts, promptHashes };
}
