import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, Bullets, common, cue, sec } from 'hvr/shared';

// Physics deck pages 2–3 (also Chemistry 2–3): definition, bullet points, a
// small table, and a lavender formula box ("Formula for …", the equation,
// a symbol key) stacked above the bottom edge; image panel on the right.
// Reference: reference.png (p2, 2 columns) · reference-03.png (p3, 3 columns)

export const meta = {
  name: 'Definition + table + formula + image',
  number: 2,
  aliases: [],
  description: 'Definition, bullets, small table (2–4 columns), formula box with symbol key, right image panel.',
  duration: 9000,
  slide: {
    type: 'definition', name: 'Definition',
    use: 'a named quantity, law or concept: one-line definition, a few properties, optional small table, and its formula with a symbol key when one exists',
    image: 'optional', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      definition: { required: true, words: 30 },
      points: { items: [0, 3], words: 12 },
      columns: { items: [0, 3], words: 4 },
      rows: { items: [0, 3], words: 8 },
      formulaFor: { words: 6, note: 'what the formula gives, e.g. "kinetic energy" (shown as "Formula for …")' },
      formula: { note: 'LaTeX without $…$, e.g. "K = \\frac{1}{2} m v^2" — only a genuine NCERT formula' },
      symbols: { words: 18, note: 'symbol key, e.g. "m – mass (kg) · v – speed (m/s)"' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'definition', cue: 'cues.definition' },
      { field: 'points', each: true, cue: 'cues.points' },
      { field: 'rows', each: true, cue: 'cues.rows' },
      { field: 'formula', cue: 'cues.formula' },
    ],
    derive: [{ cue: 'cues.table', from: 'cues.rows', index: 0, offset: -0.6 }],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 40 },
  definition: { type: 'text', max: 200 },
  points: { type: 'list', max: 5, of: { type: 'text', max: 110 } },
  columns: { type: 'list', max: 4, of: { type: 'text', max: 30 } },
  rows: { type: 'list', max: 4, of: { type: 'list', of: { type: 'text', max: 40 } } },
  formulaFor: { type: 'text', max: 50 },
  formula: { type: 'text', max: 200, description: 'LaTeX, rendered as a display equation' },
  symbols: { type: 'text', max: 160 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: {
    definition: 'number', points: { type: 'list', of: 'number' }, table: 'number',
    rows: { type: 'list', of: 'number' }, formula: 'number', image: 'number',
  } },
};

export function check(d) {
  const errs = [];
  if (d.rows.length && !d.columns.length) errs.push('rows given without columns');
  d.rows.forEach((r, i) => { if (r.length !== d.columns.length) errs.push(`rows[${i}] has ${r.length} cells but there are ${d.columns.length} columns`); });
  if ((d.formulaFor || d.symbols) && !d.formula) errs.push('formulaFor/symbols given without a formula');
  return errs;
}

export default function DefinitionFormula(d) {
  const c = d.cues || {};
  const n = d.columns.length;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'body' : 'body wide'}>
      <div className="copy">
        {d.definition && <p className="definition" anim="riseIn" delay={350} at={sec(c.definition)} exit="riseOut"><Rich text={d.definition} /></p>}
        <Bullets items={d.points} delay={550} ats={(c.points || []).map((t) => t * 1000)} />
      </div>
      <div className="stack">
        {n > 0 && (
          <div className="dtable" style={{ '--n': n }} stagger={110} delay={800} exitStagger={50} exitDelay={250}>
            <div className="drow head" anim="riseIn" at={sec(c.table)} exit="riseOut">
              {d.columns.map((h) => <div className="dcell"><Rich text={h} /></div>)}
            </div>
            {d.rows.map((r, i) => (
              <div className="drow" anim="riseIn" at={cue(c.rows, i)} exit="riseOut">
                {r.map((v) => <div className="dcell"><Rich text={v} /></div>)}
              </div>
            ))}
          </div>
        )}
        {d.formula && (
          <section className="fbox" anim="riseIn" delay={1100} at={sec(c.formula)} exit="riseOut">
            <div className="flabel">Formula for{d.formulaFor ? <> <Rich text={d.formulaFor} /></> : ''}</div>
            <div className="feq">{tex(d.formula, { display: true })}</div>
            {d.symbols && <div className="fsym"><Rich text={d.symbols} /></div>}
          </section>
        )}
      </div>
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
