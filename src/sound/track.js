// Lecture narration track: every slide clip placed at its scene's narration
// start (adelay), mixed (amix, no normalisation so levels stay as voiced),
// then loudness-normalised for publishing.

import { execFileSync } from 'node:child_process';
import { FFMPEG } from '../tools.js';

// clips: [{ file, atMs }] with absolute paths.
export function buildTrack(clips, out, { lufs = -16 } = {}) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const c of clips) args.push('-i', c.file);
  const delays = clips.map((c, i) => `[${i}]adelay=${Math.round(c.atMs)}:all=1[a${i}]`).join(';');
  const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest`;
  const norm = lufs == null ? '' : `,loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
  args.push('-filter_complex', `${delays};${mix}${norm}[out]`, '-map', '[out]', '-ar', '44100', '-ac', '1', out);
  execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return out;
}
