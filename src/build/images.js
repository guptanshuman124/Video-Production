// NCERT figures, enhanced for a 1080p frame before they are placed —
// deterministically, every one of them.
//
// Half of the catalog figures are under 500 px and are shown in panels up to
// ~1,750 px wide, so the browser would upscale them with a soft bilinear
// filter. Every textbook figure is instead processed once:
//   - JPEG / WebP: light denoising first (removes compression blocks and
//     ringing, which upscaling would magnify);
//   - resampled with Lanczos to `target` px on the long side (at most
//     `max_scale`×; figures already that large keep their size);
//   - an unsharp mask that restores crisp lines and lettering.
// Nothing is redrawn or invented (no AI upscaling): every label and line of
// the textbook figure stays exactly where NCERT put it, just crisper.
// AI-drawn pictures (illustration slides) are not processed.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG } from '../tools.js';
import { imageSize } from '../generation/prepare.js';

const DEFAULTS = { target: 2000, max_scale: 4, sharpen: 0.8, sharpen_large: 0.45, denoise: true };
// A figure's enhanced copy is cached next to it; the settings are part of its name.
const VERSION = 'hd2';

// file: a downloaded figure. Returns { file, width, height, scale } for the
// enhanced copy (`<name>.hd2.png`, reused if present), or { file: null,
// reason } when it could not be enhanced (not a raster image, unreadable,
// ffmpeg failed) — the caller then shows the original and reports it.
export function enhanceFigureInfo(file, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!fs.existsSync(file)) return { file: null, reason: 'the downloaded figure is missing' };
  const buf = fs.readFileSync(file);
  const size = imageSize(buf);
  if (!size) return { file: null, reason: 'not a PNG / JPEG / WebP image' };
  const out = file.replace(/\.[^.]+$/, `.${VERSION}.png`);
  const long = Math.max(size.width, size.height);
  if (long < 16) return { file: null, reason: `figure is only ${size.width}×${size.height}px` };
  const scale = Math.max(1, Math.min(o.max_scale, o.target / long));
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const w = even(size.width * scale), h = even(size.height * scale);
  if (fs.existsSync(out)) return { file: out, width: w, height: h, scale };
  const lossy = buf[0] === 0xff || buf.slice(8, 12).toString() === 'WEBP';
  const amount = scale > 1.15 ? o.sharpen : o.sharpen_large;
  const filters = [
    ...(o.denoise && lossy ? ['hqdn3d=1.5:1.5:0:0'] : []),
    `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int`,
    `unsharp=5:5:${amount}:5:5:0`,
  ];
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', file, '-vf', filters.join(','), '-frames:v', '1', out], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
    return { file: null, reason: `ffmpeg: ${String(r.stderr || r.error?.message || 'failed').trim().slice(0, 200)}` };
  }
  return { file: out, width: w, height: h, scale };
}

// The enhanced copy's path, or null (see enhanceFigureInfo).
export const enhanceFigure = (file, opts = {}) => enhanceFigureInfo(file, opts).file;

export const relTo = (dir, file) => path.relative(dir, file).split(path.sep).join('/');
