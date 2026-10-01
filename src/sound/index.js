// Sound module: Hinglish narration (with {{markers}}) -> one WAV per slide
// plus the exact time of every marker inside it. The provider is chosen in
// config (tts.provider); the strategy follows its capabilities:
//
//   segments — split the narration at its markers, synthesize each piece,
//              join them with tts.gap_ms of silence. A marker's time is the
//              sample offset where its piece starts. (Sarvam)
//   marks    — one request per slide; the provider returns each marker's
//              time (Google SSML <mark>, ElevenLabs character alignment).
//
//   const voice = await synthesizeLecture(content, cfg, { dir, cacheDir });
//   voice.slides[i] = { slide_number, clip, duration, markers: { b1: 3.42, … },
//                       words, segments: [{ marker, text, duration }], silences }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sarvamProvider } from './providers/sarvam.js';
import { googleProvider } from './providers/google.js';
import { elevenlabsProvider } from './providers/elevenlabs.js';
import { mockProvider } from './providers/mock.js';
import { toStandard, join, duration as wavDuration, silences } from './wav.js';
import { speakable, splitForEngine } from './spoken.js';
import { wordCount } from '../validators/text.js';

export const TTS_PROVIDERS = { sarvam: sarvamProvider, google: googleProvider, elevenlabs: elevenlabsProvider, mock: mockProvider };

export function createTTS(cfg, name = cfg.tts.provider) {
  const make = TTS_PROVIDERS[name];
  if (!make) throw new Error(`unknown tts.provider "${name}" (known: ${Object.keys(TTS_PROVIDERS).join(', ')})`);
  return make(cfg);
}

const MARK = /(\{\{b\d+(?:\.\d+){0,2}\}\})/;

// "intro {{b1}} one {{b2}} two" -> [{ marker: null, text: 'intro' }, { marker: 'b1', text: 'one' }, …]
export function splitSegments(text) {
  const out = [{ marker: null, text: '' }];
  for (const part of String(text).split(MARK)) {
    const m = part.match(/^\{\{(.+)\}\}$/);
    if (m) out.push({ marker: m[1], text: '' });
    else out.at(-1).text += part;
  }
  return out.map((s) => ({ ...s, text: s.text.trim() })).filter((s, i) => i > 0 || s.text);
}

// Speakable text with markers preserved (markers are never normalised).
const speakableMarked = (text) => String(text).split(MARK).map((p) => (MARK.test(p) ? ` ${p} ` : speakable(p))).join('').replace(/\s{2,}/g, ' ').trim();

// Transient failures (rate limits, 5xx, network) are retried with
// exponential backoff + jitter, honouring the provider's Retry-After.
async function retry(fn, tries) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const transient = e.retryable || /ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(e.message);
      if (!transient || i >= tries) throw e;
      const wait = e.retryAfter > 0 ? e.retryAfter * 1000 : Math.min(30000, 1500 * 2 ** i);
      await new Promise((r) => setTimeout(r, wait + Math.random() * 500));
    }
  }
}

function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

// usage (optional): { requests, chars } — counts what the engine is actually
// asked to speak (cache hits are free), for the per-video cost breakdown.
export function createVoice(cfg, { cacheDir = null, provider = null, usage = null } = {}) {
  const tts = provider || createTTS(cfg);
  const limit = limiter(cfg.tts.concurrency || 8);
  const useCache = cfg.tts.cache && cacheDir;
  if (useCache) fs.mkdirSync(cacheDir, { recursive: true });
  const cached = (kind, text, make) => {
    const key = crypto.createHash('sha256').update(JSON.stringify([tts.voiceKey, kind, text])).digest('hex').slice(0, 32);
    const f = useCache && path.join(cacheDir, `${key}.${kind === 'marked' ? 'json' : 'wav'}`);
    if (f && fs.existsSync(f)) {
      return kind === 'marked'
        ? (({ wav, marks }) => ({ wav: Buffer.from(wav, 'base64'), marks }))(JSON.parse(fs.readFileSync(f, 'utf8')))
        : fs.readFileSync(f);
    }
    return limit(() => retry(make, cfg.tts.retries ?? 3)).then((out) => {
      if (f) fs.writeFileSync(f, kind === 'marked' ? JSON.stringify({ wav: out.wav.toString('base64'), marks: out.marks }) : out);
      if (usage) { usage.requests++; usage.chars += text.length; }
      return out;
    });
  };

  // One plain piece of text -> canonical WAV (split further if the engine limits length).
  const plain = async (text) => {
    const pieces = splitForEngine(text, tts.caps.maxChars);
    const wavs = await Promise.all(pieces.map((p) => cached('plain', p, async () => {
      const r = await tts.synthesize(p);
      return toStandard(r.audio, { raw: r.raw });
    })));
    return wavs.length === 1 ? wavs[0] : join(wavs, 0).wav;
  };

  async function viaSegments(text) {
    const segs = splitSegments(text);
    const spoken = segs.map((s) => ({ ...s, spoken: speakable(s.text) }));
    const audio = await Promise.all(spoken.map((s) => (s.spoken ? plain(s.spoken) : null)));
    const present = spoken.map((s, i) => ({ s, wav: audio[i] })).filter((x) => x.wav);
    const joined = join(present.map((x) => x.wav), cfg.tts.gap_ms ?? 200);
    const markers = {};
    let k = 0;
    spoken.forEach((s, i) => {
      // A marker with no text of its own takes the start of the next piece.
      const at = audio[i] ? joined.starts[k] : (joined.starts[k] ?? joined.duration);
      if (s.marker) markers[s.marker] = Math.round(at * 1000) / 1000;
      if (audio[i]) k++;
    });
    return {
      wav: joined.wav, duration: joined.duration, markers,
      segments: spoken.map((s, i) => ({ marker: s.marker, text: s.spoken, duration: audio[i] ? wavDuration(audio[i]) : 0 })),
    };
  }

  async function viaMarks(text) {
    const spoken = speakableMarked(text);
    const out = await cached('marked', spoken, async () => {
      const r = await tts.synthesizeMarked(spoken);
      return { wav: toStandard(r.audio, { raw: r.raw }), marks: r.marks };
    });
    const markers = Object.fromEntries(Object.entries(out.marks).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
    return { wav: out.wav, duration: wavDuration(out.wav), markers, segments: [{ marker: null, text: spoken, duration: wavDuration(out.wav) }] };
  }

  const strategyFor = (text) => {
    const want = cfg.tts.strategy === 'auto' ? (tts.caps.marks ? 'marks' : 'segments') : cfg.tts.strategy;
    if (want === 'marks' && !tts.caps.marks) throw new Error(`tts.strategy "marks" needs a provider with mark timestamps; ${tts.name} has none`);
    return want === 'marks' && text.length > tts.caps.maxChars ? 'segments' : want;
  };

  return {
    provider: tts.name,
    // One slide: narration text with markers -> { wav, duration, markers, segments, strategy }.
    async slide(text) {
      const strategy = strategyFor(text);
      const r = strategy === 'marks' ? await viaMarks(text) : await viaSegments(text);
      return { ...r, strategy };
    },
  };
}

// Voice a whole lecture into <dir>/voice/sNN.wav.
// logFile: the lecture's call log (llm.jsonl) — one 'tts' row with the
// characters actually sent, so the per-video cost can price the voice.
export async function synthesizeLecture(content, cfg, { dir, cacheDir = null, provider = null, onSlide, logFile = null } = {}) {
  const usage = { requests: 0, chars: 0 };
  const voice = createVoice(cfg, { cacheDir, provider, usage });
  const outDir = path.join(dir, 'voice');
  fs.mkdirSync(outDir, { recursive: true });
  const slides = await Promise.all(content.slides.map(async (s) => {
    const r = await voice.slide(s.narration.hinglish);
    const clip = `voice/s${String(s.slide_number).padStart(2, '0')}.wav`;
    fs.writeFileSync(path.join(dir, clip), r.wav);
    onSlide?.(s.slide_number);
    return {
      slide_number: s.slide_number, clip, duration: Math.round(r.duration * 1000) / 1000,
      markers: r.markers, words: wordCount(s.narration.hinglish), strategy: r.strategy,
      segments: r.segments, silences: silences(path.join(dir, clip), { min: 2.5 }),
    };
  }));
  if (logFile) {
    const model = cfg.tts[voice.provider]?.model || null;
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), provider: voice.provider, task: 'tts', model, requests: usage.requests, chars: usage.chars })}
`);
  }
  return { provider: voice.provider, slides, usage };
}
