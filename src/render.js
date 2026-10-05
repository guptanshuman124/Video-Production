// Project -> mp4. Shared by `hvr render` and the pipeline's render stage.

import path from 'node:path';
import fs from 'node:fs';
import { timeline } from './project.js';
import { openStage, launchBrowser } from './stage.js';
import { planFrames, renderChunk, splitRanges } from './capture.js';
import { startEncoder, ffprobe, hasAudio, concatChunks } from './encode.js';

const fmt = (ms) => `${(ms / 1000).toFixed(2)}s`;

// opts: out, fps, scale, jobs, capture (png|jpeg), crf, preset, tune,
// allFrames, draft; log(line) for status lines, onFrame(done, count, shot)
// for progress. Returns { out, probe, captured, held, count, seconds }.
export async function renderProject(project, opts = {}) {
  const log = opts.log || (() => {});
  const draft = !!opts.draft;
  const fps = Number(opts.fps ?? project.video.fps);
  const scale = draft ? 1 : Number(opts.scale ?? project.video.scale);
  const out = path.resolve(opts.out || (draft ? 'out/draft.mp4' : 'out/final.mp4'));
  const jobs = Math.max(1, Number(opts.jobs ?? 1));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // PNG is lossless; JPEG q100 measures ~66dB luma PSNR against it and is
  // markedly faster to capture at 4K. The h264 output is yuv420p either way.
  const capture = String(opts.capture ?? (draft ? 'jpeg' : 'png'));
  if (!['png', 'jpeg'].includes(capture)) throw new Error('capture must be png or jpeg');
  const shot = capture === 'jpeg' ? { type: 'jpeg', quality: 100 } : { type: 'png' };
  const encOpts = {
    crf: Number(opts.crf ?? (draft ? 26 : 18)),
    preset: String(opts.preset ?? (draft ? 'veryfast' : (project.video.preset ?? 'slow'))),
    tune: opts.tune ?? project.video.tune ?? null,
    inputCodec: capture === 'jpeg' ? 'mjpeg' : 'png',
    threads: opts.threads ?? null,
    lookahead: opts.lookahead ?? null,
  };
  const audio = hasAudio(project.audio && path.resolve(project.dir, project.audio));

  const tl = timeline(project);
  const W = project.video.width * scale, H = project.video.height * scale;
  log(`${project.scenes.length} scenes · ${fmt(tl.duration)} · ${W}×${H} @ ${fps}fps` +
      `${draft ? ' (draft)' : ''} · ${capture}${jobs > 1 ? ` · ${jobs} workers` : ''}`);

  // One short-lived stage just to read the timeline the runtime actually built.
  const probeStage = await openStage(project, { scale: 1, fps });
  const intervals = await probeStage.page.evaluate(() => window.__motionIntervals(0));
  const duration = await probeStage.page.evaluate(() => window.__duration());
  await probeStage.close();

  const { plan, count, frameMs } = planFrames({ duration, fps, intervals, forceAll: !!opts.allFrames });
  const shots = plan.filter(Boolean).length;
  const motionMs = intervals.reduce((a, [s, e]) => a + (e - s), 0);
  log(`motion ${fmt(motionMs)} of ${fmt(duration)} · capturing ${shots}/${count} frames ` +
      `(${Math.round((1 - shots / count) * 100)}% held)`);

  const ranges = jobs > 1 ? splitRanges(count, jobs) : [[0, count]];
  const t0 = Date.now();
  let done = 0, capturedTotal = 0;

  const chunkFile = (i) => path.join(path.dirname(out), `.${path.basename(out)}.chunk${String(i).padStart(3, '0')}.mp4`);
  const results = await Promise.all(ranges.map(async ([from, to], i) => {
    const target = ranges.length > 1 ? chunkFile(i) : out;
    const stage = await openStage(project, { scale, fps });
    // Audio is muxed once at the end, never into an individual chunk.
    const encoder = startEncoder({ out: target, fps, ...encOpts,
                                   audio: ranges.length > 1 ? null : audio });
    try {
      const r = await renderChunk({ page: stage.page, encoder, plan, from, to, frameMs, shot,
                                    onFrame: () => { done++; opts.onFrame?.(done, count, capturedTotal); } });
      capturedTotal += r.captured;
      await encoder.finish();
      return r;
    } finally {
      await stage.close();
    }
  }));

  if (ranges.length > 1) {
    const files = ranges.map((_, i) => chunkFile(i));
    await concatChunks({ files, out, audio });
    for (const f of files) fs.rmSync(f, { force: true });
  }

  return {
    out,
    probe: await ffprobe(out),
    captured: results.reduce((a, r) => a + r.captured, 0),
    held: results.reduce((a, r) => a + r.held, 0),
    count,
    seconds: (Date.now() - t0) / 1000,
  };
}

// ---- summary videos: rendered in pieces, across workers ------------------------------------
//
// A summary (~1 hour) is not rendered in one go like a lecture: its timeline is
// cut into pieces of a few minutes (piecePlan), any worker renders any piece
// (renderPiece — frames [from, to) of the same deterministic timeline, on fresh
// browser pages, video only), and the pieces are joined with a stream copy and
// the voice track muxed once (joinPieces). A piece is one file plus a .done
// marker written only after it is complete and checked, so a lost or killed
// worker costs one piece, never the whole render.

// The frame count of the timeline as the runtime builds it, and the pieces.
export async function piecePlan(project, { pieceSeconds = 300, fps = project.video.fps } = {}) {
  const stage = await openStage(project, { scale: 1, fps });
  let duration;
  try { duration = await stage.page.evaluate(() => window.__duration()); } finally { await stage.close(); }
  const count = Math.max(1, Math.round((duration / 1000) * fps));
  const size = Math.max(fps * 30, Math.round(pieceSeconds * fps));
  const pieces = [];
  for (let s = 0, i = 0; s < count; s += size, i++) pieces.push({ idx: i, from: s, to: Math.min(count, s + size) });
  return { count, fps, duration, pieces };
}

// Frames [from, to) of the project -> `out` (h264, no audio). `jobs` pages
// share the piece (each its own sub-range, encoded separately, then joined),
// all in ONE browser: the first page also gives the motion plan, and the next
// page opens only once it has loaded, so their start-up memory never peaks
// together. onFrame(done, total) for progress.
export async function renderPiece(project, { from, to, out, jobs = 1, capture = 'jpeg', crf = 20, preset = 'medium', tune = null, threads = null, lookahead = null, onFrame } = {}) {
  const fps = Number(project.video.fps);
  const scale = Number(project.video.scale ?? 1);
  const shot = capture === 'jpeg' ? { type: 'jpeg', quality: 100 } : { type: 'png' };
  const encOpts = { crf, preset, tune, inputCodec: capture === 'jpeg' ? 'mjpeg' : 'png', threads, lookahead };
  const total = to - from;
  const n = Math.max(1, Math.min(jobs, Math.ceil(total / (fps * 20))));
  const step = Math.ceil(total / n);
  const subs = Array.from({ length: n }, (_, i) => [from + i * step, Math.min(to, from + (i + 1) * step)]).filter(([a, b]) => b > a);
  const subFile = (i) => `${out}.part${i}.mp4`;
  const browser = await launchBrowser();
  let done = 0, captured = 0;
  const t0 = Date.now();
  try {
    // Each page builds only the slides of its own span (+2 s either side); the
    // first covers the whole piece, as it also gives the motion plan for it.
    const span = (a, b) => [a * (1000 / fps) - 2000, b * (1000 / fps) + 2000];
    const first = await openStage(project, { scale, fps, browser, window: span(from, to) });
    const intervals = await first.page.evaluate(() => window.__motionIntervals(0));
    const duration = await first.page.evaluate(() => window.__duration());
    const { plan, frameMs } = planFrames({ duration, fps, intervals });
    const renderSub = async (stage, [a, b], i) => {
      const encoder = startEncoder({ out: subFile(i), fps, ...encOpts, audio: null });
      try {
        const r = await renderChunk({ page: stage.page, encoder, plan, from: a, to: b, frameMs, shot, onFrame: () => { done++; onFrame?.(done, total); } });
        captured += r.captured;
        await encoder.finish();
      } catch (e) {
        await encoder.abort();
        throw e;
      } finally {
        await stage.close();
      }
    };
    const runs = [renderSub(first, subs[0], 0)];
    for (let i = 1; i < subs.length; i++) runs.push(openStage(project, { scale, fps, browser, window: span(...subs[i]) }).then((st) => renderSub(st, subs[i], i)));
    await Promise.all(runs);
  } finally {
    await browser.close();
  }
  if (subs.length === 1) fs.renameSync(subFile(0), out);
  else {
    await concatChunks({ files: subs.map((_, i) => subFile(i)), out });
    for (let i = 0; i < subs.length; i++) fs.rmSync(subFile(i), { force: true });
  }
  const probeOut = await ffprobe(out);
  const frames = Number(probeOut.streams?.[0]?.nb_frames || 0);
  if (frames && Math.abs(frames - total) > 1) throw new Error(`piece ${from}–${to}: ${frames} frames written, expected ${total}`);
  return { frames: total, captured, pages: subs.length, seconds: (Date.now() - t0) / 1000 };
}

// The pieces, in order -> `out` with the voice track.
export async function joinPieces({ files, out, audio }) {
  await concatChunks({ files, out, audio });
  return ffprobe(out);
}
