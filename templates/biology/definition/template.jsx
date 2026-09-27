import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, Bullets, common, cue, sec } from 'hvr/shared';

// Biology deck page 2 (2-column table) and page 3 (3-column table):
// definition line + bulleted properties/types on the left, a small data
// table anchored to the bottom-left, and an image panel on the right.
// References: reference.png (p2), reference-03.png (p3)

export const meta = {
  name: 'Definition + table + image',
  number: 2,
  aliases: ['bio-02-definition-table', 'bio-02', 'bio-2', 'bio-03', 'bio-3'],
  description: 'Definition, bullet points, small bottom table (2–4 columns) and a right image panel.',
  duration: 9000,
  slide: {
    type: 'definition', name: 'Definition',
    use: 'a named concept, process or structure: one-line definition, a few properties, optional small table of its types',
    image: 'optional', ratios: ['3:4', '1:1'],
    fields: {
      definition: { required: true, words: 30 },
      points: { items: [0, 4], words: 12 },
      columns: { items: [0, 3], words: 4 },
      rows: { items: [0, 4], words: 8 },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'definition', cue: 'cues.definition' },
      { field: 'points', each: true, cue: 'cues.points' },
      { field: 'rows', each: true, cue: 'cues.rows' },
    ],
    derive: [{ cue: 'cues.table', from: 'cues.rows', index: 0, offset: -0.6 }],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 40 },
  definition: { type: 'text', max: 200 },
  points: { type: 'list', max: 6, of: { type: 'text', max: 120 }, description: 'bulleted properties / types' },
  columns: { type: 'list', max: 4, of: { type: 'text', max: 30 }, description: 'table heading row (omit for no table)' },
  rows: { type: 'list', max: 6, of: { type: 'list', of: { type: 'text', max: 40 } } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: {
    definition: 'number',
    points: { type: 'list', of: 'number' },
    table: { type: 'number', description: 'heading row' },
    rows: { type: 'list', of: 'number' },
    image: 'number',
  } },
};

export function check(d) {
  const errs = [];
  if (d.rows.length && !d.columns.length) errs.push('rows given without columns');
  d.rows.forEach((r, i) => {
    if (r.length !== d.columns.length) errs.push(`rows[${i}] has ${r.length} cells but there are ${d.columns.length} columns`);
  });
  return errs;
}

export default function DefinitionTable(d) {
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
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
