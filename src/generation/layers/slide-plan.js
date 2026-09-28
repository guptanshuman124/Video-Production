// L2 — slide planner: one lecture's sections -> slide list.

import { schemaOf } from '../../contracts/index.js';
import { gateLecturePlan } from '../../validators/generation.js';
import { needsImage, takesImage } from '../../slides.js';
import { fitsRatio } from '../prepare.js';
import { systemPrompt, slideCatalog, flowRules } from '../prompts.js';
import { callWithRepair } from '../repair.js';

export async function planLecture(G) {
  const { cfg, llm, prepared, lecture, pack } = G;
  // Types switched off in pack.json (max 0, e.g. chapter_index) are not offered to the planner.
  const types = Object.fromEntries(Object.entries(G.types).filter(([k]) => pack.types?.[k]?.max !== 0));
  const sections = lecture.section_ids.map((id) => prepared.sections.find((s) => s.id === id)).filter(Boolean);
  // Only images some image-taking type can actually show are offered.
  const ratios = [...new Set(Object.values(types).flatMap((st) => (takesImage(st.spec) ? st.spec.ratios : [])))];
  // Only real figures (not screenshots of problems, tables or equations) that some slot can show.
  const images = prepared.images.filter((im) => (im.kind || 'figure') === 'figure' && fitsRatio(im, ratios));
  const L = prepared.lecture || {};
  const chapterNo = L.chapter_number ? `Chapter ${L.chapter_number}: ` : '';

  const schema = schemaOf('lecture-plan');
  const item = schema.properties.slides.items;
  item.properties.slide_type = { type: 'string', enum: Object.keys(types) };
  item.properties.image_id = { type: ['string', 'null'], enum: [...images.map((im) => im.id), null] };

  const user = [
    `CHAPTER: ${chapterNo}${prepared.chapter.title}`,
    `LECTURE ${lecture.index} of ${G.lectures}: ${lecture.title}`,
    L.chapter_lectures?.length ? `Lectures in this chapter: ${L.chapter_lectures.map((t, i) => `${i + 1}. ${t}`).join(' · ')}` : '',
    lecture.goals?.length ? `Goals / keywords: ${lecture.goals.join('; ')}` : '',
    lecture.summary ? `Summary of this lecture (from the database; may be inaccurate — the sections below are the source of truth): ${lecture.summary}` : '',
    lecture.recap ? `Recap (previous lecture): ${lecture.recap}` : 'This is the first lecture of the chapter.',
    lecture.preview ? `Preview (next lecture — do not teach): ${lecture.preview}` : 'This is the last lecture of the chapter.',
    '',
    '# THIS LECTURE\'S SECTIONS',
    ...sections.map((s) => `## ${s.id} — ${s.heading}\n${s.text}`),
    '',
    '# IMAGE CATALOG (id · shape · size · description) — prefer sharp images; low-res ones look soft when shown large',
    images.length ? images.map((im) => `- ${im.id} · ${im.ratio} · ${im.width}×${im.height}px${im.lowRes ? ' (low-res)' : ''} · ${im.description}`).join('\n') : '(no images available — plan only types that work without one)',
  ].join('\n');

  const typeHints = Object.fromEntries(Object.entries(types).map(([k, st]) => [k, {
    needsImage: needsImage(st.spec), takesImage: takesImage(st.spec), fits: (im) => fitsRatio(im, st.spec.ratios),
  }]));

  return callWithRepair({
    llm, cfg,
    req: {
      task: 'slide-plan', unit: `${prepared.chapter.chapter_id}/L${lecture.index}`,
      system: systemPrompt('slide-plan', G.vars, [slideCatalog(types), flowRules(pack)]),
      user, schema, schemaName: 'lecture_plan',
      context: { lecture: lecture.index, lectures: G.lectures, sections, images, types: typeHints, budget: prepared.budget,
                 words: sections.map((s) => s.text).join(' ').split(/\s+/) },
    },
    check: (data) => {
      const r = gateLecturePlan(data, {
        lecture: lecture.index, lectures: G.lectures, sectionIds: lecture.section_ids,
        images, types, pack, budget: prepared.budget,
        lectureTitle: lecture.title, chapterTitle: prepared.chapter.title, chapterLectures: L.chapter_lectures || [],
        sectionHeadings: sections.map((x) => x.heading),
      });
      return { value: r.plan, issues: r.issues };
    },
  });
}
