import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, GraduationCap, ListOrdered, AlertTriangle, Film, Server, Database, Wifi, WifiOff, Loader2, Clapperboard, Youtube } from 'lucide-react';
import { allLectures, countLectures, allChapters, countSummaries, useStore } from './store.js';
import { ToastProvider } from './components/ui.jsx';
import { AppCtx, LectureDrawer, PlayerModal } from './components/lecture.jsx';
import Overview from './pages/Overview.jsx';
import { ClassesPage, ClassDetail } from './pages/Classes.jsx';
import { QueuePage, AttentionPage, LibraryPage, WorkersPage, SourcePage, YoutubePage } from './pages/Other.jsx';
import { SummariesPage, SummaryDrawer, SummaryPlayer, SummaryCtx } from './pages/Summaries.jsx';

function useHash() {
  const [h, set] = useState(window.location.hash || '#/');
  useEffect(() => { const f = () => { set(window.location.hash || '#/'); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h.replace(/^#/, '') || '/';
}

function Sidebar({ route }) {
  const s = useStore();
  const c = useMemo(() => countLectures(s, allLectures(s)), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const online = (s.workers.workers || []).filter((w) => w.online).length;
  const sc = useMemo(() => countSummaries(s, allChapters(s)), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const ytAll = [...Object.values(s.videos), ...Object.values(s.summaryVideos || {})];
  const ytBusy = ytAll.filter((v) => v.yt_status === 'queued' || v.yt_status === 'uploading').length;
  const ytFailed = ytAll.filter((v) => v.yt_status === 'failed').length;
  const items = [
    ['/', 'Overview', LayoutDashboard],
    ['/classes', 'Classes', GraduationCap],
    ['/queue', 'Queue', ListOrdered, c.queued + c.running || null, 'violet'],
    ['/attention', 'Needs attention', AlertTriangle, c.failed || null, 'red'],
    ['/library', 'Library', Film, c.done || null, 'green'],
    ['/summaries', 'Summary videos', Clapperboard, sc.queued + sc.running || null, 'violet'],
    ...(s.youtube?.configured ? [['/youtube', 'YouTube', Youtube, ytBusy || ytFailed || null, ytFailed && !ytBusy ? 'red' : 'violet']] : []),
    ['/workers', 'Workers', Server, online || null, 'blue'],
    ['/source', 'Source & settings', Database],
  ];
  return (
    <nav className="sidebar">
      <div className="brand"><span className="brand-mark">▶</span><div><div className="brand-name">Lecture Factory</div><div className="brand-sub">CBSE · Hinglish video</div></div></div>
      <div className="nav">
        {items.map(([path, label, Icon, badge, tone]) => {
          const active = path === '/' ? route === '/' : route.startsWith(path);
          return (
            <a key={path} href={`#${path}`} className={`nav-item ${active ? 'active' : ''}`}>
              <Icon size={17} /><span>{label}</span>{badge ? <span className={`nav-badge nb-${tone}`}>{badge.toLocaleString()}</span> : null}
            </a>
          );
        })}
      </div>
      <div className="nav-classes">
        <div className="nav-caption">Classes</div>
        {(s.catalog?.classes || []).map((cl) => (
          <a key={cl.class_no} href={`#/classes/${cl.class_no}`} className={`nav-class ${route === `/classes/${cl.class_no}` ? 'active' : ''}`}>
            <span>{cl.name}</span>{s.queues[cl.class_no] === 'paused' && <span className="dot dot-amber" title="paused" />}
          </a>
        ))}
      </div>
      <div className={`conn ${s.connected ? 'ok' : 'off'}`}>{s.connected ? <Wifi size={14} /> : <WifiOff size={14} />}{s.connected ? 'Live' : 'Reconnecting…'}</div>
    </nav>
  );
}

export default function App() {
  const s = useStore();
  const route = useHash();
  const [lecture, setLecture] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [summary, setSummary] = useState(null);
  const [playingSummary, setPlayingSummary] = useState(null);
  const ctx = useMemo(() => ({ openLecture: setLecture, play: setPlaying }), []);
  const sctx = useMemo(() => ({ openSummary: setSummary, playSummary: setPlayingSummary }), []);

  let page;
  const m = /^\/classes\/(\d+)/.exec(route);
  const sm = /^\/summaries(?:\/(\d+))?/.exec(route);
  if (!s.ready) {
    page = <div className="boot">{s.error ? <><WifiOff size={28} /><div>Can't reach the central service — retrying…</div><div className="muted small">{s.error}</div></> : <><Loader2 className="spin" size={28} /><div>Loading…</div></>}</div>;
  } else if (m) page = <ClassDetail classNo={Number(m[1])} />;
  else if (route.startsWith('/classes')) page = <ClassesPage />;
  else if (route.startsWith('/queue')) page = <QueuePage />;
  else if (route.startsWith('/attention')) page = <AttentionPage />;
  else if (route.startsWith('/library')) page = <LibraryPage />;
  else if (sm) page = <SummariesPage classNo={sm[1] ? Number(sm[1]) : null} />;
  else if (route.startsWith('/workers')) page = <WorkersPage />;
  else if (route.startsWith('/youtube')) page = <YoutubePage />;
  else if (route.startsWith('/source')) page = <SourcePage />;
  else page = <Overview />;

  return (
    <ToastProvider>
      <AppCtx.Provider value={ctx}><SummaryCtx.Provider value={sctx}>
        <div className="app">
          <Sidebar route={route} />
          <main className="main">
            {s.ready && s.catalog && !s.catalog.classes.length && (
              <div className="alert alert-amber"><Database size={16} /><div>No lectures in the catalog yet. {s.sync?.running ? 'The source database is being copied…' : <>Copy the source data on <a href="#/source">Source & settings</a>.</>}</div></div>
            )}
            {page}
          </main>
        </div>
        {lecture && <LectureDrawer id={lecture} onClose={() => setLecture(null)} />}
        {playing && <PlayerModal id={playing} onClose={() => setPlaying(null)} />}
        {summary && <SummaryDrawer id={summary} onClose={() => setSummary(null)} />}
        {playingSummary && <SummaryPlayer id={playingSummary} onClose={() => setPlayingSummary(null)} />}
      </SummaryCtx.Provider></AppCtx.Provider>
    </ToastProvider>
  );
}
