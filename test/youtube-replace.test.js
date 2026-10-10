// A regenerated video that was on YouTube replaces the old upload (central.js markReplaced /
// youtubeOne step 5): which id is replaced, and the delete call — against a fake API.
import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, { YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret' });
const yt = await import('../src/factory/youtube.js');

test('replaced id: the uploaded video, else the one still waiting to be replaced', () => {
  assert.equal(yt.replacedId({ yt_status: 'done', yt_video_id: 'v1' }), 'v1');
  assert.equal(yt.replacedId({ yt_status: 'failed', yt_video_id: 'v1' }), 'v1', 'up, but the playlist step failed');
  assert.equal(yt.replacedId({ yt_status: null, yt_video_id: null, yt_replaces: 'v0' }), 'v0', 'regenerated twice before the replacement went up');
  assert.equal(yt.replacedId({ yt_status: null, yt_video_id: null }), null, 'never on YouTube');
  assert.equal(yt.replacedId(undefined), null, 'first video of the lecture');
});

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

test('deleteVideo: DELETE /videos; an already deleted video is fine, other refusals throw', async () => {
  yt.use('refresh');
  const calls = [];
  let reply = () => new Response(null, { status: 204 });
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return json({ access_token: 'a', expires_in: 3600 });
    calls.push({ url: u, method: opts.method });
    return reply();
  };
  assert.equal(await yt.deleteVideo('v1'), true);
  assert.equal(calls[0].method, 'DELETE');
  assert.match(calls[0].url, /\/videos\?id=v1$/);
  reply = () => json({ error: { code: 404, message: 'Video not found' } }, 404);
  assert.equal(await yt.deleteVideo('v1'), false);
  reply = () => json({ error: { code: 403, errors: [{ reason: 'forbidden' }], message: 'no' } }, 403);
  await assert.rejects(yt.deleteVideo('v1'), /forbidden/);
});
