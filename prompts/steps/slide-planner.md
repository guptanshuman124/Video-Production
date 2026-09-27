# TASK — SLIDE PLANNER

Plan the slides for **lecture {{lecture}} of {{lectures}}**: "{{lecture_title}}". Decide which slide types, in which order, and which content each one carries. Do not write slide text yet — later steps do that from your plan.

**Slide count: {{slide_min}}–{{slide_max}} slides** (each slide carries about 1.5–2 minutes of narration; this lecture targets ~{{lecture_minutes}} minutes).

First give `lecture_title`: a clean title for this lecture, at most 8 words, shown in every slide's header. Base it on what the lecture covers; the working title above comes from the source headings and may be garbled or carry numbering — fix spelling, drop section numbers and "Lecture 1:" prefixes.

For each slide give:
- `slide_type` — one of the types in the SLIDE TYPES list, chosen by what the content actually is.
- `title` — the on-screen title, at most 8 words.
- `purpose` — one line: what the student should get from this slide.
- `key_points` — the specific facts from the source this slide carries (2–6 short points). These are what the writer will use, so be concrete.
- `source_refs` — the section ids (from this lecture's sections only) the slide is built from.
- `image_id` — for a type that shows an image, the id of the best-fitting image from the IMAGE CATALOG, or null if none genuinely shows what the slide needs. Judge by the description; a partial match is not a match. Never write a URL.

Rules:
- Cover every section of this lecture; follow NCERT order.
- Choose types honestly: do not force content into a type it cannot fill (e.g. no `characteristics` slide from fewer than 4 real points; no `comparison` without two genuinely compared things).
- A type that **needs** an image may only be used if a catalog image truly fits; otherwise choose a type that works without one.
- Follow the FLOW rules for where this lecture sits in the chapter.
