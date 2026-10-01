import { spawnSync } from 'node:child_process';
import { FFMPEG } from './src/tools.js';
export function pauses(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8' });
  const ds = [...r.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  const total = Number((r.stderr.match(/time=(\d+):(\d+):([\d.]+)/g) || []).pop()?.replace(/time=/, '').split(':').reduce((a, x) => a * 60 + Number(x), 0) || 0);
  const sum = ds.reduce((a, b) => a + b, 0);
  const n = (lo, hi) => ds.filter((d) => d >= lo && d < hi).length;
  return { total: +total.toFixed(1), pauses: ds.length, silent_s: +sum.toFixed(1), silent_pct: +(100 * sum / total).toFixed(1), short_0_12_0_3: n(0.12, 0.3), mid_0_3_0_6: n(0.3, 0.6), long_0_6: n(0.6, 99), avg: +(sum / (ds.length || 1)).toFixed(2) };
}
