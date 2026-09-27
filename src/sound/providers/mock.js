// Mock TTS: a quiet tone whose length follows the word count at a Hinglish
// speaking pace. Lets the voice, build, sync and render stages run with no
// API key. Set tts.mock.marks: true to exercise the mark strategy instead.

import { makeWav, RATE } from '../wav.js';

export function mockProvider(cfg) {
  const c = cfg.tts.mock || {};
  const wpm = c.wpm || 165;
  const tone = (seconds) => {
    const n = Math.max(1, Math.round(seconds * RATE));
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 2000), i * 2);
    return makeWav(pcm);
  };
  const secondsFor = (text) => Math.max(0.3, (text.split(/\s+/).filter(Boolean).length / wpm) * 60);

  return {
    name: 'mock',
    caps: { marks: !!c.marks, maxChars: 100000 },
    voiceKey: JSON.stringify(['mock', wpm]),
    async synthesize(text) { return { audio: tone(secondsFor(text)) }; },
    async synthesizeMarked(text) {
      const marks = {};
      let t = 0;
      for (const part of text.split(/(\{\{b\d+(?:\.\d+){0,2}\}\})/)) {
        const m = part.match(/^\{\{(.+)\}\}$/);
        if (m) marks[m[1]] = t;
        else if (part.trim()) t += secondsFor(part);
      }
      return { audio: tone(Math.max(t, 0.3)), marks };
    },
  };
}
