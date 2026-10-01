# TASK — SLIDE PLANNER

Plan the slides for **lecture {{lecture}} of {{lectures}}**: "{{lecture_title}}". Decide which slide types, in which order, and which content each one carries. Do not write slide text yet — later steps do that from your plan.

First give `lecture_title`: a clean title for this lecture, at most 8 words (fix spelling, drop section numbers and "Lecture 1:" prefixes).

**Slide count: {{slide_min}}–{{slide_max}} teaching slides**, plus the opening slides below (each teaching slide carries about 1.5–2 minutes of narration; this lecture targets ~{{lecture_minutes}} minutes).

**Opening (fixed):**
- Slide 1 is always `intro`, a title card (chapter name, "Lecture N: title") filled in entirely by code. Plan it with an empty `key_points` list, no image and no source refs.
- Slide 2 goes straight into the first topic of this lecture. There is no roadmap, overview or recap slide.

For each slide give:
- `slide_type` — one of the types in the SLIDE TYPES list, chosen by what the content actually is.
- `title` — the on-screen title, at most 8 words.
- `purpose` — one line: what the student should get from this slide.
- `key_points` — the specific facts from the source this slide carries (2–6 short points). These are what the writer will use, so be concrete.
- `source_refs` — the section ids (from this lecture's sections only) the slide is built from.
- `image_id` — the catalog figure this slide shows, or null.

**Use the figures.** The IMAGE CATALOG lists the real textbook figures for this lecture (experiment setups, apparatus, diagrams, graphs, photos). Students learn much better when they see them:
- Every catalog figure that illustrates something this lecture teaches should appear on a slide. Match by the description: a figure of "the electrolysis of water" belongs on the slide that teaches electrolysis.
- Give a figure its own `labeled_diagram` slide when it deserves to be read part by part, or put it on an `image_points` / `mechanism` slide beside its explanation, or as the picture on a `definition`.
- Only leave `image_id` null when no catalog figure relates to that slide. Never put an unrelated figure on a slide.
- A type that **needs** an image may only be used with a catalog figure.
- Stay inside the per-type limits and the same-type run limit (FLOW RULES) while doing this. When a lecture has more figures than one type allows (e.g. six ray-diagram cases), spread them over `labeled_diagram` and `image_points` (both show wide figures) and `mechanism`, alternating so no type runs more than the limit in a row; if there are still more figures than slots, show the ones that teach most and describe the rest in words.

**Make it visual — safely.** Students remember what they see, but a picture must never teach something wrong:
- A process, sequence, cycle or chain of causes in the text (stages, the steps of a method, a cycle) with no catalog figure for it → a `process_flow` slide: 3–6 boxes joined by arrows, drawn by code from the facts you plan.
- A real-life example, application or hook the text mentions (an everyday object, place, activity or situation) → an `illustration` slide, when seeing it genuinely helps a student connect the idea to their world. At most 2 per lecture, and never where the picture would have to be exact (a structure with parts, apparatus, a circuit, an experiment set-up, a map, a graph, a specific famous person or monument) or where the picture itself would have to show a scientific effect correctly (light bending, the colours of a spectrum, a reaction happening): those stay on catalog figures or in text. The picture sets the scene; the teaching is in the points.
- When a catalog figure shows the same thing, use the figure.

Rules:
- Cover every section of this lecture; follow NCERT order.
- Choose types honestly: do not force content into a type it cannot fill (e.g. no `characteristics` slide from fewer than 4 real points; no `comparison` without two genuinely compared things).
- Follow the FLOW rules for where this lecture sits in the chapter.
