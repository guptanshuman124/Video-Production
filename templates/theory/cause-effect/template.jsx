import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Theory deck page 5: a directional chain of 3–5 links joined by arrows —
// either cause → effect reasoning, or the steps of a process / institutional
// flow ("how a bill becomes law"). Each link appears as the narration reaches
// it; optional image panel on the right (a turning point, a physical process).
// Reference: reference.png

export const meta = {
  name: 'Cause and effect / process',
  number: 5,
  aliases: [],
  description: 'Chain of 3–5 linked statements joined by down arrows (cause → effect, or process steps); optional image.',
  duration: 12000,
  slide: {
    type: 'cause_effect', name: 'Cause → effect / process',
    use: 'a directional chain of 3–5 links: why something happened (each cause leading to the next effect), or how a process / system works step by step',
    image: 'optional', ratios: ['1:1', '3:4', '4:3', '3:2'],
    fields: {
      links: { required: true, items: [3, 5], words: 16, note: 'each link one statement; each one leads to the next' },
      caption: { words: 10 },
    },
    reveal: [{ field: 'links', each: true, cue: 'cues.links' }],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  links: { type: 'list', min: 2, max: 5, of: { type: 'text', max: 130 } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { links: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function CauseEffect(d) {
  const c = d.cues || {};
  const n = d.links.length;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'chain with-image' : 'chain'} stagger={320} delay={600} exitStagger={60} exitDelay={200}>
        {d.links.map((l, i) => (
          <div className="link" anim="riseIn" at={cue(c.links, i)} exit="riseOut">
            <div className="ltext"><span className="num">{i + 1}</span><Rich text={l} /></div>
            {i < n - 1 && <div className="arrow"><i /></div>}
          </div>
        ))}
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
