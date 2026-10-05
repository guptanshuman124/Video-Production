// One chapter summary video, run as a child process of the worker (like
// job.js for a lecture). IPC:
//   parent → child  { input, from, jobsDir }
//   child → parent  { type: 'event', event } … { type: 'log', line } … { type: 'result', result }

import fs from 'node:fs';
import path from 'node:path';
import { runSummaryJob, summaryDir, SUMMARY_VIDEO } from '../summary/run.js';
import { costBreakdown } from '../pipeline/cost.js';
import { factoryConfig } from './run-config.js';

function llmCost(dir) {
  const f = path.join(dir, 'llm.jsonl');
  if (!fs.existsSync(f)) return 0;
  let usd = 0;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); usd += Number(row.cost_usd ?? row.usage?.cost_usd ?? 0); } catch { /* partial line */ }
  }
  return usd;
}

async function main({ input, from, jobsDir }) {
  const send = (m) => process.send?.(m);
  const cfg = factoryConfig(jobsDir);
  const dir = summaryDir(jobsDir, input);
  const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
  let result;
  try {
    const r = await runSummaryJob(input, {
      cfg, from: from || null, revealCheck: true,
      // The render is spread over the workers: the job stops once the pieces are planned.
      distributed: true,
      ttsCacheDir: path.join(dir, '.tts-cache'),
      log: (line) => send({ type: 'log', line }),
      onEvent: (event) => {
        if (event.type === 'gate' && event.report) {
          const { stage, status, issues = [] } = event.report;
          event = { type: 'gate', stage: event.stage, part: event.part, gate: stage, status, extra: event.extra,
                    issues: issues.slice(0, 60).map((i) => ({ code: i.code, severity: i.severity, path: i.path, message: String(i.message).slice(0, 600) })) };
        }
        send({ type: 'event', event });
      },
    });
    const content = read('content.json');
    result = {
      status: r.status, ok: r.status === 'ok', dir,
      ...(r.status === 'render-pending' ? { renderPending: true, renderPlan: r.renderPlan } : {}),
      video: r.status === 'ok' ? path.join(dir, SUMMARY_VIDEO) : null,
      qa: read('qa.json'), stages: read('status.json', {}), reviewQueue: read('review-queue.json', []),
      slides: content?.slides?.length ?? null, parts: content?.parts?.length ?? null,
      cost_usd: llmCost(dir), cost: costBreakdown(path.join(dir, 'llm.jsonl'), cfg),
    };
  } catch (e) {
    result = { status: `crashed: ${e.message}`, ok: false, crashed: true, dir, error: String(e.stack || e.message).slice(0, 4000), cost_usd: llmCost(dir), cost: costBreakdown(path.join(dir, 'llm.jsonl'), cfg), stages: read('status.json', {}) };
  }
  send({ type: 'result', result });
}

if (process.send) {
  process.once('message', (msg) => {
    main(msg).then(() => setTimeout(() => process.exit(0), 200), (e) => {
      process.send({ type: 'result', result: { status: `crashed: ${e.message}`, ok: false, crashed: true, error: String(e.stack || e.message) } });
      setTimeout(() => process.exit(1), 200);
    });
  });
}
