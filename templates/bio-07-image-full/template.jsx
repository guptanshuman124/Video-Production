import { Header, SlideTitle, Panel, common, sec } from 'hvr/shared';

// Biology deck page 7: one large image panel filling the content area, with a
// centred caption. For diagrams, micrographs, labelled figures.
// Reference: reference.png

export const meta = {
  name: 'Full image',
  number: 7,
  aliases: ['bio-07', 'bio-7'],
  description: 'Title + one large image panel with caption.',
  duration: 7000,
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  image: 'image',
  caption: { type: 'text', max: 100 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { image: 'number' } },
};

export default function ImageFull(d) {
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <Panel className="hero" image={d.image} caption={d.caption} fit={d.fit} delay={350} at={sec(d.cues?.image)} />
    </>
  );
}
