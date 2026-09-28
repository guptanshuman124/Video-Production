import { Rich, tex } from 'hvr';
import { Header, SlideTitle, common, sec } from 'hvr/shared';

// Maths deck page 5: the formal statement of a result — STATEMENT card
// (words + an optional display formula), then GIVEN and TO PROVE cards.
// Formula-only results (the AP sum formula, an identity) leave Given / To
// prove out and the statement card grows. The proof follows on a `proof` slide.
// Reference: reference.png

export const meta = {
  name: 'Theorem',
  number: 5,
  aliases: [],
  description: 'STATEMENT (text + optional formula), GIVEN and TO PROVE cards.',
  duration: 11000,
  slide: {
    type: 'theorem', name: 'Theorem / result',
    use: 'the formal statement of a theorem or result (no proof): name in the title, the statement, and — for geometric theorems — Given and To prove; right before its proof slide',
    image: 'none',
    fields: {
      statement: { required: true, words: 40, note: 'the theorem as NCERT states it; maths inline as $…$' },
      formula: { latex: true, note: 'optional: the result in symbols, bare LaTeX without $…$, e.g. "S_n = \\frac{n}{2}[2a + (n-1)d]"' },
      given: { words: 30, note: 'optional (geometric theorems): what is given, maths as $…$' },
      toProve: { words: 25, note: 'optional: what is to be proved, maths as $…$' },
    },
    reveal: [
      { field: 'statement', cue: 'cues.statement' },
      { field: 'given', cue: 'cues.given' },
      { field: 'toProve', cue: 'cues.toProve' },
    ],
    narrationWords: [200, 300],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  statement: { type: 'text', required: true, max: 320 },
  formula: { type: 'text', max: 220, description: 'LaTeX' },
  given: { type: 'text', max: 240 },
  toProve: { type: 'text', max: 220 },
  cues: { type: 'object', fields: { statement: 'number', given: 'number', toProve: 'number' } },
};

export default function Theorem(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.given || d.toProve ? 'cards' : 'cards only'}>
        <section className="card statement" anim="riseIn" delay={400} at={sec(c.statement)} exit="riseOut">
          <div className="label">Statement:</div>
          <div className="text"><Rich text={d.statement} /></div>
          {d.formula && <div className="eq">{tex(d.formula, { display: true })}</div>}
        </section>
        {d.given && (
          <section className="card given" anim="riseIn" delay={1000} at={sec(c.given)} exit="riseOut">
            <div className="label">Given:</div>
            <div className="text"><Rich text={d.given} /></div>
          </section>
        )}
        {d.toProve && (
          <section className="card prove" anim="riseIn" delay={1500} at={sec(c.toProve)} exit="riseOut">
            <div className="label">To prove:</div>
            <div className="text"><Rich text={d.toProve} /></div>
          </section>
        )}
      </div>
    </>
  );
}
