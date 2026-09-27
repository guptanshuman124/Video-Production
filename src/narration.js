// Narration timing: where in an audio file is a given phrase spoken?
//
// The narration audio comes from Sarvam Bulbul TTS. Its `pace` parameter is a
// speed multiplier: 1.0 is normal, 0.9 is 10% slower. At pace 0.9 the Hinglish
// voice measures ~176 words/min including pauses (~197 while actually
// speaking), so pace 1.0 is ~196 wpm.
//
// Word -> time uses a words-per-minute model. Each word costs ~1 unit, scaled
// by its length (long words take longer to say); numbers cost per digit
// ("1838" is spoken as four words); a sentence end adds 2.5 units of pause and
// a comma 1.2. The whole script is then scaled onto the real audio length, so
// the effective WPM (which already includes pace) comes from the audio itself.
// With no audio yet, the nominal rate (BASE_WPM × pace) is used instead.
//
// Fitted against whisper word timestamps of the lecture narrations: median
// error 0.42s, 90th percentile 1.2s (plain words/min: 0.69s / 1.9s).

import { execFileSync } from 'node:child_process';
import { FFMPEG, FFPROBE } from './tools.js';

export const BASE_WPM = 196;                   // Bulbul v3 at pace 1.0 (measured)
const PAUSE = { sentence: 2.5, clause: 1.2 };
const LENGTH_WEIGHT = 0.65;                    // +65% per 5 chars over 5
const NUMBER_WORDS_PER_DIGIT = 0.75;

const wordUnits = (w) => {
  const digits = w.replace(/[^0-9]/g, '');
  if (digits.length >= 3) return NUMBER_WORDS_PER_DIGIT * digits.length;
  return Math.max(0.35, 1 + LENGTH_WEIGHT * (norm(w).length - 5) / 5);
};

const SENTENCE_END = /[.?!।॥]["'”’)]*$/;
const CLAUSE_END = /[,;:—–]["'”’)]*$/;

export function audioDuration(file) {
  return Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file]).toString().trim());
}

// Leading / trailing silence, so the model maps words onto actual speech.
export function speechBounds(file) {
  const out = (() => {
    try {
      return execFileSync(FFMPEG, ['-i', file, '-af', 'silencedetect=n=-40dB:d=0.2', '-f', 'null', '-'],
        { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch (e) { return String(e.stderr || ''); }
  })();
  const log = out || '';
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const dur = audioDuration(file);
  const lead = starts.length && starts[0] < 0.05 ? ends[0] : 0;
  const lastStart = starts[starts.length - 1];
  const trail = lastStart != null && (ends.length < starts.length || ends[ends.length - 1] >= dur - 0.05)
    ? dur - lastStart : 0;
  return { duration: dur, speechStart: lead, speechEnd: dur - trail };
}

// A timed script: word list + a function word index -> seconds.
export function timeline(text, { duration = null, speechStart = 0, speechEnd = null, pace = 0.9 } = {}) {
  const words = text.trim().split(/\s+/);
  // cumulative units *before* each word
  const units = [];
  let u = 0;
  for (const w of words) {
    units.push(u);
    u += wordUnits(w);
    if (SENTENCE_END.test(w)) u += PAUSE.sentence;
    else if (CLAUSE_END.test(w)) u += PAUSE.clause;
  }
  const total = u;
  const wpm = BASE_WPM * pace;
  let secPerUnit, offset;
  if (duration != null) {
    const end = speechEnd ?? duration;
    offset = speechStart;
    secPerUnit = (end - speechStart) / total;
  } else {
    offset = 0;
    secPerUnit = 60 / wpm;
  }
  return {
    words,
    wpmNominal: wpm,
    wpmEffective: (words.length / ((duration ?? total * secPerUnit) / 60)),
    duration: duration ?? total * secPerUnit,
    at: (i) => offset + units[Math.max(0, Math.min(i, units.length - 1))] * secPerUnit,
  };
}

// ---- fuzzy phrase location ---------------------------------------------------

// Hindi and English function words carry no locating signal.
const STOP = new Set(`a an the of to in on at by for from with and or but is are was were be been this that these
those it its as into than then so if not no do does did can could will would should may might also just very
we you they he she i me my our your their his her them us let lets now here there what which who whom whose how why
है हैं था थे थी हो होता होती होते के की का को में से और ने कि यह वह ये वे एक भी तो ही पर लिए इस उस इन उन
जो जब तक या नहीं कर करते करता करती किया गया गई अब यहाँ वहाँ कुछ सब बहुत`.split(/\s+/));

export const norm = (w) => w.toLowerCase()
  .replace(/[“”"'‘’`.,;:!?()[\]{}।॥—–-]/g, '')
  .replace(/(?<=[a-z]{3})(es|s)$/, '');       // cells -> cell, tissues -> tissue

const content = (text) => text.split(/\s+/).map(norm).filter((w) => w && !STOP.has(w));

// Best-matching position of `phrase` in `words` at or after `from`.
// Returns { index, score } — index of the first matched word in the best
// window, score = weighted fraction of the phrase's content words found.
export function locate(words, phrase, { from = 0 } = {}) {
  const q = [...new Set(content(phrase))];
  if (!q.length) return { index: from, score: 0 };
  const weight = (w) => Math.min(3, 0.5 + w.length / 4);   // long words locate better
  const qWeight = q.reduce((a, w) => a + weight(w), 0);
  const normed = words.map(norm);
  const win = Math.max(6, Math.round(content(phrase).length * 2.2));
  let best = { index: from, score: 0 };
  for (let s = from; s < normed.length; s++) {
    const seen = new Set();
    let first = -1;
    for (let k = s; k < Math.min(normed.length, s + win); k++) {
      if (q.includes(normed[k]) && !seen.has(normed[k])) {
        seen.add(normed[k]);
        if (first < 0) first = k;
      }
    }
    const score = [...seen].reduce((a, w) => a + weight(w), 0) / qWeight;
    if (score > best.score + 1e-9) best = { index: first < 0 ? s : first, score };
  }
  return best;
}

// Index of a word matching `re` at or after `from` (e.g. /^option$/ then a letter).
export function findSequence(words, pattern, from = 0) {
  const n = pattern.length;
  for (let i = from; i <= words.length - n; i++) {
    if (pattern.every((re, k) => re.test(norm(words[i + k])))) return i;
  }
  return -1;
}
