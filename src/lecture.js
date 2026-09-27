// Server lecture JSON -> render-ready project.
//
// Input: the array the Prepzy server returns (projects/lectures.json). Each
// entry is one lecture; `video_content_data` is its slides. A slide has
// `blocks` (text / options / table / image) whose `trigger` phrases say *when*
// each block should appear, and `lang_narration` with the narration script +
// TTS audio per language.
//
// For every slide this picks the narration in the chosen language, times each
// trigger against that narration with the words-per-minute model in
// narration.js, maps the slide onto a biology template, and finally lays all
// narration clips onto one audio track aligned to the scenes.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FFMPEG } from './tools.js';
import { speechBounds, timeline, locate, findSequence } from './narration.js';

// ---- scene pacing -----------------------------------------------------------
const TRANSITION = 600;          // ms dissolve between slides (first slide cuts in)
const SETTLE = 900;              // ms after the entrance before narration starts
const TAIL = 1800;               // ms after narration for exits + breathing room
const REVEAL_LEAD = 0.25;        // s: show a block just before it is spoken
const MIN_SCORE = 0.34;          // phrase-match confidence below this is ignored

const r2 = (x) => Math.round(x * 100) / 100;

// A reading-order sequence of cues where some could not be located: each gap
// follows the previous known cue by `step`, never passing the next known one.
// (Leaving them null would fall back to the template's scene-relative auto
// stagger, i.e. before the narration gets there.)
function fillSequence(list, startAfter, step = 2.5) {
  const out = [...list];
  let prev = startAfter;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) { prev = out[i]; continue; }
    const next = out.slice(i + 1).find((t) => t != null);
    let t = prev + step;
    if (next != null && t > next - 0.5) t = Math.max(prev + 0.4, next - 0.5);
    out[i] = r2(t);
    prev = out[i];
  }
  return out;
}

async function fetchTo(url, file) {
  if (fs.existsSync(file)) return file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const lectureId = (lec) => {
  for (const s of lec.video_content_data || []) {
    for (const n of s.lang_narration || []) {
      const m = n.audio?.match(/narration_(\d+)_\d+_/);
      if (m) return m[1];
    }
  }
  return null;
};

const triggerText = (block, lang) => {
  const t = block?.trigger || [];
  return (t.find((x) => x.language === lang) || t.find((x) => x.language === 'english'))?.trigger ?? null;
};
const rowTrigger = (row, lang) => triggerText(row, lang);
const textOf = (block) => (block?.items || []).map((i) => i.text).join('\n');

// ---- per-slide timing ------------------------------------------------------

function slideClock(narr, audioFile, pace) {
  const bounds = speechBounds(audioFile);
  const tl = timeline(narr.narration, { ...bounds, pace });
  const log = [];
  // Find a phrase at/after word `from`; returns seconds into the clip or null.
  const cue = (label, phrase, from = 0) => {
    if (!phrase) { log.push({ label, phrase: '(none)', t: null }); return null; }
    const m = locate(tl.words, phrase, { from });
    const ok = m.score >= MIN_SCORE;
    const t = ok ? Math.max(0, tl.at(m.index) - REVEAL_LEAD) : null;
    log.push({ label, phrase, score: r2(m.score), at: ok ? tl.words.slice(m.index, m.index + 6).join(' ') : '—', t, index: m.index });
    return ok ? { t, index: m.index } : null;
  };
  const cueSeq = (label, pattern, from = 0) => {
    const i = findSequence(tl.words, pattern, from);
    log.push({ label, phrase: pattern.map((r) => r.source).join(' '), score: i < 0 ? 0 : 1,
               at: i < 0 ? '—' : tl.words.slice(i, i + 6).join(' '), t: i < 0 ? null : Math.max(0, tl.at(i) - REVEAL_LEAD), index: i });
    return i < 0 ? null : { t: Math.max(0, tl.at(i) - REVEAL_LEAD), index: i };
  };
  return { bounds, tl, cue, cueSeq, log };
}

// ---- slide -> template -------------------------------------------------------
// Each mapper returns { template, data, cues } where cue values are seconds
// relative to the start of this slide's narration clip.

const MAPPERS = {
  definition(slide, ctx) {
    const blocks = slide.blocks;
    const def = blocks.find((b) => b.type === 'text' && /DEFINITION/i.test(b.label || ''));
    const props = blocks.find((b) => b.type === 'text' && /PROPERT|TYPES|POINT/i.test(b.label || ''));
    const table = blocks.find((b) => b.type === 'table')?.table;
    const img = blocks.find((b) => b.type === 'image');
    const points = props ? textOf(props).split('\n').map((s) => s.trim()).filter(Boolean) : [];

    const c = { points: [], rows: [] };
    const d = ctx.cue('definition', triggerText(def, ctx.lang) || textOf(def));
    if (d) c.definition = d.t;
    // Only the first property usually has a trigger; later ones are located by
    // their own text, each searched after the previous one.
    let from = d?.index ?? 0;
    points.forEach((p, i) => {
      const hit = ctx.cue(`point ${i + 1}`, i === 0 ? (triggerText(props, ctx.lang) || p) : p, from);
      c.points.push(hit ? hit.t : null);
      if (hit) from = hit.index + 1;
    });
    if (table) {
      table.rows.forEach((row, i) => {
        const hit = ctx.cue(`row ${i + 1}`, rowTrigger(row, ctx.lang) || row.values.join(' '), 0);
        c.rows.push(hit ? hit.t : null);
      });
    }
    // The definition is the slide's anchor: it shows as the narration starts
    // unless it was matched before everything else.
    const others = [...c.points, ...c.rows].filter((t) => t != null);
    if (c.definition == null || (others.length && c.definition > Math.min(...others))) {
      c.definition = 0;
      ctx.note('definition', 'shown at narration start (matched after other blocks or not at all)');
    }
    c.points = fillSequence(c.points, c.definition + 0.5);
    if (table) {
      c.rows = fillSequence(c.rows, c.definition + 0.5);
      c.table = r2(Math.max(0, c.rows[0] - 0.6));
    }
    return {
      template: 'bio-02',
      data: {
        title: slide.slide_title,
        definition: textOf(def) || undefined,
        points,
        ...(table ? { columns: table.columns, rows: table.rows.map((r) => r.values) } : {}),
        ...(img ? { image: ctx.image(img), caption: img.image?.caption } : {}),
      },
      cues: c,
    };
  },

  mcq(slide, ctx) {
    const blocks = slide.blocks;
    const q = blocks.find((b) => b.type === 'text' && /QUESTION/i.test(b.label || ''));
    const opts = blocks.find((b) => b.type === 'options')?.items || [];
    const desc = blocks.find((b) => b.type === 'text' && /DESCRIPTION|EXPLANATION/i.test(b.label || ''));
    const answer = opts.find((o) => o.is_correct)?.label;
    const traps = opts.filter((o) => o.is_trap && !o.is_correct).map((o) => o.label);

    const c = {};
    const qh = ctx.cue('question', triggerText(q, ctx.lang) || textOf(q));
    if (qh) {
      c.question = qh.t;
      c.options = opts.map((_, i) => qh.t + 1.0 + i * 0.3);
    }
    const after = qh?.index ?? 0;
    const L = (x) => new RegExp(`^${x.toLowerCase()}$`);
    // The trap goes red when the narration first names it ("… option B …",
    // or the option's own words), the answer green when it is confirmed.
    let wrongHit = null;
    if (traps.length) {
      wrongHit = ctx.cueSeq(`wrong (option ${traps[0]})`, [/^option$/, L(traps[0])], after)
        || ctx.cue(`wrong (${traps[0]} text)`, opts.find((o) => o.label === traps[0])?.text, after);
    }
    let ansHit = null;
    if (answer) {
      // prefer "option X" said next to सही / correct / answer
      let i = after;
      for (;;) {
        const h = findSequence(ctx.tl.words, [/^option$/, L(answer)], i);
        if (h < 0) break;
        const near = ctx.tl.words.slice(Math.max(0, h - 5), h + 5).join(' ');
        if (/सही|correct|answer|उत्तर|right/i.test(near)) { ansHit = ctx.cueSeq(`answer (option ${answer})`, [/^option$/, L(answer)], h); break; }
        i = h + 1;
      }
      ansHit ||= ctx.cueSeq(`answer (option ${answer})`, [/^option$/, L(answer)], wrongHit?.index ?? after)
        || ctx.cue(`answer (${answer} text)`, opts.find((o) => o.label === answer)?.text, wrongHit?.index ?? after);
    }
    if (ansHit) c.answer = ansHit.t;
    if (wrongHit) c.wrong = Math.min(wrongHit.t, c.answer ?? Infinity);
    // The explanation is usually spoken around (often just before) the answer
    // confirmation, so its box simply follows the green reveal.
    if (c.answer != null) {
      c.description = r2(c.answer + 1.2);
      ctx.note('description', 'follows the answer reveal by 1.2s');
    }
    return {
      template: 'bio-12',
      data: {
        title: slide.slide_title || 'Test Yourself',
        question: textOf(q),
        options: opts.map((o) => o.text),
        answer,
        wrong: traps,
        description: textOf(desc) || undefined,
      },
      cues: c,
    };
  },

  common_misconception(slide, ctx) {
    const table = slide.blocks.find((b) => b.type === 'table')?.table;
    if (!table) throw new Error(`slide ${slide.slide_number}: common_misconception without a table`);
    const rows = table.rows.slice(0, 3);
    const cues = [];
    let from = 0;
    const ORDINAL = [/^(पहला|पहली|first|firstly)$/, /^(दूसरा|दूसरी|second|secondly)$/, /^(तीसरा|तीसरी|third|thirdly)$/];
    rows.forEach((row, i) => {
      // The correction (trigger) anchors the row; the wrong belief is spoken
      // before it — at the "पहला / दूसरा / तीसरा" marker when there is one.
      const fact = ctx.cue(`fact ${i + 1}`, rowTrigger(row, ctx.lang) || row.values[1], from);
      const upto = fact?.index ?? ctx.tl.words.length;
      let myth = ctx.cueSeq(`myth ${i + 1} (marker)`, [ORDINAL[i] || /^$/], from);
      if (!myth || myth.index >= upto) myth = ctx.cue(`myth ${i + 1}`, row.values[0], from);
      if (myth && myth.index >= upto) myth = null;
      const ft = fact?.t ?? null;
      const mt = myth?.t ?? (ft != null ? Math.max(0, ft - 2.5) : null);
      cues.push(ft != null || mt != null ? [r2(mt ?? ft), r2(Math.max(ft ?? mt, (mt ?? 0) + 0.7))] : null);
      if (fact) from = fact.index + 1;
    });
    return {
      template: 'bio-14',
      data: {
        title: slide.slide_title || 'Common Misconception',
        rows: rows.map((r) => ({ myth: r.values[0], fact: r.values[1], factDetail: r.values[2] })),
      },
      cues: { rows: cues },
    };
  },
};

export const SUPPORTED = Object.keys(MAPPERS);

// ---- lecture -> project -----------------------------------------------------

export async function buildLecture(lec, { lang = 'hinglish', pace = 0.9, outDir, name, lectureName }) {
  const id = lectureId(lec) || 'lecture';
  const assets = path.join(outDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const report = [];
  const scenes = [];
  const clips = [];

  let cursor = 0;                                   // scene start (ms)
  const slides = lec.video_content_data || [];
  for (let si = 0; si < slides.length; si++) {
    const slide = slides[si];
    const mapper = MAPPERS[slide.slide_type];
    if (!mapper) throw new Error(`slide ${slide.slide_number}: slide_type "${slide.slide_type}" has no template mapping (supported: ${SUPPORTED.join(', ')})`);

    let narr = slide.lang_narration.find((n) => n.language === lang && n.audio);
    if (!narr) {
      narr = slide.lang_narration.find((n) => n.language === 'english' && n.audio);
      report.push(`  ! slide ${slide.slide_number}: no ${lang} audio, using ${narr?.language}`);
    }
    const audioFile = await fetchTo(narr.audio, path.join(assets, path.basename(narr.audio)));
    const clock = slideClock(narr, audioFile, pace);
    const ctx = {
      lang: narr.language, tl: clock.tl, cue: clock.cue, cueSeq: clock.cueSeq,
      image: (b) => {
        const url = b.image?.source_url;
        if (!url) return undefined;
        const ext = (url.match(/\.(webp|png|jpe?g|gif)(?:$|\?)/i)?.[1] || 'png').toLowerCase();
        const file = path.join(assets, `img_${id}_${slide.slide_number}_${b.id}.${ext}`);
        ctx.pending.push(fetchTo(url, file));
        return path.relative(outDir, file);
      },
      pending: [],
      note: (label, msg) => clock.log.push({ label, phrase: msg, at: msg, t: null, note: true }),
    };
    const { template, data, cues } = mapper(slide, ctx);
    await Promise.all(ctx.pending);

    const tIn = si === 0 ? 0 : TRANSITION;
    const start = si === 0 ? 0 : cursor - tIn;
    const narrStart = start + tIn + SETTLE;         // ms, absolute
    const clipMs = clock.bounds.duration * 1000;
    const duration = Math.round(tIn + SETTLE + clipMs + TAIL);
    const abs = (t) => (t == null ? null : r2(narrStart / 1000 + t));
    const absCues = JSON.parse(JSON.stringify(cues, (k, v) => (typeof v === 'number' ? abs(v) : v)));
    const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === null || (Array.isArray(v) && v.every((x) => x == null)) ? undefined : v)));

    scenes.push({
      template,
      _slide: `${slide.slide_number}. ${slide.slide_type} — narration ${path.basename(audioFile)} ` +
              `(${clock.bounds.duration.toFixed(1)}s, ${clock.tl.words.length} words, ` +
              `${clock.tl.wpmEffective.toFixed(0)} wpm effective; nominal ${clock.tl.wpmNominal.toFixed(0)} at pace ${pace})`,
      duration,
      transition: si === 0 ? { name: 'cut', duration: 0 } : { name: 'dissolve', duration: TRANSITION },
      data: clean({ ...data, cues: absCues }),
    });
    clips.push({ file: audioFile, at: narrStart });
    cursor = start + duration;

    report.push(`  ${slide.slide_number}. ${slide.slide_title}  →  ${template}   narration ${r2(narrStart / 1000)}s–${r2((narrStart + clipMs) / 1000)}s`);
    for (const l of clock.log) {
      if (l.note) { report.push(`               ${String(l.label).padEnd(22)} → ${l.phrase}`); continue; }
      const when = l.t == null ? ' no match' : `${abs(l.t).toFixed(2).padStart(7)}s`;
      report.push(`      ${when}  ${String(l.label).padEnd(22)} ${l.score != null ? `match ${String(l.score).padEnd(4)}` : '          '} “${String(l.at ?? '').slice(0, 60)}”`);
    }
  }

  // One narration track: every clip delayed to its scene's narration start.
  const track = path.join(assets, `narration_${id}_${lang}_track.wav`);
  const args = ['-v', 'error', '-y'];
  clips.forEach((c) => args.push('-i', c.file));
  const filter = clips.map((c, i) => `[${i}]adelay=${Math.round(c.at)}:all=1[a${i}]`).join(';') +
    `;${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest[out]`;
  args.push('-filter_complex', filter, '-map', '[out]', '-ar', '44100', '-ac', '1', track);
  execFileSync(FFMPEG, args);

  const project = {
    title: name || `Lecture ${id}`,
    video: { width: 1920, height: 1080, scale: 1, fps: 25 },
    fadeIn: 500,
    fadeOut: 800,
    audio: path.relative(outDir, track),
    _generated: `hvr lecture — language ${lang}, pace ${pace}; edit the source JSON and regenerate rather than hand-editing cues`,
    shared: { lecture: lectureName || slides[0]?.slide_title || '' },
    scenes,
  };
  return { id, project, report };
}

export function loadLectures(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : [raw];
}
export { lectureId };
