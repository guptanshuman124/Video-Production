// Worker pod: asks the central for a lecture, runs it (content generation +
// validation, voice, render, QA) in a child process, streams progress back,
// uploads the finished video, and — once the central has validated and stored
// it — deletes everything it made (images, audio, frames, drafts).
//
// Failed lectures keep their folder on the shared work volume, so a retry
// resumes from the failed stage on any worker.
//
// env: CENTRAL_URL (http://central:8080), WORK_DIR (/work), HOSTNAME (pod name)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jobDir } from './job.js';

const CENTRAL = (process.env.CENTRAL_URL || 'http://localhost:8080').replace(/\/$/, '');
const WORK = path.resolve(process.env.WORK_DIR || 'work');
const NAME = process.env.WORKER_NAME || process.env.HOSTNAME || os.hostname();
const JOB = fileURLToPath(new URL('./job.js', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(method, route, body, { headers = {}, raw = false } = {}) {
  const res = await fetch(`${CENTRAL}${route}`, {
    method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), 'x-worker': NAME, ...headers },
    body: raw ? body : body == null ? undefined : JSON.stringify(body),
    ...(raw ? { duplex: 'half' } : {}),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) { const e = new Error(data?.error || `${method} ${route}: HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}

// Retries a call to the central until it answers (the central may be restarting).
async function reliably(fn, what) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (e.status && e.status < 500) throw e;
      if (i % 6 === 0) log(`  central unreachable (${what}): ${e.message}; retrying`);
      await sleep(Math.min(30000, 2000 * (i + 1)));
    }
  }
}

// Deletes a finished lecture's folder and the course/module folders it leaves empty.
function removeJobDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (let d = path.dirname(dir); d.startsWith(WORK) && d !== WORK; d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }   // not empty
  }
}

let current = null;       // the running child, for shutdown
let stopping = false;

async function runOne(job) {
  const id = job.lecture_id;
  log(`▶ lecture ${id} · ${job.label}${job.from_stage ? ` · from ${job.from_stage}` : ''}`);
  const child = fork(JOB, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  current = child;
  let result = null;
  let queue = [];
  let cancelled = false;
  const flush = async () => {
    if (!queue.length) return;
    const events = queue; queue = [];
    try { await api('POST', `/api/worker/events/${id}`, { events }); } catch (e) { queue = [...events, ...queue].slice(-500); }
  };
  child.on('message', (m) => {
    if (m.type === 'event') queue.push({ ...m.event, at: Date.now() });
    else if (m.type === 'log') { console.log(`  ${m.line}`); queue.push({ type: 'log', line: String(m.line).slice(0, 1000), at: Date.now() }); }
    else if (m.type === 'result') result = m.result;
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.send({ input: job.input, from: job.from_stage, jobsDir: WORK });

  const pump = setInterval(flush, 1500);
  const beat = setInterval(async () => {
    try {
      const r = await api('POST', '/api/worker/heartbeat', { lecture_id: id });
      if (r?.cancel && !cancelled) { cancelled = true; log(`■ lecture ${id} cancelled from the dashboard`); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }
    } catch { /* next beat */ }
  }, 10000);
  const exit = await exited;
  current = null;
  clearInterval(pump); clearInterval(beat);
  await flush();

  const dir = jobDir(WORK, job.input);
  if (cancelled) {
    await reliably(() => api('POST', `/api/worker/failed/${id}`, { cancelled: true }), 'cancel');
    return;
  }
  if (!result) result = { ok: false, crashed: true, status: stopping ? 'worker pod stopped (redeploy or scale-down)' : `worker process exited (${exit.signal || `code ${exit.code}`})` };

  if (result.ok && result.video && fs.existsSync(result.video)) {
    const meta = { qa: result.qa, stages: result.stages, slides: result.slides, cost_usd: result.cost_usd };
    try {
      const size = fs.statSync(result.video).size;
      const r = await reliably(() => api('PUT', `/api/worker/video/${id}`, fs.createReadStream(result.video), {
        raw: true, headers: { 'content-type': 'video/mp4', 'content-length': String(size), 'x-meta': Buffer.from(JSON.stringify(meta)).toString('base64') },
      }), 'upload');
      log(`✓ lecture ${id} stored: ${r.path}`);
      // Stored and validated by the central: nothing of this lecture is needed any more.
      removeJobDir(dir);
    } catch (e) {
      // The central rejected the video (final validation) and has marked the lecture failed; keep the folder for the retry.
      log(`✗ lecture ${id}: ${e.message}`);
    }
    return;
  }
  log(`✗ lecture ${id}: ${result.status}`);
  await reliably(() => api('POST', `/api/worker/failed/${id}`, {
    status: result.status, crashed: !!result.crashed, error: result.error, stages: result.stages,
    reviewQueue: result.reviewQueue, cost_usd: result.cost_usd,
  }), 'report failure');
}

export async function runWorker() {
  fs.mkdirSync(WORK, { recursive: true });
  log(`worker ${NAME} · central ${CENTRAL} · work ${WORK}`);
  // Pod stopping (redeploy, scale-down): stop the running lecture — the central
  // requeues it and the next worker resumes from its last finished stage — and sign off.
  process.on('SIGTERM', async () => {
    stopping = true;
    log('stopping');
    if (current) current.kill('SIGTERM');
    const t = setTimeout(() => process.exit(0), 12000);
    const wait = async () => { while (current) await sleep(200); };
    await wait();
    try { await api('POST', '/api/worker/bye', {}); } catch { /* central gone too */ }
    clearTimeout(t);
    process.exit(0);
  });
  let idleLogged = false;
  for (;;) {
    if (stopping) { await sleep(1000); continue; }
    let job = null;
    try {
      job = await reliably(() => api('POST', '/api/worker/claim', {}), 'claim');
    } catch (e) {
      log(`  claim failed: ${e.message}`);
      await sleep(5000);
      continue;
    }
    if (!job) {
      if (!idleLogged) { log('  queue empty — waiting'); idleLogged = true; }
      await sleep(4000);
      continue;
    }
    idleLogged = false;
    try { await runOne(job); } catch (e) {
      log(`✗ lecture ${job.lecture_id}: worker error ${e.message}`);
      await reliably(() => api('POST', `/api/worker/failed/${job.lecture_id}`, { status: `worker error: ${e.message}`, crashed: true, error: String(e.stack) }), 'report failure').catch(() => {});
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runWorker();
