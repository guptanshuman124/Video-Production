// Brand components shared by every template: import { … } from 'hvr/shared'.
//
// Animation vocabulary for the whole deck:
//   header + slide title  fade in at the start, fade out at the end
//   content blocks        riseIn (fade + rise) staggered, riseOut at the end
//   image panels          panelIn, fade out at the end
// Every component takes anim/exit props to override.

import { Rich, rich } from 'hvr';
import { logo as brandLogo } from 'hvr/brand';

// Lecture name on the left, logo on the right, hairline divider below.
// Logo precedence: the scene's `logo` data field, then
// templates/_shared/assets/logo.{svg,png}, then a text wordmark.
export function Header({ lecture, logo, brand = 'Prepzy', anim = 'fadeIn', delay = 0, exit = 'fadeOut', exitDelay = 0 }) {
  const src = logo || brandLogo;
  return (
    <header className="brand-header" anim={anim} delay={delay} dur={600} exit={exit} exitDelay={exitDelay} exitDur={500}>
      <span className="brand-lecture">{lecture}</span>
      {src
        ? <img className="brand-logo" src={src} alt="" />
        : <span className="brand-wordmark"><b>{brand.slice(0, 1)}</b>{brand.slice(1)}</span>}
    </header>
  );
}

// Orange accent bar + slide title.
export function SlideTitle({ text, anim = 'fadeIn', delay = 150, exit = 'fadeOut', exitDelay = 0 }) {
  return (
    <div className="brand-title" anim={anim} delay={delay} dur={600} exit={exit} exitDelay={exitDelay} exitDur={500}>
      <h1><Rich text={text} /></h1>
    </div>
  );
}

// Image placeholder box (light grey, hairline border, rounded) with an
// optional image and a centred caption at the bottom. Position it with
// className + CSS. `fit`: "contain" (default, whole image visible) | "cover".
export function Panel({ image, caption, fit = 'contain', className = '', style, anim = 'panelIn', delay = 250, at, exit = 'fadeOut', exitDelay = 0 }) {
  return (
    <figure className={`panel ${fit === 'cover' ? 'cover' : ''} ${className}`} style={style}
            anim={anim} delay={delay} at={at} exit={exit} exitDelay={exitDelay} exitDur={500}>
      <div className="panel-media">{image && <img src={image} alt="" />}</div>
      {caption && <figcaption className="panel-caption">{rich(caption)}</figcaption>}
    </figure>
  );
}

// Bulleted list; each item rises in. Pass `ats` (ms, absolute) to time items
// to narration; otherwise they stagger from `delay`.
export function Bullets({ items = [], className = '', delay = 400, stagger = 140, ats = [] }) {
  return (
    <ul className={`bullets ${className}`} stagger={stagger} delay={delay} exitStagger={60} exitDelay={200}>
      {items.map((it, i) => <li anim="riseIn" at={ats[i]} exit="riseOut"><Rich text={it} /></li>)}
    </ul>
  );
}

// Narration cue helper: seconds on the video timeline -> ms, or null.
// `list[i]` may be a number or a list whose first entry is used.
export const cue = (list, i) => {
  const v = list?.[i];
  if (v == null) return null;
  const t = Array.isArray(v) ? v[0] : v;
  return typeof t === 'number' ? t * 1000 : null;
};
export const sec = (v) => (typeof v === 'number' ? v * 1000 : null);

// Schema fragments reused by every biology template.
export const common = {
  // Course-table lecture names can be long; stage/index.html shrinks / wraps the header to fit.
  lecture: { type: 'text', default: '', max: 160, description: 'header left; usually set once in project "shared"' },
  logo: { type: 'image', description: 'overrides templates/_shared/assets/logo.*' },
};
export const cueList = (what) => ({
  type: 'list', of: 'any',
  description: `narration sync: seconds on the video timeline when each ${what} appears; omit for auto stagger`,
});

// Answer-state keyframes for option rows (PDF page 16). Literal colours
// because WAAPI keyframes are resolved before custom properties would be.
export const MCQ = {
  correct: { bg: '#e8f4ef', border: '#1f7a5a' },
  wrong: { bg: '#fbecea', border: '#c0392b' },
};
export const stateAnim = (state, base = '#f6f7f9') => ({
  dur: 450, ease: 'outSoft',
  kf: [{ backgroundColor: base, borderColor: 'rgba(0,0,0,0)' },
       { backgroundColor: MCQ[state].bg, borderColor: MCQ[state].border }],
});
