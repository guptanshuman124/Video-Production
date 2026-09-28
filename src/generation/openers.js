// The opening slides carry facts the model must not invent: which lecture
// this is, of how many, in which chapter, and the chapter's real lecture list
// (from the course tables). Code writes those fields after the slide writer
// and before the narrator, so the narration talks about what is on screen.

const clip = (s, max) => {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trim()}…`;
};

// The title shown for this lecture: the course-table name when there is one,
// otherwise the planner's clean title.
export function lectureTitleOf(G, plan) {
  const L = G.prepared.lecture || {};
  return L.title_from_db ? L.title : (plan?.lecture_title || L.title || G.lecture.title);
}

export function fillOpeners(G, plan, slides) {
  const L = G.prepared.lecture || {};
  const chapter = G.prepared.chapter.title;
  return slides.map((s) => {
    if (!s?.data) return s;
    if (s.slide_type === 'intro') {
      return { ...s, data: {
        ...s.data,
        title: clip(lectureTitleOf(G, plan), 80),
        chapterName: clip(chapter, 100),
        ...(L.chapter_number ? { chapterNumber: L.chapter_number } : {}),
        lectureNumber: G.lecture.index,
        lectureCount: G.lectures,
      } };
    }
    if (s.slide_type === 'chapter_index' && L.chapter_lectures?.length) {
      const all = L.chapter_lectures;
      // The template holds 10 topics; a longer chapter lists 9 and "+ N more".
      const items = all.length <= 10 ? all : [...all.slice(0, 9), `+ ${all.length - 9} more lectures`];
      return { ...s, data: { ...s.data, title: clip(chapter, 40), items: items.map((t) => clip(t, 40)) } };
    }
    return s;
  });
}
