// Publishing to YouTube (YouTube Data API v3) — one channel, on request.
//
// A person connects the channel once from the dashboard (Settings → YouTube):
// Google's consent page returns to YOUTUBE_REDIRECT_URI with a code, which is
// swapped for a refresh token; the central keeps it in the factory DB
// (settings.youtube). "Upload to YouTube" on a finished video then
//
//   1. uploads the file (resumable upload, 8 MiB chunks, resumed after errors)
//      with title, description, tags, category Education and the languages,
//   2. sets the title slide as the thumbnail (needs a verified channel; a
//      refusal is a warning, the video stays),
//   3. adds it to its chapter's playlist — one playlist per OneDrive chapter
//      folder, created on first use — at its lecture position.
//
// Quota: videos.insert costs 1,600 units of the project's daily 10,000 (≈ 6
// uploads a day until Google raises it); playlist and thumbnail calls 50 each.
//
// env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET (OAuth client of type "Web application"),
//      YOUTUBE_REDIRECT_URI (default http://localhost:8080/oauth2callback — must be listed on the client),
//      YOUTUBE_PRIVACY (private | unlisted | public, default private),
//      YOUTUBE_KIDS_CLASSES ("all" (default), a list like "6,7,8", or "none") — "made for kids",
//      which also switches comments off: the API has no comments switch of its own

import fs from 'node:fs';

const env = process.env;
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CHUNK = 8 * 1024 * 1024;             // a multiple of 256 KiB, as resumable uploads require
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'];
export const REDIRECT = env.YOUTUBE_REDIRECT_URI || 'http://localhost:8080/oauth2callback';
export const PRIVACY = ['private', 'unlisted', 'public'].includes(env.YOUTUBE_PRIVACY) ? env.YOUTUBE_PRIVACY : 'private';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const configured = () => !!(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET);

// ---- sign-in ----------------------------------------------------------------------------------

export function authUrl(state) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })}`;
}

async function tokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const e = new Error(j.error === 'invalid_grant'
      ? 'YouTube access was revoked or has expired — connect the channel again (Settings → YouTube)'
      : `Google sign-in failed: ${j.error_description || j.error || r.status}`);
    e.reconnect = j.error === 'invalid_grant';
    throw e;
  }
  return j;
}

// The code from the consent page → { refresh_token, channel: { id, title, url } }.
export async function connect(code) {
  const t = await tokenCall({ code, redirect_uri: REDIRECT, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('Google returned no refresh token — remove the app from the account\'s third-party access and connect again');
  token = { value: t.access_token, expires: Date.now() + (t.expires_in || 3600) * 1000 };
  refreshToken = t.refresh_token;
  const ch = await call('GET', '/channels?part=snippet&mine=true');
  const c = ch.items?.[0];
  if (!c) throw new Error('this Google account has no YouTube channel — pick the Prepzy channel on the consent page');
  return { refresh_token: t.refresh_token, channel: { id: c.id, title: c.snippet?.title, url: `https://www.youtube.com/channel/${c.id}` } };
}

let refreshToken = null;      // set by the central from the factory DB (use())
let token = null;             // { value, expires }
export function use(refresh) { if (refresh !== refreshToken) { refreshToken = refresh || null; token = null; } }

async function accessToken() {
  if (!refreshToken) throw new Error('YouTube is not connected (Settings → YouTube)');
  if (token && Date.now() < token.expires - 5 * 60e3) return token.value;
  const t = await tokenCall({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  token = { value: t.access_token, expires: Date.now() + (t.expires_in || 3600) * 1000 };
  return token.value;
}

// ---- API calls --------------------------------------------------------------------------------

// Google's reason for a refusal, in words a person can act on.
function explain(status, body) {
  let j = null;
  try { j = JSON.parse(body); } catch { /* not json */ }
  const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
  const msg = j?.error?.message || body;
  if (/quotaExceeded|dailyLimitExceeded/i.test(reason)) return 'the YouTube API daily quota is used up (10,000 units ≈ 6 uploads a day until Google raises it) — retry after midnight Pacific time';
  if (/uploadLimitExceeded/i.test(reason)) return 'the channel reached YouTube\'s daily upload limit — retry tomorrow';
  if (/youtubeSignupRequired/i.test(reason)) return 'the connected Google account has no YouTube channel';
  return `${status} ${reason ? `${reason}: ` : ''}${String(msg).replace(/<[^>]+>/g, '').slice(0, 300)}`;
}

async function call(method, path, body, { ok = [] } = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    });
    const text = await r.text();
    if (r.ok || ok.includes(r.status)) return text ? JSON.parse(text) : null;
    if (r.status === 401 && attempt === 1) { token = null; continue; }
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { await sleep(2000 * 2 ** attempt); continue; }
    const e = new Error(`YouTube ${method} ${path.split('?')[0]}: ${explain(r.status, text)}`);
    e.status = r.status;
    throw e;
  }
}

// ---- upload -----------------------------------------------------------------------------------

// Resumable upload of a local MP4. meta: { title, description, tags, language, audioLanguage, kids }.
// Returns the video id.
export async function uploadVideo(file, meta, { onProgress = () => {} } = {}) {
  const size = fs.statSync(file).size;
  const init = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: {
        title: meta.title, description: meta.description, tags: meta.tags, categoryId: '27',   // Education
        defaultLanguage: meta.language, defaultAudioLanguage: meta.audioLanguage,
      },
      status: { privacyStatus: PRIVACY, selfDeclaredMadeForKids: !!meta.kids, embeddable: true },
    }),
  });
  if (!init.ok) throw new Error(`YouTube upload refused: ${explain(init.status, await init.text())}`);
  const session = init.headers.get('location');
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    let failures = 0;
    for (;;) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let r;
      try {
        r = await fetch(session, { method: 'PUT', body: buf, headers: { 'content-length': String(len), 'content-range': `bytes ${offset}-${offset + len - 1}/${size}` } });
      } catch (e) { r = { status: 0, error: e }; }
      if (r.status === 200 || r.status === 201) { onProgress(size, size); return (await r.json()).id; }
      if (r.status === 308) {             // chunk stored; Range says how much YouTube has
        offset = rangeEnd(r.headers.get('range'));
        failures = 0;
        onProgress(offset, size);
        continue;
      }
      if (r.status && r.status < 500 && r.status !== 429) throw new Error(`YouTube upload failed at ${offset}/${size} bytes: ${explain(r.status, await r.text())}`);
      // Network error / 5xx: ask how much arrived, then continue from there.
      if (++failures > 6) throw new Error(`YouTube upload failed at ${offset}/${size} bytes: ${r.error?.message || `HTTP ${r.status}`}`);
      await sleep(2000 * 2 ** failures);
      const q = await fetch(session, { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${size}` } }).catch(() => null);
      if (q?.status === 200 || q?.status === 201) { onProgress(size, size); return (await q.json()).id; }
      if (q?.status === 308) offset = rangeEnd(q.headers.get('range'));
    }
  } finally {
    fs.closeSync(fd);
  }
}
const rangeEnd = (range) => { const m = /bytes=0-(\d+)/.exec(range || ''); return m ? Number(m[1]) + 1 : 0; };

// JPEG/PNG up to 2 MB, 1280×720 recommended.
export async function setThumbnail(videoId, file) {
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, {
    method: 'POST', body: fs.readFileSync(file), headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'image/jpeg' },
  });
  if (!r.ok) throw new Error(explain(r.status, await r.text()));
}

// ---- playlists --------------------------------------------------------------------------------

export async function createPlaylist(title, description) {
  const p = await call('POST', '/playlists?part=snippet,status', {
    snippet: { title, description, defaultLanguage: 'en' },
    status: { privacyStatus: PRIVACY },
  });
  return p.id;
}

// True when the playlist still exists on the channel (someone may delete it in YouTube Studio).
export async function playlistExists(id) {
  const r = await call('GET', `/playlists?part=id&id=${encodeURIComponent(id)}`);
  return !!r.items?.length;
}

// Adds the video at `position` (0-based; the playlist's manual order). An item already
// in the playlist is not added twice.
export async function addToPlaylist(playlistId, videoId, position) {
  const have = await call('GET', `/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(videoId)}`, null, { ok: [404] });
  if (have?.items?.length) return have.items[0].id;
  const body = (pos) => ({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId }, ...(pos != null ? { position: pos } : {}) } });
  try {
    return (await call('POST', '/playlistItems?part=snippet', body(position))).id;
  } catch (e) {
    if (position == null || e.status !== 400) throw e;
    return (await call('POST', '/playlistItems?part=snippet', body(null))).id;     // position out of range: append
  }
}

// ---- titles, descriptions, tags -------------------------------------------------------------

const clean = (s) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const LANG = { hinglish: { audio: 'hi', name: 'Hinglish' }, hindi: { audio: 'hi', name: 'Hindi' }, english: { audio: 'en', name: 'English' } };

// One playlist per chapter, named like its OneDrive folder.
export function playlistFor(l) {
  const book = l.book && l.book !== l.subject ? ` (${clean(l.book)})` : '';
  return {
    title: cut(clean(`Class ${l.class_no} ${l.subject}${book} – Chapter ${l.chapter_no}: ${l.chapter_title} | CBSE`), 150),
    description: cut(clean(`All ${l.lecture_count} lectures of NCERT Class ${l.class_no} ${l.subject}${book}, Chapter ${l.chapter_no}: ${l.chapter_title}, in order. CBSE lectures by Prepzy.`), 5000),
  };
}

// l: catalog lecture; input: the lecture's source input (summary, keywords, narration language) or null.
export function videoMeta(l, input, playlistId) {
  const lang = LANG[input?.narration_language] || LANG.hinglish;
  const keywords = (input?.keywords || []).map(clean).filter(Boolean);
  const title = cut(clean(`${l.lecture_title} | Class ${l.class_no} ${l.subject} Ch ${l.chapter_no} L${l.lecture_no} | CBSE`), 100);
  const description = cut([
    `Class ${l.class_no} ${l.subject} · Chapter ${l.chapter_no}: ${l.chapter_title} · Lecture ${l.lecture_no} of ${l.lecture_count}`,
    '',
    input?.summary && !input.summary_placeholder ? clean(input.summary) : `${clean(l.lecture_title)}, explained step by step from the NCERT textbook.`,
    '',
    keywords.length ? `Topics: ${keywords.slice(0, 15).join(', ')}` : '',
    `Taught in ${lang.name}, following the NCERT textbook for CBSE Class ${l.class_no}.`,
    playlistId ? `\nFull chapter playlist: https://www.youtube.com/playlist?list=${playlistId}` : '',
    '',
    `#CBSE #Class${l.class_no} #${String(l.subject).replace(/\s+/g, '')} #NCERT`,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'), 5000).replace(/[<>]/g, '');
  const tags = tagList(['CBSE', 'NCERT', `Class ${l.class_no}`, l.subject, `Class ${l.class_no} ${l.subject}`, l.chapter_title, l.lecture_title, ...keywords, 'Prepzy', `${lang.name} lecture`]);
  return { title, description, tags, language: 'en', audioLanguage: lang.audio, kids: madeForKids(l.class_no) };
}

// "Made for kids" (COPPA) for every class unless YOUTUBE_KIDS_CLASSES narrows it. It also turns
// comments off on the video — the Data API has no other way to do that.
export function madeForKids(classNo) {
  const v = String(env.YOUTUBE_KIDS_CLASSES ?? 'all').trim().toLowerCase();
  if (v === 'all' || v === '') return true;
  if (v === 'none') return false;
  return v.split(',').map(Number).includes(Number(classNo));
}

// Tags within 480 characters (YouTube's cap is 500; a tag with spaces counts as if quoted).
function tagList(list) {
  const tags = [];
  let used = 0;
  for (const t of list) {
    const tag = cut(clean(t), 100);
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + 1;
    if (!tag || tags.some((x) => x.toLowerCase() === tag.toLowerCase()) || used + cost > 480) continue;
    tags.push(tag); used += cost;
  }
  return tags;
}

// ---- summary videos: one playlist per class + subject (+ book), chapters in order ----------------

export function summaryPlaylistFor(ch) {
  const book = ch.book && ch.book !== ch.subject ? ` (${clean(ch.book)})` : '';
  return {
    title: cut(clean(`Class ${ch.class_no} ${ch.subject}${book} – Chapter Summaries | CBSE`), 150),
    description: cut(clean(`One-video summaries of every chapter of NCERT Class ${ch.class_no} ${ch.subject}${book}, in chapter order: the whole chapter revised in one go. CBSE by Prepzy.`), 5000),
  };
}

// ch: catalog chapter; language: the course's narration language; lecturesPlaylistId: the chapter's lecture playlist, if made.
export function summaryMeta(ch, language, playlistId, lecturesPlaylistId) {
  const lang = LANG[language] || LANG.hinglish;
  const title = cut(clean(`Chapter ${ch.chapter_no}: ${ch.chapter_title} – Summary | Class ${ch.class_no} ${ch.subject} | CBSE`), 100);
  const description = cut([
    `Class ${ch.class_no} ${ch.subject} · Chapter ${ch.chapter_no}: ${ch.chapter_title} · Chapter summary`,
    '',
    `The whole chapter "${clean(ch.chapter_title)}" in one video: every key idea of its ${ch.lecture_count} lectures, for quick revision before tests and the CBSE board exam.`,
    `Taught in ${lang.name}, following the NCERT textbook for CBSE Class ${ch.class_no}.`,
    lecturesPlaylistId ? `\nFull lectures of this chapter: https://www.youtube.com/playlist?list=${lecturesPlaylistId}` : '',
    playlistId ? `All chapter summaries: https://www.youtube.com/playlist?list=${playlistId}` : '',
    '',
    `#CBSE #Class${ch.class_no} #${String(ch.subject).replace(/\s+/g, '')} #NCERT #Revision`,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'), 5000).replace(/[<>]/g, '');
  const tags = tagList(['CBSE', 'NCERT', `Class ${ch.class_no}`, ch.subject, `Class ${ch.class_no} ${ch.subject}`, ch.chapter_title,
    `${ch.chapter_title} summary`, 'chapter summary', 'revision', 'Prepzy', `${lang.name} lecture`]);
  return { title, description, tags, language: 'en', audioLanguage: lang.audio, kids: madeForKids(ch.class_no) };
}
