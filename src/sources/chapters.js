// Chapter numbers. A chapter's number is its rank by modules.orders inside its
// course (one course = one book), offset by the course's `chapter_start` from
// config/courses.yaml. NCERT books printed in parts continue the numbering
// (Class 12 Mathematics Part II opens at Chapter 7, Integrals), so those
// courses set `chapter_start`; books that restart at 1 leave it out.

// modOrder: Map module_id -> modules.orders. Returns Map module_id -> chapter number.
export function chapterNumbers(modOrder, start = 1) {
  const first = Number.isInteger(Number(start)) && Number(start) > 0 ? Number(start) : 1;
  const ranked = [...modOrder.entries()].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  return new Map(ranked.map(([id], k) => [id, first + k]));
}
