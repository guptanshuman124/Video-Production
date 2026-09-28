import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Theory deck page 9 / Maths page 11: a hands-on activity or discussion prompt
// — a pause beat, no answer shown. "TRY THIS" tag, the prompt, optional steps,
// and an optional question to reflect on; optional image when the activity
// uses a specific figure (a map to study, a segment to bisect).
// Reference: reference.png

export const meta = {
  name: 'Try this / Discuss',
  number: 9,
  aliases: [],
  description: '"Try this" activity or discussion prompt with optional steps and a reflection question — no answer; optional image.',
  duration: 10000,
  slide: {
    type: 'try_this', name: 'Try this / Discuss',
    use: 'an activity or discussion prompt before a concept is formally named: the student does or thinks about something first (no answer shown)',
    image: 'optional', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      prompt: { required: true, words: 35, note: 'what the student should do or discuss, addressed to them' },
      steps: { items: [0, 4], words: 14, note: 'optional short steps of the activity' },
      think: { words: 20, note: 'optional: the question to reflect on (its answer comes on a later slide)' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'prompt', cue: 'cues.prompt' },
      { field: 'steps', each: true, cue: 'cues.steps' },
      { field: 'think', cue: 'cues.think' },
    ],
    narrationWords: [150, 240],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  tag: { type: 'text', default: 'Try this', max: 24 },
  prompt: { type: 'text', required: true, max: 260 },
  steps: { type: 'list', max: 4, of: { type: 'text', max: 110 } },
  thinkLabel: { type: 'text', default: 'Think', max: 24 },
  think: { type: 'text', max: 160 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { prompt: 'number', steps: { type: 'list', of: 'number' }, think: 'number', image: 'number' } },
};

export default function TryThis(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'col with-image' : 'col'}>
        <div className="tag" anim="riseIn" delay={350} exit="riseOut">{d.tag}</div>
        <p className="prompt" anim="riseIn" delay={600} at={sec(c.prompt)} exit="riseOut"><Rich text={d.prompt} /></p>
        {d.steps.length > 0 && (
          <ol className="steps" stagger={260} delay={1100}>
            {d.steps.map((s, i) => <li anim="riseIn" at={cue(c.steps, i)} exit="riseOut"><Rich text={s} /></li>)}
          </ol>
        )}
        {d.think && (
          <section className="think" anim="riseIn" delay={1800} at={sec(c.think)} exit="riseOut">
            <div className="tlabel">{d.thinkLabel}</div>
            <div className="ttext"><Rich text={d.think} /></div>
          </section>
        )}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
