# Slide templates

**Biology deck:** page-by-page catalog in [BIOLOGY.md](BIOLOGY.md) (`bio-01` … `bio-15`).

Every folder here is one reusable 1920×1080 slide. It's written in JSX and styled with scoped CSS, and a project fills it with JSON data. The folder name is the template id. Folders starting with `_` are not registered.

```
templates/
  _lib/index.js          JSX runtime + helpers (import from 'hvr')
  _shared/global.css     brand fonts + colour tokens, loaded for every template
  _shared/components.jsx <Header>, <SlideTitle> (import from 'hvr/shared')
  _shared/fonts/         vendored Inter + Poppins (latin woff2, OFL)
  _shared/assets/logo.*  brand logo (extracted from the Prepzy PDF); used by <Header>
  _starter/              scaffold copied by `new-template`
  <id>/
    template.jsx         required: meta, schema, animations, default render fn
    style.css            optional: auto-scoped to this template, native nesting
    global.css           optional: unscoped (@font-face, @keyframes)
    example.json         optional: sample data for --snap and the docs
    reference.png        optional: the design this template reproduces
    *.png / *.svg …      optional: images imported by the JSX/CSS (inlined)
```

## Commands

```bash
node src/cli.js templates                          # list the registry
node src/cli.js template <id>                      # data fields + ready-to-paste scene JSON
node src/cli.js template <id> --snap               # example data -> out/template-<id>.png (settled frame)
node src/cli.js template <id> --snap --at 0,300,900   # frames at ms after the entrance, to check motion
node src/cli.js new-template <id>                  # scaffold templates/<id>/
node src/cli.js snap <project.json> --scene 3      # still of one scene in a real project
```

## Using a template in a project

Template scenes and the built-in `layout` scenes can be mixed freely in one project:

```jsonc
{
  "template": "title-hero",                               // folder name
  "duration": 6000,                                       // optional, defaults to meta.duration
  "transition": { "name": "dissolve", "duration": 700 },  // same transitions as layouts
  "data": { "title": "How plants eat *light*" }           // validated against the schema
}
```

Project-level `"shared": { "lecture": "…" }` fills that field in every template scene that declares it and leaves it unset. That way the lecture name is written once per project.

A scene with `"exit": false` skips its exit animations, so its content stays on screen through the outgoing transition.

Before anything renders, `data` is checked against the template's `schema`. Errors name the scene and field, for example `scene 3 (title-hero) data.items[1].label: required`. Unknown keys are errors, so typos surface. Keys starting with `_` are comments and are dropped.

## Writing `template.jsx`

```jsx
import { Rich, pad, cx } from 'hvr';

export const meta = { name: 'Title hero', description: 'Big title + subtitle', duration: 6000 };

export const schema = {
  title:    { type: 'text', required: true, max: 80 },
  subtitle: 'text',                                    // shorthand; 'text!' = required
  align:    { type: 'enum', values: ['left', 'center'], default: 'left' },
  image:    'image',
  points:   { type: 'list', min: 1, max: 5, of: { label: 'text!', value: 'number' } },
};

export const animations = {                            // optional, local to this template
  riseSpin: { dur: 800, ease: 'back', kf: [{ opacity: 0, transform: 'rotate(-8deg) translateY(40px)' },
                                           { opacity: 1, transform: 'none' }] },
};

export default function Slide(d) {                     // d = validated data, defaults applied
  return (
    <div className={cx('frame', `align-${d.align}`)}>
      <h1 anim="words" stagger={50}><Rich text={d.title} /></h1>
      {d.subtitle && <p anim="fadeUp" delay={300}>{d.subtitle}</p>}
      <ul stagger={120} delay={500}>
        {d.points.map((p, i) => <li anim="fadeLeft">{pad(i + 1)} {p.label}</li>)}
      </ul>
    </div>
  );
}
```

JSX compiles to real DOM once per scene. There is no React, no state and no re-rendering. `className`, `style={{…}}` (numbers become px), SVG elements, `ref={el => …}` and `html={trustedMarkup}` all work.

For rules a schema can't express, export `check(data)` returning a list of error strings. The template is still valid if nothing is returned. For example, `comparison-table` checks that every row has one cell per column.

### Schema types

| type | notes |
|---|---|
| `text` | string or number; `max` chars. Rendered with `<Rich>` / `rich()`: `*x*` gives an accent span, `**x**` gives `<strong>`, `$…$` gives a KaTeX formula and `$\ce{…}$` a chemical equation |
| `number` | `min`, `max` |
| `boolean` | |
| `enum` | `values: [...]` |
| `color` | any CSS colour string |
| `image` | path relative to the **project file** (checked to exist), or a URL |
| `list` | `of: <spec>`, `min`, `max` |
| `object` | `fields: {...}`, or write the fields map directly as the spec |
| `any` | unchecked |

Every spec can also take `required`, `default` and `description`. `description` is shown by `hvr template <id>`.

### Animation props

These props work on any element. Delays are in ms from the moment the scene's entrance transition finishes.

| prop | meaning |
|---|---|
| `anim="fadeUp"` | preset name. The template's own `animations` are checked first, then `stage/anims.js` |
| `anim={{ kf, dur, ease }}` | one-off inline keyframes |
| `delay={200}` `dur={600}` `ease="out"` | timing overrides. `ease` is a name from `EASE` or any CSS easing |
| `stagger={120}` | on a parent: children start at `delay + i×stagger` (nests with the child's own `delay`) |
| `anim="words" stagger={50}` | per-word reveal of the element's text |
| `anim="countTo" count={42} countDur={1200}` | count up; give the element `className="count"` |

**Exits.** These run at the end of the scene and finish just as the outgoing transition starts:

| prop | meaning |
|---|---|
| `exit="fadeOut"` / `exit={{ kf, dur, ease }}` | exit preset or inline keyframes |
| `exitDelay={300}` | finish this many ms *before* the out point |
| `exitDur` / `exitEase` | timing overrides |
| `exitStagger={70}` | on a parent: children leave first-to-last, the last finishing at `outPoint − exitDelay` |

Exit presets: `fadeOut` `fadeOutUp` `fadeOutDown`. `hvr snap` and `--snap` shoot the settled frame, which is just before the first exit starts.

Global presets: `fadeIn` `fadeUp` `fadeDown` `fadeLeft` `fadeRight` `scaleIn` `zoomIn` `popIn` `blurIn` `slideUp` `clipWipe` `clipUp` `clipDown` `clipLeft` `irisIn` `lineGrow` `growY` `draw` `figIn` `countTo`, plus `words`.

`draw` animates SVG strokes and needs `pathLength="1"` and `style={{ strokeDasharray: 1 }}` on the shape.

Everything runs on the renderer's paused, seekable Web Animations clock. **Never use CSS `animation`/`transition`, `setTimeout` or `requestAnimationFrame` for motion.** They are not frame-accurate and will stutter or be skipped in the render.

### Brand layer

`_shared/global.css` defines the tokens every template should use instead of raw values:

- `--brand-navy` `--brand-orange` `--brand-ink` `--brand-body` `--brand-muted`
- `--brand-bg` `--brand-rule` `--brand-surface` `--brand-surface-alt` `--brand-surface-head`
- `--font-display` (Poppins) and `--font-body` (Inter)
- `--frame-left` and `--frame-right`

`hvr/shared` also provides these components:

- `<Header lecture logo />` and `<SlideTitle text />` both fade in at the start and out at the end.
- `<Panel image caption fit />` is the image placeholder box.
- `<Bullets items />` renders a bullet list.
- `cue()` and `sec()` convert narration cue seconds to milliseconds.
- `stateAnim('correct' | 'wrong')` is the MCQ answer-state keyframe set.

A template can also declare `meta.aliases` (e.g. `['bio-05', 'bio-06']`) and `meta.number`, so projects can address it by page number.

Class names are safe to keep short: the built-in layout styles in `stage/theme.css` are fenced off with `@scope (.scene:not(.tpl))` and never reach template slides.

### Styling

`style.css` is wrapped in `[data-template="<id>"] { … }`, which is the scene's 1920×1080 `<section>` itself. Declarations at the top level of the file style the frame, for example `background: #fff;`. Nested rules only reach this template. The frame has no padding and white background by default, so lay things out absolutely or with your own container.
