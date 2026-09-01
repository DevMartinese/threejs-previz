---
name: remotion-previz-render
description: >-
  Render a Three.js / react-three-fiber blocking scene as a Remotion composition:
  project structure, deriving `<Composition>` props from the shot list so duration
  never drifts, the frame-determinism rules that `<ThreeCanvas>` requires
  (useCurrentFrame only, never useFrame; explicit width/height; Sequence
  layout="none"), building the scene once per worker instead of per frame, a
  headless audit gate that blocks a render when a shot cuts the hero off, and the
  render commands for MP4, image sequences and stills, and composing several
  scenes into a longer film — stitched from pre-rendered clips or mounted live,
  with transition arithmetic and cross-scene consistency checks. Use this skill when the
  user wants to turn a Three/R3F previz or animatic into a video file, asks how to
  wire Three.js into Remotion, hits flickering or drift between the Remotion Studio
  preview and the rendered output, needs a motion reference exported for a
  generative video model, or is setting up the project structure for
  code-generated video; or wants to join several scenes into one longer piece and
  keep each independently renderable. Trigger also for "render the animatic",
  "export the previz to mp4", "remotion three setup", "why does my 3D scene
  flicker when rendering", "stitch the scenes together", "make it a longer film".
---

# Remotion Previz Render

Turn a blocking scene into a video file. This skill owns the **output layer**:
project structure, composition wiring, render-time determinism, and the gate that
stops a bad shot from becoming a render.

The scene comes from **blocking-scenes**, the camera paths from **camera-moves**.
Both ship in this plugin and share `lib/`.

## The one structural idea

**The shot list is the single source of truth.** It already knows how many frames
the piece runs; the scene already knows its aspect. Restating `durationInFrames`
in `<Composition>` is how the two drift apart — you extend a shot, forget the
composition, and the render stops mid-move with no error and no warning.

`defineScene()` derives all of it — and `animate` (object motion as a pure
function of the frame) plus `attachments` (declared, measured connections)
ride the same definition, so the audit gate checks the scene exactly as it
renders. One hard-won wiring rule: `<PrevizStage>` mounts `ctx.scene` WHOLE —
R3F's `<primitive>` reparents what it mounts, and mounting groups one by one
silently empties the scene in the browser while Node keeps passing. Remotion
also requires a `tsconfig.json` even in an all-JS project.

`defineScene()` derives all of it:

```js
// src/scenes/roundtable.js  — plain JS, so the audit gate can load it in Node
import { defineScene } from '../../lib/scene.js';
import { moves, reframe } from '../../lib/cameraMoves.js';

export default defineScene({
  id: 'roundtable',
  fps: 30, height: 1080, aspect: 21 / 9, subjectSize: 2.5,
  identity: { grey: '#9a9a9a', wood: '#8a6136' },
  ignore: [['PRP_chair_*', 'CHR_*']],

  // Optional: the knobs this scene opens, each with the range it is still
  // itself inside. They reach build/animate/shots as `p`, resolved once at
  // build time, so the scene stays a pure function of (params, frame).
  params: {
    tableRadius: { value: .9, min: .5, max: 1.4, step: .02, unit: 'm' },
    orbit: { value: 5, min: 3, max: 7, step: .1, unit: 'm' },
  },

  build: ({ ctx, geo, p }) => {
    ctx.part('ENV_floor', geo.disc({ radius: 8 }), 'grey', ctx.groups.ENV);
    ctx.part('PRP_table', geo.table({ radius: p.tableRadius }), 'wood', ctx.groups.PRP);
  },

  shots: (p) => [
    { name: 'SC01_wide', from: 0, to: 450, focalLength: 28, hero: 'PRP_table',
      easing: 'easeInOutSine',
      move: reframe(moves.turntable({ radius: p.orbit, pushIn: .95, target: [0, 0, 0] }),
                    { center: [0, .7, 0] }) },
  ],
});
```

Parameters are optional; without them `build: ({ ctx, geo })` and a plain
`shots` array work exactly as before. With them, `pnpm inspect` generates a
control per knob from the declaration and hands you a command that runs the
gate on the tuned values *and then* renders:

```bash
node lib/auditScenes.mjs src/scenes/roundtable.js --params='{"orbit":6.2}' \
  && remotion render roundtable out/roundtable.mp4 --props='{"params":{"orbit":6.2}}'
```

Both ends refuse an unknown key or an out-of-range value rather than clamping,
and the duration may not vary — `durationInFrames` is read before props exist,
so a knob that shortened the shot list would render a silent freeze past the
end of the move. Never put a knob on a number a brief fixed, or on one that is
derived: in `floors` the hero's height is the integral of the speed profile at
its midpoint, so it is recomputed, never stored.

```jsx
// src/Root.tsx
import { Composition } from 'remotion';
import { sceneComposition } from '../lib/remotion.jsx';
import roundtable from './scenes/roundtable.js';

export const RemotionRoot = () => (
  <Composition {...sceneComposition(roundtable)} />
);
```

`sceneComposition()` merges the derived metadata — `id`, `fps`, `width`, `height`,
`durationInFrames` — with the React component. Nothing is typed twice.

**Why the split between `scene.js` and `remotion.jsx`:** the audit gate has to
import a *real* scene file in plain Node. If `defineScene` lived in a `.jsx` that
pulls in React and Remotion, `node auditScenes.mjs` could not load it, and the
gate could only ever check a hand-written stub — worthless, because the thing you
render would never be the thing you checked. So the definition is plain JS and the
component is separate.

## How to use this skill

1. **Read `references/remotion-pipeline.md`.** Project layout, the determinism
   rules and what each one prevents, the render commands, and the failure modes
   that produce *plausible but wrong* output rather than an error.

2. **Define each scene with `defineScene()`** from `lib/scene.js`. `build()`
   populates the standard groups; `shots` is the timeline. Both are plain data.
   If numbers in the scene are still open questions, declare them in `params`
   (see `references/parameters.md`) rather than editing and re-rendering to
   find them — but never put a knob on a number a brief fixed, or on one that
   is derived from another.

3. **Compose scenes into a film with `defineFilm()` from `lib/film.js`**
   (plain JS — the gate audits the real film file) and bind the component with
   `filmComposition(def, { TransitionSeries, linearTiming, presentation })`
   from `lib/film.jsx` — the kit is injected so lib never hard-depends on
   @remotion/transitions, and declaring transitions without injecting it
   throws at registration instead of silently shortening the film. Verified in
   both modes; composition ids allow no underscores. Compose films when the piece is longer
   than one scene. It derives the duration, including the transition subtraction,
   and checks the things that fail silently between scenes.

4. **Gate the render on the audit.** `lib/auditScenes.mjs` runs every audit
   headlessly — no browser, no GPU, because they are bounding boxes, BVH
   intersections and NDC projection. It exits non-zero on failure, so
   `pnpm audit:scenes && remotion render …` refuses to render a shot that cuts
   the hero off. Measured on this repo: 146 ms for a 900-frame scene, 1.6 s for
   eight definitions and 4032 frames.

5. **Render.** `pnpm render:scene <id>` (audits first, writes `out/<id>.mp4`),
   or `pnpm render:scene <id> out/frames --sequence` for a PNG sequence when the
   output is a motion reference and you want frame-exact control.

## Scenes and films

A **scene** is a unit of work: build it, audit it, render it, stop thinking about
it. A **film** is an *edit* of scenes. Keeping them apart is what lets you change
scene 3 without re-rendering the other five.

```js
export default defineFilm({
  id: 'feature',
  scenes: [intro, roundtable, outro],
  mode: 'stitch',                          // or 'live'
  transitions: { intro: { frames: 15 } },  // keyed by the scene it comes AFTER
});
```

Two modes, and the choice matters more than it looks:

- **`stitch`** (default) — each scene is already rendered to a file; the film
  references them with `<OffthreadVideo>`. Change one scene, re-render only that
  scene, re-stitch in seconds. This is how a real edit works: you cut negatives
  that are already developed.
- **`live`** — the film mounts each scene's component in a `<Sequence>` and
  renders in one pass. No intermediate files, but every scene rebuilds its
  geometry, a WebGL context is mounted and torn down per scene, and any change
  re-renders everything. Fine for two or three short scenes.

Start `live` while the piece is short and you are still moving cuts; switch to
`stitch` when the render starts to hurt.

**Transitions shorten the film.** `<TransitionSeries>` renders both scenes during
a transition and subtracts its length from the total: two 100-frame scenes with a
30-frame dissolve make **170** frames, not 200 and not 230. `defineFilm` does that
arithmetic, and `film.timeline` gives you where each scene starts.

Register scenes *and* the film so both stay renderable:

```jsx
{[...film.scenes, film].map((c) => <Composition key={c.id} {...c.compositionProps} />)}
```

## The four rules `<ThreeCanvas>` enforces

Violating any of these gives flickering or a preview that does not match the
render — not an error message.

- **`useCurrentFrame()` only. `useFrame()` is forbidden.** During rendering
  `<ThreeCanvas>` pins `frameloop` to `never`; anything animating on its own clock
  either freezes or tears.
- **`<ThreeCanvas>` needs explicit `width` and `height`**, from `useVideoConfig()`.
- **Any `<Sequence>` inside the canvas needs `layout="none"`** — its default `div`
  wrapper is not valid inside a canvas.
- **Nothing may hold state between frames.** Remotion renders frames out of order
  across parallel workers. No accumulation, no `Math.random()` — the seeded `rng`
  in `geometry.js` exists for this.

## Build once, not per frame

`build()` runs **once per worker**, inside `useMemo`, never per frame. CSG cuts,
`mergeGeometries` and BVH construction are build-time work; running them per frame
is both slow and a determinism hazard, since a boolean re-evaluated per frame can
produce marginally different triangles.

The camera is the only thing recomputed each frame, and it is a pure function:
`applyFrame(camera, shots, frame)` — same frame in, same camera out, in any order,
in any worker.

## Files

- `references/remotion-pipeline.md` — project layout, determinism rules and what
  each prevents, the audit gate, render commands, output settings for a motion
  reference, and the failure modes. Has a table of contents.
- `references/parameters.md` — the knobs a scene declares: how to declare them,
  how the inspector turns them, how the gate stays in front of a tuned render,
  and which numbers should never become a slider.
- `lib/scene.js` — `defineScene()`. Plain JS: the audit gate loads it in Node.
- `lib/params.js` — the declaration: ranges, resolution, the paste-back block.
- `lib/remotion.jsx` — `sceneComponent()`, `sceneComposition()`, `<PrevizStage>`.
- `lib/film.jsx` — `defineFilm()`, stitch/live modes, transition arithmetic,
  `film.timeline`, cross-scene checks.
- `lib/auditScenes.mjs` — the headless gate, for scenes and films alike.
  `--samples=N`, `--json`, `--quiet`.
