import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue, sec } from 'hvr/shared';

// Language deck: one grammar rule (व्याकरण) — the RULE card, an optional
// PATTERN bar (the sentence structure, e.g. "Subject + has/have + V3"), then
// 2–4 example sentences, each with a short note. *Highlight* the part of
// each sentence the rule is about.

export const meta = {
  name: 'Grammar rule',
  number: 17,
  aliases: [],
  description: 'Rule card, optional pattern bar, 2–4 example sentences with notes.',
  duration: 12000,
  slide: {
    type: 'grammar_rule', name: 'Grammar rule',
    use: 'one grammar rule taught with examples (tenses, voice, reported speech, determiners, subject–verb agreement; संधि, समास, उपसर्ग-प्रत्यय, वाक्य-भेद): the rule, its sentence pattern, and example sentences with the key part *highlighted*',
    image: 'none',
    fields: {
      rule: { required: true, words: 35, note: 'the rule in simple words' },
      pattern: { words: 14, note: 'optional: the structure, e.g. "Subject + has / have + V3 + object" or "देव + आलय = देवालय"' },
      examples: { required: true, items: [2, 4], fields: {
        sentence: { required: true, words: 20, note: 'with the part the rule is about in *asterisks*' },
        note: { words: 14, note: 'optional: what to notice' },
      } },
    },
    reveal: [
      { field: 'rule', cue: 'cues.rule' },
      { field: 'pattern', cue: 'cues.pattern' },
      { field: 'examples', each: true, cue: 'cues.examples' },
    ],
    narrationWords: [230, 340],
    labels: { hindi: { ruleLabel: 'नियम', patternLabel: 'संरचना', examplesLabel: 'उदाहरण' } },
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  ruleLabel: { type: 'text', default: 'Rule', max: 20 },
  rule: { type: 'text', required: true, max: 260 },
  patternLabel: { type: 'text', default: 'Pattern', max: 20 },
  pattern: { type: 'text', max: 110 },
  examplesLabel: { type: 'text', default: 'Examples', max: 20 },
  examples: { type: 'list', min: 1, max: 4, of: {
    sentence: { type: 'text', required: true, max: 150 },
    note: { type: 'text', max: 100 },
  } },
  cues: { type: 'object', fields: { rule: 'number', pattern: 'number', examples: { type: 'list', of: 'number' } } },
};

export default function GrammarRule(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="col">
        <section className="rule" anim="riseIn" delay={400} at={sec(c.rule)} exit="riseOut">
          <div className="label">{d.ruleLabel}</div>
          <div className="rtext"><Rich text={d.rule} /></div>
        </section>
        {d.pattern && (
          <section className="pattern" anim="riseIn" delay={900} at={sec(c.pattern)} exit="riseOut">
            <span className="label">{d.patternLabel}</span><span className="ptext"><Rich text={d.pattern} /></span>
          </section>
        )}
        <div className="label exlabel" anim="fadeIn" delay={1200} at={cue(c.examples, 0)} exit="fadeOut">{d.examplesLabel}</div>
        <div className="examples" stagger={350} delay={1300} exitStagger={50} exitDelay={200}>
          {d.examples.map((e, i) => (
            <div className="ex" anim="riseIn" at={cue(c.examples, i)} exit="riseOut">
              <span className="num">{i + 1}</span>
              <span className="sentence"><Rich text={e.sentence} /></span>
              {e.note && <span className="note"><Rich text={e.note} /></span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
