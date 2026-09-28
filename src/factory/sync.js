// Copies the source tables from the Prepzy MySQL (SOURCE_DB_URL, the
// `prepzy-mysql` container on this PC) into the cluster's `tutorai` database
// (TEXTBOOK_DB_URL). Each table is loaded into a fresh copy and swapped in
// with one RENAME, so readers never see a half-copied table.

import mysql from 'mysql2/promise';

export const SOURCE_TABLES = ['classes', 'subjects', 'class_subject_mapping', 'courses', 'modules', 'lectures', 'textbook_raw'];
const BATCH_BYTES = 4 * 1024 * 1024;

const connect = (url, multi = false) => mysql.createConnection({ uri: url, charset: 'utf8mb4', multipleStatements: multi, supportBigNumbers: true, dateStrings: true });

export async function syncSource({ from = process.env.SOURCE_DB_URL, to = process.env.TEXTBOOK_DB_URL, log = () => {}, onProgress = () => {} } = {}) {
  if (!from) throw new Error('SOURCE_DB_URL is not set');
  if (!to) throw new Error('TEXTBOOK_DB_URL is not set');
  const target = new URL(to);
  const dbName = target.pathname.replace(/^\//, '');
  const admin = await mysql.createConnection({ host: target.hostname, port: Number(target.port || 3306), user: decodeURIComponent(target.username), password: decodeURIComponent(target.password) });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  await admin.end();

  const src = await connect(from);
  const dst = await connect(to, true);
  const counts = {};
  try {
    await dst.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const [t, table] of SOURCE_TABLES.entries()) {
      const [[{ n }]] = await src.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      const [[create]] = await src.query(`SHOW CREATE TABLE \`${table}\``);
      const ddl = create['Create Table'].replace(/^CREATE TABLE `[^`]+`/, `CREATE TABLE \`${table}__new\``);
      await dst.query(`DROP TABLE IF EXISTS \`${table}__new\``);
      await dst.query(ddl);
      const [cols] = await src.query(`SHOW COLUMNS FROM \`${table}\``);
      const names = cols.map((c) => c.Field);
      const jsonCols = new Set(cols.filter((c) => /^json$/i.test(c.Type)).map((c) => c.Field));
      const insert = `INSERT INTO \`${table}__new\` (${names.map((c) => `\`${c}\``).join(',')}) VALUES ?`;

      let batch = [], bytes = 0, done = 0;
      const flush = async () => {
        if (!batch.length) return;
        await dst.query(insert, [batch]);
        done += batch.length;
        onProgress({ table, done, total: Number(n), tableIndex: t, tables: SOURCE_TABLES.length });
        batch = []; bytes = 0;
      };
      const stream = src.connection.query(`SELECT * FROM \`${table}\``).stream({ highWaterMark: 50 });
      for await (const row of stream) {
        const values = names.map((c) => {
          const v = row[c];
          // mysql2 parses JSON columns (a JSON string value arrives as a plain JS string): encode them again.
          return jsonCols.has(c) && v != null ? JSON.stringify(v) : v;
        });
        batch.push(values);
        bytes += values.reduce((a, v) => a + (v == null ? 4 : String(v).length), 0);
        if (bytes >= BATCH_BYTES || batch.length >= 500) await flush();
      }
      await flush();
      const [[exists]] = await dst.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [dbName, table]);
      if (exists.n) await dst.query(`RENAME TABLE \`${table}\` TO \`${table}__old\`, \`${table}__new\` TO \`${table}\``);
      else await dst.query(`RENAME TABLE \`${table}__new\` TO \`${table}\``);
      await dst.query(`DROP TABLE IF EXISTS \`${table}__old\``);
      counts[table] = done;
      log(`  ✓ ${table}: ${done} rows`);
    }
  } finally {
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
  }
  return counts;
}
