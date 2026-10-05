import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Commerce deck page 21: one adjustment and its two effects — the ADJUSTMENT
// bar across the top (in bold), then two outlined cards side by side: the
// effect in the Trading / Profit & Loss Account (mint) and the effect in the
// Balance Sheet (rose). The card headings are written per adjustment, so the
// same layout serves "Effect on Revaluation A/c" / "Effect on Capital" too.
// Reference: reference.png

export const meta = {
  name: 'Adjustment treatment',
  number: 21,
  aliases: [],
  description: 'ADJUSTMENT bar, then two outlined effect cards side by side (P&L effect · Balance Sheet effect).',
  duration: 11000,
  slide: {
    type: 'adjustment', name: 'Adjustment treatment',
    use: 'one adjustment and its double effect when final accounts are prepared (outstanding / prepaid expense, accrued income, depreciation, bad debts and provision, closing stock, interest on capital) — or any item with two linked effects (on Revaluation A/c and on partners’ capital)',
    image: 'none',
    fields: {
      adjustment: { required: true, words: 16, note: 'the adjustment as the question gives it, with its ₹ amount' },
      effects: { required: true, items: [2, 2], fields: {
        heading: { required: true, words: 6, note: 'where the effect shows, e.g. "Effect in Trading & P&L A/c", "Effect in Balance Sheet"' },
        text: { required: true, words: 40, note: 'exactly how it is shown there (which side, added to / deducted from what)' },
      } },
    },
    reveal: [{ field: 'effects', each: true, cue: 'cues.effects' }],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Adjustment Treatment', max: 60 },
  adjustmentLabel: { type: 'text', default: 'Adjustment', max: 24 },
  adjustment: { type: 'text', required: true, max: 130 },
  effects: { type: 'list', min: 2, max: 2, of: {
    heading: { type: 'text', required: true, max: 48 },
    text: { type: 'text', required: true, max: 300 },
  } },
  cues: { type: 'object', fields: { effects: { type: 'list', of: 'number' } } },
};

export default function Adjustment(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <section className="adj" anim="riseIn" delay={400} exit="riseOut">
        <div className="label">{d.adjustmentLabel}</div>
        <div className="atext"><Rich text={d.adjustment} /></div>
      </section>
      <div className="effects" stagger={700} delay={1000} exitStagger={60} exitDelay={200}>
        {d.effects.map((e, i) => (
          <section className={`effect e${i}`} anim="riseIn" at={cue(c.effects, i)} exit="riseOut">
            <div className="ehead"><Rich text={e.heading} /></div>
            <div className="etext"><Rich text={e.text} /></div>
          </section>
        ))}
      </div>
    </>
  );
}
