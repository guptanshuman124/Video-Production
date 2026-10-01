// Project -> mp4. Shared by `hvr render` and the pipeline's render stage.

import path from 'node:path';
import fs from 'node:fs';
import { timeline } from './project.js';
import { openStage } from './stage.js';
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
