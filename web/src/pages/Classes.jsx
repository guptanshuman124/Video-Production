import { useMemo, useState } from 'react';
import { PlayCircle, Pause, Play, RotateCcw, ListX, ChevronDown, ChevronRight, BookOpen, CircleSlash, Search } from 'lucide-react';
import { api, allLectures, countLectures, lectureStatus, stageLabel, useStore } from '../store.js';
import { Btn, Card, Progress, StackBar, StatusChip, fmtDur, fmtMin, pct, useAction, useToast } from '../components/ui.jsx';
import { LectureButtons, useApp, useLectureActions } from '../components/lecture.jsx';

export function ClassesPage() {
  const s = useStore();
  const lectures = allLectures(s);
  const per = useMemo(() => Object.fromEntries((s.catalog?.classes || []).map((c) => [c.class_no, countLectures(s, lectures.filter((l) => l.class_no === c.class_no))])), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page">
      <div className="page-head"><div><h1>Classes</h1><p className="muted">Each class has its own queue. Open a class to start it, or pick subjects, chapters and single lectures.</p></div></div>
      <div className="classgrid">
        {(s.catalog?.classes || []).map((c) => {
          const n = per[c.class_no];
          const state = s.queues[c.class_no];
          return (
            <a key={c.class_no} className="classcard" href={`#/classes/${c.class_no}`}>
              <div className="classcard-top">
                <span className="class-badge lg">{c.class_no}</span>
                <span className={`pill ${state === 'paused' ? 'pill-amber' : n.running || n.queued ? 'pill-blue' : n.supported && n.done === n.supported ? 'pill-green' : 'pill-gray'}`}>
                  {state === 'paused' ? 'Paused' : n.running ? `${n.running} running` : n.queued ? `${n.queued} queued` : n.supported && n.done === n.supported ? 'Complete' : 'Idle'}
                </span>
              </div>
              <h3>{c.name}</h3>
              <div className="muted small">{c.subjects.length} subjects · {n.total} lectures</div>
              <div className="ring-row">
                <div className="big-pct">{pct(n.done, n.supported)}<span>%</span></div>
                <div className="muted small">{n.done} of {n.supported} ready<br />{fmtMin(n.minutes)} of video</div>
              </div>
              <StackBar c={n} />
              <div className="subj-tags">
                {c.subjects.map((x) => {
                  const ok = lectures.some((l) => l.class_no === c.class_no && l.subject === x.subject && l.supported);
                  return <span key={x.subject} className={`tag ${ok ? '' : 'tag-off'}`}>{x.subject}</span>;
                })}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function ClassDetail({ classNo }) {
  const s = useStore();
  const { ask } = useToast();
  const [run, busy] = useAction();
  const cls = s.catalog?.classes.find((c) => c.class_no === classNo);
  const [subject, setSubject] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const lectures = allLectures(s).filter((l) => l.class_no === classNo);
  const counts = countLectures(s, lectures);
  if (!cls) return <div className="page"><p className="muted">Loading…</p></div>;
  const subj = cls.subjects.find((x) => x.subject === subject) || cls.subjects.find((x) => lectures.some((l) => l.subject === x.subject && l.supported)) || cls.subjects[0];
  const state = s.queues[classNo];
  const scope = { class_no: classNo };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs"><a href="#/classes">Classes</a> / {cls.name}</div>
          <h1>{cls.name}</h1>
          <p className="muted">{counts.done} of {counts.supported} lectures ready · {fmtMin(counts.minutes)} of video{counts.total > counts.supported ? ` · ${counts.total - counts.supported} lectures wait for their subject templates` : ''}</p>
        </div>
        <div className="head-actions">
          <Btn variant="primary" Icon={PlayCircle} disabled={!counts.idle} busy={busy === 'start'} onClick={() => run('start', () => api('POST', '/api/queue', { scope, start: true }), (r) => `Queued ${r.queued} lecture(s) of ${cls.name}`)}>Start {cls.name}</Btn>
          {state === 'paused'
            ? <Btn Icon={Play} onClick={() => run('res', () => api('POST', `/api/classes/${classNo}/resume`), 'Queue resumed')}>Resume queue</Btn>
            : <Btn Icon={Pause} onClick={() => run('pause', () => api('POST', `/api/classes/${classNo}/pause`), 'Queue paused — running lectures finish, nothing new starts')}>Pause queue</Btn>}
          <Btn Icon={RotateCcw} disabled={!counts.failed} onClick={() => run('rf', () => api('POST', '/api/retry-failed', { scope }), (r) => `Retrying ${r.retried} lecture(s)`)}>Retry failed ({counts.failed})</Btn>
          <Btn Icon={ListX} disabled={!counts.queued} onClick={async () => {
            if (await ask({ title: `Clear the ${cls.name} queue?`, body: `${counts.queued} queued lectures go back to "Not started". Running lectures are not stopped.`, ok: 'Clear queue', danger: true })) {
              run('clr', () => api('POST', '/api/unqueue', { scope }), (r) => `Removed ${r.removed} from the queue`);
            }
          }}>Clear queue</Btn>
        </div>
      </div>

      <div className="class-summary">
        <StackBar c={counts} height={12} />
        <div className="legend">
          <span><i className="lg-done" />Ready {counts.done}</span><span><i className="lg-running" />Running {counts.running}</span>
          <span><i className="lg-queued" />Queued {counts.queued}</span><span><i className="lg-failed" />Needs attention {counts.failed}</span>
          <span><i className="lg-idle" />Not started {counts.idle}</span>
          {state === 'paused' && <span className="pill pill-amber">Queue paused</span>}
        </div>
      </div>

      <div className="tabs">
        {cls.subjects.map((x) => {
          const ls = lectures.filter((l) => l.subject === x.subject);
          const c = countLectures(s, ls);
          return (
            <button key={x.subject} className={`tab ${subj.subject === x.subject ? 'active' : ''} ${c.supported ? '' : 'tab-off'}`} onClick={() => setSubject(x.subject)}>
              {x.subject}<span className="tab-count">{c.supported ? `${c.done}/${c.supported}` : '—'}</span>
            </button>
          );
        })}
      </div>

      <SubjectView cls={cls} subj={subj} filter={filter} setFilter={setFilter} q={q} setQ={setQ} />
    </div>
  );
}

const FILTERS = [['all', 'All'], ['idle', 'Not started'], ['queued', 'Queued'], ['running', 'Running'], ['failed', 'Needs attention'], ['done', 'Ready']];

function SubjectView({ cls, subj, filter, setFilter, q, setQ }) {
  const s = useStore();
  const a = useLectureActions();
  const lectures = allLectures(s).filter((l) => l.class_no === cls.class_no && l.subject === subj.subject);
  const c = countLectures(s, lectures);
  const matches = (l) => {
    const st = lectureStatus(s, l.lecture_id);
    const f = filter === 'all' || st === filter || (filter === 'running' && ['running', 'validating', 'cancelling'].includes(st));
    return f && (!q || `${l.lecture_title} ${l.chapter_title}`.toLowerCase().includes(q.toLowerCase()));
  };
  return (
    <>
      <div className="toolbar">
        <div className="seg">{FILTERS.map(([k, t]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}</button>)}</div>
        <div className="search"><Search size={15} /><input placeholder="Search chapters and lectures" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn variant="primary" size="sm" Icon={PlayCircle} disabled={!c.idle} onClick={() => a.queueScope({ class_no: cls.class_no, subject: subj.subject }, `${subj.subject}`)}>Queue all {subj.subject}</Btn>
      </div>
      {subj.books.map((b) => (
        <div key={b.course_id} className="book">
          {subj.books.length > 1 && <div className="book-head"><BookOpen size={16} /><h3>{b.title}</h3></div>}
          {b.chapters.map((ch) => <Chapter key={ch.module_id} ch={ch} matches={matches} filtered={filter !== 'all' || !!q} />)}
        </div>
      ))}
    </>
  );
}

function Chapter({ ch, matches, filtered }) {
  const s = useStore();
  const a = useLectureActions();
  const [open, setOpen] = useState(false);
  const lectures = ch.lectures.map((x) => s.catalog.lectures[x.lecture_id]);
  const shown = lectures.filter(matches);
  const c = countLectures(s, lectures);
  if (filtered && !shown.length) return null;
  const isOpen = open || filtered;
  return (
    <div className={`chapter ${ch.supported ? '' : 'chapter-off'}`}>
      <div className="chapter-head" onClick={() => setOpen(!open)}>
        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span className="ch-no">Ch {ch.no}</span>
        <div className="ch-title">{ch.title}<div className="muted small">{ch.lectures.length} lectures{ch.pack ? ` · ${ch.pack}` : ''}{ch.pack_review ? ' · pack guessed — check' : ''}</div></div>
        {ch.supported ? (
          <>
            <div className="ch-bar"><StackBar c={c} /><span className="muted small">{c.done}/{c.supported} ready{c.running ? ` · ${c.running} running` : ''}{c.queued ? ` · ${c.queued} queued` : ''}{c.failed ? ` · ${c.failed} failed` : ''}</span></div>
            <div onClick={(e) => e.stopPropagation()} className="row-actions">
              <Btn size="sm" Icon={PlayCircle} disabled={!c.idle} onClick={() => a.queueScope({ module_id: ch.module_id }, `Chapter ${ch.no}`)}>Queue chapter</Btn>
            </div>
          </>
        ) : <span className="unsupported"><CircleSlash size={14} /> {ch.why}</span>}
      </div>
      {isOpen && (
        <div className="lecture-rows">
          {shown.map((l) => <LectureRow key={l.lecture_id} l={l} />)}
        </div>
      )}
    </div>
  );
}

function LectureRow({ l }) {
  const s = useStore();
  const { openLecture } = useApp();
  const st = lectureStatus(s, l.lecture_id);
  const j = s.jobs[l.lecture_id];
  const v = s.videos[l.lecture_id];
  return (
    <div className={`lrow st-${st}`}>
      <span className="l-no">L{l.lecture_no}</span>
      <button className="l-title" onClick={() => openLecture(l.lecture_id)}>{l.lecture_title}</button>
      <div className="l-state">
        {['running', 'validating'].includes(st) ? (
          <div className="l-progress"><Progress value={j.progress} striped height={5} /><span className="muted small">{stageLabel(j.stage)} · {Math.round(j.progress)}%</span></div>
        ) : st === 'failed' ? (
          <span className="t-red small" title={j.error_message}>{stageLabel(j.error_stage)}: {j.error_code === 'GATE_FAILED' ? 'gate failed' : j.error_code?.toLowerCase().replace('_', ' ')}</span>
        ) : st === 'done' ? <span className="muted small">{fmtDur(v?.duration_s)}</span> : null}
      </div>
      <StatusChip status={st} small />
      {st !== 'unsupported' ? <LectureButtons id={l.lecture_id} showDetails={false} /> : <span />}
    </div>
  );
}
