// Mock LLM: builds a valid answer for each layer from the layer's structured
// `context`, deterministically, with no network. It exists so the whole
// pipeline (validators, repair loop, TTS, build, render, QA) can be run and
// tested before the OpenAI key arrives. Its text is placeholder prose drawn
// from the source; it is not meant to teach anything.

const FILLER = ('the cell is the basic unit of life and every living thing is made of cells which carry out ' +
  'all the functions needed to stay alive so we look at how each part works and why it matters').split(' ');

function vocab(ctx) {
  const src = (ctx.words || []).filter((w) => /^[a-z]{3,}$/i.test(w));
  return src.length > 30 ? src : FILLER;
}

function phrase(v, n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(v[(seed * 7 + i * 3) % v.length]);
  const s = out.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- chapter plan ----------------------------------------------------------------

function chapterPlan({ sections, lectures }) {
  const total = sections.reduce((a, s) => a + s.words, 0);
  const target = total / lectures;
  const groups = Array.from({ length: lectures }, () => []);
  let g = 0, acc = 0;
  sections.forEach((s, i) => {
    const left = sections.length - i;
    const groupsLeft = lectures - g;
    if (g < lectures - 1 && groups[g].length && (acc + s.words / 2 > target * (g + 1) || left <= groupsLeft - 1)) g++;
    groups[g].push(s);
    acc += s.words;
  });
  return {
    lectures: groups.map((secs, i) => ({
      index: i + 1,
      title: secs[0]?.heading.replace(/^[\d.]+\s*/, '') || `Part ${i + 1}`,
      section_ids: secs.map((s) => s.id),
      goals: secs.slice(0, 3).map((s) => `Understand ${s.heading.replace(/^[\d.]+\s*/, '')}`).concat(secs.length < 2 ? ['Practise board questions'] : []),
      recap: i === 0 ? null : `Previously: ${groups[i - 1].map((s) => s.heading).join('; ')}`,
      preview: i === lectures - 1 ? null : `Next: ${groups[i + 1]?.map((s) => s.heading).join('; ')}`,
    })),
  };
}

// ---- lecture plan ------------------------------------------------------------------

function lecturePlan({ lecture, lectures, sections, images, types, budget }) {
  const has = (t) => !!types[t];
  const first = lecture === 1, last = lecture === lectures;
  const usedImg = new Set();
  const img = (t) => {
    const im = images.find((x) => types[t].fits(x) && !usedImg.has(x.id)) || images.find((x) => types[t].fits(x));
    if (im) usedImg.add(im.id);
    return im?.id ?? null;
  };
  const head = first && has('hook') ? ['hook'] : first && has('chapter_index') ? ['chapter_index'] : [];
  // Closing slides the pack has (theory / maths have practice_problem instead of descriptive_answer).
  // Commerce closes on a case study (its practice_problem must be followed by a solution slide).
  const answer = has('descriptive_answer') ? 'descriptive_answer' : has('case_study') ? 'case_study' : 'practice_problem';
  const tail = (last ? ['quick_revision', 'mcq', answer, 'mcq'] : ['quick_revision', 'mcq']).filter(has);
  // Pack-specific formats first (only packs that have them pick them), so mock runs exercise them.
  const body = ['concept_intro', 'illustration', 'journal_entry', 'ledger', 'practice_problem', 'trial_balance', 'final_accounts', 'balance_sheet',
                'adjustment', 'principle', 'rule_cards', 'case_study', 'definition', 'characteristics', 'solved_example', 'mcq', 'theorem', 'proof', 'timeline', 'definition',
                'labeled_diagram', 'cause_effect', 'descriptive_answer', 'comparison', 'person', 'definition', 'misconception', 'try_this',
                'characteristics', 'assertion_reason', 'source_extract', 'definition', 'image_points', 'practice_problem', 'solved_example',
                'process_flow', 'illustration'];
  const want = Math.max(budget.min, Math.min(budget.max, head.length + tail.length + 8));
  const picked = [];
  const count = (t) => [...head, ...picked, ...tail].filter((x) => x === t).length;
  const caps = { definition: 4, characteristics: 2, mcq: last ? 3 : 4, descriptive_answer: last ? 0 : 2, practice_problem: last ? 0 : 1, solved_example: 2 };
  for (let k = 0; picked.length < want - head.length - tail.length && k < body.length * 3; k++) {
    const t = body[k % body.length];
    if (!has(t) || count(t) >= (caps[t] ?? 1)) continue;
    if (types[t].needsImage && !images.some((x) => types[t].fits(x))) continue;
    if (picked.at(-1) === t) continue;
    if (t === 'proof' && picked.at(-1) !== 'theorem') continue;   // pack flow: a proof comes right after its theorem
    picked.push(t);
    // Commerce: a pause-and-try problem is answered on the next slide.
    if (t === 'practice_problem' && has('journal_entry')) picked.push('journal_entry');
  }
  const list = [...head, ...picked, ...tail];
  return {
    lecture_title: (sections[0]?.heading || 'Lecture').replace(/^[\d.]+\s*|^lecture\s*\d+\s*:\s*/gi, '').split(/\s+/).slice(0, 6).join(' '),
    slides: list.map((t, i) => {
      const sec = sections[i % sections.length];
      return {
        slide_type: t,
        title: sec.heading.replace(/^[\d.]+\s*/, '').split(' ').slice(0, 6).join(' ') || `Topic ${i + 1}`,
        purpose: `${t} for ${sec.heading}`,
        key_points: [sec.text.split(/[.!?]/)[0].slice(0, 120) || sec.heading],
        source_refs: ['chapter_index', 'quick_revision'].includes(t) ? [] : [sec.id],
        image_id: types[t].takesImage ? img(t) : null,
      };
    }),
  };
}

// ---- slide content -------------------------------------------------------------------

function fillField(name, lim, v, seed) {
  const n = (lim.items ? Math.max(lim.items[0], Math.min(lim.items[1], 3)) : 1);
  const w = Math.max(2, Math.min(lim.words ?? 8, 8));
  if (lim.fields) {
    return Array.from({ length: n }, (_, i) => Object.fromEntries(Object.entries(lim.fields)
      .filter(([, l]) => l.required || l.words)
      .map(([k, l]) => {
        const one = (j) => phrase(v, Math.max(2, Math.min(l.words ?? 6, 6)), seed + i + k.length + j);
        return [k, l.items ? [0, 1].map(one) : one(0)];
      })));
  }
  if (lim.json?.type === 'array') return Array.from({ length: n }, (_, i) => ({ term: phrase(v, 2, seed + i), meaning: phrase(v, 6, seed + i + 1) }));
  return lim.items ? Array.from({ length: n }, (_, i) => phrase(v, w, seed + i)) : phrase(v, w, seed);
}

// Does this spec field hold numbers somewhere (accounting amounts)? Random
// phrases cannot fill those, so such slides take their template's example.
function holdsNumbers(spec) {
  const f = typeof spec === 'string' ? { type: spec.replace('!', '') } : Array.isArray(spec) ? { type: 'list', of: spec[0] } : spec && !spec.type ? { type: 'object', fields: spec } : spec;
  if (!f) return false;
  if (f.type === 'number') return true;
  if (f.type === 'list') return holdsNumbers(f.of);
  if (f.type === 'object') return Object.values(f.fields || {}).some(holdsNumbers);
  return false;
}

function slideData(st, plan, v, seed) {
  if (st.example && Object.keys(st.spec.fields).some((k) => holdsNumbers(st.schema[k]))) {
    return { title: plan.title, ...Object.fromEntries(Object.keys(st.spec.fields).filter((k) => k in st.example).map((k) => [k, structuredClone(st.example[k])])) };
  }
  const d = { title: plan.title };
  for (const [k, lim] of Object.entries(st.spec.fields)) {
    if (!lim.required && !['points', 'caption', 'steps'].includes(k)) continue;
    d[k] = fillField(k, lim, v, seed + k.length);
  }
  if (st.type === 'mcq') Object.assign(d, { options: ['Option one', 'Option two', 'Option three', 'Option four'], answer: 'A', wrong: ['C'] });
  if (st.type === 'assertion_reason') Object.assign(d, { answer: 'A', wrong: ['B'] });
  // A fixed plain scene: source vocabulary could contain words the art_prompt check refuses.
  if (st.type === 'illustration') d.art_prompt = 'A student reading a book at a wooden desk beside a sunny window, side view';
  if (st.type === 'comparison') {
    d.columns = ['Basis', 'First', 'Second'];
    d.rows = [0, 1, 2].map((i) => [phrase(v, 2, seed + i), phrase(v, 4, seed + i + 1), phrase(v, 4, seed + i + 2)]);
  }
  if (!st.spec.fields.caption || !plan.image_id) delete d.caption;
  return d;
}

// Trim every string to its template field's character limit (at a word end).
function clamp(schema, v) {
  const spec = typeof schema === 'string' ? { type: schema.replace('!', '') } : Array.isArray(schema) ? { type: 'list', of: schema[0] } : schema && !schema.type ? { type: 'object', fields: schema } : schema;
  if (typeof v === 'string' && spec?.max) return v.length <= spec.max ? v : v.slice(0, spec.max).replace(/\s+\S*$/, '');
  if (Array.isArray(v) && spec?.of) return v.map((x) => clamp(spec.of, x));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const fields = spec?.fields || schema;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clamp(fields?.[k], x)]));
  }
  return v;
}

function slideWrite(ctx) {
  // The shortener's request (generation/shorten.js).
  if (ctx.targets) return { items: ctx.targets.map((t, i) => ({ id: i + 1, text: String(t.text).split(/\s+/).slice(0, t.max).join(' ') })) };
  const v = vocab(ctx);
  return { slides: ctx.slides.map((s) => ({ index: s.index, slide_type: s.st.type, data: clamp(s.st.schema, slideData(s.st, s.plan, v, s.index)) })) };
}

// ---- narration ------------------------------------------------------------------------

function narrate(ctx) {
  const v = vocab(ctx);
  return {
    slides: ctx.slides.map((s) => {
      const [lo, hi] = s.range || s.st.spec.narrationWords;
      // Hinglish conversion adds ~25% words; aim so the result lands mid-range.
      const target = Math.round(((lo + hi) / 2) / (ctx.language === 'hinglish' ? 1.25 : 1));
      const ids = s.markers.map((m) => m.id);
      const chunks = ids.length + 1;
      const per = Math.max(10, Math.floor(target / chunks));
      const sentence = (k, n) => `${phrase(v, n, s.index * 13 + k)}.`;
      const block = (k) => { const out = []; let left = per; let j = 0; while (left > 0) { const n = Math.min(12, left); out.push(sentence(k * 10 + j++, n)); left -= n; } return out.join(' '); };
      let text = s.st.spec.question ? `So what do you think the answer is? ${block(0)}` : block(0);
      if (s.st.type === 'intro') text = `Welcome to lecture ${ctx.lecture ?? 1} of this chapter. ${text}`;
      ids.forEach((id, k) => { text += ` {{${id}}} ${block(k + 1)}`; });
      return { index: s.index, narration: ctx.language === 'hinglish' ? toHinglish(text) : ctx.language === 'hindi' ? toHindi(text) : text };
    }),
  };
}

const HI = { the: '', is: 'है', are: 'हैं', and: 'और', of: 'का', to: 'को', in: 'में', this: 'यह', so: 'तो', with: 'के साथ', from: 'से', all: 'सब', we: 'हम', how: 'कैसे', why: 'क्यों', what: 'क्या', each: 'हर', which: 'जो', do: 'करते', you: 'आप', think: 'सोचिए' };

const TAILS = ['यह ध्यान से समझिए', 'इसे याद रखना ज़रूरी है', 'यही इसकी असली बात है', 'इसे ऐसे देखो'];

// Hindi courses: every word in Devanagari (the welcome keeps "lecture N").
const HINDI_WORDS = ['यह', 'पाठ', 'हमें', 'सिखाता', 'है', 'कि', 'कवि', 'ने', 'इस', 'पंक्ति', 'में', 'अपने', 'मन', 'की', 'बात', 'कही', 'और', 'इसका', 'अर्थ', 'बहुत', 'सुंदर', 'समझिए', 'ध्यान', 'से'];
function toHindi(en) {
  let k = 0;
  return en.split(/(\{\{b\d+(?:\.\d+){0,2}\}\}|lecture \d+)/).map((part) => {
    if (/^\{\{|^lecture \d+$/.test(part)) return part;
    return part.replace(/[A-Za-z]+/g, () => HINDI_WORDS[k++ % HINDI_WORDS.length]).replace(/\./g, '।');
  }).join('');
}

function toHinglish(en) {
  let k = 0;
  return en.split(/(\{\{b\d+(?:\.\d+){0,2}\}\})/).map((part) => {
    if (/^\{\{/.test(part)) return part;
    return part.replace(/\b([A-Za-z]+)\b/g, (w) => (w.toLowerCase() in HI ? HI[w.toLowerCase()] : w))
      .replace(/\s{2,}/g, ' ')
      .replace(/\.(\s|$)/g, (_, sp) => `, ${TAILS[k++ % TAILS.length]}।${sp}`);
  }).join('');
}

function hinglish(ctx) {
  return { slides: ctx.slides.map((s) => ({ index: s.index, hinglish: toHinglish(s.english) })) };
}

// ---- summary videos ------------------------------------------------------------------

// Parts follow the lectures (merged or split to fit the allowed part count).
function summaryOutline({ sections, lectures, minutes, parts: [pmin, pmax] }) {
  let groups = lectures.map((l) => sections.filter((s) => s.lecture === l.index));
  while (groups.length > pmax) { const [a, b] = groups.splice(groups.length - 2, 2); groups.push([...a, ...b]); }
  while (groups.length < Math.min(pmin, sections.length)) {
    const i = groups.reduce((best, g, j) => (g.length > groups[best].length ? j : best), 0);
    const g = groups[i];
    if (g.length < 2) break;
    groups.splice(i, 1, g.slice(0, Math.ceil(g.length / 2)), g.slice(Math.ceil(g.length / 2)));
  }
  const total = sections.reduce((a, s) => a + s.words, 0) || 1;
  return {
    parts: groups.map((g) => ({
      title: (g[0]?.heading || 'Part').replace(/^[\d.]+\s*/, '').split(/\s+/).slice(0, 5).join(' '),
      lectures: [...new Set(g.map((s) => s.lecture))],
      section_ids: g.map((s) => s.id),
      minutes: Math.round((g.reduce((a, s) => a + s.words, 0) / total) * minutes * 10) / 10,
      key_points: [...g.map((s) => s.heading), 'The main idea of this part', 'How it is asked in the exam', 'A common mistake to avoid'].slice(0, 6),
      must_include: [],
    })),
  };
}

const SUMMARY_BODY = ['definition', 'comparison', 'process_flow', 'labeled_diagram', 'image_points', 'characteristics', 'formula_sheet', 'timeline',
  'cause_effect', 'principle', 'journal_entry', 'ledger', 'trial_balance', 'rule_cards', 'passage', 'word_meanings', 'grammar_rule', 'central_idea',
  'character', 'misconception', 'mechanism', 'person', 'source_extract', 'definition', 'comparison'];

function summaryPlan({ sections, images, types, budget, final, endTypes, finalQuestions, questionTypes }) {
  const has = (t) => !!types[t];
  const usedImg = new Set();
  const img = (t) => {
    const im = images.find((x) => types[t].fits(x) && !usedImg.has(x.id));
    if (im) usedImg.add(im.id);
    return im?.id ?? null;
  };
  const end = endTypes.find((t) => has(t) && !questionTypes.includes(t)) || endTypes.find(has);
  const tail = [end, ...(final ? Array(finalQuestions).fill(questionTypes.find(has) || 'mcq') : [])].filter(has);
  const want = Math.max(budget.min, tail.length + 2);
  const body = [];
  for (let k = 0; body.length < want - tail.length && k < SUMMARY_BODY.length * 2; k++) {
    const t = SUMMARY_BODY[k % SUMMARY_BODY.length];
    if (!has(t) || body.filter((x) => x === t).length >= (t === 'definition' ? 2 : 1) || body.at(-1) === t) continue;
    if (types[t].needsImage && !images.some((x) => types[t].fits(x) && !usedImg.has(x.id))) continue;
    body.push(t);
  }
  const list = [...body, ...tail];
  return {
    slides: list.map((t, i) => {
      const sec = sections[i % sections.length];
      return {
        slide_type: t,
        title: sec.heading.replace(/^[\d.]+\s*/, '').split(' ').slice(0, 6).join(' ') || `Topic ${i + 1}`,
        purpose: `${t} for ${sec.heading}`,
        key_points: [sec.text.split(/[.!?]/)[0].slice(0, 120) || sec.heading],
        source_refs: [sec.id],
        image_id: types[t].takesImage ? img(t) : null,
      };
    }),
  };
}

const TASKS = {
  'summary-outline': summaryOutline,
  'summary-plan': summaryPlan,
  'summary-write': (ctx) => slideWrite(ctx),
  'summary-narrate': (ctx) => narrate(ctx),
  'summary-review': () => ({ issues: [] }),
  'chapter-plan': chapterPlan,
  'slide-plan': lecturePlan,
  'slide-write': slideWrite,
  narrate,
  hinglish,
  review: () => ({ issues: [] }),
};

export function mockProvider() {
  return {
    name: 'mock',
    model: 'mock',
    async complete({ task, context }) {
      const fn = TASKS[task];
      if (!fn) throw new Error(`mock LLM has no handler for task "${task}"`);
      return { data: fn(context || {}), usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
}
