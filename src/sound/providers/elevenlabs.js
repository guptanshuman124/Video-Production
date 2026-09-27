// ElevenLabs text-to-speech with character timestamps. Markers are removed
// from the text, their character offsets remembered, and each marker's time
// is the start time of the first character spoken after it.
//
// Env: ELEVENLABS_API_KEY. Config: tts.elevenlabs { voice_id, model, max_chars }.

const PCM_RATE = 24000;

export function elevenlabsProvider(cfg) {
  const c = cfg.tts.elevenlabs || {};

  async function call(text) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
    if (!c.voice_id) throw new Error('config tts.elevenlabs.voice_id is not set');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.voice_id)}/with-timestamps?output_format=pcm_${PCM_RATE}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(c.model ? { model_id: c.model } : {}) }),
    });
    if (!res.ok) {
      const err = new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
      err.retryable = res.status === 429 || res.status >= 500;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return res.json();
  }

  return {
    name: 'elevenlabs',
    caps: { marks: true, maxChars: c.max_chars || 4500 },
    voiceKey: JSON.stringify(['elevenlabs', c.voice_id, c.model]),
    async synthesize(text) {
      const j = await call(text);
      return { audio: Buffer.from(j.audio_base64, 'base64'), raw: { rate: PCM_RATE, channels: 1 } };
    },
    async synthesizeMarked(text) {
      const offsets = {};
      let plain = '';
      for (const part of text.split(/(\{\{b\d+(?:\.\d+){0,2}\}\})/)) {
        const m = part.match(/^\{\{(.+)\}\}$/);
        if (m) offsets[m[1]] = plain.length;
        else plain += part;
      }
      const j = await call(plain);
      const starts = j.alignment?.character_start_times_seconds || [];
      const chars = j.alignment?.characters || [];
      const marks = {};
      for (const [id, off] of Object.entries(offsets)) {
        let i = off;
        while (i < chars.length && /\s/.test(chars[i])) i++;
        marks[id] = starts[Math.min(i, starts.length - 1)] ?? 0;
      }
      return { audio: Buffer.from(j.audio_base64, 'base64'), raw: { rate: PCM_RATE, channels: 1 }, marks };
    },
  };
}
