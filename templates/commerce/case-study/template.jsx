import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue, sec } from 'hvr/shared';

// Commerce deck page 22: a CBSE case-based question — a cream SCENARIO card
// (named people / firm, ₹ figures), then 1–3 numbered question cards. Answers
// are withheld; the narration reads the case, points to the clue for each
// question and leaves the answering to the student.
// Reference: reference.png

export const meta = {
  name: 'Case study',
  number: 22,
  aliases: [],
  description: 'Cream SCENARIO card and 1–3 numbered question cards (answers withheld).',
  duration: 12000,
  slide: {
    type: 'case_study', name: 'Case study',
    use: 'a CBSE case-based question: a short business situation (named people or firm, ₹ figures) and 1–3 questions on it for the student to answer — answers withheld; Business Studies especially, and partnership / company situations in Accountancy',
    image: 'none',
    fields: {
      scenario: { required: true, words: 70, note: 'the situation, as a board case would give it; built only on this lecture’s content' },
      questions: { required: true, items: [1, 3], words: 25, note: 'each one answerable from the scenario and the lecture; no answers' },
    },
    reveal: [
      { field: 'scenario', cue: 'cues.scenario' },
      { field: 'questions', each: true, cue: 'cues.questions' },
    ],
    narrationWords: [200, 300],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Case Study', max: 60 },
  scenarioLabel: { type: 'text', default: 'Scenario', max: 24 },
  scenario: { type: 'text', required: true, max: 520 },
  questions: { type: 'list', min: 1, max: 3, of: { type: 'text', max: 180 } },
  cues: { type: 'object', fields: { scenario: 'number', questions: { type: 'list', of: 'number' } } },
};

const unnumber = (s) => String(s ?? '').trim().replace(/^(q\.?\s*)?\d+[.)]\s*/i, '');

export default function CaseStudy(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="col">
        <section className="scenario" anim="riseIn" delay={400} at={sec(c.scenario)} exit="riseOut">
          <div className="label">{d.scenarioLabel}</div>
          <div className="stext"><Rich text={d.scenario} /></div>
        </section>
        <div className="questions" stagger={400} delay={1200} exitStagger={60} exitDelay={200}>
          {d.questions.map((q, i) => (
            <section className="q" anim="riseIn" at={cue(c.questions, i)} exit="riseOut">
              <span className="qnum">{i + 1}</span><span className="qtext"><Rich text={unnumber(q)} /></span>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
