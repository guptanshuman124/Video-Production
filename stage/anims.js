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
  fadeRight: {
    dur: 760, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'translateX(-54px)' },
         { opacity: 1, transform: 'translateX(0)' }],
  },
  zoomIn: {
    dur: 900, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'scale(1.14)' },
         { opacity: 1, transform: 'scale(1)' }],
  },
  popIn: {
    dur: 560, ease: EASE.back,
    kf: [{ opacity: 0, transform: 'scale(.4)' },
         { opacity: 1, transform: 'scale(1)' }],
  },
  // Pure translate, no fade — pair with an overflow:hidden parent for a
  // "text rises out of a slot" reveal.
  slideUp: {
    dur: 820, ease: EASE.out,
    kf: [{ transform: 'translateY(105%)' }, { transform: 'translateY(0)' }],
  },
  clipDown: {
    dur: 900, ease: EASE.out,
    kf: [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }],
  },
  clipLeft: {
    dur: 900, ease: EASE.out,
    kf: [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0%)' }],
  },
  // Circular reveal from the element's centre.
  irisIn: {
    dur: 900, ease: EASE.out,
    kf: [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }],
  },
  // Vertical grow (bar charts, dividers). Set transform-origin in CSS.
  growY: {
    dur: 760, ease: EASE.out,
    kf: [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
  },
  // SVG stroke drawing. The element needs pathLength="1" and
  // stroke-dasharray: 1 so the offset runs 1 -> 0 regardless of real length.
  draw: {
    dur: 1200, ease: EASE.inOut,
    kf: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
  },
  // ---- deck vocabulary: content fades in rising, leaves fading out rising ----
  // Calm, unhurried: a short rise with a long expo settle (no bounce, no blur).
  riseIn: {
    dur: 900, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'translateY(22px) scale(.99)' },
         { opacity: 1, transform: 'translateY(0) scale(1)' }],
  },
  // Image panels open from a slightly inset rounded mask while settling from a
  // hair larger — reads as "the picture comes into focus". The end mask is
  // outset (negative inset) so it never clips the panel's shadow.
  panelIn: {
    dur: 1100, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'scale(1.035)', clipPath: 'inset(3.5% 3.5% 3.5% 3.5% round 16px)' },
         { opacity: 1, transform: 'scale(1)', clipPath: 'inset(-40px -40px -40px -40px round 16px)' }],
  },
  // A picture that fills its frame: slow reveal from a soft mask.
  imageIn: {
    dur: 1400, ease: EASE.out,
    kf: [{ opacity: 0, transform: 'scale(1.06)', clipPath: 'inset(6% 6% 6% 6% round 24px)' },
         { opacity: 1, transform: 'scale(1)', clipPath: 'inset(0% 0% 0% 0% round 0px)' }],
  },
  // ---- exits (use with exit=) ----
  fadeOut: {
    dur: 500, ease: EASE.inOut,
    kf: [{ opacity: 1 }, { opacity: 0 }],
  },
  fadeOutUp: {
    dur: 560, ease: EASE.inOut,
    kf: [{ opacity: 1, transform: 'translateY(0)' },
         { opacity: 0, transform: 'translateY(-36px)' }],
  },
  riseOut: {
    dur: 520, ease: EASE.inOut,
    kf: [{ opacity: 1, transform: 'translateY(0)' },
         { opacity: 0, transform: 'translateY(-28px)' }],
  },
  fadeOutDown: {
    dur: 560, ease: EASE.inOut,
    kf: [{ opacity: 1, transform: 'translateY(0)' },
         { opacity: 0, transform: 'translateY(36px)' }],
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
