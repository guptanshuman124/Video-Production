import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// A real-life scene that shows where the idea lives (an everyday example, an
// application, a hook), beside 2–3 short points. The writer only describes
// the scene (`art_prompt`); the build stage draws it with the image model and
// a vision check rejects any picture with text, labels or anything that does
// not match (src/generation/art.js), so the model is never asked for a
// diagram it could get wrong. Structures, processes and set-ups stay on NCERT
// figures. The picture opens from a soft mask and drifts slowly (Ken Burns)
// for the whole slide; with no picture (generation off or rejected) the
// points fill the slide on their own.

export const meta = {
  name: 'Real-world picture',
  number: 20,
  aliases: [],
  description: 'Large illustration of an everyday scene (generated from art_prompt, vision-checked) beside 2–3 points.',
  duration: 12000,
  slide: {
    type: 'illustration', name: 'Real-world picture',
    use: 'where this idea shows up in real life — an everyday example, an application or a hook — with a picture drawn from `art_prompt`. The picture is one plain scene: never a diagram, a labelled structure, a process, an experiment set-up, a map or a graph (those stay on NCERT figures)',
    image: 'none',
    fields: {
      art_prompt: { required: true, words: 45, note: 'the picture, as one plain concrete scene: subject, setting, view, light — only what can be seen; no text, labels, arrows or diagram-like content; no named real people; an Indian setting when people appear. The picture sets the real-life scene; never rely on it to show a scientific effect precisely (light bending, colours of a spectrum, a reaction) — that is taught with NCERT figures and words' },
      points: { required: true, items: [2, 3], words: 16 },
    },
    reveal: [{ field: 'points', each: true, cue: 'cues.points', hint: 'this point appears beside the picture — first say in a line what the picture shows, then connect it to this point' }],
    narrationWords: [150, 230],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  art: { type: 'image', description: 'set by the build stage from art_prompt' },
  art_prompt: { type: 'text', required: true, max: 420 },
  points: { type: 'list', min: 1, max: 3, of: { type: 'text', max: 140 } },
  cues: { type: 'object', fields: { points: { type: 'list', of: 'number' } } },
};

// Words that ask the image model for something it draws unreliably (text,
// labels, diagrams, maps, charts). The writer is sent back to rewrite.
const DIAGRAM_WORDS = /\b(labels?|label{1,2}ed|diagrams?|charts?|graphs?|infographics?|flow ?charts?|cross[- ]?sections?|cutaways?|schematics?|maps?|arrows?|captions?|texts?|writing|written|formulas?|equations?|signboards?|posters?|logos?|watermarks?)\b/i;

export function check(d) {
  const m = String(d.art_prompt || '').match(DIAGRAM_WORDS);
  return m ? [`art_prompt asks for "${m[0]}": describe a plain scene only (no text, labels, diagrams, maps, charts or arrows in the picture)`] : [];
}

export default function Illustration(d, { scene } = {}) {
  const c = d.cues || {};
  const dur = Math.max(6000, scene?.duration || 12000);
  const has = !!d.art;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      {has && (
        <figure className="art" anim="imageIn" delay={250} exit="fadeOut">
          <img src={d.art} alt="" anim={{ kf: [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }], dur, ease: 'linear' }} delay={0} />
          <span className="tag">Illustration</span>
        </figure>
      )}
      <ol className={has ? 'points' : 'points wide'}>
        {d.points.map((p, i) => (
          <li anim="riseIn" at={cue(c.points, i)} delay={1100 + i * 1500} exit="riseOut">
            <span className="n">{i + 1}</span>
            <span className="t"><Rich text={p} /></span>
          </li>
        ))}
      </ol>
    </>
  );
}
