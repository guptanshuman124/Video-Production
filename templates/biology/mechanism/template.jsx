import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Biology deck page 9: lavender slide. Image panel on the left; on the right
// one or more sections, each a bold navy heading ("Mechanism / Concept used")
// with an explanation paragraph and optional bullet points.
// Reference: reference.png

export const meta = {
  name: 'Mechanism / concept',
  number: 9,
  aliases: ['bio-09-mechanism', 'bio-09', 'bio-9'],
  description: 'Lavender slide: left image panel; right heading + explanation sections.',
  duration: 9000,
  slide: {
    type: 'mechanism', name: 'Mechanism / process',
    use: 'how something works, in 2–3 headed stages beside a figure',
    image: 'required', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      sections: { required: true, items: [2, 3], fields: {
        heading: { required: true, words: 6 }, text: { words: 30 }, points: { items: [0, 4], words: 12 },
      } },
      caption: { words: 10 },
    },
    reveal: [{ field: 'sections', each: true, cue: 'cues.sections' }],
    narrationWords: [240, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  sections: { type: 'list', min: 1, max: 4, of: {
    heading: { type: 'text', required: true, max: 60 },
    text: { type: 'text', max: 400 },
    points: { type: 'list', max: 6, of: { type: 'text', max: 120 } },
  } },
  cues: { type: 'object', fields: { sections: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function Mechanism(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />
      <div className="sections" stagger={260} delay={500} exitStagger={60} exitDelay={200}>
        {d.sections.map((s, i) => (
          <section className="sec" anim="riseIn" at={cue(c.sections, i)} exit="riseOut">
            <h2><Rich text={s.heading} /></h2>
            {s.text && <p><Rich text={s.text} /></p>}
            {s.points.length > 0 && <ul className="bullets">{s.points.map((p) => <li><Rich text={p} /></li>)}</ul>}
          </section>
        ))}
      </div>
    </>
  );
}
