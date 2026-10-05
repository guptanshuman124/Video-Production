// Amounts on the accounting slides. The writer gives every amount as a plain
// number (25000); the slide shows it in the Indian system (25,000 · 1,00,000)
// and works out every total itself, so a column can never be mis-added.
// Every check here is also what the pipeline's content gate runs (check()).

export const isAmount = (v) => typeof v === 'number' && Number.isFinite(v);

// 125000 -> "1,25,000"; 1250.5 -> "1,250.50"; null/undefined -> "".
export function inr(v) {
  if (!isAmount(v)) return '';
  const frac = Math.round(v * 100) % 100 !== 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
}

// Sum of `key` over rows (or of the numbers themselves), rounded to paise.
export const total = (rows, key) => Math.round(rows.reduce((s, r) => s + (Number(key ? r?.[key] : r) || 0), 0) * 100) / 100;

// "Dr side 50,000 ≠ Cr side 45,000" when two totals differ, else null.
export function mismatch(a, b, what, [la, lb] = ['debit', 'credit']) {
  return Math.abs(a - b) < 0.005 ? null : `${what}: ${la} total ${inr(a)} ≠ ${lb} total ${inr(b)} — the two sides must agree`;
}
