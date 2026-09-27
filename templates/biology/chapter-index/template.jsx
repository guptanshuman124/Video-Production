import { Rich } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Biology deck page 1: chapter opener. Chapter name as the title, a numbered
// list of the chapter's topics in two columns of five (orange number badges),
// and a tall image panel on the right. The header shows only the logo unless
// a lecture name is given. Reference: reference.png

export const meta = {
  name: 'Chapter index',
  number: 1,
  aliases: ['bio-01-chapter-index', 'bio-01', 'bio-1'],
  description: 'Chapter name + numbered topic list (≤10, two columns) + tall image panel.',
  duration: 8000,
  slide: {
    type: 'chapter_index', name: 'Chapter index',
    use: 'opens lecture 1: the chapter name and the topics it covers, read out one by one',
    image: 'optional', ratios: ['3:4'],
    fields: { items: { required: true, items: [3, 10], words: 5 }, caption: { words: 10 } },
    reveal: [{ field: 'items', each: true, cue: 'cues.items' }],
    narrationWords: [120, 220],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 40, description: 'chapter name' },
  items: { type: 'list', min: 1, max: 10, of: { type: 'text', max: 40 }, description: 'topics; 1–5 fill the left column, 6–10 the right' },
  image: { type: 'image', description: 'right panel image' },
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: {
    items: { type: 'list', of: 'number', description: 'seconds on the video timeline for each topic' },
    image: { type: 'number' },
  } },
};

// Row tops from the PDF (the first gap is slightly larger in the design).
const ROW_TOP = [227, 325, 416, 506, 596];

export default function ChapterIndex(d) {
  const ats = d.cues?.items || [];
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <ol className="topics" stagger={110} delay={400} exitStagger={50} exitDelay={200}>
        {d.items.map((t, i) => (
          <li className="topic" style={{ left: i < 5 ? 84 : 673, top: ROW_TOP[i % 5] }}
              anim="riseIn" at={cue(ats, i)} exit="riseOut">
            <span className="badge">{i + 1}</span>
            <span className="label"><Rich text={t} /></span>
          </li>
        ))}
      </ol>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(d.cues?.image)} />}
    </>
  );
}
