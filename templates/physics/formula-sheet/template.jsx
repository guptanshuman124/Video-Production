import { Rich, tex, cx } from 'hvr';
import { Header, SlideTitle, common, cue, sec } from 'hvr/shared';

// Physics deck pages 15–16 (Chemistry 17–19): a revision grid of formula
// tiles (equation + a small label) with an optional Symbols box. The layout
// follows the count, as in the PDF:
//   with symbols:    ≤6 tiles → wide 2-column (p16): tiles 5–6 at the bottom of the
//                    right column, the Symbols box takes the rest of it ·
//                    7–12 → 4-column grid with the Symbols box top-right (p15)
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
      symbols: { items: [0, 8], fields: {
        symbol: { required: true, note: String.raw`bare LaTeX without $…$, e.g. "\omega", "a_c", "\Delta\theta"` },
        meaning: { required: true, words: 7, note: 'what it is + SI unit in brackets; a unit with a power as $…$, e.g. "angular speed (rad $s^{-1}$)"' },
      } },
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
  symbols: { type: 'list', max: 8, of: {
    symbol: { type: 'text', required: true, max: 40, description: 'LaTeX, rendered as maths' },
    meaning: { type: 'text', required: true, max: 70 },
  } },
  cues: { type: 'object', fields: { items: { type: 'list', of: 'number' }, symbols: 'number' } },
};

const layoutOf = (n, withSymbols) => (withSymbols ? (n <= 6 ? 'wide' : 'grid') : n <= 4 ? 'full' : n <= 8 ? 'wide' : 'grid');
// Grid rows (of 4, 175px each) the Symbols box spans: wide — what tiles 5–6 leave of column 2.
const symbolRows = (n, layout) => (layout === 'wide' ? Math.min(4, 8 - n) : 2);

// Height of the symbol key, measured in the stage (Lecture "Applications of Gauss's Law": 8 one-line
// entries = 433px): padding + header 102, an entry 33px plus 28.6 per extra line, 10px apart.
// A meaning line holds ~60 characters in the one-column key (wide), ~34 in each of the two (grid).
// The estimate is within ~5% of the stage, and the stage shrinks a spilling box down to 70%:
// up to 1.3× the room still fits (shrunk to ~77%).
const FIT_LIMIT = 1.3;
const plain = (s) => String(s || '').replace(/\$|\\[a-zA-Z]+|[{}^_]/g, '');
export function symbolsFit(d) {
  const layout = layoutOf(d.items.length, true);
  const rows = symbolRows(d.items.length, layout);
  const room = rows * 175 + (rows - 1) * 10;
  const cols = layout === 'wide' ? 1 : 2;
  const per = cols === 1 ? 60 : 34;
  const lines = d.symbols.map((s) => Math.max(1, Math.ceil(plain(s.meaning).length / per)));
  let h = 102 - 10;
  for (let i = 0; i < lines.length; i += cols) h += 33 + 28.6 * (Math.max(...lines.slice(i, i + cols)) - 1) + 10;
  return { height: Math.round(h), room, ratio: h / room };
}

export function check(d, opts = {}) {
  const max = d.symbols.length ? 12 : 16;
  if (d.items.length > max) return [`${d.items.length} formulas; at most ${max} fit${d.symbols.length ? ' beside the symbol key' : ''}`];
  if (!d.symbols.length) return [];
  const fit = symbolsFit(d);
  if (opts.fit) return fit;
  return fit.ratio <= FIT_LIMIT ? [] : [`the symbol key needs ~${fit.height}px but has ${fit.room}px beside ${d.items.length} formulas — it would be cut off screen; keep fewer symbols or shorter meanings (or fewer formulas)`];
}

// Cell for tile i in each layout (1-based grid lines).
function cell(layout, i, withSymbols, n) {
  if (layout === 'full') return { gridColumn: '1 / -1', gridRow: `${i + 1}` };
  if (layout === 'wide') {
    if (!withSymbols) return { gridColumn: `${(i % 2) + 1}`, gridRow: `${Math.floor(i / 2) + 1}` };
    // left column top to bottom, then the bottom of the right column, under the Symbols box
    return i < 4 ? { gridColumn: '1', gridRow: `${i + 1}` } : { gridColumn: '2', gridRow: `${i + 5 - n}` };
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
          <section className="tile" style={cell(layout, i, withSymbols, d.items.length)} anim="riseIn" at={cue(c.items, i)} exit="riseOut">
            <div className="teq">{tex(it.formula, { display: true })}</div>
            {it.label && <div className="tlabel"><Rich text={it.label} /></div>}
          </section>
        ))}
        {withSymbols && (
          <section className="symbols" style={layout === 'wide' ? { gridColumn: '2', gridRow: `1 / ${1 + symbolRows(d.items.length, layout)}` } : { gridColumn: '3 / 5', gridRow: '1 / 3' }}
                   anim="riseIn" delay={400} at={sec(c.symbols)} exit="riseOut">
            <div className="shead">{d.symbolsLabel}</div>
            <ul>{d.symbols.map((s) => (
              <li><span className="ssym">{tex(s.symbol)}</span><span className="sdash">–</span><span className="smean"><Rich text={s.meaning} /></span></li>
            ))}</ul>
          </section>
        )}
      </div>
    </>
  );
}
