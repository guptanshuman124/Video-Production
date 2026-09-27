# Biology deck: template catalog

These templates are coded from the Prepzy **PPT Biology.pdf** template (16 pages, 1440×810 pt, which renders at exactly 1920×1080 px).

- **References:** each template folder keeps the page it reproduces as `reference.png`, plus `reference.json`, the placeholder data that recreates that page for pixel comparison.
- **Measurements:** geometry, colours and font sizes were taken from the PDF's own vector and text layers.

Address a template by its **page number alias** (`bio-05`) or its folder id (`bio-05-comparison-table`):

```jsonc
{ "template": "bio-05", "data": { … } }
```

For every field of a template, with types and limits, run `node src/cli.js template bio-05`.

| page | alias | template | what it is | background |
|---|---|---|---|---|
| 1 | `bio-01` | `bio-01-chapter-index` | chapter name + numbered topic list (≤10, two columns) + tall image panel | white |
| 2 | `bio-02` | `bio-02-definition-table` | definition + bullets + small bottom table (2 columns) + image panel | white |
| 3 | `bio-03` | ↑ same template, 3-column table | | white |
| 4 | `bio-04` | `bio-04-check-cards` | 2×3 cards: check icon, main text, secondary text | grey |
| 5 | `bio-05` | `bio-05-comparison-table` | comparison table, 3 columns, ≤7 rows | grey |
| 6 | `bio-06` | ↑ same template, 4 columns | | grey |
| 7 | `bio-07` | `bio-07-image-full` | one large image panel + caption | white |
| 8 | `bio-08` | `bio-08-image-points` | image panel left; points with formulas right | white |
| 9 | `bio-09` | `bio-09-mechanism` | image panel left; "Mechanism / Concept used" sections right | lavender |
| 10 | `bio-10` | `bio-10-problem` | PROBLEM + ANSWER cards + image panel | teal |
| 11 | `bio-11` | ↑ same template, no `image`, so the cards run full width | | teal |
| 12 | `bio-12` | `bio-12-mcq` | Test Yourself: question, A–E options, answer reveal, explanation, image | grey |
| 13 | `bio-13` | `bio-13-assertion-reason` | Assertion + Reason, four standard options, answer reveal, explanation | teal |
| 14 | `bio-14` | `bio-14-misconception` | ≤3 rows: wrong idea (rose) vs correct idea (mint) | mist |
| 15 | `bio-15` | `bio-15-quick-revision` | KEY POINTS bar + bullets, GLOSSARY bar + bullets | grey |
| 16 | n/a | *not a slide* | MCQ answer colours, applied by `bio-12` / `bio-13` | |

## Shared by every slide

- **Header:** the lecture name (Inter Bold 21.3px, navy `#1b2e83`) sits on the left, and the Prepzy logo (`_shared/assets/logo.png`, extracted from the PDF) on the right. A 1px `#8a93a0` rule sits at y=94.
  - Set the lecture name once per project with `"shared": { "lecture": "…" }`.
  - On page 1 the lecture name is left empty, as in the design.
- **Slide title:** a 10×77 orange (`#f5a623`) rounded bar, with the title in Poppins SemiBold 61.3px `#14181f`.
- **Image panels:** `#f6f7f9` fill, `#e3e6ea` hairline border, 14px radius, and a centred caption in Inter 24px. Every panel takes `image` (a path relative to the project file), `caption`, and `fit` (`contain` shows the whole image; `cover` fills the panel).
  - With no `image` given, the panel shows empty, as in the design.
- **Text fields:** these accept inline markup:
  - `*accent*` renders in navy.
  - `**bold**` renders bold.
  - `$…$` renders a LaTeX formula.
  - `$\ce{…}$` renders a chemical equation, for example `$\ce{6CO2 + 6H2O -> C6H12O6 + 6O2}$`.
- **Fonts:** Poppins (titles), Inter (body) and Arimo (card and option text), all vendored in `_shared/fonts/`.
- **Colours:** every colour is a token in `_shared/global.css`, for example `--brand-navy`, `--bg-teal` and `--mcq-correct-border`.

## Animation (same vocabulary everywhere)

- **Header and title:** fade in at the start and fade out at the end.
- **Content blocks:** cards, rows, bullets and options rise in (fade + 28px lift), staggered in reading order. At the end of the scene they rise out, staggered, just before the header and title fade.
- **Image panels:** settle in (fade + slight scale).
- **Page 4 check icons:** draw themselves after their card lands.
- **Pages 12 and 13 answer reveal:**
  - The correct option fades to green: `#e8f4ef` fill, `#1f7a5a` border.
  - Options listed in `wrong` fade to red: `#fbecea` fill, `#c0392b` border.
  - Then the explanation rises in.

**Narration sync.** Every template has a `cues` object. Its values are **seconds on the video timeline**, which is the same as audio time, so you can copy them straight from a transcript. For any cue you leave out, the element simply follows the automatic stagger.

---

## Data per template

### `bio-01`: chapter index
```json
{ "title": "Locomotion and Movement",
  "items": ["Types of Movement", "Muscle", "Structure of Contractile Proteins", "Mechanism of Muscle Contraction", "Skeletal System", "Joints"],
  "image": "assets/chapter.png", "caption": "…",
  "cues": { "items": [2.0, 3.1, 4.5], "image": 1.0 } }
```
Topics 1–5 fill the left column and 6–10 the right. Each topic appears behind an orange number badge.

### `bio-02` / `bio-03`: definition + table + image
```json
{ "title": "Muscle Tissue",
  "definition": "Muscle is a specialised tissue of mesodermal origin …",
  "points": ["Properties: excitability, contractility …", "Types: skeletal, visceral and cardiac"],
  "columns": ["Muscle type", "Control"],
  "rows": [["Skeletal", "Voluntary"], ["Visceral", "Involuntary"], ["Cardiac", "Involuntary"]],
  "image": "assets/muscle.png", "caption": "Types of muscle fibres",
  "cues": { "definition": 1, "points": [3, 5], "table": 7, "rows": [8, 9, 10], "image": 1 } }
```
- **Table:** it sits at the bottom-left and grows upward, with up to 6 rows and 2–4 columns. Give 3 `columns` for the page-3 look; omit `columns` for no table.
- **Checks:** every row must have one cell per column.

### `bio-04`: check cards
```json
{ "title": "Properties of Muscle",
  "items": [{ "title": "Excitability", "text": "Responds to a nerve impulse" }, { "title": "Contractility", "text": "…" }],
  "cues": { "items": [2, 4, 6, 8, 10, 12] } }
```
Up to 6 cards, filled row by row: 1 2 / 3 4 / 5 6.

### `bio-05` / `bio-06`: comparison table
```json
{ "title": "Types of Muscle",
  "columns": ["Basis", "Skeletal", "Visceral", "Cardiac"],
  "rows": [["Location", "Attached to bones", "Walls of hollow organs", "Heart wall"], ["Striations", "Present", "Absent", "Present"]],
  "reveal": [2.0, [5.1, 5.1, 7.3, 9.0]] }
```
- **Size:** 2–4 columns (3 for page 5, 4 for page 6) and ≤7 rows.
- **Label column:** the first column is the bold navy label. Headings and labels are uppercased unless `"uppercase": false`.
- **`columnWidths`:** overrides the measured column widths.
- **`reveal`:** per row, a time or one time per cell. It's this template's older name for cues.

### `bio-07`: full image
```json
{ "title": "Structure of a Sarcomere", "image": "assets/sarcomere.png", "caption": "…", "cues": { "image": 1.5 } }
```

### `bio-08`: image + points with formulas
```json
{ "title": "Energy for Contraction", "image": "assets/atp.png", "caption": "…",
  "points": [{ "text": "ATP is split by myosin ATPase …", "formula": "\\ce{ATP + H2O -> ADP + P_i}" }],
  "cues": { "points": [3, 8] } }
```
`formula` is LaTeX in display style. In JSON, backslashes are doubled.

### `bio-09`: mechanism / concept
```json
{ "title": "Sliding Filament Theory", "image": "assets/crossbridge.png", "caption": "…",
  "sections": [{ "heading": "Mechanism / Concept used", "text": "…" },
               { "heading": "Key steps", "points": ["Ca²⁺ binds troponin …", "…"] }],
  "cues": { "sections": [2, 9] } }
```

### `bio-10` / `bio-11`: problem + answer
```json
{ "title": "Solved Example",
  "problem": "A sarcomere is 2.4 µm long at rest …",
  "answer": "The A-band stays constant; only the I-bands shorten.",
  "steps": ["Total shortening = 2 × 0.2 µm = 0.4 µm", "New length = **2.0 µm**"],
  "image": "assets/sarcomere.png", "caption": "…",
  "cues": { "problem": 1, "answer": 12, "steps": [15, 19] } }
```
- **Layout:** with `image` it's the page-10 layout. Without `image` it's page 11, with the cards at full width.
- **Labels:** `problemLabel` and `answerLabel` default to PROBLEM and ANSWER.

### `bio-12`: test yourself (MCQ)
```json
{ "question": "Which protein binds Ca²⁺ ions to start muscle contraction?",
  "options": ["Myosin", "Troponin", "Tropomyosin", "Actin"],
  "answer": "B", "wrong": ["C"],
  "description": "Ca²⁺ binds troponin, which shifts tropomyosin …",
  "image": "assets/thin-filament.png", "caption": "…",
  "cues": { "question": 1, "options": [3, 4, 5, 6], "answer": 14, "description": 15 } }
```
- **Options:** 2–5 (A–E).
- **Title:** defaults to "Test Yourself".
- **`wrong`:** optional, for options to flag red, for example the common trap.
- **Without cues:** the answer lights up about 2.4s after the last option.

### `bio-13`: assertion and reason
```json
{ "assertion": "Skeletal muscle fibres are multinucleate.",
  "reason": "Each fibre forms by the fusion of many myoblasts.",
  "answer": "A", "wrong": ["B"],
  "explanation": "Both statements are true, and fusion explains …",
  "cues": { "assertion": 1, "reason": 5, "options": [9, 10, 11, 12], "answer": 20, "explanation": 21 } }
```
`options` defaults to the four standard assertion–reason choices.

### `bio-14`: common misconception
```json
{ "rows": [{ "myth": "Muscle fibres shorten because actin and myosin shrink",
             "fact": "The filaments keep their length",
             "factDetail": "Actin slides over myosin; only the I-band and H-zone shorten." }],
  "cues": { "rows": [[2, 6], [12, 16], 22] } }
```
- **Rows:** up to 3. `mythDetail` is optional.
- **Cues:** per row, either `[mythTime, factTime]` or one time (the fact then follows 0.7s later).

### `bio-15`: quick revision
```json
{ "keyPoints": ["Muscle contraction follows the sliding filament theory", "…"],
  "glossary": [{ "term": "Sarcomere", "meaning": "functional unit of a myofibril" }, "plain text works too"],
  "cues": { "keyPoints": [2, 5, 8], "glossaryBar": 11, "glossary": [12, 15] } }
```
- **Glossary:** the bar sits at y=561, as in the design, and moves down if the key points run long.
- **Page 15's header:** it sits 7px higher in the PDF than on every other page. I kept the standard position so the header never jumps between slides.

## Checking a template against its page

```bash
node src/cli.js template bio-12 --snap out/cmp/bio-12.png --data templates/bio-12-mcq/reference.json
# compare out/cmp/bio-12.png with templates/bio-12-mcq/reference.png
```

`projects/biology-demo.json` runs every template in sequence with its example data.
