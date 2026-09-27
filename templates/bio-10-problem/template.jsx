import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Biology deck page 10 (with image) and page 11 (without): teal slide with a
// PROBLEM card and a cream ANSWER card below it. The answer (and its steps)
// can be held back and revealed on a narration cue. With an image, the cards
// narrow and a panel sits on the right.
// References: reference.png (p10), reference-11.png (p11)

export const meta = {
  name: 'Problem + answer',
  number: 10,
  aliases: ['bio-10', 'bio-11'],
  description: 'Teal slide: PROBLEM card, ANSWER card (text / steps / formulas), optional image panel.',
  duration: 10000,
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  problemLabel: { type: 'text', default: 'PROBLEM', max: 24 },
  problem: { type: 'text', required: true, max: 300, description: 'the question; $…$ for formulas' },
  answerLabel: { type: 'text', default: 'ANSWER', max: 24 },
  answer: { type: 'text', max: 400 },
  steps: { type: 'list', max: 8, of: { type: 'text', max: 160 }, description: 'worked steps shown under the answer text' },
  image: { type: 'image', description: 'present → page 10 layout; absent → page 11' },
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: {
    problem: 'number', answer: 'number', steps: { type: 'list', of: 'number' }, image: 'number',
  } },
};

export default function Problem(d) {
  const c = d.cues || {};
  const answerAt = sec(c.answer);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'cards with-image' : 'cards'}>
        <section className="card problem" anim="riseIn" delay={350} at={sec(c.problem)} exit="riseOut" exitDelay={150}>
          <div className="label">{d.problemLabel}</div>
          <div className="text"><Rich text={d.problem} /></div>
        </section>
        <section className="card answer" anim="riseIn" delay={1100} at={answerAt} exit="riseOut">
          <div className="label">{d.answerLabel}</div>
          {d.answer && <div className="text"><Rich text={d.answer} /></div>}
          {d.steps.length > 0 && (
            <ol className="steps" stagger={260} delay={1500}>
              {d.steps.map((s, i) => (
                <li anim="riseIn" at={cue(c.steps, i) ?? (answerAt != null ? answerAt + 400 + i * 260 : null)}>
                  <Rich text={s} />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
