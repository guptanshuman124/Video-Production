# Chapter summary videos

One revision video per chapter, about an hour long, made from **all of the chapter's lectures at once**. It has its own pipeline, prompts, gates, queue, dashboard page and library folder. It is drawn with the same subject templates as the lecture videos, but in the **dark theme**. Lecture videos keep the sky-blue theme.

```
chapter (all lectures) ─► prepare ─► outline ─┬─► P1 … Pn, in parallel:
                           (S0)       (S1)    │   plan ─► write ─► narrate ─► review (+ fixes)
                                              │   (S2)    (S3)     (S4)       (S5)
                                              └─► assemble ─► voice ─► build ─► render ─► qa
                                                   (C1)       (A1)     (A2)     (R1)     (V1)
```

## Stages

| stage | who | output | gate (code) |
|---|---|---|---|
| **prepare** | code | `prepared.json`. Every lecture is prepared as for its own video; sections are renamed `L<n>.sNN` and figures are pooled. Sets the length and slide budget. | S0: course mapped, pack installed, lectures present, ≥ 300 words |
| **outline** | LLM, **the whole chapter in one call** | `outline.json`: 3–8 parts, each with sections, minutes, 6–12 key points and must-include items | S1: every section in exactly one part, NCERT order, titles and key points present. Minutes are scaled to the video length, and each part gets its slide budget |
| **plan** | LLM, per part | `P<k>/plan.json`: slides drawn from the subject pack's types, minus intro/hook/try-this/practice | S2: count in budget, sources inside the part, figures real and fitting (auto-fill, fallback), per-type max and same-type runs, part ends on a recap or check, last part ends on ≥ 2 questions (MCQs are added when there is room) |
| **write** | LLM, per part | `P<k>/slides.json` | S3: the shared per-slide content gate (schema, word limits, LaTeX, numbers in source, accounting balances…) |
| **narrate** | LLM, per part | `P<k>/narration.json`: title card (part 1), part divider, content slides | S4: the shared narration gate (markers, length, question pause, script of the course's language) |
| **review** | LLM, per part | `P<k>/review.json` | S5: FACT / COVERAGE / ANSWER findings are **repaired**, up to `summary.review_rounds` (3) rounds. Each finding goes to its slide; a part-level finding goes to the slide it is most about. A missing figure gets the part's best-matching unused figure, switching the slide to a figure type if needed. Flagged slides are rewritten and re-narrated, and a rewrite that breaks a slide rule keeps the previous version. After the last round, coverage and quality findings stay as warnings, and a slide still wrong on a fact is dropped if the part still closes properly. Only an error with no slide to drop stops the video |
| **assemble** | code | `content.json` (Summary Content v1) | C1: `summary-content-v1` contract |
| **voice / build / render / qa** | shared | `voice/`, `project.json` (`theme: dark`), `summary.mp4`, `qa.json` | A1 (±25 % of the target), A2, V1, the same as lectures |

## Rendering in pieces, across the workers

A summary is about four times as long as a lecture, so it is not rendered in one go. Lectures are unchanged.

1. After the build stage (A2), the job cuts the timeline into **pieces** of `summary.render_piece_seconds` (300 s). It writes `render-plan.json`, reports the plan to the central and frees its worker.
2. The summary shows **Rendering**. Its pieces go into `render_pieces`, and **any free worker claims a piece**. Pieces come before new lectures and summaries, so a started summary finishes first. Each piece renders frames `[from, to)` of the same deterministic timeline on fresh browser pages (two per worker), with video only. It writes `pieces/piece-NNN.mp4` and a `.done` marker into the summary's folder on the shared work volume.
3. A piece whose worker dies or stops responding goes back to the queue alone. After 3 failed attempts the summary fails, naming the piece.
4. When the last piece is done, the summary is queued at the front again. Its job joins the pieces with a stream copy, muxes the voice track once, runs QA (V1) and uploads the video.

Memory per worker stays the same however long the summary is (the 87-min render that was OOM-killed three times on one worker). More workers render faster: scale them on the Workers page.

## Length

`summary.target_minutes` (60) is the length asked for. A summary is never longer than the chapter's lectures together (their own target minutes × `max_share_of_lectures`). A chapter whose lectures add up to 36 minutes gets a 36-minute summary, not a padded hour. The slide budget is minutes ÷ `summary.slide_minutes`.

## Slides only summaries have

- `summary/title`: the opening card. It shows the chapter, class and subject, a CHAPTER SUMMARY pill, the running time, and the list of parts (each revealed as the narration names it).
- `summary/part`: the divider that opens each part ("Part 2 of 5", the title, and the lectures it brings together).

Both are filled in by code (`src/summary/assemble.js`); the model only narrates them. Their labels switch to Hindi for Hindi courses.

## In the factory

- **Dashboard → Summary videos.** It shows every chapter by class and subject, its state, and *Create summary* / *Create all in subject*. It also has a pause switch for the summary queue and *Retry failed*. A details drawer shows each stage with per-part dots, issues, cost and activity, and there is a player.
- **Queue.** Workers claim from one endpoint. The central hands out the lecture or the summary that comes first by priority, then by the time it was queued. A paused summary queue is skipped.
- **Storage: two trees, the same folders.**
  - OneDrive: lectures in `CBSE Lectures/` (`SHAREPOINT_ROOT`), summaries in `CBSE Summaries/` (`SHAREPOINT_SUMMARY_ROOT`).
  - The local library uses the same two folder names.
  - Both trees go `Class N/Subject/[Book/]Chapter K - Title/`. A lecture is `Lecture M - Title.mp4` and the summary is `Chapter K - Title - Summary.mp4`, so the summary sits in the same chapter folder in its own tree.
- **Library page.** A toggle switches between lecture videos and summary videos. The Workers and Queue pages show running summaries, and clicking one opens its details.
- **Tables.** `summaries`, `summary_events` and `summary_videos` in the `factory` DB (`src/factory/db.js`). The code is in `src/factory/summaries.js`, `summary-job.js`, and `worker.js` (`KINDS`).

## CLI

```bash
hvr summary --source db --module 338            # one chapter's summary video
hvr summary --source db --module 338 --mock --to build   # no keys, no cost: every gate, up to the render project
hvr template summary/title --snap --theme dark  # a still of the title card
```

## Code map

```
src/summary/
  input.js      chapter → summary input (all lecture inputs), S0 checks
  prepare.js    S0: pooled sections + figures, length, budget
  gates.js      S1 outline, S2 part plan
  prompts.js    the summary's prompt layers (prompts/summary/*.md + pack modules + language)
  layers/       outline · plan · write · narrate · review
  assemble.js   title card, part dividers, Summary Content v1
  run.js        the stages, per-part chains in parallel, review fixes, voice/build/render/qa
prompts/summary/  role · outline · planner · writer · narrator · reviewer
templates/summary/ title · part
```
