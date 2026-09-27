import { spawn } from 'node:child_process';
import fs from 'node:fs';

// A single ffmpeg pass fed raw PNGs on stdin. Duplicate (held) frames are just
// the same buffer written again — x264 encodes those almost for free.
export function startEncoder({ out, fps, crf = 18, preset = 'slow', audio = null, inputCodec = 'png' }) {
  const args = ['-y', '-f', 'image2pipe', '-c:v', inputCodec, '-framerate', String(fps), '-i', 'pipe:0'];
  if (audio) args.push('-i', audio);
  args.push(
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(fps),
    '-movflags', '+faststart',
  );
  // apad extends the audio with silence so the video's length always wins:
  // narration shorter than the timeline no longer truncates the last scene.
  if (audio) args.push('-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(out);

  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; if (log.length > 40000) log = log.slice(-20000); });

  let broken = null;
  proc.stdin.on('error', (e) => { broken = e; });

  return {
    args,
    write(buf) {
      if (broken) throw new Error(`ffmpeg stdin closed early:\n${log.slice(-1500)}`);
      return new Promise((res, rej) => {
        if (proc.stdin.write(buf)) res();
        else proc.stdin.once('drain', res);
        proc.stdin.once('error', rej);
      });
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
  const r = spawn('ffprobe', ['-v', 'error',
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

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  return new Promise((res, rej) => {
    proc.on('close', (code) => {
      fs.rmSync(listFile, { force: true });
      code === 0 ? res() : rej(new Error(`concat failed (${code})\n${log.slice(-2000)}`));
    });
  });
}
