// Tiny JSX runtime for slide templates. JSX compiles to h() calls (esbuild
// injects h/Fragment automatically), and h() builds real DOM nodes — no
// virtual DOM, no re-rendering. A template runs exactly once per scene.
//
// Animation props are sugar over the runtime's data-* contract:
//   <h1 anim="fadeUp" delay={200} dur={600} ease="out">…</h1>
//   <ul stagger={120} delay={400}>…</ul>          children offset 0,120,240…
//   <div anim={{ kf: [{…}, {…}], dur: 800 }} />    one-off inline keyframes
// Entrance delays are ms after this scene's entrance transition ends.
//   <li anim="fadeUp" at={16800}>                  start at 16.8s on the video/audio
//                                                  timeline (narration-synced reveals)
//
// Exit animations run at the end of the scene, finishing just as the outgoing
// transition starts:
//   <h1 exit="fadeOut" exitDelay={200} exitDur={500}>   ends 200ms before the out point
//   <ul exitStagger={80} exitDelay={300}>              children leave first-to-last

import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text',
  'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'mask', 'clipPath', 'use',
  'marker', 'pattern', 'symbol', 'filter', 'feGaussianBlur', 'feOffset', 'feBlend',
  'feColorMatrix', 'feMerge', 'feMergeNode', 'image', 'textPath', 'foreignObject',
]);

// Style numbers get px unless the property is naturally unitless.
const UNITLESS = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink',
  'order', 'scale', 'zoom', 'fillOpacity', 'strokeOpacity', 'strokeDashoffset',
  'strokeDasharray', 'strokeWidth', 'aspectRatio', 'gridRow', 'gridColumn', 'columns',
]);

// Prop -> data-* attribute consumed by stage/runtime.js.
const ANIM_PROPS = {
  anim: 'anim', at: 'at', delay: 'delay', dur: 'dur', ease: 'ease', stagger: 'stagger',
  count: 'count', countDur: 'countDur',
  exit: 'exit', exitDelay: 'exitDelay', exitDur: 'exitDur', exitEase: 'exitEase',
  exitStagger: 'exitStagger',
};

export const Fragment = Symbol('Fragment');

function append(parent, child) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) { for (const c of child) append(parent, c); return; }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

function setStyle(el, style) {
  if (typeof style === 'string') { el.setAttribute('style', style); return; }
  for (const [k, v] of Object.entries(style)) {
    if (v == null || v === false) continue;
    if (k.startsWith('--')) el.style.setProperty(k, String(v));
    else el.style[k] = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v);
  }
}

export function h(tag, props, ...children) {
  props = props || {};
  if (typeof tag === 'function') return tag({ ...props, children });
  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    append(frag, children);
    return frag;
  }

  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false || k === 'children' || k === 'key') continue;
    if ((k === 'anim' || k === 'exit') && typeof v === 'object') {
      el.dataset[k] = '@inline';
      el[`__${k}`] = v;
    } else if (k in ANIM_PROPS) {
      el.dataset[ANIM_PROPS[k]] = String(v);
    } else if (k === 'className' || k === 'class') {
      const cls = Array.isArray(v) ? cx(...v) : v;
      if (cls) el.setAttribute('class', cls);
    } else if (k === 'style') {
      setStyle(el, v);
    } else if (k === 'html') {
      el.innerHTML = v;                        // trusted markup only (e.g. KaTeX output)
    } else if (k === 'ref' && typeof v === 'function') {
      v(el);
    } else if (k === 'htmlFor') {
      el.setAttribute('for', v);
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }

  append(el, children);
  return el;
}

// ---- helpers for template authors ----------------------------------------

// Join truthy class names: cx('a', on && 'b', { c: flag }).
export function cx(...args) {
  const out = [];
  for (const a of args) {
    if (!a) continue;
    if (typeof a === 'string') out.push(a);
    else if (typeof a === 'object') for (const [k, v] of Object.entries(a)) if (v) out.push(k);
  }
  return out.join(' ');
}

// Inline markup for text coming from JSON:
//   *emphasis*   -> <span class="accent">      **strong** -> <strong>
//   $x^2$        -> KaTeX formula               $\ce{H2O}$ -> chemistry (mhchem)
// Everything else stays plain text, so content can never inject HTML.
export function tex(src, { display = false } = {}) {
  const span = document.createElement('span');
  span.innerHTML = katex.renderToString(src, { throwOnError: false, displayMode: display, output: 'html' });
  return span.firstChild;
}

function emphasis(frag, s, accentClass) {
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    const span = document.createElement(m[1] != null ? 'strong' : 'span');
    if (m[2] != null) span.className = accentClass;
    span.textContent = m[1] ?? m[2];
    frag.appendChild(span);
    last = re.lastIndex;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
}

export function rich(text = '', accentClass = 'accent') {
  const frag = document.createDocumentFragment();
  const s = String(text);
  const re = /(?<!\\)\$([^$]+)\$/g;           // $…$, with \$ for a literal dollar
  let last = 0, m;
  while ((m = re.exec(s))) {
    emphasis(frag, s.slice(last, m.index).replace(/\\\$/g, '$'), accentClass);
    frag.appendChild(tex(m[1]));
    last = re.lastIndex;
  }
  emphasis(frag, s.slice(last).replace(/\\\$/g, '$'), accentClass);
  return frag;
}

// <Tex src="\\frac{a}{b}" display /> — a standalone formula.
export const Tex = ({ src, display }) => tex(src, { display });

// <Rich text={data.title} /> — component form of rich().
export const Rich = ({ text, accent }) => rich(text, accent);

// Split text into one element per line on "\n", e.g. for line-staggered reveals.
export const lines = (text = '') => String(text).split('\n');

// Zero-padded index: pad(3) -> "03".
export const pad = (n, width = 2) => String(n).padStart(width, '0');

// Reserved names the JSX compiler targets, so a template variable called `h`
// or `Fragment` can never shadow the factory.
export { h as __h, Fragment as __Fragment };
