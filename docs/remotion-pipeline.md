# Remotion Previz Pipeline

How a blocking scene becomes a video file, and the handful of rules that decide
whether the render matches what you saw in the preview.

## Table of contents

1. [Project layout](#1-project-layout)
2. [Install](#2-install)
3. [The composition derives from the shot list](#3-the-composition-derives-from-the-shot-list)
4. [Determinism at render time](#4-determinism-at-render-time)
5. [Build once, not per frame](#5-build-once-not-per-frame)
6. [The audit gate](#6-the-audit-gate)
7. [Films: joining scenes](#7-films-joining-scenes)
8. [Rendering](#8-rendering)
9. [Output for a video model](#9-output-for-a-video-model)
10. [Failure modes](#10-failure-modes)

---

## 1. Project layout

```
project/
├── remotion.config.ts
├── package.json
├── lib/                        the plugin runtime — one copy, shared
│   ├── cameraMoves.js          the path
│   ├── blocking.js             the scene
│   ├── geometry.js             the shapes
│   ├── shots.js                the timeline
│   ├── scene.js                defineScene — plain JS, Node can load it
│   ├── remotion.jsx            sceneComponent + <PrevizStage>
│   ├── film.js                 defineFilm — plain JS, Node can load it
│   ├── film.jsx                filmComposition (the React half)
│   └── auditScenes.mjs         the gate
├── src/
│   ├── Root.tsx                registers the compositions
│   └── scenes/
│       ├── roundtable.js       one file per piece: build + shots
│       └── tiramisu.js
└── out/
```

One file per scene, exporting a `defineScene()` result as default — and importing
from `scene.js`, **not** from `remotion.jsx`. That keeps the scene file loadable by
plain Node, which is what makes the audit gate able to check the real thing rather
than a stub. `Root.tsx` adds the component with `sceneComposition()`.

## 2. Install

```bash
pnpm dlx remotion add @remotion/three          # pins a compatible version
pnpm add three three-mesh-bvh three-bvh-csg
```

`remotion add` is preferable to a plain `pnpm add` because it matches the
package version to your Remotion version, and pulls `@react-three/fiber` and
`three` as peers.

In `remotion.config.ts`, set the OpenGL renderer — new projects include it, older
ones may not:

```ts
Config.setChromiumOpenGlRenderer('angle');
```

## 3. The composition derives from the shot list

```jsx
import { Composition } from 'remotion';
import roundtable from './scenes/roundtable.js';

export const RemotionRoot = () => <Composition {...roundtable.compositionProps} />;
```

`compositionProps` is `{ id, component, fps, width, height, durationInFrames }`,
and `durationInFrames` comes from `shots.duration`. **Do not restate it.** The
failure it prevents is quiet: extend a shot's `to`, forget the composition, and
the render simply stops mid-move — no error, no warning, just a video that ends
early. Deriving it makes that impossible.

`width` is derived from `height × aspect`, so a 21:9 piece at 1080 is 2520 × 1080
without arithmetic in two places.

For several scenes:

```jsx
{[roundtable, tiramisu].map((s) => <Composition key={s.id} {...s.compositionProps} />)}
```

## 4. Determinism at render time

Remotion renders frames **out of order, across parallel workers**. Four rules
follow, and violating any of them produces flicker or a preview that disagrees
with the render — never an error message.

**`useCurrentFrame()` only; `useFrame()` is forbidden.** During rendering
`<ThreeCanvas>` pins `frameloop` to `'never'` and draws on demand. Anything
animating on its own clock freezes, tears, or drifts between preview and output.
`<PrevizStage>` reads the frame once and passes it to `applyFrame`.

**`<ThreeCanvas>` needs explicit `width` and `height`** from `useVideoConfig()`.
The Studio applies a scale transform to the canvas and a browser bug breaks the
layout without them.

**`<Sequence>` inside the canvas needs `layout="none"`.** Its default `div`
wrapper is not valid inside a canvas.

**No state between frames.** No accumulation (`position.x += v`), no
`Math.random()` — `geometry.js` ships a seeded `rng` precisely so scatter and
debris land identically in every worker on every render.

If you update a texture asynchronously (from an `<OffthreadVideo>` callback, say),
call `advance(performance.now())` rather than `invalidate()`, so the scene
re-renders synchronously before the frame is captured.

## 5. Build once, not per frame

`sceneComponent(def)` runs `def.make()` inside a `useMemo` with no dependencies —
**once per worker**, never per frame.

This matters more than it looks. CSG cuts, `mergeGeometries` and BVH construction
are build-time work; doing them per frame is slow *and* a determinism hazard,
because a boolean re-evaluated repeatedly can produce marginally different
triangles at the seams. Build the geometry once, then move only the camera.

The camera is the sole per-frame computation, and it is pure:

```js
applyFrame(camera, shots, frame);   // same frame -> same camera, any order, any worker
```

Visibility spans are the other per-frame value, and they are resolved the same
way: `applyVisibility(scene, spans, frame)`, not a toggle you mutate once.

## 6. The audit gate

```json
{
  "scripts": {
    "audit:scenes": "node lib/auditScenes.mjs src/scenes/*.js",
    "render": "pnpm audit:scenes && remotion render roundtable out/roundtable.mp4"
  }
}
```

`auditScenes.mjs` imports every scene module, runs the collision / framing / floor
audits across all shots, prints a report and **exits non-zero on failure**, so the
`&&` refuses to start a render that would waste minutes on a shot that cuts the
hero off.

It needs no browser and no GPU: every audit is bounding boxes, BVH intersection
and NDC projection — plain maths. Measured on the round-table scene, 450 frames,
six samples per shot:

```
PASS  roundtable  (450 frames, audited in 101ms)
  ok   SC01_wide [0-450)  framing 0.000 [hero PRP_table]

FAIL  tooclose  (450 frames, audited in 42ms)
  FAIL SC01_wide [0-450)  framing 0.893 [hero PRP_table] <PRP_table @f269>

1 of 2 scene(s) failed — not safe to render.
```

A hundred milliseconds against a render measured in minutes. Flags: `--samples=N`
(default 6), `--json` for CI, `--quiet` to print only failures.

The report names the **frame** and the **object**, which is usually enough to fix
it without opening the Studio.

## 7. Films: joining scenes

A scene is a unit of work; a film is an edit of scenes. They are separate
compositions so that changing one scene does not invalidate the rest.

The same split as scenes: `film.js` is the definition (plain JS — the audit
gate loads it and runs the cross-scene checks), `film.jsx` binds the component.

```js
// src/film.js — plain JS, Node loads it
import { defineFilm } from '../lib/film.js';
export default defineFilm({
  id: 'feature',
  scenes: [intro, roundtable, outro],
  mode: 'stitch',
  transitions: { intro: { frames: 15 } },
});
```

```jsx
// src/Root.jsx — inject the transition kit; lib/ never hard-depends on it
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { filmComposition } from '../lib/film.jsx';
<Composition {...filmComposition(feature, { TransitionSeries, linearTiming, presentation: fade() })} />
```

Declaring transitions and not injecting the kit **throws at registration** —
a silently ignored dissolve is how a film comes out the wrong length.
(Composition ids allow only `a-z A-Z 0-9 -`; no underscores.)

### stitch vs live

| | `stitch` | `live` |
|---|---|---|
| scene source | pre-rendered file via `<OffthreadVideo>` | the scene's own component |
| intermediate files | yes, one per scene | none |
| change one scene | re-render that scene, re-stitch (seconds) | re-render the whole film |
| WebGL contexts | one, for nothing — it is just video | one per scene, mounted and torn down |
| good for | anything longer than a couple of scenes | short pieces still being cut |

The render order for `stitch` is scenes first, film last:

```json
"scripts": {
  "audit:scenes":       "node lib/auditScenes.mjs src/scenes/*.js src/film.js",
  "render:scene":       "pnpm audit:scenes && remotion render",
  "render:film":        "pnpm audit:scenes && remotion render feature out/feature.mp4",
  "render:film:stitch": "pnpm audit:scenes && remotion render opening public/opening.mp4 && remotion render roundtable public/roundtable.mp4 && remotion render feature-stitch out/feature-stitch.mp4"
}
```

`render:scene` takes the composition id as an argument and forwards the rest to
Remotion — `pnpm render:scene tiramisu`, or
`pnpm render:scene tiramisu out/frames --sequence`. With no output path Remotion
writes `out/<id>.mp4`.

Scene renders go to `public/` because `staticFile()` reads from there.

### The transition arithmetic

`<TransitionSeries>` renders both scenes during a transition and **shortens the
total by the transition length**:

```
100 + 100 - 30 = 170     two scenes, one 30-frame dissolve
120 + 450 + 20 - 15 - 60 = 515
```

`defineFilm` computes it. Doing it by hand is the most common off-by-N in a
Remotion edit, and it fails quietly — the film is simply shorter than the number
you typed.

Two API details worth knowing: a transition declared after the **last** scene is
ignored, and `TransitionSeries.Sequence` must **not** be given `layout="none"` —
that is deprecated and throws from Remotion 5, because transition scenes have to
stay absolutely positioned. (This is the opposite of a plain `<Sequence>` *inside*
a `<ThreeCanvas>`, which does need it.)

### What the film-level checks catch

All of these fail *silently* at render time — the film comes out wrong rather than
erroring — which is why `auditScenes.mjs` asserts them:

```
FAIL  feature  (515 frames)
  FAIL table: fps 24 != film fps 30 — timing will drift
  FAIL outro: 1920x1080 != film 2520x1080 — will letterbox or crop
  FAIL transition after "table": 60 frames is >= the shortest adjacent scene (20)
```

(A declared transition with no injected `TransitionSeries`/`linearTiming` is
not a check — `filmComposition` throws at registration.)

**The fifth film check — seam continuity.** For invisible cuts (a camera that
dives through a surface and emerges in the next scene), declare
`seams: true` on the film: the check poses each scene's own shot list at the
boundary frames and MEASURES that the camera position, view direction and
lens splice — `seam A -> B: camera jumps 0.306m / 1.8deg` names exactly how
far the trajectory misses. The classic trap it exists for: shot ranges are
half-open, so the last RENDERED frame is `to-1` — a move authored to end "at
u=1" is one frame of trajectory short at the boundary unless its window is
stretched by `n/(n-1)`. Share the trajectory itself between scenes (one
recipe module both import) and let the check keep it honest; the hard cut
then hides behind the surface — an old, honest editing trick, now measured.
Works in `live`; in `stitch` the boundary is a video cut, so it only holds if
the surface fills the frame at the cut.

**Mismatched fps is the worst of them.** A stitched film plays every clip at the
film's fps, so a 24 fps scene inside a 30 fps film runs fast *and* every cut after
it lands early — a drift that compounds and looks like a timing mistake in the
animation rather than a configuration one.

## 7b. Authoring object motion

Object motion is a pure function of the frame, and `defineScene` resolves it
in exactly one place — `def.pose(ctx, frame)` — shared by the audit gate, the
Remotion component and the inspector, so the three cannot drift.

```js
animate: ({ ctx, frame }) => { ... }   // every value derived from the frame
```

A tween library was evaluated for this and rejected on measurement, not
taste: across the scenes in this repo only 6–9% of the animation code is
tween-shaped. The dominant idiom is "hide every dynamic object, then the
active cut shows what it needs" — a switch over dozens of objects, not a set
of keyframes — and the rest is procedural placement (modulo wrapping,
orbits, arcs derived from anchors) that is not a tween in any form. One way
to move an object beats two.

If you ever do reach for one: whatever drives the scene must be a pure
function of the frame, which for a timeline means **it must seek
identically regardless of call order** — Remotion's workers do not ask for
frames in sequence. That is a property to measure before trusting, not to
assume.

## 8. Rendering

```bash
pnpm studio                                            # scrub, check the cuts
pnpm inspect                                           # orbit it, tune the knobs
pnpm render:scene roundtable                           # -> out/roundtable.mp4
pnpm still:scene roundtable out/f120.png --frame=120
pnpm render:scene roundtable out/frames --sequence     # PNG sequence
```

Parameters ride on both the gate and the render, and the inspector writes the
command for you — see `parameters.md`.

`remotion studio` is the equivalent of scrubbing the timeline: it is where you
judge whether the cuts land, which is a question no audit can answer.

## 9. Output for a video model

When the render is a **motion reference** rather than a deliverable, a few
settings matter more than quality:

- **Frame-exactness beats bitrate.** The whole value of the reference is that
  motion and timing are exactly what you designed; a model asked to match it
  one-to-one will inherit any drift. A PNG sequence removes the question
  entirely, at the cost of disk.
- **Keep the aspect the model expects.** A 21:9 reference letterboxed into 16:9
  teaches the model to generate the letterbox.
- **Keep the flat identity colours.** They are the reference's semantics: this
  band is soaked biscuit, that one is cream, this character is cyan. Adding
  materials or lighting before the render actively removes information the model
  uses.
- **Render at the target resolution.** Upscaling a reference softens the edges
  that carry the staging.

## 10. Failure modes

**The video ends before the last shot.** `durationInFrames` was restated by hand
and drifted from the shot list. Use `compositionProps`.

**The preview looks right, the render flickers.** Something is animating outside
`useCurrentFrame()` — a `useFrame`, a clock, an accumulated value, or a
`Math.random()` in the scene build.

**Geometry disappears at close range, or glass never appears.** The camera's near
plane. The default 0.1 slices through a product-scale scene; `defineScene`'s
`subjectSize` sets it to roughly 5% of the subject. The symptom looks like broken
geometry, which sends people to the modelling instead of the camera.

**The framing is subtly high or low.** `reframe` offsets both position *and*
target, so the move's own default target is added to `center` rather than replaced
by it. Zero the move's target when you plan to reframe it.

**Everything collides with the floor.** The audit is being run on all meshes
instead of on subjects. Scenery belongs to `ENV` and is excluded by default;
intentional contact is declared with wildcards, `ignore: [['PRP_chair_*','CHR_*']]`.

**The film is shorter than the sum of its scenes.** That is transitions doing
their job. `defineFilm` reports `sceneFrames`, `transitionFrames` and the total
separately so the number is never a surprise.

**A stitched scene plays fast and every later cut lands early.** Mismatched fps
between that scene and the film. The film-level check catches it.

**An over-the-shoulder shot fails the framing audit.** It is being measured
against every subject, and in an OTS the rest of the cast is *supposed* to leave
frame. Give the shot a `hero`.
