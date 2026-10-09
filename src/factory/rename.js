// Brings videos that are already stored and published in line with the current
// catalog: chapter numbers (config/courses.yaml chapter_start), chapter and
// lecture titles. Nothing is re-uploaded or re-rendered.
//
//   library + OneDrive   the file moves to its catalog path (Class/Subject/[Book/]Chapter K - …)
//   factory DB           videos.path / remote_url, jobs and summaries chapter numbers,
//                        youtube_playlists keyed by the new chapter folder
//   YouTube              video titles, descriptions and tags; playlist titles
//
// Run inside the central pod (it has the DB, the library volume and the secrets):
//   npm run factory -- rename                 dry run: prints what would change
//   npm run factory -- rename --apply         makes the changes
//   options: --only onedrive|youtube  --class N  --course ID  --limit N (YouTube updates this run)
// Only what still differs is touched, so a run stopped by the YouTube quota
// (about 190 updates a day) carries on where it left off when run again.
//
// The intro slide and the YouTube thumbnail are part of the video: a video whose
// chapter number changed still shows the old one until it is regenerated. Those are listed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting } from './db.js';
import { loadCatalog } from './catalog.js';
import { loadRows, lectureInputs } from '../sources/textbook.js';
import { courseLookup } from '../curriculum/courses.js';
import * as onedrive from './onedrive.js';
import * as youtube from './youtube.js';

const IN_FLIGHT_YT = new Set(['queued', 'uploading']);
const chapterOf = (rel) => Number(/(?:^|\/)Chapter (\d+) - /.exec(rel || '')?.[1]) || null;

// ---- planning (no side effects) ---------------------------------------------------------------

// catalog: loadCatalog(); videos / summaryVideos: DB rows; playlists: youtube_playlists rows.
// scope: { class_no, course_id }. Returns what has to change.
export function planRename({ catalog, videos = [], summaryVideos = [], playlists = [], scope = {} }) {
  const inScope = (x) => x && (scope.class_no == null || x.class_no === Number(scope.class_no)) && (scope.course_id == null || x.course_id === Number(scope.course_id));
  const plan = { lectures: [], summaries: [], playlistKeys: [], skipped: [], intro: [] };
  const busy = (v) => v.storage === 'uploading' || IN_FLIGHT_YT.has(v.yt_status);
  const take = (kind, list, item, to, row) => {
    if (!inScope(item)) return;
    const entry = { kind, id: row.lecture_id ?? row.module_id, item, row, from: row.path, to, move: row.path !== to };
    if (busy(row)) { if (entry.move || row.yt_video_id) plan.skipped.push({ ...entry, why: 'an upload is in progress — run again when it is done' }); return; }
    const was = chapterOf(row.path);
    if (was && was !== item.chapter_no) plan.intro.push({ kind, id: entry.id, was, now: item.chapter_no });
    if (entry.move || row.yt_video_id) list.push(entry);
  };
  for (const v of videos) {
    const l = catalog.lectures.get(v.lecture_id);
    if (l) take('lecture', plan.lectures, l, l.library_path, v);
  }
  for (const v of summaryVideos) {
    const ch = catalog.chapters.get(v.module_id);
    if (ch) take('summary', plan.summaries, ch, ch.summary_path, v);
  }
  // Lecture playlists are keyed by the chapter folder: follow the move.
  const keys = new Set(playlists.map((p) => p.folder));
  const seen = new Set();
  for (const e of plan.lectures.filter((x) => x.move)) {
    const from = path.posix.dirname(e.from);
    const to = path.posix.dirname(e.to);
    if (from === to || seen.has(from) || !keys.has(from)) continue;
    seen.add(from);
    if (keys.has(to)) plan.skipped.push({ kind: 'playlist', id: from, from, to, why: 'a playlist for the new folder already exists (made after a regenerate) — the old one is left as it is' });
    else plan.playlistKeys.push({ from, to });
  }
  return plan;
}

// ---- chapter numbers in the job / summary rows (also run by the central on catalog reload) -----

export async function refreshNumbers(db, catalog, { apply = true } = {}) {
  let jobs = 0;
  let sums = 0;
  const [jrows] = await db.query('SELECT lecture_id, chapter_no, chapter_title, lecture_title FROM jobs');
  for (const j of jrows) {
    const l = catalog.lectures.get(j.lecture_id);
    if (!l || (Number(j.chapter_no) === l.chapter_no && j.chapter_title === l.chapter_title && j.lecture_title === l.lecture_title)) continue;
    jobs++;
    if (apply) await db.query('UPDATE jobs SET chapter_no=?, chapter_title=?, lecture_title=? WHERE lecture_id=?', [l.chapter_no, l.chapter_title, l.lecture_title, j.lecture_id]);
  }
  const [srows] = await db.query('SELECT module_id, chapter_no, chapter_title FROM summaries');
  for (const r of srows) {
    const ch = catalog.chapters.get(r.module_id);
    if (!ch || (Number(r.chapter_no) === ch.chapter_no && r.chapter_title === ch.chapter_title)) continue;
    sums++;
    if (apply) await db.query('UPDATE summaries SET chapter_no=?, chapter_title=? WHERE module_id=?', [ch.chapter_no, ch.chapter_title, r.module_id]);
  }
  return { jobs, summaries: sums };
}

// ---- the command ----------------------------------------------------------------------------------

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const LIBRARY = path.resolve(process.env.LIBRARY_DIR || path.join(REPO, 'library'));

// The local copy, if the library still has one (uploads may remove it). Lecture files
// from before 2026-10-05 sat at the library root.
function localFile(kind, rel) {
  const root = kind === 'summary' ? onedrive.SUMMARY_ROOT : onedrive.ROOT;
  const file = path.join(LIBRARY, root, ...rel.split('/'));
  if (fs.existsSync(file)) return file;
  const legacy = path.join(LIBRARY, ...rel.split('/'));
  return kind === 'lecture' && fs.existsSync(legacy) ? legacy : null;
}

function moveLocal(kind, from, to) {
  const src = localFile(kind, from);
  if (!src) return false;
  const root = kind === 'summary' ? onedrive.SUMMARY_ROOT : onedrive.ROOT;
  const dest = path.join(LIBRARY, root, ...to.split('/'));
  if (fs.existsSync(dest)) throw new Error(`a local file already exists at ${to}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  for (let d = path.dirname(src); d.startsWith(LIBRARY) && d !== LIBRARY; d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }   // not empty
  }
  return true;
}

// Source input per lecture (summary text, keywords, narration language), one course load each.
function inputCache() {
  const byCourse = new Map();
  return async (courseId, lectureId) => {
    if (!byCourse.has(courseId)) {
      byCourse.set(courseId, (async () => {
        const rows = await loadRows('db', { course: [courseId] });
        return new Map(lectureInputs(rows, courseLookup()).map((i) => [i.lecture_id, i]));
      })().catch(() => new Map()));
    }
    return (await byCourse.get(courseId)).get(lectureId) || null;
  };
}

const short = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

export async function runRename(flag, has) {
  const apply = has('apply');
  const only = typeof flag('only', null) === 'string' ? flag('only') : null;
  if (only && !['onedrive', 'youtube'].includes(only)) throw new Error('--only onedrive | youtube');
  const scope = {
    class_no: typeof flag('class', null) === 'string' ? Number(flag('class')) : null,
    course_id: typeof flag('course', null) === 'string' ? Number(flag('course')) : null,
  };
  const limit = typeof flag('limit', null) === 'string' ? Number(flag('limit')) : Infinity;
  const say = (s = '') => console.log(s);

  const db = await openDb(process.env.FACTORY_DB_URL);
  try {
    const catalog = await loadCatalog();
    const [videos] = await db.query('SELECT lecture_id, path, storage, remote_id, remote_url, yt_status, yt_video_id, yt_playlist_id FROM videos');
    const [summaryVideos] = await db.query('SELECT module_id, path, storage, remote_id, remote_url, yt_status, yt_video_id, yt_playlist_id FROM summary_videos');
    const [playlists] = await db.query('SELECT folder, playlist_id, title FROM youtube_playlists');
    const plan = planRename({ catalog, videos, summaryVideos, playlists, scope });
    say(`\n  ${apply ? 'APPLYING' : 'DRY RUN (add --apply to make these changes)'} — ${catalog.lectures.size} lectures in the catalog\n`);

    // 1. Files: OneDrive, local library, DB paths.
    const moved = { onedrive: 0, local: 0, failed: 0 };
    if (only !== 'youtube') {
      const moves = [...plan.lectures, ...plan.summaries].filter((e) => e.move);
      say(`  Files to move: ${moves.length}`);
      for (const e of moves) {
        say(`    ${e.kind} ${e.id}: ${e.from}\n${' '.repeat(e.kind.length + String(e.id).length + 7)}→ ${e.to}`);
        if (!apply) continue;
        const table = e.kind === 'summary' ? 'summary_videos' : 'videos';
        const key = e.kind === 'summary' ? 'module_id' : 'lecture_id';
        try {
          let url = e.row.remote_url;
          if (e.row.remote_id && e.row.storage === 'onedrive') {
            if (!onedrive.configured()) throw new Error('OneDrive is not configured here (MS_* / SHAREPOINT_SITE_URL)');
            url = (await onedrive.move(e.row.remote_id, e.to, { root: e.kind === 'summary' ? onedrive.SUMMARY_ROOT : onedrive.ROOT })).webUrl || url;
            moved.onedrive++;
          }
          if (moveLocal(e.kind, e.from, e.to)) moved.local++;
          await db.query(`UPDATE ${table} SET path=?, remote_url=? WHERE ${key}=?`, [e.to, url, e.id]);
          e.row.path = e.to;
        } catch (err) {
          moved.failed++;
          say(`      ✗ ${err.message}`);
        }
      }
      for (const k of plan.playlistKeys) {
        say(`  Playlist folder: ${k.from} → ${k.to}`);
        if (apply) await db.query('UPDATE youtube_playlists SET folder=? WHERE folder=?', [k.to, k.from]);
      }
      const n = await refreshNumbers(db, catalog, { apply });
      say(`  Job rows with old chapter numbers / titles: ${n.jobs} lecture(s), ${n.summaries} summary row(s)${apply ? ' — updated' : ''}`);
      if (apply) say(`  Moved: ${moved.onedrive} on OneDrive, ${moved.local} local file(s)${moved.failed ? `, ${moved.failed} FAILED (see above)` : ''}`);
      say();
    }

    // 2. YouTube titles and descriptions.
    if (only !== 'onedrive') await renameOnYoutube(db, catalog, plan, { apply, limit, say });

    // 3. What only a regenerate fixes.
    if (plan.intro.length) {
      say(`  ${plan.intro.length} video(s) still show an old chapter number on their intro slide / thumbnail — Regenerate them to fix:`);
      const byKind = (k) => plan.intro.filter((x) => x.kind === k);
      if (byKind('lecture').length) say(`    lectures: ${byKind('lecture').map((x) => `${x.id} (Ch ${x.was}→${x.now})`).join(', ')}`);
      if (byKind('summary').length) say(`    summaries (module id): ${byKind('summary').map((x) => `${x.id} (Ch ${x.was}→${x.now})`).join(', ')}`);
    }
    for (const s of plan.skipped) say(`  · skipped ${s.kind} ${s.id}: ${s.why}`);
    say();
  } finally {
    await db.end();
  }
}

async function renameOnYoutube(db, catalog, plan, { apply, limit, say }) {
  const all = [...plan.lectures, ...plan.summaries].filter((e) => e.row.yt_video_id && e.row.yt_status === 'done');
  if (!all.length) { say('  YouTube: nothing uploaded in this selection\n'); return; }
  if (!youtube.configured()) { say('  YouTube: not set up here (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET) — skipped\n'); return; }
  const auth = await getSetting(db, 'youtube');
  if (!auth?.refresh_token) { say('  YouTube: not connected (Settings → YouTube) — skipped\n'); return; }
  youtube.use(auth.refresh_token);

  const inputOf = inputCache();
  const [pls] = await db.query('SELECT folder, playlist_id FROM youtube_playlists');
  const playlistOf = new Map(pls.map((p) => [p.folder, p.playlist_id]));
  // The new folders, as if the moves above were made (a dry run has not moved them).
  for (const k of plan.playlistKeys) if (!playlistOf.has(k.to)) playlistOf.set(k.to, playlistOf.get(k.from));

  let current;
  try { current = await youtube.getVideos(all.map((e) => e.row.yt_video_id)); } catch (e) { say(`  YouTube: could not read the videos — ${e.message}\n`); return; }
  const updates = [];
  for (const e of all) {
    const now = current.get(e.row.yt_video_id);
    if (!now) { say(`  · ${e.kind} ${e.id}: video ${e.row.yt_video_id} is no longer on the channel — skipped`); continue; }
    let meta;
    if (e.kind === 'lecture') {
      meta = youtube.videoMeta(e.item, await inputOf(e.item.course_id, e.item.lecture_id), e.row.yt_playlist_id);
    } else {
      const first = e.item.lecture_ids[0];
      const language = (await inputOf(e.item.course_id, first))?.narration_language || null;
      meta = youtube.summaryMeta(e.item, language, e.row.yt_playlist_id, playlistOf.get(path.posix.dirname(e.to)));
    }
    if (now.title !== meta.title || (now.description || '') !== meta.description) updates.push({ e, meta, now });
  }

  // Playlists: one per chapter folder (lectures), one per subject/book (summaries).
  const wantPl = new Map();
  for (const e of all) {
    const id = e.row.yt_playlist_id;
    if (!id || wantPl.has(id)) continue;
    wantPl.set(id, e.kind === 'lecture' ? youtube.playlistFor(e.item) : youtube.summaryPlaylistFor(e.item));
  }
  let plNow = new Map();
  try { plNow = await youtube.getPlaylists([...wantPl.keys()]); } catch (e) { say(`  YouTube: could not read the playlists — ${e.message}`); }
  const plUpdates = [...wantPl].filter(([id, w]) => plNow.has(id) && (plNow.get(id).title !== w.title || (plNow.get(id).description || '') !== w.description));

  say(`  YouTube: ${updates.length} video(s) and ${plUpdates.length} playlist(s) to rename${Number.isFinite(limit) ? ` (at most ${limit} this run)` : ''}`);
  for (const { e, meta, now } of updates) say(`    ${e.kind} ${e.id}: "${short(now.title)}"\n${' '.repeat(e.kind.length + String(e.id).length + 7)}→ "${short(meta.title)}"`);
  for (const [id, w] of plUpdates) say(`    playlist ${id}: "${short(plNow.get(id).title)}"\n      → "${short(w.title)}"`);
  if (!apply) { say(`  (about ${(updates.length + plUpdates.length) * 50} quota units of the daily 10,000)\n`); return; }

  let done = 0;
  const jobs = [...plUpdates.map(([id, w]) => () => youtube.updatePlaylist(id, w.title, w.description, plNow.get(id))),
    ...updates.map(({ e, meta, now }) => () => youtube.updateVideo(e.row.yt_video_id, meta, now))];
  for (const run of jobs) {
    if (done >= limit) break;
    try { await run(); done++; } catch (err) {
      if (youtube.quotaExceeded(err)) { say(`  ✗ YouTube quota used up after ${done} update(s) — run again tomorrow to continue`); break; }
      say(`  ✗ ${err.message}`);
    }
  }
  const left = jobs.length - done;
  say(`  YouTube: ${done} updated${left ? `, ${left} left — run again to continue` : ''}\n`);
}
