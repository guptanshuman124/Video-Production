// L1 — chapter planner: sections -> lectures.

import { schemaOf } from '../../contracts/index.js';
import { gateChapterPlan } from '../../validators/generation.js';
import { systemPrompt } from '../prompts.js';
import { callWithRepair } from '../repair.js';

export async function planChapter(G) {
  const { cfg, llm, prepared } = G;
  const n = cfg.curriculum.lectures_per_chapter;
  const total = prepared.sections.reduce((a, s) => a + s.words, 0);
  const user = [
    `Chapter: ${prepared.chapter.title} (Class ${prepared.chapter.class} ${prepared.chapter.subject})`,
    `Total source words: ${total}; target per lecture ≈ ${Math.round(total / n)}.`,
    '',
    'SECTIONS (id · words · heading · opening):',
    ...prepared.sections.map((s) => `${s.id} · ${s.words}w · ${s.heading} · ${s.text.slice(0, 160).replace(/\s+/g, ' ')}…`),
  ].join('\n');

  return callWithRepair({
    llm, cfg,
    req: {
      task: 'chapter-plan', unit: prepared.chapter.chapter_id,
      system: systemPrompt('chapter-plan', G.vars), user,
      schema: schemaOf('chapter-plan'), schemaName: 'chapter_plan',
      context: { sections: prepared.sections, lectures: n },
    },
    check: (data) => { const r = gateChapterPlan(data, prepared, cfg); return { value: r.plan, issues: r.issues }; },
  });
}
