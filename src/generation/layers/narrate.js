// L4 — narrator: slides -> voice-over with reveal markers.
//
// The voice-over is written in the course's narration language
// (prepared.chapter.narration_language): Hinglish for every subject except
// Hindi (taught in Hindi) and English (taught in English).
// Hinglish, narration.mode direct (default): written straight in Hinglish,
// checked by G4 for teaching and script together — one LLM step.
// Hinglish, narration.mode via-english: an English draft, converted by L5 (hinglish.js).

import { markerGuide, stripNulls } from '../../slides.js';
import { gateNarration, pictureOf, pictureNote } from '../../validators/generation.js';
import { systemPrompt, narrationExamples } from '../prompts.js';
import { perSlideWithRepair, batchRepairText } from '../repair.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slides'],
  properties: { slides: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['index', 'narration'],
    properties: { index: { type: 'integer' }, narration: { type: 'string' } },
  } } },
};

// The language this step writes: the course's own language for Hindi and
// English courses; for Hinglish courses, Hinglish (direct) or the English
// draft (via-english).
export function narrationLanguage(cfg, chapter = null) {
  const lang = chapter?.narration_language || 'hinglish';
  if (lang !== 'hinglish') return lang;
  return (cfg.narration?.mode || 'direct') === 'via-english' ? 'english' : 'hinglish';
}
// Hinglish courses in via-english mode convert the English draft afterwards.
export const needsConversion = (cfg, chapter = null) => (chapter?.narration_language || 'hinglish') === 'hinglish' && narrationLanguage(cfg, chapter) === 'english';

// Narration runs a little longer than the English word ranges in Hinglish and
// Hindi (postpositions are separate words); config narration.word_factors.
export function wordFactorOf(cfg, language) {
  const f = cfg.narration?.word_factors || {};
  if (f[language] != null) return f[language];
  return language === 'hinglish' ? (cfg.narration?.hinglish_word_factor ?? 1.1) : language === 'hindi' ? 1.2 : 1;
}

// The intro's closing line, in the narration language.
const LETS_BEGIN = { hinglish: 'तो चलिए, शुरू करते हैं।', hindi: 'तो चलिए, शुरू करते हैं।', english: "So let's begin." };

// opts.indices: only these slides (1-based); opts.initial: review findings to fix first.
export async function narrateSlides(G, plan, slides, opts = {}) {
  const { cfg, llm, prepared, lecture, types, packId } = G;
  const language = narrationLanguage(cfg, prepared.chapter);
  const wordFactor = wordFactorOf(cfg, language);
  const range = (st) => st.spec.narrationWords.map((w) => Math.round(w * wordFactor));
  const unit = `${prepared.chapter.chapter_id}/L${lecture.index}`;
  const indices = opts.indices || slides.map((_, i) => i + 1);
  const n = slides.length;
  const examples = narrationExamples(types, packId, language, G.vars.variant);
  // The picture each slide shows (NCERT figure from the plan, or the illustration).
  const catalog = new Map((prepared.images || []).map((im) => [im.id, im]));
  const picture = (i) => pictureOf(plan.slides[i - 1]?.image_id ? catalog.get(plan.slides[i - 1].image_id) : null, slides[i - 1].data);
  const L = prepared.lecture || {};
  const chapterRef = `chapter ${L.chapter_number || ''} ${prepared.chapter.title}`.replace(/\s+/g, ' ').trim();
  // The next lecture (title + headings; bare course-table title as a fallback),
  // for the last slide's one-sentence pointer.
  const quoted = (t) => (t ? `"${t}"` : null);
  const next = (lecture.preview || quoted(L.chapter_lectures?.[lecture.index]) || '').slice(0, 300);

  // Extra instructions for the opening slides (their facts are code-filled).
  const slideNote = (s) => {
    if (s.slide_type === 'intro') {
      // A title card: welcome + today's title, about 10 seconds. Nothing else.
      // Hindi lessons welcome in Hindi; only "lecture N" stays in Latin script.
      const welcome = language === 'hindi'
        ? `नमस्ते! पाठ ${L.chapter_number || ''} — ${prepared.chapter.title} के lecture ${lecture.index} में आपका स्वागत है!`.replace(/\s+/g, ' ')
        : `Welcome to lecture ${lecture.index} of ${chapterRef}!`;
      return `INTRO SLIDE (title card, about 10 seconds): only a warm welcome that names the lecture number and the chapter, e.g. "${welcome}" (keep "lecture ${lecture.index}" in Latin script), then today's lecture title "${s.data.title}", then one short line like "${LETS_BEGIN[language] || LETS_BEGIN.hinglish}". `
        + 'No recap, no hook or question, no list of topics, no teaching — the next slide goes straight into the first topic.';
    }
    if (s.slide_type === 'chapter_index') {
      return `CHAPTER ROADMAP — this chapter has ${L.chapter_lectures?.length || 'several'} lectures (listed on screen). Walk through them briefly at their markers so the student sees where the chapter is going; this is lecture ${lecture.index}.`;
    }
    return null;
  };

  const runBatch = async (batch, repair, attempt) => {
    const user = [
      `This is lecture ${lecture.index} of ${G.lectures} in ${chapterRef}.`,
      lecture.index < G.lectures
        ? `Next lecture${next ? `: ${next}` : ''} (for slide ${n}'s one-sentence pointer only — do not teach it).`
        : 'This is the last lecture of the chapter — no forward pointer.',
      '',
      ...batch.map((i) => {
        const s = slides[i - 1];
        const st = types[s.slide_type];
        const guide = markerGuide(st.spec, s.data);
        return [
          `## Slide ${i} of ${n} — ${s.slide_type}${st.spec.question ? ' (question slide)' : ''}`,
          `Content: ${JSON.stringify(stripNulls(s.data))}`,
          `Word range: ${range(st).join('–')} words`,
          pictureNote(picture(i)),
          slideNote(s),
          guide.length ? `Markers, in this order:\n${guide.map((g) => `- {{${g.id}}} → ${g.what}`).join('\n')}` : 'Markers: none — everything is on screen from the start.',
        ].filter(Boolean).join('\n');
      }),
    ].join('\n') + batchRepairText(repair, batch);

    const res = await llm.call({
      task: 'narrate', unit: `${unit}/s${batch.join(',')}`,
      // The English draft of a Hinglish course has its own layer; every voiced language uses `narrate`.
      system: systemPrompt(needsConversion(cfg, prepared.chapter) ? 'narrate-english' : 'narrate', { ...G.vars, narration_language: language }, [examples]),
      user, schema: SCHEMA, schemaName: 'narration', salt: attempt,
      context: {
        language, lecture: lecture.index,
        slides: batch.map((i) => ({ index: i, st: types[slides[i - 1].slide_type], range: range(types[slides[i - 1].slide_type]), data: slides[i - 1].data, markers: markerGuide(types[slides[i - 1].slide_type].spec, slides[i - 1].data) })),
        words: plan.slides.flatMap((p) => p.key_points).join(' ').split(/\s+/).concat(lecture.section_ids.map((id) => G.sectionText[id]).join(' ').split(/\s+/)),
      },
    });
    return { map: new Map((res.data.slides || []).filter((s) => batch.includes(s.index)).map((s) => [s.index, s.narration])), promptHash: res.promptHash };
  };

  const checkOne = (i, text) => {
    const s = slides[i - 1];
    const where = `s${String(i).padStart(2, '0')}`;
    const issues = gateNarration(String(text ?? ''), types[s.slide_type], s.data, where, { language, wordFactor, hindiSubject: prepared.chapter.slide_language === 'hindi', picture: picture(i) });
    // The intro must actually welcome the student to "lecture N".
    if (s.slide_type === 'intro' && !new RegExp(`lecture\\s*${lecture.index}\\b`, 'i').test(String(text ?? ''))) {
      issues.push({ code: 'INTRO_NO_WELCOME', severity: 'error', path: where, message: `${where}: the intro must open with a welcome naming "lecture ${lecture.index}" and the chapter` });
    }
    return { value: text, issues };
  };

  const { results, attempts, promptHashes } = await perSlideWithRepair({ indices, cfg, runBatch, checkOne, initial: opts.initial });
  return { value: indices.map((i) => results.get(i).value), issues: indices.flatMap((i) => results.get(i).issues), attempts, promptHashes, language };
}
