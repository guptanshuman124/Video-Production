import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { FFMPEG, FFPROBE } from './tools.js';

// A single ffmpeg pass fed raw PNGs on stdin. Duplicate (held) frames are just
// the same buffer written again — x264 encodes those almost for free.
// `tune: 'stillimage'` suits long lectures that are mostly held slides.
// `threads` / `lookahead` bound x264's memory: left on auto it starts ~1.5
// frame threads per visible core, each holding its own 1080p frames (~800 MB
// per encoder on a 12-core host, enough to OOM a worker pod rendering two
// chunks). Capture is the bottleneck, so a few threads encode just as fast.
export function startEncoder({ out, fps, crf = 18, preset = 'slow', tune = null, audio = null, inputCodec = 'png', threads = null, lookahead = null }) {
  const args = ['-y', '-f', 'image2pipe', '-c:v', inputCodec, '-framerate', String(fps), '-i', 'pipe:0'];
  if (audio) args.push('-i', audio);
  args.push('-c:v', 'libx264', '-preset', preset, ...(tune ? ['-tune', tune] : []),
    ...(threads ? ['-threads', String(threads)] : []), ...(lookahead ? ['-rc-lookahead', String(lookahead)] : []));
  args.push(
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(fps),
    '-movflags', '+faststart',
  );
  // apad extends the audio with silence so the video's length always wins:
  // narration shorter than the timeline no longer truncates the last scene.
  if (audio) args.push('-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(out);

  const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; if (log.length > 40000) log = log.slice(-20000); });

  let broken = null;
  proc.stdin.on('error', (e) => { broken = e; });

  return {
    args,
    write(buf) {
      if (broken) throw new Error(`ffmpeg stdin closed early:\n${log.slice(-1500)}`);
      if (proc.stdin.write(buf)) return Promise.resolve();
      // Backpressure: wait for drain. Listeners are removed either way so a
      // long render (tens of thousands of frames) never accumulates them.
      return new Promise((res, rej) => {
        const done = (err) => {
          proc.stdin.off('drain', done);
          proc.stdin.off('error', done);
          err ? rej(err) : res();
        };
        proc.stdin.on('drain', done);
        proc.stdin.on('error', done);
      });
    },
    // Stops the encoder at once (a failed segment): the partial file is discarded.
    abort() {
      if (proc.exitCode != null) return Promise.resolve();
      return new Promise((res) => { proc.once('close', () => res()); try { proc.stdin.destroy(); } catch { /* closed */ } proc.kill('SIGKILL'); });
    },
    finish() {
      return new Promise((res, rej) => {
        proc.on('close', (code) => code === 0
          ? res(log)
          : rej(new Error(`ffmpeg exited ${code}\n${log.slice(-2500)}`)));
        proc.stdin.end();
      });
    },
  };
}

export function ffprobe(file) {
  const r = spawn(FFPROBE, ['-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,codec_name',
    '-show_entries', 'format=duration,size',
    '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res, rej) => {
    let o = '';
    r.stdout.on('data', (d) => { o += d; });
    r.on('close', (c) => c === 0 ? res(JSON.parse(o)) : rej(new Error('ffprobe failed')));
  });
}

export const hasAudio = (p) => p && fs.existsSync(p) ? p : null;

// Join per-worker chunks without re-encoding. Every chunk is produced with
// identical x264 settings and starts on a keyframe, so a stream copy is exact.
export function concatChunks({ files, out, audio = null }) {
  const listFile = `${out}.concat.txt`;
  fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (audio) args.push('-i', audio);
  args.push('-c:v', 'copy', '-movflags', '+faststart');
  // apad extends the audio with silence so the video's length always wins:
  // narration shorter than the timeline no longer truncates the last scene.
  if (audio) args.push('-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(out);

  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  return new Promise((res, rej) => {
    proc.on('close', (code) => {
      fs.rmSync(listFile, { force: true });
      code === 0 ? res() : rej(new Error(`concat failed (${code})\n${log.slice(-2000)}`));
    });
  });
}
