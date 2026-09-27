import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Chemistry deck pages 12–13 (also used by physics): teal slide for a board
// question — PROBLEM card, the answer's reasoning lines in a cream REASONING
// box, and a KEY TAKEAWAY card; optional image panel on the right (p12),
// full width without one (p13).
// Reference: reference.png (p12) · reference-13.png

export const meta = {
  name: 'Board answer (problem → reasoning → key takeaway)',
  number: 12,
  aliases: [],
  description: 'PROBLEM card, REASONING lines (cream), KEY TAKEAWAY card; optional image panel.',
  duration: 12000,
  slide: {
    type: 'descriptive_answer', name: 'Board answer (short / long)',
    use: 'a CBSE short- or long-answer question: the question with its marks, the answer as 2–5 reasoning lines in the order a student should write them, and a one-line takeaway',
    image: 'optional', ratios: ['3:4', '2:3'],
    fields: {
      problem: { required: true, words: 35, note: 'the question as asked in a board paper, with marks, e.g. "(3 marks)"' },
      reasoning: { required: true, items: [2, 5], words: 18, note: 'the answer points, in order' },
      takeaway: { required: true, words: 20, note: 'one-line takeaway' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'reasoning', each: true, cue: 'cues.reasoning' },
      { field: 'takeaway', cue: 'cues.takeaway' },
    ],
    question: true,
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  problemLabel: { type: 'text', default: 'PROBLEM', max: 24 },
  problem: { type: 'text', required: true, max: 260 },
  reasoningLabel: { type: 'text', default: 'REASONING', max: 24 },
  reasoning: { type: 'list', max: 6, of: { type: 'text', max: 150 } },
  takeawayLabel: { type: 'text', default: 'KEY TAKEAWAY', max: 24 },
  takeaway: { type: 'text', max: 180 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { problem: 'number', reasoning: { type: 'list', of: 'number' }, takeaway: 'number', image: 'number' } },
};

export default function BoardAnswer(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'cards with-image' : 'cards'}>
        <section className="card problem" anim="riseIn" delay={350} at={sec(c.problem)} exit="riseOut">
          <div className="label">{d.problemLabel}</div>
          <div className="text"><Rich text={d.problem} /></div>
        </section>
        <section className="card reasoning" anim="riseIn" delay={800} at={cue(c.reasoning, 0)} exit="riseOut">
          <div className="label">{d.reasoningLabel}</div>
          <div className="lines" stagger={260} delay={1100}>
            {d.reasoning.map((r, i) => <p anim="riseIn" at={cue(c.reasoning, i)}><Rich text={r} /></p>)}
          </div>
        </section>
        {d.takeaway && (
          <section className="card takeaway" anim="riseIn" delay={1900} at={sec(c.takeaway)} exit="riseOut">
            <div className="label">{d.takeawayLabel}</div>
            <div className="text"><Rich text={d.takeaway} /></div>
          </section>
        )}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
