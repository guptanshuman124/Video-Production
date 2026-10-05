// S1 — summary outline: the WHOLE chapter (every lecture, every section) in
// one call -> the video's parts, each with its sections, minutes, key points
// and must-include items. Gate: summary/gates.js gateOutline.

import { callWithRepair } from '../../generation/repair.js';
import { summaryPrompt } from '../prompts.js';
import { gateOutline } from '../gates.js';

const str = { type: 'string' };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['parts'],
  properties: {
    parts: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'lectures', 'section_ids', 'minutes', 'key_points', 'must_include'],
      properties: {
        title: { ...str, description: 'on-screen part title, at most 6 words' },
        lectures: { type: 'array', items: { type: 'integer' } },
        section_ids: { type: 'array', items: str, description: 'section ids, in order; every section of the chapter in exactly one part' },
        minutes: { type: 'number' },
        key_points: { type: 'array', items: str, description: '6–12 concrete must-know points' },
        must_include: { type: 'array', items: str, description: 'exact definitions, formulas, dates, quotations, named examples, figures' },
      },
    } },
  },
};

export async function outlineSummary(G) {
  const { cfg, llm, prepared } = G;
  const S = prepared.summary;
  const chapterNo = S.chapter_number ? `Chapter ${S.chapter_number}: ` : '';
  const user = [
    `CHAPTER: ${chapterNo}${prepared.chapter.title} — Class ${prepared.chapter.class} ${prepared.chapter.subject}`,
    `SUMMARY LENGTH: about ${prepared.budget.minutes} minutes, in ${cfg.summary.parts[0]}–${cfg.summary.parts[1]} parts`,
    '',
    '# THE CHAPTER, LECTURE BY LECTURE',
    ...S.lectures.map((l) => [
      `## Lecture ${l.index}: ${l.title} (${l.words} words)`,
      ...l.section_ids.map((id) => { const s = G.sectionById.get(id); return `### ${id} — ${s.heading}\n${s.text}`; }),
    ].join('\n\n')),
  ].join('\n');
  return callWithRepair({
    llm, cfg,
    req: {
      task: 'summary-outline', unit: `${prepared.chapter.chapter_id}/outline`,
      system: summaryPrompt('outline', G.vars), user, schema: SCHEMA, schemaName: 'summary_outline',
      context: { sections: prepared.sections.map((s) => ({ id: s.id, heading: s.heading, words: s.words, lecture: s.lecture })), lectures: S.lectures, minutes: prepared.budget.minutes, parts: cfg.summary.parts },
    },
    check: (data) => gateOutline(data, { sections: prepared.sections, lectures: S.lectures, minutes: prepared.budget.minutes, cfg }),
  });
}
