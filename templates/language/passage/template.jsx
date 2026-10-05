import { Rich } from 'hvr';
import { Header, SlideTitle, common, partCue } from 'hvr/shared';

// Language deck: reading the text — the heart of an English or Hindi lesson.
// 1–6 lines (a stanza, or the sentences of a short passage) quoted exactly
// as the textbook prints them, each with its meaning in simple words beside
// it. The teacher reads a line ({{b1.k.1}} — it appears), then explains it
// ({{b1.k.2}} — its meaning appears). The source (poem / lesson · author)
// sits under the title.

export const meta = {
  name: 'Read and explain',
  number: 7,
  aliases: [],
  description: 'Source line, then 1–6 quoted lines of the text, each with its meaning revealed after it is read.',
  duration: 14000,
  slide: {
    type: 'passage', name: 'Read and explain',
    use: 'the heart of a language lesson: read the text closely — 1–6 lines of a stanza or short passage, quoted exactly, each with its meaning in simple words (सप्रसंग व्याख्या / line-by-line explanation); take the whole text over several of these slides, in order',
    image: 'none',
    fields: {
      source: { words: 10, note: 'the text and its writer, e.g. "Fire and Ice · Robert Frost" or "साखियाँ · कबीर"' },
      lines: { required: true, items: [1, 6], fields: {
        text: { required: true, words: 30, note: 'quoted exactly as the textbook prints it — never paraphrased or translated' },
        meaning: { required: true, words: 35, note: 'what it means, in simple words in the slide language' },
      } },
    },
    reveal: [{ field: 'lines', each: true, parts: ['text', 'meaning'], cue: 'cues.lines' }],
    narrationWords: [260, 400],
    labels: { hindi: { textLabel: 'पंक्ति', meaningLabel: 'अर्थ' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  source: { type: 'text', max: 90 },
  textLabel: { type: 'text', default: 'Text', max: 20 },
  meaningLabel: { type: 'text', default: 'Meaning', max: 20 },
  lines: { type: 'list', min: 1, max: 6, of: {
    text: { type: 'text', required: true, max: 230 },
    meaning: { type: 'text', required: true, max: 260 },
  } },
  cues: { type: 'object', fields: { lines: { type: 'list', of: 'any' } } },
};

export default function Passage(d) {
  const c = d.cues || {};
  const n = d.lines.length;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      {d.source && <div className="source" anim="fadeIn" delay={350} exit="fadeOut"><Rich text={d.source} /></div>}
      <div className={d.source ? 'rows with-source' : 'rows'} style={{ '--n': n }}>
        <div className="heads" anim="fadeIn" delay={450} exit="fadeOut"><span className="label">{d.textLabel}</span><span className="label">{d.meaningLabel}</span></div>
        {d.lines.map((l, i) => (
          <div className="row">
            <blockquote className="text" anim="riseIn" delay={700 + i * 500} at={partCue(c.lines, i, 0)} exit="riseOut"><div><Rich text={l.text} /></div></blockquote>
            <div className="meaning" anim="riseIn" delay={950 + i * 500} at={partCue(c.lines, i, 1)} exit="riseOut"><div><Rich text={l.meaning} /></div></div>
          </div>
        ))}
      </div>
    </>
  );
}
