// Commerce pack (Accountancy + Business Studies): the accounting formats
// balance in code, Business Studies never sees them, and a practice problem
// is always answered on the next slide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplates, loadPacks, packFor } from '../src/templates.js';
import { slideTypes, checkSlideData, requiredMarkers } from '../src/slides.js';
import { gateLecturePlan } from '../src/validators/generation.js';
import { flowRules } from '../src/generation/prompts.js';
import { inr, total } from '../templates/commerce/money.js';

const T = slideTypes(await buildTemplates()).commerce;
const pack = loadPacks().commerce;
const errors = (r) => r.issues.filter((i) => i.severity === 'error');

test('amounts show in the Indian system', () => {
  assert.equal(inr(125000), '1,25,000');
  assert.equal(inr(25000), '25,000');
  assert.equal(inr(1250.5), '1,250.50');
  assert.equal(inr(null), '');
  assert.equal(total([{ a: 0.1 }, { a: 0.2 }], 'a'), 0.3);
});

test('journal entry: debits must equal credits, Dr lines first, rows must fit', () => {
  const entry = (lines) => ({ title: 'J', entries: [{ date: '01-04-2024', lines, narration: 'Being furniture purchased for cash' }] });
  const ok = checkSlideData(T.journal_entry, entry([{ account: 'Furniture A/c', side: 'Dr', amount: 25000 }, { account: 'Cash A/c', side: 'Cr', amount: 25000 }]));
  assert.deepEqual(errors(ok), []);
  const off = checkSlideData(T.journal_entry, entry([{ account: 'Furniture A/c', side: 'Dr', amount: 25000 }, { account: 'Cash A/c', side: 'Cr', amount: 20000 }]));
  assert.ok(errors(off).some((i) => /debit total 25,000 ≠ credit total 20,000/.test(i.message)));
  const order = checkSlideData(T.journal_entry, entry([{ account: 'Cash A/c', side: 'Cr', amount: 100 }, { account: 'Rent A/c', side: 'Dr', amount: 100 }]));
  assert.ok(errors(order).some((i) => /Dr line before/.test(i.message)));
  const big = { title: 'J', entries: Array.from({ length: 3 }, () => ({ lines: [1, 2, 3, 4].map((k) => ({ account: `A${k} A/c`, side: k === 4 ? 'Cr' : 'Dr', amount: k === 4 ? 6 : 2 })), narration: 'Being x' })) };
  assert.ok(errors(checkSlideData(T.journal_entry, big)).some((i) => /at most 10 fit/.test(i.message)));
});

test('ledger, trial balance, balance sheet and final accounts must agree', () => {
  const ledger = (c) => ({ title: 'L', account: 'Cash Account', debit: [{ particulars: 'Balance b/d', amount: 50000 }], credit: [{ particulars: 'Furniture A/c', amount: 25000 }, { particulars: 'Balance c/d', amount: c }] });
  assert.deepEqual(errors(checkSlideData(T.ledger, ledger(25000))), []);
  assert.ok(errors(checkSlideData(T.ledger, ledger(20000))).some((i) => /Balance c\/d/.test(i.message)));

  const tb = checkSlideData(T.trial_balance, { title: 'TB', rows: [{ account: 'Capital A/c', credit: 100 }, { account: 'Cash', debit: 60 }, { account: 'Stock', debit: 30, credit: 10 }] });
  assert.ok(errors(tb).some((i) => /exactly one side/.test(i.message)));
  assert.ok(errors(tb).some((i) => /trial balance/.test(i.message)));

  const bs = checkSlideData(T.balance_sheet, { title: 'BS', liabilities: [{ item: 'Capital', amount: 100 }], assets: [{ item: 'Cash', amount: 90 }] });
  assert.ok(errors(bs).some((i) => /liabilities total 100 ≠ assets total 90/.test(i.message)));

  const fa = checkSlideData(T.final_accounts, { title: 'F', accounts: [{ name: 'Trading Account', debit: [{ particulars: 'Purchases', amount: 60 }], credit: [{ particulars: 'Sales', amount: 100 }] }] });
  assert.ok(errors(fa).some((i) => /profit \/ loss line/.test(i.message)));
});

test('final accounts reveal each side of each account (two markers per account)', () => {
  const d = { accounts: [{ name: 'Trading', debit: [{ particulars: 'Purchases', amount: 60 }], credit: [{ particulars: 'Sales', amount: 60 }] }] };
  assert.deepEqual(requiredMarkers(T.final_accounts.spec, d), ['b1.1.1', 'b1.1.2']);
});

test('Business Studies: the bookkeeping slides are switched off; Accountancy keeps them', () => {
  const bst = packFor(pack, 'business-studies');
  for (const t of ['journal_entry', 'ledger', 'trial_balance', 'final_accounts', 'balance_sheet', 'adjustment', 'practice_problem']) {
    assert.equal(bst.types[t].max, 0, t);
    assert.ok(!flowRules(bst).includes(`- ${t}:`), `${t} not offered in the flow rules`);
  }
  assert.ok(bst.types.case_study.max >= 2);
  assert.equal(packFor(pack, 'accountancy').types.journal_entry.max, pack.types.journal_entry.max);
  assert.equal(packFor(pack, null), pack);
});

const slide = (slide_type, extra = {}) => ({ slide_type, title: 't', purpose: 'p', key_points: ['k'], source_refs: ['s1'], image_id: null, ...extra });
const ctx = { lecture: 2, lectures: 5, sectionIds: ['s1'], pack, types: T, budget: { min: 3, max: 14 }, images: [] };

test('a practice problem must be followed by its worked solution', () => {
  const plan = (after) => ({ lecture_title: 'Journal', slides: [slide('intro', { source_refs: [] }), slide('rule_cards'), slide('illustration'), slide('practice_problem'), slide(after), slide('quick_revision', { source_refs: [] }), slide('mcq')] });
  const good = gateLecturePlan(plan('journal_entry'), ctx);
  assert.ok(!good.issues.some((i) => i.code === 'FLOW_ORDER'), JSON.stringify(errors(good)));
  const bad = gateLecturePlan(plan('comparison'), ctx);
  assert.ok(bad.issues.some((i) => i.code === 'FLOW_ORDER' && /worked solution/.test(i.message)));
});
