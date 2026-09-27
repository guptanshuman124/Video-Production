// Lecture content from the textbook database -> clean blocks.
//
// `textbook_raw.content` comes in three shapes:
//   1. rich-text editor JSON  {"type":"doc","content":[heading, paragraph, image, lists…]}  (most rows)
//   2. a JSON string holding HTML  "<p><strong>…</strong></p>…"
//   3. plain text (a few rows are not JSON at all)
//
// All three become the same list of blocks:
//   { kind: 'heading', text, level } · { kind: 'text', text } · { kind: 'image', src, description }
//
// Images: nearly every image is followed by an AI-written explanation ("This
// image shows…"). That paragraph (and any list continuing it) becomes the
// image's description and is taken OUT of the teaching text — it is not NCERT
// content and the generator must not treat it as source facts.

const DESC = /^\s*[*_]*\s*(this|the)\s+(image|figure|diagram|picture|illustration|photo|photograph|map|graph|chart|table|page|cartoon|sketch|flowchart|collage)\b/i;
const LISTY = /^\s*(\d+[.)]|[-•*]|\*\*)/;

const inlineText = (n) => {
  if (!n) return '';
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  const inner = (n.content || []).map(inlineText).join('');
  return ['paragraph', 'heading', 'listItem', 'blockquote'].includes(n.type) ? `${inner}\n` : inner;
};
const clean = (s) => String(s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Short paragraph whose every text run is bold: an unmarked heading.
function boldHeading(n) {
  if (n.type !== 'paragraph') return false;
  const runs = (n.content || []).filter((x) => x.type === 'text' && x.text.trim());
  if (!runs.length || !runs.every((x) => (x.marks || []).some((m) => m.type === 'bold'))) return false;
  const words = clean(inlineText(n)).split(/\s+/).length;
  return words > 0 && words <= 12;
}

// ---- 1. editor JSON ------------------------------------------------------------------

function fromDoc(doc) {
  const out = [];
  const top = doc.content || [];
  for (let i = 0; i < top.length; i++) {
    const n = top[i];
    const text = clean(inlineText(n));
    if (n.type === 'image') {
      const src = n.attrs?.src;
      // Description: the next non-empty block if it reads like one, plus any
      // list-like paragraphs/lists that continue it.
      let j = i + 1;
      while (j < top.length && top[j].type === 'paragraph' && !clean(inlineText(top[j]))) j++;
      let description = '';
      if (j < top.length && DESC.test(clean(inlineText(top[j])))) {
        description = clean(inlineText(top[j]));
        let k = j + 1;
        for (let extra = 0; extra < 4 && k < top.length; extra++) {
          const t = clean(inlineText(top[k]));
          if (!t && top[k].type === 'paragraph') { k++; extra--; continue; }
          if (['orderedList', 'bulletList'].includes(top[k].type) || (top[k].type === 'paragraph' && LISTY.test(t))) {
            description += `\n${t}`;
            k++;
          } else break;
        }
        i = k - 1;
      }
      if (src) out.push({ kind: 'image', src, description });
      continue;
    }
    if (!text) continue;
    if (n.type === 'heading') out.push({ kind: 'heading', text: text.replace(/\n/g, ' '), level: n.attrs?.level || 2 });
    else if (boldHeading(n)) out.push({ kind: 'heading', text: text.replace(/\n/g, ' '), level: 3 });
    else if (n.type === 'horizontalRule') continue;
    else out.push({ kind: 'text', text });
  }
  return out;
}

// ---- 2. HTML string --------------------------------------------------------------------

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', deg: '°', times: '×' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

function fromHtml(html) {
  const out = [];
  // One block per <p>/<h*>/<li>/<img>; tags inside stripped.
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>|<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\2>/gi;
  let m;
  const raw = [];
  while ((m = re.exec(html))) {
    if (m[1]) { raw.push({ kind: 'image', src: m[1] }); continue; }
    const inner = m[3];
    const text = clean(decode(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
    if (!text) continue;
    const allBold = /^\s*<(strong|b)\b[^>]*>[\s\S]*<\/\1>\s*$/i.test(inner.replace(/&nbsp;/g, ' ').trim());
    if (/^h/i.test(m[2])) raw.push({ kind: 'heading', text, level: Number(m[2][1]) });
    else if (allBold && text.split(/\s+/).length <= 12) raw.push({ kind: 'heading', text, level: 3 });
    else raw.push({ kind: 'text', text });
  }
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b.kind === 'image') {
      const next = raw[i + 1];
      if (next && next.kind === 'text' && DESC.test(next.text)) { out.push({ ...b, description: next.text }); i++; }
      else out.push({ ...b, description: '' });
    } else out.push(b);
  }
  return out;
}

// ---- 3. plain text -----------------------------------------------------------------------

function fromText(text) {
  return clean(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => (
    p.split(/\s+/).length <= 6 && !/[.!?।]$/.test(p) && p === p.toUpperCase() && /[A-Z]/.test(p)
      ? { kind: 'heading', text: p, level: 2 }
      : { kind: 'text', text: p }
  ));
}

// ---- entry ---------------------------------------------------------------------------------

// Maths in the source is written \( … \) / \[ … \]; slides and prompts use $…$.
export const normalizeMath = (s) => String(s)
  .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (m, t) => `$${t}$`)
  .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (m, t) => `$${t}$`);

// raw: the `content` column as stored. Returns { format, blocks }.
export function parseContent(raw) {
  let v = raw;
  let format = 'text';
  try { v = JSON.parse(raw); } catch { v = raw; }
  let blocks;
  if (v && typeof v === 'object' && v.type === 'doc') { format = 'doc'; blocks = fromDoc(v); }
  else {
    const s = typeof v === 'string' ? v : String(raw);
    if (/<(p|h[1-6]|li|img)\b/i.test(s)) { format = 'html'; blocks = fromHtml(s); }
    else { format = 'text'; blocks = fromText(s); }
  }
  blocks = blocks.map((b) => (b.kind === 'image' ? b : { ...b, text: normalizeMath(b.text) }));
  return { format, blocks };
}
