// The textbook database (tutorai.textbook_raw) as pipeline input.
//
// One row = one lecture = one video. Rows are grouped by module (a chapter)
// and ordered by lecture_id, which gives each lecture its position in the
// chapter and its neighbours' `mini_lecture` summaries as free recap/preview.
//
// Course metadata (class, subject, pack…) is not in the table; it comes from
// config/courses.yaml (see curriculum/courses.js). Rows of unmapped courses are
// still produced, flagged `unmapped`, and stopped at G0.
//
// Sources:
//   - a JSONL export (one JSON row per line: content_id, course_id, module_id,
//     lecture_id, content, keywords, mini_lecture) — `hvr source export`
//   - the MySQL database directly, via TEXTBOOK_DB_URL
//     (mysql://user:pass@host:3307/tutorai)

import fs from 'node:fs';
import readline from 'node:readline';
import { parseContent } from './content.js';

const COLUMNS = 'content_id, course_id, module_id, lecture_id, content, keywords, mini_lecture';

// ---- reading rows ----------------------------------------------------------------------

function matches(r, f) {
  return (!f.course || f.course.includes(Number(r.course_id)))
    && (!f.module || f.module.includes(Number(r.module_id)))
    && (!f.lecture || f.lecture.includes(Number(r.lecture_id)));
}

export async function rowsFromFile(file, filter = {}) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    // Lecture position needs the whole module, so filter by module/course only here.
    if (matches(r, { course: filter.course, module: filter.module })) rows.push(r);
  }
  return rows;
}

export async function rowsFromDb(url, filter = {}) {
  const { createConnection } = await import('mysql2/promise');
  const conn = await createConnection({ uri: url, charset: 'utf8mb4' });
  try {
    const where = [];
    const args = [];
    if (filter.course) { where.push(`course_id IN (${filter.course.map(() => '?').join(',')})`); args.push(...filter.course); }
    if (filter.module) { where.push(`module_id IN (${filter.module.map(() => '?').join(',')})`); args.push(...filter.module); }
    const [rows] = await conn.query(
      `SELECT ${COLUMNS} FROM textbook_raw ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY course_id, module_id, lecture_id`, args);
    return rows.map((r) => ({ ...r, keywords: typeof r.keywords === 'string' ? r.keywords : JSON.stringify(r.keywords ?? null) }));
  } finally {
    await conn.end();
  }
}

// source: a .jsonl path, or 'db' (TEXTBOOK_DB_URL).
export async function loadRows(source, filter = {}) {
  if (source === 'db') {
    const url = process.env.TEXTBOOK_DB_URL;
    if (!url) throw new Error('TEXTBOOK_DB_URL is not set (mysql://user:pass@host:port/tutorai)');
    return rowsFromDb(url, filter);
  }
  if (!source || !fs.existsSync(source)) throw new Error(`source "${source}" not found (a .jsonl export, or "db")`);
  return rowsFromFile(source, filter);
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

// First heading, else the first words of the text: the lecture's working title
// until real lecture names are available.
function titleOf(blocks) {
  const h = blocks.find((b) => b.kind === 'heading');
  const t = h ? h.text : (blocks.find((b) => b.kind === 'text')?.text || '').split(/[.!?।\n]/)[0];
  return t.replace(/^\s*lecture\s*\d+\s*[:.-]\s*/i, '').trim().slice(0, 80) || 'Untitled lecture';
}

// courseMeta(courseId) -> { class, subject, pack, variant, slide_language, book } | null
export function lectureInputs(rows, courseMeta, filter = {}) {
  const byModule = new Map();
  for (const r of rows) {
    const key = `${r.course_id}/${r.module_id}`;
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(r);
  }
  const out = [];
  for (const list of byModule.values()) {
    list.sort((a, b) => Number(a.lecture_id) - Number(b.lecture_id));
    const parsed = list.map((r) => ({ r, ...parseContent(r.content ?? '') }));
    const chapterTitle = titleOf(parsed[0].blocks);
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
          ...(mod?.review ? { pack_review: true } : {}),
        } : {}),
        chapter_title: meta?.chapters?.[r.module_id] || chapterTitle,
        title: meta?.lectures?.[r.lecture_id] || titleOf(blocks),
        position: { index: i + 1, count: parsed.length },
        format,
        blocks,
        keywords: keywordsOf(r.keywords),
        summary: cleanSummary(r.mini_lecture),
        summary_placeholder: isPlaceholderSummary(r.mini_lecture),
        recap: i > 0 ? cleanSummary(list[i - 1].mini_lecture) : null,
        preview: i < list.length - 1 ? cleanSummary(list[i + 1].mini_lecture) : null,
      });
    });
  }
  return out;
}

// Export the table to JSONL (for offline runs and audits).
export async function exportRows(url, file, filter = {}) {
  const rows = await rowsFromDb(url, filter);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}
