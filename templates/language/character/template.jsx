import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Language deck: a character sketch (चरित्र-चित्रण) — the character's name
// and role, then 2–4 traits, each with the moment in the text that shows it.
// Optional picture on the left (an illustration printed with the lesson).

export const meta = {
  name: 'Character sketch',
  number: 9,
  aliases: [],
  description: 'Name and role, then 2–4 trait cards each with evidence from the text; optional image.',
  duration: 12000,
  slide: {
    type: 'character', name: 'Character sketch',
    use: 'a character from the story or play (चरित्र-चित्रण): 2–4 qualities, each proved by what they say or do in the text — the way board answers are written',
    image: 'optional', ratios: ['3:4', '1:1', '2:3', '4:3'],
    fields: {
      name: { required: true, words: 5 },
      role: { words: 12, note: 'who they are in the text, e.g. "the young seagull, afraid to fly"' },
      traits: { required: true, items: [2, 4], fields: {
        trait: { required: true, words: 4, note: 'the quality, e.g. "Brave", "ईमानदार"' },
        evidence: { required: true, words: 24, note: 'what they say or do in the text that shows it' },
      } },
      caption: { words: 10 },
    },
    reveal: [{ field: 'traits', each: true, cue: 'cues.traits' }],
    narrationWords: [230, 340],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  name: { type: 'text', required: true, max: 50 },
  role: { type: 'text', max: 100 },
  traits: { type: 'list', min: 1, max: 4, of: {
    trait: { type: 'text', required: true, max: 36 },
    evidence: { type: 'text', required: true, max: 180 },
  } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { traits: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function Character(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
      <div className={d.image ? 'col with-image' : 'col'}>
        <div className="who" anim="riseIn" delay={400} exit="riseOut">
          <div className="pname"><Rich text={d.name} /></div>
          {d.role && <div className="role"><Rich text={d.role} /></div>}
        </div>
        <div className="traits" style={{ '--n': d.traits.length }} stagger={350} delay={900} exitStagger={50} exitDelay={200}>
          {d.traits.map((t, i) => (
            <section className="trait" anim="riseIn" at={cue(c.traits, i)} exit="riseOut">
              <span className="tname"><Rich text={t.trait} /></span>
              <span className="tev"><Rich text={t.evidence} /></span>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
