import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Physics deck page 11 (also Chemistry 11): teal slide for a numerical —
// PROBLEM card, the solution steps as a list, and the result in a cream
// FINAL ANSWER card at the bottom; optional image panel on the right.
// Reference: reference.png

export const meta = {
  name: 'Numerical (problem → steps → final answer)',
  number: 11,
  aliases: [],
  description: 'PROBLEM card, solution steps, FINAL ANSWER card (large value); optional image panel.',
  duration: 12000,
  slide: {
    type: 'solved_example', name: 'Solved numerical',
    use: 'a numerical: the problem with its given values, 2–5 solution steps (formula, substitution, calculation), one final answer with its unit',
    image: 'optional', ratios: ['3:4', '2:3', '1:1'],
    fields: {
      problem: { required: true, words: 50, note: 'the question with all given values and units' },
      steps: { required: true, items: [2, 5], words: 16, note: 'each step on one line; formulas inline as $…$' },
      answer: { required: true, words: 6, note: 'the final value with unit, e.g. "2.38 km/s"' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'steps', each: true, cue: 'cues.steps' },
      { field: 'answer', cue: 'cues.answer' },
    ],
    question: true,
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  problemLabel: { type: 'text', default: 'PROBLEM', max: 24 },
  problem: { type: 'text', required: true, max: 320 },
  steps: { type: 'list', max: 6, of: { type: 'text', max: 140 } },
  answerLabel: { type: 'text', default: 'FINAL ANSWER', max: 24 },
  answer: { type: 'text', max: 60 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { problem: 'number', steps: { type: 'list', of: 'number' }, answer: 'number', image: 'number' } },
};

export default function Numerical(d) {
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
        <ul className="steps" stagger={260} delay={900} exitStagger={60} exitDelay={200}>
          {d.steps.map((s, i) => <li anim="riseIn" at={cue(c.steps, i)} exit="riseOut"><Rich text={s} /></li>)}
        </ul>
        {d.answer && (
          <section className="card answer" anim="riseIn" delay={1800} at={sec(c.answer)} exit="riseOut">
            <div className="label">{d.answerLabel}</div>
            <div className="value"><Rich text={d.answer} /></div>
          </section>
        )}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
