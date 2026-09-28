import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Maths deck page 6: the proof of the theorem on the previous slide —
// TO PROVE and GIVEN cards on top, then 2–6 step cards joined by arrows (a
// line of reasoning + an optional equation, labelled S1, S2 …), revealed as
// the narration reaches them; optional figure on the right. 4+ steps switch
// to compact cards (reason left, equation right) so six still fit.
// Reference: reference.png

export const meta = {
  name: 'Proof walkthrough',
  number: 6,
  aliases: [],
  description: 'TO PROVE + GIVEN cards, 2–6 proof steps (reason + optional equation, S1…) with arrows; optional figure.',
  duration: 14000,
  slide: {
    type: 'proof', name: 'Proof walkthrough',
    use: 'the step-by-step proof of the theorem stated on the slide before (never standalone): 2–6 steps, each a reason plus the statement / equation it gives; longer proofs continue on a second proof slide titled "(continued)"',
    image: 'optional', ratios: ['1:1', '3:4', '2:3', '4:3'],
    fields: {
      toProve: { required: true, words: 25, note: 'maths inline as $…$' },
      given: { words: 25, note: 'optional, maths inline as $…$' },
      steps: { required: true, items: [2, 6], fields: {
        text: { required: true, words: 14, note: 'the reason for this step, e.g. "Triangles on the same base and between the same parallels"' },
        formula: { note: 'optional: what this step gives, bare LaTeX without $…$' },
      } },
      caption: { words: 10 },
    },
    reveal: [{ field: 'steps', each: true, cue: 'cues.steps' }],
    narrationWords: [260, 380],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  toProve: { type: 'text', required: true, max: 220 },
  given: { type: 'text', max: 220 },
  steps: { type: 'list', min: 1, max: 6, of: {
    text: { type: 'text', required: true, max: 120 },
    formula: { type: 'text', max: 200, description: 'LaTeX' },
  } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { steps: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function Proof(d) {
  const c = d.cues || {};
  const n = d.steps.length;
  const dense = n >= 4;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={['layout', d.image ? 'with-image' : '', dense ? 'dense' : ''].join(' ')} style={{ '--n': n }}>
        <div className={d.given ? 'top two' : 'top'}>
          <section className="card prove" anim="riseIn" delay={350} exit="riseOut">
            <div className="label">To prove:</div>
            <div className="text"><Rich text={d.toProve} /></div>
          </section>
          {d.given && (
            <section className="card given" anim="riseIn" delay={550} exit="riseOut">
              <div className="label">Given:</div>
              <div className="text"><Rich text={d.given} /></div>
            </section>
          )}
        </div>
        <div className="steps" stagger={300} delay={900} exitStagger={60} exitDelay={200}>
          {d.steps.map((s, i) => (
            <>
              <section className="step" anim="riseIn" at={cue(c.steps, i)} exit="riseOut">
                <div className="stext"><Rich text={s.text} /></div>
                {s.formula && <div className="seq">{tex(s.formula, { display: true })}</div>}
                <div className="slabel">S{i + 1}</div>
              </section>
              {i < n - 1 && <div className="arrow" anim="fadeIn" at={cue(c.steps, i + 1)} exit="fadeOut"><i /></div>}
            </>
          ))}
        </div>
        {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
      </div>
    </>
  );
}
