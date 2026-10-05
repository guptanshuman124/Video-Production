// One piece of a summary video's render, run as a child process of the worker.
// IPC (like job.js):
//   parent → child  { dir, idx, jobsDir }
//   child → parent  { type: 'progress', done, total } … { type: 'result', result }

import { renderSummaryPiece } from '../summary/run.js';
import { factoryConfig } from './run-config.js';

async function main({ dir, idx, jobsDir }) {
  const send = (m) => process.send?.(m);
  const cfg = factoryConfig(jobsDir);
  let last = 0;
  try {
    const r = await renderSummaryPiece({ dir, idx, cfg, onFrame: (done, total) => {
      if (Date.now() - last < 2000 && done < total) return;
      last = Date.now();
      send({ type: 'progress', done, total });
    } });
    send({ type: 'result', result: { ok: true, ...r } });
  } catch (e) {
    send({ type: 'result', result: { ok: false, error: String(e.stack || e.message).slice(0, 3000), status: e.message.slice(0, 500) } });
  }
}

if (process.send) {
  process.once('message', (msg) => {
    main(msg).then(() => setTimeout(() => process.exit(0), 200), (e) => {
      process.send({ type: 'result', result: { ok: false, error: String(e.stack || e.message), status: e.message } });
      setTimeout(() => process.exit(1), 200);
    });
  });
}
