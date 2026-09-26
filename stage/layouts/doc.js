import { esc, rich, foot } from './_util.js';

// Flat document slide: white paper, header rule, accent-barred title, text
// column + optional figure. No gradients, no blur, no animated backdrop —
// this is the cheap-to-rasterise profile most lesson decks actually use.
export default function doc(s) {
  const groups = (s.groups || (s.items ? [s.items] : [])).map((g) => `
    <ul class="doc-list">
      ${g.map((it) => `<li data-anim="fadeUp" data-dur="520">${rich(it)}</li>`).join('')}
    </ul>`).join('');

  const figure = s.figure ? `
    <div class="doc-fig" data-anim="figIn" data-delay="420">
      <div class="doc-fig-inner">
        <img src="${esc(s.figure.src)}" alt="">
      </div>
      ${s.figure.caption ? `<div class="doc-cap">${esc(s.figure.caption)}</div>` : ''}
    </div>` : '';

  return `
    <header class="doc-head" data-anim="fadeIn" data-dur="420">
      <span class="doc-kicker">${esc(s.kicker || '')}</span>
      ${s.brand ? `<span class="doc-brand">${esc(s.brand)}</span>` : ''}
    </header>
    <h1 class="doc-title" data-anim="clipWipe" data-delay="120" data-dur="620">${rich(s.headline)}</h1>
    <div class="doc-body">
      <div class="doc-col" data-stagger="90" data-delay="380">
        ${s.lead ? `<p class="doc-lead" data-anim="fadeUp" data-dur="520">${rich(s.lead)}</p>` : ''}
        ${groups}
      </div>
      ${figure}
    </div>
    ${foot(s)}`;
}
