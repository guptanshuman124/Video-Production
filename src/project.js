import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTemplates, validate, lookup } from './templates.js';

const DEFAULTS = { width: 1920, height: 1080, scale: 1, fps: 25 };

export async function loadProject(file) {
  const abs = path.resolve(file);
  const project = JSON.parse(await readFile(abs, 'utf8'));
  return normalizeProject(project, path.dirname(abs), file);
}

// Validates a project object and resolves everything the stage needs. `dir`
// is where relative asset paths (figures, template images, audio) resolve.
export async function normalizeProject(project, dir, label = 'project') {
  const v = { ...DEFAULTS, ...(project.video || {}) };

  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    throw new Error(`${label}: project has no scenes`);
  }

  const needsTemplates = project.scenes.some((s) => s.template);
  const build = needsTemplates ? await buildTemplates() : { registry: {}, aliases: {} };
  const errors = [];

  project.scenes.forEach((s, i) => {
    if (s.template) {
      const t = lookup(build, s.template);
      if (!t) {
        errors.push(`scene ${i}: unknown template "${s.template}"` +
                    ` (registered: ${Object.keys(build.registry).join(', ') || 'none'})`);
        return;
      }
      s.template = t.id;                      // aliases resolve to the canonical id
      s.duration ??= t.meta.duration;
      // Project-level `shared` values (lecture name, logo…) fill any field the
      // template declares and the scene leaves unset.
      const data = { ...(s.data || {}) };
      for (const [k, v] of Object.entries(project.shared || {})) {
        if (k in t.schema && data[k] === undefined) data[k] = structuredClone(v);
      }
      const where = `scene ${i} (${s.template}) data`;
      const r = validate(t.schema, data, { where, assetDir: dir });
      errors.push(...r.errors);
      // Cross-field rules a schema can't express (e.g. every row has one
      // cell per column) live in the template's optional check(data).
      if (!r.errors.length && t.check) {
        for (const msg of [t.check(r.value) || []].flat()) errors.push(`${where}: ${msg}`);
      }
      s.data = r.value;
    } else {
      errors.push(`scene ${i}: needs a "template"`);
      return;
    }
    if (!(s.duration > 0)) errors.push(`scene ${i}: duration must be > 0`);
    const t = s.transition?.duration ?? 0;
    const next = project.scenes[i + 1]?.transition?.duration ?? 0;
    if (t + next > s.duration) {
      errors.push(`scene ${i}: transitions (${t}+${next}ms) exceed duration (${s.duration}ms)`);
    }
  });
  if (errors.length) throw new Error(`${label}:\n    ${errors.join('\n    ')}`);

  // Figures are authored relative to the project file; the stage serves them
  // under /__assets/ so the page can fetch them over http rather than file://.
  for (const s of project.scenes) {
    const src = s.figure?.src;
    if (src && !/^(https?:|data:|\/)/.test(src)) s.figure.src = `/__assets/${src}`;
  }

  project.video = v;
  project.dir = dir;
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
