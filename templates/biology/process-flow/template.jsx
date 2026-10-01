import { Rich } from 'hvr';
import { Header, SlideTitle, common, cue } from 'hvr/shared';

// A process, cycle or chain of events as connected step boxes. Nothing here
// is drawn by an image model: the boxes are the writer's own NCERT-checked
// text and the arrows are geometry, so the graphic cannot be "wrong" in the
// way a generated diagram can. Each step rises in on its narration marker,
// with the arrow into it drawing itself just before.
//
// Layouts: 3–4 steps in one row; 5–6 steps as a two-row snake (left → right,
// down, right → left); `cycle: true` puts the steps round an ellipse with
// the last arrow closing the loop, and the note in the middle.

export const meta = {
  name: 'Process / cycle diagram',
  number: 21,
  aliases: [],
  description: '3–6 steps as boxes joined by self-drawing arrows: a row, a two-row snake, or a closed cycle.',
  duration: 14000,
  slide: {
    type: 'process_flow', name: 'Process / cycle diagram',
    use: 'a process, cycle or chain of events in 3–6 ordered steps, drawn as connected boxes with animated arrows (stages of digestion, the water cycle, the steps of a method or an algorithm, a chain of causes); set `cycle` true only when the last step leads back to the first',
    image: 'none',
    fields: {
      steps: { required: true, items: [3, 6], fields: { label: { required: true, words: 5 }, detail: { words: 14 } } },
      cycle: { note: 'true only for a closed cycle (the last step leads back to the first)' },
      note: { words: 22 },
    },
    reveal: [{ field: 'steps', each: true, cue: 'cues.steps', hint: 'this step and the arrow into it appear — say what happens at this step and how it leads to the next' }],
    narrationWords: [180, 280],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 60 },
  steps: { type: 'list', min: 2, max: 6, of: {
    label: { type: 'text', required: true, max: 44 },
    detail: { type: 'text', max: 120 },
  } },
  cycle: { type: 'boolean', default: false },
  note: { type: 'text', max: 180 },
  cues: { type: 'object', fields: { steps: { type: 'list', of: 'number' } } },
};

export function check(d) {
  return d.cycle && d.steps.length < 3 ? ['a cycle needs at least 3 steps'] : [];
}

// ---- geometry (1920×1080 px) ------------------------------------------------------

const LEFT = 84, WIDTH = 1752, GAP = 96;

function rowLayout(n, hasNote) {
  if (n <= 4) {
    const w = (WIDTH - (n - 1) * GAP) / n, h = n === 4 ? 330 : 300;
    const top = hasNote ? 330 : 370;
    return Array.from({ length: n }, (_, i) => ({ x: LEFT + i * (w + GAP), y: top, w, h }));
  }
  const k = Math.ceil(n / 2);
  const w = (WIDTH - (k - 1) * GAP) / k, h = 246;
  const tops = [262, 262 + h + 112];
  return Array.from({ length: n }, (_, i) => {
    const row = i < k ? 0 : 1;
    const col = row === 0 ? i : k - 1 - (i - k);           // second row runs right → left
    return { x: LEFT + col * (w + GAP), y: tops[row], w, h };
  });
}

function cycleLayout(n) {
  const w = n <= 4 ? 420 : 380, h = n <= 4 ? 196 : 176;
  const cx = 960, cy = 616, rx = 540, ry = 262;
  return Array.from({ length: n }, (_, i) => {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    return { x: cx + rx * Math.cos(a) - w / 2, y: cy + ry * Math.sin(a) - h / 2, w, h, a };
  });
}

const inside = (p, b, pad = 18) => p[0] > b.x - pad && p[0] < b.x + b.w + pad && p[1] > b.y - pad && p[1] < b.y + b.h + pad;

// Straight arrow between neighbouring boxes of a row / snake.
function straightArrow(a, b) {
  const cy = (r) => r.y + r.h / 2, cx = (r) => r.x + r.w / 2;
  if (Math.abs(a.y - b.y) < 1) {
    return b.x > a.x ? [[a.x + a.w + 14, cy(a)], [b.x - 14, cy(b)]] : [[a.x - 14, cy(a)], [b.x + b.w + 14, cy(b)]];
  }
  return [[cx(a), a.y + a.h + 14], [cx(b), b.y - 14]];
}

// Arc along the cycle's ellipse from box a to box b, trimmed to the gap between them.
function arcArrow(a, b, n) {
  const cx = 960, cy = 616, rx = 540, ry = 262;
  const a0 = a.a, a1 = b.a > a.a ? b.a : b.a + 2 * Math.PI;
  const pts = [];
  for (let k = 0; k <= 120; k++) {
    const t = a0 + ((a1 - a0) * k) / 120;
    const p = [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
    if (!inside(p, a) && !inside(p, b)) pts.push(p);
  }
  return pts.length >= 2 ? pts : null;
}

const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

function head(pts) {
  const [p1, p2] = [pts.at(-2), pts.at(-1)];
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  const b = [p2[0] - ux * 20, p2[1] - uy * 20];
  return `${p2[0].toFixed(1)},${p2[1].toFixed(1)} ${(b[0] + px * 11).toFixed(1)},${(b[1] + py * 11).toFixed(1)} ${(b[0] - px * 11).toFixed(1)},${(b[1] - py * 11).toFixed(1)}`;
}

export default function ProcessFlow(d) {
  const c = d.cues || {};
  const n = d.steps.length;
  const cycle = !!d.cycle && n >= 3;
  const boxes = cycle ? cycleLayout(n) : rowLayout(n, !!d.note);
  // Step i appears on its marker (or on a stagger); the arrow into it draws just before.
  const when = (i, offset = 0) => {
    const t = cue(c.steps, i);
    return t != null ? { at: Math.max(0, t + offset) } : { delay: Math.max(0, 900 + i * 1700 + offset) };
  };
  const arrows = [];
  for (let i = 1; i < n; i++) arrows.push({ pts: cycle ? arcArrow(boxes[i - 1], boxes[i], n) : straightArrow(boxes[i - 1], boxes[i]), t: when(i, -450) });
  if (cycle) arrows.push({ pts: arcArrow(boxes[n - 1], boxes[0], n), t: when(n - 1, 900), closing: true });

  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      <svg className="links" width="1920" height="1080" viewBox="0 0 1920 1080" exit="fadeOut">
        {arrows.filter((a) => a.pts).map((a) => (
          <g className={a.closing ? 'arrow closing' : 'arrow'}>
            <path d={pathOf(a.pts)} pathLength="1" style={{ strokeDasharray: 1 }} anim="draw" dur={650} {...a.t} />
            <polygon points={head(a.pts)} anim="fadeIn" dur={250} {...(a.t.at != null ? { at: a.t.at + 560 } : { delay: a.t.delay + 560 })} />
          </g>
        ))}
      </svg>
      {d.steps.map((s, i) => {
        const b = boxes[i];
        return (
          <section className={cycle ? 'step in-cycle' : 'step'} style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }}
                   anim="riseIn" {...when(i)} exit="riseOut">
            <div className="head"><span className="n">{i + 1}</span><h2><Rich text={s.label} /></h2></div>
            {s.detail && <p><Rich text={s.detail} /></p>}
          </section>
        );
      })}
      {d.note && <p className={cycle ? 'note centre' : 'note'} anim="fadeIn" {...when(n - 1, cycle ? 1600 : 900)} exit="fadeOut"><Rich text={d.note} /></p>}
    </>
  );
}
