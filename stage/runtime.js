// Deterministic animation engine.
//
// Nothing here ever plays in realtime during a render. Every animation is
// created paused with fill:'both' and a delay equal to its absolute position
// on one global timeline; __seek(t) pins currentTime on all of them. Frame N
// is therefore identical no matter how long the previous screenshot took.

import { ELEMENT_ANIMS, WORD_ANIM, EASE } from './anims.js';
import { TRANSITIONS, DEFAULT_TRANSITION } from './transitions.js';
import { templates as TEMPLATES } from './__templates.js';


const NEUTRAL = { opacity: 1, transform: 'none', filter: 'none', clipPath: 'inset(0 0 0 0)' };

const anims = [];
const sceneTimes = [];      // per scene: { exitStart } for stills tooling
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

// `local` holds the scene template's own named presets, which shadow the
// global ones in anims.js.
function buildElementAnims(sceneEl, base, local = {}) {
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
    // data-at pins the start to an absolute time on the video timeline (=
    // audio time), for reveals synced to narration; it overrides stagger and
    // delay, but never starts before this scene's entrance has finished.
    const delay = el.dataset.at != null
      ? Math.max(base, Number(el.dataset.at))
      : base + inheritedStagger(el, sceneEl) + Number(el.dataset.delay || 0);
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

    const preset = name === '@inline' ? el.__anim : (local[name] || ELEMENT_ANIMS[name]);
    if (!preset) { console.warn('[runtime] unknown animation:', name); return; }

    if (name === 'countTo') {
      const dur = Number(el.dataset.countDur) || preset.dur;
      const target = Number(el.dataset.count) || 0;
      push(el, [{ '--num': 0 }, { '--num': target }],
           { delay, duration: dur, easing: ease || preset.ease }, [[delay, delay + dur]]);
      return;
    }

    const dur = Number(el.dataset.dur) || preset.dur || 700;
    const easing = ease || EASE[preset.ease] || preset.ease || EASE.out;
    push(el, preset.kf, { delay, duration: dur, easing }, [[delay, delay + dur]]);
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

// Exit animations play at the END of a scene and finish by `outPoint` (the
// moment the outgoing scene transition starts). They use fill:'forwards', not
// 'both': before they start they contribute nothing, so they never mask the
// entrance animation on the same element. Created after the entrances, they
// sit higher in the composite order and win once active.
//
//   data-exit="fadeOut"        preset (template-local first, then global)
//   data-exit-delay="300"      finish this many ms BEFORE outPoint
//   data-exit-dur / -ease      timing overrides
//   data-exit-stagger="80"     on a parent: children exit in document order,
//                              first child first, the last one finishing at
//                              outPoint - the parent's data-exit-delay
function buildExitAnims(sceneEl, outPoint, local = {}) {
  let first = Infinity;
  sceneEl.querySelectorAll('[data-exit-stagger]').forEach((c) => {
    const step = Number(c.dataset.exitStagger) || 0;
    const base = Number(c.dataset.exitDelay || 0);
    const kids = [...c.children];
    kids.forEach((k, i) => { k.__xbase = base + (kids.length - 1 - i) * step; });
  });

  sceneEl.querySelectorAll('[data-exit]').forEach((el) => {
    const name = el.dataset.exit;
    const preset = name === '@inline' ? el.__exit : (local[name] || ELEMENT_ANIMS[name]);
    if (!preset?.kf) { console.warn('[runtime] unknown exit animation:', name); return; }
    let inherited = 0;
    for (let n = el; n && n !== sceneEl.parentNode; n = n.parentElement) {
      if (n.__xbase != null) { inherited = n.__xbase; break; }
    }
    const own = el.dataset.exitStagger != null ? 0 : Number(el.dataset.exitDelay || 0);
    const dur = Number(el.dataset.exitDur) || preset.dur || 500;
    const end = outPoint - inherited - own;
    const start = end - dur;
    const easing = EASE[el.dataset.exitEase] || el.dataset.exitEase || EASE[preset.ease] || preset.ease || EASE.inOut;
    const a = el.animate(preset.kf, { fill: 'forwards', delay: start, duration: dur, easing });
    a.pause();
    a.currentTime = 0;
    anims.push(a);
    motion.push([start, end]);
    first = Math.min(first, start);
  });
  return first;
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
    const el = document.createElement('section');
    el.style.zIndex = String(10 + i);
    el.dataset.scene = String(i);
    let localAnims = {};
    if (s.template) {
      // Template scenes own the whole 1920x1080 frame; their CSS is scoped
      // to [data-template=<id>], which is this section.
      const tpl = TEMPLATES[s.template];
      if (!tpl) throw new Error(`unknown template: ${s.template}`);
      el.className = 'scene tpl';
      el.dataset.template = s.template;
      const out = tpl.mod.default(s.data || {}, { index: i, scene: s, example: tpl.example });
      if (typeof out === 'string') el.innerHTML = out;
      else if (out) el.appendChild(out);
      localAnims = tpl.mod.animations || {};
    } else {
      throw new Error(`scene ${i} has no template`);
    }
    stage.appendChild(el);

    const isLast = i === scenes.length - 1;
    buildPresence(el, {
      start: starts[i], dur: s.duration,
      tIn: tIn[i], tOut: isLast ? 0 : tIn[i + 1],
      easeIn: s.transition, easeOut: scenes[i + 1]?.transition,
      isLast,
    });
    buildElementAnims(el, starts[i] + tIn[i], localAnims);
    // `"exit": false` on a scene keeps its content on screen through the
    // outgoing transition (e.g. two slides that share a header).
    if (s.exit !== false) {
      const tail = isLast ? (project.fadeOut ?? 700) : tIn[i + 1];
      const exitStart = buildExitAnims(el, starts[i] + s.duration - tail, localAnims);
      sceneTimes[i] = { exitStart: Number.isFinite(exitStart) ? exitStart : null };
    } else {
      sceneTimes[i] = { exitStart: null };
    }
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
export const sceneTime = (i) => sceneTimes[i] || { exitStart: null };
