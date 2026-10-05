import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';
import { inr, total, mismatch } from '../money.js';

// Commerce deck page 23: a Balance Sheet in the horizontal (T) format — "as
// at …" under the title, Liabilities · Amount ₹ on the left and Assets ·
// Amount ₹ on the right, a divider between them and a Total bar at the foot
// of each side. Totals are worked out here, and the check refuses a balance
// sheet whose two sides do not agree. (Class 12 company balance sheets in the
// vertical Schedule III format go on a `comparison` slide.)
// Reference: reference.png

export const meta = {
  name: 'Balance sheet',
  number: 23,
  aliases: [],
  description: 'Horizontal Balance Sheet: liabilities | assets with amounts and computed, agreeing totals.',
  duration: 12000,
  slide: {
    type: 'balance_sheet', name: 'Balance sheet',
    use: 'a Balance Sheet in the horizontal format (Liabilities | Assets) with 1–7 items a side and agreeing totals — sole trader or partnership final accounts, or the solution after a practice_problem',
    image: 'none',
    fields: {
      asAt: { words: 6, note: 'e.g. "as at 31st March 2024"' },
      liabilities: { required: true, items: [1, 7], fields: {
        item: { required: true, words: 6, note: 'e.g. "Capital", "Creditors", "Outstanding Salary"' },
        amount: { required: true, note: 'a plain number in rupees' },
      } },
      assets: { required: true, items: [1, 7], fields: {
        item: { required: true, words: 6, note: 'e.g. "Machinery", "Stock", "Cash in Hand"' },
        amount: { required: true, note: 'a plain number in rupees' },
      } },
    },
    reveal: [
      { field: 'liabilities', each: true, cue: 'cues.liabilities' },
      { field: 'assets', each: true, cue: 'cues.assets' },
    ],
    narrationWords: [230, 340],
  },
};

const item = { item: { type: 'text', required: true, max: 50 }, amount: { type: 'number', required: true, min: 0 } };

export const schema = {
  ...common,
  title: { type: 'text', default: 'Balance Sheet', max: 60 },
  asAt: { type: 'text', max: 50 },
  heads: { type: 'list', min: 2, max: 2, of: { type: 'text', max: 20 }, default: ['Liabilities', 'Assets'] },
  amountHead: { type: 'text', default: 'Amount ₹', max: 16 },
  liabilities: { type: 'list', min: 1, max: 7, of: item },
  assets: { type: 'list', min: 1, max: 7, of: item },
  cues: { type: 'object', fields: { liabilities: { type: 'list', of: 'number' }, assets: { type: 'list', of: 'number' } } },
};

export function check(d) {
  const m = mismatch(total(d.liabilities, 'amount'), total(d.assets, 'amount'), 'balance sheet', ['liabilities', 'assets']);
  return m ? [m] : [];
}

function Side({ head, amountHead, rows, cues, delay }) {
  return (
    <div className="side">
      <div className="brow head"><span>{head}</span><span>{amountHead}</span></div>
      <div className="rows" stagger={300} delay={delay}>
        {rows.map((r, i) => (
          <div className="brow" anim="riseIn" at={cue(cues, i)}>
            <span><Rich text={r.item} /></span><span className="amt">{inr(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BalanceSheet(d) {
  const c = d.cues || {};
  const ts = [cue(c.liabilities, d.liabilities.length - 1), cue(c.assets, d.assets.length - 1)].filter((t) => t != null);
  const totalAt = ts.length ? Math.max(...ts) + 900 : null;
  const n = Math.max(d.liabilities.length, d.assets.length);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      {d.asAt && <div className="asat" anim="fadeIn" delay={350} exit="fadeOut">{d.asAt}</div>}
      <div className="sheet" anim="riseIn" delay={450} exit="riseOut">
        <Side head={d.heads[0]} amountHead={d.amountHead} rows={d.liabilities} cues={c.liabilities} delay={800} />
        <Side head={d.heads[1]} amountHead={d.amountHead} rows={d.assets} cues={c.assets} delay={800 + d.liabilities.length * 300} />
        <div className="brow total" anim="riseIn" delay={1200 + n * 600} at={totalAt}><span>Total</span><span className="amt">{inr(total(d.liabilities, 'amount'))}</span></div>
        <div className="brow total" anim="riseIn" delay={1200 + n * 600} at={totalAt}><span>Total</span><span className="amt">{inr(total(d.assets, 'amount'))}</span></div>
      </div>
    </>
  );
}
