import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue, sec } from 'hvr/shared';

// Language deck: the format of a writing task (letter, notice, report,
// article; पत्र, सूचना, विज्ञापन) — a "paper" card listing its 3–8 parts in
// order, each with a short sample line, plus an optional REMEMBER tip.

export const meta = {
  name: 'Writing format',
  number: 19,
  aliases: [],
  description: 'Paper card with the 3–8 parts of a writing format in order (part · sample), optional tip.',
  duration: 12000,
  slide: {
    type: 'writing_format', name: 'Writing format',
    use: 'the format of a writing task the board asks for (formal / informal letter, notice, report, article, diary entry; औपचारिक / अनौपचारिक पत्र, सूचना, विज्ञापन, संदेश): its parts in order, each with a short sample line',
    image: 'none',
    fields: {
      kind: { required: true, words: 5, note: 'e.g. "Formal letter — to the editor"' },
      parts: { required: true, items: [3, 8], fields: {
        part: { required: true, words: 4, note: 'e.g. "Sender’s address", "Subject", "विषय"' },
        sample: { required: true, words: 18, note: 'a short sample line for that part' },
      } },
      tip: { words: 22, note: 'optional: what examiners check (word limit, marks, common slips)' },
    },
    reveal: [
      { field: 'parts', each: true, cue: 'cues.parts' },
      { field: 'tip', cue: 'cues.tip' },
    ],
    narrationWords: [230, 340],
    labels: { hindi: { tipLabel: 'ध्यान दें' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  kind: { type: 'text', required: true, max: 60 },
  parts: { type: 'list', min: 1, max: 8, of: {
    part: { type: 'text', required: true, max: 36 },
    sample: { type: 'text', required: true, max: 150 },
  } },
  tipLabel: { type: 'text', default: 'Remember', max: 20 },
  tip: { type: 'text', max: 170 },
  cues: { type: 'object', fields: { parts: { type: 'list', of: 'number' }, tip: 'number' } },
};

export default function WritingFormat(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.tip ? 'wrap with-tip' : 'wrap'}>
        <section className="paper" anim="riseIn" delay={350} exit="riseOut">
          <div className="kind"><Rich text={d.kind} /></div>
          <div className="parts" style={{ '--n': d.parts.length }} stagger={300} delay={700}>
            {d.parts.map((p, i) => (
              <div className="part" anim="riseIn" at={cue(c.parts, i)}>
                <span className="pname"><Rich text={p.part} /></span>
                <span className="psample"><Rich text={p.sample} /></span>
              </div>
            ))}
          </div>
        </section>
        {d.tip && (
          <section className="tip" anim="riseIn" delay={1800} at={sec(c.tip)} exit="riseOut">
            <div className="label">{d.tipLabel}</div>
            <div className="ttext"><Rich text={d.tip} /></div>
          </section>
        )}
      </div>
    </>
  );
}
