// What one lecture cost, from its call log (llm.jsonl): every OpenAI call
// (text and pictures) is logged with its USD cost, and the voice stage logs
// the characters actually sent to the TTS engine. The log survives retries in
// the same job folder, so the figure includes failed attempts and repairs.
// Cached answers cost nothing and are not counted.

import fs from 'node:fs';

const GROUPS = [
  { key: 'plan', label: 'Slide planning', tasks: ['slide-plan', 'chapter-plan'] },
  { key: 'write', label: 'Slide writing', tasks: ['slide-write'] },
  { key: 'narrate', label: 'Narration (Hinglish)', tasks: ['narrate', 'hinglish'] },
  { key: 'review', label: 'Fact review', tasks: ['review'] },
  { key: 'art', label: 'Pictures', tasks: ['art'] },
  { key: 'art-check', label: 'Picture checks', tasks: ['art-check'] },
];

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function costRates(cfg) {
  const c = cfg.costs || {};
  return { usd_inr: c.usd_inr ?? 96, tts_inr_per_10k_chars: c.tts_inr_per_10k_chars ?? 30 };
}

// -> { total_inr, openai_usd, openai_inr, voice_inr, rates, items: [...] } or null (no log)
export function costBreakdown(logFile, cfg) {
  if (!logFile || !fs.existsSync(logFile)) return null;
  const rows = [];
  for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a partial last line */ }
  }
  const rates = costRates(cfg);
  const items = [];
  for (const g of GROUPS) {
    const mine = rows.filter((r) => g.tasks.includes(r.task) && !r.cached && r.usage);
    if (!mine.length) continue;
    const usd = mine.reduce((a, r) => a + Number(r.usage.cost_usd || 0), 0);
    items.push({
      key: g.key, label: g.label, calls: mine.length,
      models: [...new Set(mine.map((r) => r.model).filter(Boolean))],
      input_tokens: mine.reduce((a, r) => a + (r.usage.input_tokens || 0), 0),
      output_tokens: mine.reduce((a, r) => a + (r.usage.output_tokens || 0), 0),
      usd: round(usd, 4), inr: round(usd * rates.usd_inr),
    });
  }
  // Anything else that carried a cost (a task added later) is still counted.
  const known = new Set(GROUPS.flatMap((g) => g.tasks).concat('tts'));
  const other = rows.filter((r) => !known.has(r.task) && !r.cached && r.usage?.cost_usd);
  if (other.length) {
    const usd = other.reduce((a, r) => a + Number(r.usage.cost_usd || 0), 0);
    items.push({ key: 'other', label: 'Other AI calls', calls: other.length, models: [...new Set(other.map((r) => r.model).filter(Boolean))], input_tokens: 0, output_tokens: 0, usd: round(usd, 4), inr: round(usd * rates.usd_inr) });
  }
  const tts = rows.filter((r) => r.task === 'tts');
  if (tts.length) {
    const chars = tts.reduce((a, r) => a + (r.chars || 0), 0);
    items.push({
      key: 'voice', label: `Voice (${tts[0].provider || 'tts'})`, calls: tts.reduce((a, r) => a + (r.requests || 0), 0),
      models: [...new Set(tts.map((r) => r.model).filter(Boolean))], chars,
      usd: null, inr: round((chars / 10000) * rates.tts_inr_per_10k_chars),
    });
  }
  const openaiUsd = items.filter((i) => i.usd != null).reduce((a, i) => a + i.usd, 0);
  const voiceInr = items.find((i) => i.key === 'voice')?.inr || 0;
  return {
    total_inr: round(openaiUsd * rates.usd_inr + voiceInr),
    openai_usd: round(openaiUsd, 4), openai_inr: round(openaiUsd * rates.usd_inr), voice_inr: round(voiceInr),
    voice_known: tts.length > 0, rates, items,
  };
}
