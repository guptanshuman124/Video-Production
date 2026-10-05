// The summary video's code-built slides (title card, part dividers) and the
// assembly of every part into Summary Content v1.

import { checkContract } from '../contracts/index.js';
import { requiredMarkers } from '../slides.js';
import { realCaption } from '../generation/assemble.js';

const clip = (s, max) => {
  const t = String(s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};
// Fixed template labels for the slide language (e.g. "Part" → "भाग").
const labelled = (st, lang, data) => ({ ...st.spec.defaults, ...(st.spec.labels?.[lang] || {}), ...data });

// The video's first slide: chapter, course, length and the parts' titles.
export function titleSlide(G) {
  const { prepared, outline } = G;
  const types = G.allTypes;
  const ch = prepared.chapter;
  const lang = ch.slide_language || 'english';
  const course = lang === 'hindi' ? `कक्षा ${ch.class} · ${ch.subject === 'Hindi' ? 'हिंदी' : ch.subject}` : `Class ${ch.class} · ${ch.subject}`;
  return {
    slide_type: 'summary_title',
    data: labelled(types.summary_title, lang, {
      title: clip(ch.title, 100),
      ...(prepared.summary.chapter_number ? { chapterNumber: prepared.summary.chapter_number } : {}),
      course,
      parts: outline.parts.slice(0, 8).map((p) => clip(p.title, 70)),
    }),
  };
}

// Part k's divider: "Part k+1 of n", its title and the lectures it brings together.
export function partSlide(G, k) {
  const { prepared, outline } = G;
  const types = G.allTypes;
  const p = outline.parts[k];
  const lang = prepared.chapter.slide_language || 'english';
  const titles = prepared.summary.lectures.filter((l) => p.lectures.includes(l.index)).map((l) => clip(l.title, 70));
  return {
    slide_type: 'summary_part',
    data: labelled(types.summary_part, lang, { title: clip(p.title, 80), partNumber: k + 1, partCount: outline.parts.length, covers: titles.slice(0, 6) }),
  };
}

// The part's full slide list as narrated and shown: [title card], divider, content.
export function partSlides(G, k, written) {
  return [...(k === 0 ? [titleSlide(G)] : []), partSlide(G, k), ...written];
}

// parts[k] = { plan, slides (full list from partSlides), narration (same length) }.
export function assembleSummary(G, parts, { gates = {} } = {}) {
  const { prepared, outline } = G;
  const types = G.allTypes;
  const catalog = new Map(prepared.images.map((im) => [im.id, im]));
  const ch = prepared.chapter;
  const slides = [];
  const partsOut = [];
  parts.forEach(({ plan, slides: list, narration }, k) => {
    const lead = list.length - plan.slides.length;   // code-built slides before the planned ones
    list.forEach((s, j) => {
      const st = types[s.slide_type];
      const p = j >= lead ? plan.slides[j - lead] : null;
      const img = p?.image_id ? catalog.get(p.image_id) : null;
      const caption = realCaption(s.data.caption) || (img ? realCaption(img.description?.slice(0, 60)) : null);
      const data = s.data.caption && !realCaption(s.data.caption) ? { ...s.data, caption: null } : s.data;
      if (s.slide_type === 'summary_part') partsOut.push({ index: k + 1, title: outline.parts[k].title, first_slide: slides.length + 1, slide_count: list.length - (k === 0 ? 1 : 0), lectures: outline.parts[k].lectures });
      slides.push({
        slide_number: slides.length + 1,
        slide_type: s.slide_type,
        template: st.templateId,
        title: String(s.data.title || p?.title || ''),
        data,
        image: img ? { id: img.id, url: img.url, ...(caption ? { caption } : {}) } : null,
        narration: { english: null, hinglish: narration[j] },
        markers: requiredMarkers(st.spec, s.data),
        source_refs: p?.source_refs || [],
        part: s.slide_type === 'summary_title' ? 0 : k + 1,
      });
    });
  });
  const content = {
    version: 1, kind: 'summary',
    chapter_id: ch.chapter_id, course_id: prepared.summary.course_id, module_id: prepared.summary.module_id,
    pack: ch.pack, variant: ch.variant ?? null, class: ch.class, subject: ch.subject, title: ch.title,
    chapter_number: prepared.summary.chapter_number ?? null,
    slide_language: ch.slide_language || 'english', narration_language: ch.narration_language || 'hinglish',
    minutes: prepared.budget.minutes,
    parts: partsOut, slides,
    meta: { model: G.llm.model, gates, created_at: new Date().toISOString() },
  };
  return { content, issues: checkContract('summary-content-v1', content) };
}
