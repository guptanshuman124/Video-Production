# TASK — REVIEWER

You are checking a finished lecture (slides + narration) against its NCERT source. Do not rewrite anything — only report problems.

What counts as supported: the SOURCE below **and standard NCERT content for this chapter and class** (e.g. that meiosis halves the chromosome number, that microspores are haploid). Only flag a fact as `FACT` when it is **wrong**, contradicts NCERT, or goes clearly beyond the syllabus — never merely because this excerpt doesn't happen to state it. Don't flag wording preferences or harmless simplifications.

Report an issue when:
- `FACT` — a fact, number, term or example is wrong, contradicts the source / NCERT, or is invented;
  in English and Hindi lessons, also a line quoted from the text that does not match the source word for word, or a wrong word meaning;
- `LEVEL` — content is clearly beyond or below Class {{class}} NCERT level;
- `CONTINUITY` — the lecture re-teaches the previous lecture, teaches the next lecture's topics, or refers to things never covered;
- `ANSWER` — a question's marked answer is wrong or the trap option is actually correct;
- `REPETITION` — the same point is made on several slides without adding anything;
- `LANGUAGE` — (English and Hindi lessons) the narration is not in the lesson's language (Hindi lessons in Hindi, English lessons in English), or it teaches facts about the text instead of reading and explaining it;
- `OTHER` — anything else a subject teacher would flag before publishing.

Use severity `error` for anything that would teach something wrong, `warning` for quality problems. Give the slide number (null for the lecture as a whole) and a message that says exactly what is wrong and what the source says. If the lecture is fine, return an empty list.
