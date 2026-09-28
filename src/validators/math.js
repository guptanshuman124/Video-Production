// Maths written outside $…$ in on-screen text ("\omega – angular speed (rad s^{-1})")
// renders as raw LaTeX. wrapBareMath() puts such tokens inside $…$ when KaTeX
// can render them; mathOutside() reports what is still bare (a G3 error).
//
// Formula fields (`formula`, `symbol`) hold bare LaTeX by design and are not
// passed here.

import katex from 'katex';
import 'katex/contrib/mhchem';

// A token that is clearly LaTeX: a command (\omega, \frac, \ce), a braced
// super/subscript (s^{-1}, v_{0}), or a short one (a_c, x^2, 10^3 — 1–3
// characters each side, so words like "case_study" are left alone).
const STRONG = /\\[A-Za-z]+|[\^_]\{/;
const SHORT = /^[(\[]?[A-Za-z0-9]{1,3}[\^_][A-Za-z0-9+\-]{1,3}[)\],.;:!?]*$/;
const isMath = (tok) => STRONG.test(tok) || SHORT.test(tok);
const MATHY = { test: (s) => /\\[A-Za-z]|[\^_]/.test(s) && s.split(/\s+/).some(isMath) };
const renders = (tex) => { try { katex.renderToString(tex, { throwOnError: true }); return true; } catch { return false; } };
const count = (s, ch) => s.split(ch).length - 1;

// Splits text into $…$ spans (kept) and plain runs.
function segments(s) {
  const out = [];
  const re = /\$[^$]+\$/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ math: false, text: s.slice(last, m.index) });
    out.push({ math: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ math: false, text: s.slice(last) });
  return out;
}

function wrapRun(text) {
  const parts = text.split(/(\s+)/);          // words and the whitespace between them
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let tok = parts[i];
    if (!tok || /^\s+$/.test(tok) || !isMath(tok)) { out.push(tok); continue; }
    // A brace group may run across spaces ("\frac{a}{b c}"): join until balanced.
    while (count(tok, '{') > count(tok, '}') && i + 2 < parts.length) { tok += parts[i + 1] + parts[i + 2]; i += 2; }
    // Brackets / punctuation around the maths stay outside it: "(rad s^{-1})," → "(rad $s^{-1}$),"
    let lead = '', trail = '';
    while (/^[(\[]/.test(tok) && count(tok, tok[0]) > count(tok, tok[0] === '(' ? ')' : ']')) { lead += tok[0]; tok = tok.slice(1); }
    for (;;) {
      const ch = tok.at(-1);
      if (/[,.;:!?]/.test(ch) || (ch === ')' && count(tok, ')') > count(tok, '(')) || (ch === ']' && count(tok, ']') > count(tok, '['))) { trail = ch + trail; tok = tok.slice(0, -1); } else break;
    }
    // Neighbouring maths tokens join one span: "\Delta \theta" → "$\Delta \theta$".
    const prev = out.length >= 2 && /^\s+$/.test(out.at(-1)) && out.at(-2).endsWith('$') && !lead ? out.length - 2 : -1;
    if (prev >= 0 && renders(`${out[prev].slice(1, -1)} ${tok}`)) {
      const ws = out.pop();
      out[out.length - 1] = `$${out.at(-1).slice(1, -1)}${ws}${tok}$`;
      if (trail) out.push(trail);
      continue;
    }
    out.push(renders(tok) ? `${lead}$${tok}$${trail}` : `${lead}${tok}${trail}`);
  }
  return out.join('');
}

// → { text, changed }
export function wrapBareMath(s) {
  if (typeof s !== 'string' || !MATHY.test(s)) return { text: s, changed: false };
  const text = segments(s).map((seg) => (seg.math ? seg.text : wrapRun(seg.text))).join('');
  return { text, changed: text !== s };
}

// The LaTeX-looking pieces still outside $…$ (empty when the text is clean).
export function mathOutside(s) {
  if (typeof s !== 'string') return [];
  return segments(s).filter((seg) => !seg.math).flatMap((seg) => seg.text.split(/\s+/).filter(isMath));
}
