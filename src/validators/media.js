// Media gates.
//
//   A1 audio  — every narration clip decodes, its pace is plausible for its
//               word count, no dead air, the lecture lands near its target.
//   A2 sync   — every cue sits inside its scene, in order, exactly
//               reveal_lead before its marker is spoken.
//   V1 video  — the mp4 has the promised streams, size, rate and length, no
//               unexpected black, and every reveal actually changes pixels.

import { timeline } from '../project.js';
import { issue } from './text.js';

// voice: sound.synthesizeLecture() result; cfg: full config. targetMinutes:
// the lecture's own target (textbook lectures scale with their source); the
// band is ±duration.band around it. Without one, curriculum.lecture_minutes_band.
export function gateAudio(voice, cfg, { targetMinutes = null } = {}) {
  const issues = [];
  let total = 0;
  for (const s of voice.slides) {
    const where = `s${String(s.slide_number).padStart(2, '0')}`;
    total += s.duration;
    if (!(s.duration > 0.5)) { issues.push(issue('AUDIO_EMPTY', 'error', where, `${where}: narration clip is ${s.duration.toFixed(2)}s`)); continue; }
    const wpm = s.words / (s.duration / 60);
    if (wpm < 70 || wpm > 300) issues.push(issue('AUDIO_PACE', 'error', where, `${where}: ${Math.round(wpm)} words/min — truncated or garbled audio?`));
    else if (wpm < 100 || wpm > 230) issues.push(issue('AUDIO_PACE', 'warning', where, `${where}: ${Math.round(wpm)} words/min is outside the usual 100–230`));
    for (const [a, b] of s.silences || []) {
      if (b - a > 2.5) issues.push(issue('AUDIO_DEAD_AIR', 'warning', where, `${where}: ${(b - a).toFixed(1)}s of silence at ${a.toFixed(1)}s`));
    }
    for (const seg of s.segments || []) {
      if (seg.text && !(seg.duration > 0.2)) issues.push(issue('AUDIO_SEGMENT_EMPTY', 'error', where, `${where}: segment "${seg.text.slice(0, 40)}…" produced no audio`));
    }
  }
  const scenes = voice.slides.length * (cfg.timing.settle + cfg.timing.tail + cfg.timing.transition) / 1000;
  const minutes = (total + scenes) / 60;
  const b = cfg.duration?.band ?? 0.3;
  const [lo, hi] = targetMinutes ? [targetMinutes * (1 - b), targetMinutes * (1 + b)].map((x) => Math.round(x * 10) / 10) : cfg.curriculum.lecture_minutes_band;
  if (minutes < lo * 0.8 || minutes > hi * 1.2) issues.push(issue('LECTURE_LENGTH', 'error', '/', `lecture runs ${minutes.toFixed(1)} min; target ${lo}–${hi}`));
  else if (minutes < lo || minutes > hi) issues.push(issue('LECTURE_LENGTH', 'warning', '/', `lecture runs ${minutes.toFixed(1)} min; target ${lo}–${hi}`));
  return issues;
}

// cues: [{ scene, marker, audioAt, cueAt }] absolute seconds, from build.
export function gateSync(project, cues, required, cfg, { trackDuration = null } = {}) {
  const issues = [];
  const tl = timeline(project);
  const lead = cfg.timing.reveal_lead / 1000;
  const byScene = new Map();
  for (const c of cues) {
    const where = `s${String(c.scene + 1).padStart(2, '0')}/${c.marker}`;
    const start = tl.starts[c.scene] / 1000;
    const end = start + project.scenes[c.scene].duration / 1000;
    const tIn = tl.tIn[c.scene] / 1000;
    if (c.cueAt == null) { issues.push(issue('CUE_MISSING', 'error', where, `${where}: marker was never timed`)); continue; }
    if (c.cueAt < start + (c.scene ? tIn : 0) - 0.001) issues.push(issue('CUE_BEFORE_SCENE', 'error', where, `${where}: cue ${c.cueAt.toFixed(2)}s is before the scene is on screen (${(start + tIn).toFixed(2)}s)`));
    if (c.cueAt > end - cfg.timing.tail / 1000 + 0.001) issues.push(issue('CUE_AFTER_NARRATION', 'error', where, `${where}: cue ${c.cueAt.toFixed(2)}s falls in the scene's tail`));
    const drift = c.audioAt - c.cueAt - lead;
    if (Math.abs(drift) > 0.02 && c.cueAt > start + tIn + 0.001) issues.push(issue('CUE_DRIFT', 'error', where, `${where}: reveal is ${drift.toFixed(3)}s off its spoken moment`));
    const list = byScene.get(c.scene) || [];
    if (list.length && c.cueAt < list.at(-1).cueAt) issues.push(issue('CUE_ORDER', 'error', where, `${where}: cue runs before ${list.at(-1).marker}`));
    list.push(c);
    byScene.set(c.scene, list);
  }
  required.forEach((ids, scene) => {
    const have = new Set((byScene.get(scene) || []).map((c) => c.marker));
    for (const id of ids) if (!have.has(id)) issues.push(issue('CUE_MISSING', 'error', `s${String(scene + 1).padStart(2, '0')}/${id}`, `scene ${scene + 1}: no cue for ${id}`));
  });
  if (trackDuration != null) {
    const d = trackDuration - tl.duration / 1000;
    if (d > 0.3) issues.push(issue('TRACK_OVERRUN', 'error', '/', `audio track is ${d.toFixed(2)}s longer than the video timeline`));
  }
  return issues;
}

// probe: ffprobe JSON (all streams); expected: { duration (s), fps, width, height };
// black: [[start, end]] from blackdetect; reveals: [{ where, changed }].
export function gateVideo(probe, expected, { black = [], reveals = [], layout = reveals.layout || [], fadeIn = 0, fadeOut = 0 } = {}) {
  const issues = [];
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  if (!v) return [issue('NO_VIDEO', 'error', '/', 'no video stream')];
  if (!a) issues.push(issue('NO_AUDIO', 'error', '/', 'no audio stream'));
  if (v.width !== expected.width || v.height !== expected.height) issues.push(issue('VIDEO_SIZE', 'error', '/', `${v.width}×${v.height}, expected ${expected.width}×${expected.height}`));
  const [n, dnm] = String(v.r_frame_rate).split('/').map(Number);
  if (Math.abs(n / (dnm || 1) - expected.fps) > 0.01) issues.push(issue('VIDEO_FPS', 'error', '/', `${v.r_frame_rate} fps, expected ${expected.fps}`));
  const dur = Number(probe.format.duration);
  if (Math.abs(dur - expected.duration) > 0.5) issues.push(issue('VIDEO_LENGTH', 'error', '/', `${dur.toFixed(2)}s, expected ${expected.duration.toFixed(2)}s`));
  for (const [s, e] of black) {
    const inFade = e <= fadeIn / 1000 + 0.1 || s >= dur - fadeOut / 1000 - 0.1;
    if (!inFade && e - s > 0.5) issues.push(issue('BLACK_FRAMES', 'error', '/', `${(e - s).toFixed(1)}s of black at ${s.toFixed(1)}s`));
  }
  for (const r of reveals) if (!r.changed) issues.push(issue('REVEAL_NOT_VISIBLE', 'error', r.where, `${r.where}: nothing changed on screen at this cue`));
  // Wrapping and shrinking already ran on the stage; what still overflows is flagged for a look.
  for (const l of layout) issues.push(issue('LAYOUT_OVERFLOW', 'warning', l.where, `${l.where}: ${l.what}`));
  return issues;
}
