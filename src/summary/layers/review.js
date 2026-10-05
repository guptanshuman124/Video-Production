// S5 — summary reviewer: one finished part (slides + narration) against its
// sources and the outline's must-include items. Reports only; findings on
// specific slides send those slides back to the writer and narrator (run.js).

import { stripNulls } from '../../slides.js';
import { gateReview } from '../../validators/generation.js';
import { summaryPrompt } from '../prompts.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: { issues: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['slide', 'code', 'severity', 'message'],
    properties: {
      slide: { type: ['integer', 'null'] },
      code: { type: 'string', enum: ['FACT', 'COVERAGE', 'ANSWER', 'LEVEL', 'REPETITION', 'LANGUAGE', 'OTHER'] },
      severity: { type: 'string', enum: ['error', 'warning'] },
      message: { type: 'string' },
    },
  } } },
};

// slides / narration: the part's full lists (divider etc. included), numbered from 1.
export async function reviewPart(G, k, slides, narration) {
  const { llm, prepared, outline } = G;
  const part = outline.parts[k];
  const user = [
    `CHAPTER SUMMARY: "${prepared.chapter.title}" — part ${k + 1} of ${outline.parts.length}: ${part.title}`,
    '# MUST INCLUDE (this part)',
    ...(part.must_include.length ? part.must_include.map((x) => `- ${x}`) : ['- (nothing listed)']),
    '',
    '# SOURCE',
    ...part.section_ids.map((id) => `## ${id}\n${G.sectionText[id]}`),
    '',
    '# THIS PART OF THE VIDEO',
    ...slides.map((s, i) => `## Slide ${i + 1} — ${s.slide_type}\nContent: ${JSON.stringify(stripNulls(s.data))}\nNarration: ${narration[i]}`),
  ].join('\n');
  const res = await llm.call({
    task: 'summary-review', unit: `${prepared.chapter.chapter_id}/P${k + 1}`,
    system: summaryPrompt('review', G.vars), user, schema: SCHEMA, schemaName: 'summary_review', context: {},
  });
  return { value: res.data, issues: gateReview(res.data), promptHashes: [res.promptHash] };
}
