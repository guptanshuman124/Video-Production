import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Theory deck page 4: a horizontal time axis (arrow) with 3–6 dated events,
// alternating below / above the line, each on its own tick. Each event: the
// date, a short title and one line of description; they appear in order as
// the narration reaches them.
// Reference: reference.png

export const meta = {
  name: 'Timeline',
  number: 4,
  aliases: [],
  description: 'Horizontal time axis with 3–6 dated events (date · title · one line), alternating below/above.',
  duration: 12000,
  slide: {
    type: 'timeline', name: 'Timeline',
    use: 'a chronological sequence of 3–6 dated events (a historical span with 3+ meaningful dates), in date order',
    image: 'none',
    fields: {
      events: { required: true, items: [3, 6], fields: {
        date: { required: true, words: 4, note: 'as NCERT gives it: "1857", "August 1947", "c. 2500 BCE"' },
        title: { required: true, words: 6, note: 'what happened, e.g. "Revolt of 1857"' },
        text: { words: 16, note: 'one line: why it matters' },
      } },
    },
    reveal: [{ field: 'events', each: true, cue: 'cues.events' }],
    narrationWords: [220, 330],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  events: { type: 'list', min: 2, max: 6, of: {
    date: { type: 'text', required: true, max: 30 },
    title: { type: 'text', required: true, max: 60 },
    text: { type: 'text', max: 130 },
  } },
  cues: { type: 'object', fields: { events: { type: 'list', of: 'number' } } },
};

const LEFT = 84, WIDTH = 1752;

export default function Timeline(d) {
  const c = d.cues || {};
  const n = d.events.length;
  const slot = WIDTH / n;
  // Neighbours on the same side are two slots apart, so a card may use almost two slots.
  const cardW = Math.round(Math.min(460, slot * 2 - 40));
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="axis" anim="fadeIn" delay={350} exit="fadeOut"><i /></div>
      <div className="events" stagger={300} delay={700} exitStagger={60} exitDelay={200}>
        {d.events.map((e, i) => {
          const x = Math.round(LEFT + slot * (i + 0.5));
          const above = i % 2 === 1;
          const left = Math.max(24, Math.min(1920 - 24 - cardW, x - cardW / 2));
          return (
            <div className={above ? 'event above' : 'event below'} anim="riseIn" at={cue(c.events, i)} exit="riseOut">
              <span className="tick" style={{ left: `${x - 2}px` }} />
              <div className="card" style={{ left: `${left}px`, width: `${cardW}px` }}>
                <div className="date">{e.date}</div>
                <div className="etitle"><Rich text={e.title} /></div>
                {e.text && <div className="etext"><Rich text={e.text} /></div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
