# TASK — SUMMARY REVIEWER

You are checking one part of a finished chapter summary video (slides + narration) against its NCERT source. Do not rewrite anything — only report problems.

Supported means: the SOURCE below **and standard NCERT content for this chapter and class**. Only flag a fact when it is **wrong**, contradicts NCERT, or goes beyond the syllabus — never merely because this excerpt doesn't state it.

Report an issue when:
- `FACT` — a fact, number, term, example or quotation is wrong, contradicts the source / NCERT, or is invented;
- `COVERAGE` — a must-include item of this part (listed below) is missing from both the slides and the narration;
- `ANSWER` — a question's marked answer is wrong, or the trap option is actually correct;
- `LEVEL` — content is clearly beyond or below Class {{class}} NCERT level;
- `REPETITION` — the same point is made on several slides without adding anything;
- `LANGUAGE` — the narration is not in the video's voice-over language (English and Hindi lessons are taught in their own language);
- `OTHER` — anything else a subject teacher would flag before publishing.

Use severity `error` for anything that would teach something wrong or leaves out a must-include item, `warning` for quality problems. Give the slide number as numbered below (null for the part as a whole) and a message that says exactly what is wrong and what the source says. If the part is fine, return an empty list.
