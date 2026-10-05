// The summary video's input: one chapter = all of its lecture inputs
// (sources/textbook.js lectureInputs), in lecture order, plus the chapter's
// identity. Built from the same rows the lecture videos use.

import { lectureInputs } from '../sources/textbook.js';
import { packIssues } from '../curriculum/index.js';

const issue = (code, severity, path, message) => ({ code, severity, path, message });

// lectures: the lecture inputs of ONE chapter (any order).
export function summaryInput(lectures) {
  if (!lectures.length) throw new Error('a summary needs at least one lecture');
  const list = [...lectures].sort((a, b) => a.position.index - b.position.index);
  const f = list[0];
  return {
    kind: 'summary',
    course_id: f.course_id, module_id: f.module_id, unmapped: !!f.unmapped,
    class: f.class, subject: f.subject, pack: f.pack, variant: f.variant ?? null,
    slide_language: f.slide_language || 'english', narration_language: f.narration_language,
    chapter_title: f.chapter_title, chapter_number: f.chapter_number ?? null, course_title: f.course_title ?? null,
    ...(f.pack_review ? { pack_review: true } : {}),
    lectures: list,
  };
}

// Every chapter's summary input from source rows; filter { module: [ids] }.
export function summaryInputs(rows, courseMeta, filter = {}) {
  const all = lectureInputs(rows, courseMeta);
  const byModule = new Map();
  for (const l of all) {
    if (filter.module && !filter.module.includes(l.module_id)) continue;
    if (!byModule.has(l.module_id)) byModule.set(l.module_id, []);
    byModule.get(l.module_id).push(l);
  }
  return [...byModule.values()].map(summaryInput);
}

// S0, before preparing: is this chapter something we can make a summary of?
export function gateSummaryInput(input, installedPacks) {
  if (input.unmapped) return [issue('COURSE_UNMAPPED', 'error', '/course_id', `course ${input.course_id} is not in config/courses.yaml — class, subject and pack unknown`)];
  if (!input.pack) return [issue('MODULE_PACK_UNKNOWN', 'error', '/pack', `chapter ${input.module_id} of course ${input.course_id} has no pack`)];
  const issues = [...packIssues(input, installedPacks)];
  if (!input.lectures?.length) issues.push(issue('NO_LECTURES', 'error', '/lectures', 'the chapter has no lectures in the source tables'));
  if (input.pack_review) issues.push(issue('PACK_NEEDS_REVIEW', 'warning', '/pack', `chapter ${input.module_id}: pack "${input.pack}" was auto-classified with low confidence — confirm it in config/courses.yaml`));
  return issues;
}

// S0, after preparing.
export function gatePreparedSummary(prepared, cfg) {
  const issues = [];
  if (prepared.totalWords < 300) issues.push(issue('TOO_LITTLE_SOURCE', 'error', '/content', `only ${prepared.totalWords} words of teaching text in the whole chapter — too little for a summary video`));
  if (!prepared.sections.length) issues.push(issue('NO_SECTIONS', 'error', '/sections', 'no readable sections in any lecture'));
  if (prepared.budget.minutes < cfg.summary.target_minutes) {
    issues.push(issue('SHORT_CHAPTER', 'warning', '/budget', `the chapter's lectures run ~${prepared.summary.lectureMinutes} min together, so the summary is ${prepared.budget.minutes} min (target ${cfg.summary.target_minutes})`));
  }
  return issues;
}
