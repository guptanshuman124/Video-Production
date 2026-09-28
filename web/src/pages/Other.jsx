import { useMemo, useState } from 'react';
import { Pause, Play, ChevronsUp, XCircle, RotateCcw, AlertTriangle, Film, Search, Server, Minus, Plus, Database, RefreshCw, FolderOpen, CheckCircle2, Layers, Cloud, CloudUpload, ExternalLink } from 'lucide-react';
import { api, allLectures, countLectures, lectureStatus, queuedInOrder, stageLabel, useStore, useTick } from '../store.js';
import { Btn, Card, Empty, Progress, StageDots, StatusChip, fmtAgo, fmtBytes, fmtDur, fmtElapsed, fmtMin, useAction, useToast } from '../components/ui.jsx';
import { LectureButtons, useApp, useLectureActions, StorageBadge } from '../components/lecture.jsx';
import { WorkerCard, RecentVideo } from './Overview.jsx';

// ---- Queue ----------------------------------------------------------------------------------

export function QueuePage() {
  const s = useStore();
  const { openLecture } = useApp();
  const a = useLectureActions();
  const [run] = useAction();
  useTick(1000);
  const running = Object.values(s.jobs).filter((j) => ['running', 'validating', 'cancelling'].includes(j.status));
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

export function LibraryPage() {
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
        <div><h1>Library</h1><p className="muted">{vids.length} videos · {fmtMin(total / 60)} · {fmtBytes(bytes)} · {s.storage?.provider === 'onedrive' ? <>stored on OneDrive: <span className="mono">{s.storage.site} › {s.storage.library} › {s.storage.root}</span>{s.storage.rootUrl && <> · <a href={s.storage.rootUrl} target="_blank" rel="noreferrer">open</a></>}</> : <>stored in <span className="mono">{s.library}</span></>}</p></div>
        <div className="head-actions">
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
                      <td onClick={(e) => e.stopPropagation()}><Btn size="sm" variant="ghost" onClick={() => openLecture(l.lecture_id)}>Details</Btn></td>
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
  const { workers = [], scale, k8s } = s.workers;
  const online = workers.filter((w) => w.online);
  const desired = scale?.desired ?? online.length;
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
      {k8s && desired > 4 && <div className="alert alert-amber"><AlertTriangle size={16} /><div>More than 4 parallel renders may exceed the memory Docker Desktop gives Kubernetes (8 GB by default). Watch for workers restarting.</div></div>}
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
          <pre className="path">{st.root || 'CBSE Lectures'}/Class 10/Science/Chapter 1 - Chemical Reactions and Equations/Lecture 3 - Types of Chemical Reactions.mp4</pre>
          <Btn Icon={CloudUpload} disabled={!n('failed') && !n('local')} busy={busy === 'up'} onClick={() => run('up', () => api('POST', '/api/uploads/retry'), (r) => `Uploading ${r.queued} video(s)`)}>Retry failed uploads</Btn>
        </>
      ) : (
        <>
          <p className="muted small">OneDrive is not configured (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SHAREPOINT_SITE_URL in .env, then <span className="mono">npm run factory -- deploy</span>). Videos are saved on this PC as</p>
          <pre className="path">{s.library}\Class 10\Science\Chapter 1 - Chemical Reactions and Equations\Lecture 3 - Types of Chemical Reactions.mp4</pre>
        </>
      )}
      <p className="muted small">Subjects with more than one book (e.g. Physics Part I / Part II) get a book folder between subject and chapter, because chapter numbers restart in each book.</p>
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
