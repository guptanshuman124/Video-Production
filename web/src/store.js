// Dashboard data: the catalog (every lecture, from the course tables) plus live
// state (jobs, videos, workers, class queues) kept current over Server-Sent Events.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

export const STAGES = [
  { id: 'prepare', label: 'Prepare source', gate: 'G0' },
  { id: 'slide-plan', label: 'Plan slides', gate: 'G2' },
  { id: 'slide-write', label: 'Write slides', gate: 'G3' },
  { id: 'narrate', label: 'Hinglish narration', gate: 'G4' },
  { id: 'review', label: 'Fact review', gate: 'G6' },
  { id: 'assemble', label: 'Assemble', gate: 'C1' },
  { id: 'voice', label: 'Voice-over', gate: 'A1' },
  { id: 'build', label: 'Sync timeline', gate: 'A2' },
  { id: 'render', label: 'Render video', gate: 'R1' },
  { id: 'qa', label: 'Video QA', gate: 'V1' },
];
export const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id || '—';

// The summary-video pipeline (src/summary/run.js); plan → review run per part.
export const SUMMARY_STAGES = [
  { id: 'prepare', label: 'Gather the chapter', gate: 'S0' },
  { id: 'outline', label: 'Outline the summary', gate: 'S1' },
  { id: 'plan', label: 'Plan each part', gate: 'S2', perPart: true },
  { id: 'write', label: 'Write slides', gate: 'S3', perPart: true },
  { id: 'narrate', label: 'Narration', gate: 'S4', perPart: true },
  { id: 'review', label: 'Fact & coverage review', gate: 'S5', perPart: true },
  { id: 'assemble', label: 'Assemble', gate: 'C1' },
  { id: 'voice', label: 'Voice-over', gate: 'A1' },
  { id: 'build', label: 'Sync timeline', gate: 'A2' },
  { id: 'render', label: 'Render video', gate: 'R1' },
  { id: 'qa', label: 'Video QA', gate: 'V1' },
];
export const summaryStageLabel = (id) => SUMMARY_STAGES.find((s) => s.id === id)?.label || id || '—';

export async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ---- store --------------------------------------------------------------------------------

const state = {
  ready: false, error: null, connected: false,
  catalog: null,          // { classes, lectures: {id: lecture} }
  jobs: {}, videos: {}, queues: {}, workers: { workers: [], scale: null, k8s: false },
  sync: {}, library: '', storage: { provider: 'local' }, activity: [], version: 0,
  // Summary videos: their own queue and library (factory/summaries.js).
  roots: { lectures: 'CBSE Lectures', summaries: 'CBSE Summaries' },
  summaries: {}, summaryVideos: {}, summaryQueue: 'running', summaryRoot: 'Summaries', summaryActivity: [],
};
const listeners = new Set();
let snapshot = { ...state };
function emit() { state.version++; snapshot = { ...state }; for (const l of listeners) l(); }
let pending = null;
const emitSoon = () => { if (!pending) pending = setTimeout(() => { pending = null; emit(); }, 120); };

async function loadCatalog() {
  const c = await api('GET', '/api/catalog');
  state.catalog = c;
}
async function loadState() {
  const s = await api('GET', '/api/state');
  state.jobs = Object.fromEntries(s.jobs.map((j) => [j.lecture_id, j]));
  state.videos = Object.fromEntries(s.videos.map((v) => [v.lecture_id, v]));
  state.queues = Object.fromEntries(s.queues.map((q) => [q.class_no, q.state]));
  state.workers = s.workers;
  state.sync = s.sync;
  state.library = s.library;
  state.roots = s.roots || { lectures: 'CBSE Lectures', summaries: 'CBSE Summaries' };
  state.storage = s.storage || { provider: 'local' };
}
async function loadActivity() {
  state.activity = await api('GET', '/api/activity');
}
async function loadSummaries() {
  const s = await api('GET', '/api/summaries');
  state.summaries = Object.fromEntries(s.summaries.map((j) => [j.module_id, j]));
  state.summaryVideos = Object.fromEntries(s.videos.map((v) => [v.module_id, v]));
  state.summaryQueue = s.queue;
  state.summaryRoot = s.root;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  const boot = async () => {
    try {
      await Promise.all([loadCatalog(), loadState(), loadActivity(), loadSummaries()]);
      state.ready = true; state.error = null;
    } catch (e) { state.error = e.message; setTimeout(boot, 3000); }
    emit();
  };
  boot();
  const connect = () => {
    const es = new EventSource('/api/events');
    es.onopen = () => { state.connected = true; emit(); };
    es.onerror = () => { state.connected = false; emit(); };
    es.addEventListener('job', (e) => {
      const j = JSON.parse(e.data);
      if (j.status == null) delete state.jobs[j.lecture_id];
      else state.jobs[j.lecture_id] = j;
      state.jobs = { ...state.jobs };
      emitSoon();
    });
    es.addEventListener('video', (e) => {
      const v = JSON.parse(e.data);
      if (v.deleted) delete state.videos[v.lecture_id]; else state.videos[v.lecture_id] = v;
      state.videos = { ...state.videos };
      emitSoon();
    });
    es.addEventListener('upload', (e) => {
      const u = JSON.parse(e.data);
      const v = state.videos[u.lecture_id];
      if (v) { state.videos = { ...state.videos, [u.lecture_id]: { ...v, storage: 'uploading', upload: { done: u.done, total: u.total } } }; emitSoon(); }
    });
    es.addEventListener('workers', (e) => { state.workers = JSON.parse(e.data); emitSoon(); });
    es.addEventListener('queue', (e) => { const q = JSON.parse(e.data); state.queues = { ...state.queues, [q.class_no]: q.state }; emitSoon(); });
    es.addEventListener('sync', (e) => { state.sync = { ...state.sync, ...JSON.parse(e.data) }; emitSoon(); });
    es.addEventListener('log', (e) => { state.activity = [JSON.parse(e.data), ...state.activity].slice(0, 120); emitSoon(); });
    es.addEventListener('refresh', async (e) => {
      const { what } = JSON.parse(e.data);
      try {
        if (what === 'summaries') await loadSummaries();
        else { if (what === 'catalog') await loadCatalog(); await loadState(); }
      } catch { /* next event */ }
      emit();
    });
    es.addEventListener('summary', (e) => {
      const j = JSON.parse(e.data);
      if (j.status == null) delete state.summaries[j.module_id]; else state.summaries[j.module_id] = j;
      state.summaries = { ...state.summaries };
      emitSoon();
    });
    es.addEventListener('summary-video', (e) => {
      const v = JSON.parse(e.data);
      if (v.deleted) delete state.summaryVideos[v.module_id]; else state.summaryVideos[v.module_id] = v;
      state.summaryVideos = { ...state.summaryVideos };
      emitSoon();
    });
    es.addEventListener('summary-upload', (e) => {
      const u = JSON.parse(e.data);
      const v = state.summaryVideos[u.module_id];
      if (v) { state.summaryVideos = { ...state.summaryVideos, [u.module_id]: { ...v, storage: 'uploading', upload: { done: u.done, total: u.total } } }; emitSoon(); }
    });
    es.addEventListener('summary-queue', (e) => { state.summaryQueue = JSON.parse(e.data).state; emitSoon(); });
    es.addEventListener('summary-log', (e) => { state.summaryActivity = [JSON.parse(e.data), ...state.summaryActivity].slice(0, 120); emitSoon(); });
  };
  connect();
  // Belt and braces: a full refresh every 30 s in case an event was missed.
  setInterval(async () => { try { await Promise.all([loadState(), loadSummaries()]); emit(); } catch { /* offline */ } }, 30000);
}

export function useStore() {
  useEffect(start, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}
export const refresh = async () => { await loadState(); emit(); };

// ---- derived --------------------------------------------------------------------------------

// A lecture's state for display: done | running | validating | queued | failed | cancelling | idle | unsupported
export function lectureStatus(s, id) {
  const j = s.jobs[id];
  const v = s.videos[id];
  const l = s.catalog?.lectures[id];
  if (j && ['running', 'validating', 'cancelling', 'queued', 'failed'].includes(j.status)) return j.status;
  if (v) return 'done';
  if (j?.status === 'done') return 'done';
  return l && !l.supported ? 'unsupported' : 'idle';
}

export function emptyCounts() { return { total: 0, supported: 0, done: 0, running: 0, queued: 0, failed: 0, idle: 0, minutes: 0 }; }
export function countLectures(s, lectures) {
  const c = emptyCounts();
  for (const l of lectures) {
    c.total++;
    if (l.supported) c.supported++;
    const st = lectureStatus(s, l.lecture_id);
    if (st === 'done') { c.done++; c.minutes += (s.videos[l.lecture_id]?.duration_s || 0) / 60; }
    else if (st === 'running' || st === 'validating' || st === 'cancelling') c.running++;
    else if (st === 'queued') c.queued++;
    else if (st === 'failed') c.failed++;
    else if (st === 'idle') c.idle++;
  }
  return c;
}

// ---- summary videos --------------------------------------------------------------------------

// Every chapter, flat: { module_id, class_no, subject, book, chapter_no, title, lectures, supported, why, pack }.
export function allChapters(s) {
  const out = [];
  for (const cls of s.catalog?.classes || []) {
    for (const subj of cls.subjects) {
      for (const b of subj.books) {
        for (const ch of b.chapters) {
          out.push({ module_id: ch.module_id, class_no: cls.class_no, subject: subj.subject, book: b.title, multiBook: subj.books.length > 1,
                     chapter_no: ch.no, title: ch.title, lectures: ch.lectures.length, supported: ch.supported, why: ch.why, pack: ch.pack });
        }
      }
    }
  }
  return out;
}

// A chapter summary's state: done | running | validating | queued | failed | cancelling | idle | unsupported
export function summaryStatus(s, ch) {
  const j = s.summaries[ch.module_id];
  const v = s.summaryVideos[ch.module_id];
  if (j && ['running', 'rendering', 'validating', 'cancelling', 'queued', 'failed'].includes(j.status)) return j.status;
  if (v || j?.status === 'done') return 'done';
  return ch.supported ? 'idle' : 'unsupported';
}
export function countSummaries(s, chapters) {
  const c = emptyCounts();
  for (const ch of chapters) {
    c.total++;
    if (ch.supported) c.supported++;
    const st = summaryStatus(s, ch);
    if (st === 'done') { c.done++; c.minutes += (s.summaryVideos[ch.module_id]?.duration_s || 0) / 60; }
    else if (st === 'running' || st === 'rendering' || st === 'validating' || st === 'cancelling') c.running++;
    else if (st === 'queued') c.queued++;
    else if (st === 'failed') c.failed++;
    else if (st === 'idle') c.idle++;
  }
  return c;
}

// Flat lecture list helpers
export const allLectures = (s) => Object.values(s.catalog?.lectures || {});
export function useCounts(s, filter) {
  return useMemo(() => countLectures(s, allLectures(s).filter(filter)), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Queue order, as the central claims it.
export function queuedInOrder(s) {
  const q = Object.values(s.jobs).filter((j) => j.status === 'queued');
  const lec = s.catalog?.lectures || {};
  return q.sort((a, b) => (b.priority - a.priority) || (new Date(a.queued_at) - new Date(b.queued_at)) || ((lec[a.lecture_id]?.seq || 0) - (lec[b.lecture_id]?.seq || 0)));
}

// Re-render every second (elapsed timers).
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
}
