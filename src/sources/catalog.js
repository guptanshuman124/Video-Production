// Course catalog from the source database: classes + subjects +
// class_subject_mapping (course_ids JSON) -> config/courses.yaml.
//
// The tables give each course its class and subject. Two things they don't
// give, and this module fills in as reviewable suggestions:
//   - Science (Classes 6–10) is one subject, but each chapter is rendered by
//     the physics, chemistry or biology pack;
//   - Class 11–12 Chemistry chapters need a variant (organic / inorganic / physical).
// Both come from a keyword classifier over the chapter's own text. Every
// guess is written to the YAML with its confidence; low-confidence chapters
// are marked `review: true`. Nothing is hidden: edit the YAML to correct it.

import fs from 'node:fs';
import readline from 'node:readline';
import { parseContent } from './content.js';

// subject_slug -> pack (null: decided per chapter). Economics is taught from the
// theory pack in every stream.
export const SUBJECT_PACK = {
  'social-science': 'theory', geography: 'theory', 'political-science': 'theory', economics: 'theory',
  sociology: 'theory', history: 'theory', english: 'language', hindi: 'language',
  mathematics: 'mathematics', science: null, biology: 'biology', physics: 'physics', chemistry: 'chemistry',
  'business-studies': 'commerce', accountancy: 'commerce',
};
const SUBJECT_VARIANT = { 'business-studies': 'business-studies', accountancy: 'accountancy', english: 'english', hindi: 'hindi' };

// ---- loading the catalog ------------------------------------------------------------

const SQL = `SELECT m.id, m.class_id, c.title AS class_title, c.class_slug, c.stream_id, c.exam_id,
  m.subject_id, s.title AS subject, s.subject_slug, m.is_active, m.course_ids
  FROM class_subject_mapping m LEFT JOIN classes c ON c.class_id = m.class_id
  LEFT JOIN subjects s ON s.subject_id = m.subject_id`;

export async function loadCatalog(source) {
  let rows;
  if (source === 'db') {
    const url = process.env.TEXTBOOK_DB_URL;
    if (!url) throw new Error('TEXTBOOK_DB_URL is not set');
    const { createConnection } = await import('mysql2/promise');
    const conn = await createConnection({ uri: url, charset: 'utf8mb4' });
    try { [rows] = await conn.query(SQL); } finally { await conn.end(); }
  } else {
    if (!source || !fs.existsSync(source)) throw new Error(`catalog "${source}" not found (a .jsonl export, or "db")`);
    rows = fs.readFileSync(source, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  return rows.map((r) => ({ ...r, course_ids: typeof r.course_ids === 'string' ? JSON.parse(r.course_ids) : r.course_ids || [] }));
}

export async function exportCatalog(url, file) {
  const { createConnection } = await import('mysql2/promise');
  const conn = await createConnection({ uri: url, charset: 'utf8mb4' });
  try {
    const [rows] = await conn.query(SQL);
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return rows.length;
  } finally { await conn.end(); }
}

// ---- chapter classifier ---------------------------------------------------------------

const KW = {
  physics: ['force', 'motion', 'velocity', 'speed', 'acceleration', 'energy', 'work done', 'power', 'light', 'reflection', 'refraction',
    'lens', 'mirror', 'sound', 'wave', 'frequency', 'electric', 'current', 'circuit', 'voltage', 'resistance', 'magnet', 'magnetic',
    'gravitation', 'gravity', 'pressure', 'friction', 'newton', 'momentum', 'shadow', 'distance', 'time period', 'pendulum', 'heat', 'thermometer', 'universe', 'stars', 'planets'],
  chemistry: ['atom', 'molecule', 'element', 'compound', 'chemical reaction', 'reaction', 'acid', 'base', 'salt', 'metal', 'non-metal',
    'carbon', 'oxide', 'mixture', 'solution', 'solute', 'periodic', 'valency', 'ion', 'bond', 'oxidation', 'reduction', 'ph', 'fuel',
    'combustion', 'polymer', 'fibre', 'plastic', 'corrosion', 'rusting', 'hydrogen', 'formula', 'equation', 'crystal', 'evaporation', 'separation', 'soluble'],
  biology: ['cell', 'tissue', 'organism', 'plant', 'animal', 'species', 'reproduction', 'nutrition', 'digestion', 'photosynthesis', 'blood',
    'heart', 'disease', 'bacteria', 'microorganism', 'gene', 'heredity', 'evolution', 'ecosystem', 'food chain', 'leaf', 'leaves', 'root',
    'seed', 'flower', 'hormone', 'organ', 'human body', 'kidney', 'excretion', 'forest', 'habitat', 'adaptation', 'insect', 'fungi', 'germination', 'breathing'],
};
const CHEM_KW = {
  organic: ['hydrocarbon', 'alkane', 'alkene', 'alkyne', 'alcohol', 'phenol', 'ether', 'aldehyde', 'ketone', 'carboxylic', 'amine',
    'benzene', 'haloalkane', 'haloarene', 'biomolecule', 'carbohydrate', 'protein', 'iupac', 'isomer', 'organic', 'functional group', 'nucleophilic'],
  inorganic: ['periodic table', 'periodicity', 's-block', 'p-block', 'd-block', 'f-block', 'transition element', 'lanthanoid', 'actinoid',
    'coordination compound', 'ligand', 'metallurgy', 'group 1', 'group 2', 'alkali metal', 'noble gas', 'halogen', 'boron', 'classification of elements'],
  physical: ['mole', 'stoichiometry', 'thermodynamic', 'enthalpy', 'entropy', 'equilibrium', 'kinetics', 'rate of reaction', 'rate constant',
    'order of reaction', 'colligative', 'molarity', 'electrochemistry', 'electrode', 'cell potential', 'nernst', 'atomic structure', 'quantum',
    'orbital', 'redox', 'gas law', 'solutions'],
};

function score(text, table) {
  const t = ` ${text.toLowerCase()} `;
  const out = {};
  for (const [k, words] of Object.entries(table)) {
    out[k] = words.reduce((a, w) => a + (t.split(new RegExp(`[^a-z]${w.replace(/[-]/g, '\\-')}s?[^a-z]`, 'g')).length - 1), 0);
  }
  return out;
}

// Pick the best-scoring key. confidence = share of the top score; review when
// the runner-up is close or there is little evidence.
export function classify(text, table) {
  const s = score(text, table);
  const ranked = Object.entries(s).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = ranked;
  const total = ranked.reduce((a, [, v]) => a + v, 0) || 1;
  const confidence = Math.round((top / total) * 100) / 100;
  return { label: best, confidence, review: top < 8 || top < second * 1.5 || confidence < 0.55, scores: s };
}

// ---- building courses.yaml ------------------------------------------------------------

const classNumber = (title) => Number(String(title || '').match(/\d+/)?.[0]) || null;

// catalog rows + textbook rows (for chapter text) -> { courses, report }.
export function buildCourses(catalog, textbookRows) {
  const byCourse = new Map();
  for (const r of catalog) {
    for (const id of r.course_ids || []) {
      if (!byCourse.has(id)) byCourse.set(id, []);
      byCourse.get(id).push(r);
    }
  }
  const tbByCourse = new Map();
  for (const r of textbookRows) {
    const c = Number(r.course_id);
    if (!tbByCourse.has(c)) tbByCourse.set(c, new Map());
    const mods = tbByCourse.get(c);
    if (!mods.has(r.module_id)) mods.set(r.module_id, []);
    mods.get(r.module_id).push(r);
  }

  const courses = {};
  const report = { mapped: 0, disabled: [], review: [], unmappedCourses: [], emptyCourses: [], conflicts: [] };
  for (const [id, rows] of [...byCourse.entries()].sort((a, b) => a[0] - b[0])) {
    const active = rows.filter((r) => r.is_active);
    const use = active.length ? active : rows;
    const subjects = [...new Set(use.map((r) => r.subject_slug))];
    const classes = [...new Set(use.map((r) => classNumber(r.class_title)))];
    if (subjects.length > 1 || classes.length > 1) report.conflicts.push({ id, subjects, classes });
    const r = use[0];
    const neet = r.exam_id !== 1 || /^neet/.test(r.subject_slug || '');
    const entry = {
      class: classes[0],
      subject: r.subject.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
      pack: neet ? null : (SUBJECT_PACK[r.subject_slug] === undefined ? null : SUBJECT_PACK[r.subject_slug]),
      variant: SUBJECT_VARIANT[r.subject_slug] ?? null,
      slide_language: r.subject_slug === 'hindi' ? 'hindi' : 'english',
      narration_language: r.subject_slug === 'hindi' ? 'hindi' : r.subject_slug === 'english' ? 'english' : 'hinglish',
      streams: [...new Set(use.map((x) => x.class_slug))],
      enabled: !neet,
    };
    if (neet) { entry.note = 'NEET-UG course — not part of the CBSE lecture series'; report.disabled.push(id); }

    const mods = tbByCourse.get(id);
    if (!mods) { report.emptyCourses.push(id); entry.enabled = false; entry.note = 'no lectures in textbook_raw'; }
    // Per-chapter pack (Science) or chemistry variant.
    const needsPack = !neet && r.subject_slug === 'science';
    const needsVariant = !neet && r.subject_slug === 'chemistry';
    if (mods && (needsPack || needsVariant)) {
      entry.pack = needsPack ? 'science' : entry.pack;
      entry.modules = {};
      for (const [mid, list] of [...mods.entries()].sort((a, b) => a[0] - b[0])) {
        const text = list.flatMap((row) => parseContent(row.content ?? '').blocks.filter((b) => b.kind !== 'image').map((b) => b.text)).join(' ').slice(0, 40000);
        const title = parseContent(list[0].content ?? '').blocks.find((b) => b.kind === 'heading')?.text?.slice(0, 70) || '';
        const c = classify(text, needsPack ? KW : CHEM_KW);
        entry.modules[mid] = { ...(needsPack ? { pack: c.label } : { variant: c.label }), confidence: c.confidence, ...(c.review ? { review: true } : {}), title };
        if (c.review) report.review.push({ course: id, module: Number(mid), title, guess: c.label, scores: c.scores });
      }
    }
    courses[id] = entry;
    if (entry.enabled) report.mapped++;
  }
  for (const id of tbByCourse.keys()) if (!byCourse.has(id)) report.unmappedCourses.push({ id, lectures: [...tbByCourse.get(id).values()].reduce((a, l) => a + l.length, 0) });
  report.unmappedCourses.sort((a, b) => a.id - b.id);
  return { courses, report };
}

// Streams the textbook rows (only the fields the classifier needs).
export async function textbookRowsLite(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    rows.push({ course_id: r.course_id, module_id: r.module_id, lecture_id: r.lecture_id, content: r.content });
  }
  return rows;
}
