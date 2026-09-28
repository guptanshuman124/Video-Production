import { useMemo } from 'react';
import { Film, Timer, Cpu, ListOrdered, AlertTriangle, Wallet, Play, Pause, PlayCircle, ChevronRight, Server, Radio } from 'lucide-react';
import { api, allLectures, countLectures, lectureStatus, queuedInOrder, stageLabel, useStore, useTick } from '../store.js';
import { Btn, Card, Empty, Progress, StackBar, StageDots, Stat, fmtAgo, fmtElapsed, fmtMin, fmtUsd, pct, useAction } from '../components/ui.jsx';
import { useApp } from '../components/lecture.jsx';

export function WorkerCard({ w }) {
  const s = useStore();
  const { openLecture } = useApp();
  const job = w.lecture_id ? s.jobs[w.lecture_id] : null;
  const lec = w.lecture_id ? s.catalog?.lectures[w.lecture_id] : null;
  const busy = w.online && job && ['running', 'validating', 'cancelling'].includes(job.status);
  return (
    <div className={`worker ${busy ? 'busy' : w.online ? 'idle' : 'offline'}`} onClick={() => busy && openLecture(w.lecture_id)}>
      <div className="worker-head">
        <span className={`dot ${busy ? 'dot-blue pulse' : w.online ? 'dot-green' : 'dot-gray'}`} />
        <span className="worker-name mono">{w.name.replace(/^worker-/, '')}</span>
        <span className="worker-state">{busy ? fmtElapsed(job.started_at) : w.online ? 'Idle' : 'Offline'}</span>
      </div>
      {busy && lec ? (
        <>
          <div className="worker-lec">
            <div className="crumbs">Class {lec.class_no} · {lec.subject} · Ch {lec.chapter_no}</div>
            <div className="worker-title">L{lec.lecture_no} · {lec.lecture_title}</div>
          </div>
          <Progress value={job.progress} striped />
          <div className="worker-foot"><span>{stageLabel(job.stage)}</span><span>{Math.round(job.progress)}%</span></div>
          <StageDots job={job} compact />
        </>
      ) : (
        <div className="worker-empty">{w.online ? 'Waiting for the next lecture' : `Last seen ${fmtAgo(w.last_seen)}`}</div>
      )}
      <div className="worker-stats"><span>{w.jobs_done} made</span>{w.jobs_failed > 0 && <span className="t-red">{w.jobs_failed} failed</span>}</div>
    </div>
  );
}

export function ClassRow({ cls, counts, state }) {
  const [run, busy] = useAction();
  const running = state !== 'paused' && (counts.running || counts.queued);
  const label = counts.supported === 0 ? 'No templates yet' : state === 'paused' ? 'Paused' : counts.running ? 'In production' : counts.queued ? 'Queued' : counts.done === counts.supported ? 'Complete' : counts.done ? 'Partly done' : 'Not started';
  return (
    <div className="classrow">
      <a className="classrow-name" href={`#/classes/${cls.class_no}`}>
        <span className="class-badge">{cls.class_no}</span>
        <div>
          <div className="classrow-title">{cls.name}</div>
          <div className="muted small">{cls.subjects.map((x) => x.subject).slice(0, 4).join(' · ')}{cls.subjects.length > 4 ? ` +${cls.subjects.length - 4}` : ''}</div>
        </div>
      </a>
      <div className="classrow-bar">
        <StackBar c={counts} height={10} />
        <div className="classrow-legend">
          <span><b>{counts.done}</b>/{counts.supported} ready</span>
          {counts.running > 0 && <span className="t-blue">{counts.running} running</span>}
          {counts.queued > 0 && <span className="t-violet">{counts.queued} queued</span>}
          {counts.failed > 0 && <span className="t-red">{counts.failed} need attention</span>}
          {counts.total > counts.supported && <span className="muted">{counts.total - counts.supported} awaiting templates</span>}
        </div>
      </div>
      <div className="classrow-state"><span className={`pill ${state === 'paused' ? 'pill-amber' : running ? 'pill-blue' : 'pill-gray'}`}>{label}</span></div>
      <div className="classrow-actions">
        {state === 'paused'
          ? <Btn size="sm" Icon={Play} busy={busy === 'r'} onClick={() => run('r', () => api('POST', `/api/classes/${cls.class_no}/resume`), `${cls.name} resumed`)}>Resume</Btn>
          : running
            ? <Btn size="sm" Icon={Pause} busy={busy === 'p'} onClick={() => run('p', () => api('POST', `/api/classes/${cls.class_no}/pause`), `${cls.name} paused — running lectures finish, nothing new starts`)}>Pause</Btn>
            : <Btn size="sm" variant="primary" Icon={PlayCircle} disabled={!counts.idle} busy={busy === 's'} onClick={() => run('s', () => api('POST', '/api/queue', { scope: { class_no: cls.class_no }, start: true }), (r) => `Queued ${r.queued} lecture(s) of ${cls.name}`)}>Start</Btn>}
        <a className="icon-btn" href={`#/classes/${cls.class_no}`} aria-label="Open"><ChevronRight size={18} /></a>
      </div>
    </div>
  );
}

export default function Overview() {
  const s = useStore();
  const { openLecture } = useApp();
  useTick(1000);
  const lectures = allLectures(s);
  const totals = useMemo(() => countLectures(s, lectures), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const perClass = useMemo(() => Object.fromEntries((s.catalog?.classes || []).map((c) => [c.class_no, countLectures(s, lectures.filter((l) => l.class_no === c.class_no))])), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const spend = Object.values(s.jobs).reduce((a, j) => a + (j.cost_usd || 0), 0);
  const queue = queuedInOrder(s);
  const workers = s.workers.workers || [];
  const online = workers.filter((w) => w.online);
  const recent = Object.values(s.videos).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  const rate = (() => {
    const day = Date.now() - 86400e3;
    return Object.values(s.videos).filter((v) => new Date(v.created_at).getTime() > day).length;
  })();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">CBSE lecture videos, class by class. Start a class to queue its lectures; {online.length || 'no'} worker{online.length === 1 ? '' : 's'} produce them {online.length > 1 ? 'in parallel' : ''}.</p>
        </div>
      </div>

      <div className="stats">
        <Stat Icon={Film} label="Videos ready" value={totals.done.toLocaleString()} sub={`${pct(totals.done, totals.supported)}% of ${totals.supported.toLocaleString()} with templates`} tone="green" />
        <Stat Icon={Timer} label="Hours produced" value={fmtMin(totals.minutes)} sub={`${rate} video${rate === 1 ? '' : 's'} in the last 24 h`} />
        <Stat Icon={Cpu} label="In production" value={totals.running} sub={`${online.length} worker${online.length === 1 ? '' : 's'} online`} tone="blue" />
        <Stat Icon={ListOrdered} label="Queued" value={totals.queued.toLocaleString()} sub={queue[0] ? `next: Class ${s.catalog.lectures[queue[0].lecture_id]?.class_no}` : 'queue empty'} tone="violet" />
        <Stat Icon={AlertTriangle} label="Needs attention" value={totals.failed} sub={totals.failed ? <a href="#/attention">Review and retry →</a> : 'all clear'} tone={totals.failed ? 'red' : undefined} />
        <Stat Icon={Wallet} label="LLM spend" value={fmtUsd(spend)} sub={totals.done ? `${fmtUsd(spend / Math.max(1, totals.done + totals.failed))} per lecture` : 'content + review'} />
      </div>

      <Card title={<><Server size={16} /> Workers</>} actions={<a className="link" href="#/workers">Manage →</a>}>
        {workers.length ? <div className="workers">{workers.map((w) => <WorkerCard key={w.name} w={w} />)}</div>
          : <Empty Icon={Server} title="No workers connected">Workers appear here when their pods start. Check the Workers page.</Empty>}
      </Card>

      <div className="grid-2">
        <Card title="Classes" actions={<a className="link" href="#/classes">All classes →</a>} pad={false}>
          <div className="classrows">
            {(s.catalog?.classes || []).map((c) => <ClassRow key={c.class_no} cls={c} counts={perClass[c.class_no]} state={s.queues[c.class_no]} />)}
          </div>
        </Card>
        <div className="stack">
          <Card title={<><ListOrdered size={16} /> Up next</>} actions={<a className="link" href="#/queue">Queue →</a>} pad={false}>
            {queue.length ? (
              <ul className="mini-list">
                {queue.slice(0, 7).map((j, i) => {
                  const l = s.catalog.lectures[j.lecture_id];
                  const paused = s.queues[l?.class_no] === 'paused';
                  return (
                    <li key={j.lecture_id} onClick={() => openLecture(j.lecture_id)}>
                      <span className="mini-n">{i + 1}</span>
                      <div className="mini-main"><div className="mini-title">{l?.lecture_title}</div><div className="muted small">Class {l?.class_no} · {l?.subject} · Ch {l?.chapter_no} · L{l?.lecture_no}{paused ? ' · paused' : ''}{j.priority > 0 ? ' · priority' : ''}</div></div>
                    </li>
                  );
                })}
                {queue.length > 7 && <li className="mini-more">+ {queue.length - 7} more</li>}
              </ul>
            ) : <Empty Icon={ListOrdered} title="Queue is empty">Start a class to queue its lectures.</Empty>}
          </Card>
          <Card title={<><Radio size={16} /> Live activity</>} pad={false}>
            <ul className="feed">
              {s.activity.slice(0, 12).map((e, i) => {
                const l = s.catalog?.lectures[e.lecture_id];
                return (
                  <li key={i} className={`lv-${e.level}`} onClick={() => openLecture(e.lecture_id)}>
                    <span className="feed-dot" />
                    <div><div className="feed-msg">{e.message}</div><div className="muted small">{l ? `C${l.class_no} ${l.subject} · Ch${l.chapter_no} L${l.lecture_no}` : `#${e.lecture_id}`} · {fmtAgo(e.at)}</div></div>
                  </li>
                );
              })}
              {!s.activity.length && <li className="muted small" style={{ padding: 16 }}>No activity yet.</li>}
            </ul>
          </Card>
        </div>
      </div>

      {recent.length > 0 && (
        <Card title={<><Film size={16} /> Recently finished</>} actions={<a className="link" href="#/library">Library →</a>}>
          <div className="recent">
            {recent.map((v) => {
              const l = s.catalog?.lectures[v.lecture_id];
              return l && <RecentVideo key={v.lecture_id} l={l} v={v} />;
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function RecentVideo({ l, v }) {
  const { play } = useApp();
  return (
    <button className="vcard" onClick={() => play(l.lecture_id)}>
      <div className="vthumb"><span className="vplay"><Play size={18} /></span><span className="vdur">{Math.round(v.duration_s / 60)} min</span><span className="vclass">Class {l.class_no}</span></div>
      <div className="vtitle">{l.lecture_title}</div>
      <div className="muted small">{l.subject} · Ch {l.chapter_no} · L{l.lecture_no} · {fmtAgo(v.created_at)}</div>
    </button>
  );
}

export { RecentVideo, lectureStatus };
