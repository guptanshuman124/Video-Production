// Sarvam (Bulbul) text-to-speech. No word or mark timestamps, so the sound
// module uses the segment strategy: one request per marker segment.
//
// Env: SARVAM_API_KEY. Config: tts.sarvam { model, speaker, pace, sample_rate,
// language, max_chars, endpoint }.
// Request/response shape follows Sarvam's REST API (POST /text-to-speech,
// `api-subscription-key` header, base64 WAV in `audios[0]`); verify field
// names against the current API docs when the key is connected.

export function sarvamProvider(cfg) {
  const c = cfg.tts.sarvam || {};
  const endpoint = c.endpoint || 'https://api.sarvam.ai/text-to-speech';
  return {
    name: 'sarvam',
    caps: { marks: false, maxChars: c.max_chars || 1500 },
    voiceKey: JSON.stringify(['sarvam', c.model, c.speaker, c.pace, c.sample_rate, c.language]),
    async synthesize(text) {
      const key = process.env.SARVAM_API_KEY;
      if (!key) throw new Error('SARVAM_API_KEY is not set');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          target_language_code: c.language || 'hi-IN',
          ...(c.speaker ? { speaker: c.speaker } : {}),
          ...(c.pace ? { pace: c.pace } : {}),
          ...(c.sample_rate ? { speech_sample_rate: c.sample_rate } : {}),
          ...(c.model ? { model: c.model } : {}),
        }),
      });
      if (!res.ok) {
        const err = new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 300)}`);
        err.retryable = res.status === 429 || res.status >= 500;
        err.retryAfter = Number(res.headers.get('retry-after')) || 0;
        throw err;
      }
      const j = await res.json();
      const b64 = j.audios?.[0] ?? j.audio;
      if (!b64) throw new Error('Sarvam response had no audio');
      return { audio: Buffer.from(b64, 'base64') };
    },
  };
}
