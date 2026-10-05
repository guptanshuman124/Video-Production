// Worker pod: asks the central for work — a lecture or a chapter summary
// video — runs it (content generation + validation, voice, render, QA) in a
// child process, streams progress back, uploads the finished video, and —
// once the central has validated and stored it — deletes everything it made
// (images, audio, frames, drafts).
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
import { jobDir } from './run-config.js';
import { summaryDir } from '../summary/run.js';

const CENTRAL = (process.env.CENTRAL_URL || 'http://localhost:8080').replace(/\/$/, '');
const WORK = path.resolve(process.env.WORK_DIR || 'work');
const NAME = process.env.WORKER_NAME || process.env.HOSTNAME || os.hostname();
const JOB = fileURLToPath(new URL('./job.js', import.meta.url));
const SUMMARY_JOB = fileURLToPath(new URL('./summary-job.js', import.meta.url));
const PIECE_JOB = fileURLToPath(new URL('./piece-job.js', import.meta.url));

// The kinds of work and their routes on the central. A summary's render is
// cut into pieces any worker renders (kind 'piece', runPiece below).
const KINDS = {
  lecture: {
    noun: 'lecture', script: JOB, id: (j) => j.lecture_id, dir: (j) => jobDir(WORK, j.input),
    events: (id) => `/api/worker/events/${id}`, failed: (id) => `/api/worker/failed/${id}`, video: (id) => `/api/worker/video/${id}`,
    heartbeat: (id) => ['/api/worker/heartbeat', { lecture_id: id }],
  },
  summary: {
    noun: 'summary', script: SUMMARY_JOB, id: (j) => j.module_id, dir: (j) => summaryDir(WORK, j.input),
    events: (id) => `/api/worker/summary-events/${id}`, failed: (id) => `/api/worker/summary-failed/${id}`, video: (id) => `/api/worker/summary-video/${id}`,
    heartbeat: (id) => ['/api/worker/summary-heartbeat', { module_id: id }],
  },
};
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
      // A 404 "no route" means the central is older than this worker (mid-deploy): wait for it.
      const routeMissing = e.status === 404 && /^no route /.test(e.message);
      if (e.status && e.status < 500 && !routeMissing) throw e;
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

// One piece of a summary's render: frames [from, to) of its timeline into the
// summary's (shared) job folder. Progress and liveness go with the heartbeat.
async function runPiece(job) {
  const { module_id: id, idx } = job;
  const dir = summaryDir(WORK, job.input);
  log(`▶ summary ${id} piece ${idx + 1}/${job.pieces} · ${job.label}`);
  const child = fork(PIECE_JOB, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  current = child;
  let result = null, done = 0, cancelled = false;
  child.on('message', (m) => {
    if (m.type === 'progress') done = m.done;
    else if (m.type === 'result') result = m.result;
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.send({ dir, idx, jobsDir: WORK });
  const beat = setInterval(async () => {
    try {
      const r = await api('POST', '/api/worker/piece-heartbeat', { module_id: id, idx, frames_done: done });
      if (r?.cancel && !cancelled) { cancelled = true; log(`■ summary ${id} piece ${idx + 1} cancelled`); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }
    } catch { /* next beat */ }
  }, 5000);
  const exit = await exited;
  current = null;
  clearInterval(beat);
  if (cancelled) { await reliably(() => api('POST', `/api/worker/piece-failed/${id}/${idx}`, { cancelled: true }), 'cancel piece'); return; }
  if (!result) result = { ok: false, crashed: true, status: stopping ? 'worker pod stopped (redeploy or scale-down)' : `worker process exited (${exit.signal || `code ${exit.code}`})` };
  if (result.ok) {
    log(`✓ summary ${id} piece ${idx + 1}/${job.pieces} rendered (${Math.round(result.seconds || 0)} s)`);
    await reliably(() => api('POST', `/api/worker/piece-done/${id}/${idx}`, { frames: result.frames, seconds: result.seconds }), 'piece done');
  } else {
    log(`✗ summary ${id} piece ${idx + 1}: ${result.status}`);
    await reliably(() => api('POST', `/api/worker/piece-failed/${id}/${idx}`, { status: result.status, error: result.error, crashed: !!result.crashed }), 'piece failed');
  }
}

async function runOne(job) {
  if (job.kind === 'piece') return runPiece(job);
  const K = KINDS[job.kind || 'lecture'];
  const id = K.id(job);
  log(`▶ ${K.noun} ${id} · ${job.label}${job.from_stage ? ` · from ${job.from_stage}` : ''}`);
  const child = fork(K.script, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  current = child;
  let result = null;
  let queue = [];
  let cancelled = false;
  const flush = async () => {
    if (!queue.length) return;
    const events = queue; queue = [];
    try { await api('POST', K.events(id), { events }); } catch (e) { queue = [...events, ...queue].slice(-500); }
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
      const r = await api('POST', ...K.heartbeat(id));
      if (r?.cancel && !cancelled) { cancelled = true; log(`■ ${K.noun} ${id} cancelled from the dashboard`); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }
    } catch { /* next beat */ }
  }, 10000);
  const exit = await exited;
  current = null;
  clearInterval(pump); clearInterval(beat);
  await flush();

  const dir = K.dir(job);
  if (cancelled) {
    await reliably(() => api('POST', K.failed(id), { cancelled: true }), 'cancel');
    return;
  }
  if (!result) result = { ok: false, crashed: true, status: stopping ? 'worker pod stopped (redeploy or scale-down)' : `worker process exited (${exit.signal || `code ${exit.code}`})` };

  // A summary that reached its render: the central spreads the pieces over the workers.
  if (result.renderPending) {
    log(`… summary ${id}: render planned in ${result.renderPlan.pieces.length} pieces — handed to the workers`);
    await reliably(() => api('POST', `/api/worker/summary-render-plan/${id}`, { plan: result.renderPlan, stages: result.stages, cost_usd: result.cost_usd, cost: result.cost || null }), 'render plan');
    return;
  }

  if (result.ok && result.video && fs.existsSync(result.video)) {
    const meta = { qa: result.qa, stages: result.stages, slides: result.slides, parts: result.parts ?? null, cost_usd: result.cost_usd, cost: result.cost || null };
    try {
      const size = fs.statSync(result.video).size;
      const r = await reliably(() => api('PUT', K.video(id), fs.createReadStream(result.video), {
        raw: true, headers: { 'content-type': 'video/mp4', 'content-length': String(size), 'x-meta': Buffer.from(JSON.stringify(meta)).toString('base64') },
      }), 'upload');
      log(`✓ ${K.noun} ${id} stored: ${r.path}`);
      // Stored and validated by the central: nothing of this lecture is needed any more.
      removeJobDir(dir);
    } catch (e) {
      // The central rejected the video (final validation) and has marked the lecture failed; keep the folder for the retry.
      log(`✗ ${K.noun} ${id}: ${e.message}`);
    }
    return;
  }
  log(`✗ ${K.noun} ${id}: ${result.status}`);
  await reliably(() => api('POST', K.failed(id), {
    status: result.status, crashed: !!result.crashed, error: result.error, stages: result.stages,
    reviewQueue: result.reviewQueue, cost_usd: result.cost_usd, cost: result.cost || null,
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
      if (job.kind === 'piece') {
        log(`✗ summary ${job.module_id} piece ${job.idx + 1}: worker error ${e.message}`);
        await reliably(() => api('POST', `/api/worker/piece-failed/${job.module_id}/${job.idx}`, { status: `worker error: ${e.message}`, crashed: true, error: String(e.stack) }), 'report failure').catch(() => {});
        continue;
      }
      const K = KINDS[job.kind || 'lecture'];
      log(`✗ ${K.noun} ${K.id(job)}: worker error ${e.message}`);
      await reliably(() => api('POST', K.failed(K.id(job)), { status: `worker error: ${e.message}`, crashed: true, error: String(e.stack) }), 'report failure').catch(() => {});
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runWorker();
