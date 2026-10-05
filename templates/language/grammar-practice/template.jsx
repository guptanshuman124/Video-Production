import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Language deck: practice with answers — an instruction bar ("Change into
// the passive voice", "संधि-विच्छेद कीजिए"), then 2–5 rows: the question on
// the left from the start, its answer revealed on the right after the
// student has had a moment to try (a question slide).

export const meta = {
  name: 'Grammar practice',
  number: 18,
  aliases: [],
  description: 'Instruction bar, then 2–5 question rows whose answers are revealed one by one.',
  duration: 12000,
  slide: {
    type: 'grammar_practice', name: 'Practice with answers',
    use: 'right after a grammar rule (or a word-meanings slide): 2–5 short exercise items in the CBSE style — fill in the blank, transform, correct the error, संधि-विच्छेद, समास-विग्रह — the student tries each, then its answer is revealed',
    image: 'none',
    question: true,
    noHighlight: true,
    fields: {
      instruction: { required: true, words: 14, note: 'what to do, as the exam asks it' },
      items: { required: true, items: [2, 5], fields: {
        question: { required: true, words: 22 },
        answer: { required: true, words: 22, note: 'the correct answer' },
      } },
    },
    reveal: [{ field: 'items', each: true, cue: 'cues.items' }],
    narrationWords: [200, 320],
    labels: { hindi: { answerLabel: 'उत्तर' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Practice', max: 60 },
  instruction: { type: 'text', required: true, max: 140 },
  answerLabel: { type: 'text', default: 'Answer', max: 20 },
  items: { type: 'list', min: 1, max: 5, of: {
    question: { type: 'text', required: true, max: 160 },
    answer: { type: 'text', required: true, max: 160 },
  } },
  cues: { type: 'object', fields: { items: { type: 'list', of: 'number' } } },
};

export default function GrammarPractice(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <section className="instr" anim="riseIn" delay={350} exit="riseOut"><Rich text={d.instruction} /></section>
      <div className="items" style={{ '--n': d.items.length }}>
        {d.items.map((it, i) => (
          <div className="item" anim="riseIn" delay={600 + i * 200} exit="riseOut">
            <span className="num">{i + 1}</span>
            <span className="q"><Rich text={it.question} /></span>
            <span className="a" anim="riseIn" delay={2500 + i * 900} at={cue(c.items, i)}>
              <span className="label">{d.answerLabel}</span><Rich text={it.answer} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
