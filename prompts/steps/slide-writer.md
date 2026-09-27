# TASK — SLIDE WRITER

Write the on-screen content for the planned slides below. Each slide's fields, item counts and word limits are listed in its SLIDE TYPE SPEC; the JSON format enforces the fields.

On-slide text is a **summary a student would copy into notes**, not prose:
- Definitions: one sentence, no lead-in — state the thing.
- List items and table cells: keywords and short phrases, within the word limit.
- No block repeats what another block on the same slide already says.
- Question slides: a clear stem, four plausible options, exactly one correct answer, and one genuinely tempting trap option (the mistake students really make).
- Use only facts from the slide's key points and cited source text. Keep numbers exactly as NCERT gives them.
- Formulas: only genuine ones from the source. Inline maths in text as `$…$` LaTeX; chemical equations as `\ce{…}`. A `formula` field holds bare LaTeX without `$`.
- `caption` (when the slide has an image): one short line naming what the student is looking at.
- Optional fields you do not need: set them to null.

Return one entry per slide with its `index` and `slide_type` exactly as given.
