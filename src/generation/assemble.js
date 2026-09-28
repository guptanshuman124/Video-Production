// Assemble one lecture's validated layer outputs into Content JSON v1.

import { checkContract } from '../contracts/index.js';
import { requiredMarkers } from '../slides.js';
import { lectureTitleOf } from './openers.js';

export function assembleLecture(G, { plan, slides, english, hinglish, gates, promptHashes }) {
  const { prepared, lecture, types } = G;
  const catalog = new Map(prepared.images.map((im) => [im.id, im]));
  const ch = prepared.chapter;
  const content = {
    version: 1,
    chapter_id: ch.chapter_id,
    lecture: lecture.index,
    pack: ch.pack,
    variant: ch.variant ?? null,
    class: ch.class,
    subject: ch.subject,
    // The course-table lecture name; without one, the planner's clean title
    // (source headings can be garbled, e.g. "TRANSPORT ANSPORTATION").
    title: lectureTitleOf(G, plan),
    slide_language: ch.slide_language || 'english',
    source: prepared.lecture ? { course_id: prepared.lecture.course_id, module_id: prepared.lecture.module_id, lecture_id: prepared.lecture.lecture_id } : null,
    slides: slides.map((s, i) => {
      const p = plan.slides[i];
      const st = types[s.slide_type];
      const img = p.image_id ? catalog.get(p.image_id) : null;
      return {
        slide_number: i + 1,
        slide_type: s.slide_type,
        template: st.templateId,
        title: s.data.title || p.title,
        data: s.data,
        image: img ? { id: img.id, url: img.url, caption: s.data.caption || img.description.slice(0, 60) } : null,
        narration: { english: english ? english[i] : null, hinglish: hinglish[i] },
        markers: requiredMarkers(st.spec, s.data),
        source_refs: p.source_refs,
      };
    }),
    meta: { model: G.llm.model, prompt_hashes: promptHashes, gates, created_at: new Date().toISOString() },
  };
  return { content, issues: checkContract('content-v1', content) };
}
