// Renaming stored / published videos to the current catalog (src/factory/rename.js):
// the plan, the OneDrive move and the YouTube update — against fake APIs.
import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's',
  SHAREPOINT_SITE_URL: 'https://example.sharepoint.com/sites/VideoArchive', SHAREPOINT_ROOT: 'CBSE Lectures',
  YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret',
});
const { planRename } = await import('../src/factory/rename.js');
const onedrive = await import('../src/factory/onedrive.js');
const yt = await import('../src/factory/youtube.js');

const OLD = 'Class 12/Chemistry/Chemistry Part II/Chapter 3 - Aldehydes, Ketones and Carboxylic Acids';
const NEW = 'Class 12/Chemistry/Chemistry Part II/Chapter 8 - Aldehydes, Ketones and Carboxylic Acids';
const lecture = (id, no, extra = {}) => ({ lecture_id: id, course_id: 65, module_id: 386, class_no: 12, subject: 'Chemistry', book: 'Chemistry Part II',
  chapter_no: 8, chapter_title: 'Aldehydes, Ketones and Carboxylic Acids', lecture_no: no, lecture_count: 9, lecture_title: `Lecture ${no}`,
  library_path: `${NEW}/Lecture ${no} - Lecture ${no}.mp4`, ...extra });
const catalog = {
  lectures: new Map([[1, lecture(1, 1)], [2, lecture(2, 2)], [3, lecture(3, 3)], [4, { ...lecture(4, 1), course_id: 59, chapter_no: 1, library_path: 'Class 12/Chemistry/Chemistry Part I/Chapter 1 - Solutions/Lecture 1 - Lecture 1.mp4' }]]),
  chapters: new Map(),
};

test('rename plan: moved files, the chapter playlist follows its folder, uploads in flight are left alone', () => {
  const videos = [
    { lecture_id: 1, path: `${OLD}/Lecture 1 - Lecture 1.mp4`, storage: 'onedrive', remote_id: 'item1', yt_status: 'done', yt_video_id: 'v1', yt_playlist_id: 'p1' },
    { lecture_id: 2, path: `${OLD}/Lecture 2 - Lecture 2.mp4`, storage: 'uploading', remote_id: null },
    { lecture_id: 3, path: `${NEW}/Lecture 3 - Lecture 3.mp4`, storage: 'onedrive', remote_id: 'item3' },         // already right, not on YouTube
    { lecture_id: 4, path: 'Class 12/Chemistry/Chemistry Part I/Chapter 1 - Solutions/Lecture 1 - Lecture 1.mp4', storage: 'onedrive', yt_status: 'done', yt_video_id: 'v4' },
    { lecture_id: 99, path: 'gone.mp4' },                                                                          // not in the catalog
  ];
  const plan = planRename({ catalog, videos, playlists: [{ folder: OLD, playlist_id: 'p1' }] });
  assert.deepEqual(plan.lectures.map((e) => [e.id, e.move]), [[1, true], [4, false]], 'moves, plus uploaded videos whose YouTube text is checked');
  assert.equal(plan.lectures[0].to, `${NEW}/Lecture 1 - Lecture 1.mp4`);
  assert.deepEqual(plan.playlistKeys, [{ from: OLD, to: NEW }]);
  assert.deepEqual(plan.skipped.map((s) => s.id), [2]);
  assert.deepEqual(plan.intro, [{ kind: 'lecture', id: 1, was: 3, now: 8 }], 'the burned-in chapter number needs a regenerate');
  // A scope limits the plan; an existing playlist for the new folder is not overwritten.
  assert.equal(planRename({ catalog, videos, scope: { course_id: 59 } }).lectures.length, 1);
  const clash = planRename({ catalog, videos, playlists: [{ folder: OLD }, { folder: NEW }] });
  assert.deepEqual(clash.playlistKeys, []);
  assert.ok(clash.skipped.some((s) => s.kind === 'playlist'));
});

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

test('onedrive move: folders made, the item moved and renamed, the emptied old folder removed', async () => {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method, body: opts.body });
    if (u.includes('login.microsoftonline.com')) return json({ access_token: 'tok', expires_in: 3600 });
    if (u.endsWith('/sites/example.sharepoint.com:/sites/VideoArchive')) return json({ id: 'site1' });
    if (u.endsWith('/sites/site1/drive')) return json({ id: 'drive1' });
    if (opts.method === 'GET' && u.includes('/items/item1')) return json({ id: 'item1', parentReference: { id: 'oldch' } });
    if (opts.method === 'POST' && u.endsWith('/children')) return json({ error: { message: 'exists' } }, 409);
    if (opts.method === 'PATCH') return json({ id: 'item1', webUrl: 'https://x/new.mp4', parentReference: { id: 'newch' } });
    if (opts.method === 'GET' && u.includes('/items/oldch')) return json({ id: 'oldch', name: 'Chapter 3 - x', folder: { childCount: 0 }, parentReference: { id: 'book', path: '/drive/root:/CBSE Lectures/Class 12' } });
    if (opts.method === 'GET' && u.includes('/items/book')) return json({ id: 'book', name: 'Chemistry Part II', folder: { childCount: 1 }, parentReference: { id: 'subj', path: '/x' } });
    if (opts.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${opts.method} ${u}`);
  };
  const r = await onedrive.move('item1', `${NEW}/Lecture 1 - Lecture 1.mp4`);
  assert.deepEqual(r, { id: 'item1', webUrl: 'https://x/new.mp4' });
  const patch = JSON.parse(calls.find((c) => c.method === 'PATCH').body);
  assert.equal(patch.name, 'Lecture 1 - Lecture 1.mp4');
  assert.equal(patch.parentReference.path, `/drive/root:/CBSE Lectures/${NEW}`);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 6, 'one create per folder level, existing ones are fine');
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').at(-1)), ['oldch'], 'only the emptied chapter folder goes');
});

test('youtube rename: snippets read in batches; update keeps category and languages', async () => {
  yt.use('refresh');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method, body: opts.body });
    if (u.includes('oauth2.googleapis.com')) return json({ access_token: 'a', expires_in: 3600 });
    if (u.includes('/videos?part=snippet&maxResults=50')) return json({ items: [{ id: 'v1', snippet: { title: 'old', categoryId: '27', defaultAudioLanguage: 'hi' } }] });
    if (opts.method === 'PUT') return json({});
    throw new Error(`unexpected ${u}`);
  };
  const got = await yt.getVideos(['v1']);
  assert.equal(got.get('v1').title, 'old');
  const meta = yt.videoMeta(lecture(1, 1), null, 'p1');
  await yt.updateVideo('v1', meta, got.get('v1'));
  const body = JSON.parse(calls.find((c) => c.method === 'PUT').body);
  assert.equal(body.id, 'v1');
  assert.match(body.snippet.title, /Ch 8 L1/);
  assert.equal(body.snippet.categoryId, '27');
  assert.equal(body.snippet.defaultAudioLanguage, 'hi');
  assert.ok(yt.quotaExceeded(new Error('YouTube PUT /videos: the YouTube API daily quota is used up (10,000 units…')));
});
