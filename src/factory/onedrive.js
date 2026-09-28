// Video storage on OneDrive / SharePoint (Microsoft Graph, app-only).
//
// The app registration ("Video Pipeline Storage") signs in with client
// credentials and writes into the document library of the SharePoint site
// SHAREPOINT_SITE_URL, under SHAREPOINT_ROOT (default "CBSE Lectures"):
//
//   CBSE Lectures/Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Lecture 3 - Types of Chemical Reactions.mp4
//
// Missing folders are created by Graph from the path. Videos go up in 10 MiB
// chunks through an upload session (any size, resumable per chunk). Playback
// uses the item's short-lived pre-authenticated download URL.
//
// env: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SHAREPOINT_SITE_URL, SHAREPOINT_ROOT

import fs from 'node:fs';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const CHUNK = 10 * 1024 * 1024;          // a multiple of 320 KiB, as Graph requires
const env = process.env;
const ROOT = (env.SHAREPOINT_ROOT || 'CBSE Lectures').replace(/^\/+|\/+$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const configured = () => !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.SHAREPOINT_SITE_URL);

let token = null;          // { value, expires }
async function accessToken() {
  if (token && Date.now() < token.expires - 5 * 60e3) return token.value;
  const r = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Microsoft sign-in failed: ${j.error_description?.split('\n')[0] || j.error || r.status}`);
  token = { value: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

// Graph call with retries on throttling / transient errors.
async function graph(method, path, { body, headers = {}, ok = [] } = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
      method, body, headers: { authorization: `Bearer ${await accessToken()}`, ...(body && typeof body === 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
    });
    if (r.ok || ok.includes(r.status)) { const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; }
    const text = await r.text();
    if (r.status === 401 && attempt === 1) { token = null; continue; }
    if ((r.status === 429 || r.status >= 500) && attempt < 6) { await sleep(retryAfter(r, attempt)); continue; }
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch { /* not json */ }
    const e = new Error(`Graph ${method} ${path.replace(GRAPH, '').split('?')[0].slice(0, 120)}: ${r.status} ${String(msg).slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
}
const retryAfter = (r, attempt) => Math.min(60000, (Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000);

let driveCache = null;     // { siteId, driveId, webUrl }
export async function drive() {
  if (driveCache) return driveCache;
  const u = new URL(env.SHAREPOINT_SITE_URL);
  const site = await graph('GET', `/sites/${u.hostname}:${u.pathname.replace(/\/+$/, '')}`);
  const d = await graph('GET', `/sites/${site.json.id}/drive`);
  driveCache = { siteId: site.json.id, driveId: d.json.id, webUrl: d.json.webUrl, siteName: site.json.displayName, driveName: d.json.name };
  return driveCache;
}

const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');
export const remotePath = (rel) => `${ROOT}/${rel}`;

// Uploads a local file to ROOT/<rel>, replacing what is there. Returns { id, webUrl, size }.
export async function upload(file, rel, { onProgress = () => {} } = {}) {
  const { driveId } = await drive();
  const size = fs.statSync(file).size;
  const session = await graph('POST', `/drives/${driveId}/root:/${encodePath(remotePath(rel))}:/createUploadSession`, {
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  const url = session.json.uploadUrl;
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    let item = null;
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      // The upload URL is pre-authorised: no Authorization header on chunk PUTs.
      for (let attempt = 1; ; attempt++) {
        const r = await fetch(url, { method: 'PUT', body: buf, headers: { 'content-length': String(len), 'content-range': `bytes ${offset}-${offset + len - 1}/${size}` } });
        if (r.status === 202) { break; }
        if (r.status === 200 || r.status === 201) { item = await r.json(); break; }
        if ((r.status === 429 || r.status >= 500) && attempt < 6) { await sleep(retryAfter(r, attempt)); continue; }
        await fetch(url, { method: 'DELETE' }).catch(() => {});
        throw new Error(`OneDrive upload failed at ${offset}/${size} bytes: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      }
      offset += len;
      onProgress(offset, size);
    }
    if (!item) throw new Error('OneDrive upload finished without returning the file');
    if (item.size !== size) throw new Error(`OneDrive stored ${item.size} of ${size} bytes`);
    return { id: item.id, webUrl: item.webUrl, size: item.size };
  } finally {
    fs.closeSync(fd);
  }
}

// Short-lived (about an hour) pre-authenticated URL for playback / download.
export async function downloadUrl(itemId) {
  const { driveId } = await drive();
  const r = await graph('GET', `/drives/${driveId}/items/${itemId}?select=id,@microsoft.graph.downloadUrl`);
  const u = r.json['@microsoft.graph.downloadUrl'];
  if (!u) throw new Error('OneDrive returned no download URL');
  return u;
}

// Deletes the file, then the chapter / subject / class folders it leaves empty (never ROOT).
export async function remove(itemId) {
  const { driveId } = await drive();
  const meta = await graph('GET', `/drives/${driveId}/items/${itemId}?select=id,parentReference`, { ok: [404] });
  if (meta.status === 404) return;
  await graph('DELETE', `/drives/${driveId}/items/${itemId}`, { ok: [404] });
  let parent = meta.json.parentReference?.id;
  for (let depth = 0; parent && depth < 4; depth++) {
    const p = await graph('GET', `/drives/${driveId}/items/${parent}?select=id,name,folder,parentReference`, { ok: [404] });
    if (p.status === 404 || p.json.name === ROOT || !p.json.folder || p.json.folder.childCount > 0 || !p.json.parentReference?.path) break;
    await graph('DELETE', `/drives/${driveId}/items/${parent}`, { ok: [404] });
    parent = p.json.parentReference.id;
  }
}

// Web link to the library root folder (for the dashboard); created if missing.
export async function rootUrl() {
  const { driveId } = await drive();
  const r = await graph('GET', `/drives/${driveId}/root:/${encodePath(ROOT)}`, { ok: [404] });
  if (r.status !== 404) return r.json.webUrl;
  const c = await graph('POST', `/drives/${driveId}/root/children`, { body: JSON.stringify({ name: ROOT, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }), ok: [409] });
  return c.json?.webUrl || null;
}
