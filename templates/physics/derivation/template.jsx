import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Physics deck page 7 (also Chemistry 7): a derivation as step cards joined by
// arrows (each: a line of text, one equation, a step label S1, S2 …), with the
// target equation in a cream "Goal equation" box and a figure on the right.
// Without an image the steps and goal use the full width.
// Reference: reference.png

export const meta = {
  name: 'Derivation',
  number: 7,
  aliases: [],
  description: 'Derivation steps (text + equation, S1…) linked by arrows; goal equation box; optional image panel.',
  duration: 12000,
  slide: {
    type: 'derivation', name: 'Derivation',
    use: 'an NCERT derivation in 2–4 steps, each a short line plus one equation, building to a stated goal equation',
    image: 'optional', ratios: ['1:1', '4:3', '3:4', '3:2'],
    fields: {
      goal: { required: true, latex: true, note: 'the final result being derived, LaTeX without $…$, e.g. "v^2 = u^2 + 2as"' },
      steps: { required: true, items: [2, 4], fields: {
        text: { required: true, words: 14, note: 'what this step does, e.g. "Substitute t from the first equation"' },
        formula: { required: true, note: 'the equation reached at this step, LaTeX without $…$' },
      } },
      caption: { words: 10 },
    },
    reveal: [{ field: 'steps', each: true, cue: 'cues.steps' }],
    narrationWords: [240, 340],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  goalLabel: { type: 'text', default: 'Goal equation:', max: 30 },
  goal: { type: 'text', required: true, max: 200, description: 'LaTeX' },
  steps: { type: 'list', min: 1, max: 4, of: {
    text: { type: 'text', required: true, max: 110 },
    formula: { type: 'text', required: true, max: 220, description: 'LaTeX' },
  } },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { steps: { type: 'list', of: 'number' }, goal: 'number', image: 'number' } },
};

// Room for the steps (stage/index.html shrinks a spilling card to 70%; FIT_LIMIT keeps a margin).
// Measured in the stage (Lecture "Applications of Gauss's Law", "Field of an Infinite Wire"):
//   card padding 42 + 10 between text and equation (no image: 24, side by side) · a text line
//   33.4px, ~70 characters wide with an image, ~56 beside the equation without one · an equation
//   1.25em tall, +1.2em per level of fractions (a fraction inside a fraction: 3.65em), at 40 − 2n px
//   · arrows 43px · the goal box ≥132px.
const FIT_LIMIT = 1.25;
// Deepest nesting of \frac / \dfrac / \tfrac (their two brace groups), or 1 for a big operator.
function fracDepth(f) {
  const s = String(f || '');
  const stack = [];               // per open brace: is it a fraction argument
  const pending = [0];            // per brace level: fraction arguments still to open there
  let depth = 0, max = /\\(sum|int|prod|lim)\s*_/.test(s) ? 1 : 0;
  for (let i = 0; i < s.length; i++) {
    const m = /^\\[dt]?frac/.exec(s.slice(i, i + 6));
    if (m) { pending[stack.length] = 2; max = Math.max(max, depth + 1); i += m[0].length - 1; continue; }
    if (s[i] === '{') {
      const arg = pending[stack.length] > 0;
      if (arg) { pending[stack.length]--; depth++; }
      stack.push(arg);
      pending[stack.length] = 0;
    } else if (s[i] === '}' && stack.length && stack.pop()) depth--;
  }
  return max;
}
const eqEm = (f) => 1.25 + 1.2 * fracDepth(f);
const textLines = (t, per) => Math.max(1, Math.ceil(String(t || '').replace(/\$|\*\*|\\[a-zA-Z]+|[{}^_]/g, '').length / per));
export function stepsFit(d) {
  const n = d.steps.length;
  const fs = 40 - 2 * n;
  const goal = Math.max(132, 20 + 26 + 4 + 30 * eqEm(d.goal));
  const share = Math.min(257, ((d.image ? 771 : 771 - goal - 20) - 43 * (n - 1)) / n);
  const need = d.steps.map((s) => (d.image
    ? 52 + 33.4 * textLines(s.text, 70) + fs * eqEm(s.formula)
    : 24 + Math.max(33.4 * textLines(s.text, 56), fs * eqEm(s.formula))));
  const worst = Math.max(...need);
  return { share: Math.round(share), need: need.map(Math.round), ratio: worst / share, step: need.indexOf(worst) + 1 };
}

export function check(d, opts = {}) {
  const fit = stepsFit(d);
  if (opts.fit) return fit;
  return fit.ratio <= FIT_LIMIT ? [] : [`step S${fit.step} needs ~${fit.need[fit.step - 1]}px but each step has ${fit.share}px — it would be cut off screen; shorten its text or split the derivation (fewer steps per slide)`];
}

export default function Derivation(d) {
  const c = d.cues || {};
  const n = d.steps.length;
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'layout with-image' : 'layout'} style={{ '--n': n }}>
        <div className="steps" stagger={300} delay={700} exitStagger={60} exitDelay={200}>
          {d.steps.map((s, i) => (
            <>
              <section className="step" anim="riseIn" at={cue(c.steps, i)} exit="riseOut">
                <div className="stext"><Rich text={s.text} /></div>
                <div className="seq">{tex(s.formula, { display: true })}</div>
                <div className="slabel">S{i + 1}</div>
              </section>
              {i < n - 1 && <div className="arrow" anim="fadeIn" at={cue(c.steps, i + 1)} exit="fadeOut"><i /></div>}
            </>
          ))}
        </div>
        <aside className="right">
          <section className="goal" anim="riseIn" delay={450} at={sec(c.goal)} exit="riseOut">
            <div className="glabel">{d.goalLabel}</div>
            <div className="geq">{tex(d.goal, { display: true })}</div>
          </section>
          {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
        </aside>
      </div>
    </>
  );
}
