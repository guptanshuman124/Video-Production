import { Rich } from 'hvr';
import { Header, common, cue } from 'hvr/shared';

// Summary video opener: the chapter's title card. "CHAPTER K · Class · Subject"
// eyebrow, the chapter name large, a CHAPTER SUMMARY pill on the left (no
// running time: a video never states its own length); on the right the summary's parts, each appearing as the
// narration names it. Everything comes from the course tables and the summary
// outline (src/summary/openers.js) — the model writes only the narration.
// Used by every pack's summary video (templates/summary/ is not a pack).

export const meta = {
  name: 'Summary title card',
  number: 0,
  aliases: [],
  description: 'Chapter summary opener: chapter number and name, CHAPTER SUMMARY pill, the list of parts.',
  duration: 9000,
  slide: {
    type: 'summary_title', name: 'Summary title card',
    use: 'ALWAYS the first slide of a summary video: filled in by code',
    image: 'none',
    codeOnly: true,
    fields: {},
    reveal: [{ field: 'parts', each: true, cue: 'cues.parts' }],
    narrationWords: [70, 150],
    labels: { hindi: { chapterWord: 'अध्याय', tag: 'अध्याय सारांश', partsLabel: 'इस सारांश में'} },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 100, description: 'the chapter name' },
  chapterNumber: { type: 'number', min: 0 },
  chapterWord: { type: 'text', default: 'Chapter', max: 20 },
  course: { type: 'text', max: 60, description: 'e.g. "Class 10 · Science"' },
  tag: { type: 'text', default: 'Chapter Summary', max: 30 },
  partsLabel: { type: 'text', default: 'In this summary', max: 30 },
  parts: { type: 'list', max: 8, of: { type: 'text', max: 70 } },
  cues: { type: 'object', fields: { parts: { type: 'list', of: 'number' } } },
};

export default function SummaryTitle(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture="" logo={d.logo} />
      <div className={d.parts.length ? 'left' : 'left solo'}>
        <div className="eyebrow" anim="riseIn" delay={250} exit="riseOut">
          {d.chapterNumber ? `${d.chapterWord} ${d.chapterNumber}` : ''}{d.chapterNumber && d.course ? ' · ' : ''}{d.course || ''}
        </div>
        <h1 className="chapter" anim="riseIn" delay={400} exit="riseOut"><Rich text={d.title} /></h1>
        <div className="meta" anim="riseIn" delay={750} exit="riseOut">
          <span className="tag">{d.tag}</span>
        </div>
      </div>
      {d.parts.length > 0 && (
        <section className="toc" anim="riseIn" delay={900} exit="riseOut">
          <div className="label">{d.partsLabel}</div>
          <ol stagger={220} delay={1200}>
            {d.parts.map((p, i) => <li anim="riseIn" at={cue(c.parts, i)}><span className="pn">{i + 1}</span><span className="pt"><Rich text={p} /></span></li>)}
          </ol>
        </section>
      )}
    </>
  );
}
