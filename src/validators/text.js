// Text measures shared by the narration and Hinglish gates.

import { stripMarkers } from '../slides.js';

export const wordsOf = (s) => stripMarkers(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
export const wordCount = (s) => wordsOf(s).length;

// Sentences end at . ! ? or the danda ।, followed by space/end.
export const sentences = (s) => stripMarkers(s).split(/(?<=[.!?।])\s+/).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));

const DEV = /\p{Script=Devanagari}/u;
const LAT = /[A-Za-z]/;
export function scriptShare(s) {
  let dev = 0, lat = 0;
  for (const ch of stripMarkers(s)) { if (DEV.test(ch)) dev++; else if (LAT.test(ch)) lat++; }
  return dev + lat ? dev / (dev + lat) : 0;
}

// Hindi function words written in Latin letters: the romanized Hinglish that
// degrades Bulbul's audio. Only unambiguous ones (no English homographs).
export const ROMAN_HINDI = new Set([
  'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'mein', 'toh', 'aur', 'nahi', 'nahin', 'kya', 'yeh', 'woh', 'kaise',
  'kyun', 'kyunki', 'hota', 'hoti', 'hote', 'karta', 'karti', 'karte', 'chaliye', 'dekho', 'dekhiye', 'isliye',
  'lekin', 'bhi', 'kuch', 'matlab', 'yaani', 'jaise', 'wala', 'wali', 'wale', 'hum', 'aap', 'tum', 'iska',
  'uska', 'inka', 'unka', 'jab', 'tab', 'agar', 'sabse', 'bahut', 'thoda', 'samjho', 'samjhiye', 'raha', 'rahi', 'rahe',
]);

// Common English words spelt in Devanagari — English that should have stayed
// in Latin script in the Hinglish entry.
export const DEVANAGARI_ENGLISH = [
  'सेल', 'ब्लड', 'फ़िल्टर', 'फिल्टर', 'प्रोसेस', 'कॉन्सेप्ट', 'कांसेप्ट', 'इम्पॉर्टेंट', 'इंपॉर्टेंट', 'एग्ज़ाम्पल', 'एग्जांपल',
  'क्वेश्चन', 'आंसर', 'टॉपिक', 'फंक्शन', 'सिस्टम', 'एनर्जी', 'स्ट्रक्चर', 'मेम्ब्रेन', 'न्यूक्लियस', 'ऑर्गन', 'टिश्यू',
  'रिएक्शन', 'फॉर्मूला', 'डायग्राम', 'पॉइंट', 'एक्चुअली', 'बेसिकली', 'डेफिनेशन', 'डेफिनिशन', 'प्रॉपर्टी', 'टाइप',
  'फोर्स', 'वेलोसिटी', 'करंट', 'वोल्टेज', 'मॉलिक्यूल', 'एटम', 'इलेक्ट्रॉन', 'कंपाउंड', 'सॉल्यूशन', 'इक्वेशन',
];

// Bookish Hindi a teacher would say in English in Hinglish ("important",
// "attract", "process"…) — over-translation.
export const FORMAL_HINDI = [
  'महत्वपूर्ण', 'आकर्षित', 'पदार्थ', 'प्रभाव', 'संबंध', 'वास्तव', 'उदाहरण', 'प्रक्रिया', 'सिद्धांत', 'अवधारणा',
  'विशेषता', 'उपयोग', 'परिणाम', 'तापमान', 'ऊर्जा', 'गुणधर्म', 'अभिक्रिया', 'विलयन', 'सूत्र', 'समीकरण',
];
export const formalHindiHits = (s) => FORMAL_HINDI.filter((w) => stripMarkers(s).includes(w));

export const romanHindiHits = (s) => wordsOf(s).map((w) => w.toLowerCase().replace(/[^a-z]/g, '')).filter((w) => ROMAN_HINDI.has(w));
export const devEnglishHits = (s) => DEVANAGARI_ENGLISH.filter((w) => new RegExp(`(^|[\\s,.!?।])${w}(?=$|[\\s,.!?।]|ों|ें|्स)`, 'u').test(stripMarkers(s)));

// Longest run of consecutive words shared by two texts (case-insensitive).
export function longestSharedRun(a, b) {
  const A = wordsOf(a).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  const B = wordsOf(b).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  let best = 0;
  const prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    let diag = 0;
    for (let j = 1; j <= B.length; j++) {
      const tmp = prev[j];
      prev[j] = A[i - 1] && A[i - 1] === B[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

// Every string inside a slide's data, flattened.
export function slideStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => slideStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => slideStrings(x, out));
  return out;
}

export const issue = (code, severity, path, message) => ({ code, severity, path, message });
