// LLM access for the generation layers: one call shape for every provider,
// plus a response cache and a JSONL call log (model, tokens, cost, latency,
// cache hits).
//
//   const llm = createLLM(cfg, { cacheDir, logFile });
//   const { data } = await llm.call({ task, unit, system, user, schema, schemaName, context });
//
// `context` is the structured input of the layer; real providers ignore it,
// the mock provider builds its answer from it.
//
// Models: config llm.models maps a task (chapter-plan, slide-plan,
// slide-write, narrate, hinglish, review) to its own model; everything else
// uses llm.model. E.g. a cheap writer with a stronger reviewer.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openaiProvider } from './openai.js';
import { mockProvider } from './mock.js';

const PROVIDERS = { openai: openaiProvider, mock: mockProvider };

export const sha = (s, n = 16) => crypto.createHash('sha256').update(s).digest('hex').slice(0, n);

export function createLLM(cfg, { cacheDir = null, logFile = null, provider = null } = {}) {
  const make = PROVIDERS[provider || cfg.llm.provider];
  if (!make) throw new Error(`unknown llm.provider "${provider || cfg.llm.provider}" (known: ${Object.keys(PROVIDERS).join(', ')})`);
  const providers = new Map();
  const modelFor = (task) => cfg.llm.models?.[task] || cfg.llm.model;
  const providerFor = (task) => {
    const model = modelFor(task);
    if (!providers.has(model)) providers.set(model, make({ ...cfg, llm: { ...cfg.llm, model } }));
    return providers.get(model);
  };
  const p = providerFor(null);
  // Mock answers are free and change with the mock's code: never cache them.
  const useCache = cfg.llm.cache && cacheDir && p.name !== 'mock';
  if (useCache) fs.mkdirSync(cacheDir, { recursive: true });

  const log = (row) => {
    if (!logFile) return;
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), provider: p.name, ...row })}\n`);
  };

  return {
    name: p.name,
    model: p.model,
    modelFor,
    async call(req) {
      const q = providerFor(req.task);
      const key = sha(JSON.stringify([q.name, q.model, cfg.llm.temperature, cfg.llm.reasoning_effort, req.system, req.user, req.schema, req.salt ?? 0]), 32);
      const promptHash = sha(`${req.system}\n\n${req.user}`, 12);
      const file = useCache && path.join(cacheDir, `${key}.json`);
      if (file && fs.existsSync(file)) {
        const hit = JSON.parse(fs.readFileSync(file, 'utf8'));
        log({ task: req.task, unit: req.unit, model: q.model, cached: true, promptHash });
        return { data: hit.data, usage: hit.usage, cached: true, promptHash };
      }
      const t0 = Date.now();
      const res = await q.complete(req);
      let data;
      try { data = typeof res.text === 'string' ? JSON.parse(res.text) : res.data; } catch (e) {
        log({ task: req.task, unit: req.unit, model: q.model, error: `invalid JSON: ${e.message}`, ms: Date.now() - t0, promptHash });
        throw new Error(`${req.task} (${req.unit}): model returned invalid JSON: ${e.message}`);
      }
      log({ task: req.task, unit: req.unit, model: q.model, ms: Date.now() - t0, usage: res.usage, promptHash });
      if (file) fs.writeFileSync(file, JSON.stringify({ task: req.task, unit: req.unit, model: q.model, data, usage: res.usage }));
      return { data, usage: res.usage, cached: false, promptHash };
    },
  };
}
