// L0 — prepare a chapter (code only, no LLM): clean the NCERT text, cut it
// into numbered sections the planners cite, measure every catalog image and
// derive the per-lecture slide budget.

import fs from 'node:fs';
import path from 'node:path';
import { slideBudget, classBand, lectureMinutes, lectureBudget } from '../curriculum/index.js';

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

// ---- text -----------------------------------------------------------------------

export function cleanText(raw) {
  let lines = String(raw).replace(/\r\n?/g, '\n').replace(/­/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  // Running headers/footers repeat on every page; page numbers stand alone.
  const counts = new Map();
  for (const l of lines) if (l && l.length < 60) counts.set(l, (counts.get(l) || 0) + 1);
  lines = lines.filter((l) => !/^\d{1,3}$/.test(l)
    && !/^(reprint|rationalised)\b.*\d{4}/i.test(l)
    && !(l && l.length < 60 && counts.get(l) >= 3 && !HEADING.test(l)));
  let text = lines.join('\n');
  text = text.replace(/(\w)-\n(\w)/g, '$1$2');           // cyto-\nplasm -> cytoplasm
  text = text.replace(/([^\n.!?:;।])\n(?=[a-z(])/g, '$1 '); // re-flow wrapped sentences
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// NCERT numbering: "8.1 What is a Cell?", "8.5.3 Endomembrane System".
const HEADING = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(\S.{1,90})$/;

const paragraphs = (t) => t.split(/\n{2,}|\n(?=[A-Z0-9•])/).map((p) => p.trim()).filter(Boolean);

export function splitLong(sec, maxWords) {
  if (sec.words <= maxWords) return [sec];
  const parts = [];
  let cur = [];
  let n = 0;
  for (const p of paragraphs(sec.text)) {
    const w = words(p);
    if (n && n + w > maxWords) { parts.push(cur.join('\n\n')); cur = []; n = 0; }
    cur.push(p); n += w;
  }
  if (cur.length) parts.push(cur.join('\n\n'));
  return parts.map((text, i) => ({ heading: parts.length > 1 ? `${sec.heading} (part ${i + 1})` : sec.heading, text, words: words(text) }));
}

// Sections in reading order: [{ id: 's01', heading, text, words }].
export function sectionize(text, { minSections = 15, maxWords = 700, chunkWords = 350 } = {}) {
  const secs = [];
  let cur = { heading: 'Introduction', lines: [] };
  for (const line of text.split('\n')) {
    const m = line.match(HEADING);
    if (m) {
      if (cur.lines.join(' ').trim()) secs.push(cur);
      cur = { heading: `${m[1]} ${m[2]}`, lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.join(' ').trim()) secs.push(cur);
  let out = secs.map((s) => { const t = s.lines.join('\n').trim(); return { heading: s.heading, text: t, words: words(t) }; });
  // No usable numbering: fall back to paragraph chunks.
  if (out.length < 2) out = splitLong({ heading: 'Part', text, words: words(text) }, chunkWords);
  out = out.flatMap((s) => splitLong(s, maxWords));
  // Planners need enough pieces to balance lectures: split the biggest.
  for (let guard = 0; out.length < minSections && guard < 50; guard++) {
    const i = out.reduce((b, s, j) => (s.words > out[b].words ? j : b), 0);
    const pieces = splitLong(out[i], Math.ceil(out[i].words / 2));
    if (pieces.length < 2) break;
    out.splice(i, 1, ...pieces);
  }
  return out.map((s, i) => ({ id: `s${String(i + 1).padStart(2, '0')}`, ...s }));
}

// ---- images ---------------------------------------------------------------------

// Wide textbook figures are common (30% of catalog images are wider than 2:1).
export const RATIOS = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '2:3': 2 / 3, '3:2': 3 / 2, '2:1': 2, '21:9': 21 / 9, '3:1': 3 };

export function ratioBucket(w, h) {
  if (!(w > 0 && h > 0)) return null;
  const r = w / h;
  let best = null, err = Infinity;
  for (const [name, v] of Object.entries(RATIOS)) {
    const e = Math.abs(Math.log(r / v));
    if (e < err) { best = name; err = e; }
  }
  return err < Math.log(1.12) ? best : 'other';
}

// Does an image of ratio w/h suit a slot allowing `allowed` ratios? Within 20%
// of any allowed ratio is fine: the panel letterboxes (fit: contain).
export function fitsRatio(img, allowed) {
  if (!allowed?.length || !(img.width && img.height)) return false;
  const r = img.width / img.height;
  return allowed.some((a) => Math.abs(Math.log(r / RATIOS[a])) < Math.log(1.2));
}

// Width/height from the first bytes of PNG, GIF, JPEG or WebP.
export function imageSize(buf) {
  const b = Buffer.from(buf);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const n = b.readUInt32LE(21); return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// Cloudinary answers `fl_getinfo` with JSON dimensions; anything else is
// downloaded and its header parsed.
export async function probeImage(url, { fetchImpl = fetch } = {}) {
  if (/\/image\/upload\//.test(url)) {
    try {
      const res = await fetchImpl(url.replace('/image/upload/', '/image/upload/fl_getinfo/'));
      if (res.ok) {
        const j = await res.json();
        const w = j.input?.width ?? j.output?.width, h = j.input?.height ?? j.output?.height;
        if (w && h) return { width: w, height: h };
      }
    } catch { /* fall through to a plain download */ }
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const size = imageSize(Buffer.from(await res.arrayBuffer()));
  if (!size) throw new Error('unrecognised image format');
  return size;
}

// ---- L0 ---------------------------------------------------------------------------

export async function prepareChapter(chapter, cfg, { offline = false, fetchImpl } = {}) {
  const issues = [];
  const text = cleanText(chapter.source_text);
  const sections = sectionize(text, { minSections: cfg.curriculum.lectures_per_chapter * 3 });

  const seen = new Set();
  const images = [];
  for (const img of chapter.images || []) {
    if (seen.has(img.id)) { issues.push({ code: 'DUPLICATE_IMAGE_ID', severity: 'error', path: `/images/${img.id}`, message: `image id "${img.id}" appears twice` }); continue; }
    seen.add(img.id);
    let { width, height } = img;
    if (!(width && height) && !offline) {
      try { ({ width, height } = await probeImage(img.url, { fetchImpl })); } catch (e) {
        issues.push({ code: 'IMAGE_UNREACHABLE', severity: 'warning', path: `/images/${img.id}`, message: `${img.id}: ${e.message} — left out of the catalog` });
        continue;
      }
    }
    if (!(width && height)) {
      issues.push({ code: 'IMAGE_NO_SIZE', severity: 'warning', path: `/images/${img.id}`, message: `${img.id}: size unknown (offline) — left out of the catalog` });
      continue;
    }
    if (words(img.description) < 3) {
      issues.push({ code: 'IMAGE_THIN_DESCRIPTION', severity: 'warning', path: `/images/${img.id}`, message: `${img.id}: description too short for the planner to choose it reliably` });
    }
    images.push({ ...img, width, height, ratio: ratioBucket(width, height), lowRes: Math.max(width, height) < 500 });
  }

  const { source_text, images: _drop, ...meta } = chapter;
  return {
    prepared: {
      chapter: meta,
      band: classBand(chapter.class),
      budget: slideBudget(cfg),
      totalWords: words(text),
      sections,
      images,
    },
    issues,
  };
}

// ---- L0 for a textbook lecture ------------------------------------------------------

// Image sizes, remembered across runs (16k catalog images are probed once).
export function imageSizeCache(file) {
  let map = {};
  try { if (file && fs.existsSync(file)) map = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { map = {}; }
  return {
    get: (url) => map[url],
    set: (url, v) => { map[url] = v; },
    // Several workers share this file: merge with what is on disk, then write
    // a temp file and rename it, so no writer loses or corrupts entries.
    save: () => {
      if (!file) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let disk = {};
      try { if (fs.existsSync(file)) disk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { disk = {}; }
      map = { ...disk, ...map };
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(map));
      fs.renameSync(tmp, file);
    },
  };
}

const stripMd = (s) => String(s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const firstWords = (s, n) => { const w = stripMd(s).split(' '); return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' '); };

// blocks (sources/content.js) -> sections + image catalog. Each image leaves a
// "[Figure <id>: …]" line where it sat, so planners know which text it
// illustrates; its AI description stays out of the source text.
// Screenshots of text (a worked problem, a question list, a table, an equation,
// a page) are not figures: they never go on a figure slot. Detected from the
// image's description, or from an extreme strip shape.
const TEXT_LIKE = /^\W*(this|the)\s+image\s+(shows|contains|is|displays|presents|appears to be)\s+(a|an|the|two|some)?\s*((simple|short|small|typical|set of|list of|chemistry|chemical|math(ematical)?|physics|biology|scientific|numerical|sample|solved|worked|balanced|word|homework or)\s+)*(example\s+)?(problem|question|exercise|homework|practice|table|equation|formula|expression|calculation|solution|text|page|paragraph|passage|list|definition|statement|summary|note|title|heading)s?\b/i;
export const isTextLike = (description) => TEXT_LIKE.test(String(description || ''));

export function sectionsFromBlocks(blocks, lectureId, { maxWords = 700, minWords = 40 } = {}) {
  const secs = [];
  const images = [];
  let cur = null;
  const open = (heading) => { cur = { heading, lines: [], words: 0 }; secs.push(cur); };
  for (const b of blocks) {
    if (b.kind === 'heading') { open(b.text); continue; }
    if (!cur) open('Introduction');
    if (b.kind === 'image') {
      const id = `img_${lectureId}_${images.length + 1}`;
      images.push({ id, url: b.src, description: b.description ? firstWords(b.description, 60) : 'No description available', textLike: isTextLike(b.description) });
      cur.lines.push(`[Figure ${id}: ${b.description ? firstWords(b.description, 18) : 'figure'}]`);
      continue;
    }
    cur.lines.push(b.text);
    cur.words += words(b.text);
  }
  // Merge sections too small to plan a slide from into the previous one.
  const merged = [];
  for (const s of secs) {
    const prev = merged.at(-1);
    if (prev && s.words < minWords) { prev.lines.push(s.heading, ...s.lines); prev.words += s.words; }
    else merged.push(s);
  }
  const out = merged
    .filter((s) => s.words > 0 || s.lines.length)
    .flatMap((s) => splitLong({ heading: s.heading, text: s.lines.join('\n\n'), words: s.words }, maxWords))
    .map((s, i) => ({ id: `s${String(i + 1).padStart(2, '0')}`, heading: s.heading, text: s.text, words: words(s.text.replace(/\[Figure [^\]]*\]/g, '')) }));
  return { sections: out, images };
}

// input: one lecture from sources/textbook.js. Returns { prepared, issues }
// in the same shape prepareChapter produces, so the lecture layers are shared.
export async function prepareLecture(input, cfg, { offline = false, fetchImpl, sizes = null } = {}) {
  const issues = [];
  const { sections, images: found } = sectionsFromBlocks(input.blocks || [], input.lecture_id);
  const sourceWords = sections.reduce((a, s) => a + s.words, 0);
  const descWords = found.reduce((a, im) => a + words(im.description), 0);

  const images = [];
  for (const img of found) {
    let size = sizes?.get(img.url);
    if (!size && !offline) {
      try { size = await probeImage(img.url, { fetchImpl }); sizes?.set(img.url, size); } catch (e) {
        issues.push({ code: 'IMAGE_UNREACHABLE', severity: 'warning', path: `/images/${img.id}`, message: `${img.id}: ${e.message} — left out of the catalog` });
        continue;
      }
    }
    if (!size) { issues.push({ code: 'IMAGE_NO_SIZE', severity: 'warning', path: `/images/${img.id}`, message: `${img.id}: size unknown (offline) — left out of the catalog` }); continue; }
    const aspect = size.width / size.height;
    const kind = img.textLike || aspect > 4 || aspect < 0.25 ? 'text' : 'figure';
    images.push({ ...img, width: size.width, height: size.height, ratio: ratioBucket(size.width, size.height), lowRes: Math.max(size.width, size.height) < 500, kind });
  }
  sizes?.save();

  const minutes = lectureMinutes(sourceWords, cfg);
  return {
    prepared: {
      chapter: {
        chapter_id: `c${input.course_id}-m${input.module_id}`,
        title: input.chapter_title, class: input.class, subject: input.subject,
        pack: input.pack, variant: input.variant ?? null, slide_language: input.slide_language || 'english',
      },
      lecture: {
        lecture_id: input.lecture_id, module_id: input.module_id, course_id: input.course_id,
        title: input.title, position: input.position, summary: input.summary, recap: input.recap, preview: input.preview,
        title_from_db: !!input.title_from_db, chapter_number: input.chapter_number ?? null, chapter_lectures: input.chapter_lectures || [], course_title: input.course_title ?? null,
        keywords: input.keywords || [], format: input.format,
      },
      band: classBand(input.class || 12),
      budget: lectureBudget(minutes, cfg),
      totalWords: sourceWords,
      descriptionWords: descWords,
      sections,
      images,
    },
    issues,
  };
}
