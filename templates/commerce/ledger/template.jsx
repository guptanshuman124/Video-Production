import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';
import { inr, total, mismatch } from '../money.js';

// Commerce deck page 19: one ledger account in T-form — the account name
// centred, Dr. side on the left and Cr. side on the right, each with Date ·
// Particulars · J.F. · Amount ₹, and a Total row under both. Debit
// particulars start "To", credit particulars "By" (added by code). The totals
// are worked out here, and the check refuses an account whose two sides do
// not agree (balance it with "Balance c/d").
// Reference: reference.png

export const meta = {
  name: 'Ledger account',
  number: 19,
  aliases: [],
  description: 'T-form ledger account: Dr. and Cr. sides (date, particulars, J.F., amount) with computed totals.',
  duration: 12000,
  slide: {
    type: 'ledger', name: 'Ledger account',
    use: 'posting to and balancing ONE ledger account in T-form (Dr. | Cr.), with Balance b/d and Balance c/d — after the journal entries it posts, or as the solution after a practice_problem',
    image: 'none',
    fields: {
      account: { required: true, words: 5, note: 'e.g. "Cash Account", "Ramesh’s Account"' },
      debit: { required: true, items: [1, 6], fields: {
        date: { words: 3, note: 'e.g. "01-04-2024" or "Apr 1"' },
        particulars: { required: true, words: 6, note: 'the other account, without "To" (code adds it), e.g. "Balance b/d", "Sales A/c"' },
        jf: { words: 1, note: 'optional journal folio number' },
        amount: { required: true, note: 'a plain number in rupees, e.g. 50000' },
      } },
      credit: { required: true, items: [1, 6], fields: {
        date: { words: 3 },
        particulars: { required: true, words: 6, note: 'the other account, without "By" (code adds it), e.g. "Furniture A/c", "Balance c/d"' },
        jf: { words: 1 },
        amount: { required: true, note: 'a plain number in rupees' },
      } },
    },
    reveal: [
      { field: 'debit', each: true, cue: 'cues.debit' },
      { field: 'credit', each: true, cue: 'cues.credit' },
    ],
    narrationWords: [230, 340],
  },
};

const row = {
  date: { type: 'text', max: 20 },
  particulars: { type: 'text', required: true, max: 44 },
  jf: { type: 'text', max: 6 },
  amount: { type: 'number', required: true, min: 0 },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Ledger', max: 60 },
  account: { type: 'text', required: true, max: 48 },
  columns: { type: 'list', min: 4, max: 4, of: { type: 'text', max: 14 }, default: ['Date', 'Particulars', 'J.F.', 'Amount ₹'] },
  debit: { type: 'list', min: 1, max: 6, of: row },
  credit: { type: 'list', min: 1, max: 6, of: row },
  cues: { type: 'object', fields: { debit: { type: 'list', of: 'number' }, credit: { type: 'list', of: 'number' } } },
};

export function check(d) {
  const m = mismatch(total(d.debit, 'amount'), total(d.credit, 'amount'), d.account || 'account', ['Dr side', 'Cr side']);
  return m ? [`${m} (balance it with "Balance c/d")`] : [];
}

// "To" / "By" by side, whatever the writer put.
const lead = (prefix, s) => `${prefix} ${String(s ?? '').trim().replace(/^(to|by)\s+/i, '')}`;

// When both sides have finished appearing (ms), for the Total row; null = auto.
const lastCue = (c, d) => {
  const ts = [cue(c.debit, d.debit.length - 1), cue(c.credit, d.credit.length - 1)].filter((t) => t != null);
  return ts.length ? Math.max(...ts) + 900 : null;
};

function Side({ label, prefix, rows, slots, cues, cols, delay }) {
  return (
    <div className="side">
      <div className="sidelabel">{label}</div>
      <div className="lrow head">{cols.map((h, j) => <div className={`c${j}`}>{h}</div>)}</div>
      <div className="rows" style={{ '--slots': slots }} stagger={350} delay={delay}>
        {rows.map((r, i) => (
          <div className="lrow" anim="riseIn" at={cue(cues, i)}>
            <div className="c0">{r.date || ''}</div>
            <div className="c1"><Rich text={lead(prefix, r.particulars)} /></div>
            <div className="c2">{r.jf || ''}</div>
            <div className="c3 amt">{inr(r.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Ledger(d) {
  const c = d.cues || {};
  const slots = Math.max(d.debit.length, d.credit.length);
  const totalAt = lastCue(c, d);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="taccount" anim="riseIn" delay={300} exit="riseOut">
        <div className="aname"><Rich text={d.account} /></div>
        <div className="sides">
          <Side label="Dr." prefix="To" rows={d.debit} slots={slots} cues={c.debit} cols={d.columns} delay={700} />
          <Side label="Cr." prefix="By" rows={d.credit} slots={slots} cues={c.credit} cols={d.columns} delay={700 + d.debit.length * 350} />
        </div>
        <div className="totals" anim="riseIn" delay={900 + slots * 700} at={totalAt}>
          <div className="trow"><span>Total</span><span className="amt">{inr(total(d.debit, 'amount'))}</span></div>
          <div className="trow"><span>Total</span><span className="amt">{inr(total(d.credit, 'amount'))}</span></div>
        </div>
      </div>
    </>
  );
}
