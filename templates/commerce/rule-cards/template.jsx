import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// Commerce deck page 16 ("Golden Rules of Accounting"): 2–4 stacked cards, one
// per parallel rule — a small caps LABEL (the kind of account / the principle),
// the RULE in bold, and an EXAMPLE line under it. Each card appears as the
// narration reaches it.
// Reference: reference.png

export const meta = {
  name: 'Rule cards',
  number: 16,
  aliases: [],
  description: '2–4 stacked cards: label, the rule (bold), an example line.',
  duration: 12000,
  slide: {
    type: 'rule_cards', name: 'Rule cards',
    use: 'a set of 2–4 parallel rules, each with a worked example: the golden rules (Personal / Real / Nominal), the modern rules of debit and credit, treatment rules (goodwill, revaluation), principles of management taken a few at a time',
    image: 'none',
    fields: {
      cards: { required: true, items: [2, 4], fields: {
        label: { required: true, words: 4, note: 'what the rule is for, e.g. "Personal Account"' },
        rule: { required: true, words: 14, note: 'the rule itself, e.g. "Debit the receiver, credit the giver"' },
        example: { words: 22, note: 'one worked example: "Cash paid to Ramesh — Ramesh’s A/c is debited (he is the receiver)"' },
      } },
    },
    reveal: [{ field: 'cards', each: true, cue: 'cues.cards' }],
    narrationWords: [230, 340],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  rulePrefix: { type: 'text', default: 'Rule:', max: 12 },
  examplePrefix: { type: 'text', default: 'Example:', max: 12 },
  cards: { type: 'list', min: 1, max: 4, of: {
    label: { type: 'text', required: true, max: 40 },
    rule: { type: 'text', required: true, max: 110 },
    example: { type: 'text', max: 170 },
  } },
  cues: { type: 'object', fields: { cards: { type: 'list', of: 'number' } } },
};

export default function RuleCards(d) {
  const c = d.cues || {};
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className="cards" style={{ '--n': d.cards.length }} stagger={350} delay={500} exitStagger={60} exitDelay={200}>
        {d.cards.map((r, i) => (
          <section className="card" anim="riseIn" at={cue(c.cards, i)} exit="riseOut">
            <div className="label">{r.label}</div>
            <div className="rule"><span className="pre">{d.rulePrefix}</span> <Rich text={r.rule} /></div>
            {r.example && <div className="example"><span className="pre">{d.examplePrefix}</span> <Rich text={r.example} /></div>}
          </section>
        ))}
      </div>
    </>
  );
}
