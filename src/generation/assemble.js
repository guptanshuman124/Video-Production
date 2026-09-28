// Assemble one lecture's validated layer outputs into Content JSON v1.

import { checkContract } from '../contracts/index.js';
import { requiredMarkers } from '../slides.js';
import { lectureTitleOf } from './openers.js';

// Source images often have no description; older prepared data carries the
// placeholder text. Neither is a caption.
const PLACEHOLDER_CAPTION = /^\s*(no (description|caption)( available)?|not available|n\/?a|none|image|figure|photo|picture|null|undefined)?\s*\.?\s*$/i;
export const realCaption = (s) => (typeof s === 'string' && !PLACEHOLDER_CAPTION.test(s) ? s.trim() : null);

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
      // A caption is shown only when there is a real one — the writer's, else the
      // image's description — never an empty or "no description" placeholder.
      const caption = realCaption(s.data.caption) || (img ? realCaption(img.description?.slice(0, 60)) : null);
      const data = s.data.caption && !realCaption(s.data.caption) ? { ...s.data, caption: null } : s.data;
      return {
        slide_number: i + 1,
        slide_type: s.slide_type,
        template: st.templateId,
        title: s.data.title || p.title,
        data,
        // No caption → no `caption` key (Content JSON v1: optional string, never null).
        image: img ? { id: img.id, url: img.url, ...(caption ? { caption } : {}) } : null,
        narration: { english: english ? english[i] : null, hinglish: hinglish[i] },
        markers: requiredMarkers(st.spec, s.data),
        source_refs: p.source_refs,
      };
    }),
    meta: { model: G.llm.model, prompt_hashes: promptHashes, gates, created_at: new Date().toISOString() },
  };
  return { content, issues: checkContract('content-v1', content) };
}
