import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Physics deck page 7 (also Chemistry 7): a derivation as step cards joined by
// arrows (each: a line of text, one equation, a step label S1, S2 …), with the
// target equation in a cream "Goal equation" box and a figure on the right.
// Without an image the steps and goal use the full width.
// Reference: reference.png

export const meta = {
  name: 'Derivation',
  number: 7,
  aliases: [],
  description: 'Derivation steps (text + equation, S1…) linked by arrows; goal equation box; optional image panel.',
  duration: 12000,
  slide: {
    type: 'derivation', name: 'Derivation',
    use: 'an NCERT derivation in 2–4 steps, each a short line plus one equation, building to a stated goal equation',
    image: 'optional', ratios: ['1:1', '4:3', '3:4', '3:2'],
    fields: {
      goal: { required: true, note: 'the final result being derived, LaTeX without $…$, e.g. "v^2 = u^2 + 2as"' },
      steps: { required: true, items: [2, 4], fields: {
        text: { required: true, words: 14, note: 'what this step does, e.g. "Substitute t from the first equation"' },
        formula: { required: true, note: 'the equation reached at this step, LaTeX without $…$' },
      } },
      caption: { words: 10 },
    },
    reveal: [{ field: 'steps', each: true, cue: 'cues.steps' }],
    narrationWords: [240, 340],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  goalLabel: { type: 'text', default: 'Goal equation:', max: 30 },
  goal: { type: 'text', required: true, max: 200, description: 'LaTeX' },
  steps: { type: 'list', min: 1, max: 4, of: {
    text: { type: 'text', required: true, max: 110 },
    formula: { type: 'text', required: true, max: 220, description: 'LaTeX' },
  } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { steps: { type: 'list', of: 'number' }, goal: 'number', image: 'number' } },
};

export default function Derivation(d) {
  const c = d.cues || {};
  const n = d.steps.length;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'layout with-image' : 'layout'} style={{ '--n': n }}>
        <div className="steps" stagger={300} delay={700} exitStagger={60} exitDelay={200}>
          {d.steps.map((s, i) => (
            <>
              <section className="step" anim="riseIn" at={cue(c.steps, i)} exit="riseOut">
                <div className="stext"><Rich text={s.text} /></div>
                <div className="seq">{tex(s.formula, { display: true })}</div>
                <div className="slabel">S{i + 1}</div>
              </section>
              {i < n - 1 && <div className="arrow" anim="fadeIn" at={cue(c.steps, i + 1)} exit="fadeOut"><i /></div>}
            </>
          ))}
        </div>
        <aside className="right">
          <section className="goal" anim="riseIn" delay={450} at={sec(c.goal)} exit="riseOut">
            <div className="glabel">{d.goalLabel}</div>
            <div className="geq">{tex(d.goal, { display: true })}</div>
          </section>
          {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
        </aside>
      </div>
    </>
  );
}
