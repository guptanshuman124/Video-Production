import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Language deck: words from the text (शब्दार्थ / word meanings) — 3–8 cards
// in two columns, each with the word, its meaning, and an optional example
// sentence using it. Each card appears as the narration reaches it.

export const meta = {
  name: 'Word meanings',
  number: 8,
  aliases: [],
  description: '3–8 word cards in two columns: the word, its meaning and an example sentence.',
  duration: 12000,
  slide: {
    type: 'word_meanings', name: 'Word meanings',
    use: 'new or difficult words from the text the student is reading (शब्दार्थ), with their meaning as used in the text and an example sentence; also idioms (मुहावरे) and phrases',
    image: 'none',
    fields: {
      words: { required: true, items: [3, 8], fields: {
        word: { required: true, words: 4, note: 'exactly as it appears in the text' },
        meaning: { required: true, words: 14, note: 'its meaning as used in this text, in the slide language' },
        example: { words: 16, note: 'optional: a short sentence that uses it' },
      } },
    },
    reveal: [{ field: 'words', each: true, cue: 'cues.words' }],
    narrationWords: [220, 340],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  words: { type: 'list', min: 1, max: 8, of: {
    word: { type: 'text', required: true, max: 40 },
    meaning: { type: 'text', required: true, max: 110 },
    example: { type: 'text', max: 130 },
  } },
  cues: { type: 'object', fields: { words: { type: 'list', of: 'number' } } },
};

export default function WordMeanings(d) {
  const c = d.cues || {};
  const rows = Math.ceil(d.words.length / 2);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="grid" style={{ '--rows': rows }} stagger={260} delay={500} exitStagger={40} exitDelay={200}>
        {d.words.map((w, i) => (
          <section className="word" anim="riseIn" at={cue(c.words, i)} exit="riseOut">
            <div className="w"><Rich text={w.word} /></div>
            <div className="m"><Rich text={w.meaning} /></div>
            {w.example && <div className="ex"><Rich text={w.example} /></div>}
          </section>
        ))}
      </div>
    </>
  );
}
