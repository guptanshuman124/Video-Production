// The factory's own state, in the `factory` database next to the `tutorai`
// source copy (both in the cluster's MySQL):
//
//   jobs          one row per lecture that was ever queued — its queue state,
//                 current stage, gate results and last error. Retrying resets it.
//   job_events    the lecture's activity log (stages, gates, worker messages)
//   videos        finished, validated videos: library path, and where they are stored
//                 (storage: local → uploading → onedrive | failed; remote_id / remote_url on OneDrive)
//   workers       worker pods seen by the central (heartbeats)
//   class_queues  per-class queue switch: running | paused
//   settings      small key/value store (desired worker count, last sync, …)
//   summaries        one row per chapter summary video ever queued (like jobs; keyed by module_id)
//   summary_events   a summary's activity log
//   summary_videos   finished, validated summary videos (library root Summaries/, own OneDrive root)
//   render_pieces    a summary's render, cut into pieces any worker can render
//   youtube_playlists  the YouTube playlist made for each chapter folder (videos.yt_* hold each upload)

import mysql from 'mysql2/promise';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
    lecture_id INT PRIMARY KEY,
    course_id INT NOT NULL, module_id INT NOT NULL, class_no INT NOT NULL,
    subject VARCHAR(100), book VARCHAR(200),
    chapter_no INT, chapter_title VARCHAR(300),
    lecture_no INT, lecture_count INT, lecture_title VARCHAR(300),
    seq BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    stage VARCHAR(30), progress FLOAT NOT NULL DEFAULT 0,
    from_stage VARCHAR(30),
    priority INT NOT NULL DEFAULT 0,
    attempts INT NOT NULL DEFAULT 0,
    worker VARCHAR(120),
    error_code VARCHAR(60), error_stage VARCHAR(30), error_message TEXT,
    stages JSON, issues JSON,
    cost_usd DOUBLE NOT NULL DEFAULT 0,
    queued_at DATETIME(3), started_at DATETIME(3), finished_at DATETIME(3), heartbeat_at DATETIME(3),
    INDEX by_queue (status, priority, seq), INDEX by_class (class_no)
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS job_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    lecture_id INT NOT NULL, at DATETIME(3) NOT NULL,
    level VARCHAR(10) NOT NULL, stage VARCHAR(30), message TEXT,
    INDEX by_lecture (lecture_id, id)
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS videos (
    lecture_id INT PRIMARY KEY,
    course_id INT, module_id INT, class_no INT,
    path VARCHAR(700) NOT NULL, bytes BIGINT, duration_s DOUBLE, width INT, height INT,
    slides INT, cost_usd DOUBLE, qa JSON,
    created_at DATETIME(3) NOT NULL
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS workers (
    name VARCHAR(120) PRIMARY KEY,
    status VARCHAR(20) NOT NULL, lecture_id INT NULL,
    started_at DATETIME(3), last_seen DATETIME(3), jobs_done INT NOT NULL DEFAULT 0, jobs_failed INT NOT NULL DEFAULT 0
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS class_queues (
    class_no INT PRIMARY KEY, state VARCHAR(10) NOT NULL, updated_at DATETIME(3)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(60) PRIMARY KEY, v JSON
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS summaries (
    module_id INT PRIMARY KEY,
    course_id INT NOT NULL, class_no INT NOT NULL,
    subject VARCHAR(100), book VARCHAR(200), chapter_no INT, chapter_title VARCHAR(300), lecture_count INT,
    seq BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    stage VARCHAR(30), progress FLOAT NOT NULL DEFAULT 0,
    from_stage VARCHAR(30),
    priority INT NOT NULL DEFAULT 0,
    attempts INT NOT NULL DEFAULT 0,
    worker VARCHAR(120),
    error_code VARCHAR(60), error_stage VARCHAR(30), error_message TEXT,
    stages JSON, issues JSON,
    cost_usd DOUBLE NOT NULL DEFAULT 0, cost_detail JSON NULL,
    queued_at DATETIME(3), started_at DATETIME(3), finished_at DATETIME(3), heartbeat_at DATETIME(3),
    INDEX by_queue (status, priority, seq), INDEX by_class (class_no)
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS summary_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    module_id INT NOT NULL, at DATETIME(3) NOT NULL,
    level VARCHAR(10) NOT NULL, stage VARCHAR(30), message TEXT,
    INDEX by_module (module_id, id)
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS render_pieces (
    module_id INT NOT NULL, idx INT NOT NULL,
    frame_from INT NOT NULL, frame_to INT NOT NULL, label VARCHAR(60),
    status VARCHAR(20) NOT NULL, worker VARCHAR(120), attempts INT NOT NULL DEFAULT 0,
    frames_done INT NOT NULL DEFAULT 0, error TEXT,
    started_at DATETIME(3), finished_at DATETIME(3), heartbeat_at DATETIME(3),
    PRIMARY KEY (module_id, idx), INDEX by_status (status)
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS summary_videos (
    module_id INT PRIMARY KEY,
    course_id INT, class_no INT,
    path VARCHAR(700) NOT NULL, bytes BIGINT, duration_s DOUBLE, width INT, height INT,
    slides INT, parts INT, cost_usd DOUBLE, cost_detail JSON NULL, qa JSON,
    created_at DATETIME(3) NOT NULL,
    storage VARCHAR(20) NOT NULL DEFAULT 'local', remote_id VARCHAR(200) NULL, remote_url VARCHAR(1000) NULL,
    remote_error TEXT NULL, uploaded_at DATETIME(3) NULL
  ) CHARACTER SET utf8mb4`,
  // One YouTube playlist per chapter folder (the video path's directory, as on OneDrive).
  `CREATE TABLE IF NOT EXISTS youtube_playlists (
    folder VARCHAR(600) PRIMARY KEY,
    playlist_id VARCHAR(80) NOT NULL, title VARCHAR(200), created_at DATETIME(3) NOT NULL
  ) CHARACTER SET utf8mb4`,
];

export async function openDb(url) {
  if (!url) throw new Error('FACTORY_DB_URL is not set (mysql://user:pass@host:3306/factory)');
  // Create the database itself on first start.
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, '') || 'factory';
  const admin = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4`);
  await admin.end();
  const pool = mysql.createPool({ uri: url, charset: 'utf8mb4', connectionLimit: 8, dateStrings: false, timezone: 'Z' });
  for (const sql of SCHEMA) await pool.query(sql);
  // Columns added after the first release (MySQL has no ADD COLUMN IF NOT EXISTS).
  // Per-video cost breakdown (pipeline/cost.js), kept after the job folder is deleted.
  await addColumns(pool, name, 'jobs', { cost_detail: 'JSON NULL' });
  await addColumns(pool, name, 'videos', {
    cost_detail: 'JSON NULL',
    storage: "VARCHAR(20) NOT NULL DEFAULT 'local'",
    remote_id: 'VARCHAR(200) NULL',
    remote_url: 'VARCHAR(1000) NULL',
    remote_error: 'TEXT NULL',
    uploaded_at: 'DATETIME(3) NULL',
  });
  // YouTube (youtube.js), lecture and summary videos: yt_status queued | uploading | done | failed;
  // the video id is saved as soon as the file is up, so a retry only redoes the playlist step.
  for (const table of ['videos', 'summary_videos']) await addColumns(pool, name, table, {
    yt_status: 'VARCHAR(20) NULL',
    yt_video_id: 'VARCHAR(40) NULL',
    yt_playlist_id: 'VARCHAR(80) NULL',
    yt_error: 'TEXT NULL',
    yt_warning: 'TEXT NULL',
    yt_uploaded_at: 'DATETIME(3) NULL',
  });
  // A worker busy with a summary video (module_id) instead of a lecture.
  await addColumns(pool, name, 'workers', { summary_id: 'INT NULL', task: 'VARCHAR(160) NULL' });
  return pool;
}

async function addColumns(pool, dbName, table, cols) {
  const [have] = await pool.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ?', [dbName, table]);
  const existing = new Set(have.map((r) => r.c.toLowerCase()));
  for (const [col, def] of Object.entries(cols)) {
    if (!existing.has(col)) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
  }
}

// Waits for MySQL to accept connections (it starts slower than the central pod).
export async function waitForDb(url, { tries = 60, log = console.log } = {}) {
  for (let i = 1; ; i++) {
    try { return await openDb(url); } catch (e) {
      if (i >= tries) throw e;
      if (i === 1 || i % 10 === 0) log(`  waiting for the database (${e.code || e.message})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export const json = (v) => (v == null ? null : JSON.stringify(v));
export const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

export async function getSetting(db, k, fallback = null) {
  const [[row]] = await db.query('SELECT v FROM settings WHERE k = ?', [k]);
  return row ? parse(row.v) : fallback;
}
export async function setSetting(db, k, v) {
  await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, json(v)]);
}
