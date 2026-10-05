import { Rich } from 'hvr';
import { Header, common } from 'hvr/shared';

// Summary video: the divider that opens each part — "PART 2 OF 5", the
// part's title, and the lectures of the chapter it brings together. Filled in
// by code from the summary outline (src/summary/openers.js).

export const meta = {
  name: 'Summary part divider',
  number: 1,
  aliases: [],
  description: 'Part divider: "Part N of M", the part title, and the lectures it covers.',
  duration: 5000,
  slide: {
    type: 'summary_part', name: 'Part divider',
    use: 'opens each part of a summary video: filled in by code',
    image: 'none',
    codeOnly: true,
    fields: {},
    reveal: [],
    narrationWords: [20, 60],
    labels: { hindi: { partWord: 'भाग', ofWord: 'में से', coversLabel: 'इस भाग में' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 80 },
  partNumber: { type: 'number', min: 1 },
  partCount: { type: 'number', min: 1 },
  partWord: { type: 'text', default: 'Part', max: 16 },
  ofWord: { type: 'text', default: 'of', max: 10 },
  coversLabel: { type: 'text', default: 'Brings together', max: 30 },
  covers: { type: 'list', max: 6, of: { type: 'text', max: 70 } },
};

export default function SummaryPart(d) {
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <div className="card">
        <div className="eyebrow" anim="riseIn" delay={200} exit="riseOut">{d.partWord} {d.partNumber}{d.partCount ? ` ${d.ofWord} ${d.partCount}` : ''}</div>
        <h1 className="ptitle" anim="riseIn" delay={350} exit="riseOut"><Rich text={d.title} /></h1>
        <div className="bar" anim="fadeIn" delay={550} exit="fadeOut" />
        {d.covers.length > 0 && (
          <div className="covers" anim="riseIn" delay={700} exit="riseOut">
            <span className="label">{d.coversLabel}</span>
            <span className="list">{d.covers.map((t) => <span className="c"><Rich text={t} /></span>)}</span>
          </div>
        )}
      </div>
    </>
  );
}
