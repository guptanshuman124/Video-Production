// NCERT figures, made sharper for a 1080p frame — deterministically.
//
// Half of the catalog figures are under 500 px and are shown in panels up to
// ~860 px, so the browser would upscale them with a soft bilinear filter. We
// resample them once with Lanczos and a light unsharp mask instead. Nothing
// is redrawn or invented (no AI upscaling): every label and line of the
// textbook figure stays exactly where NCERT put it, just crisper.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG } from '../tools.js';
import { imageSize } from '../generation/prepare.js';

const DEFAULTS = { min_side: 1100, target: 1500, max_scale: 3 };

// file: a downloaded figure. Returns the path of the sharpened copy
// (`<name>.hd.png`, reused if present), or null when the figure is already
// large enough, is not a raster image, or ffmpeg is unavailable/fails.
export function enhanceFigure(file, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!/\.(png|jpe?g|webp)$/i.test(file) || !fs.existsSync(file)) return null;
  const out = file.replace(/\.[^.]+$/, '.hd.png');
  if (fs.existsSync(out)) return out;
  const size = imageSize(fs.readFileSync(file));
  if (!size) return null;
  const long = Math.max(size.width, size.height);
  if (long >= o.min_side || long < 64) return null;
  const scale = Math.min(o.max_scale, o.target / long);
  if (scale < 1.15) return null;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const w = even(size.width * scale), h = even(size.height * scale);
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', file,
    '-vf', `scale=${w}:${h}:flags=lanczos,unsharp=5:5:0.45:5:5:0`, '-frames:v', '1', out], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) { try { fs.rmSync(out, { force: true }); } catch { /* ignore */ } return null; }
  return out;
}

export const relTo = (dir, file) => path.relative(dir, file).split(path.sep).join('/');
