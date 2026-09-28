import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Maths deck pages 7–8: a worked example — PROBLEM card, the SOLUTION as 2–6
// numbered steps (each a line of text, maths inline, plus an optional display
// equation), the final ANSWER, and an optional "watch out" line (the common
// mistake or an alternative method); image panel on the right when the
// problem needs its diagram (p7), full width without (p8).
// Reference: reference.png (p7) · reference-08.png

export const meta = {
  name: 'Worked example',
  number: 7,
  aliases: [],
  description: 'PROBLEM, SOLUTION steps (text + optional equation), ANSWER (+ common mistake / alternative); optional image.',
  duration: 14000,
  slide: {
    type: 'solved_example', name: 'Worked example',
    use: 'a solved problem: the problem (with its given values), 2–6 solution steps in the order a student writes them, the final answer; the diagram when a geometry / graph problem needs it',
    image: 'optional', ratios: ['3:4', '2:3', '1:1'],
    fields: {
      problem: { required: true, words: 40, note: 'as NCERT states it; maths inline as $…$' },
      steps: { required: true, items: [2, 6], fields: {
        text: { required: true, words: 14, note: 'what this step does, maths inline as $…$' },
        formula: { note: 'optional: the working of this step, bare LaTeX without $…$' },
      } },
      answer: { required: true, words: 20, note: 'the final answer with its unit, maths as $…$' },
      tip: { words: 18, note: 'optional: the common mistake to avoid, or an alternative method' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'steps', each: true, cue: 'cues.steps' },
      { field: 'answer', cue: 'cues.answer' },
    ],
    question: true,
    narrationWords: [240, 360],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  problemLabel: { type: 'text', default: 'PROBLEM', max: 24 },
  problem: { type: 'text', required: true, max: 320 },
  stepsLabel: { type: 'text', default: 'SOLUTION', max: 24 },
  steps: { type: 'list', min: 1, max: 6, of: {
    text: { type: 'text', required: true, max: 130 },
    formula: { type: 'text', max: 200, description: 'LaTeX' },
  } },
  answerLabel: { type: 'text', default: 'ANSWER', max: 24 },
  answer: { type: 'text', required: true, max: 180 },
  tipLabel: { type: 'text', default: 'Watch out', max: 24 },
  tip: { type: 'text', max: 160 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { problem: 'number', steps: { type: 'list', of: 'number' }, answer: 'number', image: 'number' } },
};

export default function WorkedExample(d) {
  const c = d.cues || {};
  const n = d.steps.length;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'cards with-image' : 'cards'} style={{ '--n': n }}>
        <section className="card problem" anim="riseIn" delay={350} at={sec(c.problem)} exit="riseOut">
          <div className="label">{d.problemLabel}</div>
          <div className="text"><Rich text={d.problem} /></div>
        </section>
        <section className="card solution" anim="riseIn" delay={800} at={cue(c.steps, 0)} exit="riseOut">
          <div className="label">{d.stepsLabel}</div>
          <ol className="steps" stagger={260} delay={1100}>
            {d.steps.map((s, i) => (
              <li anim="riseIn" at={cue(c.steps, i)}>
                <span className="stext"><Rich text={s.text} /></span>
                {s.formula && <span className="seq">{tex(s.formula)}</span>}
              </li>
            ))}
          </ol>
        </section>
        <section className="card answer" anim="riseIn" delay={1900} at={sec(c.answer)} exit="riseOut">
          <div className="label">{d.answerLabel}</div>
          <div className="text strong"><Rich text={d.answer} /></div>
          {d.tip && <div className="tip"><b>{d.tipLabel}:</b> <Rich text={d.tip} /></div>}
        </section>
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
