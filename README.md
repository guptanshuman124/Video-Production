# html-video-renderer

Render animated HTML layouts to video. Chromium draws the frames, ffmpeg encodes them.

Slides are **static compositions** — the only motion is per-element entrance animation and the
slide-to-slide transition. The renderer knows this and only screenshots the moments where pixels
actually change; the rest of the timeline is the previous frame re-piped to ffmpeg.

```bash
npm run render                 # projects/lesson.json -> out/final.mp4 (4K)
node src/cli.js render projects/lesson.json --draft    # 1080p, fast, for iterating
node src/cli.js preview projects/lesson.json           # headed browser + scrub bar
node src/cli.js probe projects/lesson.json             # print the timeline
```

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

For `projects/lesson.json` that is 19.1s of motion in a 35.5s video — 46% of frames are held rather
than shot.

**Authoring at 1080p, rendering at 4K.** The viewport is 1920×1080 CSS px at `deviceScaleFactor: 2`,
so layout CSS is written in familiar units while text and vectors rasterize at 2×. `--draft` drops
the scale factor to 1 and changes nothing else.

## Project format

```jsonc
{
  "title": "...",
  "video": { "width": 1920, "height": 1080, "scale": 2, "fps": 30 },
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
| `--crf` / `--preset` | 18 / `slow` | x264 |
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

Three independent optimisations stack. Rendering `projects/flat.json` (11.1s, 333 frames, 4K):

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
