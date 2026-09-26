import { esc, rich, backdrop, foot } from './_util.js';

// Section heading + numbered list. Each row is its own animation target so
// the list staggers in rather than arriving as a block.
export default function bullets(s) {
  const rows = (s.items || []).map((it, i) => {
    const text = typeof it === 'string' ? { title: it } : it;
    return `
      <div class="bullet" data-anim="fadeLeft">
        <div class="chip">${esc(text.chip || String(i + 1).padStart(2, '0'))}</div>
        <div class="btext">
          <div class="bt">${rich(text.title)}</div>
          ${text.detail ? `<div class="bd">${rich(text.detail)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `${backdrop()}
    <div class="stack gap-sm">
      ${s.kicker ? `<div class="kicker" data-anim="fadeDown" data-delay="0">${esc(s.kicker)}</div>` : ''}
      <h2 class="section-head" data-anim="clipUp" data-delay="140">${rich(s.headline)}</h2>
    </div>
    <div class="bullets" data-stagger="150" data-delay="560">${rows}</div>
    ${foot(s)}`;
}
