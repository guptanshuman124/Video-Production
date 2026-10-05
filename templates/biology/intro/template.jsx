import { Header, common } from 'hvr/shared';

// Lecture intro: a plain title card, the first slide of every lecture.
// "CHAPTER K" · the chapter name, large · an accent bar · "Lecture N: <lecture name>".
// No hook, no topic list, no image. Everything on it comes from the course
// tables (src/generation/openers.js), so the slide writer makes no LLM call for
// it (codeOnly); the narration is a short welcome (≈10 s), then the lecture
// goes straight to its first topic.

export const meta = {
  name: 'Lecture intro',
  number: 0,
  aliases: ['intro'],
  description: 'Title card: chapter number and name (large), then "Lecture N: <lecture name>".',
  duration: 6000,
  slide: {
    type: 'intro', name: 'Lecture intro',
    use: 'ALWAYS the first slide of every lecture: a title card with the chapter name and "Lecture N: <lecture name>", filled in by code; its narration is a short welcome only',
    image: 'none',
    codeOnly: true,
    fields: {},
    reveal: [],
    narrationWords: [18, 32],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 80, description: 'the lecture name' },
  chapterName: { type: 'text', max: 100 },
  chapterNumber: { type: 'number', min: 0 },
  lectureNumber: { type: 'number', min: 0 },
  lectureCount: { type: 'number', min: 0 },
  chapterWord: { type: 'text', default: 'Chapter', max: 20 },
  lectureWord: { type: 'text', default: 'Lecture', max: 20 },
  cues: { type: 'object', fields: { image: 'number' } },
};

export default function Intro(d) {
  return (
    <>
      <Header lecture="" logo={d.logo} />
      <div className="card">
        {d.chapterNumber ? <div className="eyebrow" anim="riseIn" delay={250} exit="riseOut">{d.chapterWord} {d.chapterNumber}</div> : null}
        <h1 className="chapter" anim="riseIn" delay={400} exit="riseOut">{d.chapterName || d.title}</h1>
        <div className="bar" anim="fadeIn" delay={650} exit="fadeOut" />
        <div className="lecture" anim="riseIn" delay={800} exit="riseOut">
          {d.lectureNumber ? <b>{d.lectureWord} {d.lectureNumber}: </b> : null}{d.title}
        </div>
      </div>
    </>
  );
}
