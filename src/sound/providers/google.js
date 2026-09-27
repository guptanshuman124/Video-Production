// Google Cloud Text-to-Speech. Supports SSML <mark> timepoints, so the sound
// module can use the mark strategy: one request per slide, marker times read
// straight from the response.
//
// Env: GOOGLE_TTS_API_KEY (API key) or GOOGLE_ACCESS_TOKEN (OAuth bearer).
// Config: tts.google { voice, language, speaking_rate, sample_rate, max_bytes }.

const ENDPOINT = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function googleProvider(cfg) {
  const c = cfg.tts.google || {};
  const language = c.language || 'hi-IN';

  async function call(input, marks) {
    const key = process.env.GOOGLE_TTS_API_KEY;
    const token = process.env.GOOGLE_ACCESS_TOKEN;
    if (!key && !token) throw new Error('GOOGLE_TTS_API_KEY or GOOGLE_ACCESS_TOKEN is not set');
    const res = await fetch(key ? `${ENDPOINT}?key=${encodeURIComponent(key)}` : ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && !key ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        input,
        voice: { languageCode: language, ...(c.voice ? { name: c.voice } : {}) },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: c.sample_rate || 24000, speakingRate: c.speaking_rate || 1.0 },
        ...(marks ? { enableTimePointing: ['SSML_MARK'] } : {}),
      }),
    });
    if (!res.ok) {
      const err = new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      err.retryable = res.status === 429 || res.status >= 500;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return res.json();
  }

  return {
    name: 'google',
    caps: { marks: true, maxChars: c.max_bytes ? Math.floor(c.max_bytes / 3) : 1600 },
    voiceKey: JSON.stringify(['google', c.voice, language, c.speaking_rate, c.sample_rate]),
    async synthesize(text) {
      const j = await call({ text }, false);
      return { audio: Buffer.from(j.audioContent, 'base64') };
    },
    // `text` carries {{id}} markers; they become <mark name="id"/>.
    async synthesizeMarked(text) {
      const ssml = `<speak>${xml(text).replace(/\{\{(b\d+(?:\.\d+){0,2})\}\}/g, '<mark name="$1"/>')}</speak>`;
      const j = await call({ ssml }, true);
      const marks = Object.fromEntries((j.timepoints || []).map((t) => [t.markName, Number(t.timeSeconds)]));
      return { audio: Buffer.from(j.audioContent, 'base64'), marks };
    },
  };
}
