import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, sec } from 'hvr/shared';

// Commerce deck page 18: a practice problem the student solves before the
// answer is shown — PROBLEM bar across the top, then a cream "PAUSE — try this
// yourself" card with how to approach it (never the answer) and a footer
// pointing to the next slide, which must carry the worked solution (pack flow
// `mustPrecede`). Optional image panel on the right (a source document, a
// partial statement).
// Reference: reference.png

export const meta = {
  name: 'Practice problem (pause)',
  number: 18,
  aliases: [],
  description: 'PROBLEM bar, cream PAUSE card with the approach (no answer) and a "check on the next slide" footer; optional image.',
  duration: 10000,
  slide: {
    type: 'practice_problem', name: 'Practice problem (pause)',
    use: 'one board-style problem for the student to try (a transaction to journalise, an account to prepare, an amount to work out) before the solution: the very next slide shows the worked answer (journal_entry, ledger, trial_balance, final_accounts, balance_sheet or adjustment)',
    image: 'optional', ratios: ['3:4', '1:1', '4:3'],
    fields: {
      problem: { required: true, words: 45, note: 'the question as a board paper asks it, with every date, name and ₹ amount needed' },
      hint: { required: true, words: 35, note: 'how to approach it — which rule or format to use — never the answer itself' },
      caption: { words: 10 },
    },
    reveal: [{ field: 'hint', cue: 'cues.hint' }],
    narrationWords: [150, 240],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Practice Problem', max: 60 },
  problemLabel: { type: 'text', default: 'Problem', max: 24 },
  problem: { type: 'text', required: true, max: 330 },
  pauseLabel: { type: 'text', default: 'PAUSE — try this yourself', max: 40 },
  hint: { type: 'text', required: true, max: 260 },
  footer: { type: 'text', default: 'Come back and check your answer on the next slide.', max: 90 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { hint: 'number', image: 'number' } },
};

export default function Practice(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="col">
        <section className="problem" anim="riseIn" delay={400} exit="riseOut">
          <div className="label">{d.problemLabel}</div>
          <div className="ptext"><Rich text={d.problem} /></div>
        </section>
        <div className="row">
          <section className="pause" anim="riseIn" delay={1100} at={sec(c.hint)} exit="riseOut">
            <div className="plabel">{d.pauseLabel}</div>
            <div className="hint"><Rich text={d.hint} /></div>
            {d.footer && <div className="footer">{d.footer}</div>}
          </section>
          {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
        </div>
      </div>
    </>
  );
}
