import { esc, rich, backdrop, foot } from './_util.js';

// Title / statement card. `variant: "statement"` swaps the headline for a
// larger pull-quote treatment with an attribution line.
export default function title(s) {
  const statement = s.variant === 'statement';
  const eyebrow = (s.kicker || s.badge) ? `
    <div class="eyebrow-row" data-anim="fadeDown" data-delay="0" data-dur="700">
      ${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}
      ${s.badge ? `<div class="badge">${esc(s.badge)}</div>` : ''}
    </div>` : '';

  const head = statement
    ? `<h1 class="statement" data-anim="words" data-delay="220" data-stagger="48">${rich(s.headline)}</h1>
       ${s.attrib ? `<div class="attrib" data-anim="fadeUp" data-delay="900">${esc(s.attrib)}</div>` : ''}`
    : `<h1 class="headline" data-anim="words" data-delay="200" data-stagger="60">${rich(s.headline)}</h1>
       <div class="rule" data-anim="lineGrow" data-delay="620" data-dur="820"></div>
       ${s.sub ? `<p class="sub" data-anim="fadeUp" data-delay="760">${rich(s.sub)}</p>` : ''}`;

  return `${backdrop()}
    <div class="stack ${statement ? 'gap-sm' : 'gap-md'}">${eyebrow}${head}</div>
    ${foot(s)}`;
}
