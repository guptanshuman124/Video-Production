import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, sec } from 'hvr/shared';

// Commerce deck page 4: a concept, convention, rule or principle explained in
// three stacked cards — STATEMENT (what it says), ILLUSTRATION (a concrete
// business example, amounts in ₹) and WHY IT MATTERS — with an optional image
// panel on the right. Without an image the cards use the full width.
// Reference: reference.png

export const meta = {
  name: 'Principle explained',
  number: 4,
  aliases: [],
  description: 'Statement, illustration (worked business example) and why-it-matters cards; optional image panel.',
  duration: 11000,
  slide: {
    type: 'principle', name: 'Principle / concept explained',
    use: 'an accounting concept or convention (Business Entity, Going Concern, Prudence), a rule or provision (of the Partnership Act, the Companies Act) or a management principle (Unity of Command): what it says, a concrete business example, and why it matters',
    image: 'optional', ratios: ['3:4', '2:3', '1:1'],
    fields: {
      statement: { required: true, words: 35, note: 'what the principle / rule says, in NCERT’s words' },
      illustration: { required: true, words: 45, note: 'a concrete example with named people / firms and ₹ amounts, as NCERT or a board question would give it' },
      significance: { required: true, words: 30, note: 'why it matters: what goes wrong without it, or how it is applied' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'statement', cue: 'cues.statement' },
      { field: 'illustration', cue: 'cues.illustration' },
      { field: 'significance', cue: 'cues.significance' },
    ],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  statementLabel: { type: 'text', default: 'Statement', max: 24 },
  statement: { type: 'text', required: true, max: 260 },
  illustrationLabel: { type: 'text', default: 'Illustration', max: 24 },
  illustration: { type: 'text', required: true, max: 330 },
  significanceLabel: { type: 'text', default: 'Why it matters', max: 24 },
  significance: { type: 'text', required: true, max: 230 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { statement: 'number', illustration: 'number', significance: 'number', image: 'number' } },
};

export default function Principle(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'cards with-image' : 'cards'}>
        <section className="card statement" anim="riseIn" delay={400} at={sec(c.statement)} exit="riseOut">
          <div className="label">{d.statementLabel}</div>
          <div className="text"><Rich text={d.statement} /></div>
        </section>
        <section className="card illustration" anim="riseIn" delay={1000} at={sec(c.illustration)} exit="riseOut">
          <div className="label">{d.illustrationLabel}</div>
          <div className="text"><Rich text={d.illustration} /></div>
        </section>
        <section className="card significance" anim="riseIn" delay={1600} at={sec(c.significance)} exit="riseOut">
          <div className="label">{d.significanceLabel}</div>
          <div className="text"><Rich text={d.significance} /></div>
        </section>
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
