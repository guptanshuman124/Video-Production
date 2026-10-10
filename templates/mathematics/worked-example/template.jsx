import { Rich, tex } from 'hvr';
import { Header, SlideTitle, Panel, common, cue, sec } from 'hvr/shared';

// Maths deck pages 7–8: a worked example — PROBLEM card, the SOLUTION as 2–6
// numbered steps (each a line of text, maths inline, plus an optional display
// equation), the final ANSWER, and an optional "watch out" line (the common
// mistake or an alternative method); image panel on the right when the
// problem needs its diagram (p7), full width without (p8).
// Reference: reference.png (p7) · reference-08.png

export const meta = {
  name: 'Worked example',
  number: 7,
  aliases: [],
  description: 'PROBLEM, SOLUTION steps (text + optional equation), ANSWER (+ common mistake / alternative); optional image.',
  duration: 14000,
  slide: {
    type: 'solved_example', name: 'Worked example',
    use: 'a solved problem: the problem (with its given values), 2–6 solution steps in the order a student writes them, the final answer; the diagram when a geometry / graph problem needs it',
    image: 'optional', ratios: ['3:4', '2:3', '1:1'],
    fields: {
      problem: { required: true, words: 40, note: 'as NCERT states it; maths inline as $…$' },
      steps: { required: true, items: [2, 6], fields: {
        text: { required: true, words: 14, note: 'what this step does, maths inline as $…$' },
        formula: { note: 'optional: the working of this step, bare LaTeX without $…$' },
      } },
      answer: { required: true, words: 20, note: 'the final answer with its unit, maths as $…$' },
      tip: { words: 18, note: 'optional: the common mistake to avoid, or an alternative method' },
      caption: { words: 10 },
    },
    reveal: [
      { field: 'steps', each: true, cue: 'cues.steps' },
      { field: 'answer', cue: 'cues.answer' },
    ],
    question: true,
    narrationWords: [240, 360],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  problemLabel: { type: 'text', default: 'PROBLEM', max: 24 },
  problem: { type: 'text', required: true, max: 320 },
  stepsLabel: { type: 'text', default: 'SOLUTION', max: 24 },
  steps: { type: 'list', min: 1, max: 6, of: {
    text: { type: 'text', required: true, max: 130 },
    formula: { type: 'text', max: 200, description: 'LaTeX' },
  } },
  answerLabel: { type: 'text', default: 'ANSWER', max: 24 },
  answer: { type: 'text', required: true, max: 180 },
  tipLabel: { type: 'text', default: 'Watch out', max: 24 },
  tip: { type: 'text', max: 160 },
  image: 'image',
  caption: { type: 'text', max: 60 },
  fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
  cues: { type: 'object', fields: { problem: 'number', steps: { type: 'list', of: 'number' }, answer: 'number', image: 'number' } },
};

// ---- fitting the SOLUTION card ------------------------------------------------------------
// A step with a 3-row matrix is three lines tall, and four of them overflow the
// card (lecture 2602: the 4th step sat below the card, so its reveal never showed).
// Heights are estimated from the text (measured in the stage, 1920×1080):
// a line of steps ≈ 1.5 × the step font, cards stack in 756px with 14px gaps.
// Tall solutions without an image go to two columns (steps 1–2 | 3–4); what
// still needs more than FIT_LIMIT × the room (the stage shrinks to 0.7 at most)
// is sent back to the writer by `check`.
const CARDS_H = 756;
const FIT_LIMIT = 1.2;           // the estimate runs up to ~15% low; the stage rescues 1/0.7 ≈ 1.43
const MATRIX = /\\begin\{([a-zA-Z]*matrix|array|cases|aligned)\}([\s\S]*?)\\end\{\1\}/g;
// Lines a piece of LaTeX occupies (measured in the stage; step formulas and
// text maths are both inline-style KaTeX): a matrix row is 1 line, 1.7 with a
// \dfrac in it, 1.1 with a small \frac; outside a matrix a \dfrac is 1.7
// lines, a \frac or limits 1.2. Lecture "Order of a Matrix": a 3-row answer
// matrix of \dfrac entries is 5 lines, not 3.
const rowLines = (r) => (/\\dfrac/.test(r) ? 1.7 : /\\t?frac/.test(r) ? 1.1 : 1);
function texRows(t) {
  const s = String(t || '');
  let rows = 1;
  for (const m of s.matchAll(MATRIX)) rows = Math.max(rows, m[2].split(/\\\\/).reduce((a, r) => a + rowLines(r), 0));
  const rest = s.replace(MATRIX, '');
  if (/\\dfrac/.test(rest)) rows = Math.max(rows, 1.7);
  else if (/\\t?frac|\\(sum|int|prod|lim)\s*_/.test(rest)) rows = Math.max(rows, 1.2);
  return rows;
}
// Characters' worth of width the LaTeX takes on one line: a matrix is about 5
// per column (entries plus column spacing and brackets).
function texChars(t) {
  return String(t || '')
    .replace(MATRIX, (_, __, body) => 'x'.repeat(5 * Math.max(...body.split(/\\\\/).map((r) => r.split('&').length)) + 2))
    .replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_$]/g, '').length;
}
const mathOf = (s) => [...String(s || '').matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
const textRows = (s) => Math.max(1, ...mathOf(s).map(texRows));
const textChars = (s) => String(s || '').replace(/\$([^$]+)\$/g, (_, m) => 'x'.repeat(texChars(m))).length;

// { columns: 1 | 2, ratio, rows?, problem, answer, room }: how much of the SOLUTION card's room
// the steps need (problem / answer / room: estimated card heights, px).
export function solutionFit(d) {
  const n = d.steps?.length || 0;
  const wide = d.image ? 1112 : 1688;                       // text width inside a card
  const box = (s, perLine, line) => {
    const lines = Math.max(1, Math.ceil(textChars(s) / perLine));
    return (lines - 1 + textRows(s)) * line;
  };
  const problem = Math.max(150, 71 + box(d.problem, wide / 13.5, 38));
  const answer = Math.max(130, 71 + box(d.answer, wide / 13.5, 38) + (d.tip ? 10 + box(d.tip, wide / 11, 31) : 0));
  const room = CARDS_H - 28 - problem - answer;
  const font = 29 - n * 0.8;
  const gap = 20 - n * 2;
  const stepH = (st, width) => {
    const perLine = (width - 42) / (font * 0.48);
    const chars = textChars(st.text) + (st.formula ? texChars(st.formula) + 2 : 0);
    const rows = Math.max(textRows(st.text), st.formula ? texRows(st.formula) : 1);
    return (Math.max(1, Math.ceil(chars / perLine)) - 1 + rows) * font * 1.5;
  };
  const need = (hs) => 74 + hs.reduce((a, h) => a + h, 0) + Math.max(0, hs.length - 1) * gap;
  const one = need((d.steps || []).map((st) => stepH(st, wide)));
  const fit = { columns: 1, ratio: room > 0 ? one / room : Infinity };
  if (fit.ratio > 1 && !d.image && n >= 3) {
    const half = (d.steps || []).map((st) => stepH(st, wide / 2 - 20));
    const k = Math.ceil(n / 2);
    const two = Math.max(need(half.slice(0, k)), need(half.slice(k)));
    const ratio = room > 0 ? two / room : Infinity;
    if (ratio < fit.ratio) return { columns: 2, ratio, rows: k, problem, answer, room };
  }
  return { ...fit, problem, answer, room };
}

// G3 (slides.js): a solution that cannot fit even in its best layout goes back to the writer.
// opts.fit: return the estimate itself (tests, calibration).
export function check(d, opts = {}) {
  const fit = solutionFit(d);
  if (opts.fit) return fit;
  if (fit.ratio <= FIT_LIMIT) return [];
  const big = (d.steps || []).filter((s) => texRows(s.formula) >= 3 || textRows(s.text) >= 3).length;
  return [`the worked solution is about ${Math.round(fit.ratio * 100)}% of the height its card has${big ? ` (${big} step(s) show a matrix of 3+ rows)` : ''}: the last steps would be cut off screen. Show fewer tall formulas — keep a big matrix only where it is the point of the step, give other results in words or as a single entry (e.g. $(AB)_{11}=4$), shorten the problem/answer, or split the example across two solved_example slides`];
}

export default function WorkedExample(d) {
  const c = d.cues || {};
  const n = d.steps.length;
  const fit = solutionFit(d);
  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <div className={d.image ? 'cards with-image' : 'cards'} style={{ '--n': n, '--rows': fit.rows || n }}>
        <section className="card problem" anim="riseIn" delay={350} at={sec(c.problem)} exit="riseOut">
          <div className="label">{d.problemLabel}</div>
          <div className="text"><Rich text={d.problem} /></div>
        </section>
        <section className="card solution" anim="riseIn" delay={800} at={cue(c.steps, 0)} exit="riseOut">
          <div className="label">{d.stepsLabel}</div>
          <ol className={fit.columns === 2 ? 'steps two' : 'steps'} stagger={260} delay={1100}>
            {d.steps.map((s, i) => (
              <li anim="riseIn" at={cue(c.steps, i)}>
                <span className="stext"><Rich text={s.text} /></span>
                {s.formula && <span className="seq">{tex(s.formula)}</span>}
              </li>
            ))}
          </ol>
        </section>
        <section className="card answer" anim="riseIn" delay={1900} at={sec(c.answer)} exit="riseOut">
          <div className="label">{d.answerLabel}</div>
          <div className="text strong"><Rich text={d.answer} /></div>
          {d.tip && <div className="tip"><b>{d.tipLabel}:</b> <Rich text={d.tip} /></div>}
        </section>
      </div>
      {d.image && <Panel className="side" image={d.image} caption={d.caption} fit={d.fit} at={sec(c.image)} />}
    </>
  );
}
