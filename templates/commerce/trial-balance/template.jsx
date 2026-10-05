import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';
import { inr, isAmount, total, mismatch } from '../money.js';

// Commerce deck page 20: a Trial Balance — "as at …" under the title, then
// Particulars · Debit ₹ · Credit ₹ rows (each account on one side only) and a
// Total row. The totals are worked out here, and the check refuses a trial
// balance that does not agree.
// Reference: reference.png

export const meta = {
  name: 'Trial balance',
  number: 20,
  aliases: [],
  description: 'Trial Balance table (account · debit · credit) with an "as at" line and computed, agreeing totals.',
  duration: 12000,
  slide: {
    type: 'trial_balance', name: 'Trial balance',
    use: 'a Trial Balance prepared from ledger balances: 3–9 accounts, each with its balance on the debit or the credit side, totals agreeing — or as the solution after a practice_problem',
    image: 'none',
    fields: {
      asAt: { words: 6, note: 'e.g. "as at 31st March 2024"' },
      rows: { required: true, items: [3, 9], fields: {
        account: { required: true, words: 6, note: 'e.g. "Capital A/c", "Cash in Hand"' },
        debit: { note: 'debit balance as a plain number, or null' },
        credit: { note: 'credit balance as a plain number, or null' },
      } },
    },
    reveal: [{ field: 'rows', each: true, cue: 'cues.rows' }],
    narrationWords: [220, 330],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Trial Balance', max: 60 },
  asAt: { type: 'text', max: 50 },
  columns: { type: 'list', min: 3, max: 3, of: { type: 'text', max: 16 }, default: ['Particulars', 'Debit ₹', 'Credit ₹'] },
  rows: { type: 'list', min: 1, max: 9, of: {
    account: { type: 'text', required: true, max: 50 },
    debit: { type: 'number', min: 0 },
    credit: { type: 'number', min: 0 },
  } },
  cues: { type: 'object', fields: { rows: { type: 'list', of: 'number' } } },
};

export function check(d) {
  const errs = [];
  d.rows.forEach((r, i) => {
    if (isAmount(r.debit) === isAmount(r.credit)) errs.push(`rows[${i}] (${r.account}): give the balance on exactly one side — debit or credit`);
  });
  const m = mismatch(total(d.rows, 'debit'), total(d.rows, 'credit'), 'trial balance');
  if (m) errs.push(m);
  return errs;
}

export default function TrialBalance(d) {
  const c = d.cues || {};
  const last = cue(c.rows, d.rows.length - 1);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="tb">
        {d.asAt && <div className="asat" anim="fadeIn" delay={350} exit="fadeOut">{d.asAt}</div>}
        <div className="trow head" anim="riseIn" delay={450} exit="riseOut">{d.columns.map((h, j) => <div className={`c${j}`}>{h}</div>)}</div>
        <div className="rows" stagger={260} delay={800} exitStagger={40} exitDelay={200}>
          {d.rows.map((r, i) => (
            <div className={i % 2 ? 'trow alt' : 'trow'} anim="riseIn" at={cue(c.rows, i)} exit="riseOut">
              <div className="c0"><Rich text={r.account} /></div>
              <div className="c1 amt">{inr(r.debit)}</div>
              <div className="c2 amt">{inr(r.credit)}</div>
            </div>
          ))}
        </div>
        <div className="trow total" anim="riseIn" delay={1000 + d.rows.length * 260} at={last == null ? null : last + 900} exit="riseOut">
          <div className="c0">Total</div>
          <div className="c1 amt">{inr(total(d.rows, 'debit'))}</div>
          <div className="c2 amt">{inr(total(d.rows, 'credit'))}</div>
        </div>
      </div>
    </>
  );
}
