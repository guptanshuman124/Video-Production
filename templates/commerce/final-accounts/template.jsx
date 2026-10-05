import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';
import { inr, total, mismatch } from '../money.js';

// Commerce deck page 24 ("Trading & P&L Account"): one or two accounts in
// T-form, stacked — each with its name centred over a rule, Dr. items on the
// left ("To …"), Cr. items on the right ("By …"), and a Total row under both
// sides. Serves the Trading and Profit & Loss Accounts, the P&L Appropriation
// Account, the Revaluation and Realisation Accounts. Totals are worked out
// here; the check refuses an account whose sides differ (balance it with the
// gross / net profit or loss line). With one account it gets the full height.
// Reference: reference.png

export const meta = {
  name: 'Final accounts (T-form)',
  number: 24,
  aliases: [],
  description: '1–2 stacked T-form accounts (Dr. "To …" | Cr. "By …") with computed, agreeing totals.',
  duration: 13000,
  slide: {
    type: 'final_accounts', name: 'Trading / P&L account (T-form)',
    use: 'one or two accounts in T-form — the Trading Account and the Profit & Loss Account, the P&L Appropriation Account, the Revaluation or Realisation Account — each balanced by its profit / loss line; or the solution after a practice_problem',
    image: 'none',
    fields: {
      accounts: { required: true, items: [1, 2], fields: {
        name: { required: true, words: 7, note: 'e.g. "Trading Account for the year ended 31st March 2024"' },
        debit: { required: true, items: [1, 6], fields: {
          particulars: { required: true, words: 8, note: 'without "To" (code adds it), e.g. "Opening Stock", "Gross Profit c/d"' },
          amount: { required: true, note: 'a plain number in rupees' },
        } },
        credit: { required: true, items: [1, 6], fields: {
          particulars: { required: true, words: 8, note: 'without "By" (code adds it), e.g. "Sales", "Closing Stock"' },
          amount: { required: true, note: 'a plain number in rupees' },
        } },
      } },
    },
    reveal: [{ field: 'accounts', each: true, parts: ['debit', 'credit'], cue: 'cues.accounts' }],
    narrationWords: [260, 380],
  },
};

const line = { particulars: { type: 'text', required: true, max: 60 }, amount: { type: 'number', required: true, min: 0 } };

export const schema = {
  ...common,
  title: { type: 'text', default: 'Trading & P&L Account', max: 60 },
  accounts: { type: 'list', min: 1, max: 2, of: {
    name: { type: 'text', required: true, max: 70 },
    debit: { type: 'list', min: 1, max: 6, of: line },
    credit: { type: 'list', min: 1, max: 6, of: line },
  } },
  cues: { type: 'object', fields: { accounts: { type: 'list', of: 'any' } } },
};

export function check(d) {
  const errs = [];
  d.accounts.forEach((a, i) => {
    const m = mismatch(total(a.debit, 'amount'), total(a.credit, 'amount'), `accounts[${i}] (${a.name})`, ['Dr side', 'Cr side']);
    if (m) errs.push(`${m} (balance it with the profit / loss line)`);
  });
  if (d.accounts.length === 2 && d.accounts.some((a) => Math.max(a.debit.length, a.credit.length) > 4)) {
    errs.push('with two accounts on one slide, each side takes at most 4 lines — put a longer account on its own slide');
  }
  return errs;
}

const lead = (prefix, s) => `${prefix} ${String(s ?? '').trim().replace(/^(to|by)\s+/i, '')}`;
// cues.accounts[i] = [debit side, credit side] in ms (parts), either may be null.
const partAt = (c, i, p) => { const v = c.accounts?.[i]; const t = Array.isArray(v) ? v[p] : p === 0 ? v : null; return typeof t === 'number' ? t * 1000 : null; };

export default function FinalAccounts(d) {
  const c = d.cues || {};
  const two = d.accounts.length === 2;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={two ? 'stack two' : 'stack'}>
        {d.accounts.map((a, i) => {
          const slots = Math.max(a.debit.length, a.credit.length);
          const base = 500 + i * 2600;
          const drAt = partAt(c, i, 0), crAt = partAt(c, i, 1);
          const totAt = crAt ?? drAt;
          const side = (rows, prefix, at, delay) => (
            <div className="side" anim="riseIn" delay={delay} at={at}>
              <div className="sidelabel">{prefix === 'To' ? 'Dr.' : 'Cr.'}</div>
              <div className="lines" style={{ '--slots': slots }}>
                {rows.map((r) => <div className="aline"><span><Rich text={lead(prefix, r.particulars)} /></span><span className="amt">{inr(r.amount)}</span></div>)}
              </div>
              <div className="atotal" anim="fadeIn" delay={delay + 900} at={totAt == null ? null : totAt + 1200}>
                <span>Total</span><span className="amt">{inr(total(rows, 'amount'))}</span>
              </div>
            </div>
          );
          return (
            <section className="account" anim="fadeIn" delay={base} at={drAt == null ? null : drAt - 400} exit="riseOut">
              <div className="aname"><Rich text={a.name} /></div>
              <div className="sides">
                {side(a.debit, 'To', drAt, base + 300)}
                {side(a.credit, 'By', crAt, base + 1200)}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
