import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, Bullets, common, cue, sec } from 'hvr/shared';

// Theory deck page 7 (Maths p13, "historical note"): a profile — the person's
// image on the left; name, role line, a short "about" and up to three points
// of significance on the right. Without an image the text uses the full width.
// Reference: reference.png

export const meta = {
  name: 'Person profile',
  number: 7,
  aliases: [],
  description: 'Image left; name, role, about and up to 3 significance points on the right.',
  duration: 10000,
  slide: {
    type: 'person', name: 'Person profile',
    use: 'a key historical figure, leader, writer or literary character worth a standalone beat: who they were and why they matter here',
    image: 'optional', ratios: ['1:1', '3:4', '4:3', '2:3'],
    fields: {
      name: { required: true, words: 6 },
      role: { words: 10, note: 'role and dates, e.g. "Freedom fighter · 1869–1948" or "narrator of the story"' },
      about: { required: true, words: 40, note: 'who they were, as this chapter presents them' },
      points: { items: [0, 3], words: 14, note: 'why they matter for this chapter' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'about', cue: 'cues.about' },
      { field: 'points', each: true, cue: 'cues.points' },
    ],
    narrationWords: [200, 300],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  name: { type: 'text', required: true, max: 60 },
  role: { type: 'text', max: 90 },
  about: { type: 'text', required: true, max: 300 },
  points: { type: 'list', max: 3, of: { type: 'text', max: 120 } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { about: 'number', points: { type: 'list', of: 'number' }, image: 'number' } },
};

export default function Person(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
      <div className={d.image ? 'profile with-image' : 'profile'}>
        <div className="pname" anim="riseIn" delay={400} exit="riseOut"><Rich text={d.name} /></div>
        {d.role && <div className="prole" anim="riseIn" delay={600} exit="riseOut"><Rich text={d.role} /></div>}
        <p className="about" anim="riseIn" delay={900} at={sec(c.about)} exit="riseOut"><Rich text={d.about} /></p>
        {d.points.length > 0 && <Bullets className="ppoints" items={d.points} delay={1500} ats={d.points.map((_, i) => cue(c.points, i))} />}
      </div>
    </>
  );
}
