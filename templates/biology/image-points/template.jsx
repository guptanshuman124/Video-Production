import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Biology deck page 8: image panel on the left; on the right a list of points,
// each a line of description optionally followed by a formula or equation
// (LaTeX, rendered with KaTeX; \ce{} for chemical equations).
// Reference: reference.png

export const meta = {
  name: 'Image + points',
  number: 8,
  aliases: ['bio-08-image-points', 'bio-08', 'bio-8'],
  description: 'Left image panel; right column of point descriptions with optional formulas.',
  duration: 8000,
  slide: {
    type: 'image_points', name: 'Image + points',
    use: 'a figure or graph with 2–5 observations beside it (optional genuine formula per point)',
    image: 'required', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      points: { required: true, items: [2, 5], fields: { text: { required: true, words: 16 }, formula: { note: 'LaTeX, only for a genuine equation' } } },
      caption: { words: 10 },
    },
    reveal: [{ field: 'points', each: true, cue: 'cues.points' }],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  points: { type: 'list', min: 1, max: 6, of: {
    text: { type: 'text', required: true, max: 140 },
    formula: { type: 'text', max: 200, description: 'LaTeX, e.g. "\\\\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}"' },
  } },
  cues: { type: 'object', fields: { points: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function ImagePoints(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />
      <div className="points" stagger={220} delay={500} exitStagger={60} exitDelay={200}>
        {d.points.map((p, i) => (
          <div className="point" anim="riseIn" at={cue(c.points, i)} exit="riseOut">
            <p className="desc"><Rich text={p.text} /></p>
            {p.formula && <div className="formula">{tex(p.formula, { display: true })}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
