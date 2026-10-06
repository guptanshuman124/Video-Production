// YouTube publishing (src/factory/youtube.js): metadata within YouTube's limits,
// and the resumable upload carrying on after a dropped chunk — against a fake API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.YOUTUBE_CLIENT_ID = 'id';
process.env.YOUTUBE_CLIENT_SECRET = 'secret';
const yt = await import('../src/factory/youtube.js');

const lecture = {
  lecture_id: 2827, class_no: 11, subject: 'Physics', book: 'Physics Part I', chapter_no: 1, chapter_title: 'Units and Measurement',
  lecture_no: 2, lecture_count: 5, lecture_title: 'Significant Figures',
};

test('youtube: title, description and tags stay inside YouTube limits', () => {
  const long = { ...lecture, lecture_title: 'A very long lecture title <with brackets> '.repeat(6) };
  const m = yt.videoMeta(long, { narration_language: 'hinglish', summary: 'x'.repeat(6000), keywords: Array.from({ length: 80 }, (_, i) => `keyword number ${i}`) }, 'PL123');
  assert.ok(m.title.length <= 100, `title ${m.title.length}`);
  assert.ok(!/[<>]/.test(m.title + m.description), 'no angle brackets');
  assert.ok(m.description.length <= 5000);
  assert.ok(m.tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0) + 1, 0) <= 500);
  assert.equal(m.audioLanguage, 'hi');
  const short = yt.videoMeta(lecture, { narration_language: 'english', summary: 'How many digits of a measurement are meaningful, and the rules for counting them.', keywords: ['significant figures', 'rounding off'] }, 'PL123');
  assert.equal(short.title, 'Significant Figures | Class 11 Physics Ch 1 L2 | CBSE');
  assert.match(short.description, /Lecture 2 of 5/);
  assert.match(short.description, /list=PL123/);
  assert.equal(short.audioLanguage, 'en');
  assert.ok(short.tags.includes('rounding off'));
  assert.equal(short.tags.filter((t) => t.toLowerCase() === 'significant figures').length, 1, 'no duplicate of the title');
});

test('youtube: made for kids (comments off) for every class by default; playlists named after the folder', () => {
  assert.equal(yt.videoMeta(lecture, null, null).kids, true);
  process.env.YOUTUBE_KIDS_CLASSES = '6,7,8';
  assert.equal(yt.videoMeta(lecture, null, null).kids, false);
  assert.equal(yt.videoMeta({ ...lecture, class_no: 7 }, null, null).kids, true);
  process.env.YOUTUBE_KIDS_CLASSES = 'none';
  assert.equal(yt.madeForKids(6), false);
  delete process.env.YOUTUBE_KIDS_CLASSES;
  const p = yt.playlistFor(lecture);
  assert.equal(p.title, 'Class 11 Physics (Physics Part I) – Chapter 1: Units and Measurement | CBSE');
  assert.ok(p.title.length <= 150);
});

test('youtube: summary videos — one playlist per subject, title and links within limits', () => {
  const ch = { module_id: 5, class_no: 10, subject: 'Science', book: 'Science', chapter_no: 1, chapter_title: 'Chemical Reactions and Equations', lecture_count: 5 };
  assert.equal(yt.summaryPlaylistFor(ch).title, 'Class 10 Science – Chapter Summaries | CBSE');
  const m = yt.summaryMeta(ch, 'hinglish', 'PLsum', 'PLlec');
  assert.equal(m.title, 'Chapter 1: Chemical Reactions and Equations – Summary | Class 10 Science | CBSE');
  assert.ok(m.title.length <= 100);
  assert.match(m.description, /list=PLlec/);
  assert.match(m.description, /list=PLsum/);
  assert.equal(m.kids, true);
  assert.equal(m.audioLanguage, 'hi');
  const long = yt.summaryMeta({ ...ch, chapter_title: 'A very long chapter title '.repeat(10) }, 'english', null, null);
  assert.ok(long.title.length <= 100 && !/[<>]/.test(long.description));
});

test('youtube: resumable upload resumes after a failed chunk', async () => {
  const file = path.join(os.tmpdir(), `yt-${process.pid}.mp4`);
  const size = 8 * 1024 * 1024 + 1000;                // two chunks
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  let stored = 0, dropped = false, init = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const h = opts.headers || {};
    if (String(url).includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    if (String(url).includes('uploadType=resumable')) { init = JSON.parse(opts.body); return new Response('', { status: 200, headers: { location: 'https://upload.example/session' } }); }
    if (url === 'https://upload.example/session') {
      if (h['content-range'] === `bytes */${size}`) return new Response('', { status: 308, headers: stored ? { range: `bytes=0-${stored - 1}` } : {} });
      if (stored > 0 && !dropped) { dropped = true; throw new Error('socket hang up'); }   // second chunk lost once
      stored += Number(h['content-length']);
      return stored >= size ? new Response(JSON.stringify({ id: 'VID42' }), { status: 200 }) : new Response('', { status: 308, headers: { range: `bytes=0-${stored - 1}` } });
    }
    throw new Error(`unexpected ${url}`);
  };
  try {
    yt.use('refresh-token');
    const seen = [];
    const id = await yt.uploadVideo(file, yt.videoMeta(lecture, null, null), { onProgress: (d) => seen.push(d) });
    assert.equal(id, 'VID42');
    assert.equal(stored, size);
    assert.ok(dropped, 'a chunk was dropped and resent');
    assert.equal(init.snippet.categoryId, '27');
    assert.equal(init.status.privacyStatus, 'private');
    assert.equal(seen.at(-1), size);
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(file, { force: true });
  }
});
