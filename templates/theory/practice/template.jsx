import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Theory deck page 10 / Maths page 12: exam-style practice — 1–3 cream PROBLEM
// cards, answers withheld (the student solves them; the narration reads each
// and gives a hint of the approach, never the answer).
// Reference: reference.png

export const meta = {
  name: 'Practice problems',
  number: 10,
  aliases: [],
  description: '1–3 PROBLEM cards (cream), answers withheld.',
  duration: 10000,
  slide: {
    type: 'practice_problem', name: 'Practice problems',
    use: 'a checkpoint after 1–2 taught concepts: 1–3 exam-style questions for the student to try, answers withheld',
    image: 'none',
    fields: {
      problems: { required: true, items: [1, 3], fields: {
        text: { required: true, words: 40, note: 'the question as a board paper asks it' },
        marks: { words: 3, note: 'optional, e.g. "2 marks"' },
      } },
    },
    reveal: [{ field: 'problems', each: true, cue: 'cues.problems' }],
    narrationWords: [150, 260],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Try These', max: 60 },
  label: { type: 'text', default: 'PROBLEM', max: 24 },
  problems: { type: 'list', min: 1, max: 3, of: {
    text: { type: 'text', required: true, max: 300 },
    marks: { type: 'text', max: 20 },
  } },
  cues: { type: 'object', fields: { problems: { type: 'list', of: 'number' } } },
};

export default function Practice(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="cards" style={{ '--n': d.problems.length }} stagger={350} delay={500} exitStagger={60} exitDelay={200}>
        {d.problems.map((p, i) => (
          <section className="card" anim="riseIn" at={cue(c.problems, i)} exit="riseOut">
            <div className="label">{d.label}{d.problems.length > 1 ? ` ${i + 1}` : ''}{p.marks && <span className="marks">{p.marks}</span>}</div>
            <div className="text"><Rich text={p.text} /></div>
          </section>
        ))}
      </div>
    </>
  );
}
