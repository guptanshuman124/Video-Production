// S0 — prepare a summary video (code only, no LLM): every lecture of one
// chapter in one input. Each lecture is prepared exactly as it is for its own
// video (generation/prepare.js: clean text, sections, measured images); here
// its sections are renamed L<n>.s<k> so the outline can cite any lecture,
// the figures are pooled, and the video's length and slide budget are set.

import { prepareLecture } from '../generation/prepare.js';
import { classBand, lectureMinutes, narrationLanguageOf } from '../curriculum/index.js';

const half = (x) => Math.round(x * 2) / 2;

// How long the summary runs: summary.target_minutes, but never longer than
// the chapter's lectures together (their own target lengths × max share),
// and never shorter than min_minutes unless the lectures themselves are.
export function summaryMinutes(lectureMinutesList, cfg) {
  const S = cfg.summary;
  const total = lectureMinutesList.reduce((a, b) => a + b, 0);
  const capped = Math.min(S.target_minutes, total * (S.max_share_of_lectures ?? 1));
  return half(Math.max(Math.min(S.min_minutes, total), capped));
}

// Slides for `minutes` of summary (summary.slide_minutes per slide).
export function slidesFor(minutes, cfg) {
  const [lo, hi] = cfg.summary.slide_minutes;
  const min = Math.max(2, Math.floor(minutes / hi));
  return { min, max: Math.max(min + 1, Math.ceil(minutes / lo)) };
}

// input: src/summary/input.js summaryInput(). Returns { prepared, issues }.
export async function prepareSummary(input, cfg, { offline = false, sizes = null, fetchImpl } = {}) {
  const issues = [];
  const lectures = [];
  const sections = [];
  const images = [];
  for (const [k, lec] of input.lectures.entries()) {
    const n = k + 1;
    const { prepared, issues: li } = await prepareLecture(lec, cfg, { offline, sizes, fetchImpl });
    for (const i of li) issues.push({ ...i, path: `/lectures/${n}${i.path || ''}`, message: `lecture ${n}: ${i.message}` });
    const ids = prepared.sections.map((s) => {
      const id = `L${n}.${s.id}`;
      sections.push({ ...s, id, lecture: n });
      return id;
    });
    for (const im of prepared.images) if (!images.some((x) => x.id === im.id)) images.push({ ...im, lecture: n });
    lectures.push({
      index: n, lecture_id: lec.lecture_id, title: lec.title, section_ids: ids,
      words: prepared.totalWords, minutes: lectureMinutes(prepared.totalWords, cfg),
    });
  }
  const minutes = summaryMinutes(lectures.map((l) => l.minutes), cfg);
  const totalWords = lectures.reduce((a, l) => a + l.words, 0);
  return {
    prepared: {
      kind: 'summary',
      chapter: {
        chapter_id: `c${input.course_id}-m${input.module_id}-summary`,
        title: input.chapter_title, class: input.class, subject: input.subject,
        pack: input.pack, variant: input.variant ?? null, slide_language: input.slide_language || 'english',
        narration_language: input.narration_language || narrationLanguageOf(input),
      },
      summary: {
        course_id: input.course_id, module_id: input.module_id, chapter_number: input.chapter_number ?? null,
        course_title: input.course_title ?? null, lectures,
        lectureMinutes: Math.round(lectures.reduce((a, l) => a + l.minutes, 0) * 10) / 10,
      },
      band: classBand(input.class || 12),
      budget: { minutes, ...slidesFor(minutes, cfg) },
      totalWords,
      sections,
      images,
    },
    issues,
  };
}
