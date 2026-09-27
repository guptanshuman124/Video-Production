import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Biology deck page 4: up to six white cards in a 2×3 grid, each with a navy
// check-circle icon, a bold main line and secondary text. Cards rise in and
// the check mark draws itself. Reference: reference.png

export const meta = {
  name: 'Check cards',
  number: 4,
  aliases: ['bio-04-check-cards', 'bio-04', 'bio-4'],
  description: 'Two columns × up to three rows of cards: check icon, main text, secondary text.',
  duration: 8000,
  slide: {
    type: 'characteristics', name: 'Characteristics',
    use: '4–6 genuine properties or features of one thing, each a short title plus one line',
    image: 'none',
    fields: { items: { required: true, items: [4, 6], fields: { title: { required: true, words: 5 }, text: { words: 16 } } } },
    reveal: [{ field: 'items', each: true, cue: 'cues.items' }],
    narrationWords: [200, 300],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 40 },
  items: { type: 'list', min: 1, max: 6, of: {
    title: { type: 'text', required: true, max: 40 },
    text: { type: 'text', max: 160 },
  }, description: 'filled row by row: 1 2 / 3 4 / 5 6' },
  cues: { type: 'object', fields: { items: { type: 'list', of: 'number' } } },
};

const Check = ({ delay, at }) => (
  <svg className="check" width="55" height="55" viewBox="0 0 55 55">
    <circle cx="27.5" cy="27.5" r="26.5" fill="none" stroke="currentColor" stroke-width="2"
            pathLength="1" style={{ strokeDasharray: 1 }} anim="draw" dur={700} delay={delay} at={at} />
    <path d="M14 28 L23.5 37.5 L41.5 18.5" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round"
          pathLength="1" style={{ strokeDasharray: 1 }} anim="draw" dur={450}
          delay={delay + 450} at={at == null ? null : at + 450} />
  </svg>
);

export default function CheckCards(d) {
  const ats = d.cues?.items || [];
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="grid" stagger={140} delay={400} exitStagger={60} exitDelay={200}>
        {d.items.map((it, i) => {
          const at = cue(ats, i);
          return (
            <div className="card" anim="riseIn" at={at} exit="riseOut">
              <div className="card-head">
                {/* delay is relative to the card: the grid stagger is inherited */}
                <Check delay={250} at={at == null ? null : at + 250} />
                <div className="main"><Rich text={it.title} /></div>
              </div>
              {it.text && <div className="secondary"><Rich text={it.text} /></div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
