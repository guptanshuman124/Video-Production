# TASK — SLIDE WRITER

Write the on-screen content for the planned slides below. Each slide's fields, item counts and word limits are listed in its SLIDE TYPE SPEC; the JSON format enforces the fields.

On-slide text is a **summary a student would copy into notes**, not prose:
- Definitions: one sentence, no lead-in — state the thing.
- List items and table cells: keywords and short phrases, within the word limit.
- No block repeats what another block on the same slide already says.
- Question slides: a clear stem, four plausible options, exactly one correct answer, and one genuinely tempting trap option (the mistake students really make). Write option text without its letter ("Magnesium and oxygen", not "A. Magnesium and oxygen") — the slide draws the letters.
- Use only facts from the slide's key points and cited source text. Keep numbers exactly as NCERT gives them.
- **Highlight key terms:** wrap the one key term of a point, definition or answer in single asterisks — `*osmosis*`, `*activation energy*`, `the *pole* of the mirror` — and the slide shows it highlighted. At most one or two per field, single words or short terms only (never whole sentences). Not in titles, not on question slides (`mcq`, `assertion_reason` — the revealed answer is the highlight there), not inside `$…$`, not in `formula` / `symbol` fields and never in `art_prompt`.
- Formulas: only genuine ones from the source. A `formula` or `symbol` field holds bare LaTeX without `$` (it is always rendered as maths).
- **Every other field is plain text: any maths in it must be inside `$…$`** — symbols, Greek letters, subscripts, powers and units with powers. Otherwise it shows on screen as raw code.
  - Right: `angular speed (rad $s^{-1}$)`, `where $a_c$ is the centripetal acceleration`, `$\Delta\theta$ in radians`, `$\ce{H2O}$`.
  - Wrong: `\omega – angular speed (rad s^{-1})`, `a_c`, `\Delta\theta`.
  - Each formula is complete inside one `$…$` pair — never a lone `$`. A literal dollar is `\$`.
  - **In your JSON output every backslash is doubled:** `"$\\ce{LiAlH4}$"`, `"$\\beta$"`, `"$\\frac{1}{2}$"`. A single backslash breaks the string (`\b`, `\f`, `\n` become control characters) and shows a box or a bare `$` on screen.
- Symbol keys are separate entries: `symbol` = the LaTeX symbol (`\omega`), `meaning` = what it is with its SI unit (`angular speed (rad $s^{-1}$)`).
- `caption` (when the slide has an image): one short line naming what the student is looking at.
- Optional fields you do not need: set them to null.

Return one entry per slide with its `index` and `slide_type` exactly as given.
