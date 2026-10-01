// Google Cloud Text-to-Speech.
//
// Voices: any Cloud TTS voice; the product default is Chirp 3 HD
// ("hi-IN-Chirp3-HD-<name>"), Google's generative voices, which read mixed
// Devanagari + Latin Hinglish naturally. Chirp 3 HD takes plain text (no
// SSML <mark> timepoints), so the sound module voices each slide piece by
// piece between its markers ("segments"), the same as Sarvam. Older voice
// families (Neural2, WaveNet, Standard) keep the SSML mark strategy.
//
// Auth, first found wins:
//   GOOGLE_TTS_CREDENTIALS_B64       base64 of a service-account JSON key (the factory's secret)
//   GOOGLE_APPLICATION_CREDENTIALS   path to a service-account JSON key
//   GOOGLE_TTS_API_KEY               API key
//   GOOGLE_ACCESS_TOKEN              OAuth bearer token
// A service account is exchanged for an access token (JWT bearer grant,
// cloud-platform scope), cached and renewed a few minutes before it expires.
//
// Config: tts.google { voice, language, speaking_rate, sample_rate, max_bytes, pauses, gap_ms }.
//
// Pauses: Chirp 3 HD barely pauses at commas (~0.07 s, where Sarvam left
// ~0.35 s), so a lecture sounds like one long run. With `pauses` set, the text
// is sent as Chirp "markup" with [pause short|pause|pause long] tags after
// commas, dashes and sentence ends ("short" measures ~0.3 s, "medium" ~1.2 s).

import fs from 'node:fs';
import crypto from 'node:crypto';

const ENDPOINT = (beta) => `https://texttospeech.googleapis.com/${beta ? 'v1beta1' : 'v1'}/text:synthesize`;
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function serviceAccount() {
  if (process.env.GOOGLE_TTS_CREDENTIALS_B64) return JSON.parse(Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_B64, 'base64').toString('utf8'));
  const f = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  return null;
}

// One cached token per process for the service account.
let cached = null;
async function accessToken(sa) {
  if (cached && cached.exp - Date.now() > 5 * 60 * 1000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), sa.private_key));
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }),
  });
  if (!res.ok) {
    const err = new Error(`Google auth ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.retryable = res.status >= 500;
    throw err;
  }
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

// Pause tags: Chirp 3 HD markup, and the Gemini-TTS inline tags.
const TAGS = {
  chirp: { short: '[pause short]', medium: '[pause]', long: '[pause long]' },
  gemini: { short: '[short pause]', medium: '[medium pause]', long: '[long pause]' },
};
const TAG = TAGS.chirp;

// Plain (speakable) text -> text with pause tags. The text has no brackets
// left (speakable() strips them), so the tags cannot collide.
export function withPauses(text, pauses = {}, family = 'chirp') {
  let t = String(text);
  const tag = (k) => TAGS[family][pauses[k]];
  if (tag('comma')) t = t.replace(/,\s+/g, `, ${tag('comma')} `);
  if (tag('dash')) t = t.replace(/\s+[—–]\s+/g, ` — ${tag('dash')} `);
  // Sentence ends: danda, ?, ! and a full stop that is not a decimal point.
  if (tag('sentence')) t = t.replace(/([।?!]|\.(?!\d))\s+(?=\S)/g, `$1 ${tag('sentence')} `);
  return t;
}

export function googleProvider(cfg) {
  const c = cfg.tts.google || {};
  const language = c.language || 'hi-IN';
  // Gemini-TTS (tts.google.model, e.g. gemini-2.5-pro-tts): a generative voice
  // steered by a natural-language style prompt (tts.google.prompt), with the
  // same voice names (Aoede, Kore …). Plain text with inline pause tags.
  const gemini = /^gemini/i.test(c.model || '');
  // Chirp 3 HD (and Chirp HD) voices: plain text only, no mark timepoints.
  const chirp = !gemini && /chirp/i.test(c.voice || '');
  const pausing = !!(c.pauses && Object.values(c.pauses).some((v) => TAG[v]));
  const markup = chirp && pausing;

  async function call(input, marks) {
    const sa = serviceAccount();
    const key = process.env.GOOGLE_TTS_API_KEY;
    const token = sa ? await accessToken(sa) : process.env.GOOGLE_ACCESS_TOKEN;
    if (!sa && !key && !token) throw new Error('no Google credentials: set GOOGLE_TTS_CREDENTIALS_B64, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_TTS_API_KEY or GOOGLE_ACCESS_TOKEN');
    const useKey = !sa && key;
    const res = await fetch(useKey ? `${ENDPOINT(marks)}?key=${encodeURIComponent(key)}` : ENDPOINT(marks), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(useKey ? {} : { Authorization: `Bearer ${token}` }),
        ...(sa?.project_id ? { 'x-goog-user-project': sa.project_id } : {}),
      },
      body: JSON.stringify({
        input,
        voice: { languageCode: language, ...(c.voice ? { name: c.voice } : {}), ...(gemini ? { model_name: c.model } : {}) },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: c.sample_rate || 24000, speakingRate: c.speaking_rate || 1.0 },
        ...(marks ? { enableTimePointing: ['SSML_MARK'] } : {}),
      }),
    });
    if (!res.ok) {
      if (res.status === 401) cached = null;   // a revoked / expired token: fetch a fresh one on retry
      const err = new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      err.retryable = res.status === 429 || res.status >= 500 || res.status === 401;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return res.json();
  }

  return {
    name: 'google',
    // Requests are limited to 5,000 bytes; Devanagari is 3 bytes a character in UTF-8.
    // Pause tags add ~16 ASCII bytes each, so markup requests carry less text.
    // Gemini-TTS takes at most 4,000 bytes of text (and 4,000 of prompt).
    caps: { marks: !chirp && !gemini, maxChars: c.max_bytes ? Math.floor(c.max_bytes / 3) : gemini ? 1050 : markup ? 1250 : 1500 },
    voiceKey: JSON.stringify(['google', c.model || null, c.voice, language, c.speaking_rate, c.sample_rate, pausing ? c.pauses : null, gemini ? c.prompt : null]),
    async synthesize(text) {
      const input = gemini ? { ...(c.prompt ? { prompt: c.prompt } : {}), text: pausing ? withPauses(text, c.pauses, 'gemini') : text }
        : markup ? { markup: withPauses(text, c.pauses) } : { text };
      const j = await call(input, false);
      return { audio: Buffer.from(j.audioContent, 'base64') };
    },
    // `text` carries {{id}} markers; they become <mark name="id"/> (non-Chirp voices only).
    async synthesizeMarked(text) {
      const ssml = `<speak>${xml(text).replace(/\{\{(b\d+(?:\.\d+){0,2})\}\}/g, '<mark name="$1"/>')}</speak>`;
      const j = await call({ ssml }, true);
      const marks = Object.fromEntries((j.timepoints || []).map((t) => [t.markName, Number(t.timeSeconds)]));
      return { audio: Buffer.from(j.audioContent, 'base64'), marks };
    },
  };
}
