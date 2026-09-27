import fs from 'node:fs';
import path from 'node:path';

// Resolve ffmpeg/ffprobe: HVR_FFMPEG / HVR_FFPROBE override, then winget's
// install dir on Windows (a terminal opened before install won't have it on
// PATH), then whatever is on PATH.
function resolveTool(name) {
  const env = process.env[`HVR_${name.toUpperCase()}`];
  if (env) return env;
  const pkgs = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/WinGet/Packages');
  if (process.platform === 'win32' && pkgs && fs.existsSync(pkgs)) {
    for (const pkg of fs.readdirSync(pkgs).filter((d) => /ffmpeg/i.test(d))) {
      for (const build of fs.readdirSync(path.join(pkgs, pkg))) {
        const exe = path.join(pkgs, pkg, build, 'bin', `${name}.exe`);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return name;
}

export const FFMPEG = resolveTool('ffmpeg');
export const FFPROBE = resolveTool('ffprobe');
