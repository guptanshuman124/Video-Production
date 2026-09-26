import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const STAGE_DIR = fileURLToPath(new URL('../stage/', import.meta.url));
export const ASSET_PREFIX = '__assets/';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
               '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

// ES modules can't be imported over file://, so the stage is served over loopback.
export function serveStage(assetDir = null) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    // Project figures live next to the project JSON, not in stage/.
    let root = STAGE_DIR;
    if (rel.startsWith(ASSET_PREFIX) && assetDir) {
      root = assetDir;
      rel = rel.slice(ASSET_PREFIX.length);
    }
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream',
                           'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/index.html`, close: () => server.close() });
    });
  });
}

// The bundled Chromium matching playwright-core isn't downloadable here, so
// resolve whatever real browser this machine already has, newest-first.
export function resolveBrowser({ headed = false } = {}) {
  const home = process.env.HOME;
  const candidates = [
    process.env.HVR_CHROME,
    !headed && `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${home}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium`,
  ].filter(Boolean);
  for (const exe of candidates) if (fs.existsSync(exe)) return exe;
  throw new Error('No Chrome/Chromium found. Set HVR_CHROME to a browser executable.');
}

export async function openStage(project, { headed = false, scale, fps } = {}) {
  const { width, height } = project.video;
  const deviceScaleFactor = scale ?? project.video.scale;
  const server = await serveStage(project.dir);
  const browser = await chromium.launch({
    executablePath: resolveBrowser({ headed }),
    headless: !headed,
    args: ['--force-color-profile=srgb', '--disable-lcd-text',
           '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.warn('  [page]', m.text()); });
  page.on('pageerror', (e) => console.error('  [page error]', e.message));

  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true);
  const info = await page.evaluate(
    ([p, o]) => window.__prepare(p, o),
    [project, { fps: fps ?? project.video.fps }],
  );

  return {
    page, info,
    async close() { await browser.close(); server.close(); },
  };
}
