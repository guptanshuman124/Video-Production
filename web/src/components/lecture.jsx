import { createContext, useContext, useEffect, useState } from 'react';
import { Play, RotateCcw, RefreshCw, XCircle, ChevronsUp, PlusCircle, Trash2, FolderOpen, AlertTriangle, CheckCircle2, CircleDot, Loader2, Circle, Download } from 'lucide-react';
import { api, STAGES, lectureStatus, stageLabel, useStore, useTick } from '../store.js';
import { Btn, Drawer, Modal, Progress, StatusChip, fmtAgo, fmtDur, fmtBytes, fmtElapsed, fmtUsd, useAction, useToast } from './ui.jsx';

// The library path as it looks on this PC (Windows paths use backslashes).
const BS = String.fromCharCode(92);
export const hostPath = (root, rel) => (root?.includes(BS) ? `${root}${BS}${rel.replaceAll('/', BS)}` : `${root}/${rel}`);

// Open the lecture drawer / the player from anywhere.
export const AppCtx = createContext({ openLecture: () => {}, play: () => {} });
export const useApp = () => useContext(AppCtx);

export function useLectureActions() {
  const [run, busy] = useAction();
  const { ask } = useToast();
  return {
    busy,
    queue: (ids, label = 'lecture') => run(`q${ids}`, () => api('POST', '/api/queue', { scope: { lecture_ids: ids } }), (r) => (r.queued ? `Queued ${r.queued} ${label}${r.queued > 1 ? 's' : ''}` : 'Nothing new to queue')),
    queueScope: (scope, what) => run(`qs${JSON.stringify(scope)}`, () => api('POST', '/api/queue', { scope }), (r) => (r.queued
      ? `Queued ${r.queued} lecture${r.queued > 1 ? 's' : ''} from ${what}`
      : `Nothing to queue in ${what}${r.skipped.failed ? ` · ${r.skipped.failed} need attention (retry them there)` : ''}${r.skipped.done ? ` · ${r.skipped.done} already done` : ''}`)),
    retry: (id, from) => run(`r${id}`, () => api('POST', `/api/jobs/${id}/retry`, { from }), from ? `Retrying from ${stageLabel(from)}` : 'Retrying from the failed stage'),
    retryNext: (id) => run(`rn${id}`, () => api('POST', `/api/jobs/${id}/retry`, { next: true }), 'Retrying next'),
    regenerate: async (id) => {
      if (!(await ask({ title: 'Regenerate this lecture from scratch?', body: 'Slides, narration, voice and video are made again. The current video stays in the library until the new one passes validation.', ok: 'Regenerate' }))) return;
      return run(`g${id}`, () => api('POST', `/api/jobs/${id}/retry`, { fresh: true }), 'Queued for regeneration');
    },
    next: (id) => run(`n${id}`, () => api('POST', `/api/jobs/${id}/next`), 'Moved to the front of the queue'),
    cancel: async (id, running) => {
      if (running && !(await ask({ title: 'Stop this lecture?', body: 'The worker stops now. Finished stages are kept, so queueing it again resumes from there.', ok: 'Stop', danger: true }))) return;
      return run(`c${id}`, () => api('POST', `/api/jobs/${id}/cancel`), running ? 'Stopping…' : 'Removed from the queue');
    },
    removeVideo: async (id) => {
      if (!(await ask({ title: 'Delete this video?', body: 'The file is removed from the library folder. You can make it again later.', ok: 'Delete video', danger: true }))) return;
      return run(`d${id}`, () => api('DELETE', `/api/videos/${id}`), 'Video deleted');
    },
  };
}

// The buttons that make sense for a lecture in its current state.
export function LectureButtons({ id, size = 'sm', showDetails = true, withLabels = false }) {
  const s = useStore();
  const { openLecture, play } = useApp();
  const a = useLectureActions();
  const st = lectureStatus(s, id);
  const hasVideo = !!s.videos[id];
  const L = (t) => (withLabels ? t : null);
  return (
    <div className="row-actions">
      {hasVideo && <Btn size={size} variant="ghost" Icon={Play} onClick={() => play(id)} title="Play">{L('Play')}</Btn>}
      {st === 'idle' && <Btn size={size} variant="ghost" Icon={PlusCircle} busy={a.busy === `q${[id]}`} onClick={() => a.queue([id])} title="Add to queue">{L('Queue')}</Btn>}
      {st === 'queued' && <Btn size={size} variant="ghost" Icon={ChevronsUp} onClick={() => a.next(id)} title="Run next">{L('Run next')}</Btn>}
      {st === 'failed' && <Btn size={size} variant="ghost" Icon={RotateCcw} busy={a.busy === `r${id}`} onClick={() => a.retry(id)} title="Retry from the failed stage">{L('Retry')}</Btn>}
      {(st === 'queued' || st === 'running') && <Btn size={size} variant="ghost" Icon={XCircle} onClick={() => a.cancel(id, st === 'running')} title={st === 'running' ? 'Stop' : 'Remove from queue'}>{L(st === 'running' ? 'Stop' : 'Remove')}</Btn>}
      {st === 'done' && <Btn size={size} variant="ghost" Icon={RefreshCw} onClick={() => a.regenerate(id)} title="Regenerate">{L('Regenerate')}</Btn>}
      {showDetails && <Btn size={size} variant="ghost" onClick={() => openLecture(id)}>Details</Btn>}
    </div>
  );
}

const STEP_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: AlertTriangle, active: Loader2, pending: Circle, running: Loader2 };

export function LectureDrawer({ id, onClose }) {
  const s = useStore();
  const { play } = useApp();
  const a = useLectureActions();
  const [detail, setDetail] = useState(null);
  const [openStage, setOpenStage] = useState(null);
  const [from, setFrom] = useState('');
  useTick(1000);
  const job = s.jobs[id];
  const lec = s.catalog?.lectures[id];
  const video = s.videos[id];
  const st = lectureStatus(s, id);

  useEffect(() => {
    let alive = true;
    const load = () => api('GET', `/api/jobs/${id}`).then((d) => alive && setDetail(d)).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [id, job?.status, job?.stage]);

  if (!lec) return null;
  const stages = job?.stages || detail?.job?.stages || {};
  const issues = (sid) => stages[sid]?.issues || [];
  return (
    <Drawer open onClose={onClose} width={680}>
      <div className="drawer-head">
        <div className="crumbs">Class {lec.class_no} · {lec.subject}{lec.book !== lec.subject ? ` · ${lec.book}` : ''} · Chapter {lec.chapter_no}</div>
        <h2>Lecture {lec.lecture_no}: {lec.lecture_title}</h2>
        <div className="drawer-sub">{lec.chapter_title} · lecture {lec.lecture_no} of {lec.lecture_count} · <span className="mono">#{id}</span> · pack {lec.pack || '—'}</div>
        <div className="drawer-status">
          <StatusChip status={st} />
          {job?.worker && ['running', 'validating'].includes(st) && <span className="muted">on <b>{job.worker}</b> · {fmtElapsed(job.started_at)}</span>}
          {job?.attempts > 0 && <span className="muted">attempt {job.attempts}</span>}
          {job?.cost_usd > 0 && <span className="muted">LLM {fmtUsd(job.cost_usd)}</span>}
        </div>
        {['running', 'validating'].includes(st) && <div style={{ marginTop: 12 }}><Progress value={job.progress} striped /><div className="muted small" style={{ marginTop: 6 }}>{stageLabel(job.stage)} · {Math.round(job.progress)}%{stages.render?.frames && job.stage === 'render' ? ` · frame ${stages.render.frames}/${stages.render.total}` : ''}</div></div>}
      </div>

      {st === 'failed' && job && (
        <div className="alert alert-red">
          <AlertTriangle size={18} />
          <div>
            <b>{job.error_code === 'GATE_FAILED' ? `Stopped at ${stageLabel(job.error_stage)} — a validation gate failed after automatic repair` : job.error_code === 'VIDEO_INVALID' ? 'The video failed final validation' : job.error_code === 'WORKER_LOST' ? 'The worker stopped responding' : 'The worker crashed'}</b>
            <pre className="err">{detail?.job?.error_message || job.error_message}</pre>
          </div>
        </div>
      )}

      <div className="drawer-actions">
        {video && <Btn variant="primary" Icon={Play} onClick={() => play(id)}>Play video</Btn>}
        {st === 'idle' && <Btn variant="primary" Icon={PlusCircle} onClick={() => a.queue([id])}>Add to queue</Btn>}
        {st === 'queued' && <><Btn Icon={ChevronsUp} onClick={() => a.next(id)}>Run next</Btn><Btn Icon={XCircle} onClick={() => a.cancel(id, false)}>Remove from queue</Btn></>}
        {st === 'running' && <Btn variant="danger" Icon={XCircle} onClick={() => a.cancel(id, true)}>Stop</Btn>}
        {st === 'failed' && <><Btn variant="primary" Icon={RotateCcw} onClick={() => a.retry(id)}>Retry failed stage</Btn><Btn Icon={ChevronsUp} onClick={() => a.retryNext(id)}>Retry next in queue</Btn></>}
        {st === 'failed' && (   /* a finished lecture's working files are deleted, so it can only be regenerated */
          <div className="inline-select">
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Redo from stage…</option>
              {STAGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <Btn disabled={!from} Icon={RotateCcw} onClick={() => a.retry(id, from)}>Run</Btn>
          </div>
        )}
        {(st === 'done' || st === 'failed') && <Btn Icon={RefreshCw} onClick={() => a.regenerate(id)}>Regenerate</Btn>}
        {video && <Btn variant="ghost" Icon={Trash2} onClick={() => a.removeVideo(id)}>Delete video</Btn>}
      </div>

      {video && (
        <div className="video-meta">
          <FolderOpen size={15} />
          <div><div className="mono small">{hostPath(s.library, video.path)}</div><div className="muted small">{fmtDur(video.duration_s)} · {fmtBytes(video.bytes)} · {video.slides ?? '—'} slides · made {fmtAgo(video.created_at)}</div></div>
        </div>
      )}

      <h4 className="section-title">Pipeline</h4>
      <ol className="timeline">
        {STAGES.map((x) => {
          const r = stages[x.id];
          let state = r?.status || 'pending';
          if (job?.status === 'done' && !r) state = 'pass';
          if (state === 'running' && job?.stage !== x.id) state = 'pending';
          if (x.id === job?.stage && ['running', 'validating'].includes(job?.status) && state !== 'pass' && state !== 'warn') state = 'active';
          if (st === 'failed' && job?.error_stage === x.id) state = 'fail';
          const Icon = STEP_ICON[state] || CircleDot;
          const list = issues(x.id);
          return (
            <li key={x.id} className={`tl tl-${state}`}>
              <button className="tl-row" onClick={() => setOpenStage(openStage === x.id ? null : x.id)} disabled={!list.length}>
                <Icon size={16} className={state === 'active' ? 'spin' : ''} />
                <span className="tl-label">{x.label}</span>
                <span className="tl-gate">{x.gate}</span>
                <span className="tl-meta">
                  {r?.errors ? <span className="t-red">{r.errors} error{r.errors > 1 ? 's' : ''}</span> : null}
                  {r?.warnings ? <span className="t-amber">{r.warnings} warning{r.warnings > 1 ? 's' : ''}</span> : null}
                  {r?.attempts > 1 ? <span className="muted">{r.attempts} attempts</span> : null}
                  {x.id === 'render' && r?.frames && state === 'active' ? <span className="muted">{Math.round((r.frames / r.total) * 100)}%</span> : null}
                </span>
              </button>
              {openStage === x.id && list.length > 0 && (
                <ul className="issues">
                  {list.map((i, k) => <li key={k} className={`issue issue-${i.severity}`}><span className="mono">{i.code}</span> {i.message}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <h4 className="section-title">Activity</h4>
      <div className="log">
        {(detail?.events || []).slice().reverse().map((e, k) => (
          <div key={k} className={`log-line lv-${e.level}`}>
            <span className="log-time">{new Date(e.at).toLocaleTimeString()}</span>
            {e.stage && <span className="log-stage">{e.stage}</span>}
            <span className="log-msg">{e.message}</span>
          </div>
        ))}
        {!detail?.events?.length && <div className="muted small">Nothing yet.</div>}
      </div>
    </Drawer>
  );
}

export function PlayerModal({ id, onClose }) {
  const s = useStore();
  const lec = s.catalog?.lectures[id];
  const v = s.videos[id];
  const { openLecture } = useApp();
  if (!lec || !v) return null;
  return (
    <Modal open onClose={onClose} wide>
      <div className="player">
        <video src={`/api/videos/${id}/file`} controls autoPlay playsInline />
        <div className="player-info">
          <div>
            <div className="crumbs">Class {lec.class_no} · {lec.subject} · Chapter {lec.chapter_no}: {lec.chapter_title}</div>
            <h3>Lecture {lec.lecture_no}: {lec.lecture_title}</h3>
            <div className="muted small">{fmtDur(v.duration_s)} · {fmtBytes(v.bytes)} · <span className="mono">{v.path}</span></div>
          </div>
          <div className="row-actions">
            <a className="btn btn-default" href={`/api/videos/${id}/file`} download={`${v.path.split('/').pop()}`}><Download size={15} /><span>Download</span></a>
            <Btn onClick={() => { onClose(); openLecture(id); }}>Details</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
