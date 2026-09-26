import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = { width: 1920, height: 1080, scale: 2, fps: 30 };

export async function loadProject(file) {
  const abs = path.resolve(file);
  const project = JSON.parse(await readFile(abs, 'utf8'));
  const v = { ...DEFAULTS, ...(project.video || {}) };

  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    throw new Error(`${file}: project has no scenes`);
  }

  const known = new Set(['title', 'bullets', 'stat', 'doc']);
  project.scenes.forEach((s, i) => {
    if (!known.has(s.layout)) throw new Error(`scene ${i}: unknown layout "${s.layout}"`);
    if (!(s.duration > 0)) throw new Error(`scene ${i}: duration must be > 0`);
    const t = s.transition?.duration ?? 0;
    const next = project.scenes[i + 1]?.transition?.duration ?? 0;
    if (t + next > s.duration) {
      throw new Error(`scene ${i}: transitions (${t}+${next}ms) exceed duration (${s.duration}ms)`);
    }
  });

  // Figures are authored relative to the project file; the stage serves them
  // under /__assets/ so the page can fetch them over http rather than file://.
  for (const s of project.scenes) {
    const src = s.figure?.src;
    if (src && !/^(https?:|data:|\/)/.test(src)) s.figure.src = `/__assets/${src}`;
  }

  project.video = v;
  project.dir = path.dirname(abs);
  return project;
}

// Mirrors the timeline math in stage/runtime.js so the CLI can report
// durations and scene offsets without booting a browser.
export function timeline(project) {
  const minT = 1000 / project.video.fps;
  const tIn = project.scenes.map((s) => Math.max(minT, s.transition?.duration ?? 700));
  const starts = [];
  let cursor = 0;
  project.scenes.forEach((s, i) => {
    if (i > 0) cursor += project.scenes[i - 1].duration - tIn[i];
    starts.push(cursor);
  });
  const last = project.scenes.length - 1;
  return { starts, tIn, duration: starts[last] + project.scenes[last].duration };
}
