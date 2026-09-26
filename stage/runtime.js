// Deterministic animation engine.
//
// Nothing here ever plays in realtime during a render. Every animation is
// created paused with fill:'both' and a delay equal to its absolute position
// on one global timeline; __seek(t) pins currentTime on all of them. Frame N
// is therefore identical no matter how long the previous screenshot took.

import { ELEMENT_ANIMS, WORD_ANIM, EASE } from './anims.js';
import { TRANSITIONS, DEFAULT_TRANSITION } from './transitions.js';
import title from './layouts/title.js';
import bullets from './layouts/bullets.js';
import stat from './layouts/stat.js';
import doc from './layouts/doc.js';

const LAYOUTS = { title, bullets, stat, doc };

const NEUTRAL = { opacity: 1, transform: 'none', filter: 'none', clipPath: 'inset(0 0 0 0)' };

const anims = [];
const motion = [];          // raw [start,end] windows where pixels actually change
let totalDuration = 0;

const push = (el, kf, timing, windows) => {
  const a = el.animate(kf, { fill: 'both', ...timing });
  a.pause();
  a.currentTime = 0;
  anims.push(a);
  for (const w of windows) if (w[1] > w[0]) motion.push(w);
};

// ---- text splitting -------------------------------------------------------

function splitWords(el) {
  const out = [];
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        // keep trailing spaces inside the span (.w is white-space: pre)
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
          const s = document.createElement('span');
          s.className = 'w';
          s.textContent = part;
          frag.appendChild(s);
          out.push(s);
        }
        node.replaceChild(frag, child);
      } else if (child.nodeType === 1) {
        walk(child);
      }
    }
  };
  walk(el);
  return out;
}

// ---- keyframe helpers -----------------------------------------------------

// WAAPI interpolates a property only across keyframes that declare it, so
// every frame gets the full union of keys with neutral values filled in.
function normalize(frames) {
  const keys = new Set();
  for (const f of frames) {
    for (const k of Object.keys(f)) if (k !== 'offset' && k !== 'easing') keys.add(k);
  }
  return frames.map((f) => {
    const o = { offset: f.offset };
    if (f.easing) o.easing = f.easing;          // segment easing, not an animatable prop
    for (const k of keys) o[k] = f[k] !== undefined ? f[k] : (NEUTRAL[k] ?? 'none');
    return o;
  });
}

const trans = (t) => TRANSITIONS[t?.name] || TRANSITIONS[DEFAULT_TRANSITION.name];

// ---- build ----------------------------------------------------------------

function inheritedStagger(el, root) {
  for (let n = el; n && n !== root.parentNode; n = n.parentElement) {
    if (n.__sbase != null) return n.__sbase;
  }
  return 0;
}

function buildElementAnims(sceneEl, base) {
  // Assign stagger offsets first. Elements doing their own word-level stagger
  // are skipped so data-stagger is unambiguous.
  sceneEl.querySelectorAll('[data-stagger]').forEach((c) => {
    if (c.dataset.anim === 'words') return;
    const step = Number(c.dataset.stagger) || 0;
    const start = Number(c.dataset.delay || 0);
    [...c.children].forEach((child, i) => { child.__sbase = start + i * step; });
  });

  sceneEl.querySelectorAll('[data-anim]').forEach((el) => {
    const name = el.dataset.anim;
    const delay = base + inheritedStagger(el, sceneEl) + Number(el.dataset.delay || 0);
    const ease = EASE[el.dataset.ease] || null;

    if (name === 'words') {
      const step = Number(el.dataset.stagger) || WORD_ANIM.stagger;
      const dur = Number(el.dataset.dur) || WORD_ANIM.dur;
      splitWords(el).forEach((span, i) => {
        const d = delay + i * step;
        push(span, WORD_ANIM.kf, { delay: d, duration: dur, easing: ease || WORD_ANIM.ease },
             [[d, d + dur]]);
      });
      return;
    }

    const preset = ELEMENT_ANIMS[name];
    if (!preset) { console.warn('[runtime] unknown animation:', name); return; }

    if (name === 'countTo') {
      const dur = Number(el.dataset.countDur) || preset.dur;
      const target = Number(el.dataset.count) || 0;
      push(el, [{ '--num': 0 }, { '--num': target }],
           { delay, duration: dur, easing: ease || preset.ease }, [[delay, delay + dur]]);
      return;
    }

    const dur = Number(el.dataset.dur) || preset.dur;
    push(el, preset.kf, { delay, duration: dur, easing: ease || preset.ease },
         [[delay, delay + dur]]);
  });
}

// Presence = arrival + hold + departure as ONE animation, so no two fill:both
// animations ever fight over the same property on a scene.
function buildPresence(sceneEl, { start, dur, tIn, tOut, easeIn, easeOut, isLast }) {
  const inEnd = tIn / dur;
  const outStart = (dur - tOut) / dur;
  const into = trans(easeIn).into;
  const away = isLast ? { to: {} } : trans(easeOut).outgoing;

  // Easing lives on the keyframe that starts each segment: arrival uses this
  // scene's transition curve, departure uses the incoming scene's.
  const frames = normalize([
    { offset: 0, easing: trans(easeIn).ease, ...into.from },
    { offset: inEnd, easing: 'linear', ...into.to },
    { offset: Math.max(inEnd, outStart), easing: isLast ? 'linear' : trans(easeOut).ease, ...NEUTRAL },
    { offset: 1, ...(isLast ? NEUTRAL : away.to) },
  ]);

  push(sceneEl, frames, { delay: start, duration: dur, easing: 'linear' },
       [[start, start + tIn], ...(isLast ? [] : [[start + dur - tOut, start + dur]])]);
}

// ---- public API -----------------------------------------------------------

export function prepare(project, opts = {}) {
  const frameMs = 1000 / (opts.fps || 30);
  const minT = frameMs;                       // a "cut" is a one-frame dissolve
  const scenes = project.scenes;

  const tIn = scenes.map((s) => Math.max(minT, (s.transition?.duration ?? DEFAULT_TRANSITION.duration)));
  const starts = [];
  let cursor = 0;
  scenes.forEach((s, i) => {
    if (i > 0) cursor += scenes[i - 1].duration - tIn[i];
    starts.push(cursor);
  });
  totalDuration = starts[scenes.length - 1] + scenes[scenes.length - 1].duration;

  const stage = document.getElementById('stage');
  scenes.forEach((s, i) => {
    const layout = LAYOUTS[s.layout];
    if (!layout) throw new Error(`unknown layout: ${s.layout}`);
    const el = document.createElement('section');
    el.className = s.theme === 'light' ? 'scene light' : 'scene';
    el.style.zIndex = String(10 + i);
    el.dataset.scene = String(i);
    el.innerHTML = layout(s);
    stage.appendChild(el);

    const isLast = i === scenes.length - 1;
    buildPresence(el, {
      start: starts[i], dur: s.duration,
      tIn: tIn[i], tOut: isLast ? 0 : tIn[i + 1],
      easeIn: s.transition, easeOut: scenes[i + 1]?.transition,
      isLast,
    });
    buildElementAnims(el, starts[i] + tIn[i]);
  });

  // Fade from / to black.
  const fader = document.getElementById('fader');
  const fadeIn = project.fadeIn ?? 500, fadeOut = project.fadeOut ?? 700;
  push(fader, [{ opacity: 1 }, { opacity: 0 }], { delay: 0, duration: fadeIn, easing: EASE.inOut },
       [[0, fadeIn]]);
  push(fader, [{ opacity: 0 }, { opacity: 1 }],
       { delay: totalDuration - fadeOut, duration: fadeOut, easing: EASE.inOut },
       [[totalDuration - fadeOut, totalDuration]]);

  return { duration: totalDuration, starts, scenes: scenes.length, animations: anims.length };
}

export function seek(t) {
  for (const a of anims) a.currentTime = t;
}

// Merged union of every window where something is actually moving. Everything
// outside these is a frozen frame the renderer can duplicate instead of shoot.
export function motionIntervals(pad = 0) {
  const sorted = motion.map(([a, b]) => [Math.max(0, a - pad), b + pad]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  return merged;
}

export const duration = () => totalDuration;
