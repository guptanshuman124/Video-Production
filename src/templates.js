// Template registry.
//
// Every folder in templates/ (except those starting with "_") is one slide
// template, and its folder name is its id — or a pack of templates, whose ids
// are "<pack>/<folder>" (see templateDirs):
//
//   templates/<id>/template.jsx   required — meta, schema, default render fn
//   templates/<id>/style.css      optional — auto-scoped to [data-template="<id>"]
//   templates/<id>/global.css     optional — unscoped (@font-face, @keyframes)
//   templates/<id>/example.json   optional — sample data, used by `hvr template <id> --snap`
//
// All templates are bundled by esbuild into ONE browser module + ONE stylesheet
// which the stage server hands to the page. Node imports the same bundle to
// read each template's meta/schema for validation — render functions only
// touch `document` when called, so importing them here is safe.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const LIB = path.join(TEMPLATES_DIR, '_lib', 'index.js');
const SHARED = path.join(TEMPLATES_DIR, '_shared');
const LOGO_FILES = ['logo.svg', 'logo.png', 'logo.webp', 'logo.jpg'];
const ASSET_LOADERS = {
  '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.gif': 'dataurl',
  '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.otf': 'dataurl',
};

const visibleDirs = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name);
const isTemplate = (id) => fs.existsSync(path.join(TEMPLATES_DIR, id, 'template.jsx'));

// A folder with a template.jsx is a template ("bio-02-definition-table"). A
// folder without one is a pack (templates/biology/pack.json) whose subfolders
// are its templates, addressed as "<pack>/<slide>" ("biology/definition").
export function templateDirs() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  const ids = [];
  for (const name of visibleDirs(TEMPLATES_DIR)) {
    if (isTemplate(name)) { ids.push(name); continue; }
    for (const sub of visibleDirs(path.join(TEMPLATES_DIR, name))) {
      if (isTemplate(`${name}/${sub}`)) ids.push(`${name}/${sub}`);
    }
  }
  return ids.sort();
}

// Pack manifests (templates/<pack>/pack.json): slide-choice rules, per-type
// counts and image-free fallbacks used by the generation layer.
export function loadPacks() {
  const packs = {};
  if (!fs.existsSync(TEMPLATES_DIR)) return packs;
  for (const name of visibleDirs(TEMPLATES_DIR)) {
    const f = path.join(TEMPLATES_DIR, name, 'pack.json');
    if (!isTemplate(name) && fs.existsSync(f)) packs[name] = { id: name, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  }
  return packs;
}

// A pack as one variant sees it: pack.json `variantRules.<variant>` laid over
// the pack's own per-type limits, flow and fallbacks (Business Studies
// switches off the bookkeeping slides with `max: 0`, so the planner is never
// offered them). Packs without rules for the variant come back unchanged.
export function packFor(pack, variant) {
  const r = variant ? pack?.variantRules?.[variant] : null;
  if (!r) return pack;
  return {
    ...pack,
    types: { ...pack.types, ...r.types },
    flow: { ...pack.flow, ...r.flow },
    fallbacks: { ...pack.fallbacks, ...r.fallbacks },
    ...(r.questionTypes ? { questionTypes: r.questionTypes } : {}),
  };
}

// A template may reuse another pack's template by re-exporting it
// (`export { default } from '../../biology/mcq/template.jsx'`). With no
// style.css of its own, it then gets that template's styles, scoped to itself.
const BASE_RE = /from\s+['"]\.\.\/\.\.\/([\w-]+\/[\w-]+)\/template\.jsx['"]/;
export function baseTemplateOf(id) {
  const src = fs.readFileSync(path.join(TEMPLATES_DIR, id, 'template.jsx'), 'utf8');
  return BASE_RE.exec(src)?.[1] ?? null;
}

function entrySource(ids) {
  const lines = [], rows = [];
  // Brand-wide fonts, colours and shared component styles load first.
  if (fs.existsSync(path.join(SHARED, 'global.css'))) lines.push(`import './_shared/global.css';`);
  ids.forEach((id, i) => {
    const has = (f) => fs.existsSync(path.join(TEMPLATES_DIR, id, f));
    const q = (f) => JSON.stringify(`./${id}/${f}`);
    if (has('global.css')) lines.push(`import ${q('global.css')};`);
    if (has('style.css')) lines.push(`import ${q('style.css')};`);
    else {
      const base = baseTemplateOf(id);
      if (base && fs.existsSync(path.join(TEMPLATES_DIR, base, 'style.css'))) {
        lines.push(`import ${JSON.stringify(`./${base}/style.css?scope=${encodeURIComponent(id)}`)};`);
      }
    }
    lines.push(`import * as t${i} from ${q('template.jsx')};`);
    if (has('example.json')) lines.push(`import e${i} from ${q('example.json')};`);
    rows.push(`  ${JSON.stringify(id)}: { id: ${JSON.stringify(id)}, mod: t${i}, ` +
              `example: ${has('example.json') ? `e${i}` : 'null'} },`);
  });
  return `${lines.join('\n')}\nexport const templates = {\n${rows.join('\n')}\n};\n`;
}

// `import { rich } from 'hvr'` resolves to the shared template runtime,
// `hvr/shared` to the brand components in _shared/, and `hvr/brand` to a
// virtual module exposing the logo dropped in _shared/assets/ (or null).
// Each template's style.css is wrapped in its own scope with native nesting.
const plugin = {
  name: 'hvr-templates',
  setup(b) {
    b.onResolve({ filter: /^hvr$/ }, () => ({ path: LIB }));
    b.onResolve({ filter: /^hvr\/shared$/ }, () => ({ path: path.join(SHARED, 'components.jsx') }));
    b.onResolve({ filter: /^hvr\/brand$/ }, () => ({ path: 'brand', namespace: 'hvr-brand' }));
    b.onLoad({ filter: /.*/, namespace: 'hvr-brand' }, () => {
      const f = LOGO_FILES.map((n) => path.join(SHARED, 'assets', n)).find((p) => fs.existsSync(p));
      return f
        ? { contents: `export { default as logo } from ${JSON.stringify(f)};`, loader: 'js', resolveDir: SHARED }
        : { contents: 'export const logo = null;', loader: 'js' };
    });
    // KaTeX ships woff2 + woff + ttf for every face; keep only woff2 so the
    // inlined bundle stays small (Chromium only ever picks woff2).
    b.onLoad({ filter: /katex(\.min)?\.css$/ }, async (args) => {
      const css = (await fs.promises.readFile(args.path, 'utf8'))
        .replace(/,\s*url\([^)]+\.woff\) format\("woff"\)/g, '')
        .replace(/,\s*url\([^)]+\.ttf\) format\("truetype"\)/g, '');
      return { contents: css, loader: 'css', resolveDir: path.dirname(args.path) };
    });
    // A base template's style.css imported for a re-exporting template. The
    // scope is part of the module path: esbuild keys modules by path, and two
    // packs reusing one stylesheet must get two differently scoped copies.
    b.onResolve({ filter: /style\.css\?scope=/ }, (args) => {
      const [rel, query] = args.path.split('?scope=');
      return { path: `${path.resolve(args.resolveDir, rel)}|${decodeURIComponent(query)}`, namespace: 'hvr-scoped-css' };
    });
    b.onLoad({ filter: /.*/, namespace: 'hvr-scoped-css' }, async (args) => {
      const [file, scope] = args.path.split('|');
      const css = await fs.promises.readFile(file, 'utf8');
      return { contents: `[data-template="${scope}"] {\n${css}\n}\n`, loader: 'css', resolveDir: path.dirname(file) };
    });
    b.onLoad({ filter: /[\\/]style\.css$/ }, async (args) => {
      const id = path.relative(TEMPLATES_DIR, path.dirname(args.path)).split(path.sep).join('/');
      const css = await fs.promises.readFile(args.path, 'utf8');
      return { contents: `[data-template="${id}"] {\n${css}\n}\n`, loader: 'css',
               resolveDir: path.dirname(args.path) };
    });
  },
};

let cache = null;

export async function buildTemplates({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  const ids = templateDirs();
  let result;
  try {
    result = await esbuild.build({
      stdin: { contents: entrySource(ids), resolveDir: TEMPLATES_DIR, sourcefile: 'registry.js', loader: 'js' },
      bundle: true, format: 'esm', write: false, outdir: 'out', platform: 'browser',
      target: 'chrome120', jsxFactory: '__h', jsxFragment: '__Fragment', inject: [LIB],
      loader: { '.js': 'jsx', '.jsx': 'jsx', ...ASSET_LOADERS },
      plugins: [plugin], logLevel: 'silent', legalComments: 'none',
    });
  } catch (e) {
    const msg = (e.errors || []).map((er) =>
      `${er.location ? `${path.relative(process.cwd(), er.location.file)}:${er.location.line}: ` : ''}${er.text}`)
      .join('\n    ');
    throw new Error(`template build failed:\n    ${msg || e.message}`);
  }
  const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? 'export const templates = {};';
  const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  const { templates } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

  const registry = {};
  for (const [id, t] of Object.entries(templates)) {
    if (typeof t.mod.default !== 'function') {
      throw new Error(`templates/${id}/template.jsx must \`export default function\``);
    }
    registry[id] = {
      id,
      meta: { name: id, description: '', duration: 6000, ...(t.mod.meta || {}) },
      schema: t.mod.schema || {},
      check: typeof t.mod.check === 'function' ? t.mod.check : null,
      example: t.example,
    };
  }
  // meta.aliases let a deck address templates by page number ("bio-05") or
  // by an older name, all resolving to one canonical folder id.
  const aliases = {};
  for (const t of Object.values(registry)) {
    for (const al of t.meta.aliases || []) {
      if (registry[al] || (aliases[al] && aliases[al] !== t.id)) {
        throw new Error(`template alias "${al}" (templates/${t.id}) collides with ${registry[al] ? 'a template id' : `templates/${aliases[al]}`}`);
      }
      aliases[al] = t.id;
    }
  }
  cache = { js, css, registry, aliases };
  return cache;
}

// Canonical template for an id or alias, or undefined.
export function lookup(build, id) {
  return build.registry[id] || build.registry[build.aliases[id]];
}

// ---- data validation --------------------------------------------------------
//
// Schema is a map of field -> spec. A spec is either a string shorthand
// ('text', 'text!' for required, 'number', 'image!', …) or an object:
//
//   { type: 'text', required: true, default: '…', max: 80 }
//   { type: 'number', min: 0, max: 100 }
//   { type: 'boolean' }
//   { type: 'enum', values: ['left', 'right'], default: 'left' }
//   { type: 'color' }                                  any CSS colour string
//   { type: 'image' }                                  path relative to the project file, or URL
//   { type: 'list', of: <spec>, min: 1, max: 6 }
//   { type: 'object', fields: { …schema… } }
//
// Unknown keys are rejected (catches typos); keys starting with "_" are
// treated as comments and dropped.

const TYPES = new Set(['text', 'number', 'boolean', 'enum', 'color', 'image', 'list', 'object', 'any']);

function norm(spec) {
  if (typeof spec === 'string') {
    const required = spec.endsWith('!');
    return { type: required ? spec.slice(0, -1) : spec, required };
  }
  if (Array.isArray(spec)) return { type: 'list', of: spec[0] };
  if (spec && !spec.type) return { type: 'object', fields: spec };
  return spec;
}

export function validate(schema, data, { where = 'data', assetDir = null } = {}) {
  const errors = [];
  const fail = (p, msg) => errors.push(`${p}: ${msg}`);

  const check = (raw, val, p) => {
    const spec = norm(raw);
    if (!TYPES.has(spec.type)) { fail(p, `schema has unknown type "${spec.type}"`); return val; }
    if (val === undefined || val === null) {
      if ('default' in spec) return structuredClone(spec.default);
      if (spec.required || (spec.type === 'list' && spec.min > 0)) fail(p, 'required');
      return spec.type === 'list' ? [] : undefined;
    }
    switch (spec.type) {
      case 'any': return val;
      case 'text':
        if (typeof val !== 'string' && typeof val !== 'number') return fail(p, 'expected text');
        if (spec.max && String(val).length > spec.max) fail(p, `longer than ${spec.max} chars`);
        return String(val);
      case 'number':
        if (typeof val !== 'number' || !Number.isFinite(val)) return fail(p, 'expected a number');
        if (spec.min != null && val < spec.min) fail(p, `must be ≥ ${spec.min}`);
        if (spec.max != null && val > spec.max) fail(p, `must be ≤ ${spec.max}`);
        return val;
      case 'boolean':
        if (typeof val !== 'boolean') return fail(p, 'expected true/false');
        return val;
      case 'enum':
        if (!spec.values.includes(val)) return fail(p, `must be one of ${spec.values.map((v) => JSON.stringify(v)).join(', ')}`);
        return val;
      case 'color':
        if (typeof val !== 'string') return fail(p, 'expected a CSS colour string');
        return val;
      case 'image': {
        if (typeof val !== 'string') return fail(p, 'expected an image path or URL');
        if (/^(https?:|data:|\/)/.test(val)) return val;
        const abs = assetDir ? path.resolve(assetDir, val) : null;
        if (abs && !fs.existsSync(abs)) fail(p, `file not found: ${val}`);
        // Paths that leave the project folder ("../shared/x.png") can't ride
        // /__assets/ (the browser normalises "..") so they go by absolute path.
        if (abs && (path.relative(assetDir, abs).startsWith('..') || path.isAbsolute(path.relative(assetDir, abs)))) return `/__abs/${encodeURIComponent(abs)}`;
        return `/__assets/${val}`;
      }
      case 'list': {
        if (!Array.isArray(val)) return fail(p, 'expected a list');
        if (spec.min != null && val.length < spec.min) fail(p, `needs at least ${spec.min} item(s)`);
        if (spec.max != null && val.length > spec.max) fail(p, `allows at most ${spec.max} item(s)`);
        return val.map((v, i) => check(spec.of ?? 'any', v, `${p}[${i}]`));
      }
      case 'object': {
        if (typeof val !== 'object' || Array.isArray(val)) return fail(p, 'expected an object');
        const out = {};
        const fields = spec.fields || {};
        for (const k of Object.keys(val)) {
          if (!k.startsWith('_') && !(k in fields)) fail(`${p}.${k}`, `unknown field (allowed: ${Object.keys(fields).join(', ') || 'none'})`);
        }
        for (const [k, f] of Object.entries(fields)) {
          const v = check(f, val[k], `${p}.${k}`);
          if (v !== undefined) out[k] = v;
        }
        return out;
      }
    }
  };

  const value = check({ type: 'object', fields: schema }, data ?? {}, where);
  return { value, errors };
}

// Human-readable one-line-per-field description of a schema, for the CLI.
export function describeSchema(schema, indent = '    ') {
  const out = [];
  const walk = (fields, pre) => {
    for (const [k, raw] of Object.entries(fields)) {
      const s = norm(raw);
      let t = s.type;
      if (s.type === 'enum') t = s.values.map((v) => JSON.stringify(v)).join(' | ');
      if (s.type === 'list') {
        const of = norm(s.of ?? 'any');
        t = `list of ${of.type}${s.min != null || s.max != null ? ` (${s.min ?? 0}–${s.max ?? '∞'})` : ''}`;
      }
      const bits = [s.required || (s.type === 'list' && s.min > 0) ? 'required' : 'optional'];
      if ('default' in s) bits.push(`default ${JSON.stringify(s.default)}`);
      if (s.max && s.type === 'text') bits.push(`≤${s.max} chars`);
      out.push(`${indent}${pre}${k.padEnd(18 - pre.length)} ${t.padEnd(22)} ${bits.join(', ')}` +
               `${s.description ? `  — ${s.description}` : ''}`);
      if (s.type === 'object') walk(s.fields || {}, `${pre}${k}.`);
      if (s.type === 'list' && norm(s.of ?? 'any').type === 'object') walk(norm(s.of).fields || {}, `${pre}${k}[].`);
    }
  };
  walk(schema, '');
  return out.join('\n');
}
