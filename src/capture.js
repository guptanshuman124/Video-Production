// Turns the runtime's motion intervals into a per-frame plan, then drives the
// seek/screenshot/hold loop.

export function planFrames({ duration, fps, intervals, forceAll = false }) {
  const frameMs = 1000 / fps;
  const count = Math.max(1, Math.round((duration / 1000) * fps));
  // Pad by a frame on each side so the boundary frames of every animation are
  // genuinely shot rather than inherited from a stale hold.
  const padded = intervals.map(([a, b]) => [a - frameMs, b + frameMs]);
  const plan = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = i * frameMs;
    plan[i] = forceAll || padded.some(([a, b]) => t >= a && t <= b);
  }
  plan[0] = true;                       // never start on a hold
  return { plan, count, frameMs };
}

export async function renderFrames({ page, encoder, plan, count, frameMs, shot, onProgress }) {
  let captured = 0, held = 0, last = null;

  for (let i = 0; i < count; i++) {
    if (plan[i]) {
      const t = i * frameMs;
      await page.evaluate(async (ms) => {
        window.__seek(ms);
        // let style/layout settle before the shot
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, t);
      last = await page.screenshot({ ...shot, animations: 'allow', scale: 'device' });
      captured++;
    } else {
      held++;
    }
    await encoder.write(last);
    if (onProgress && (i % 20 === 0 || i === count - 1)) onProgress(i + 1, count, captured, held);
  }
  return { captured, held };
}

// Render one contiguous slice of the frame plan into its own encoder.
// Workers are independent because the timeline is deterministic: seeking to t
// always produces the same pixels, so no worker needs any other's state.
export async function renderChunk({ page, encoder, plan, from, to, frameMs, shot, onFrame }) {
  let captured = 0, held = 0, last = null;
  for (let i = from; i < to; i++) {
    // A chunk must open on a real screenshot — it has no previous frame to hold.
    if (plan[i] || last === null) {
      await page.evaluate(async (ms) => {
        window.__seek(ms);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, i * frameMs);
      last = await page.screenshot({ ...shot, animations: 'allow', scale: 'device' });
      captured++;
    } else {
      held++;
    }
    await encoder.write(last);
    onFrame?.();
  }
  return { captured, held };
}

export function splitRanges(count, jobs) {
  const size = Math.ceil(count / jobs);
  const out = [];
  for (let s = 0; s < count; s += size) out.push([s, Math.min(count, s + size)]);
  return out;
}
