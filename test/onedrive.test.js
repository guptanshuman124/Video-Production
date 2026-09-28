import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, {
  MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's',
  SHAREPOINT_SITE_URL: 'https://example.sharepoint.com/sites/VideoArchive', SHAREPOINT_ROOT: 'CBSE Lectures',
});
const onedrive = await import('../src/factory/onedrive.js');

test('onedrive: upload session into Class/Subject/Chapter folders, chunked with exact ranges', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-')), 'v.mp4');
  const size = 10 * 1024 * 1024 + 1234;            // one full chunk + a tail
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  const calls = [];
  let got = 0;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, headers: opts.headers || {}, body: opts.body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('login.microsoftonline.com')) return json({ access_token: 'tok', expires_in: 3600 });
    if (String(url).endsWith('/sites/example.sharepoint.com:/sites/VideoArchive')) return json({ id: 'site1', displayName: 'VideoArchive' });
    if (String(url).endsWith('/sites/site1/drive')) return json({ id: 'drive1', name: 'Documents', webUrl: 'https://x/Shared%20Documents' });
    if (String(url).includes(':/createUploadSession')) return json({ uploadUrl: 'https://upload.example/session' });
    if (String(url) === 'https://upload.example/session') {
      got += opts.body.length;
      return got < size ? new Response('{}', { status: 202 }) : json({ id: 'item1', webUrl: 'https://x/v.mp4', size }, 201);
    }
    throw new Error(`unexpected ${url}`);
  };
  const item = await onedrive.upload(file, 'Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Lecture 3 - Types of Chemical Reactions.mp4');
  assert.deepEqual(item, { id: 'item1', webUrl: 'https://x/v.mp4', size });
  const session = calls.find((c) => c.url.includes('createUploadSession'));
  assert.ok(session.url.includes('/drives/drive1/root:/CBSE%20Lectures/Class%2010/Science/Chapter%201%20-%20Chemical%20Reactions%20and%20Equations/Lecture%203%20-%20Types%20of%20Chemical%20Reactions.mp4:/createUploadSession'));
  assert.match(session.body, /"replace"/);
  const chunks = calls.filter((c) => c.url === 'https://upload.example/session');
  assert.deepEqual(chunks.map((c) => c.headers['content-range']), [`bytes 0-${10485759}/${size}`, `bytes 10485760-${size - 1}/${size}`]);
  assert.ok(chunks.every((c) => !c.headers.authorization), 'the pre-authorised upload URL gets no bearer token');
});

test('onedrive: a short upload is an error, not a stored video', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-')), 'v.mp4');
  fs.writeFileSync(file, Buffer.alloc(1000, 1));
  global.fetch = async (url) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (String(url).includes('createUploadSession')) return json({ uploadUrl: 'https://upload.example/s2' });
    if (String(url) === 'https://upload.example/s2') return json({ id: 'i', webUrl: 'w', size: 10 }, 201);
    return json({ access_token: 'tok', expires_in: 3600 });
  };
  await assert.rejects(onedrive.upload(file, 'Class 6/Science/Chapter 1 - X/Lecture 1 - Y.mp4'), /stored 10 of 1000 bytes/);
});
