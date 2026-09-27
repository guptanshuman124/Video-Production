// WAV plumbing for the sound module. Everything is normalised to one format
// (44.1 kHz, mono, 16-bit PCM) so clips can be joined by concatenating
// samples — which is what makes marker times exact: a marker's time is the
// sample offset where its segment starts.

import { execFileSync, spawnSync } from 'node:child_process';
import { FFMPEG } from '../tools.js';

export const RATE = 44100;
const BYTES = 2;

export function makeWav(pcm, rate = RATE, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * BYTES, 28); h.writeUInt16LE(channels * BYTES, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// { rate, channels, bits, format, pcm } for a canonical or chunked WAV.
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let i = 12, fmt = null;
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4);
    let size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(i + 8), channels: buf.readUInt16LE(i + 10), rate: buf.readUInt32LE(i + 12), bits: buf.readUInt16LE(i + 22) };
    if (id === 'data') {
      if (size === 0xffffffff || i + 8 + size > buf.length) size = buf.length - i - 8;   // streamed WAVs
      return fmt && { ...fmt, pcm: buf.subarray(i + 8, i + 8 + size) };
    }
    i += 8 + size + (size % 2);
  }
  return null;
}

// Any audio (wav/mp3/…, or raw s16le with `raw: { rate, channels }`) ->
// canonical 44.1k mono s16 WAV.
export function toStandard(buf, { raw = null } = {}) {
  const w = !raw && readWav(buf);
  if (w && w.format === 1 && w.rate === RATE && w.channels === 1 && w.bits === 16) return makeWav(Buffer.from(w.pcm));
  const input = raw ? ['-f', 's16le', '-ar', String(raw.rate), '-ac', String(raw.channels || 1)] : [];
  const pcm = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...input, '-i', 'pipe:0',
    '-ar', String(RATE), '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'], { input: buf, maxBuffer: 1 << 30 });
  return makeWav(pcm);
}

export const pcmOf = (wav) => readWav(wav).pcm;
export const duration = (wav) => pcmOf(wav).length / (RATE * BYTES);
export const silence = (ms) => Buffer.alloc(Math.round((ms / 1000) * RATE) * BYTES);

// Join canonical WAVs with `gapMs` of silence between them. Returns the joined
// WAV and each input's start time in seconds.
export function join(wavs, gapMs = 0) {
  const parts = [];
  const starts = [];
  let bytes = 0;
  wavs.forEach((w, i) => {
    if (i && gapMs) { const g = silence(gapMs); parts.push(g); bytes += g.length; }
    starts.push(bytes / (RATE * BYTES));
    const p = pcmOf(w);
    parts.push(p);
    bytes += p.length;
  });
  return { wav: makeWav(Buffer.concat(parts)), starts, duration: bytes / (RATE * BYTES) };
}

// Silent stretches longer than `min` seconds: [[start, end], …].
export function silences(file, { noise = '-40dB', min = 1.5 } = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=n=${noise}:d=${min}`, '-f', 'null', '-'],
                      { encoding: 'utf8', maxBuffer: 1 << 26 });
  return parseSilences(r.stderr || '');
}

export function parseSilences(log) {
  const res = [];
  let start = null;
  for (const line of String(log).split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start != null) { res.push([start, Number(e[1])]); start = null; }
  }
  return res;
}
