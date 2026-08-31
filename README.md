# threejs-previz

Cinematic previz in code: build a **blocking scene** in Three.js, move a camera
through it with **named cinematic moves**, prove the shots work by **measuring**
(not eyeballing), and render frame-deterministically with **Remotion**.

The output is a **motion reference** for a generative video model (Higgsfield,
Seedance, …): the model supplies texture and light; you keep control of staging,
timing and framing — exactly the things a model cannot invent consistently.

https://github.com/user-attachments — see `out/roundtable.mp4` after your first
`npm run render`: six characters at a round table, a 30-second piece with an
orbit whose gaze hands off face to face, three over-the-shoulder cuts, and real
handheld — authored entirely in code, gated by audits, rendered end to end.

## Quick start

```bash
npm install
npm run audit     # the gate: collisions / framing / floor, headless, ~30 ms
npm run render    # audit && render the 30 s roundtable scene to out/
npm run studio    # scrub the timeline in Remotion Studio
```

`npm run render` refuses to start if any audit fails. That is the point: a
failed shot costs milliseconds to find, not a render measured in minutes.

## Layout

```
├── lib/                     the runtime — one copy of each module
│   ├── cameraMoves.js       the PATH:     move(u) -> {position,target,fov,roll}
│   ├── blocking.js          the SCENE:    identity, groups, CSG, the 3 audits
│   ├── geometry.js          the SHAPES:   every shape, no exceptions
│   ├── shots.js             the TIMELINE: frame -> shot -> u -> camera
│   ├── scene.js             the DEFINITION: defineScene — plain JS, Node loads it
│   ├── remotion.jsx         the COMPONENT:  sceneComposition -> <Composition>
│   ├── film.jsx             the EDIT:       defineFilm joins scenes
│   └── auditScenes.mjs      the GATE:       exits non-zero if a shot fails
├── src/
│   ├── index.jsx            registerRoot
│   ├── Root.jsx             one <Composition> per scene, all metadata derived
│   └── scenes/
│       ├── roundtable.js    6 characters, 4 cuts, target handoffs, handheld
│       ├── canspot.js       13-cut product piece: CSG slices, clone
│       │                    choreography, object animation, 16 audited entries
│       └── demo.js          the smallest complete scene (2 characters, 2 shots)
├── docs/                    the method, written up
└── skills/                  the same material packaged as Claude skills
```

A scene file imports from `scene.js` and **never** from `remotion.jsx` — that
keeps it loadable by plain Node, which is what lets the audit gate check the
real scene rather than a stub.

## The rules that carry the pipeline

- **Colour is identity, not decoration.** The palette is the cast list: once
  six characters are red/green/blue/yellow/purple/cyan, *"cyan over blue's
  shoulder"* is an unambiguous stage direction — to you and to the model.
- **The shot list is the single source of truth.** `durationInFrames` is
  derived from it; restating it lets an extended shot silently truncate the
  render.
- **Shot ranges are half-open.** `[0, 360)` owns frames 0–359; frame 360
  belongs to the next shot. Cuts are hard by construction — camera, target and
  lens change *on* the cut, never across it.
- **Pure function of the frame.** No clocks, no `useFrame`, no
  `Math.random()` (there is a seeded `rng`). Remotion renders frames out of
  order across workers; anything with its own state flickers.
- **Measure, don't eyeball.** Collisions via BVH, framing via NDC projection,
  floor via bounding boxes. Every shot declares its `hero` — what must stay in
  frame. `hero: []` marks a transitional shot: framing waived, collisions and
  floor still audited.
- **Audit subjects, not scenery.** `ENV` is excluded; intentional contact is
  declared, with wildcards: `ignore: [['PRP_chair_*', 'CHR_*']]`.
- **Everything is scoped to a context.** `createBlocking()` returns `ctx` with
  its own scene, groups, camera and palette — no module state, so the gate, a
  film, or a Remotion worker can build many scenes in one process.
- **Build once per worker, move only the camera — and the poses.** `def.make()`
  runs in a `useMemo`; CSG and BVH are build-time work. Objects that move do it
  through `defineScene({ animate })`: a pure function `({ ctx, frame }) => …`
  that poses everything from scratch each frame — the audit gate runs it at
  every sampled frame, so the audits measure the scene exactly as it renders.
- **Declare a hero per shot; `hero: []` marks a transitional entry.** A can
  erupting through the bottom of frame, a close travel along a product, a
  fly-through — nothing whole stays in frame there *by design*. Framing is
  waived for that entry; collisions and floor still run.

## A scene, end to end

```js
// src/scenes/myscene.js — plain JS, Node can load it
import { defineScene } from '../../lib/scene.js';
import { moves, retarget, handheld } from '../../lib/cameraMoves.js';

export default defineScene({
  id: 'myscene',
  fps: 24, height: 720, aspect: 21 / 9, subjectSize: 2.5,
  identity: { grey: '#9a9a9a', wood: '#8a6136', green: '#27ae60' },
  ignore: [['PRP_chair_*', 'CHR_*']],
  build: ({ ctx, geo }) => {
    ctx.part('ENV_floor', geo.disc({ radius: 6 }), 'grey', ctx.groups.ENV);
    ctx.part('PRP_table', geo.table({ radius: 0.7 }), 'wood');
  },
  shots: [
    { name: 'SC01', from: 0, to: 240, focalLength: 28, easing: 'easeInOutSine',
      hero: 'PRP_table',
      move: moves.turntable({ radius: 4, pushIn: 0.95, target: [0, 0, 0] }) },
  ],
});
```

Register it in `src/Root.jsx`, and it is auditable (`npm run audit`), scrubbable
(`npm run studio`) and renderable (`remotion render myscene out/myscene.mp4`)
with nothing restated anywhere.

## The roundtable scene as a worked case study

`src/scenes/roundtable.js` was built the way the pipeline is meant to be used —
in stages, one commit per stage as the backup, each stage audited before the
next was layered on. The git history *is* the case study:

1. **Blocking.** Six seated proxies with identity colours, table, chairs, floor
   and round wall. Static top/side/wide views as the stage check. The audit
   caught the intra-figure contacts, which were then *declared* per character —
   so a red×green collision still counts.
2. **Camera.** Four hard cuts; the orbit's gaze hands off face to face
   (`retarget`), the OTS cuts barely crawl (`truck`). Two real findings, fixed
   by measuring: the orbit cut the table's pedestal out of frame (the hero was
   the *whole* table; the honest statement is "the tabletop always in frame",
   so the top became its own part), and the low-shoulder cut 4 swung its near
   mass out of frame — the camera now rides the cyan→green line above green's
   head, worked out against stills.
3. **Handheld.** Body sway in long waves + a millimetre tremor on the camera,
   drift + breathing on the target (`drift`) — livelier in the orbit, lazy in
   the dialogue. Cut 4's three shot entries play **slices of one move**
   (`slice`) so the noise never restarts: boundary deltas measure the same as
   any mid-shot frame.

## Output for a video model

- **Frame-exactness beats bitrate** — `npm run frames` renders a PNG sequence.
- **Keep the aspect the model expects**; letterboxing teaches it the letterbox.
- **Keep the flat identity colours.** They are the reference's semantics.
- **Render at the target resolution** — bump `height` in the scene definition.

## Verified

Rendered end to end on `remotion@4.x` + `@remotion/three` + `@react-three/fiber@8`
+ `three@0.185`: the 30 s / 720-frame roundtable scene to mp4 (24 fps, 21:9),
stills, and the audit gate loading the real scene files in Node (~30 ms for
900 frames across two scenes). Notes from first contact, so you don't rediscover
them:

- Remotion requires a `tsconfig.json` even in an all-JS project.
- The audits call `updateWorldMatrix(true, false)` — ancestors included —
  because in headless Node nothing else ever computes a rig pivot's world
  matrix. Plain `updateMatrixWorld(true)` measured every rigged mesh at the
  origin.
- **R3F's `<primitive>` reparents what it mounts.** `<PrevizStage>` used to
  mount the five groups one primitive each, which silently emptied `ctx.scene`
  in the browser — every `ctx.get()` after mount searched a hollow scene, while
  the Node-side audit (no R3F) kept passing. It now mounts `ctx.scene` whole.
  If you write a custom stage, mount the scene, never the groups.
- `Config.setChromiumOpenGlRenderer('angle')` is set in `remotion.config.ts`;
  without it some machines render black.
- `film.jsx` (multi-scene stitch/live) is present but has not been exercised
  end to end yet.
