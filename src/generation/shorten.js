// Targeted fix for the most common slide-content failure: a string a few
// words over its limit. Rewriting the whole slide tends to produce new long
// strings, so instead only the offending strings go to the model with a hard
// word budget each, and code patches them back in.

import { words } from '../slides.js';

// The $…$ formulas of a string, in order (escaped \$ is a literal dollar).
const formulas = (s) => [...String(s).matchAll(/(?<!\\)\$[^$]+\$/g)].map((m) => m[0]);
const sameMaths = (a, b) => JSON.stringify(formulas(a)) === JSON.stringify(formulas(b)) && !/(?<!\\)\$/.test(String(b).replace(/(?<!\\)\$[^$]+\$/g, ''));

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'text'],
    properties: { id: { type: 'integer' }, text: { type: 'string' } },
  } } },
};

// "s03.points[0]" -> ['points', 0]; "s02.items[1].text" -> ['items', 1, 'text']
const pathKeys = (p) => p.replace(/^s\d+\.?/, '').split(/\.|\[(\d+)\]/).filter((k) => k !== undefined && k !== '').map((k) => (/^\d+$/.test(k) ? Number(k) : k));
const getAt = (obj, keys) => keys.reduce((o, k) => o?.[k], obj);
function setAt(obj, keys, value) {
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}

// TOO_LONG errors -> [{ keys, text, max }]
export function tooLongTargets(issues, data) {
  return issues.filter((i) => i.code === 'TOO_LONG' && i.severity === 'error').map((i) => {
    const keys = pathKeys(i.path);
    const max = Number(/max (\d+)/.exec(i.message)?.[1]);
    return { keys, text: getAt(data, keys), max };
  }).filter((t) => typeof t.text === 'string' && t.max > 0);
}

export async function shortenStrings(llm, targets, { unit, system }) {
  const user = targets.map((t, i) => `${i + 1}. (max ${t.max} words, now ${words(t.text)}) ${t.text}`).join('\n');
  const res = await llm.call({
    task: 'slide-write', unit: `${unit}/shorten`, schema: SCHEMA, schemaName: 'shortened',
    system: `${system}\n\n---\n\n# TASK — SHORTEN\n\nRewrite each numbered line so it has **at most** its word limit (a whole $…$ formula counts as one word). Keep the meaning, the key term and every $…$ formula character for character; drop filler words, use a phrase instead of a sentence. In the JSON, every backslash inside a formula is written twice ("$\\\\ce{H2O}$"). Return every line with its number as id.`,
    user,
    context: { targets },
  });
  const out = new Map((res.data.items || []).map((x) => [x.id, x.text]));
  // A rewrite that changed, dropped or cut a formula is not used: the long
  // original then goes through the normal slide repair instead.
  return targets.map((t, i) => {
    const text = out.get(i + 1);
    return { ...t, text: typeof text === 'string' && sameMaths(t.text, text) ? text : t.text };
  });
}

export function applyShortened(data, shortened) {
  const copy = structuredClone(data);
  for (const s of shortened) setAt(copy, s.keys, s.text);
  return copy;
}
