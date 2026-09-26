export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// `*emphasised*` -> accent span. Applied after escaping so content stays safe.
export const rich = (s = '') =>
  esc(s).replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');

// Shared animated backdrop.
export const backdrop = () => `
  <div class="orbs"></div>
  <div class="grid-lines" data-anim="fadeIn" data-dur="1400" data-delay="0"></div>`;

export const foot = (s) => s.foot
  ? `<div class="foot" data-anim="fadeIn" data-delay="700" data-dur="700">
       <span>${esc(s.foot.left || '')}</span><span>${esc(s.foot.right || '')}</span>
     </div>` : '';
