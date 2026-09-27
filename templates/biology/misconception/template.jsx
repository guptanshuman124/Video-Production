import { Rich } from 'hvr';
import { Header, SlideTitle, common } from 'hvr/shared';

// Biology deck page 14: up to three rows, each a rose card with the common
// wrong idea on the left and a mint card with the correct idea (plus detail)
// on the right. The wrong idea appears first, the correction follows.
// Reference: reference.png

export const meta = {
  name: 'Common misconception',
  number: 14,
  aliases: ['bio-14-misconception', 'bio-14'],
  description: 'Rows of myth (rose card) vs fact (mint card with detail).',
  duration: 11000,
  slide: {
    type: 'misconception', name: 'Common misconception',
    use: '2–3 real, frequent wrong beliefs from this content, each with the correct idea',
    image: 'none',
    fields: {
      rows: { required: true, items: [2, 3], fields: {
        myth: { required: true, words: 14 }, mythDetail: { words: 20 },
        fact: { required: true, words: 14 }, factDetail: { words: 24 },
      } },
    },
    reveal: [{ field: 'rows', each: true, parts: ['myth', 'fact'], cue: 'cues.rows' }],
    narrationWords: [220, 300],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Common Misconception', max: 40 },
  rows: { type: 'list', min: 1, max: 3, of: {
    myth: { type: 'text', required: true, max: 140 },
    mythDetail: { type: 'text', max: 200 },
    fact: { type: 'text', required: true, max: 140 },
    factDetail: { type: 'text', max: 240 },
  } },
  cues: { type: 'object', fields: {
    rows: { type: 'list', of: 'any', description: 'per row: seconds, or [myth, fact] seconds' },
  } },
};

export default function Misconception(d) {
  const cues = d.cues?.rows || [];
  // Without cues each row takes ~1.5s: myth, then its correction.
  const at = (i, k) => {
    const v = cues[i];
    if (v == null) return { delay: 400 + i * 1500 + k * 700 };
    const t = Array.isArray(v) ? (v[k] ?? v[0] + k * 0.7) : v + k * 0.7;
    return { at: t * 1000 };
  };
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="rows" exitStagger={60} exitDelay={200}>
        {d.rows.map((r, i) => (
          <div className="row">
            <section className="card myth" anim="riseIn" {...at(i, 0)} exit="riseOut">
              <div className="main"><Rich text={r.myth} /></div>
              {r.mythDetail && <div className="detail"><Rich text={r.mythDetail} /></div>}
            </section>
            <section className="card fact" anim="riseIn" {...at(i, 1)} exit="riseOut">
              <div className="main"><Rich text={r.fact} /></div>
              {r.factDetail && <div className="detail"><Rich text={r.factDetail} /></div>}
            </section>
          </div>
        ))}
      </div>
    </>
  );
}
