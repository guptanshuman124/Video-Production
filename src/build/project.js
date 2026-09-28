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

// types: slideTypes(build)[pack]. dir: where project.json, voice/ and assets/ live.
export async function buildProject(content, voice, types, cfg, { dir, fetchImage = fetchTo, track = true } = {}) {
  const T = cfg.timing;
  const minT = 1000 / cfg.video.fps;
  const scenes = [];
  const cues = [];
  const required = [];
  const clips = [];
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
    if (s.image) {
      const rel = `assets/${s.image.id.replace(/[^\w.-]/g, '_')}.${extOf(s.image.url)}`;
      await fetchImage(s.image.url, path.join(dir, rel));
      data = { ...data, image: rel };
      // Lectures assembled before placeholder captions were filtered may still carry one.
      if (!realCaption(data.caption)) delete data.caption;
      if (st.schema.caption && !data.caption && realCaption(s.image.caption)) data.caption = realCaption(s.image.caption);
    }
    scenes.push({
      template: st.templateId,
      _slide: `${s.slide_number} · ${s.slide_type} · ${s.title}`,
      duration,
      transition: i === 0 ? { name: 'cut', duration: 0 } : { name: 'dissolve', duration: T.transition },
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
    audio: 'voice/track.wav',
    shared: { lecture: content.title },
    scenes,
    _generated: { chapter: content.chapter_id, lecture: content.lecture, provider: voice.provider, at: new Date().toISOString() },
  };
  if (track) buildTrack(clips, path.join(dir, 'voice', 'track.wav'), { lufs: cfg.tts.loudness_lufs });
  return { project, cues, required };
}
