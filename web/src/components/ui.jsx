import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Loader2, Clock, CircleDashed, Ban, CircleSlash, Info } from 'lucide-react';
import { STAGES } from '../store.js';

// ---- formatting ---------------------------------------------------------------------------

export const fmtMin = (m) => (m >= 60 ? `${(m / 60).toFixed(m >= 600 ? 0 : 1)} h` : `${Math.round(m)} min`);
export const fmtDur = (s) => { if (!s && s !== 0) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
export const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round((b || 0) / 1e6)} MB`);
export const fmtUsd = (x) => `$${(x || 0).toFixed((x || 0) < 10 ? 2 : 0)}`;
export function fmtAgo(t) {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}
export function fmtElapsed(t) {
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---- status ---------------------------------------------------------------------------------

export const STATUS = {
  done: { label: 'Ready', tone: 'green', Icon: CheckCircle2 },
  running: { label: 'In production', tone: 'blue', Icon: Loader2, spin: true },
  validating: { label: 'Validating', tone: 'blue', Icon: Loader2, spin: true },
  cancelling: { label: 'Cancelling', tone: 'amber', Icon: Loader2, spin: true },
  rendering: { label: 'Rendering', tone: 'blue', Icon: Loader2, spin: true },
  queued: { label: 'Queued', tone: 'violet', Icon: Clock },
  failed: { label: 'Needs attention', tone: 'red', Icon: AlertTriangle },
  idle: { label: 'Not started', tone: 'gray', Icon: CircleDashed },
  unsupported: { label: 'Template pack pending', tone: 'muted', Icon: CircleSlash },
  cancelled: { label: 'Cancelled', tone: 'gray', Icon: Ban },
};
export function StatusChip({ status, small }) {
  const s = STATUS[status] || STATUS.idle;
  return (
    <span className={`chip tone-${s.tone} ${small ? 'chip-sm' : ''}`}>
      <s.Icon size={small ? 12 : 13} className={s.spin ? 'spin' : ''} />{s.label}
    </span>
  );
}

// Stacked bar: done / running / queued / failed out of the lectures that can be made.
export function StackBar({ c, height = 8, of = 'supported' }) {
  const total = c[of] || 1;
  const seg = (n, cls) => (n ? <span className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <div className="stackbar" style={{ height }}>
      {seg(c.done, 'sb-done')}{seg(c.running, 'sb-running')}{seg(c.queued, 'sb-queued')}{seg(c.failed, 'sb-failed')}
    </div>
  );
}

export function Progress({ value, tone = 'blue', height = 6, striped }) {
  return (
    <div className="progress" style={{ height }}>
      <span className={`pr-${tone} ${striped ? 'striped' : ''}`} style={{ width: `${Math.max(2, Math.min(100, value || 0))}%` }} />
    </div>
  );
}

// Ten pipeline steps as dots: passed / warned / running / failed / pending.
export function StageDots({ job, compact }) {
  const st = job?.stages || {};
  const cur = job?.stage;
  const failedAt = job?.status === 'failed' ? job.error_stage : null;
  return (
    <div className={`stagedots ${compact ? 'compact' : ''}`}>
      {STAGES.map((s) => {
        const r = st[s.id];
        let cls = 'pending';
        if (r?.status === 'pass') cls = 'pass';
        else if (r?.status === 'warn') cls = 'warn';
        else if (r?.status === 'fail' || failedAt === s.id) cls = 'fail';
        else if (job?.status === 'done') cls = 'pass';
        else if (s.id === cur && ['running', 'validating'].includes(job?.status)) cls = 'active';
        return <span key={s.id} className={`sd ${cls}`} title={`${s.label} (${s.gate})${r?.status ? ` · ${r.status}` : ''}${r?.errors ? ` · ${r.errors} errors` : ''}${r?.warnings ? ` · ${r.warnings} warnings` : ''}`} />;
      })}
    </div>
  );
}

export function Stat({ label, value, sub, tone, Icon }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-top">{Icon && <span className="stat-icon"><Icon size={16} /></span>}<span className="stat-label">{label}</span></div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Btn({ children, variant = 'default', size, Icon, busy, ...p }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''}`} disabled={busy || p.disabled} {...p}>
      {busy ? <Loader2 size={14} className="spin" /> : Icon ? <Icon size={size === 'sm' ? 13 : 15} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Empty({ Icon = Info, title, children }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <header className="card-head"><h3>{title}</h3><div className="card-actions">{actions}</div></header>}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

// The activity log of a lecture or summary: a tall, resizable box with an Expand toggle.
export function ActivityLog({ events }) {
  const [tall, setTall] = useState(false);
  const list = (events || []).slice().reverse();
  return (
    <>
      <h4 className="section-title with-action">Activity <button className="link small" onClick={() => setTall(!tall)}>{tall ? 'Collapse' : `Expand (${list.length})`}</button></h4>
      <div className={`log ${tall ? 'tall' : ''}`}>
        {list.map((e, k) => (
          <div key={k} className={`log-line lv-${e.level}`}>
            <span className="log-time">{new Date(e.at).toLocaleTimeString()}</span>
            {e.stage && <span className="log-stage">{e.stage}</span>}
            <span className="log-msg">{e.message}</span>
          </div>
        ))}
        {!list.length && <div className="muted small">Nothing yet.</div>}
      </div>
    </>
  );
}

// ---- overlays -------------------------------------------------------------------------------

export function Drawer({ open, onClose, children, width = 620 }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <aside className="drawer" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {children}
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, children, wide }) {
  useEffect(() => {
    // Capture phase: a focused <video> would otherwise swallow Escape.
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="overlay center" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {children}
      </div>
    </div>
  );
}

// ---- toasts + confirm ---------------------------------------------------------------------------

const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const push = useCallback((msg, tone = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const ask = useCallback((opts) => new Promise((resolve) => setConfirm({ ...opts, resolve })), []);
  return (
    <ToastCtx.Provider value={{ push, ask }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.tone === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<span>{t.msg}</span></div>)}
      </div>
      <Modal open={!!confirm} onClose={() => { confirm?.resolve(false); setConfirm(null); }}>
        {confirm && (
          <div className="confirm">
            <h3>{confirm.title}</h3>
            {confirm.body && <p>{confirm.body}</p>}
            <div className="confirm-actions">
              <Btn onClick={() => { confirm.resolve(false); setConfirm(null); }}>Cancel</Btn>
              <Btn variant={confirm.danger ? 'danger' : 'primary'} onClick={() => { confirm.resolve(true); setConfirm(null); }}>{confirm.ok || 'Confirm'}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Runs an action with a toast for its result.
export function useAction() {
  const { push } = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) push(typeof ok === 'function' ? ok(r) : ok); return r; } catch (e) { push(e.message, 'error'); return null; } finally { setBusy(null); }
  }, [push]);
  return [run, busy];
}
