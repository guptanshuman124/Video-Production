// Slide-level transition presets.
//
// `into` = how the arriving scene enters. `outgoing` = what the scene being
// replaced does while that happens. Both are expressed as a single keyframe
// pair; the runtime splices them into one presence animation per scene so
// there is never more than one fill:both animation competing for a property.

import { EASE } from './anims.js';

export const TRANSITIONS = {
  cut: {
    ease: EASE.linear,
    into:     { from: { opacity: 0 }, to: { opacity: 1 } },
    outgoing: { to: { opacity: 1 } },               // stays put underneath
  },
  dissolve: {
    ease: EASE.inOut,
    into:     { from: { opacity: 0 }, to: { opacity: 1 } },
    outgoing: { to: { opacity: 1 } },
  },
  pushLeft: {
    ease: EASE.out,
    into:     { from: { opacity: 1, transform: 'translateX(100%)' },
                to:   { opacity: 1, transform: 'translateX(0)' } },
    outgoing: { to: { opacity: 1, transform: 'translateX(-22%)' } },  // slight parallax drag
  },
  pushUp: {
    ease: EASE.out,
    into:     { from: { opacity: 1, transform: 'translateY(100%)' },
                to:   { opacity: 1, transform: 'translateY(0)' } },
    outgoing: { to: { opacity: 1, transform: 'translateY(-18%)' } },
  },
  maskWipe: {
    ease: EASE.inOut,
    into:     { from: { opacity: 1, clipPath: 'inset(0 0 0 100%)' },
                to:   { opacity: 1, clipPath: 'inset(0 0 0 0%)' } },
    outgoing: { to: { opacity: 1, transform: 'scale(.96)' } },
  },
  scaleBlur: {
    ease: EASE.out,
    into:     { from: { opacity: 0, transform: 'scale(1.12)', filter: 'blur(26px)' },
                to:   { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' } },
    outgoing: { to: { opacity: 1, transform: 'scale(.94)', filter: 'blur(10px)' } },
  },
  // The deck default: the new slide fades in while drifting up a few pixels
  // and settling from a hair larger; the old one eases back slightly under it.
  // Gentle enough for 20 minutes of lecture, but reads as a designed cut.
  soft: {
    ease: EASE.out,
    into:     { from: { opacity: 0, transform: 'translateY(16px) scale(1.008)' },
                to:   { opacity: 1, transform: 'translateY(0) scale(1)' } },
    outgoing: { to: { opacity: 1, transform: 'scale(.985)' } },
  },
};

export const DEFAULT_TRANSITION = { name: 'soft', duration: 800 };
