---
name: threejs-blocking-scenes
description: >-
  Build blocking scenes — untextured primitive layouts with flat identity colours
  — in Three.js and react-three-fiber, as a replacement for blocking in Blender or
  another DCC. Covers a full geometry vocabulary (solids of revolution, extrusion
  with holes, swept tubes along curves, hollow walls, tapered layer stacks, taper
  / twist / bend / roughen deformers, radial-grid-scatter layout, instancing, and
  character / furniture proxies), boolean cuts and cross-sections with
  three-bvh-csg, seven measured audits (collisions, framing, floor, hero occlusion, camera
  clearance, on-screen continuity, declared attachments) with three-mesh-bvh,
  NDC projection and sightline raycasts, shot lists resolved per frame, and the determinism rules that let
  the result be rendered by Remotion. Use this skill when the user wants to build
  an animatic, previz, blocking pass or motion reference in code; asks to cut,
  slice or cross-section a mesh with CSG; wants to check that objects don't
  intersect or that a subject stays in frame across a camera move; is preparing a
  reference video for a generative video model (Higgsfield, Seedance, Runway,
  Kling); or is setting up a Three/R3F scene that Remotion will render frame by
  frame. Trigger also for "previz in three", "blocking in r3f", "replace Blender
  with Three for layout".
---

# Three.js Blocking Scenes

Build the blocking pass in code instead of a DCC: primitives, flat identity
colours, exact cuts, measured validation, and a scene that is a pure function of
the frame so Remotion can render it.

## What this is for

A blocking scene answers **what is where, when does it move, and how is it
framed** — and deliberately nothing else. No textures, no material work, no
lighting design. Those hide structural mistakes behind surface appeal, and in a
generative-video pipeline they are the model's job anyway.

Two consumers: you, judging staging and timing while a fix still costs one number;
and a video model, which receives the render as a motion reference and supplies
the look. What a model cannot invent reliably is consistent spatial relationships
and timing — which is exactly what blocking pins down.

## How to use this skill

1. **Read `references/blocking-scenes.md` first.** It is the method: identity
   colour, naming, stages, the CSG manifold requirement, what each audit catches,
   and the determinism contract. Several of its rules produce *plausible but
   wrong* output rather than an error, so skimming costs more than reading.

2. **Import from `lib/blocking.js`.** Zero React, framework-agnostic. Scene
   skeleton, identity palette, core primitives, CSG helpers, the audits, anchors
   (`ctx.anchor`) and scene-side visibility. Requires `three`, `three-mesh-bvh` and `three-bvh-csg`.

3. **Use `lib/geometry.js` for shapes — every shape lives there.** The vocabulary: sweeps along curves,
   extrusion with holes, hollow walls, deformers, layout distributions,
   instancing, and character / furniture proxies. `references/geometry-vocabulary.md`
   opens with a table that maps *the shape you want* to *the construction to use* —
   read that before hand-building a mesh, because most blocking geometry is one of
   seven ideas and picking wrong is what turns two lines into an afternoon.

4. **For React, use `<PrevizStage>` from `lib/remotion.jsx`.** It works inside any
   R3F `<Canvas>`, not only Remotion's, so there is no separate preview layer.
   Nothing in it reads a clock.

5. **Build in stages and audit between them** — layout, props, cuts, camera,
   polish. Run `auditShots(scene, camera, shots)` (or `defineScene().audit()`)
   before spending a render. SEVEN checks per shot: collisions, framing, floor,
   hero occlusion (being in frame is not being visible), camera clearance
   (exact BVH distance vs the near plane), continuity (nothing pops or
   teleports ON screen — a full-frame-rate sweep), and declared attachments
   (a pour hangs from the mouth it pours from — measured). Declare intent,
   never widen margins: `ignore` pairs, `floorIgnore`, per-shot
   `occlusion: {ignore}` / `pops` / `clearance`, and `hero: []` for
   transitional entries (framing+occlusion waived, everything else runs).

6. **Wire the camera through `lib/shots.js`**, which consumes the moves
   catalog from `threejs-camera-moves`. Never re-implement a move here.

7. **Render with Remotion** by passing `useCurrentFrame()` into `<ShotCamera>`
   inside `@remotion/three`'s `ThreeCanvas`. Never animate with `useFrame`.

## The rules that matter most

- **Everything is scoped to a context.** `createBlocking()` returns `ctx` with its
  own scene, groups, camera and palette — `ctx.part()`, `ctx.get()`,
  `ctx.subjects()`. No module-level state, so two scenes in one process (a film,
  the audit gate, a Remotion worker) never answer for each other.
- **Objects move through `defineScene({ animate })`** — a pure function
  `({ ctx, frame }) => …` that poses everything from scratch each frame; the
  audit gate runs it at every sampled frame, so audits measure what renders.
- **Connections come from anchors, then get declared.** `ctx.anchor(name,
  localPoint)` is the world position of "the cup's mouth" through the scene
  graph — author attachments from it, never from hand-typed trigonometry, and
  declare them in `attachments:` so the audit measures the chain.
- **Scenery stays Blender-grey.** The world carries no colour; every colour on
  screen is an identity you can direct by.
- **Colour is identity, not decoration.** A registered palette makes an untextured
  scene readable *and* gives you names to direct with — once the cast is red,
  green, blue and cyan, "cyan over blue's shoulder" is unambiguous.
- **Everything named and grouped** (`ENV_ / PRP_ / CHR_ / CAM_ / LGT_`) so the
  scene is addressable by string and audits report names you can act on.
- **CSG brushes must be watertight.** Open shells silently produce garbage — build
  cut targets closed. `cupProfile()` returns a closed profile for this reason.
- **CSG is for cuts, not construction.** A hole in a slab is `extrude({ holes })`,
  not a boolean: cheaper, robust, and it stays manifold so it can still be cut
  later. Save booleans for cross-sections and slices.
- **Deformers need tessellation.** They move vertices, so a default
  `BoxGeometry(1,1,1)` — eight corners — cannot twist. Pass segment counts to
  anything you intend to deform.
- **Measure, don't eyeball.** The framing audit finds subjects clipped at the
  frame edge that look fine while authoring, because the authoring viewport is not
  the render aspect.
- **Audit subjects, not scenery.** Floors and walls belong outside the frame and
  under everything; including them buries real findings in noise. Declare
  intentional contact with wildcards — `ignore: [['PRP_chair_*','CHR_*']]`.
- **Pure function of the frame.** No clocks, no `Math.random()` (use the seeded
  `mulberry32`), no accumulated state. Remotion renders frames out of order across
  workers; anything time-driven drifts.
- **Set the near plane for the subject's scale.** The default 0.1 slices through
  product-scale scenes, and the symptoms read as modelling bugs rather than camera
  ones. `createBlocking({ subjectSize })` handles it.

## Camera moves come from the other skill

This skill owns the **scene**. Camera *paths* come from **`threejs-camera-moves`**
— orbit, turntable, dolly zoom, crash zoom, boom, handheld, and the
genre/speedramp vocabulary. Both skills ship in the same plugin and share one
runtime, so `lib/shots.js` imports `lib/cameraMoves.js` directly — there is
nothing to copy.

| | owns |
|---|---|
| `cameraMoves.js` | the **path**: `move(u) -> { position, target, fov, roll }`, easings, `applyState` |
| `shots.js` | the **timeline**: which shot owns which frame, hard cuts, per-shot lens in mm |
| `blocking.js` | the **scene**: geometry, identity, the audits |

`cameraMoves` thinks in seconds and blends; an animatic thinks in frames and cuts.
That gap is the only thing `shots.js` adds. **If a move is missing, add it to the
catalog, not here** — that keeps it usable in a live scene too.

Each shot takes a `hero` (name or wildcard) that the framing audit measures
against. It is the directorial statement — "the hero always in frame" — made
checkable, and it is what stops an over-the-shoulder from failing because the rest
of the cast correctly left frame.

## What to leave out

Textures, real materials, particle chaos, fine prop detail, logos and text. The
test: *would a model get this wrong if left to itself, and would it be obvious?*
Spatial relationships and timing, yes — block those. Surface and turbulence, no.

## Files

- `skills/blocking-scenes/references/geometry-vocabulary.md` — how to choose a construction, with a
  shape → helper table up front, then curves and sweeps, extrusion, shells,
  deformers, layout, instancing, assemblies and utilities. Includes the measured
  gotchas: lathe arc orientation, the tessellation requirement, and why full
  circles don't duplicate their endpoint. Has a table of contents.
- `skills/blocking-scenes/references/blocking-scenes.md` — the method. Identity colour, naming, stages,
  primitive vocabulary, CSG rules, the audits and what each one catches, anchors and
  attachments, the determinism contract, and a worked example with two real bugs the audits find.
  Has a table of contents.
- `lib/blocking.js` — the scene context (`createBlocking` -> `ctx.part` / `ctx.parts`
  / `ctx.get` / `ctx.subjects` / `ctx.anchor`), CSG cuts (`halve` / `bands` /
  `boolean`) and the audits (`auditCollisions` / `auditFraming` / `auditFloor` /
  `auditOcclusion` / `auditCameraClearance`; `auditShots` in shots.js adds
  continuity and attachments).
- `lib/geometry.js` — the shape vocabulary: `curve` / `sweep` / `arcPath` /
  `alongCurve` / `helix`, `roundedRect` / `polygonShape` / `starShape` / `extrude` /
  `hole`, `wall` / `disc` / `gridBars`, `taper` / `twist` / `bend` / `roughen` /
  `lobed`, `radial` / `grid` / `scatter` / `place` / `instances`, `figure` /
  `chair` / `table`, `capsule` / `roundedBox` / `gem`, `merge` / `hull` /
  `fitTo` / `groundAtOrigin` — plus the full native three.js shelf documented
  in the geometry reference (what each class is for, and what CSG can cut).
- `lib/remotion.jsx` — `sceneComponent()`, `sceneComposition()`, `<PrevizStage>`.
