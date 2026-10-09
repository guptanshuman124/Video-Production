// The textbook database (tutorai) as pipeline input.
//
// One textbook_raw row = one lecture = one video. The course tables decide
// what is produced, in what order and under what names:
//   courses   title, is_active
//   modules   title (the chapter name), orders (chapter order), is_active
//   lectures  title, orders (order inside the chapter), is_active
// Rows whose lecture is inactive, missing from `lectures` (orphans), or whose
// chapter/course is inactive are left out. Lectures are ordered by
// modules.orders / lectures.orders, which gives each its position in the
// chapter ("lecture 3 of 6") and its neighbours, whose titles and section
// headings become the recap/preview. (Neighbours' `mini_lecture` summaries are
// not used for this: about a third are placeholder filler or describe another
// lecture — e.g. 2854 "Basic Properties of Electric Charge" is summarised as
// kinematics.)
//
// Course metadata for the pipeline (class, subject, pack…) comes from
// config/courses.yaml (curriculum/courses.js); unmapped courses stop at G0.
//
// Sources:
//   - the MySQL database, via TEXTBOOK_DB_URL (mysql://user:pass@host:3307/tutorai)
//   - a JSONL export (`hvr source export`), which carries the same joined
//     columns. An older export without them gets them from the database when
//     TEXTBOOK_DB_URL is set; otherwise it falls back to lecture_id order.

import fs from 'node:fs';
import readline from 'node:readline';
import { parseContent } from './content.js';
import { narrationLanguageOf } from '../curriculum/index.js';
import { chapterNumbers } from './chapters.js';

const SELECT = `SELECT t.content_id, t.course_id, t.module_id, t.lecture_id, t.content, t.keywords, t.mini_lecture,
  l.title AS lecture_title, l.orders AS lecture_order, l.is_active AS lecture_active,
  m.title AS module_title, m.orders AS module_order, m.is_active AS module_active,
  c.title AS course_title, c.is_active AS course_active
  FROM textbook_raw t
  LEFT JOIN lectures l ON l.lecture_id = t.lecture_id
  LEFT JOIN modules m ON m.module_id = t.module_id
  LEFT JOIN courses c ON c.course_id = t.course_id`;
// Every textbook row of the courses that own the given modules, without content:
// chapter numbers rank against the whole course even when a run picks one chapter.
const COURSE_MODULES = `SELECT t.course_id, t.module_id, t.lecture_id,
  l.title AS lecture_title, l.is_active AS lecture_active,
  m.orders AS module_order, m.is_active AS module_active, c.is_active AS course_active
  FROM textbook_raw t
  LEFT JOIN lectures l ON l.lecture_id = t.lecture_id
  LEFT JOIN modules m ON m.module_id = t.module_id
  LEFT JOIN courses c ON c.course_id = t.course_id
  WHERE t.course_id IN (SELECT course_id FROM textbook_raw WHERE module_id IN (?))`;
const META_SELECT = `SELECT l.lecture_id, l.title AS lecture_title, l.orders AS lecture_order, l.is_active AS lecture_active,
  m.title AS module_title, m.orders AS module_order, m.is_active AS module_active,
  c.title AS course_title, c.is_active AS course_active
  FROM lectures l LEFT JOIN modules m ON m.module_id = l.module_id LEFT JOIN courses c ON c.course_id = l.course_id`;

// ---- reading rows ----------------------------------------------------------------------

function matches(r, f) {
  return (!f.course || f.course.includes(Number(r.course_id)))
    && (!f.module || f.module.includes(Number(r.module_id)))
    && (!f.lecture || f.lecture.includes(Number(r.lecture_id)));
}

async function connect(url) {
  const { createConnection } = await import('mysql2/promise');
  return createConnection({ uri: url, charset: 'utf8mb4' });
}

export async function rowsFromFile(file, filter = {}) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const rows = [];
  const others = [];             // rows of other modules, for chapter numbering
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    // Lecture position needs the whole module, so filter by module/course only here.
    if (matches(r, { course: filter.course, module: filter.module })) rows.push(r);
    else if (filter.module && matches(r, { course: filter.course })) { delete r.content; others.push(r); }
  }
  if (filter.module) {
    const courses = new Set(rows.map((r) => Number(r.course_id)));
    rows.courseModules = others.filter((r) => courses.has(Number(r.course_id)));
  }
  return rows;
}

export async function rowsFromDb(url, filter = {}) {
  const conn = await connect(url);
  try {
    const where = [];
    const args = [];
    if (filter.course) { where.push(`t.course_id IN (${filter.course.map(() => '?').join(',')})`); args.push(...filter.course); }
    if (filter.module) { where.push(`t.module_id IN (${filter.module.map(() => '?').join(',')})`); args.push(...filter.module); }
    const [rows] = await conn.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.course_id, t.module_id, t.lecture_id`, args);
    const out = rows.map((r) => ({ ...r, keywords: typeof r.keywords === 'string' ? r.keywords : JSON.stringify(r.keywords ?? null) }));
    if (filter.module) [out.courseModules] = await conn.query(COURSE_MODULES, [filter.module]);
    return out;
  } finally {
    await conn.end();
  }
}

// Older exports have no lecture/module/course columns: fetch them.
async function attachMeta(rows, url) {
  if (!rows.length || 'lecture_title' in rows[0] || !url) return rows;
  const conn = await connect(url);
  try {
    const ids = [...new Set(rows.map((r) => Number(r.lecture_id)))];
    const [meta] = await conn.query(`${META_SELECT} WHERE l.lecture_id IN (${ids.map(() => '?').join(',')})`, ids);
    const byId = new Map(meta.map((m) => [Number(m.lecture_id), m]));
    const out = rows.map((r) => {
      const m = byId.get(Number(r.lecture_id));
      return m ? { ...r, ...m } : { ...r, lecture_title: null, lecture_active: null };
    });
    out.courseModules = rows.courseModules;
    return out;
  } finally {
    await conn.end();
  }
}

// source: 'db' (TEXTBOOK_DB_URL) or a .jsonl export.
export async function loadRows(source, filter = {}) {
  const url = process.env.TEXTBOOK_DB_URL;
  if (source === 'db') {
    if (!url) throw new Error('TEXTBOOK_DB_URL is not set (mysql://user:pass@host:port/tutorai)');
    return rowsFromDb(url, filter);
  }
  if (!source || !fs.existsSync(source)) throw new Error(`source "${source}" not found (a .jsonl export, or "db")`);
  return attachMeta(await rowsFromFile(source, filter), url);
}

// ---- rows -> lecture inputs ---------------------------------------------------------------

// ~490 mini_lecture rows are unfilled templates ("…related to [insert main
// topic]…"). Those must never reach a prompt or the voice-over: treat as absent.
const PLACEHOLDER = /\[[^\]]{0,80}\b(insert|specific|list|key|topics?|related|relevant|main|concepts?|terms?|terminology|subject|chapter|points?|details?|examples?)\b[^\]]{0,80}\]|lorem ipsum/i;
export const isPlaceholderSummary = (s) => !!s && PLACEHOLDER.test(s);
const cleanSummary = (s) => {
  const t = s ? String(s).replace(/\s+/g, ' ').trim() : '';
  return t.length >= 40 && !PLACEHOLDER.test(t) ? t : null;
};

function keywordsOf(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch { return []; }
}

// First heading, else the first words of the text — only used when the
// course tables have no title.
function titleOf(blocks) {
  const h = blocks.find((b) => b.kind === 'heading');
  const t = h ? h.text : (blocks.find((b) => b.kind === 'text')?.text || '').split(/[.!?।\n]/)[0];
  return t.replace(/^\s*lecture\s*\d+\s*[:.-]\s*/i, '').trim().slice(0, 80) || 'Untitled lecture';
}

// A neighbour lecture for recap/preview: its title and short section headings
// ("1.3 CONDUCTORS AND INSULATORS" -> "Conductors and Insulators").
export function outlineOf(title, blocks, max = 6) {
  const heads = [];
  for (const b of blocks) {
    if (b.kind !== 'heading') continue;
    const h = titleCase(String(b.text).replace(/^\s*(lecture\s*)?[\d.]+\s*[:.)-]?\s*/i, '').replace(/[:.]+$/, ''));
    if (!h || h.split(/\s+/).length > 8 || heads.some((x) => x.toLowerCase() === h.toLowerCase())) continue;
    if (title && h.toLowerCase() === String(title).toLowerCase()) continue;
    heads.push(h);
  }
  return heads.length ? `"${title}" — ${heads.slice(0, max).join('; ')}` : `"${title}"`;
}

// "TYPES OF CHEMICAL REACTIONS" -> "Types of Chemical Reactions"; titles
// that already have lower case are only trimmed. Known acronyms stay upper case.
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'vs', 'via']);
const ACRONYMS = new Set(['DNA', 'RNA', 'ATP', 'ADP', 'NADP', 'AC', 'DC', 'EMF', 'LED', 'LCD', 'SI', 'CGS', 'UV', 'IR', 'CNG', 'LPG', 'HIV', 'AIDS', 'STD', 'GDP', 'GNP', 'UN', 'UNO', 'USA', 'UK', 'EU', 'RBI', 'WTO', 'IMF', 'ISRO', 'MRI', 'ECG', 'BOD', 'CFC', 'PCR', 'IUPAC', 'VSEPR', 'VBT', 'CFT', 'NCERT', 'CBSE', 'SN1', 'SN2', 'E1', 'E2', 'MCQ', 'PH', 'IQ', 'NGO', 'SEZ', 'NITI', 'GST', 'LCM', 'HCF', 'AP', 'GP']);
export function titleCase(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const lower = (t.match(/\p{Ll}/gu) || []).length, upper = (t.match(/\p{Lu}/gu) || []).length;
  // Already mixed case ("Electric Charges And Fields"): only lower-case the small words.
  if (lower > upper * 0.25) return t.split(' ').map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ');
  return t.split(' ').map((orig, i) => {
    const bare = orig.replace(/[^\p{L}\p{N}]/gu, '');
    if (bare.toUpperCase() === 'PH') return orig.replace(/ph/i, 'pH');
    if (ACRONYMS.has(bare)) return orig;
    const w = orig.toLowerCase();
    if (i > 0 && SMALL.has(w)) return w;
    // Capitalise the first letter and after a hyphen or bracket — not after an apostrophe (Coulomb’s).
    return w.replace(/^([^\p{L}]*)(\p{L})/u, (m, a, b) => a + b.toUpperCase()).replace(/([-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}

const hasMeta = (r) => 'lecture_title' in r;
// Why a row is left out, or null. Only enforced when the course tables are known.
export function exclusionOf(r) {
  if (!hasMeta(r)) return null;
  if (r.lecture_active == null && r.lecture_title == null) return 'not in the lectures table (orphan row)';
  if (Number(r.lecture_active) === 0) return 'lecture is inactive';
  if (r.module_active != null && Number(r.module_active) === 0) return 'chapter is inactive';
  if (r.course_active != null && Number(r.course_active) === 0) return 'course is inactive';
  return null;
}

const byOrder = (a, b) => (Number(a.lecture_order ?? 1e9) - Number(b.lecture_order ?? 1e9)) || (Number(a.lecture_id) - Number(b.lecture_id));

// courseMeta(courseId) -> { class, subject, pack, variant, slide_language, … } | null
// opts.includeInactive: keep excluded rows too (for audits). Returns inputs;
// excluded rows are listed in the returned array's `excluded` property.
export function lectureInputs(rows, courseMeta, filter = {}, { includeInactive = false } = {}) {
  const excluded = [];
  const kept = rows.filter((r) => {
    const why = exclusionOf(r);
    if (why && !includeInactive) { excluded.push({ lecture_id: Number(r.lecture_id), course_id: Number(r.course_id), module_id: Number(r.module_id), reason: why }); return false; }
    return true;
  });

  // Chapter number: rank of the module's `orders` among the course's modules,
  // from the course's `chapter_start` (sources/chapters.js). A load filtered to
  // some modules carries the whole course's active modules in rows.courseModules.
  const moduleOrder = new Map();
  const addModule = (r) => {
    const c = Number(r.course_id);
    if (!moduleOrder.has(c)) moduleOrder.set(c, new Map());
    moduleOrder.get(c).set(Number(r.module_id), Number(r.module_order ?? r.module_id));
  };
  for (const r of rows.courseModules || []) if (!exclusionOf(r)) addModule(r);
  for (const r of kept) addModule(r);
  const numbers = new Map();
  const chapterNumber = (c, m) => {
    if (!numbers.has(c)) numbers.set(c, chapterNumbers(moduleOrder.get(c), courseMeta(c)?.chapter_start));
    return numbers.get(c).get(m);
  };

  const byModule = new Map();
  for (const r of kept) {
    const key = `${r.course_id}/${r.module_id}`;
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(r);
  }
  const out = [];
  for (const list of byModule.values()) {
    list.sort(byOrder);
    const parsed = list.map((r) => ({ r, ...parseContent(r.content ?? '') }));
    const lectureTitles = parsed.map(({ r, blocks }) => titleCase(r.lecture_title) || titleOf(blocks));
    const first = list[0];
    parsed.forEach(({ r, format, blocks }, i) => {
      if (filter.lecture && !filter.lecture.includes(Number(r.lecture_id))) return;
      const meta = courseMeta(Number(r.course_id));
      // Per-chapter pack (Science: physics/chemistry/biology) or variant
      // (Chemistry: organic/inorganic/physical) from courses.yaml `modules`.
      const mod = meta?.modules?.[r.module_id];
      const pack = mod?.pack ?? (meta?.pack === 'science' ? null : meta?.pack);
      out.push({
        lecture_id: Number(r.lecture_id),
        module_id: Number(r.module_id),
        course_id: Number(r.course_id),
        unmapped: !meta,
        ...(meta ? {
          class: meta.class, subject: meta.subject, pack, variant: mod?.variant ?? meta.variant ?? null,
          slide_language: meta.slide_language || 'english',
          narration_language: narrationLanguageOf(meta),
          ...(mod?.review ? { pack_review: true } : {}),
        } : {}),
        course_title: first.course_title ? String(first.course_title).trim() : null,
        chapter_title: meta?.chapters?.[r.module_id] || titleCase(first.module_title) || titleOf(parsed[0].blocks),
        chapter_number: chapterNumber(Number(r.course_id), Number(r.module_id)),
        title: meta?.lectures?.[r.lecture_id] || lectureTitles[i],
        title_from_db: !!(meta?.lectures?.[r.lecture_id] || r.lecture_title),
        chapter_lectures: lectureTitles,
        position: { index: i + 1, count: parsed.length },
        format,
        blocks,
        keywords: keywordsOf(r.keywords),
        summary: cleanSummary(r.mini_lecture),
        summary_placeholder: isPlaceholderSummary(r.mini_lecture),
        recap: i > 0 ? outlineOf(lectureTitles[i - 1], parsed[i - 1].blocks) : null,
        preview: i < list.length - 1 ? outlineOf(lectureTitles[i + 1], parsed[i + 1].blocks) : null,
      });
    });
  }
  out.excluded = excluded;
  return out;
}

// Export the joined rows to JSONL (for offline runs and audits).
export async function exportRows(url, file, filter = {}) {
  const rows = await rowsFromDb(url, filter);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}
