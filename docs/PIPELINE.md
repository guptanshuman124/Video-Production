# CBSE lecture pipeline

One NCERT chapter goes in; five validated Hinglish lecture videos (~20 min, 1080p25) come out. Every step is followed by a gate — code that checks the step's output. Failures are repaired or sent to a review queue, and nothing unchecked reaches the renderer.

```
chapter.json ─► prepare ─► chapter-plan ─┬─► L1 … L5, each:
   (G0)            (G1)                  │   slide-plan ─► slide-write ─► narrate ─► review ─► assemble
                                         │     (G2)          (G3)        (G4)       (G6)       (C1)
                                         │   ─► voice ─► build ─► render ─► qa
                                         │      (A1)     (A2)      (R1)     (V1)
```

## Running

```bash
hvr run examples/chapter-input.sample.json            # everything, all 5 lectures
hvr run chapter.json --lecture 2 --from narrate        # redo narration onwards for lecture 2
hvr run chapter.json --to assemble                     # text only (same as `hvr generate`)
hvr run chapter.json --mock                            # mock LLM + mock TTS: no keys, no cost
hvr batch chapters/ --shard 3/8                        # every chapter in a folder, shard 3 of 8
hvr status cbse-11-bio-08                              # stage results + review queue
hvr packs                                              # installed packs and slide types
hvr prompt slide-plan --pack biology                   # the assembled system prompt for a layer
npm test                                               # validators, timing, mock end-to-end
```

Keys go in `.env` (see `.env.example`). Machine-specific settings go in `config/local.yaml`, which overrides `config/default.yaml` key by key.

## Textbook source (tutorai.textbook_raw) — the production input

The database already splits every chapter into lectures: **one row = one lecture = one video** (5,756 rows, 1,021 chapters, 110 courses). There is no chapter-plan step. Each row goes through `prepare` and then the lecture stages above. Jobs live in `jobs/c<course>/m<module>/l<lecture>/`.

```bash
hvr source audit  --source export.jsonl              # parse every row, G0 precheck, video hours — no LLM, no network
hvr source export --out export.jsonl                 # TEXTBOOK_DB_URL → JSONL (for offline runs)
hvr lectures --source db --course 58 --module 338     # run one chapter's lectures (or --lecture 1717,1718)
hvr lectures --source db --shard 3/8                  # every lecture, shard 3 of 8 (one per container)
hvr lectures … --as "class=12,subject=Biology,pack=biology"   # try a course before it is in courses.yaml
```

**Reading the rows** (`src/sources/`):
- `content` comes in three formats, all normalised to headings / text / images: rich-text editor JSON (5,731 rows), a JSON string of HTML (23), and plain text (2).
- Short all-bold paragraphs are treated as headings.
- Maths written `\(…\)` becomes `$…$`.
- The AI-written paragraph after each image ("This image shows…") becomes that image's catalog description. It is **removed from the teaching text**: it is not NCERT content. A `[Figure img_<lecture>_<n>: …]` line stays where the image sat.
- Lecture order within a module (by `lecture_id`) gives each lecture its position. Lecture 1 opens the chapter with `chapter_index`; the last lecture closes it with a chapter-level revision.
- The neighbours' `mini_lecture` summaries become the recap and preview, with no LLM call. Unfilled template summaries (`[insert main topic]`, ~640 rows) are ignored.

**Course catalog:** `hvr source courses --catalog db --source db` generates `config/courses.yaml` from `classes` + `subjects` + `class_subject_mapping.course_ids`.
- **Subject → pack:** Social Science, History, Geography, Political Science, Economics, Sociology, English and Hindi → theory; Mathematics → mathematics; Physics, Chemistry, Biology → their own packs; Accountancy and Business Studies → commerce.
- **Science (Classes 6–10) is classified per chapter** into physics, chemistry or biology, and **Chemistry per chapter** into organic, inorganic or physical. It's a keyword classifier over the chapter text, and each result is written with its confidence. Low-confidence chapters get `review: true` and a `PACK_NEEDS_REVIEW` warning at G0.
- NEET-UG courses are disabled. Courses absent from the catalog stay blocked.
- Set `reviewed: true` on a course to keep manual edits when regenerating.
- The slide planner also returns a clean `lecture_title` (source headings can be garbled, e.g. "TRANSPORT ANSPORTATION"). That title is what the slide header shows.

**Course metadata** (`config/courses.yaml`): class, subject, pack, variant, `slide_language`, and optional chapter and lecture titles, per `course_id`. An unmapped course stops at G0 (`COURSE_UNMAPPED`); nothing is guessed.

**Length follows the source** (`config duration`):
- target minutes = 5.3 + 7.35 × source words / 1000, clamped to 8–25 (≈ 640 words → 10 min, 2,000 → 20 min).
- The slide budget and the A1 audio band (±30%) come from that target.
- Long sources are summarised to fit, never padded.

**Hindi-subject courses** (`slide_language: hindi`):
- Slide text is Devanagari; the voice-over stays Hinglish.
- Noto Sans Devanagari is in every template's font stack.
- G3 requires Devanagari slides for these courses and forbids Devanagari on English courses.

**G0 for a lecture** (`gateLectureInput`, `gatePreparedLecture`):
- **Blocks:** `COURSE_UNMAPPED`, `TOO_LITTLE_SOURCE` (< 120 words).
- **Warns:** `THIN_SOURCE` (< 250), `MOSTLY_IMAGE_DESCRIPTIONS` (> 60% of the row is image descriptions), `LANGUAGE_MISMATCH`, `SUMMARY_PLACEHOLDER`, `PLAIN_TEXT_SOURCE`.

**Images:**
- Sizes are measured once and cached in `jobs/.cache/image-sizes.json`.
- 30% of textbook figures are wider than 2:1, so the full-width diagram slot accepts up to 3:1.
- Half are under 500 px; they are marked low-res in the planner's catalog.

## Input — `chapter.json` (chapter mode: raw chapter text → 5 planned lectures)

`src/contracts/chapter-input.schema.json`. Example: `examples/chapter-input.sample.json`.

| field | |
|---|---|
| `chapter_id`, `class` (6–12), `subject`, `title` | identity |
| `pack` | `physics · chemistry · biology · mathematics · commerce · theory` — which template pack renders it |
| `variant` | e.g. `organic` / `inorganic` / `physical` for chemistry, `accountancy` / `business-studies` for commerce |
| `source_text` | the raw NCERT chapter text |
| `images[]` | `{ id, url, description, tags?, width?, height? }`: Cloudinary images; the LLM chooses by description, code measures size and ratio |

## Stages and gates

| stage | who | output | gate checks (code) |
|---|---|---|---|
| **prepare** | code | `prepared.json`: cleaned text, sections `s01…`, image catalog with sizes and ratios, slide budget | G0: input contract, pack installed, images reachable, enough source |
| **chapter-plan** | LLM | `chapter-plan.json`: 5 lectures → section ids, goals, recap/preview | G1: every section exactly once, reading order, balance ±25/40 %, recap/preview rules |
| **slide-plan** | LLM | `slide-plan.json`: slide types, titles, key points, source refs, image ids | G2: count within budget, known types, pack counts and flow, **image fits or automatic fallback to an image-free type**, invented image ids cleared |
| **slide-write** | LLM (3–4 slides per call) | `slides.json`: template data | G3: template schema (character limits), spec word limits and item counts, MCQ/assertion rules, KaTeX parses, numbers present in the cited source |
| **narrate** | LLM (3–4 slides per call) | `narration-hi.json`: Hinglish voice-over with `{{markers}}`, written directly | G4: exact marker set, in order, spaced out; word range per type (×1.1 for Hinglish); question pause; no SSML or markdown; slide not read aloud verbatim; **and the Hinglish script checks**: no romanized Hindi, no Devanagari-spelt English, script mix, nothing unspeakable |
| *hinglish* | *LLM, only in `narration.mode: via-english`* | *English draft → `narration-hi.json`* | *G5: markers unchanged, sentence and length parity, same script checks. Off by default: it costs ~25–30% more LLM usage* |
| **review** | LLM | `review.json`: findings only | G6: FACT / ANSWER / LEVEL errors block; quality issues warn |
| **assemble** | code | `content.json` (Content JSON v1) | C1: contract |
| **voice** | TTS | `voice/sNN.wav`, `voice.json` with marker times | A1: clips decode, words-per-minute plausible, no dead air, lecture length in band |
| **build** | code | `project.json`, `cues.json`, `voice/track.wav` | A2: every cue inside its scene, in order, exactly `reveal_lead` before speech; project validates against the templates |
| **render** | Chromium + ffmpeg | `lecture.mp4` | — |
| **qa** | code | `qa.json` | V1: streams, 1920×1080, 25 fps, duration, no black frames, **every reveal changes pixels on screen** |

**Repair:** when a gate fails, the LLM gets the validator's exact messages plus its previous answer, and fixes only the failing unit (a whole plan, or individual slides). This repeats up to `llm.repair_attempts` times. Whatever still fails stops that lecture, and the failure is added to `review-queue.json`. The other lectures carry on.

## Trigger timing

The LLM never writes timestamps or copies trigger phrases. It places markers (`{{b1}}`, `{{b2.1}}`, `{{b1.2.1}}`) in the narration, and code derives everything else from them:

1. **Which markers a slide needs.** The template's `meta.slide.reveal` spec and the slide's actual data decide this. G4 enforces the exact set and order.
2. **When each marker is spoken** (`src/sound/`):
   - **segments** (Sarvam): each marker's piece of narration is voiced separately, and the pieces are joined with `tts.gap_ms` of silence. A marker's time is the sample offset of its piece.
   - **marks** (Google, ElevenLabs): the engine returns the marker times itself.
3. **Where the cue goes** (`src/build/project.js`): cue = scene narration start + marker time − `reveal_lead`. The audio track is built from the same scene offsets, so audio and reveals cannot drift apart. A2 then re-checks every cue.

## Job folder

```
jobs/<chapter_id>/
  input.json prepared.json chapter-plan.json status.json review-queue.json llm.jsonl
  reports/<stage>.json
  L1/ … L5/
    slide-plan.json slides.json narration-hi.json (+ narration-en.json in via-english) review.json content.json
    voice.json voice/ cues.json project.json assets/ lecture.mp4 qa.json
    reports/<stage>.json
    <stage>.draft.json          output of a stage whose gate failed (for inspection)
jobs/.cache/{llm,tts}/          responses cached by content hash (re-runs cost nothing)
```

A stage whose output exists is reused. `--from <stage>` deletes that stage's output and everything downstream (for the selected lectures), then re-runs from there.

## Code map

```
src/
  pipeline/run.js store.js      stage runner, resume, reports, review queue
  generation/
    prepare.js                  L0 (code): clean, sectionize, measure images, budget
    prompts.js                  assembles prompts/ modules + generated catalog/specs
    layers/                     L1 chapter-plan · L2 slide-plan · L3 slide-write · L4 narrate · L6 review
                                (L5 hinglish only in narration.mode via-english)
    repair.js assemble.js
  validators/generation.js      G0–G6
  validators/media.js           A1 A2 V1
  validators/text.js            word/sentence/script measures
  slides.js                     meta.slide → LLM schema, checks, markers, cues, catalog
  llm/                          openai.js (Structured Outputs) · mock.js · cache + call log
  sound/                        providers/{sarvam,google,elevenlabs,mock} · spoken.js · wav.js · track.js
  build/project.js              Content JSON + voice → render project + track
  render.js qa.js               render engine entry · final QA helpers
  contracts/                    JSON Schemas for every hand-off
  curriculum/                   packs ↔ subjects, class bands, slide budget
prompts/                        _base · language · profiles/cbse · steps · packs/<pack>/
templates/<pack>/               pack.json + one folder per slide template (meta.slide spec)
config/default.yaml             every tunable, overridable in config/local.yaml
```

## Installed packs: biology, physics, chemistry

The Physics and Chemistry decks use the biology design system, so slides that look the same **reuse the biology template**. Each is a two-line `template.jsx` that re-exports it; the template build gives it the base template's styles, scoped to its own id. New designs from the PDFs:

| slide type | template | PDF page |
|---|---|---|
| `definition` | `physics/definition`: definition + table + **formula box** (formula, symbol key) | Physics 2–3 |
| `derivation` | `physics/derivation`: step cards S1… joined by arrows, goal equation, figure | Physics 7 |
| `solved_example` | `physics/numerical`: PROBLEM, steps, **FINAL ANSWER** card | Physics 11 |
| `formula_sheet` | `physics/formula-sheet`: layout picked by count (12 tiles + symbols / 6 wide + symbols / 4 full-width) | Physics 15–16, Chemistry 17–19 |
| `descriptive_answer` | `chemistry/board-answer`: PROBLEM → REASONING → KEY TAKEAWAY, optional figure | Chemistry 12–13 |

Chemistry re-exports the Physics implementations (with chemistry-specific planner hints, e.g. `\ce{}` equations in the formula box). Physics re-exports the Chemistry board answer. Chemistry variants (organic / inorganic / physical) add `prompts/packs/chemistry/variants/<variant>/notation.md`. Every lecture must include a recap, either `quick_revision` or `formula_sheet` (`pack.json` `includesAnyOf`).

## Models and voice (config/default.yaml)

- **LLM:** `gpt-6-luna` writes everything and `gpt-6-sol` reviews (`llm.models.review`). This was chosen by a bake-off on real lectures:
  - gpt-5-mini wrote English-heavy "Hinglish".
  - gpt-5.6-luna made a factual error.
  - luna reviewing itself left real issues open.
  - The chosen setup cost **≈ $0.025 per lecture** (4,425 lectures ≈ $110), and every call's cost is logged in `llm.jsonl`.
  - Current OpenAI models take `reasoning_effort`, not `temperature`.
- **Review → fix:** reviewer findings on specific slides trigger a rewrite of those slides and a second review (`llm.review_repair_rounds`). Only what still fails reaches the review queue.
- **TTS:** Sarvam `bulbul:v3`, speaker `shubh`, pace 0.9, 2,400 characters per request (the API limit is 2,500). Keys live in `.env`.

## Adding a pack (mathematics, commerce, theory)

1. **Templates:** `templates/<pack>/<slide>/template.jsx + style.css + example.json` (see `templates/README.md`). Each template's `meta.slide` declares its slide type, fields and limits, image rule and reveal order.
2. **`templates/<pack>/pack.json`:** per-type min/max per lecture, flow rules and image-free fallbacks (copy `templates/biology/pack.json`).
3. **Prompts:** `prompts/packs/<pack>/role.md`, `notation.md`, `slide-usage.md`, `flow.md`, and `examples/<slide_type>.json` (data + marker narration). Variants go in `prompts/packs/<pack>/variants/<variant>/<same names>.md`, which are appended after the pack's own.
4. **Check:** `hvr packs` lists it, `hvr prompt slide-plan --pack <pack>` shows what the LLM will read, and `hvr run <chapter> --mock` exercises every gate.
