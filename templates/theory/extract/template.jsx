import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, sec } from 'hvr/shared';

// Theory deck page 13: a primary-source line or a short literary extract —
// who said / wrote it (attribution card), the extract itself (cream card, in
// quotes) and its significance (cream card); optional image panel. Keep
// extracts brief: a line for literary / copyrighted text; longer is fine for
// public-domain historical or constitutional text.
// Reference: reference.png

export const meta = {
  name: 'Quote / extract',
  number: 13,
  aliases: [],
  description: 'Attribution card, the extract (quoted), its significance; optional image panel.',
  duration: 11000,
  slide: {
    type: 'source_extract', name: 'Quote / source extract',
    use: 'a primary-source line (speech, constitutional text, document) or a short literary extract from the NCERT text, with what it shows',
    image: 'optional', ratios: ['3:4', '2:3', '1:1'],
    fields: {
      attribution: { required: true, words: 14, note: 'who, where, when — e.g. "Jawaharlal Nehru, Tryst with Destiny speech, 14 August 1947"' },
      extract: { required: true, words: 45, note: 'quoted exactly as the NCERT text gives it; one or two lines for poems and stories' },
      significance: { required: true, words: 35, note: 'what the extract tells us / why it matters' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'extract', cue: 'cues.extract' },
      { field: 'significance', cue: 'cues.significance' },
    ],
    narrationWords: [200, 300],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  attribution: { type: 'text', required: true, max: 120 },
  extractLabel: { type: 'text', default: 'Extract', max: 24 },
  extract: { type: 'text', required: true, max: 360 },
  significanceLabel: { type: 'text', default: 'Significance', max: 24 },
  significance: { type: 'text', required: true, max: 280 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { extract: 'number', significance: 'number', image: 'number' } },
};

// The extract is shown in quotation marks; drop any the writer already added.
const unquote = (s) => String(s ?? '').trim().replace(/^["“‘']+|["”’']+$/g, '');

export default function Extract(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'cards with-image' : 'cards'}>
        <section className="card attribution" anim="riseIn" delay={350} exit="riseOut"><Rich text={d.attribution} /></section>
        <section className="card extract" anim="riseIn" delay={700} at={sec(c.extract)} exit="riseOut">
          <div className="label">{d.extractLabel}</div>
          <blockquote className="quote">“<Rich text={unquote(d.extract)} />”</blockquote>
        </section>
        <section className="card significance" anim="riseIn" delay={1400} at={sec(c.significance)} exit="riseOut">
          <div className="label">{d.significanceLabel}</div>
          <div className="text"><Rich text={d.significance} /></div>
        </section>
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
