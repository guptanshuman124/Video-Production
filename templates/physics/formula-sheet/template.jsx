import { Rich, tex, cx } from 'hvr';
import { Header, SlideTitle, common, cue, sec } from 'hvr/shared';

// Physics deck pages 15–16 (Chemistry 17–19): a revision grid of formula
// tiles (equation + a small label) with an optional Symbols box. The layout
// follows the count, as in the PDF:
//   with symbols:    ≤6 tiles → wide 2-column (p16) · 7–12 → 4-column grid with
//                    the Symbols box top-right (p15)
//   without symbols: ≤4 → full-width rows (Chem p17) · 5–8 → 2 columns · 9–16 → 4×4
// Reference: reference.png (p15) · reference-16.png

export const meta = {
  name: 'Formula sheet',
  number: 15,
  aliases: [],
  description: 'Grid of formula tiles (equation + label) with optional symbol key; layout adapts to the count.',
  duration: 12000,
  slide: {
    type: 'formula_sheet', name: 'Formula sheet',
    use: 'rapid revision of formulas already taught in this lecture (4–12), each with a short label, plus an optional symbol key; only at the end of a lecture',
    image: 'none',
    fields: {
      items: { required: true, items: [4, 12], fields: {
        formula: { required: true, note: 'LaTeX without $…$' },
        label: { required: true, words: 5, note: 'what the formula is, e.g. "Ohm’s law"' },
      } },
      symbols: { items: [0, 8], words: 8, note: 'one symbol per line, e.g. "R – resistance (Ω)"' },
    },
    reveal: [
      { field: 'items', each: true, cue: 'cues.items' },
      { field: 'symbols', cue: 'cues.symbols' },
    ],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Formula sheet', max: 40 },
  items: { type: 'list', min: 1, max: 16, of: {
    formula: { type: 'text', required: true, max: 160, description: 'LaTeX' },
    label: { type: 'text', max: 40 },
  } },
  symbolsLabel: { type: 'text', default: 'Symbols', max: 24 },
  symbols: { type: 'list', max: 8, of: { type: 'text', max: 60 } },
  cues: { type: 'object', fields: { items: { type: 'list', of: 'number' }, symbols: 'number' } },
};

export function check(d) {
  const max = d.symbols.length ? 12 : 16;
  return d.items.length > max ? [`${d.items.length} formulas; at most ${max} fit${d.symbols.length ? ' beside the symbol key' : ''}`] : [];
}

const layoutOf = (n, withSymbols) => (withSymbols ? (n <= 6 ? 'wide' : 'grid') : n <= 4 ? 'full' : n <= 8 ? 'wide' : 'grid');

// Cell for tile i in each layout (1-based grid lines).
function cell(layout, i, withSymbols) {
  if (layout === 'full') return { gridColumn: '1 / -1', gridRow: `${i + 1}` };
  if (layout === 'wide') {
    if (!withSymbols) return { gridColumn: `${(i % 2) + 1}`, gridRow: `${Math.floor(i / 2) + 1}` };
    // left column top to bottom, then the right column under the Symbols box
    return i < 4 ? { gridColumn: '1', gridRow: `${i + 1}` } : { gridColumn: '2', gridRow: `${i - 1}` };
  }
  if (!withSymbols) return { gridColumn: `${(i % 4) + 1}`, gridRow: `${Math.floor(i / 4) + 1}` };
  // rows 1–2: two tiles each (Symbols box spans columns 3–4); rows 3–4: four each
  return i < 4 ? { gridColumn: `${(i % 2) + 1}`, gridRow: `${Math.floor(i / 2) + 1}` }
    : { gridColumn: `${((i - 4) % 4) + 1}`, gridRow: `${Math.floor((i - 4) / 4) + 3}` };
}

export default function FormulaSheet(d) {
  const c = d.cues || {};
  const withSymbols = d.symbols.length > 0;
  const layout = layoutOf(d.items.length, withSymbols);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={cx('sheet', `l-${layout}`)} stagger={120} delay={500} exitStagger={40} exitDelay={200}>
        {d.items.map((it, i) => (
          <section className="tile" style={cell(layout, i, withSymbols)} anim="riseIn" at={cue(c.items, i)} exit="riseOut">
            <div className="teq">{tex(it.formula, { display: true })}</div>
            {it.label && <div className="tlabel"><Rich text={it.label} /></div>}
          </section>
        ))}
        {withSymbols && (
          <section className="symbols" style={layout === 'wide' ? { gridColumn: '2', gridRow: '1 / 3' } : { gridColumn: '3 / 5', gridRow: '1 / 3' }}
                   anim="riseIn" delay={400} at={sec(c.symbols)} exit="riseOut">
            <div className="shead">{d.symbolsLabel}</div>
            <ul>{d.symbols.map((s) => <li><Rich text={s} /></li>)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
