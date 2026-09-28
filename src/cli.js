#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { loadProject, normalizeProject, timeline } from './project.js';
import { buildTemplates, describeSchema, lookup, TEMPLATES_DIR } from './templates.js';
import { openStage } from './stage.js';
import { renderProject } from './render.js';
import * as product from './commands.js';
import os from 'node:os';

// Secrets (OPENAI_API_KEY, SARVAM_API_KEY, …) may live in a local .env.
try { process.loadEnvFile('.env'); } catch { /* no .env */ }

const args = process.argv.slice(2);
const cmd = args[0];
const file = args[1];
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true);
};
const has = (n) => args.includes(`--${n}`);

const fmt = (ms) => `${(ms / 1000).toFixed(2)}s`;
const bar = (p) => { const w = 26, f = Math.round(p * w); return '█'.repeat(f) + '░'.repeat(w - f); };

async function render() {
  const project = await loadProject(file);
  console.log(`\n  ${project.title || path.basename(file)}`);
  const r = await renderProject(project, {
    draft: has('draft'),
    out: flag('out', undefined),
    fps: flag('fps', undefined),
    scale: flag('scale', undefined),
    jobs: flag('jobs', 1),
    capture: flag('capture', undefined),
    crf: flag('crf', undefined),
    preset: flag('preset', undefined),
    tune: flag('tune', undefined),
    allFrames: has('all-frames'),
    log: (line) => console.log(`  ${line}\n`),
    onFrame: (done, count, shot) => {
      if (done % 10 && done !== count) return;
      process.stdout.write(`\r  ${bar(done / count)} ${String(Math.round(done / count * 100)).padStart(3)}%  ` +
                           `frame ${done}/${count}  shot ${shot}   `);
    },
  });
  process.stdout.write('\n');
  const v = r.probe.streams[0];
  console.log(`\n  ✓ ${path.relative(process.cwd(), r.out)}`);
  console.log(`    ${v.width}×${v.height} ${v.codec_name} ${v.r_frame_rate} · ` +
              `${Number(r.probe.format.duration).toFixed(2)}s · ` +
              `${(r.probe.format.size / 1048576).toFixed(1)} MB`);
  console.log(`    ${r.captured} shot, ${r.held} held · ${r.seconds.toFixed(1)}s ` +
              `(${(r.seconds / r.count * 1000).toFixed(0)}ms/frame, ${(r.count / r.seconds).toFixed(1)} fps)\n`);
}

// Headed browser with a scrub bar — iterate on layouts without rendering.
async function preview() {
  const project = await loadProject(file);
  const stage = await openStage(project, { headed: true, scale: 1 });
  const scene = flag('scene', null);
  const tl = timeline(project);
  const start = scene !== null && scene !== true ? tl.starts[Number(scene)] : 0;

  await stage.page.evaluate((t0) => {
    window.__seek(t0);
    const d = window.__duration();
    const ui = document.createElement('div');
    ui.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;padding:14px 20px;' +
      'background:rgba(0,0,0,.72);display:flex;gap:14px;align-items:center;font:600 13px system-ui;color:#fff';
    ui.innerHTML = `<input type="range" min="0" max="${d}" value="${t0}" step="16" style="flex:1">
                    <span id="tv" style="width:130px;font-variant-numeric:tabular-nums"></span>
                    <button id="pl" style="padding:6px 14px">play</button>`;
    document.body.appendChild(ui);
    const r = ui.querySelector('input'), tv = ui.querySelector('#tv'), pl = ui.querySelector('#pl');
    const show = (t) => { tv.textContent = `${(t / 1000).toFixed(2)}s / ${(d / 1000).toFixed(2)}s`; };
    r.oninput = () => { window.__seek(+r.value); show(+r.value); };
    show(t0);
    let raf = null, base = 0, from = 0;
    pl.onclick = () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; pl.textContent = 'play'; return; }
      pl.textContent = 'pause'; base = performance.now(); from = +r.value;
      const tick = (now) => {
        const t = from + (now - base);
        if (t >= d) { window.__seek(d); r.value = d; show(d); raf = null; pl.textContent = 'play'; return; }
        window.__seek(t); r.value = t; show(t); raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
  }, start);

  console.log(`\n  preview open · ${fmt(tl.duration)} · close the window to exit\n`);
  await stage.page.waitForEvent('close', { timeout: 0 }).catch(() => {});
}

async function probe() {
  const project = await loadProject(file);
  const tl = timeline(project);
  console.log(`\n  ${project.title || file} — ${fmt(tl.duration)} total\n`);
  project.scenes.forEach((s, i) => {
    const kind = s.template ? `▦ ${s.template}` : s.layout;
    const label = s.headline || s.data?.title || s.data?.headline || '';
    console.log(`  ${String(i + 1).padStart(2)}. ${kind.padEnd(16)} ` +
                `${fmt(tl.starts[i]).padStart(7)} → ${fmt(tl.starts[i] + s.duration).padStart(7)}  ` +
                `${(s.transition?.name || 'dissolve').padEnd(9)} ${label.slice(0, 44)}`);
  });
  console.log();
}

// ---- stills -----------------------------------------------------------------

// Screenshot one scene. With no --at, it shoots the settled frame: entrances
// done, exits and the outgoing transition not yet started.
async function snapScenes(project, sceneIdx, ats, outBase) {
  const tl = timeline(project);
  const s = project.scenes[sceneIdx];
  if (!s) throw new Error(`no scene ${sceneIdx} (project has ${project.scenes.length})`);
  const isLast = sceneIdx === project.scenes.length - 1;
  const tail = isLast ? (project.fadeOut ?? 700) : tl.tIn[sceneIdx + 1];
  const stage = await openStage(project, { scale: Number(flag('scale', 1)) });
  // Settled = just before the first exit animation, or before the outgoing
  // transition when the scene has no exits.
  const { exitStart } = await stage.page.evaluate((i) => window.__sceneTime(i), sceneIdx);
  const settled = exitStart != null ? Math.floor(exitStart - tl.starts[sceneIdx]) - 1 : s.duration - tail - 1;
  const files = [];
  try {
    for (const at of ats) {
      const rel = at == null ? settled : Math.min(at, s.duration - 1);
      const out = ats.length > 1 ? outBase.replace(/\.png$/, `-${String(rel).padStart(5, '0')}.png`) : outBase;
      await stage.page.evaluate(async (ms) => {
        window.__seek(ms);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, tl.starts[sceneIdx] + rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await stage.page.screenshot({ path: out, animations: 'allow', scale: 'device' });
      files.push(out);
    }
  } finally {
    await stage.close();
  }
  for (const f of files) console.log(`  ✓ ${path.relative(process.cwd(), f)}`);
  console.log();
}

const parseAts = () => {
  const at = flag('at', null);
  return at === null || at === true ? [null] : String(at).split(',').map(Number);
};

async function snap() {
  const project = await loadProject(file);
  const scene = Number(flag('scene', 0));
  const out = path.resolve(String(flag('out', `out/snap-scene${scene}.png`)));
  await snapScenes(project, scene, parseAts(), out);
}

// ---- template registry --------------------------------------------------------

async function listTemplates() {
  const { registry } = await buildTemplates();
  const rows = Object.values(registry);
  console.log(`\n  ${rows.length} template(s) in ${path.relative(process.cwd(), TEMPLATES_DIR)}/\n`);
  for (const t of rows) {
    const al = t.meta.aliases?.length ? `  [${t.meta.aliases.join(', ')}]` : '';
    console.log(`  ▦ ${t.id.padEnd(28)} ${fmt(t.meta.duration).padStart(6)}  ${t.meta.name}${al}`);
  }
  console.log();
}

async function showTemplate(name) {
  const build = await buildTemplates();
  const t = lookup(build, name);
  if (!t) throw new Error(`unknown template "${name}" (registered: ${Object.keys(build.registry).join(', ') || 'none'})`);
  const id = t.id;

  if (has('snap')) {
    // Render the template alone with its example data, no fades.
    // --data f.json swaps in other sample data (e.g. reference.json, the
    // placeholder text of the design, for pixel comparison).
    const dataArg = flag('data', null);
    const dataFile = typeof dataArg === 'string' ? path.resolve(dataArg) : null;
    const data = dataFile ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : structuredClone(t.example || {});
    const dir = dataFile ? path.dirname(dataFile) : path.join(TEMPLATES_DIR, id);
    const project = await normalizeProject({
      title: id, fadeIn: 0, fadeOut: 0,
      scenes: [{ template: id, data, transition: { name: 'cut', duration: 0 } }],
    }, dir, dataFile ? path.relative(process.cwd(), dataFile) : `templates/${id}/example.json`);
    const snapArg = flag('snap', true);
    const out = path.resolve(typeof snapArg === 'string' ? snapArg : `out/template-${id.replaceAll('/', '-')}.png`);
    console.log();
    await snapScenes(project, 0, parseAts(), out);
    return;
  }

  console.log(`\n  ▦ ${id} — ${t.meta.name}${t.meta.aliases?.length ? `   (also: ${t.meta.aliases.join(', ')})` : ''}`);
  if (t.meta.description) console.log(`    ${t.meta.description}`);
  console.log(`    default duration ${fmt(t.meta.duration)}\n\n  data fields\n${describeSchema(t.schema)}\n`);
  const scene = { template: id, duration: t.meta.duration, transition: { name: 'dissolve', duration: 700 },
                  data: t.example || {} };
  console.log(`  scene JSON\n${JSON.stringify(scene, null, 2).replace(/^/gm, '    ')}\n`);
}

function newTemplate(id) {
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/.test(id)) {
    throw new Error('template id must be kebab-case (a-z, 0-9, -), optionally as <pack>/<slide>');
  }
  const dest = path.join(TEMPLATES_DIR, id);
  if (fs.existsSync(dest)) throw new Error(`templates/${id} already exists`);
  const src = path.join(TEMPLATES_DIR, '_starter');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.writeFileSync(path.join(dest, f), fs.readFileSync(path.join(src, f), 'utf8').replaceAll('__ID__', id));
  }
  console.log(`\n  ✓ templates/${id}/  (template.jsx, style.css, example.json)`);
  console.log(`    preview:  node src/cli.js template ${id} --snap\n`);
}

const usage = `
  LECTURE FACTORY (Kubernetes: npm run factory -- up; dashboard http://localhost:8080)
  hvr central                                    backend + scheduler + dashboard (FACTORY_DB_URL, TEXTBOOK_DB_URL, LIBRARY_DIR)
  hvr worker                                     claim lectures from CENTRAL_URL and produce them

  TEXTBOOK LECTURES (tutorai.textbook_raw: one row = one video)
  hvr lectures  --source <export.jsonl | db> [--course 58] [--module 338] [--lecture 1717]
                [--as "class=12,subject=Biology,pack=biology"] [--shard 2/8] [run flags below]
  hvr source audit  --source <export.jsonl | db> [--course …]   parse every row, G0 precheck, hours
  hvr source courses --catalog <db | catalog.jsonl> --source <db | export.jsonl>   -> config/courses.yaml
  hvr source export --out f.jsonl [--catalog-out c.jsonl] [--course …]   TEXTBOOK_DB_URL -> JSONL

  PIPELINE (chapter JSON -> 5 validated lecture videos)
  hvr run       <chapter.json> [--lecture 1,2] [--from <stage>] [--to <stage>] [--skip review]
                               [--mock | --mock-llm | --mock-tts] [--config f.yaml] [--offline]
                               [--draft] [--jobs N] [--no-reveal-check]
                stages: prepare chapter-plan slide-plan slide-write narrate hinglish review
                        assemble voice build render qa
  hvr generate  <chapter.json> [same flags]        run up to Content JSON (no audio/video)
  hvr batch     <folder> [--shard 2/8] [same flags] every chapter JSON in a folder (resumable)
  hvr status    <chapter_id>                     stage results + review queue
  hvr packs                                      template packs and their slide types
  hvr prompt    <layer> [--pack biology] [--class 11] [--schema --type mcq]
                layers: chapter-plan slide-plan slide-write narrate hinglish review

  RENDERER
  hvr render    <project.json> [--draft] [--out f.mp4] [--fps 25] [--crf 18]
                               [--capture png|jpeg] [--preset slow] [--tune stillimage] [--all-frames]
                               [--jobs N]   parallel workers (default 1)
  hvr preview   <project.json> [--scene N]
  hvr probe     <project.json>
  hvr snap      <project.json> [--scene N] [--at ms[,ms…]] [--out f.png]

  hvr templates                                  list registered templates
  hvr template  <id>                             fields + example scene JSON
  hvr template  <id> --snap [f.png] [--at ms[,ms…]] [--data f.json]
                                                 render example (or given) data to PNG
  hvr new-template <id>                          scaffold templates/<id>/
`;

const COMMANDS = {
  render, preview, probe, snap,
  templates: listTemplates,
  template: () => showTemplate(file),
  'new-template': () => newTemplate(file),
  run: () => product.run(file, flag, has),
  generate: () => product.run(file, flag, has, { to: 'assemble' }),
  batch: () => product.batch(file, flag, has),
  lectures: () => product.lectures(flag, has),
  source: () => (file === 'audit' ? product.sourceAudit(flag, has) : file === 'export' ? product.sourceExport(flag) : file === 'courses' ? product.sourceCourses(flag) : Promise.reject(new Error('hvr source audit | courses | export'))),
  status: () => product.status(file, flag, has),
  packs: () => product.packs(),
  prompt: () => product.prompt(file, flag, has),
  central: async () => (await import('./factory/central.js')).runCentral(),
  worker: async () => (await import('./factory/worker.js')).runWorker(),
};

try {
  const needsArg = !['templates', 'packs', 'lectures', 'central', 'worker'].includes(cmd);
  if (!COMMANDS[cmd] || (needsArg && !file)) { console.log(usage); process.exit(1); }
  await COMMANDS[cmd]();
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exit(1);
}
