import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';
import { inr, total, mismatch } from '../money.js';

// Commerce deck page 17: entries in the Journal — the ruled journal table
// (Date · Particulars · L.F. · Debit ₹ · Credit ₹) with 1–3 entries, simple or
// compound: each debit line ends in "Dr.", each credit line is indented and
// starts "To", the narration "(Being …)" sits under them. Below, an optional
// cream box with the rule that decides each debit / credit ("Golden Rule
// Check"). Amounts are numbers; the slide formats them (1,00,000) and the
// check refuses an entry whose debits and credits differ.
// Reference: reference.png

const MAX_ROWS = 10;   // lines + one narration row per entry

export const meta = {
  name: 'Journal entry',
  number: 17,
  aliases: [],
  description: 'Journal table with 1–3 (compound) entries and narrations, plus an optional rule-check box.',
  duration: 12000,
  slide: {
    type: 'journal_entry', name: 'Journal entry',
    use: 'recording 1–3 transactions in the Journal (also the solution right after a practice_problem): date, the accounts debited and credited with amounts, the narration, and the rule that decides each side',
    image: 'none',
    fields: {
      entries: { required: true, items: [1, 3], fields: {
        date: { words: 4, note: 'as in the question, e.g. "01-04-2024" or "2024 Apr 1"' },
        lines: { required: true, items: [2, 5], fields: {
          account: { required: true, words: 6, note: 'account name ending in "A/c" (e.g. "Furniture A/c", "Ramesh’s A/c") — no "Dr." and no "To": code adds them' },
          side: { required: true, note: '"Dr" or "Cr"; all Dr lines first' },
          amount: { required: true, note: 'a plain number in rupees, e.g. 25000 (no commas, no ₹)' },
        } },
        narration: { required: true, words: 14, note: 'starts with "Being …", without brackets' },
      } },
      checks: { items: [0, 3], words: 14, note: 'optional: one line per account with the rule that decides it, e.g. "Furniture A/c → Real Account: debit what comes in"' },
      checksLabel: { words: 4, note: 'optional heading of the checks box; default "Golden Rule Check"' },
    },
    reveal: [
      { field: 'entries', each: true, cue: 'cues.entries' },
      { field: 'checks', each: true, cue: 'cues.checks' },
    ],
    narrationWords: [230, 340],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Journal Entry', max: 60 },
  columns: { type: 'list', min: 5, max: 5, of: { type: 'text', max: 16 }, default: ['Date', 'Particulars', 'L.F.', 'Debit (₹)', 'Credit (₹)'] },
  entries: { type: 'list', min: 1, max: 3, of: {
    date: { type: 'text', max: 20 },
    lines: { type: 'list', min: 2, max: 5, of: {
      account: { type: 'text', required: true, max: 48 },
      side: { type: 'enum', values: ['Dr', 'Cr'], required: true },
      amount: { type: 'number', required: true, min: 0 },
    } },
    narration: { type: 'text', required: true, max: 110 },
  } },
  checksLabel: { type: 'text', default: 'Golden Rule Check', max: 30 },
  checks: { type: 'list', max: 3, of: { type: 'text', max: 120 } },
  cues: { type: 'object', fields: { entries: { type: 'list', of: 'number' }, checks: { type: 'list', of: 'number' } } },
};

export function check(d) {
  const errs = [];
  let rows = 0;
  d.entries.forEach((e, i) => {
    const dr = e.lines.filter((l) => l.side === 'Dr'), cr = e.lines.filter((l) => l.side === 'Cr');
    rows += e.lines.length + 1;
    if (!dr.length || !cr.length) errs.push(`entries[${i}]: needs at least one Dr and one Cr line`);
    else if (e.lines.findIndex((l) => l.side === 'Cr') < e.lines.findLastIndex((l) => l.side === 'Dr')) errs.push(`entries[${i}]: put every Dr line before the Cr lines`);
    const m = mismatch(total(dr, 'amount'), total(cr, 'amount'), `entries[${i}]`);
    if (m) errs.push(m);
  });
  if (rows > MAX_ROWS) errs.push(`${rows} table rows (lines + narrations); at most ${MAX_ROWS} fit — split the entries over two slides`);
  return errs;
}

// The writer gives bare account names; drop a stray "To" / "Dr." it added anyway.
const bare = (s) => String(s ?? '').trim().replace(/^to\s+/i, '').replace(/[\s.…]*\bdr\.?$/i, '');
const unbracket = (s) => String(s ?? '').trim().replace(/^\(+|\)+$/g, '');

export default function JournalEntry(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="wrap">
        <div className="journal" anim="riseIn" delay={300} exit="riseOut">
          <div className="jrow head">{d.columns.map((h, j) => <div className={`c${j}`}>{h}</div>)}</div>
          <div className="entries" stagger={600} delay={700}>
            {d.entries.map((e, i) => (
              <div className="entry" anim="riseIn" at={cue(c.entries, i)}>
                {e.lines.map((l, k) => (
                  <div className={l.side === 'Dr' ? 'jrow dr' : 'jrow cr'}>
                    <div className="c0">{k === 0 ? e.date : ''}</div>
                    <div className="c1">
                      {l.side === 'Dr'
                        ? <><span className="acc"><Rich text={bare(l.account)} /></span><span className="drmark">Dr.</span></>
                        : <span className="acc">To <Rich text={bare(l.account)} /></span>}
                    </div>
                    <div className="c2" />
                    <div className="c3 amt">{l.side === 'Dr' ? inr(l.amount) : ''}</div>
                    <div className="c4 amt">{l.side === 'Cr' ? inr(l.amount) : ''}</div>
                  </div>
                ))}
                <div className="jrow narr"><div className="c0" /><div className="c1">(<Rich text={unbracket(e.narration)} />)</div></div>
              </div>
            ))}
          </div>
        </div>
        {d.checks.length > 0 && (
          <section className="checks" anim="riseIn" delay={1400} at={cue(c.checks, 0)} exit="riseOut">
            <div className="label">{d.checksLabel}</div>
            <ul stagger={300} delay={1500}>
              {d.checks.map((t, i) => <li anim="riseIn" at={cue(c.checks, i)}><Rich text={t} /></li>)}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
