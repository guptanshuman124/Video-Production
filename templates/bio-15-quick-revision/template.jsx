import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Biology deck page 15: end-of-lecture recap. Two centred section bars,
// KEY POINTS and GLOSSARY, each followed by a bulleted list. Glossary items
// can be plain text or { term, meaning } (term set in bold).
// Reference: reference.png

export const meta = {
  name: 'Quick revision',
  number: 15,
  aliases: ['bio-15'],
  description: 'KEY POINTS bar + bullets, GLOSSARY bar + bullets.',
  duration: 12000,
};

export const schema = {
  ...common,
  title: { type: 'text', default: 'Quick Revision', max: 40 },
  keyPointsLabel: { type: 'text', default: 'KEY POINTS', max: 30 },
  keyPoints: { type: 'list', min: 1, max: 6, of: { type: 'text', max: 140 } },
  glossaryLabel: { type: 'text', default: 'GLOSSARY', max: 30 },
  glossary: { type: 'list', max: 6, of: 'any', description: 'text, or { "term": "…", "meaning": "…" }' },
  cues: { type: 'object', fields: {
    keyPoints: { type: 'list', of: 'number' }, glossary: { type: 'list', of: 'number' }, glossaryBar: 'number',
  } },
};

export function check(d) {
  return d.glossary.flatMap((g, i) => (typeof g === 'string' || (g && typeof g.term === 'string'))
    ? [] : [`glossary[${i}] must be text or { term, meaning }`]);
}

const glossText = (g) => (typeof g === 'string' ? g : `**${g.term}**${g.meaning ? ` – ${g.meaning}` : ''}`);

export default function QuickRevision(d) {
  const c = d.cues || {};
  const kpEnd = 500 + d.keyPoints.length * 220;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="body">
        <section className="block key">
          <div className="bar" anim="riseIn" delay={350} exit="riseOut" exitDelay={300}>{d.keyPointsLabel}</div>
          <ul className="bullets" stagger={220} delay={500} exitStagger={40} exitDelay={250}>
            {d.keyPoints.map((p, i) => <li anim="riseIn" at={cue(c.keyPoints, i)} exit="riseOut"><Rich text={p} /></li>)}
          </ul>
        </section>
        {d.glossary.length > 0 && (
          <section className="block">
            <div className="bar" anim="riseIn" delay={kpEnd + 300} at={c.glossaryBar != null ? c.glossaryBar * 1000 : null}
                 exit="riseOut" exitDelay={100}>{d.glossaryLabel}</div>
            <ul className="bullets" stagger={220} delay={kpEnd + 450} exitStagger={40} exitDelay={60}>
              {d.glossary.map((g, i) => <li anim="riseIn" at={cue(c.glossary, i)} exit="riseOut"><Rich text={glossText(g)} /></li>)}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
