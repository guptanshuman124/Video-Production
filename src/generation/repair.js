// Repair loops. A layer's output is checked by its gate; if errors remain,
// the LLM gets the exact validator messages and its previous answer and is
// asked to fix only those — up to config.llm.repair_attempts times. Whatever
// still fails is returned with its issues for the review queue.

import { repairBlock } from './prompts.js';

export const hasErrors = (issues) => issues.some((i) => i.severity === 'error');

// Whole-output repair (chapter plan, lecture plan). check(data) -> { value, issues }.
export async function callWithRepair({ llm, cfg, req, check }) {
  let res = await llm.call(req);
  let r = check(res.data);
  let attempts = 1;
  const hashes = [res.promptHash];
  while (hasErrors(r.issues) && attempts <= cfg.llm.repair_attempts) {
    res = await llm.call({ ...req, user: req.user + repairBlock(r.issues, res.data), salt: attempts });
    hashes.push(res.promptHash);
    r = check(res.data);
    attempts++;
  }
  return { ...r, attempts, promptHashes: hashes };
}

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// Per-slide repair. runBatch(indices, repair) -> Map(index -> raw output),
// where `repair` is null on the first pass or { issues: Map(index -> issues),
// previous: Map(index -> raw) } on later passes. checkOne(index, raw) ->
// { value, issues }. Only slides that still have errors are re-requested.
// `initial` ({ issues, previous } maps) makes the first pass a repair pass —
// used when the reviewer sends specific slides back with its findings.
export async function perSlideWithRepair({ indices, cfg, runBatch, checkOne, batchSize = cfg.llm.batch_size || 4, initial = null }) {
  const results = new Map();
  const raws = new Map();
  let pending = indices;
  let attempt = 0;
  const hashes = [];
  for (;;) {
    const repair = attempt === 0 && initial ? initial : attempt ? {
      issues: new Map(pending.map((i) => [i, results.get(i).issues])),
      previous: new Map(pending.map((i) => [i, raws.get(i)])),
    } : null;
    const outs = await Promise.all(chunk(pending, batchSize).map((b) => runBatch(b, repair, attempt)));
    for (const { map, promptHash } of outs) {
      hashes.push(promptHash);
      for (const [i, raw] of map) raws.set(i, raw);
    }
    for (const i of pending) {
      if (!raws.has(i)) { results.set(i, { value: null, issues: [{ code: 'NO_OUTPUT', severity: 'error', path: `s${i}`, message: `slide ${i}: the model returned nothing for this slide` }] }); continue; }
      results.set(i, checkOne(i, raws.get(i)));
    }
    pending = indices.filter((i) => hasErrors(results.get(i).issues));
    if (!pending.length || attempt >= cfg.llm.repair_attempts) break;
    attempt++;
  }
  return { results, attempts: attempt + 1, promptHashes: hashes };
}

// Repair text for a batch: each failing slide's errors and previous output.
export function batchRepairText(repair, indices) {
  if (!repair) return '';
  const lines = indices.map((i) => {
    const errs = (repair.issues.get(i) || []).filter((x) => x.severity === 'error').map((x) => `  - [${x.code}] ${x.message}`).join('\n');
    return `Slide ${i}:\n${errs}\n  previous answer: ${JSON.stringify(repair.previous.get(i))}`;
  }).join('\n\n');
  return `\n\n---\n\n# REPAIR\n\nYour previous answers for these slides broke the rules below. Return them again, fixing only these problems and keeping everything else unchanged.\n\n${lines}`;
}
