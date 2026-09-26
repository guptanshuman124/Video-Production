import { esc, rich, backdrop, foot } from './_util.js';

// Numeric callouts. A stat with `count: <int>` animates its digits via the
// registered --num custom property, so counting rides the same deterministic
// clock as everything else. Anything else renders as static text.
export default function stat(s) {
  const cells = (s.stats || []).map((st) => {
    const unit = st.unit ? `<span class="unit">${esc(st.unit)}</span>` : '';
    const value = Number.isFinite(st.count)
      ? `<span class="num count" data-anim="countTo" data-count="${st.count}"
              data-count-dur="${st.countDur || 1500}"></span>${unit}`
      : `<span class="num" data-anim="blurIn">${rich(st.value)}</span>${unit}`;
    return `
      <div class="stat">
        <div class="statline">${value}</div>
        <div class="bar" data-anim="lineGrow" data-dur="900" data-delay="260"></div>
        <div class="lbl" data-anim="fadeUp" data-delay="380">${rich(st.label)}</div>
      </div>`;
  }).join('');

  return `${backdrop()}
    <div class="stack gap-sm">
      ${s.kicker ? `<div class="kicker" data-anim="fadeDown" data-delay="0">${esc(s.kicker)}</div>` : ''}
      <h2 class="section-head" data-anim="clipUp" data-delay="140">${rich(s.headline)}</h2>
    </div>
    <div class="stats" data-stagger="220" data-delay="620">${cells}</div>
    ${s.note ? `<p class="sub" style="margin-top:72px;font-size:30px"
        data-anim="fadeUp" data-delay="1500">${rich(s.note)}</p>` : ''}
    ${foot(s)}`;
}
