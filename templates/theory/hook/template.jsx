import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, sec } from 'hvr/shared';

// Theory / Maths deck page 1: the chapter opener. A title, a real-world hook
// (scenario, question or puzzle) and an image panel on the right. Frames why
// the chapter matters; no term, date or formula yet. Without an image the text
// uses the full width.
// Reference: reference.png

export const meta = {
  name: 'Chapter hook',
  number: 1,
  aliases: [],
  description: 'Chapter opener: title, a real-world hook, an optional puzzle question, optional image panel.',
  duration: 9000,
  slide: {
    type: 'hook', name: 'Chapter hook',
    use: 'lecture 1 only, right after the intro: a real-world scenario, question or puzzle that shows why the chapter matters — no formal term, date or formula yet',
    image: 'optional', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      hook: { required: true, words: 45, note: 'the scenario or situation, in plain words a student relates to' },
      question: { words: 20, note: 'optional: the puzzle or question this chapter will answer' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'hook', cue: 'cues.hook' },
      { field: 'question', cue: 'cues.question' },
    ],
    narrationWords: [140, 230],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  hook: { type: 'text', required: true, max: 320 },
  questionLabel: { type: 'text', default: 'Think about it', max: 30 },
  question: { type: 'text', max: 160 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { hook: 'number', question: 'number', image: 'number' } },
};

export default function Hook(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'text with-image' : 'text'}>
        <p className="hook" anim="riseIn" delay={450} at={sec(c.hook)} exit="riseOut"><Rich text={d.hook} /></p>
        {d.question && (
          <section className="question" anim="riseIn" delay={1200} at={sec(c.question)} exit="riseOut">
            <div className="qlabel">{d.questionLabel}</div>
            <div className="qtext"><Rich text={d.question} /></div>
          </section>
        )}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
