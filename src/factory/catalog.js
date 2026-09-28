// What can be produced, and in what order: every lecture in the course tables
// (the `tutorai` copy), grouped class → subject → book → chapter → lecture,
// with the same inclusion rules, titles and numbering as the pipeline
// (sources/textbook.js). No lecture content is read here — that happens when
// a lecture is handed to a worker (inputFor).

import path from 'node:path';
import mysql from 'mysql2/promise';
import { exclusionOf, titleCase, loadRows, lectureInputs } from '../sources/textbook.js';
import { courseLookup } from '../curriculum/courses.js';
import { loadPacks } from '../templates.js';

const SELECT = `SELECT t.lecture_id, t.course_id, t.module_id, CHAR_LENGTH(t.content) AS chars,
  l.title AS lecture_title, l.orders AS lecture_order, l.is_active AS lecture_active,
  m.title AS module_title, m.orders AS module_order, m.is_active AS module_active,
  c.title AS course_title, c.is_active AS course_active
  FROM textbook_raw t
  LEFT JOIN lectures l ON l.lecture_id = t.lecture_id
  LEFT JOIN modules m ON m.module_id = t.module_id
  LEFT JOIN courses c ON c.course_id = t.course_id`;

// Subjects in the order a class queue works through them.
const SUBJECT_ORDER = ['Science', 'Physics', 'Chemistry', 'Biology', 'Mathematics', 'Accountancy', 'Business Studies', 'Economics',
  'Social Science', 'History', 'Geography', 'Political Science', 'Sociology', 'English', 'Hindi'];
const subjectRank = (s) => { const i = SUBJECT_ORDER.indexOf(s); return i < 0 ? 99 : i; };
const PACK_NAMES = { theory: 'Theory subjects', mathematics: 'Mathematics', commerce: 'Commerce', science: 'Science' };

const byOrder = (a, b) => (Number(a.lecture_order ?? 1e9) - Number(b.lecture_order ?? 1e9)) || (Number(a.lecture_id) - Number(b.lecture_id));

// Windows-safe folder / file name part.
export const safeName = (s) => String(s ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120) || 'Untitled';

export async function loadCatalog(url = process.env.TEXTBOOK_DB_URL) {
  if (!url) throw new Error('TEXTBOOK_DB_URL is not set');
  const conn = await mysql.createConnection({ uri: url, charset: 'utf8mb4' });
  let rows;
  try { [rows] = await conn.query(SELECT); } finally { await conn.end(); }
  return buildCatalog(rows);
}

export function buildCatalog(rows, { meta = courseLookup(), packs = loadPacks() } = {}) {
  const installed = new Set(Object.keys(packs));
  const kept = rows.filter((r) => !exclusionOf(r));
  const lectures = new Map();          // lecture_id -> flat record
  const byCourse = new Map();
  for (const r of kept) {
    const c = Number(r.course_id);
    if (!byCourse.has(c)) byCourse.set(c, []);
    byCourse.get(c).push(r);
  }

  const classes = new Map();
  for (const [courseId, list] of byCourse) {
    const m = meta(courseId);
    if (!m || !m.class) continue;                 // not in config/courses.yaml → not offered
    // Chapter number: rank of modules.orders inside the course.
    const modOrder = new Map();
    for (const r of list) modOrder.set(Number(r.module_id), Number(r.module_order ?? r.module_id));
    const modules = [...modOrder.entries()].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0])).map(([id]) => id);
    const cls = classes.get(m.class) || { class_no: m.class, name: `Class ${m.class}`, subjects: new Map() };
    classes.set(m.class, cls);
    const subj = cls.subjects.get(m.subject) || { subject: m.subject, books: [] };
    cls.subjects.set(m.subject, subj);
    const book = { course_id: courseId, title: String(list[0].course_title || m.subject).trim(), chapters: [] };
    subj.books.push(book);

    modules.forEach((moduleId, k) => {
      const rowsOf = list.filter((r) => Number(r.module_id) === moduleId).sort(byOrder);
      const mod = m.modules?.[moduleId];
      const pack = mod?.pack ?? (m.pack === 'science' ? null : m.pack);
      const chapter = {
        module_id: moduleId, no: k + 1,
        title: m.chapters?.[moduleId] || titleCase(rowsOf[0].module_title) || `Chapter ${k + 1}`,
        pack, pack_review: !!mod?.review,
        supported: !!pack && installed.has(pack),
        why: !pack ? 'no template pack chosen for this chapter' : installed.has(pack) ? null : `${PACK_NAMES[pack] || pack} templates are not built yet`,
        lectures: [],
      };
      rowsOf.forEach((r, i) => {
        const lec = {
          lecture_id: Number(r.lecture_id), no: i + 1,
          title: m.lectures?.[r.lecture_id] || titleCase(r.lecture_title) || `Lecture ${i + 1}`,
          chars: Number(r.chars || 0),
        };
        chapter.lectures.push(lec);
      });
      book.chapters.push(chapter);
    });
  }

  // Sort, then give every lecture its place in its class queue (seq) and its library path.
  const out = [...classes.values()].sort((a, b) => a.class_no - b.class_no).map((cls) => {
    const subjects = [...cls.subjects.values()].sort((a, b) => (subjectRank(a.subject) - subjectRank(b.subject)) || a.subject.localeCompare(b.subject));
    for (const s of subjects) s.books.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }) || a.course_id - b.course_id);
    return { ...cls, subjects };
  });
  let seq = 0;
  for (const cls of out) {
    for (const s of cls.subjects) {
      const multiBook = s.books.length > 1;
      for (const b of s.books) {
        for (const ch of b.chapters) {
          for (const lec of ch.lectures) {
            const dir = [cls.name, safeName(s.subject), ...(multiBook ? [safeName(b.title)] : []), `Chapter ${ch.no} - ${safeName(ch.title)}`];
            lectures.set(lec.lecture_id, {
              lecture_id: lec.lecture_id, course_id: b.course_id, module_id: ch.module_id, class_no: cls.class_no,
              subject: s.subject, book: b.title, chapter_no: ch.no, chapter_title: ch.title,
              lecture_no: lec.no, lecture_count: ch.lectures.length, lecture_title: lec.title,
              pack: ch.pack, supported: ch.supported, why: ch.why, seq: ++seq,
              library_path: path.posix.join(...dir, `Lecture ${lec.no} - ${safeName(lec.title)}.mp4`),
            });
          }
        }
      }
    }
  }
  return { classes: out, lectures, at: new Date().toISOString() };
}

// The pipeline input for one lecture. The whole course is loaded so chapter
// numbers, neighbours and chapter lecture lists match the catalog.
export async function inputFor(lecture) {
  const rows = await loadRows('db', { course: [lecture.course_id] });
  const inputs = lectureInputs(rows, courseLookup(), { lecture: [lecture.lecture_id] });
  const input = inputs.find((i) => i.lecture_id === lecture.lecture_id);
  if (!input) throw new Error(`lecture ${lecture.lecture_id} is not in the source tables (inactive or removed)`);
  return input;
}
