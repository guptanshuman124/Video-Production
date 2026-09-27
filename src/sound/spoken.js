// Spoken-form normalisation applied to narration right before TTS, so no
// engine is handed symbols it would skip or mispronounce. Provider-specific
// escaping (e.g. XML for Google SSML) happens in the provider.

const SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SYMBOLS = [
  [/°\s?C\b/g, ' degree Celsius'], [/°\s?F\b/g, ' degree Fahrenheit'], [/°/g, ' degree'],
  [/%/g, ' percent'], [/→|⟶|->/g, ' to '], [/⇌|<=>/g, ' equilibrium '], [/×/g, ' into '], [/÷/g, ' divided by '],
  [/≈/g, ' approximately '], [/±/g, ' plus minus '], [/≤/g, ' less than or equal to '], [/≥/g, ' greater than or equal to '],
  [/</g, ' less than '], [/>/g, ' greater than '], [/=/g, ' equals '], [/\+/g, ' plus '], [/&/g, ' and '],
  [/²/g, ' square'], [/³/g, ' cube'], [/µ|μ/g, 'micro'],
];

export function speakable(text) {
  let t = String(text);
  t = t.replace(/[₀-₉]/g, (d) => ` ${SUB[d]} `);
  for (const [re, to] of SYMBOLS) t = t.replace(re, to);
  // Long numbers get thousands separators (the engines read "10,000" right).
  t = t.replace(/\b\d{5,}\b/g, (n) => Number(n).toLocaleString('en-US'));
  t = t.replace(/[*_#`~^|\\[\]{}$]/g, ' ');
  return t.replace(/\s+([,.!?।])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// Split text into pieces of at most `max` characters at sentence ends (then
// commas, then spaces) for engines with a per-request limit.
export function splitForEngine(text, max) {
  if (!max || text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('। '), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (cut < max * 0.4) cut = window.lastIndexOf(', ');
    if (cut < max * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}
