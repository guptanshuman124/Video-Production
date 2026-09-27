// Final video QA helpers (gate V1 consumes their results).

import { spawnSync } from 'node:child_process';
import { FFMPEG, FFPROBE } from './tools.js';
import { openStage } from './stage.js';

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

// For each cue, compare the frame just before it with the frame once the
// entrance has played. Identical PNGs mean the reveal never showed.
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
  try {
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
