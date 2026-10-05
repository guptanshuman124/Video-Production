import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Language deck: literary devices / poetic beauty (अलंकार, काव्य-सौंदर्य) —
// 1–3 cards, each naming the device, quoting the line from the text that
// uses it, and saying what it does there.

export const meta = {
  name: 'Literary devices',
  number: 11,
  aliases: [],
  description: '1–3 cards: device name, the quoted line from the text, and its effect.',
  duration: 12000,
  slide: {
    type: 'literary_device', name: 'Literary devices',
    use: 'the literary devices and poetic beauty of the text (अलंकार, काव्य-सौंदर्य, imagery, metaphor, personification, alliteration, rhyme scheme): each with the exact line that uses it and what it adds',
    image: 'none',
    fields: {
      devices: { required: true, items: [1, 3], fields: {
        device: { required: true, words: 5, note: 'e.g. "Metaphor", "Personification", "अनुप्रास अलंकार"' },
        line: { required: true, words: 25, note: 'the line from the text, quoted exactly' },
        effect: { required: true, words: 30, note: 'how the device works here and what it adds' },
      } },
    },
    reveal: [{ field: 'devices', each: true, cue: 'cues.devices' }],
    narrationWords: [230, 340],
    labels: { hindi: { lineLabel: 'उदाहरण', effectLabel: 'प्रभाव' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  lineLabel: { type: 'text', default: 'In the text', max: 24 },
  effectLabel: { type: 'text', default: 'Effect', max: 24 },
  devices: { type: 'list', min: 1, max: 3, of: {
    device: { type: 'text', required: true, max: 40 },
    line: { type: 'text', required: true, max: 200 },
    effect: { type: 'text', required: true, max: 230 },
  } },
  cues: { type: 'object', fields: { devices: { type: 'list', of: 'number' } } },
};

export default function LiteraryDevices(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="cards" style={{ '--n': d.devices.length }} stagger={400} delay={500} exitStagger={60} exitDelay={200}>
        {d.devices.map((x, i) => (
          <section className="card" anim="riseIn" at={cue(c.devices, i)} exit="riseOut">
            <div className="dname"><Rich text={x.device} /></div>
            <div className="body">
              <div className="part"><div className="label">{d.lineLabel}</div><blockquote className="line"><Rich text={x.line} /></blockquote></div>
              <div className="part"><div className="label">{d.effectLabel}</div><div className="effect"><Rich text={x.effect} /></div></div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
