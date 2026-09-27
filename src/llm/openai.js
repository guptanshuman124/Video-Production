// OpenAI provider: Responses API with Structured Outputs (json_schema,
// strict). The schema guarantees the JSON shape; word limits, counts and
// every other rule are still enforced by the validators afterwards.
//
// Env: OPENAI_API_KEY (required), OPENAI_BASE_URL (optional, for a proxy).
// Config llm: model, reasoning_effort (current models reject `temperature`;
// it is only sent when set), timeout_s, retries, prices (USD per 1M tokens,
// used to log each call's cost).

import OpenAI from 'openai';

export function openaiProvider(cfg) {
  const { model, temperature, reasoning_effort: effort, timeout_s: timeout, retries } = cfg.llm;
  let client = null;
  const get = () => {
    if (client) return client;
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set (put it in the environment or .env)');
    if (!model) throw new Error('config llm.model is not set');
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: (timeout || 180) * 1000,
      maxRetries: retries ?? 3,
    });
    return client;
  };

  // Cost of one call from its usage (cached input billed at the cached rate).
  const price = cfg.llm.prices?.[model];
  const costOf = (u) => {
    if (!price || !u) return null;
    const cached = u.input_tokens_details?.cached_tokens || 0;
    const usd = ((u.input_tokens - cached) * price.input + cached * (price.cached_input ?? price.input) + u.output_tokens * price.output) / 1e6;
    return Math.round(usd * 1e6) / 1e6;
  };

  return {
    name: 'openai',
    model,
    async complete({ system, user, schema, schemaName }) {
      const res = await get().responses.create({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        text: { format: { type: 'json_schema', name: schemaName || 'output', schema, strict: true } },
        ...(effort ? { reasoning: { effort } } : {}),
        ...(temperature == null ? {} : { temperature }),
      });
      if (res.status === 'incomplete') {
        throw new Error(`OpenAI response incomplete: ${res.incomplete_details?.reason || 'unknown reason'}`);
      }
      const refusal = res.output?.flatMap((o) => o.content || []).find((c) => c.type === 'refusal');
      if (refusal) throw new Error(`OpenAI refused: ${refusal.refusal}`);
      return { text: res.output_text, usage: { ...res.usage, cost_usd: costOf(res.usage) } };
    },
  };
}
