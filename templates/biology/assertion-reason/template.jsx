import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue, sec, stateAnim } from 'hvr/shared';

// Biology deck page 13: teal slide. ASSERTION (A) and REASON (R) cards on the
// left, the four standard A/R options on the right, and an EXPLANATION card
// across the bottom. The correct option lights up green on the answer cue,
// then the explanation rises in. Reference: reference.png

export const meta = {
  name: 'Assertion and reason',
  number: 13,
  aliases: ['bio-13-assertion-reason', 'bio-13'],
  description: 'Assertion + Reason cards, four standard options with correct/wrong reveal, explanation.',
  duration: 14000,
  slide: {
    type: 'assertion_reason', name: 'Assertion–reason',
    use: 'a genuine claim-and-cause pair in the CBSE assertion–reason format (standard four options)',
    image: 'none',
    fields: {
      assertion: { required: true, words: 25 },
      reason: { required: true, words: 25 },
      answer: { required: true, note: 'A: both true, R explains A · B: both true, R does not explain A · C: A true, R false · D: A false, R true' },
      wrong: { items: [0, 1], note: 'optional: the tempting wrong verdict' },
      explanation: { required: true, words: 40 },
    },
    reveal: [
      { field: 'wrong', cue: 'cues.wrong', hint: 'the tempting wrong verdict turns red — place it where you name it and say why it is wrong (before the answer)' },
      { field: 'answer', cue: 'cues.answer', hint: 'the correct verdict turns green — place it where you confirm it (after the trap)' },
      { field: 'explanation', cue: 'cues.explanation', hint: 'the explanation card appears' },
    ],
    question: true,
    noHighlight: true,   // the answer reveal is the highlight: no *term* emphasis on question slides
    rules: ['assertion'],
    narrationWords: [240, 320],
  },
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
    answer: 'number', wrong: 'number', explanation: 'number',
  } },
};

export default function AssertionReason(d) {
  const c = d.cues || {};
  const answerAt = sec(c.answer);
  const answerDelay = 1500 + 4 * 150 + 4400;
  // The trap (if any) is marked before the answer: without its own cue, 1.8 s earlier.
  const wrongAt = sec(c.wrong) ?? (answerAt != null ? Math.max(0, answerAt - 1800) : null);
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
              <div className="opt" anim={state ? stateAnim(state) : null}
                   {...(state === 'wrong' ? timing(wrongAt, answerDelay - 1800) : state ? timing(answerAt, answerDelay) : {})}>
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
