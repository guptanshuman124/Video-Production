#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { loadProject, normalizeProject, timeline } from './project.js';
import { buildTemplates, describeSchema, lookup, TEMPLATES_DIR } from './templates.js';
import { buildLecture, loadLectures, lectureId } from './lecture.js';
import { openStage } from './stage.js';
import { planFrames, renderChunk, splitRanges } from './capture.js';
import { startEncoder, ffprobe, hasAudio, concatChunks } from './encode.js';
import os from 'node:os';

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
  const draft = has('draft');
  const fps = Number(flag('fps', project.video.fps));
  const scale = draft ? 1 : Number(flag('scale', project.video.scale));
  const out = path.resolve(String(flag('out', draft ? 'out/draft.mp4' : 'out/final.mp4')));
  const jobs = Math.max(1, Number(flag('jobs', 1)));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // PNG is lossless; JPEG q100 measures ~66dB luma PSNR against it and is
  // markedly faster to capture at 4K. The h264 output is yuv420p either way.
  const capture = String(flag('capture', draft ? 'jpeg' : 'png'));
  if (!['png', 'jpeg'].includes(capture)) throw new Error('--capture must be png or jpeg');
  const shot = capture === 'jpeg' ? { type: 'jpeg', quality: 100 } : { type: 'png' };
  const encOpts = {
    crf: Number(flag('crf', draft ? 26 : 18)),
    preset: String(flag('preset', draft ? 'veryfast' : 'slow')),
    inputCodec: capture === 'jpeg' ? 'mjpeg' : 'png',
  };
  const audio = hasAudio(project.audio && path.resolve(project.dir, project.audio));

  const tl = timeline(project);
  const W = project.video.width * scale, H = project.video.height * scale;
  console.log(`\n  ${project.title || path.basename(file)}`);
  console.log(`  ${project.scenes.length} scenes · ${fmt(tl.duration)} · ${W}×${H} @ ${fps}fps` +
              `${draft ? ' (draft)' : ''} · ${capture}${jobs > 1 ? ` · ${jobs} workers` : ''}\n`);

  // One short-lived stage just to read the timeline the runtime actually built.
  const probeStage = await openStage(project, { scale: 1, fps });
  const intervals = await probeStage.page.evaluate(() => window.__motionIntervals(0));
  const duration = await probeStage.page.evaluate(() => window.__duration());
  await probeStage.close();

  const { plan, count, frameMs } = planFrames({ duration, fps, intervals, forceAll: has('all-frames') });
  const shots = plan.filter(Boolean).length;
  const motionMs = intervals.reduce((a, [s, e]) => a + (e - s), 0);
  console.log(`  motion ${fmt(motionMs)} of ${fmt(duration)} · capturing ${shots}/${count} frames ` +
              `(${Math.round((1 - shots / count) * 100)}% held)\n`);

  const ranges = jobs > 1 ? splitRanges(count, jobs) : [[0, count]];
  const t0 = Date.now();
  let done = 0, capturedTotal = 0;
  const tick = () => {
    done++;
    if (done % 10 && done !== count) return;
    const el = (Date.now() - t0) / 1000;
    const eta = done > 8 ? ((el / done) * (count - done)).toFixed(0) : '–';
    process.stdout.write(`\r  ${bar(done / count)} ${String(Math.round(done / count * 100)).padStart(3)}%  ` +
                         `frame ${done}/${count}  shot ${capturedTotal}  eta ${eta}s   `);
  };

  const chunkFile = (i) => path.join(path.dirname(out), `.chunk${String(i).padStart(3, '0')}.mp4`);
  const results = await Promise.all(ranges.map(async ([from, to], i) => {
    const target = ranges.length > 1 ? chunkFile(i) : out;
    const stage = await openStage(project, { scale, fps });
    // Audio is muxed once at the end, never into an individual chunk.
    const encoder = startEncoder({ out: target, fps, ...encOpts,
                                   audio: ranges.length > 1 ? null : audio });
    try {
      const r = await renderChunk({ page: stage.page, encoder, plan, from, to, frameMs, shot,
                                    onFrame: () => { tick(); } });
      capturedTotal += r.captured;
      await encoder.finish();
      return r;
    } finally {
      await stage.close();
    }
  }));
  process.stdout.write('\n');

  if (ranges.length > 1) {
    const files = ranges.map((_, i) => chunkFile(i));
    await concatChunks({ files, out, audio });
    for (const f of files) fs.rmSync(f, { force: true });
  }

  const captured = results.reduce((a, r) => a + r.captured, 0);
  const held = results.reduce((a, r) => a + r.held, 0);
  const probe = await ffprobe(out);
  const v = probe.streams[0];
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n  ✓ ${path.relative(process.cwd(), out)}`);
  console.log(`    ${v.width}×${v.height} ${v.codec_name} ${v.r_frame_rate} · ` +
              `${Number(probe.format.duration).toFixed(2)}s · ` +
              `${(probe.format.size / 1048576).toFixed(1)} MB`);
  console.log(`    ${captured} shot, ${held} held · ${secs.toFixed(1)}s ` +
              `(${(secs / count * 1000).toFixed(0)}ms/frame, ${(count / secs).toFixed(1)} fps)\n`);
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
    const out = path.resolve(typeof snapArg === 'string' ? snapArg : `out/template-${id}.png`);
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
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('template id must be kebab-case: a-z, 0-9, -');
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

// ---- server lecture JSON -> projects ----------------------------------------------

async function lecture() {
  const lectures = loadLectures(file);
  const want = flag('id', null);
  const idx = flag('index', null);
  const lang = String(flag('lang', 'hinglish'));
  const pace = Number(flag('pace', 0.9));
  const outDir = path.resolve(String(flag('out-dir', path.join(path.dirname(file), 'lectures'))));
  const picked = lectures
    .map((lec, i) => ({ lec, i, id: lectureId(lec) }))
    .filter(({ i, id }) => (want == null || want === true ? true : String(id) === String(want))
      && (idx == null || idx === true ? true : i === Number(idx)));
  if (!picked.length) throw new Error(`no lecture matches (ids: ${lectures.map(lectureId).join(', ')})`);

  for (const { lec, id } of picked) {
    const { project, report } = await buildLecture(lec, {
      lang, pace, outDir,
      name: typeof flag('name', null) === 'string' ? flag('name') : undefined,
      lectureName: typeof flag('lecture-name', null) === 'string' ? flag('lecture-name') : undefined,
    });
    const out = path.join(outDir, `lecture-${id}.json`);
    fs.writeFileSync(out, JSON.stringify(project, null, 2) + '\n');
    // validate through the normal loader so problems surface now, not at render time
    const loaded = await loadProject(out);
    const tl = timeline(loaded);
    console.log(`\n  ✓ ${path.relative(process.cwd(), out)}  ·  ${loaded.scenes.length} slides · ${fmt(tl.duration)} · ${lang} narration\n`);
    console.log(report.join('\n'));
    fs.writeFileSync(out.replace(/\.json$/, '.cues.txt'), report.join('\n') + '\n');
  }
  console.log();
}

const usage = `
  hvr render    <project.json> [--draft] [--out f.mp4] [--fps 30] [--crf 18]
                               [--capture png|jpeg] [--preset slow] [--all-frames]
                               [--jobs N]   parallel workers (default 1)
  hvr preview   <project.json> [--scene N]
  hvr probe     <project.json>
  hvr snap      <project.json> [--scene N] [--at ms[,ms…]] [--out f.png]

  hvr templates                                  list registered templates
  hvr template  <id>                             fields + example scene JSON
  hvr template  <id> --snap [f.png] [--at ms[,ms…]] [--data f.json]
                                                 render example (or given) data to PNG
  hvr new-template <id>                          scaffold templates/<id>/

  hvr lecture   <lectures.json> [--id 4969 | --index 0] [--lang hinglish] [--pace 0.9]
                                [--out-dir dir] [--lecture-name "…"] [--name "…"]
                                server lecture data -> timed project(s) + narration track
`;

const COMMANDS = {
  render, preview, probe, snap,
  templates: listTemplates,
  template: () => showTemplate(file),
  'new-template': () => newTemplate(file),
  lecture,
};

try {
  const needsArg = cmd !== 'templates';
  if (!COMMANDS[cmd] || (needsArg && !file)) { console.log(usage); process.exit(1); }
  await COMMANDS[cmd]();
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exit(1);
}
