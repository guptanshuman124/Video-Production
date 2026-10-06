// Summary videos: one ~1-hour revision video per chapter, made from all of its
// lectures at once (src/summary/), with its own queue and library folder.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { PlayCircle, Pause, Play, RotateCcw, ChevronsUp, XCircle, RefreshCw, Trash2, PlusCircle, Clapperboard, Search, BookOpen, CircleSlash, AlertTriangle, CheckCircle2, Loader2, Circle, CircleDot, Cloud, FolderOpen, ExternalLink, Download, CloudUpload } from 'lucide-react';
import { api, allChapters, countSummaries, summaryStatus, summaryStageLabel, SUMMARY_STAGES, useStore, useTick } from '../store.js';
import { Btn, Card, Drawer, Empty, Modal, Progress, StackBar, StatusChip, ActivityLog, fmtAgo, fmtBytes, fmtDur, fmtElapsed, fmtMin, pct, useAction, useToast } from '../components/ui.jsx';
import { StorageBadge, CostBreakdown, YoutubeButton } from '../components/lecture.jsx';

export const SummaryCtx = createContext({ openSummary: () => {}, playSummary: () => {} });
const useSummaryApp = () => useContext(SummaryCtx);

function useSummaryActions() {
  const [run, busy] = useAction();
  const { ask } = useToast();
  return {
    busy,
    queue: (ids) => run(`q${ids}`, () => api('POST', '/api/summaries/queue', { scope: { module_ids: ids } }), (r) => (r.queued ? `Queued ${r.queued} summary video${r.queued > 1 ? 's' : ''}` : 'Nothing new to queue')),
    queueScope: (scope, what) => run(`qs${JSON.stringify(scope)}`, () => api('POST', '/api/summaries/queue', { scope }), (r) => (r.queued
      ? `Queued ${r.queued} summary video${r.queued > 1 ? 's' : ''} from ${what}`
      : `Nothing to queue in ${what}${r.skipped.failed ? ` · ${r.skipped.failed} need attention` : ''}${r.skipped.done ? ` · ${r.skipped.done} already made` : ''}`)),
    retry: (id, from) => run(`r${id}`, () => api('POST', `/api/summaries/${id}/retry`, { from }), from ? `Retrying from ${summaryStageLabel(from)}` : 'Retrying from the failed stage'),
    next: (id) => run(`n${id}`, () => api('POST', `/api/summaries/${id}/next`), 'Moved to the front of the queue'),
    regenerate: async (id) => {
      if (!(await ask({ title: 'Make this summary again from scratch?', body: 'The outline, slides, narration, voice and video are made again. The current video stays until the new one passes validation.', ok: 'Regenerate' }))) return;
      return run(`g${id}`, () => api('POST', `/api/summaries/${id}/retry`, { fresh: true }), 'Queued for regeneration');
    },
    cancel: async (id, running) => {
      if (running && !(await ask({ title: 'Stop this summary video?', body: 'The worker stops now. Finished stages are kept, so queueing it again resumes from there.', ok: 'Stop', danger: true }))) return;
      return run(`c${id}`, () => api('POST', `/api/summaries/${id}/cancel`), running ? 'Stopping…' : 'Removed from the queue');
    },
    removeVideo: async (id) => {
      if (!(await ask({ title: 'Delete this summary video?', body: 'The file is removed from the library (and SharePoint). You can make it again later.', ok: 'Delete video', danger: true }))) return;
      return run(`d${id}`, () => api('DELETE', `/api/summary-videos/${id}`), 'Summary video deleted');
    },
  };
}

function SummaryButtons({ ch, withLabels = false }) {
  const s = useStore();
  const { openSummary, playSummary } = useSummaryApp();
  const a = useSummaryActions();
  const st = summaryStatus(s, ch);
  const id = ch.module_id;
  const L = (t) => (withLabels ? t : null);
  return (
    <div className="row-actions">
      {s.summaryVideos[id] && <Btn size="sm" variant="ghost" Icon={Play} onClick={() => playSummary(id)} title="Play">{L('Play')}</Btn>}
      {st === 'idle' && <Btn size="sm" Icon={PlusCircle} busy={a.busy === `q${[id]}`} onClick={() => a.queue([id])}>Create summary</Btn>}
      {st === 'queued' && <Btn size="sm" variant="ghost" Icon={ChevronsUp} onClick={() => a.next(id)} title="Run next">{L('Run next')}</Btn>}
      {st === 'failed' && <Btn size="sm" variant="ghost" Icon={RotateCcw} onClick={() => a.retry(id)} title="Retry from the failed stage">{L('Retry')}</Btn>}
      {(st === 'queued' || st === 'running' || st === 'rendering') && <Btn size="sm" variant="ghost" Icon={XCircle} onClick={() => a.cancel(id, st !== 'queued')} title={st === 'queued' ? 'Remove from queue' : 'Stop'}>{L(st === 'queued' ? 'Remove' : 'Stop')}</Btn>}
      {st === 'done' && <Btn size="sm" variant="ghost" Icon={RefreshCw} onClick={() => a.regenerate(id)} title="Regenerate">{L('Regenerate')}</Btn>}
      {st !== 'unsupported' && <Btn size="sm" variant="ghost" onClick={() => openSummary(id)}>Details</Btn>}
    </div>
  );
}

const FILTERS = [['all', 'All'], ['idle', 'Not made'], ['queued', 'Queued'], ['running', 'Running'], ['failed', 'Needs attention'], ['done', 'Ready']];

export function SummariesPage({ classNo }) {
  const s = useStore();
  const [run, busy] = useAction();
  const a = useSummaryActions();
  const chapters = useMemo(() => allChapters(s), [s.catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const classes = s.catalog?.classes || [];
  const cls = classes.find((c) => c.class_no === classNo) || classes[0];
  const [subject, setSubject] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  useTick(2000);
  const all = countSummaries(s, chapters);
  if (!cls) return <div className="page"><Empty Icon={Clapperboard} title="No chapters in the catalog yet" /></div>;
  const inClass = chapters.filter((c) => c.class_no === cls.class_no);
  const subj = cls.subjects.find((x) => x.subject === subject) || cls.subjects.find((x) => inClass.some((c) => c.subject === x.subject && c.supported)) || cls.subjects[0];
  const list = inClass.filter((c) => c.subject === subj.subject);
  const c = countSummaries(s, list);
  const failed = all.failed;
  const matches = (ch) => {
    const st = summaryStatus(s, ch);
    const f = filter === 'all' || st === filter || (filter === 'running' && ['running', 'rendering', 'validating', 'cancelling'].includes(st));
    return f && (!q || ch.title.toLowerCase().includes(q.toLowerCase()));
  };
  const books = [...new Set(list.map((x) => x.book))];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Summary videos</h1>
          <p className="muted">One revision video per chapter (~1 hour), made from all of the chapter's lectures at once, in the dark theme. Its own queue and library folder: <span className="mono">{s.summaryRoot}</span>.</p>
        </div>
        <div className="head-actions">
          {s.summaryQueue === 'paused'
            ? <Btn Icon={Play} onClick={() => run('res', () => api('POST', '/api/summaries/resume'), 'Summary queue resumed')}>Resume summaries</Btn>
            : <Btn Icon={Pause} onClick={() => run('pause', () => api('POST', '/api/summaries/pause'), 'Summary queue paused — running summaries finish, nothing new starts')}>Pause summaries</Btn>}
          <Btn Icon={RotateCcw} disabled={!failed} busy={busy === 'rf'} onClick={() => run('rf', () => api('POST', '/api/summaries/retry-failed', { scope: {} }), (r) => `Retrying ${r.retried} summary video(s)`)}>Retry failed ({failed})</Btn>
        </div>
      </div>

      <div className="class-summary">
        <StackBar c={all} height={12} />
        <div className="legend">
          <span><i className="lg-done" />Ready {all.done}</span><span><i className="lg-running" />Running {all.running}</span>
          <span><i className="lg-queued" />Queued {all.queued}</span><span><i className="lg-failed" />Needs attention {all.failed}</span>
          <span><i className="lg-idle" />Not made {all.idle}</span>
          <span className="muted">{fmtMin(all.minutes)} of summary video · {pct(all.done, all.supported)}% of {all.supported} chapters</span>
          {s.summaryQueue === 'paused' && <span className="pill pill-amber">Summary queue paused</span>}
        </div>
      </div>

      <div className="tabs">
        {classes.map((x) => {
          const n = countSummaries(s, chapters.filter((ch) => ch.class_no === x.class_no));
          return (
            <a key={x.class_no} href={`#/summaries/${x.class_no}`} className={`tab ${x.class_no === cls.class_no ? 'active' : ''}`}>
              {x.name}<span className="tab-count">{n.supported ? `${n.done}/${n.supported}` : '—'}</span>
            </a>
          );
        })}
      </div>
      <div className="tabs tabs-sub">
        {cls.subjects.map((x) => {
          const n = countSummaries(s, inClass.filter((ch) => ch.subject === x.subject));
          return (
            <button key={x.subject} className={`tab ${subj.subject === x.subject ? 'active' : ''} ${n.supported ? '' : 'tab-off'}`} onClick={() => setSubject(x.subject)}>
              {x.subject}<span className="tab-count">{n.supported ? `${n.done}/${n.supported}` : '—'}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <div className="seg">{FILTERS.map(([k, t]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}</button>)}</div>
        <div className="search"><Search size={15} /><input placeholder="Search chapters" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn variant="primary" size="sm" Icon={PlayCircle} disabled={!c.idle} onClick={() => a.queueScope({ class_no: cls.class_no, subject: subj.subject }, `${cls.name} ${subj.subject}`)}>Create all {subj.subject} summaries</Btn>
      </div>

      {books.map((b) => {
        const rows = list.filter((x) => x.book === b && matches(x));
        if (!rows.length) return null;
        return (
          <div key={b} className="book">
            {books.length > 1 && <div className="book-head"><BookOpen size={16} /><h3>{b}</h3></div>}
            <Card pad={false}>
              <table className="table">
                <thead><tr><th style={{ width: 70 }}>Ch</th><th>Chapter</th><th style={{ width: 280 }}>Progress</th><th style={{ width: 150 }}>Status</th><th /></tr></thead>
                <tbody>{rows.map((ch) => <SummaryRow key={ch.module_id} ch={ch} />)}</tbody>
              </table>
            </Card>
          </div>
        );
      })}
      {!list.some(matches) && <Card><Empty Icon={Clapperboard} title="No chapters match" /></Card>}
    </div>
  );
}

function SummaryRow({ ch }) {
  const s = useStore();
  const { openSummary } = useSummaryApp();
  const st = summaryStatus(s, ch);
  const j = s.summaries[ch.module_id];
  const v = s.summaryVideos[ch.module_id];
  return (
    <tr className={`clickable st-${st}`} onClick={() => st !== 'unsupported' && openSummary(ch.module_id)}>
      <td className="muted">{ch.chapter_no}</td>
      <td><div className="cell-title">{ch.title}</div><div className="muted small">{ch.lectures} lecture{ch.lectures === 1 ? '' : 's'}{ch.pack ? ` · ${ch.pack}` : ''}</div></td>
      <td>
        {['running', 'rendering', 'validating'].includes(st) ? (
          <div className="l-progress"><Progress value={j.progress} striped height={5} /><span className="muted small">{summaryStageLabel(j.stage)}{st === 'rendering' && j.stages?.render?.count ? ` · ${j.stages.render.done}/${j.stages.render.count} pieces` : ''} · {Math.round(j.progress)}%</span></div>
        ) : st === 'failed' ? (
          <span className="t-red small" title={j.error_message}>{summaryStageLabel(j.error_stage)}: {j.error_code === 'GATE_FAILED' ? 'gate failed' : String(j.error_code || '').toLowerCase().replace('_', ' ')}</span>
        ) : st === 'done' ? <span className="muted small">{fmtDur(v?.duration_s)}{v?.parts ? ` · ${v.parts} parts` : ''}</span>
          : st === 'unsupported' ? <span className="unsupported"><CircleSlash size={14} /> {ch.why}</span> : null}
      </td>
      <td><StatusChip status={st} small /></td>
      <td onClick={(e) => e.stopPropagation()}>{st !== 'unsupported' && <SummaryButtons ch={ch} />}</td>
    </tr>
  );
}

const STEP_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: AlertTriangle, active: Loader2, pending: Circle, running: Loader2 };

export function SummaryDrawer({ id, onClose }) {
  const s = useStore();
  const { playSummary } = useSummaryApp();
  const a = useSummaryActions();
  const [detail, setDetail] = useState(null);
  const [openStage, setOpenStage] = useState(null);
  const [from, setFrom] = useState('');
  useTick(1000);
  const chapters = useMemo(() => allChapters(s), [s.catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const ch = chapters.find((x) => x.module_id === id);
  const job = s.summaries[id];
  const video = s.summaryVideos[id];
  useEffect(() => {
    let alive = true;
    const load = () => api('GET', `/api/summaries/${id}`).then((d) => alive && setDetail(d)).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [id, job?.status, job?.stage]);
  if (!ch) return null;
  const st = summaryStatus(s, ch);
  const stages = job?.stages || detail?.job?.stages || {};
  return (
    <Drawer open onClose={onClose} width={700}>
      <div className="drawer-head">
        <div className="crumbs">Class {ch.class_no} · {ch.subject}{ch.multiBook ? ` · ${ch.book}` : ''} · Chapter {ch.chapter_no}</div>
        <h2>Chapter {ch.chapter_no} summary: {ch.title}</h2>
        <div className="drawer-sub">all {ch.lectures} lectures · <span className="mono">module #{id}</span> · pack {ch.pack || '—'}</div>
        <div className="drawer-status">
          <StatusChip status={st} />
          {job?.worker && ['running', 'validating'].includes(st) && <span className="muted">on <b>{job.worker}</b> · {fmtElapsed(job.started_at)}</span>}
          {job?.attempts > 0 && <span className="muted">attempt {job.attempts}</span>}
        </div>
        {['running', 'rendering', 'validating'].includes(st) && <div style={{ marginTop: 12 }}><Progress value={job.progress} striped /><div className="muted small" style={{ marginTop: 6 }}>{summaryStageLabel(job.stage)} · {Math.round(job.progress)}%{stages.render?.count ? ` · ${stages.render.done}/${stages.render.count} pieces rendered across the workers` : stages.render?.frames && job.stage === 'render' ? ` · frame ${stages.render.frames}/${stages.render.total}` : ''}</div></div>}
      </div>

      {st === 'failed' && job && (
        <div className="alert alert-red">
          <AlertTriangle size={18} />
          <div>
            <b>{job.error_code === 'GATE_FAILED' ? `Stopped at ${summaryStageLabel(job.error_stage)} — a validation gate failed after automatic repair` : job.error_code === 'VIDEO_INVALID' ? 'The video failed final validation' : job.error_code === 'WORKER_LOST' ? 'The worker stopped responding' : 'The worker crashed'}</b>
            <pre className="err">{detail?.job?.error_message || job.error_message}</pre>
          </div>
        </div>
      )}

      <div className="drawer-actions">
        {video && <Btn variant="primary" Icon={Play} onClick={() => playSummary(id)}>Play video</Btn>}
        {st === 'idle' && <Btn variant="primary" Icon={PlusCircle} onClick={() => a.queue([id])}>Create summary</Btn>}
        {st === 'queued' && <><Btn Icon={ChevronsUp} onClick={() => a.next(id)}>Run next</Btn><Btn Icon={XCircle} onClick={() => a.cancel(id, false)}>Remove from queue</Btn></>}
        {(st === 'running' || st === 'rendering') && <Btn variant="danger" Icon={XCircle} onClick={() => a.cancel(id, true)}>Stop</Btn>}
        {st === 'failed' && <Btn variant="primary" Icon={RotateCcw} onClick={() => a.retry(id)}>Retry failed stage</Btn>}
        {st === 'failed' && (
          <div className="inline-select">
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Redo from stage…</option>
              {SUMMARY_STAGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <Btn disabled={!from} Icon={RotateCcw} onClick={() => a.retry(id, from)}>Run</Btn>
          </div>
        )}
        {(st === 'done' || st === 'failed') && <Btn Icon={RefreshCw} onClick={() => a.regenerate(id)}>Regenerate</Btn>}
        {video && <Btn variant="ghost" Icon={Trash2} onClick={() => a.removeVideo(id)}>Delete video</Btn>}
      </div>

      {video && (
        <div className="video-meta">
          {video.storage === 'onedrive' ? <Cloud size={15} /> : <FolderOpen size={15} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="video-meta-top">
              <StorageBadge v={video} provider={s.storage?.provider} />
              {video.remote_url && <a className="link small" href={video.remote_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open in SharePoint</a>}
              {video.storage === 'failed' && <Btn size="sm" Icon={CloudUpload} onClick={() => api('POST', `/api/summary-videos/${id}/upload`)}>Retry upload</Btn>}
              <YoutubeButton id={id} v={video} size="sm" summary />
            </div>
            <div className="mono small">{video.storage === 'onedrive' ? `${s.storage?.site || 'SharePoint'} › ${s.storage?.library || 'Documents'} › ${s.roots.summaries}/${video.path}` : `${s.roots.summaries}/${video.path}`}</div>
            {video.storage === 'failed' && video.remote_error && <div className="t-red small">{video.remote_error}</div>}
            {video.yt_status === 'failed' && video.yt_error && <div className="t-red small">YouTube: {video.yt_error}</div>}
            {video.yt_status === 'done' && video.yt_warning && <div className="t-amber small">YouTube: {video.yt_warning}</div>}
            <div className="muted small">{fmtDur(video.duration_s)} · {fmtBytes(video.bytes)} · {video.slides ?? '—'} slides in {video.parts ?? '—'} parts · made {fmtAgo(video.created_at)}</div>
          </div>
        </div>
      )}

      {detail?.cost && <CostBreakdown cost={detail.cost} />}

      <h4 className="section-title">Pipeline</h4>
      <ol className="timeline">
        {SUMMARY_STAGES.map((x) => {
          const r = stages[x.id];
          let state = r?.status || 'pending';
          if (job?.status === 'done' && !r) state = 'pass';
          if (state === 'running' && job?.stage !== x.id && !x.perPart) state = 'pending';
          if (x.id === job?.stage && ['running', 'rendering', 'validating'].includes(job?.status) && state !== 'pass' && state !== 'warn') state = 'active';
          if (st === 'failed' && job?.error_stage === x.id) state = 'fail';
          const Icon = STEP_ICON[state] || CircleDot;
          const list = r?.part_issues?.length ? r.part_issues : r?.issues || [];
          const parts = Object.entries(r?.parts || r?.pieces || {});
          return (
            <li key={x.id} className={`tl tl-${state}`}>
              <button className="tl-row" onClick={() => setOpenStage(openStage === x.id ? null : x.id)} disabled={!list.length}>
                <Icon size={16} className={state === 'active' ? 'spin' : ''} />
                <span className="tl-label">{x.label}</span>
                <span className="tl-gate">{x.gate}</span>
                <span className="tl-meta">
                  {parts.length > 0 && <span className="part-dots">{parts.sort(([p], [q]) => Number(String(p).replace(/\D/g, '')) - Number(String(q).replace(/\D/g, ''))).map(([p, v]) => <span key={p} className={`sd ${v === 'running' ? 'active' : v}`} title={`${/^\d+$/.test(p) ? `piece ${Number(p) + 1}` : p}: ${v}`} />)}</span>}
                  {r?.errors ? <span className="t-red">{r.errors} error{r.errors > 1 ? 's' : ''}</span> : null}
                  {r?.warnings ? <span className="t-amber">{r.warnings} warning{r.warnings > 1 ? 's' : ''}</span> : null}
                  {x.id === 'render' && r?.frames && state === 'active' ? <span className="muted">{Math.round((r.frames / r.total) * 100)}%</span> : null}
                </span>
              </button>
              {openStage === x.id && list.length > 0 && (
                <ul className="issues">
                  {list.map((i, k) => <li key={k} className={`issue issue-${i.severity}`}>{i.part && <span className="mono">{i.part} </span>}<span className="mono">{i.code}</span> {i.message}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <ActivityLog events={detail?.events} />
    </Drawer>
  );
}

export function SummaryPlayer({ id, onClose }) {
  const s = useStore();
  const { openSummary } = useSummaryApp();
  const ch = allChapters(s).find((x) => x.module_id === id);
  const v = s.summaryVideos[id];
  if (!ch || !v) return null;
  return (
    <Modal open onClose={onClose} wide>
      <div className="player">
        <video src={`/api/summary-videos/${id}/file`} controls autoPlay playsInline />
        <div className="player-info">
          <div>
            <div className="crumbs">Class {ch.class_no} · {ch.subject} · Chapter {ch.chapter_no}</div>
            <h3>Chapter summary: {ch.title}</h3>
            <div className="muted small">{fmtDur(v.duration_s)} · {fmtBytes(v.bytes)} · {v.parts ?? '—'} parts · <span className="mono">{v.path}</span></div>
          </div>
          <div className="row-actions">
            <StorageBadge v={v} provider={s.storage?.provider} />
            {v.remote_url && <a className="btn btn-default" href={v.remote_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /><span>SharePoint</span></a>}
            <YoutubeButton id={id} v={v} summary />
            <a className="btn btn-default" href={`/api/summary-videos/${id}/file`} download={`${v.path.split('/').pop()}`}><Download size={15} /><span>Download</span></a>
            <Btn onClick={() => { onClose(); openSummary(id); }}>Details</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
