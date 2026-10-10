// Final video QA helpers (gate V1 consumes their results).

import { spawnSync } from 'node:child_process';
import { FFMPEG, FFPROBE } from './tools.js';
import { openStage, launchBrowser } from './stage.js';

export function probeAll(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// [[start, end], …] seconds of (near-)black picture.
export function blackSegments(file, { min = 0.5, pix = 0.1 } = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-vf', `blackdetect=d=${min}:pix_th=${pix}`, '-an', '-f', 'null', '-'],
                      { encoding: 'utf8', maxBuffer: 1 << 26 });
  return [...String(r.stderr).matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

// Content the stage could not fit into its box even after wrapping and
// shrinking (stage/index.html fitOverflow / layoutIssues): [{ where, what, px? }].
async function layoutOf(stage, seen, out) {
  for (const x of await stage.page.evaluate(() => window.__layoutIssues?.() || [])) {
    const key = `${x.scene}|${x.what}`;
    if (!seen.has(key)) { seen.add(key); out.push({ where: `s${String(x.scene + 1).padStart(2, '0')}`, what: x.what, ...(x.px != null ? { px: x.px } : {}) }); }
  }
}

// For each cue, compare the frame just before it with the frame once the
// entrance has played. Identical PNGs mean the reveal never showed.
// The returned list also carries `.layout`: content that does not fit its box.
export async function revealCheck(project, cues, { before = 60, after = 900 } = {}) {
  const stage = await openStage(project, { scale: 1, fps: project.video.fps });
  const shot = async (ms) => {
    await stage.page.evaluate(async (t) => {
      window.__seek(t);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, ms);
    return stage.page.screenshot({ type: 'png', animations: 'allow' });
  };
  const out = [];
  out.layout = [];
  try {
    await layoutOf(stage, new Set(), out.layout);
    for (const c of cues) {
      if (c.cueAt == null) continue;
      const t = c.cueAt * 1000;
      const a = await shot(Math.max(0, t - before));
      const b = await shot(t + after);
      out.push({ where: `s${String(c.scene + 1).padStart(2, '0')}/${c.marker}`, changed: !a.equals(b) });
    }
  } finally {
    await stage.close();
  }
  return out;
}

// The same check for a long video (summary videos): cues are checked on light
// pages — each builds only `windowMinutes` of slides, all in one browser — and
// a cue that looks unchanged is re-checked `recheck` times with more time to
// settle before it counts as not visible. One page holding a whole 87-minute
// summary sometimes returned a stale frame in the worker pod, so a reveal that
// was on screen read as "nothing changed" (2026-10-05, summary 86).
export async function revealCheckLong(project, cues, { before = 60, after = 900, windowMinutes = 10, recheck = 2 } = {}) {
  const list = cues.filter((c) => c.cueAt != null).map((c) => ({ ...c, t: c.cueAt * 1000 })).sort((a, b) => a.t - b.t);
  const out = [];
  out.layout = [];
  const seen = new Set();
  if (!list.length) return out;
  const span = windowMinutes * 60000;
  const browser = await launchBrowser();
  try {
    for (let i = 0; i < list.length;) {
      const start = list[i].t;
      const group = [];
      while (i < list.length && list[i].t < start + span) group.push(list[i++]);
      const stage = await openStage(project, { scale: 1, fps: project.video.fps, browser, window: [start - before - 3000, group.at(-1).t + after + 3000] });
      const shot = async (ms, settle) => {
        await stage.page.evaluate(async ([t, wait]) => {
          window.__seek(t);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          if (wait) await new Promise((r) => setTimeout(r, wait));
          await new Promise((r) => requestAnimationFrame(r));
        }, [ms, settle]);
        return stage.page.screenshot({ type: 'png', animations: 'allow' });
      };
      try {
        await layoutOf(stage, seen, out.layout);
        for (const c of group) {
          let changed = false;
          for (let k = 0; k <= recheck && !changed; k++) {
            const settle = k * 250;
            const a = await shot(Math.max(0, c.t - before), settle);
            const b = await shot(c.t + after, settle);
            changed = !a.equals(b);
          }
          out.push({ where: `s${String(c.scene + 1).padStart(2, '0')}/${c.marker}`, changed });
        }
      } finally {
        await stage.close();
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}
