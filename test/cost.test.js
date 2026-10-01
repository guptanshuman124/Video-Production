// Per-video cost: the call log (llm.jsonl) -> the breakdown the dashboard shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, merge } from '../src/config.js';
import { costBreakdown } from '../src/pipeline/cost.js';
import { synthesizeLecture } from '../src/sound/index.js';

const cfg = merge(loadConfig(), { costs: { usd_inr: 100, tts_inr_per_10k_chars: 30 }, tts: { provider: 'mock', cache: true } });

test('cost: OpenAI calls grouped by stage, cached calls free, voice priced per character', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-cost-'));
  const log = path.join(dir, 'llm.jsonl');
  const rows = [
    { task: 'slide-plan', model: 'gpt-6-sol', usage: { input_tokens: 1000, output_tokens: 200, cost_usd: 0.1 } },
    { task: 'slide-plan', model: 'gpt-6-sol', cached: true },
    { task: 'slide-write', model: 'gpt-6-sol', usage: { input_tokens: 500, output_tokens: 100, cost_usd: 0.05 } },
    { task: 'narrate', model: 'gpt-6-sol', usage: { input_tokens: 800, output_tokens: 900, cost_usd: 0.2 } },
    { task: 'review', model: 'gpt-6-astra', usage: { input_tokens: 9000, output_tokens: 300, cost_usd: 0.12 } },
    { task: 'art', model: 'gpt-image-2.5-sunburst', usage: { input_tokens: 90, output_tokens: 1300, cost_usd: 0.04 } },
    { task: 'art-check', model: 'gpt-6-astra', usage: { input_tokens: 1500, output_tokens: 40, cost_usd: 0.02 } },
    { task: 'tts', provider: 'sarvam', model: 'bulbul:v3', requests: 40, chars: 20000 },
  ];
  fs.writeFileSync(log, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n{"partial`);
  const c = costBreakdown(log, cfg);
  const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
  assert.equal(by.plan.calls, 1, 'the cached plan call is not billed');
  assert.equal(by.plan.inr, 10);
  assert.equal(by.review.models[0], 'gpt-6-astra');
  assert.equal(by.voice.chars, 20000);
  assert.equal(by.voice.inr, 60);
  assert.equal(c.openai_usd, 0.53);
  assert.equal(c.total_inr, 53 + 60);
  assert.equal(costBreakdown(path.join(dir, 'missing.jsonl'), cfg), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voice: characters are counted only for requests the engine actually served', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-tts-'));
  const content = { slides: [{ slide_number: 1, narration: { hinglish: 'यह एक test है। {{b1}} Osmosis को समझते हैं।' } }] };
  const log = path.join(dir, 'llm.jsonl');
  const first = await synthesizeLecture(content, cfg, { dir, cacheDir: path.join(dir, 'cache'), logFile: log });
  assert.ok(first.usage.chars > 0 && first.usage.requests > 0);
  const again = await synthesizeLecture(content, cfg, { dir, cacheDir: path.join(dir, 'cache'), logFile: log });
  assert.equal(again.usage.chars, 0, 'cached clips are free');
  const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map((r) => r.task), ['tts', 'tts']);
  fs.rmSync(dir, { recursive: true, force: true });
});
