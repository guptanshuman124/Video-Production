// Element-level animation presets. Every preset is a plain WAAPI keyframe list
// plus default timing; the runtime supplies delay/duration overrides.

export const EASE = {
  out:     'cubic-bezier(.16,1,.3,1)',      // expo-out, the workhorse
  outSoft: 'cubic-bezier(.22,.61,.36,1)',
  inOut:   'cubic-bezier(.65,0,.35,1)',
  back:    'cubic-bezier(.34,1.56,.64,1)',
  linear:  'linear',
};

export const ELEMENT_ANIMS = {
  fadeIn: {
    dur: 600, ease: EASE.outSoft,
    kf: [{ opacity: 0 }, { opacity: 1 }],
  },
  fadeUp: {
    dur: 760, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'translateY(46px)' },
         { opacity: 1, transform: 'translateY(0)' }],
  },
  fadeDown: {
    dur: 760, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'translateY(-40px)' },
         { opacity: 1, transform: 'translateY(0)' }],
  },
  fadeLeft: {
    dur: 760, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'translateX(54px)' },
         { opacity: 1, transform: 'translateX(0)' }],
  },
  scaleIn: {
    dur: 720, ease: EASE.back,
    kf: [{ opacity: 0, transform: 'scale(.82)' },
         { opacity: 1, transform: 'scale(1)' }],
  },
  blurIn: {
    dur: 860, ease: EASE.out,
    kf: [{ opacity: 0, filter: 'blur(18px)', transform: 'scale(1.04)' },
         { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }],
  },
  // Text reveal behind a moving mask — nothing translates, the clip does.
  clipWipe: {
    dur: 900, ease: EASE.out,
    kf: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
  },
  clipUp: {
    dur: 900, ease: EASE.out,
    kf: [{ clipPath: 'inset(100% 0 0 0)', transform: 'translateY(24px)' },
         { clipPath: 'inset(0% 0 0 0)', transform: 'translateY(0)' }],
  },
  lineGrow: {
    dur: 760, ease: EASE.out,
    kf: [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
  },
  // Deliberately transform+opacity only: no filter, so it stays cheap to
  // rasterise on a flat slide.
  figIn: {
    dur: 640, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'translateY(22px)' },
         { opacity: 1, transform: 'translateY(0)' }],
  },
  // Numeric count-up driven by a registered @property, so it stays on the
  // same deterministic clock as every other animation (no JS tick).
  countTo: {
    dur: 1400, ease: EASE.outSoft,
    kf: null, // built per-element from data-count
  },
};

// Per-word reveal. The runtime splits the element's text into .w spans first.
export const WORD_ANIM = {
  dur: 780, ease: EASE.out, stagger: 55,
  kf: [{ opacity: 0, transform: 'translateY(38px)' },
       { opacity: 1, transform: 'translateY(0)' }],
};
