// CBSE scope: which template pack serves which subject, class bands, and the
// per-lecture slide budget derived from the target lecture length.

export const PACKS = {
  physics:     { subjects: ['Physics', 'Science'], variants: [] },
  chemistry:   { subjects: ['Chemistry', 'Science'], variants: ['organic', 'inorganic', 'physical'] },
  biology:     { subjects: ['Biology', 'Science'], variants: [] },
  mathematics: { subjects: ['Mathematics', 'Applied Mathematics'], variants: [] },
  commerce:    { subjects: ['Accountancy', 'Business Studies'], variants: ['accountancy', 'business-studies'] },
  theory:      { subjects: ['History', 'Geography', 'Political Science', 'Civics', 'Economics', 'Social Science', 'Sociology', 'Psychology'], variants: [] },
  // English and Hindi are taught as languages (reading the text, meanings,
  // grammar, writing), in their own language — not as theory subjects.
  language:    { subjects: ['English', 'Hindi'], variants: ['english', 'hindi'] },
};

// What the voice-over is spoken in. Every subject is taught in Hinglish except
// the two language subjects, which are taught in their own language: Hindi in
// Hindi (an English word only where a teacher would really use one), English
// in English. courses.yaml `narration_language` overrides it per course.
export const NARRATION_LANGUAGES = ['hinglish', 'hindi', 'english'];
// Names for prompts: "Hinglish", "Hindi", "English"; slides "English" / "Hindi (Devanagari)".
export const VOICE_LANGUAGE_NAME = { hinglish: 'Hinglish (Hindi in Devanagari mixed with English terms)', hindi: 'Hindi', english: 'English' };
export const slideLanguageName = (l) => (l === 'hindi' ? 'Hindi (Devanagari)' : 'English');

export function narrationLanguageOf(meta) {
  if (meta?.narration_language && NARRATION_LANGUAGES.includes(meta.narration_language)) return meta.narration_language;
  if (meta?.subject === 'Hindi') return 'hindi';
  if (meta?.subject === 'English') return 'english';
  return 'hinglish';
}

export const classBand = (cls) => (cls <= 8 ? '6-8' : cls <= 10 ? '9-10' : '11-12');

export const BAND_NOTES = {
  '6-8': 'Class 6–8: simple words, short sentences, everyday examples first, one idea at a time; no exam jargon.',
  '9-10': 'Class 9–10: board-exam depth; precise NCERT terms, reasons and examples; link to how questions are asked in the board paper.',
  '11-12': 'Class 11–12: full NCERT depth with correct terminology, mechanisms and reasoning chains; board plus competitive-exam awareness, but never beyond NCERT.',
};

// Slides per lecture: target minutes ÷ minutes per slide (config.curriculum).
export function slideBudget(cfg) {
  const { lecture_minutes: mins, slide_minutes: [lo, hi] } = cfg.curriculum;
  return { min: Math.floor(mins / hi), max: Math.ceil(mins / lo), minutes: mins };
}

// Target video length for one lecture, from how much source it has (config
// duration): base + per-1000-words, clamped. Short sources get short videos
// instead of padding; long ones are capped and summarised, never invented.
export function lectureMinutes(sourceWords, cfg) {
  const d = cfg.duration;
  const m = d.base_minutes + (sourceWords / 1000) * d.minutes_per_1000_words;
  return Math.round(Math.min(d.max_minutes, Math.max(d.min_minutes, m)) * 2) / 2;
}

// Slides for a lecture of `minutes` (config curriculum.slide_minutes per slide).
export function lectureBudget(minutes, cfg) {
  const [lo, hi] = cfg.curriculum.slide_minutes;
  const min = Math.max(4, Math.floor(minutes / hi));
  return { min, max: Math.max(min + 1, Math.ceil(minutes / lo)), minutes };
}

// Issues for a chapter's pack/variant against the installed template packs.
export function packIssues(chapter, installedPacks) {
  const issues = [];
  const p = PACKS[chapter.pack];
  if (!p) return [{ code: 'UNKNOWN_PACK', severity: 'error', path: '/pack', message: `unknown pack "${chapter.pack}"` }];
  if (chapter.variant && !p.variants.includes(chapter.variant)) {
    issues.push({ code: 'UNKNOWN_VARIANT', severity: 'error', path: '/variant',
                  message: `pack "${chapter.pack}" has no variant "${chapter.variant}" (known: ${p.variants.join(', ') || 'none'})` });
  }
  if (!installedPacks[chapter.pack]) {
    issues.push({ code: 'PACK_NOT_INSTALLED', severity: 'error', path: '/pack',
                  message: `templates/${chapter.pack}/ is not installed yet (installed: ${Object.keys(installedPacks).join(', ') || 'none'})` });
  }
  return issues;
}
