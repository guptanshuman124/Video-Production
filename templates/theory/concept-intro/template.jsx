import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Theory / Maths deck page 2: the plain-language lead-in before a term,
// formula or theorem is formally named — a title and 1–3 short paragraphs,
// each revealed as the narration reaches it, with an optional image on the
// right (only when the situation is inherently visual).
// Reference: reference.png

export const meta = {
  name: 'Concept intro',
  number: 2,
  aliases: [],
  description: 'Title + 1–3 plain-language paragraphs (staged); optional image panel.',
  duration: 9000,
  slide: {
    type: 'concept_intro', name: 'Concept intro',
    use: 'plain-language lead-in right before a definition / theorem / timeline introduces a new term: the everyday situation or question that makes the idea needed',
    image: 'optional', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      paragraphs: { required: true, items: [1, 3], words: 32, note: 'short plain-language paragraphs, in the order you will say them' },
      caption: { words: 10 },
    },
    reveal: [{ field: 'paragraphs', each: true, cue: 'cues.paragraphs' }],
    narrationWords: [180, 280],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  paragraphs: { type: 'list', min: 1, max: 3, of: { type: 'text', max: 240 } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { paragraphs: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function ConceptIntro(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'body with-image' : 'body'} stagger={400} delay={500} exitStagger={60} exitDelay={200}>
        {d.paragraphs.map((p, i) => <p anim="riseIn" at={cue(c.paragraphs, i)} exit="riseOut"><Rich text={p} /></p>)}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
