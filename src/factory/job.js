// One lecture, run as a child process of the worker (src/factory/worker.js) so
// a cancel can stop it cleanly and a crash never takes the worker down.
// Talks to the parent over IPC:
//   parent → child  { input, from, jobsDir }
//   child → parent  { type: 'event', event } … { type: 'log', line } … { type: 'result', result }

import fs from 'node:fs';
import path from 'node:path';
import { runLectureJob } from '../pipeline/run.js';
import { costBreakdown } from '../pipeline/cost.js';

// Shared with the summary child (summary-job.js) — kept in run-config.js so
// importing it never starts a lecture run.
import { jobDir, factoryConfig } from './run-config.js';

export { jobDir, factoryConfig };

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
  const dir = jobDir(jobsDir, input);
  let result;
  try {
    const r = await runLectureJob(input, {
      cfg, from: from || null, revealCheck: true,
      ttsCacheDir: path.join(dir, '.tts-cache'),
      log: (line) => send({ type: 'log', line }),
      onEvent: (event) => {
        // Gate reports can be large; send what the dashboard shows.
        if (event.type === 'gate' && event.report) {
          const { stage, status, issues = [] } = event.report;
          event = { type: 'gate', stage: event.stage, gate: stage, status, extra: event.extra,
                    issues: issues.slice(0, 60).map((i) => ({ code: i.code, severity: i.severity, path: i.path, message: String(i.message).slice(0, 600) })) };
        }
        send({ type: 'event', event });
      },
    });
    const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
    const content = read('content.json');
    result = {
      status: r.status, ok: r.status === 'ok', dir,
      video: r.status === 'ok' ? path.join(dir, 'lecture.mp4') : null,
      qa: read('qa.json'), stages: read('status.json', {}), reviewQueue: read('review-queue.json', []),
      slides: content?.slides?.length ?? null, cost_usd: llmCost(dir), cost: costBreakdown(path.join(dir, 'llm.jsonl'), cfg),
    };
  } catch (e) {
    result = { status: `crashed: ${e.message}`, ok: false, crashed: true, dir, error: String(e.stack || e.message).slice(0, 4000), cost_usd: llmCost(dir), cost: costBreakdown(path.join(dir, 'llm.jsonl'), cfg),
               stages: (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')); } catch { return {}; } })() };
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
