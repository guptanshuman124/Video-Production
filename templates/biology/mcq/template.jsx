import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec, stateAnim } from 'hvr/shared';

// Biology deck page 12, "Test Yourself": question card, 2–5 option rows (A–E),
// a cream description/explanation box and an optional image panel. On the
// answer cue the correct option turns green (PDF page 16 colours) and any
// listed distractors turn red; the description then rises in.
// Spoken order (markers): the trap turns red when the narration names it and
// says why it is wrong, then the correct option turns green, then the
// description — never trap and answer at the same moment.
// Reference: reference.png

export const meta = {
  name: 'Test yourself (MCQ)',
  number: 12,
  aliases: ['bio-12-mcq', 'bio-12'],
  description: 'Question + A–E options with animated correct/wrong reveal + explanation + optional image.',
  duration: 12000,
  slide: {
    type: 'mcq', name: 'MCQ',
    use: 'a four-option multiple-choice question with one answer and one tempting trap option',
    image: 'optional', ratios: ['3:4', '1:1'],
    fields: {
      question: { required: true, words: 30 },
      options: { required: true, items: [4, 4], words: 10 },
      answer: { required: true },
      wrong: { required: true, items: [1, 1], note: 'the single most tempting wrong option (the trap)' },
      description: { required: true, words: 30, note: 'why the answer is right' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'wrong', cue: 'cues.wrong', hint: 'the trap option turns red — place it where you name the trap and say why it is tempting but wrong (before the answer)' },
      { field: 'answer', cue: 'cues.answer', hint: 'the correct option turns green — place it where you confirm the right answer (after the trap)' },
      { field: 'description', cue: 'cues.description', hint: 'the explanation box appears — place it where you explain why the answer is right' },
    ],
    question: true,
    noHighlight: true,   // the answer reveal is the highlight: no *term* emphasis on question slides
    rules: ['mcq'],
    narrationWords: [200, 280],
  },
};

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
// The letter is drawn by the template; drop one the writer typed into the text ("A. …", "(b) …").
export const stripLetter = (s) => String(s ?? '').replace(/^\s*\(?[A-Ea-e][.):]\s+/, '');

export const schema = {
  ...common,
  title: { type: 'text', default: 'Test Yourself', max: 40 },
  questionLabel: { type: 'text', default: 'Question', max: 24 },
  question: { type: 'text', required: true, max: 240 },
  options: { type: 'list', min: 2, max: 5, of: { type: 'text', max: 120 } },
  answer: { type: 'enum', values: LETTERS, description: 'correct option letter' },
  wrong: { type: 'list', of: { type: 'enum', values: LETTERS }, description: 'options to mark red on reveal (e.g. the common mistake)' },
  description: { type: 'text', max: 240, description: 'explanation shown after the answer' },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: {
    question: 'number', options: { type: 'list', of: 'number' },
    answer: { type: 'number', description: 'when the correct option lights up' },
    wrong: { type: 'number', description: 'when the `wrong` options turn red (default: with the answer)' },
    description: 'number', image: 'number',
  } },
};

export function check(d) {
  const n = d.options.length;
  const errs = [];
  if (d.answer && LETTERS.indexOf(d.answer) >= n) errs.push(`answer "${d.answer}" but only ${n} options`);
  for (const w of d.wrong) if (LETTERS.indexOf(w) >= n) errs.push(`wrong "${w}" but only ${n} options`);
  return errs;
}

export default function Mcq(d) {
  const c = d.cues || {};
  // Without cues: options stagger in, then the answer lands ~2.4s later.
  const answerAt = sec(c.answer);
  const answerDelay = 700 + d.options.length * 160 + 4200;
  // The trap is marked before the answer: without its own cue, 1.8 s earlier.
  const wrongAt = sec(c.wrong) ?? (answerAt != null ? Math.max(0, answerAt - 1800) : null);
  const stateTiming = (state) => {
    const at = state === 'wrong' ? wrongAt : answerAt;
    return at != null ? { at } : { delay: state === 'wrong' ? answerDelay - 1800 : answerDelay };
  };
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'col with-image' : 'col'}>
        <section className="qcard" anim="riseIn" delay={350} at={sec(c.question)} exit="riseOut" exitDelay={250}>
          <div className="qlabel">{d.questionLabel}</div>
          <div className="qtext"><Rich text={d.question} /></div>
        </section>
        <div className="options" stagger={160} delay={700} exitStagger={50} exitDelay={200}>
          {d.options.map((o, i) => {
            const L = LETTERS[i];
            const state = d.answer === L ? 'correct' : d.wrong.includes(L) ? 'wrong' : null;
            return (
              <div className="opt-wrap" anim="riseIn" at={cue(c.options, i)} exit="riseOut">
                <div className="opt" anim={state ? stateAnim(state) : null} {...(state ? stateTiming(state) : {})}>
                  <span className="letter">{L}</span>
                  <span className="otext"><Rich text={stripLetter(o)} /></span>
                </div>
              </div>
            );
          })}
        </div>
        {d.description && (
          <section className="desc" anim="riseIn" exit="riseOut"
                   {...(sec(c.description) != null ? { at: sec(c.description) }
                     : answerAt != null ? { at: answerAt + 600 } : { delay: answerDelay + 600 })}>
            <Rich text={d.description} />
          </section>
        )}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
