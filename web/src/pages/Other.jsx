import { useContext, useEffect, useMemo, useState } from 'react';
import { Pause, Play, ChevronsUp, XCircle, RotateCcw, AlertTriangle, Film, Search, Server, Minus, Plus, Database, RefreshCw, FolderOpen, CheckCircle2, Layers, Cloud, CloudUpload, ExternalLink, Youtube } from 'lucide-react';
import { api, allLectures, countLectures, lectureStatus, queuedInOrder, stageLabel, useStore, useTick } from '../store.js';
import { Btn, Card, Empty, Progress, StageDots, StatusChip, fmtAgo, fmtBytes, fmtDur, fmtElapsed, fmtMin, useAction, useToast } from '../components/ui.jsx';
import { LectureButtons, useApp, useLectureActions, StorageBadge, YoutubeButton, hostPath } from '../components/lecture.jsx';
import { WorkerCard, RecentVideo } from './Overview.jsx';
import { SummaryCtx } from './Summaries.jsx';
import { allChapters, summaryStageLabel } from '../store.js';

// ---- Queue ----------------------------------------------------------------------------------

export function QueuePage() {
  const s = useStore();
  const { openLecture } = useApp();
  const a = useLectureActions();
  const [run] = useAction();
  useTick(1000);
  const running = Object.values(s.jobs).filter((j) => ['running', 'validating', 'cancelling'].includes(j.status));
  const { openSummary } = useContext(SummaryCtx);
  const chapters = useMemo(() => new Map(allChapters(s).map((c) => [c.module_id, c])), [s.catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const sumRunning = Object.values(s.summaries).filter((j) => ['running', 'rendering', 'validating', 'cancelling'].includes(j.status));
  const sumQueued = Object.values(s.summaries).filter((j) => j.status === 'queued').sort((a, b) => (b.priority - a.priority) || (new Date(a.queued_at) - new Date(b.queued_at)));
  const queued = queuedInOrder(s);
  const byClass = new Map();
  for (const j of queued) {
    const l = s.catalog?.lectures[j.lecture_id];
    if (!l) continue;
    if (!byClass.has(l.class_no)) byClass.set(l.class_no, []);
    byClass.get(l.class_no).push({ j, l });
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1>Queue</h1><p className="muted">Lectures are taken in order: "Run next" first, then by the time they were queued, then in course order (subject → chapter → lecture). A paused class is skipped.</p></div></div>

      <Card title={`In production (${running.length})`} pad={false}>
        {running.length ? (
          <table className="table">
            <thead><tr><th>Lecture</th><th>Worker</th><th>Stage</th><th style={{ width: 220 }}>Progress</th><th>Elapsed</th><th /></tr></thead>
            <tbody>
              {running.map((j) => {
                const l = s.catalog?.lectures[j.lecture_id];
                return (
                  <tr key={j.lecture_id} onClick={() => openLecture(j.lecture_id)} className="clickable">
                    <td><div className="cell-title">{l?.lecture_title}</div><div className="muted small">Class {l?.class_no} · {l?.subject} · Ch {l?.chapter_no} · L{l?.lecture_no}</div></td>
                    <td className="mono small">{j.worker}</td>
                    <td>{stageLabel(j.stage)}<StageDots job={j} compact /></td>
                    <td><Progress value={j.progress} striped /><span className="muted small">{Math.round(j.progress)}%</span></td>
                    <td className="small">{fmtElapsed(j.started_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}><Btn size="sm" variant="ghost" Icon={XCircle} onClick={() => a.cancel(j.lecture_id, true)}>Stop</Btn></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty Icon={Layers} title="Nothing is being made right now" />}
      </Card>

      {(sumRunning.length > 0 || sumQueued.length > 0) && (
        <Card title={<>Summary videos <span className="muted">· {sumRunning.length} in production · {sumQueued.length} queued</span>{s.summaryQueue === 'paused' && <span className="pill pill-amber" style={{ marginLeft: 8 }}>Paused</span>}</>} pad={false}>
          <table className="table">
            <thead><tr><th>Chapter</th><th>Worker</th><th>Stage</th><th style={{ width: 220 }}>Progress</th><th>Elapsed</th></tr></thead>
            <tbody>
              {[...sumRunning, ...sumQueued.slice(0, 50)].map((j) => {
                const ch = chapters.get(j.module_id);
                return (
                  <tr key={j.module_id} className="clickable" onClick={() => openSummary(j.module_id)}>
                    <td><div className="cell-title">Ch {ch?.chapter_no} · {ch?.title} — summary</div><div className="muted small">Class {ch?.class_no} · {ch?.subject}</div></td>
                    <td className="mono small">{j.status === 'rendering' ? `${j.stages?.render?.done ?? 0}/${j.stages?.render?.count ?? '?'} pieces · all workers` : j.worker || '—'}</td>
                    <td>{j.status === 'queued' ? <span className="pill pill-violet">Queued</span> : summaryStageLabel(j.stage)}</td>
                    <td>{j.status !== 'queued' && <><Progress value={j.progress} striped /><span className="muted small">{Math.round(j.progress)}%</span></>}</td>
                    <td className="small">{j.status !== 'queued' ? fmtElapsed(j.started_at) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {[...byClass.entries()].sort((x, y) => x[0] - y[0]).map(([classNo, items]) => {
        const paused = s.queues[classNo] === 'paused';
        return (
          <Card key={classNo} title={<>Class {classNo} <span className="muted">· {items.length} queued</span>{paused && <span className="pill pill-amber" style={{ marginLeft: 8 }}>Paused</span>}</>}
            actions={paused
              ? <Btn size="sm" Icon={Play} onClick={() => run('r', () => api('POST', `/api/classes/${classNo}/resume`), 'Resumed')}>Resume</Btn>
              : <Btn size="sm" Icon={Pause} onClick={() => run('p', () => api('POST', `/api/classes/${classNo}/pause`), 'Paused')}>Pause</Btn>}
            pad={false}>
            <table className="table">
              <thead><tr><th style={{ width: 50 }}>#</th><th>Lecture</th><th>Chapter</th><th>Note</th><th /></tr></thead>
              <tbody>
                {items.slice(0, 200).map(({ j, l }, i) => (
                  <tr key={j.lecture_id} className="clickable" onClick={() => openLecture(j.lecture_id)}>
                    <td className="muted">{i + 1}</td>
                    <td><div className="cell-title">L{l.lecture_no} · {l.lecture_title}</div><div className="muted small">{l.subject}{l.book !== l.subject ? ` · ${l.book}` : ''}</div></td>
                    <td className="small">Ch {l.chapter_no} · {l.chapter_title}</td>
                    <td className="small">{j.priority > 0 && <span className="pill pill-violet">Run next</span>} {j.from_stage && <span className="muted">from {stageLabel(j.from_stage)}</span>} {j.error_code === 'CRASHED' && <span className="t-amber">requeued after crash</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <Btn size="sm" variant="ghost" Icon={ChevronsUp} onClick={() => a.next(j.lecture_id)} title="Run next" />
                        <Btn size="sm" variant="ghost" Icon={XCircle} onClick={() => a.cancel(j.lecture_id, false)} title="Remove" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > 200 && <div className="muted small" style={{ padding: 12 }}>+ {items.length - 200} more</div>}
          </Card>
        );
      })}
      {!queued.length && <Card><Empty title="Queue is empty">Open a class and press Start, or queue single chapters and lectures.</Empty></Card>}
    </div>
  );
}

// ---- Needs attention ----------------------------------------------------------------------------

const ERR = { GATE_FAILED: 'Validation gate failed', VIDEO_INVALID: 'Final video check failed', WORKER_LOST: 'Worker stopped responding', CRASHED: 'Crashed', SOURCE_ERROR: 'Source data problem', NOT_IN_SOURCE: 'Removed from source' };

export function AttentionPage() {
  const s = useStore();
  const { openLecture } = useApp();
  const a = useLectureActions();
  const [run, busy] = useAction();
  const [cls, setCls] = useState('all');
  const failed = Object.values(s.jobs).filter((j) => j.status === 'failed').map((j) => ({ j, l: s.catalog?.lectures[j.lecture_id] })).filter((x) => x.l && (cls === 'all' || x.l.class_no === Number(cls)))
    .sort((x, y) => new Date(y.j.finished_at) - new Date(x.j.finished_at));
  const byStage = {};
  for (const { j } of failed) byStage[j.error_stage || 'unknown'] = (byStage[j.error_stage || 'unknown'] || 0) + 1;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Needs attention</h1><p className="muted">Lectures that stopped because a validation gate still failed after automatic repair, the final video check failed, or a worker crashed repeatedly. Finished stages are kept, so a retry only redoes the failed part.</p></div>
        <div className="head-actions">
          <select className="select" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="all">All classes</option>
            {(s.catalog?.classes || []).map((c) => <option key={c.class_no} value={c.class_no}>{c.name}</option>)}
          </select>
          <Btn variant="primary" Icon={RotateCcw} disabled={!failed.length} busy={busy === 'all'} onClick={() => run('all', () => api('POST', '/api/retry-failed', { scope: cls === 'all' ? {} : { class_no: Number(cls) } }), (r) => `Retrying ${r.retried} lecture(s)`)}>Retry all ({failed.length})</Btn>
        </div>
      </div>
      {failed.length > 0 && <div className="chips-row">{Object.entries(byStage).map(([k, n]) => <span key={k} className="pill pill-red">{stageLabel(k)} · {n}</span>)}</div>}
      <Card pad={false}>
        {failed.length ? (
          <table className="table">
            <thead><tr><th>Lecture</th><th>Problem</th><th>Details</th><th>When</th><th /></tr></thead>
            <tbody>
              {failed.map(({ j, l }) => (
                <tr key={j.lecture_id} className="clickable" onClick={() => openLecture(j.lecture_id)}>
                  <td><div className="cell-title">{l.lecture_title}</div><div className="muted small">Class {l.class_no} · {l.subject} · Ch {l.chapter_no} · L{l.lecture_no}</div></td>
                  <td><span className="t-red">{ERR[j.error_code] || j.error_code}</span><div className="muted small">at {stageLabel(j.error_stage)} · attempt {j.attempts}</div></td>
                  <td className="small err-cell">{(j.error_message || '').split('\n')[0]}</td>
                  <td className="small muted">{fmtAgo(j.finished_at)}</td>
                  <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                    <Btn size="sm" Icon={RotateCcw} onClick={() => a.retry(j.lecture_id)}>Retry</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => openLecture(j.lecture_id)}>Details</Btn>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty Icon={CheckCircle2} title="Nothing needs attention">Every lecture that ran passed its gates.</Empty>}
      </Card>
    </div>
  );
}

// ---- Library ----------------------------------------------------------------------------------

// Lecture videos and summary videos: one library, two collections (a toggle),
// each in its own folder tree (OneDrive: CBSE Lectures / CBSE Summaries).
export function LibraryPage() {
  const [kind, setKind] = useState(() => (window.location.hash.includes('summaries') ? 'summaries' : 'lectures'));
  const toggle = (
    <div className="seg seg-lg">
      <button className={kind === 'lectures' ? 'on' : ''} onClick={() => setKind('lectures')}>Lecture videos</button>
      <button className={kind === 'summaries' ? 'on' : ''} onClick={() => setKind('summaries')}>Summary videos</button>
    </div>
  );
  return kind === 'summaries' ? <SummaryLibrary toggle={toggle} /> : <LectureLibrary toggle={toggle} />;
}

function SummaryLibrary({ toggle }) {
  const s = useStore();
  const { openSummary, playSummary } = useContext(SummaryCtx);
  const [cls, setCls] = useState('all');
  const [q, setQ] = useState('');
  const chapters = useMemo(() => new Map(allChapters(s).map((c) => [c.module_id, c])), [s.catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const vids = Object.values(s.summaryVideos).map((v) => ({ v, ch: chapters.get(v.module_id) })).filter((x) => x.ch)
    .filter((x) => (cls === 'all' || x.ch.class_no === Number(cls)) && (!q || `${x.ch.title} ${x.ch.subject}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.ch.class_no - b.ch.class_no) || a.ch.subject.localeCompare(b.ch.subject) || a.ch.book.localeCompare(b.ch.book) || (a.ch.chapter_no - b.ch.chapter_no));
  const total = vids.reduce((a, x) => a + (x.v.duration_s || 0), 0);
  const bytes = vids.reduce((a, x) => a + (x.v.bytes || 0), 0);
  const groups = new Map();
  for (const x of vids) {
    const k = `Class ${x.ch.class_no} · ${x.ch.subject}${x.ch.multiBook ? ` · ${x.ch.book}` : ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Library</h1><p className="muted">{vids.length} summary videos · {fmtMin(total / 60)} · {fmtBytes(bytes)} · {s.storage?.provider === 'onedrive' ? <>stored on OneDrive: <span className="mono">{s.storage.site} › {s.storage.library} › {s.summaryRoot}</span></> : <>stored in <span className="mono">{hostPath(s.library, s.roots.summaries)}</span></>}</p></div>
        <div className="head-actions">
          {toggle}
          <div className="search"><Search size={15} /><input placeholder="Search summaries" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="all">All classes</option>
            {(s.catalog?.classes || []).map((c) => <option key={c.class_no} value={c.class_no}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {!vids.length && <Card><Empty Icon={Film} title="No summary videos yet">Make them on the Summary videos page; they appear here after final validation.</Empty></Card>}
      {[...groups.entries()].map(([k, items]) => (
        <section key={k} className="lib-group">
          <h3 className="lib-head"><FolderOpen size={16} />{k}<span className="muted small">{items.length} summar{items.length > 1 ? 'ies' : 'y'}</span></h3>
          <Card pad={false}>
            <table className="table">
              <tbody>
                {items.map(({ v, ch }) => (
                  <tr key={ch.module_id} className="clickable" onClick={() => playSummary(ch.module_id)}>
                    <td style={{ width: 70 }}>Ch {ch.chapter_no}</td><td className="cell-title">{ch.title}<div className="muted small">{v.parts ?? '—'} parts · {ch.lectures} lectures</div></td>
                    <td><StorageBadge v={v} provider={s.storage?.provider} /></td><td className="small muted">{fmtDur(v.duration_s)}</td><td className="small muted">{fmtBytes(v.bytes)}</td><td className="small muted">{fmtAgo(v.created_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}><div className="row-actions"><YoutubeButton id={ch.module_id} v={v} size="sm" summary /><Btn size="sm" variant="ghost" onClick={() => openSummary(ch.module_id)}>Details</Btn></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ))}
    </div>
  );
}

function LectureLibrary({ toggle }) {
  const s = useStore();
  const { play, openLecture } = useApp();
  const [cls, setCls] = useState('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState('grid');
  const vids = Object.values(s.videos).map((v) => ({ v, l: s.catalog?.lectures[v.lecture_id] })).filter((x) => x.l)
    .filter((x) => (cls === 'all' || x.l.class_no === Number(cls)) && (!q || `${x.l.lecture_title} ${x.l.chapter_title} ${x.l.subject}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.l.seq - b.l.seq);
  const total = vids.reduce((a, x) => a + (x.v.duration_s || 0), 0);
  const bytes = vids.reduce((a, x) => a + (x.v.bytes || 0), 0);
  // class → subject → chapter
  const groups = new Map();
  for (const x of vids) {
    const k = `Class ${x.l.class_no} · ${x.l.subject}${x.l.book !== x.l.subject ? ` · ${x.l.book}` : ''} · Chapter ${x.l.chapter_no}: ${x.l.chapter_title}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Library</h1><p className="muted">{vids.length} videos · {fmtMin(total / 60)} · {fmtBytes(bytes)} · {s.storage?.provider === 'onedrive' ? <>stored on OneDrive: <span className="mono">{s.storage.site} › {s.storage.library} › {s.storage.root}</span>{s.storage.rootUrl && <> · <a href={s.storage.rootUrl} target="_blank" rel="noreferrer">open</a></>}</> : <>stored in <span className="mono">{hostPath(s.library, s.roots.lectures)}</span></>}</p></div>
        <div className="head-actions">
          {toggle}
          <div className="search"><Search size={15} /><input placeholder="Search videos" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="all">All classes</option>
            {(s.catalog?.classes || []).map((c) => <option key={c.class_no} value={c.class_no}>{c.name}</option>)}
          </select>
          <div className="seg"><button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid</button><button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button></div>
        </div>
      </div>
      {!vids.length && <Card><Empty Icon={Film} title="No videos yet">Finished lectures appear here after they pass final validation.</Empty></Card>}
      {[...groups.entries()].map(([k, items]) => (
        <section key={k} className="lib-group">
          <h3 className="lib-head"><FolderOpen size={16} />{k}<span className="muted small">{items.length} video{items.length > 1 ? 's' : ''}</span></h3>
          {view === 'grid' ? (
            <div className="recent">{items.map(({ v, l }) => <RecentVideo key={l.lecture_id} l={l} v={v} />)}</div>
          ) : (
            <Card pad={false}>
              <table className="table">
                <tbody>
                  {items.map(({ v, l }) => (
                    <tr key={l.lecture_id} className="clickable" onClick={() => play(l.lecture_id)}>
                      <td style={{ width: 60 }}>L{l.lecture_no}</td><td className="cell-title">{l.lecture_title}</td><td><StorageBadge v={v} provider={s.storage?.provider} /></td><td className="small muted">{fmtDur(v.duration_s)}</td><td className="small muted">{fmtBytes(v.bytes)}</td><td className="small muted">{fmtAgo(v.created_at)}</td>
                      <td onClick={(e) => e.stopPropagation()}><div className="row-actions"><YoutubeButton id={l.lecture_id} v={v} size="sm" /><Btn size="sm" variant="ghost" onClick={() => openLecture(l.lecture_id)}>Details</Btn></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}

// ---- Workers ------------------------------------------------------------------------------------

export function WorkersPage() {
  const s = useStore();
  const [run, busy] = useAction();
  useTick(2000);
  const { workers = [], scale, k8s, host } = s.workers;
  const online = workers.filter((w) => w.online);
  const desired = scale?.desired ?? online.length;
  // A rendering worker may use 2.5 GB and ~2 CPUs; the database, central and Kubernetes take ~2.5 GB.
  const safe = host?.memoryGb ? Math.max(1, Math.min(Math.floor((host.memoryGb - 2.5) / 2.5), Math.floor(host.cpus / 2))) : 2;
  const setScale = (n) => run('scale', () => api('POST', '/api/workers/scale', { replicas: n }), `Workers set to ${n}`);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Workers</h1><p className="muted">Each worker pod makes one lecture at a time: content generation and validation, voice-over, rendering and QA. It uploads the video to the central, which validates and stores it; the worker then deletes its images, audio and frames.</p></div>
        {k8s && (
          <div className="scaler">
            <span className="muted small">Parallel lectures</span>
            <Btn size="sm" Icon={Minus} disabled={desired <= 0} busy={busy === 'scale'} onClick={() => setScale(desired - 1)} />
            <span className="scale-n">{desired}</span>
            <Btn size="sm" Icon={Plus} disabled={desired >= 12} busy={busy === 'scale'} onClick={() => setScale(desired + 1)} />
          </div>
        )}
      </div>
      {k8s && desired > safe && <div className="alert alert-amber"><AlertTriangle size={16} /><div>{host?.memoryGb
        ? `This machine (${host.memoryGb} GB RAM, ${host.cpus} CPUs) fits about ${safe} parallel lectures. More can run out of memory or slow every render down; watch the first few.`
        : `More than ${safe} parallel lectures can use more memory than Docker has and freeze the machine while they render.`}</div></div>}
      <div className="workers">{workers.map((w) => <WorkerCard key={w.name} w={w} />)}</div>
      {!workers.length && <Card><Empty Icon={Server} title="No workers connected">Worker pods register when they start. Run <span className="mono">kubectl get pods</span> to see them.</Empty></Card>}
    </div>
  );
}

// ---- Storage (OneDrive / SharePoint) -------------------------------------------------------------

function StorageCard() {
  const s = useStore();
  const [run, busy] = useAction();
  const st = s.storage || {};
  const vids = Object.values(s.videos);
  const n = (x) => vids.filter((v) => (v.storage || 'local') === x).length;
  const onedrive = st.provider === 'onedrive';
  return (
    <Card title={<>{onedrive ? <Cloud size={16} /> : <FolderOpen size={16} />} Video storage</>}>
      {onedrive ? (
        <>
          <p className="muted small">Every validated video is uploaded to OneDrive / SharePoint in the class → subject → chapter → lecture folders, then its local copy is removed{st.keepLocal ? ' (kept here: LIBRARY_KEEP_LOCAL)' : ''}. The Library plays straight from OneDrive.</p>
          {st.ok === false
            ? <div className="alert alert-red"><AlertTriangle size={16} /><div>OneDrive is not reachable: {st.error}</div></div>
            : <dl className="kv">
                <dt>Location</dt><dd>{st.site} › {st.library} › {st.root}{st.rootUrl && <> · <a href={st.rootUrl} target="_blank" rel="noreferrer">open <ExternalLink size={12} /></a></>}</dd>
                <dt>On OneDrive</dt><dd>{n('onedrive')}</dd>
                <dt>Uploading / waiting</dt><dd>{n('uploading') + n('local')}</dd>
                <dt>Upload failed</dt><dd className={n('failed') ? 't-red' : ''}>{n('failed')}</dd>
              </dl>}
          <pre className="path">{s.roots.lectures}/Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Lecture 3 - Types of Chemical Reactions.mp4{'\n'}{s.roots.summaries}/Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Chapter 1 - Chemical Reactions and Equations - Summary.mp4</pre>
          <Btn Icon={CloudUpload} disabled={!n('failed') && !n('local')} busy={busy === 'up'} onClick={() => run('up', () => api('POST', '/api/uploads/retry'), (r) => `Uploading ${r.queued} video(s)`)}>Retry failed uploads</Btn>
        </>
      ) : (
        <>
          <p className="muted small">OneDrive is not configured (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SHAREPOINT_SITE_URL in .env, then <span className="mono">npm run factory -- deploy</span>). Videos are saved on this PC as</p>
          <pre className="path">{hostPath(s.library, `${s.roots.lectures}/Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Lecture 3 - Types of Chemical Reactions.mp4`)}{'\n'}{hostPath(s.library, `${s.roots.summaries}/Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Chapter 1 - Chemical Reactions and Equations - Summary.mp4`)}</pre>
        </>
      )}
      <p className="muted small">Subjects with more than one book (e.g. Physics Part I / Part II) get a book folder between subject and chapter. Chapters carry their NCERT numbers, so a book that continues the numbering (Mathematics Part II) starts at its first NCERT chapter (<span className="mono">chapter_start</span> in config/courses.yaml).</p>
    </Card>
  );
}

// ---- YouTube queue -------------------------------------------------------------------------------

const YT_STEPS = { download: 'Fetching from OneDrive', upload: 'Uploading', thumbnail: 'Setting thumbnail', playlist: 'Adding to playlist' };

export function YoutubePage() {
  const s = useStore();
  const { openLecture } = useApp();
  const { openSummary } = useContext(SummaryCtx);
  const [run] = useAction();
  const [order, setOrder] = useState([]);
  const chapters = useMemo(() => new Map(allChapters(s).map((c) => [c.module_id, c])), [s.catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  // The waiting order lives in the central; refreshed while this page is open.
  useEffect(() => {
    let alive = true;
    const load = () => api('GET', '/api/youtube').then((r) => alive && setOrder(r.queue || [])).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const yt = s.youtube || {};

  // Every lecture and summary video with a YouTube state, as one list.
  const items = [];
  for (const v of Object.values(s.videos)) {
    const l = s.catalog?.lectures[v.lecture_id];
    if (v.yt_status && l) items.push({ key: `lecture:${v.lecture_id}`, kind: 'lecture', id: v.lecture_id, v, title: `L${l.lecture_no}: ${l.lecture_title}`, where: `Class ${l.class_no} · ${l.subject} · Ch ${l.chapter_no}: ${l.chapter_title}`, open: () => openLecture(v.lecture_id) });
  }
  for (const v of Object.values(s.summaryVideos || {})) {
    const ch = chapters.get(v.module_id);
    if (v.yt_status && ch) items.push({ key: `summary:${v.module_id}`, kind: 'summary', id: v.module_id, v, title: `Chapter summary: ${ch.title}`, where: `Class ${ch.class_no} · ${ch.subject} · Ch ${ch.chapter_no}`, open: () => openSummary(v.module_id) });
  }
  const pos = (k) => { const i = order.indexOf(k); return i < 0 ? 1e9 : i; };
  const by = (st) => items.filter((x) => x.v.yt_status === st);
  const active = by('uploading');
  const waiting = by('queued').sort((a, b) => pos(a.key) - pos(b.key));
  const failed = by('failed');
  const done = by('done').sort((a, b) => new Date(b.v.yt_uploaded_at) - new Date(a.v.yt_uploaded_at));
  const retry = (x) => run(`r${x.key}`, () => api('POST', `/api/${x.kind === 'summary' ? 'summary-videos' : 'videos'}/${x.id}/youtube`), 'Queued for YouTube');
  const kindChip = (x) => <span className="chip chip-sm tone-gray">{x.kind === 'summary' ? 'Summary' : 'Lecture'}</span>;
  const titleCell = (x) => <td className="cell-title"><a className="link" onClick={x.open}>{x.title}</a><div className="muted small">{x.where}</div></td>;

  return (
    <div className="page">
      <div className="page-head"><div><h1>YouTube</h1><p className="muted">Videos sent with "Upload to YouTube", one at a time in this order: fetched from OneDrive, uploaded ({yt.privacy}{yt.kids === 'all' ? ', made for kids — comments off' : ''}), thumbnail, then the playlist. {yt.connected ? <>Channel: <a href={yt.channel?.url} target="_blank" rel="noreferrer">{yt.channel?.title}</a></> : <span className="t-amber">The channel is not connected (Source &amp; settings → YouTube).</span>}</p></div></div>
      {yt.error && <div className="alert alert-red"><AlertTriangle size={16} /><div>{yt.error}</div></div>}

      <Card title={`Uploading now (${active.length})`} pad={false}>
        {active.length ? (
          <table className="table"><tbody>
            {active.map((x) => {
              const p = x.v.yt?.step === 'upload' && x.v.yt.total ? Math.round((x.v.yt.done / x.v.yt.total) * 100) : null;
              return (
                <tr key={x.key}>
                  <td style={{ width: 90 }}>{kindChip(x)}</td>{titleCell(x)}
                  <td className="small">{YT_STEPS[x.v.yt?.step] || 'Starting'}</td>
                  <td style={{ width: 220 }}>{p != null ? <Progress value={p} /> : <span className="muted small">…</span>}</td>
                  <td className="small muted">{p != null ? `${p}% of ${fmtBytes(x.v.yt.total)}` : ''}</td>
                </tr>
              );
            })}
          </tbody></table>
        ) : <Empty Icon={Youtube} title="Nothing uploading">Use "Upload to YouTube" on a video in the Library.</Empty>}
      </Card>

      <Card title={`Waiting (${waiting.length})`} pad={false}>
        {waiting.length ? (
          <table className="table"><tbody>
            {waiting.map((x, i) => <tr key={x.key}><td style={{ width: 40 }} className="muted">{i + 1}</td><td style={{ width: 90 }}>{kindChip(x)}</td>{titleCell(x)}<td className="small muted">{fmtDur(x.v.duration_s)} · {fmtBytes(x.v.bytes)}</td></tr>)}
          </tbody></table>
        ) : <div className="muted small" style={{ padding: 16 }}>No videos waiting.</div>}
      </Card>

      {failed.length > 0 && (
        <Card title={`Failed (${failed.length})`} pad={false}>
          <table className="table"><tbody>
            {failed.map((x) => <tr key={x.key}><td style={{ width: 90 }}>{kindChip(x)}</td>{titleCell(x)}<td className="small t-red" style={{ maxWidth: 420 }}>{x.v.yt_error}</td><td><Btn size="sm" Icon={RotateCcw} onClick={() => retry(x)}>Retry</Btn></td></tr>)}
          </tbody></table>
        </Card>
      )}

      <Card title={`On YouTube (${done.length})`} pad={false}>
        {done.length ? (
          <table className="table"><tbody>
            {done.map((x) => (
              <tr key={x.key}>
                <td style={{ width: 90 }}>{kindChip(x)}</td>{titleCell(x)}
                <td className="small muted">{fmtAgo(x.v.yt_uploaded_at)}{x.v.yt_warning && <div className="t-amber" title={x.v.yt_warning}>warning</div>}</td>
                <td><div className="row-actions">
                  <a className="btn btn-default btn-sm" href={`https://youtu.be/${x.v.yt_video_id}`} target="_blank" rel="noreferrer"><Youtube size={13} /><span>Video</span></a>
                  {x.v.yt_playlist_id && <a className="btn btn-ghost btn-sm" href={`https://www.youtube.com/playlist?list=${x.v.yt_playlist_id}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /><span>Playlist</span></a>}
                </div></td>
              </tr>
            ))}
          </tbody></table>
        ) : <div className="muted small" style={{ padding: 16 }}>Nothing uploaded yet.</div>}
      </Card>
    </div>
  );
}

// ---- YouTube ---------------------------------------------------------------------------------------

function YoutubeCard() {
  const s = useStore();
  const [run, busy] = useAction();
  const { ask } = useToast();
  const yt = s.youtube || {};
  const vids = [...Object.values(s.videos), ...Object.values(s.summaryVideos || {})];
  const n = (x) => vids.filter((v) => v.yt_status === x).length;
  // Google sends the browser back to yt.redirect (a localhost address): the sign-in only
  // completes in a browser that reaches the central there, i.e. through the SSH tunnel.
  const local = typeof window !== 'undefined' && window.location.origin === new URL(yt.redirect || 'http://localhost:8080').origin;
  return (
    <Card title={<><Youtube size={16} /> YouTube</>}>
      {!yt.configured ? (
        <p className="muted small">Not set up: add <span className="mono">YOUTUBE_CLIENT_ID</span> and <span className="mono">YOUTUBE_CLIENT_SECRET</span> (the OAuth client of the Google Cloud project) to .env, then deploy.</p>
      ) : (
        <>
          <p className="muted small">"Upload to YouTube" on a finished video takes it from OneDrive, uploads it with its title, description and tags, sets the title slide as the thumbnail and adds it to its playlist: lectures to their chapter's playlist (in lecture order), summary videos to their subject's "Chapter Summaries" playlist (in chapter order).</p>
          {yt.error && <div className="alert alert-red"><AlertTriangle size={16} /><div>{yt.error}</div></div>}
          <dl className="kv">
            <dt>Channel</dt><dd>{yt.connected ? <><a href={yt.channel?.url} target="_blank" rel="noreferrer">{yt.channel?.title || yt.channel?.id} <ExternalLink size={12} /></a> · connected {fmtAgo(yt.connected_at)}</> : <span className="t-amber">not connected</span>}</dd>
            <dt>New videos are</dt><dd>{yt.privacy} <span className="muted small">(YOUTUBE_PRIVACY)</span></dd>
            <dt>Made for kids</dt><dd>{yt.kids === 'all' ? 'every class — comments off' : yt.kids === 'none' ? 'no' : `classes ${yt.kids} — comments off on those`} <span className="muted small">(YOUTUBE_KIDS_CLASSES)</span></dd>
            <dt>On YouTube</dt><dd>{n('done')}</dd>
            <dt>Uploading / waiting</dt><dd>{n('uploading') + n('queued')}</dd>
            <dt>Failed</dt><dd className={n('failed') ? 't-red' : ''}>{n('failed')}</dd>
          </dl>
          {!local && <div className="alert alert-amber"><AlertTriangle size={16} /><div>To connect, open the dashboard through the SSH tunnel (<span className="mono">ssh -L 8080:127.0.0.1:8080 factory-aws</span>, then <span className="mono">{new URL(yt.redirect || 'http://localhost:8080').origin}</span>): Google returns to that address after sign-in.</div></div>}
          <div className="row-actions">
            <a className={`btn btn-primary ${local ? '' : 'disabled'}`} href={local ? '/api/youtube/connect' : undefined} aria-disabled={!local}><Youtube size={15} /><span>{yt.connected ? 'Reconnect channel' : 'Connect channel'}</span></a>
            {yt.connected && <Btn variant="ghost" busy={busy === 'dis'} onClick={async () => {
              if (!(await ask({ title: 'Disconnect YouTube?', body: 'Uploads stop until the channel is connected again. Videos already on YouTube stay there.', ok: 'Disconnect', danger: true }))) return;
              run('dis', () => api('POST', '/api/youtube/disconnect'), 'YouTube disconnected');
            }}>Disconnect</Btn>}
          </div>
        </>
      )}
    </Card>
  );
}

// ---- Source + settings ----------------------------------------------------------------------------

export function SourcePage() {
  const s = useStore();
  const [run] = useAction();
  const { ask } = useToast();
  const sync = s.sync || {};
  const lectures = allLectures(s);
  const c = countLectures(s, lectures);
  const packs = {};
  for (const l of lectures) { const k = l.pack || 'none'; packs[k] = packs[k] || { total: 0, supported: l.supported }; packs[k].total++; }
  return (
    <div className="page">
      <div className="page-head"><div><h1>Source & settings</h1><p className="muted">Where lectures come from and where videos go.</p></div></div>
      <div className="grid-2">
        <Card title={<><Database size={16} /> Source data</>}>
          <p className="muted small">Lectures are read from a copy of the Prepzy database (<span className="mono">tutorai</span>) in the cluster's database pod. Copy it again after the course tables change.</p>
          <dl className="kv">
            <dt>Lectures in catalog</dt><dd>{c.total.toLocaleString()}</dd>
            <dt>With templates today</dt><dd>{c.supported.toLocaleString()}</dd>
            <dt>Last copied</dt><dd>{sync.last?.at ? `${new Date(sync.last.at).toLocaleString()} (${fmtAgo(sync.last.at)})` : 'never'}</dd>
            {sync.last?.counts && <><dt>Rows</dt><dd className="small">{Object.entries(sync.last.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}</dd></>}
          </dl>
          {sync.running && <div style={{ margin: '12px 0' }}><Progress value={sync.progress?.total ? ((sync.progress.tableIndex + sync.progress.done / sync.progress.total) / sync.progress.tables) * 100 : 5} striped /><div className="muted small">Copying {sync.progress?.table} · {sync.progress?.done ?? 0}/{sync.progress?.total ?? '?'}</div></div>}
          {sync.error && <div className="alert alert-red"><AlertTriangle size={16} /><div>{sync.error}</div></div>}
          <Btn variant="primary" Icon={RefreshCw} busy={sync.running} onClick={async () => {
            if (await ask({ title: 'Copy the source database again?', body: 'Reads classes, courses, modules, lectures and textbook_raw from the prepzy-mysql container on this PC. Production keeps running.', ok: 'Copy now' })) run('sync', () => api('POST', '/api/sync'), 'Copy started');
          }}>Copy from prepzy-mysql</Btn>
        </Card>
        <StorageCard />
        <YoutubeCard />
      </div>
      <Card title={<><Layers size={16} /> Template packs</>} pad={false}>
        <table className="table">
          <thead><tr><th>Pack</th><th>Lectures</th><th>Status</th></tr></thead>
          <tbody>{Object.entries(packs).sort((a, b) => b[1].total - a[1].total).map(([k, p]) => (
            <tr key={k}><td className="cell-title">{k === 'none' ? 'Not assigned' : k}</td><td>{p.total}</td><td>{p.supported ? <span className="pill pill-green">Ready</span> : <span className="pill pill-gray">Pack not added yet</span>}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
