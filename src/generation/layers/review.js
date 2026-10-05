// L6 — reviewer: reads the finished lecture against its source and reports
// problems. It never rewrites; its findings become gate issues (G6).

import { stripNulls } from '../../slides.js';
import { gateReview } from '../../validators/generation.js';
import { systemPrompt } from '../prompts.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: { issues: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['slide', 'code', 'severity', 'message'],
    properties: {
      slide: { type: ['integer', 'null'] },
      code: { type: 'string', enum: ['FACT', 'LEVEL', 'CONTINUITY', 'ANSWER', 'REPETITION', 'LANGUAGE', 'OTHER'] },
      severity: { type: 'string', enum: ['error', 'warning'] },
      message: { type: 'string' },
    },
  } } },
};

export async function reviewLecture(G, plan, slides, narration) {
  const { llm, prepared, lecture } = G;
  const user = [
    `LECTURE ${lecture.index} of ${G.lectures}: ${lecture.title}`,
    lecture.recap ? `Previous lecture covered: ${lecture.recap}` : '',
    lecture.preview ? `Next lecture covers: ${lecture.preview}` : '',
    '',
    '# SOURCE',
    ...lecture.section_ids.map((id) => `## ${id}\n${G.sectionText[id]}`),
    '',
    '# LECTURE',
    ...slides.map((s, i) => `## Slide ${i + 1} — ${s.slide_type}\nContent: ${JSON.stringify(stripNulls(s.data))}\nNarration: ${narration[i]}`),
  ].filter((x) => x !== '').join('\n');
  const res = await llm.call({
    task: 'review', unit: `${prepared.chapter.chapter_id}/L${lecture.index}`,
    system: systemPrompt('review', G.vars), user, schema: SCHEMA, schemaName: 'review', context: {},
  });
  return { value: res.data, issues: gateReview(res.data), promptHashes: [res.promptHash] };
}
