// Illustrations for `illustration` slides: generated, then checked, never trusted blind.
//
//   1. The writer describes one plain scene (`art_prompt`); the template's
//      check() already refused prompts asking for text, labels or diagrams.
//   2. The image model draws it in one house style (STYLE below), so every
//      lecture's pictures look like one product and sit calmly on the slides.
//   3. A vision model looks at the result against the prompt and the slide's
//      points: any visible text, a mismatch, something misleading for a
//      student (wrong anatomy, impossible physics, distorted hands or faces)
//      or anything unsuitable for children rejects it. Rejected pictures are
//      redrawn once with the reviewer's note; if that fails too the slide is
//      built without a picture (the template has a text-only layout).
//
// Pictures are cached by prompt + model + style under jobs/.cache/art, so a
// re-run of build never pays twice. Every call is logged with its cost in the
// lecture's llm.jsonl next to the text-model calls.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import OpenAI from 'openai';
import { sha } from '../llm/index.js';
import { FFMPEG } from '../tools.js';

export const STYLE = 'Clean, soft semi-realistic educational illustration in a soft, fresh palette that sits on light sky-blue and sage slides (soft sky blue, sage teal, warm amber accents, clean whites), gently saturated, never neon or dark, natural soft light, uncluttered background, one clear subject, accurate real-world proportions and details. Indian context wherever people or places appear. Absolutely no text, letters, numbers, labels, arrows, logos, signs or watermarks anywhere in the image.';

const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['has_text', 'matches_prompt', 'misleading', 'suitable', 'problems'],
  properties: {
    has_text: { type: 'boolean' }, matches_prompt: { type: 'boolean' }, misleading: { type: 'boolean' },
    suitable: { type: 'boolean' }, problems: { type: 'string' },
  },
};

const checkPrompt = ({ prompt, points, subject, klass }) => `You check one illustration for a CBSE Class ${klass} ${subject} lecture slide before students see it.
It was generated from this description:
"${prompt}"
The slide beside it says:
${points.map((p) => `- ${p}`).join('\n')}

Answer strictly about what is visible in the image:
- has_text: true if ANY letters, words, numbers, labels, logos, signs or watermark-like marks are visible, even blurry or gibberish ones.
- matches_prompt: true only if the main subject and scene clearly match the description, including every detail the description says must be visible.
- If the description or the slide relies on a scientific effect being visible (light bending, a reflection, a colour change, a force acting, a biological feature), that effect must be shown correctly and unmistakably; if it is missing, weak or wrong, set misleading to true.
- misleading: true if anything would teach a student something false about this topic (wrong anatomy or number of limbs, impossible physics, the wrong object for its purpose, a wrongly shaped instrument), or if anything looks distorted or uncanny (malformed hands or faces, melted objects).
- suitable: true if it is appropriate for school children (no violence, gore, fear or inappropriate content).
- problems: one short line saying what is wrong; empty when nothing is.`;

export function artConfig(cfg) {
  return {
    enabled: true, model: 'gpt-image-2.5-sunburst', quality: 'high', size: '1536x1024',
    check_model: cfg.llm?.models?.review || cfg.llm?.model, attempts: 2, concurrency: 2, max_per_lecture: 2,
    prices: { text_input: 5, image_output: 30 }, ...(cfg.art || {}),
  };
}

// Is generation possible in this run? (real provider + key + switched on)
export const artAvailable = (cfg) => !!(artConfig(cfg).enabled && process.env.OPENAI_API_KEY);

async function limit(n, items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// items: [{ key, prompt, points }]. Returns [{ key, file?, problems?, cost }]:
// `file` (a JPEG in cacheDir) when a picture passed the check.
export async function illustrate(items, cfg, { cacheDir, logFile = null, subject = 'Science', klass = 10, client = null } = {}) {
  const A = artConfig(cfg);
  fs.mkdirSync(cacheDir, { recursive: true });
  const api = client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 300000, maxRetries: 2 });
  const log = (row) => {
    if (!logFile) return;
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), provider: 'openai', ...row })}\n`);
  };
  const imageCost = (u) => (u ? Math.round((((u.input_tokens || 0) * A.prices.text_input + (u.output_tokens || 0) * A.prices.image_output) / 1e6) * 1e6) / 1e6 : null);

  const one = async (it) => {
    const key = sha(JSON.stringify([A.model, A.quality, A.size, STYLE, it.prompt]), 24);
    const file = path.join(cacheDir, `${key}.jpg`);
    const meta = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(file) && fs.existsSync(meta)) {
      log({ task: 'art', unit: it.key, model: A.model, cached: true });
      return { key: it.key, file, cost: 0 };
    }
    let note = '';
    let problems = '';
    for (let attempt = 1; attempt <= A.attempts; attempt++) {
      // Highlight asterisks (*term*) mean nothing to the image model.
      const prompt = `${it.prompt.replace(/\*/g, '')}. ${STYLE}${note ? ` Avoid: ${note}` : ''}`;
      let b64;
      try {
        const t0 = Date.now();
        const res = await api.images.generate({ model: A.model, prompt, size: A.size, quality: A.quality, n: 1 });
        b64 = res.data?.[0]?.b64_json;
        log({ task: 'art', unit: it.key, model: A.model, attempt, ms: Date.now() - t0, usage: { ...(res.usage || {}), cost_usd: imageCost(res.usage) } });
        if (!b64) throw new Error('no image in the response');
      } catch (e) {
        problems = `image model: ${e.message}`.slice(0, 200);
        log({ task: 'art', unit: it.key, model: A.model, attempt, error: problems });
        continue;
      }
      let verdict;
      try {
        const t0 = Date.now();
        const res = await api.responses.create({
          model: A.check_model,
          input: [{ role: 'user', content: [
            { type: 'input_text', text: checkPrompt({ prompt: it.prompt, points: it.points || [], subject, klass }) },
            { type: 'input_image', image_url: `data:image/png;base64,${b64}`, detail: 'high' },
          ] }],
          text: { format: { type: 'json_schema', name: 'art_check', schema: VERDICT, strict: true } },
        });
        verdict = JSON.parse(res.output_text);
        const price = cfg.llm?.prices?.[A.check_model];
        const u = res.usage;
        const cost = price && u ? Math.round((((u.input_tokens - (u.input_tokens_details?.cached_tokens || 0)) * price.input + (u.input_tokens_details?.cached_tokens || 0) * (price.cached_input ?? price.input) + u.output_tokens * price.output) / 1e6) * 1e6) / 1e6 : null;
        log({ task: 'art-check', unit: it.key, model: A.check_model, attempt, ms: Date.now() - t0, usage: { ...u, cost_usd: cost }, verdict });
      } catch (e) {
        problems = `vision check: ${e.message}`.slice(0, 200);
        log({ task: 'art-check', unit: it.key, model: A.check_model, attempt, error: problems });
        continue;
      }
      const ok = !verdict.has_text && verdict.matches_prompt && !verdict.misleading && verdict.suitable;
      if (!ok) {
        problems = [verdict.has_text && 'visible text', !verdict.matches_prompt && 'does not match the description',
          verdict.misleading && 'misleading or distorted', !verdict.suitable && 'unsuitable', verdict.problems].filter(Boolean).join('; ');
        note = `${verdict.problems || problems}; any text or lettering`;
        continue;
      }
      // Store as a JPEG (a 1536×1024 PNG is ~3 MB; the frame never needs lossless).
      const png = path.join(cacheDir, `${key}.png`);
      fs.writeFileSync(png, Buffer.from(b64, 'base64'));
      const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', png, '-q:v', '3', file], { encoding: 'utf8' });
      if (r.status === 0 && fs.existsSync(file)) fs.rmSync(png, { force: true });
      else fs.renameSync(png, file);   // a PNG under a .jpg name still decodes in the browser
      fs.writeFileSync(meta, JSON.stringify({ prompt: it.prompt, model: A.model, style: STYLE, verdict, at: new Date().toISOString() }, null, 2));
      return { key: it.key, file };
    }
    return { key: it.key, problems: problems || 'rejected' };
  };

  return limit(A.concurrency, items, one);
}
