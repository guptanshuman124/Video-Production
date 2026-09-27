// Course metadata lookup: config/courses.yaml, optionally overridden for a
// run with --as "class=12,subject=Biology,pack=biology" (applies to every
// course in that run — for trying a course before it is mapped).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const FILE = fileURLToPath(new URL('../../config/courses.yaml', import.meta.url));

export function loadCourses(file = FILE) {
  if (!fs.existsSync(file)) return {};
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  return Object.fromEntries(Object.entries(doc.courses || {}).map(([id, v]) => [Number(id), v]));
}

// "class=12,subject=Biology,pack=biology" -> { class: 12, subject: 'Biology', pack: 'biology' }
export function parseAs(spec) {
  if (!spec) return null;
  const out = {};
  for (const part of String(spec).split(',')) {
    const [k, ...rest] = part.split('=');
    const v = rest.join('=').trim();
    if (!k.trim()) continue;
    out[k.trim()] = /^\d+$/.test(v) ? Number(v) : v === 'null' ? null : v;
  }
  return out;
}

export function courseLookup({ courses = loadCourses(), as = null } = {}) {
  return (id) => {
    if (as) return { slide_language: 'english', ...courses[id], ...as };
    const c = courses[id];
    return c && c.enabled !== false ? c : null;
  };
}
