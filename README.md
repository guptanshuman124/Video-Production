# Lecture Factory

Produces the CBSE lecture videos (Classes 6–12, English slides, Hinglish voice-over, 1080p25), class by class, on a local Kubernetes cluster.

```
                     ┌──────────────── Kubernetes (kind, inside Docker Desktop) ────────────────┐
 prepzy-mysql ─copy─▶│ factory-db (MySQL)  tutorai = source copy · factory = queue/jobs/videos  │
 (this PC)           │      ▲                                                                   │
 browser ──:8080────▶│ central   backend + scheduler + dashboard on one port                    │
                     │   │  ▲    final validation → Videos\Prepzy Lectures\Class …\Lecture N.mp4 │
                     │   ▼  │                                                                   │
                     │ worker ×4  generation + validation → voice → render → QA → upload        │
                     │            → working files deleted once the video is stored              │
                     └──────────────────────────────────────────────────────────────────────────┘
```

## Run it

```bash
npm run factory -- up        # first time: creates the cluster, builds the image, deploys (Docker Desktop must be running)
```

Then open **http://localhost:8080**.

1. Open a class and press **Start**. Its lectures are queued in course order (subject → chapter → lecture), and the 4 workers make 4 lectures at a time.
2. Follow each worker live: stage, progress, gate results. Pause or resume a class queue, press **Run next** on a lecture, stop or remove one.
3. Lectures that fail a validation gate (after automatic repair) land in **Needs attention**. Retry them from the failed stage, from a stage you choose, or from scratch.
4. Finished videos pass a final check in the central (ffprobe, 1080p, audio, duration versus the worker's QA). They're uploaded to **OneDrive / SharePoint** (site VideoArchive, library Documents) as `CBSE Lectures/Class 10/Science/Chapter 1 - …/Lecture 3 - ….mp4`, and recorded in the `videos` table. The Library plays them straight from there. The local copy in `Videos\Prepzy Lectures` is only a staging area and is deleted once the upload succeeds (`LIBRARY_KEEP_LOCAL=true` keeps it). The worker deletes that lecture's images, audio and frames as soon as the central has the video.

```bash
npm run factory -- deploy    # after code or template changes: rebuild the image, restart central + workers
npm run factory -- status    # pods + URLs
npm run factory -- logs central     # or: logs worker, logs db
npm run factory -- down      # delete the cluster (videos stay on disk)
```

- **Secrets** come from `.env`: `OPENAI_API_KEY`, `SARVAM_API_KEY` and `TEXTBOOK_DB_URL`, which is the prepzy-mysql URL on this PC. The cluster reaches it through `host.docker.internal`. OneDrive needs `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and `SHAREPOINT_SITE_URL` (optionally `SHAREPOINT_ROOT`); without them videos stay local. After changing `.env`, run `npm run factory -- deploy`.
- **Uploads:** 2 at a time, 3 tries each. A failed upload keeps the local file; retry it from the lecture's details or from **Source & settings**. Uploads that were pending when the central restarted resume on start.
- **Source data:** on first start the central copies the tutorai tables from prepzy-mysql into the cluster database (about 7 s). Copy them again from **Source & settings** after the course tables change.
- **Scale:** change **Parallel lectures** on the Workers page (or `replicas` in `deploy/k8s/factory.yaml`). Each worker renders with 2 Chromium workers and sends 2 Sarvam requests at a time. Docker Desktop gives Kubernetes 8 GB by default, which fits about 4 parallel lectures.
- **Library folder:** `FACTORY_LIBRARY` overrides it when the cluster is created. A subject with more than one book (Physics Part I / II) gets a book folder between subject and chapter.
- **Templates:** today Science (Classes 6–10), Physics, Chemistry and Biology (1,031 lectures) can be produced. Other subjects are listed on the dashboard and become available when their template pack is installed (`templates/<pack>/`).

Code layout: `src/factory/` (central, worker, job runner, catalog, source sync, DB), `web/` (dashboard, React + Vite), `deploy/` (Kubernetes manifests + setup script). The generation pipeline is documented in **[docs/PIPELINE.md](docs/PIPELINE.md)**.

## Pipeline and renderer (CLI)

The same pipeline runs outside Kubernetes for development:

```bash
node src/cli.js lectures --source db --course 29 --lecture 379      # one lecture → jobs/c29/m83/l379/lecture.mp4
node src/cli.js templates                                           # list registered templates
node src/cli.js template <id> --snap                                # render a template's example data to PNG
npm run web:dev                                                     # dashboard with hot reload (API proxied to :8080)
```

Slides are reusable 1920×1080 templates written in JSX, each with its own schema and animations, and filled from JSON (`{ "template": "<id>", "data": {…} }`). See [templates/README.md](templates/README.md). Chromium draws the frames and ffmpeg encodes them. Slides are static compositions whose only motion is element entrances and slide transitions, so the renderer only screenshots the moments where pixels change.

## How it works

**One timeline, no realtime playback.** All scenes live in the DOM at once as stacked `<section>`s.
Every animation is created through the Web Animations API `paused`, with `fill: 'both'` and a delay
equal to its absolute position on the global timeline. `__seek(t)` pins `currentTime` on all of them.

Nothing is driven by `requestAnimationFrame` or the wall clock during a render, so frame *N* is
identical no matter how long the previous screenshot took. A slow disk cannot desync the animation.

`fill: 'both'` also means scene visibility falls out of the timeline for free: a scene that hasn't
started holds its first keyframe, one that has finished holds its last. There is no show/hide logic.

**Motion-interval capture.** The runtime reports the merged union of every window where something is
animating. Frames inside those windows are seeked and screenshotted; frames outside are the previous
PNG buffer written to ffmpeg's stdin again — no second screenshot, no disk round-trip, and x264
encodes the duplicates almost for free.

```
scene 1 enter   hold        transition   scene 2 enter   hold
|███████████|░░░░░░░░░░░░|████████████|███████████|░░░░░░░░░░░|
 capture      freeze        capture      capture    freeze
```

For a typical short project that is 19.1s of motion in a 35.5s video — 46% of frames are held rather
than shot.

**Authoring and rendering at 1080p.** The viewport is 1920×1080 CSS px at `deviceScaleFactor: 1`.
Pass `--scale 2` (or set `"scale": 2`) to rasterize at 2× for 4K output. `--draft` forces
the scale factor to 1.

## Project format

```jsonc
{
  "title": "...",
  "video": { "width": 1920, "height": 1080, "scale": 1, "fps": 25 },
  "fadeIn": 600, "fadeOut": 800,        // fade from/to black
  "audio": "narration.m4a",             // optional; muxed only if the file exists
  "scenes": [
    {
      "layout": "title",                // title | bullets | stat
      "duration": 5400,                 // ms this scene occupies, transition included
      "transition": { "name": "pushLeft", "duration": 750 },
      "headline": "How plants eat *light*"   // *stars* mark accent-coloured text
    }
  ]
}
```

Scenes overlap by their transition duration, so total runtime is
`sum(durations) - sum(transitions after the first)`. `probe` prints the resolved timeline; the loader
rejects a scene whose in+out transitions exceed its own duration.

### Layouts

| layout | fields |
|---|---|
| `doc` | `kicker`, `brand`, `headline`, `lead`, `groups[][]` (or `items[]`), `figure: { src, caption }` |
| `title` | `kicker`, `badge`, `headline`, `sub`, `foot`; `variant: "statement"` for a pull quote with `attrib` |
| `bullets` | `kicker`, `headline`, `items[]` of `{ chip, title, detail }` |
| `stat` | `kicker`, `headline`, `stats[]` of `{ count \| value, unit, label, countDur }`, `note` |

`doc` is the flat lesson-slide layout: white paper, header rule, accent-barred title, text column and
an optional figure. Set `"theme": "light"` on the scene. `figure.src` is resolved relative to the
project file and served under `/__assets/`. Images are decoded before frame 0, so a figure never
pops in late.

### Animations

Element presets (`stage/anims.js`), set per element in a layout via `data-anim`:
`fadeIn` `fadeUp` `fadeDown` `fadeLeft` `scaleIn` `blurIn` `clipWipe` `clipUp` `lineGrow` `countTo`,
plus `words` for a per-word reveal. Tune with `data-delay`, `data-dur`, `data-ease`, and
`data-stagger` on a container to cascade its children.

Transition presets (`stage/transitions.js`): `cut` `dissolve` `pushLeft` `pushUp` `maskWipe`
`scaleBlur`. A `cut` is a one-frame dissolve, so a hard cut costs nothing special.

`countTo` animates a registered `@property --num` and renders it through a CSS counter, which keeps
digit counting on the same deterministic clock as everything else instead of needing a JS ticker.

## Flags

| flag | default | notes |
|---|---|---|
| `--draft` | off | 1080p, crf 26, `veryfast`, jpeg capture |
| `--capture` | `png` (`jpeg` in draft) | JPEG q100 measures ~66dB luma PSNR / 0.9998 SSIM against PNG and captures ~37% faster at 4K. Output is yuv420p either way. |
| `--crf` / `--preset` / `--tune` | 18 / `slow` / none | x264; `video.preset` and `video.tune` in the project set the defaults. `--tune stillimage` suits long, mostly held lectures |
| `--fps` / `--out` | from project | |
| `--jobs N` | 1 | parallel workers; each renders a contiguous slice, joined with a stream copy |
| `--all-frames` | off | disable the motion-window optimisation; shoot every frame |

## Performance

Cost per 4K frame is dominated by rasterisation, and that depends almost entirely on what the slide
contains. Measured on this machine (8-core M-series, 8 GB):

| slide | PNG | JPEG q100 |
|---|---|---|
| flat `doc` (solid fills, text, one image) | **220 ms** | 120 ms |
| gradient `stat` (radial gradients, masks, text-clip) | 1068 ms | 635 ms |

Flat slides rasterise ~5x faster. Gradients, blurs, masks and `background-clip: text` are what make a
frame expensive — avoid them in bulk-rendered decks and the renderer gets dramatically cheaper.

Three independent optimisations stack. Rendering a flat 11.1 s test project (11.1s, 333 frames, 4K):

| configuration | time | per frame |
|---|---|---|
| every frame, serial, PNG | 70.7s | 212 ms |
| + motion-window holds (92 of 333 shot) | 25.7s | 77 ms |
| + `--jobs 4` | 14.7s | 44 ms |
| + `--capture jpeg` | **12.2s** | 37 ms |

**5.8x end to end**, same output. Verified against the serial render: identical frame count and
duration, 57.9 dB average PSNR (the residual is per-chunk x264 rate control, not frame drift —
misaligned frames would score in the low 20s).

`--jobs` works because the timeline is deterministic: seeking to *t* always produces the same pixels,
so a worker needs nothing from any other worker. Each renders a contiguous slice to its own file and
they are joined with `-c copy`. Every chunk opens on a real screenshot rather than a held frame, so
the seams are clean. Past the core count it regresses — 6 workers was slower than 4 here, from memory
pressure with several 4K browsers alive at once. Start at half your core count.

## Notes

- **Browser.** `playwright-core` is installed but its matching Chromium could not be downloaded in
  this environment, so `src/stage.js` resolves whichever real browser is present — the cached
  Playwright headless shell first, then system Chrome. Override with `HVR_CHROME`.
- **Backdrops are baked gradients, not `blur()`.** A large blur filter cost ~500ms per 4K screenshot
  for no visible benefit at that softness.
- Screenshots must not use Playwright's `animations: 'disabled'` — it fast-forwards every animation
  to its end state, which would render the whole video in its final pose.
