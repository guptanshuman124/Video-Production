import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue, sec, stateAnim } from 'hvr/shared';

// Biology deck page 13: teal slide. ASSERTION (A) and REASON (R) cards on the
// left, the four standard A/R options on the right, and an EXPLANATION card
// across the bottom. The correct option lights up green on the answer cue,
// then the explanation rises in. Reference: reference.png

export const meta = {
  name: 'Assertion and reason',
  number: 13,
  aliases: ['bio-13'],
  description: 'Assertion + Reason cards, four standard options with correct/wrong reveal, explanation.',
  duration: 14000,
};

const LETTERS = ['A', 'B', 'C', 'D'];
const STANDARD = [
  'Both true, R explains A',
  'Both true, R does not explain A',
  'A true, R false',
  'A false, R true',
];

export const schema = {
  ...common,
  title: { type: 'text', default: 'Assertion and Reason', max: 40 },
  assertion: { type: 'text', required: true, max: 200 },
  reason: { type: 'text', required: true, max: 200 },
  options: { type: 'list', min: 4, max: 4, of: { type: 'text', max: 60 }, default: STANDARD },
  answer: { type: 'enum', values: LETTERS },
  wrong: { type: 'list', of: { type: 'enum', values: LETTERS } },
  explanation: { type: 'text', max: 360 },
  cues: { type: 'object', fields: {
    assertion: 'number', reason: 'number', options: { type: 'list', of: 'number' },
    answer: 'number', explanation: 'number',
  } },
};

export default function AssertionReason(d) {
  const c = d.cues || {};
  const answerAt = sec(c.answer);
  const answerDelay = 1500 + 4 * 150 + 2600;
  const timing = (ms, fallback) => (ms != null ? { at: ms } : { delay: fallback });
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <section className="card stmt a" anim="riseIn" {...timing(sec(c.assertion), 350)} exit="riseOut" exitDelay={250}>
        <h2>ASSERTION (A)</h2>
        <p><Rich text={d.assertion} /></p>
      </section>
      <section className="card stmt r" anim="riseIn" {...timing(sec(c.reason), 700)} exit="riseOut" exitDelay={200}>
        <h2>REASON (R)</h2>
        <p><Rich text={d.reason} /></p>
      </section>
      <div className="options" stagger={150} delay={1500} exitStagger={50} exitDelay={200}>
        {d.options.map((o, i) => {
          const L = LETTERS[i];
          const state = d.answer === L ? 'correct' : d.wrong.includes(L) ? 'wrong' : null;
          return (
            <div className="opt-wrap" anim="riseIn" at={cue(c.options, i)} exit="riseOut">
              <div className="opt" anim={state ? stateAnim(state) : null} {...(state ? timing(answerAt, answerDelay) : {})}>
                <span className="letter">{L}</span>
                <span className="otext"><Rich text={o} /></span>
              </div>
            </div>
          );
        })}
      </div>
      {d.explanation && (
        <section className="card expl" anim="riseIn" exit="riseOut"
                 {...timing(sec(c.explanation) ?? (answerAt != null ? answerAt + 600 : null), answerDelay + 600)}>
          <h2>EXPLANATION</h2>
          <p><Rich text={d.explanation} /></p>
        </section>
      )}
    </>
  );
}
