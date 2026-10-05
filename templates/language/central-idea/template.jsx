import { Rich } from 'hvr';
import { Header, SlideTitle, Bullets, common, cue, sec } from 'hvr/shared';

// Language deck: the central idea / message of the text (मूल भाव, केंद्रीय
// भाव, theme) — the idea in one bold card, 0–4 supporting points, and an
// optional line from the text that shows it best.

export const meta = {
  name: 'Central idea',
  number: 12,
  aliases: [],
  description: 'Central idea card, 0–4 supporting points, optional quoted line from the text.',
  duration: 11000,
  slide: {
    type: 'central_idea', name: 'Central idea / message',
    use: 'the theme, central idea or message of the text (मूल भाव / केंद्रीय भाव / theme), the poet’s or writer’s feeling, with the points and the line that support it — usually after the text has been read',
    image: 'none',
    fields: {
      idea: { required: true, words: 35, note: 'the central idea in one or two sentences' },
      points: { items: [0, 4], words: 16, note: 'how the text builds it' },
      quote: { words: 25, note: 'optional: the line from the text that shows it best, quoted exactly' },
    },
    reveal: [
      { field: 'idea', cue: 'cues.idea' },
      { field: 'points', each: true, cue: 'cues.points' },
      { field: 'quote', cue: 'cues.quote' },
    ],
    narrationWords: [220, 320],
    labels: { hindi: { ideaLabel: 'मूल भाव', quoteLabel: 'पाठ से' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  ideaLabel: { type: 'text', default: 'Central idea', max: 24 },
  idea: { type: 'text', required: true, max: 260 },
  points: { type: 'list', max: 4, of: { type: 'text', max: 120 } },
  quoteLabel: { type: 'text', default: 'From the text', max: 24 },
  quote: { type: 'text', max: 200 },
  cues: { type: 'object', fields: { idea: 'number', points: { type: 'list', of: 'number' }, quote: 'number' } },
};

export default function CentralIdea(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="col">
        <section className="idea" anim="riseIn" delay={400} at={sec(c.idea)} exit="riseOut">
          <div className="label">{d.ideaLabel}</div>
          <div className="itext"><Rich text={d.idea} /></div>
        </section>
        {d.points.length > 0 && <Bullets className="pts" items={d.points} delay={1100} ats={d.points.map((_, i) => cue(c.points, i))} />}
        {d.quote && (
          <section className="quote" anim="riseIn" delay={1800} at={sec(c.quote)} exit="riseOut">
            <div className="label">{d.quoteLabel}</div>
            <blockquote className="qline">“<Rich text={String(d.quote).replace(/^["“‘']+|["”’']+$/g, '')} />”</blockquote>
          </section>
        )}
      </div>
    </>
  );
}
