// Content JSON v1 + voice timings -> render project.
//
// Scene timing mirrors the renderer (project.timeline): scene i starts at
// start[i-1] + duration[i-1] - transition. Narration for a scene starts
// `settle` ms after its transition; the scene lasts transition + settle +
// clip + tail. A marker at t seconds into the clip becomes the cue
// narrationStart + t - reveal_lead, written into the template's data by the
// slide spec (applyCues). The audio track is built from the same numbers, so
// cues and speech cannot drift apart.

import fs from 'node:fs';
import path from 'node:path';
import { applyCues, requiredMarkers } from '../slides.js';
import { buildTrack } from '../sound/track.js';
import { realCaption } from '../generation/assemble.js';
import { illustrate, artConfig } from '../generation/art.js';
import { enhanceFigureInfo, relTo } from './images.js';
import { imageSize } from '../generation/prepare.js';

const r2 = (x) => Math.round(x * 100) / 100;

async function fetchTo(url, file) {
  if (fs.existsSync(file)) return file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download failed (${res.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const extOf = (url) => (url.match(/\.(png|jpe?g|webp|gif|svg)(?:$|\?)/i)?.[1] || 'png').toLowerCase();

// Pictures for `illustration` slides (template field `art`, written as
// `art_prompt`): generated and vision-checked (generation/art.js), copied
// into assets/. A slide whose picture is rejected keeps no `art` and renders
// its text-only layout; each such slide is a warning in the build gate.
async function attachArt(content, types, cfg, { dir, art, theme }) {
  const issues = [];
  const want = content.slides.filter((s) => types[s.slide_type]?.schema.art && s.data.art_prompt && !s.data.art);
  if (!want.length) return { art: new Map(), issues };
  if (!art?.enabled) {
    for (const s of want) issues.push({ code: 'ART_SKIPPED', severity: 'warning', path: `s${String(s.slide_number).padStart(2, '0')}`, message: `slide ${s.slide_number}: picture generation is off in this run — text-only layout` });
    return { art: new Map(), issues };
  }
  const max = artConfig(cfg).max_per_lecture;
  const items = want.slice(0, max).map((s) => ({ key: `s${String(s.slide_number).padStart(2, '0')}`, slide: s.slide_number, prompt: s.data.art_prompt, points: s.data.points || [] }));
  for (const s of want.slice(max)) issues.push({ code: 'ART_OVER_BUDGET', severity: 'warning', path: `s${String(s.slide_number).padStart(2, '0')}`, message: `slide ${s.slide_number}: more than ${max} pictures in this lecture — text-only layout` });
  const results = await illustrate(items, cfg, { cacheDir: art.cacheDir, logFile: art.logFile, subject: content.subject, klass: content.class, client: art.client, theme });
  const out = new Map();
  results.forEach((r, i) => {
    const it = items[i];
    if (!r.file) {
      issues.push({ code: 'ART_REJECTED', severity: 'warning', path: it.key, message: `slide ${it.slide}: no picture passed the check (${r.problems}) — text-only layout` });
      return;
    }
    const rel = `assets/art-${it.key}.jpg`;
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.copyFileSync(r.file, path.join(dir, rel));
    out.set(it.slide, rel);
  });
  return { art: out, issues };
}

// types: slideTypes(build)[pack]. dir: where project.json, voice/ and assets/ live.
// opts.enhance: sharpen small NCERT figures (build/images.js) — config images.enhance.
// opts.art: { enabled, cacheDir, logFile } for illustration pictures.
// opts.theme: 'sky' (lecture videos, default) | 'dark' (summary videos) — project.theme.
// opts.headerTitle: the header line on every slide (default: the lecture title).
export async function buildProject(content, voice, types, cfg, { dir, fetchImage = fetchTo, track = true, enhance = null, art = null, theme = 'sky', headerTitle = null } = {}) {
  const T = cfg.timing;
  const minT = 1000 / cfg.video.fps;
  const scenes = [];
  const cues = [];
  const required = [];
  const clips = [];
  const { art: pictures, issues } = await attachArt(content, types, cfg, { dir, art, theme });
  const enhanced = [];
  let prevStart = 0, prevDur = 0;

  for (const [i, s] of content.slides.entries()) {
    const st = types[s.slide_type];
    if (!st) throw new Error(`slide ${s.slide_number}: no template for slide type "${s.slide_type}"`);
    const v = voice.slides[i];
    if (!v || v.slide_number !== s.slide_number) throw new Error(`slide ${s.slide_number}: no matching voice clip`);

    const tIn = i === 0 ? minT : Math.max(minT, T.transition);
    const start = i === 0 ? 0 : prevStart + prevDur - tIn;
    const narrStart = start + tIn + T.settle;
    const duration = Math.round(tIn + T.settle + v.duration * 1000 + T.tail);
    const toAbs = (t) => r2(narrStart / 1000 + t - T.reveal_lead / 1000);

    let data = applyCues(st.spec, s.data, v.markers, toAbs);
    if (pictures.has(s.slide_number)) data = { ...data, art: pictures.get(s.slide_number) };
    if (s.image) {
      const rel = `assets/${s.image.id.replace(/[^\w.-]/g, '_')}.${extOf(s.image.url)}`;
      await fetchImage(s.image.url, path.join(dir, rel));
      // Every NCERT figure is enhanced before it is placed (build/images.js); one
      // that cannot be is shown as it is and reported.
      const hd = enhance ? enhanceFigureInfo(path.join(dir, rel), enhance) : null;
      if (hd && !hd.file) issues.push({ code: 'FIGURE_NOT_ENHANCED', severity: 'warning', path: `s${String(s.slide_number).padStart(2, '0')}`, message: `slide ${s.slide_number}: ${s.image.id} shown unenhanced — ${hd.reason}` });
      if (hd?.file) enhanced.push({ id: s.image.id, slide: s.slide_number, width: hd.width, height: hd.height, scale: Math.round(hd.scale * 100) / 100 });
      data = { ...data, image: hd?.file ? relTo(dir, hd.file) : rel };
      // Templates with a wide-figure layout (image_points) are told the figure's shape.
      if (st.schema.imageShape) {
        let size = null;
        try { size = imageSize(fs.readFileSync(path.join(dir, rel))); } catch { /* unreadable: keep the normal layout */ }
        data.imageShape = size && size.width / size.height >= 1.65 ? 'wide' : 'normal';
      }
      // Lectures assembled before placeholder captions were filtered may still carry one.
      if (!realCaption(data.caption)) delete data.caption;
      if (st.schema.caption && !data.caption && realCaption(s.image.caption)) data.caption = realCaption(s.image.caption);
    }
    scenes.push({
      template: st.templateId,
      _slide: `${s.slide_number} · ${s.slide_type} · ${s.title}`,
      duration,
      transition: i === 0 ? { name: 'cut', duration: 0 } : { name: T.transition_style || 'soft', duration: T.transition },
      data,
    });
    const ids = requiredMarkers(st.spec, s.data);
    required.push(ids);
    for (const id of ids) {
      const t = v.markers[id];
      cues.push({ scene: i, marker: id, audioAt: t == null ? null : r2(narrStart / 1000 + t), cueAt: t == null ? null : toAbs(t) });
    }
    clips.push({ file: path.join(dir, v.clip), atMs: narrStart });
    prevStart = start; prevDur = duration;
  }

  const project = {
    title: `${content.subject} · Class ${content.class} · ${content.title}`,
    video: { width: cfg.video.width, height: cfg.video.height, scale: 1, fps: cfg.video.fps, preset: cfg.video.preset, tune: cfg.video.tune },
    fadeIn: 500,
    fadeOut: 800,
    theme,
    audio: 'voice/track.wav',
    shared: { lecture: headerTitle || content.title },
    scenes,
    _generated: { chapter: content.chapter_id, lecture: content.lecture, provider: voice.provider, at: new Date().toISOString(), figures_enhanced: enhanced },
  };
  if (track) buildTrack(clips, path.join(dir, 'voice', 'track.wav'), { lufs: cfg.tts.loudness_lufs });
  return { project, cues, required, issues };
}
