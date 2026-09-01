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
npm run audit     # the gate: eight checks per shot, headless, ~150 ms for 900 frames
npm run render    # audit && render the 30 s roundtable scene to out/
npm run studio    # scrub the timeline in Remotion Studio (the shot's view)
npm run inspect   # the inspector: orbit the scene, see the camera's path
```

`studio` shows you what the shot sees. `inspect` shows you the shot itself —
free orbit, the camera's whole trajectory drawn as a line coloured per shot
with a marker at every cut, the shot camera as a moving frustum, and green
boxes on whatever the current shot declared as its `hero`. Toggle to
"shot camera" to see the exact render, back to "free orbit" to understand
it. It is READ-ONLY by design: the audits stay the authority, the inspector
explains their findings. It reuses `def.make()`, `def.pose()` and
`applyFrame` — the same pure functions Remotion renders, so there is no
second implementation to drift.

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
│   ├── film.js              the EDIT:       defineFilm — plain JS, Node loads it
│   ├── film.jsx             the EDIT's COMPONENT: filmComposition (live/stitch)
│   ├── inspector.jsx        the VIEWER:     orbit the scene, draw the path
│   └── auditScenes.mjs      the GATE:       exits non-zero if a shot fails
├── src/
│   ├── index.jsx            registerRoot
│   ├── Root.jsx             one <Composition> per scene, all metadata derived
│   └── scenes/
│       ├── roundtable.js    6 characters, 4 cuts, target handoffs, handheld
│       ├── canspot.js       13-cut product piece: CSG slices, clone
│       │                    choreography, object animation, 16 audited entries
│       └── demo.js          the smallest complete scene (2 characters, 2 shots)
├── inspector/               the Vite app behind `npm run inspect`
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
- **Measure, don't eyeball.** Eight checks per shot, all headless:
  1. **Collisions** — triangle-exact via BVH, on subjects.
  2. **Framing** — the shot's `hero` projected to NDC; is it inside the frame?
  3. **Floor** — nothing sinks through the ground plane.
  4. **Occlusion** — sightline raycasts from the camera to the hero: being in
     frame is not the same as being *visible*. "Nobody blocks cyan at the
     end" is a measurement, not a hope. Translucent materials don't block.
  5. **Camera clearance** — exact BVH distance from the camera to everything
     visible; closer than the near plane clips a hole through geometry.
  6. **Continuity** — a full-frame-rate sweep: nothing pops into or out of
     existence *on screen*, nothing teleports. Entering from off-screen,
     emerging from behind something, sinking into water, and same-place swaps
     (a can replaced by its CSG slices) are automatically legitimate.
  7. **Attachments** — declared connections, measured: "the pour hangs from
     the cup's mouth", "the last droplet sits on the lip". Author them from
     `ctx.anchor(name, localPoint)` (world positions through the scene graph,
     never typed trigonometry), then declare them in `attachments:` and the
     audit reports pair, distance and frame when a chain disconnects.
  8. **Camera path** — position step, view turn AND roll against the shot's
     own median: a discontinuous path reads exactly like passing through an
     object, and a gaze along the camera's own up axis spins the frame while
     position and direction stay smooth.

  Every shot declares its `hero` — what must stay in frame. `hero: []` marks a
  transitional shot: framing and occlusion waived, everything else still runs.
- **Audit subjects, not scenery — and declare intent, don't silence checks.**
  `ENV` is excluded from collisions; everything intentional is declared with
  wildcards, per class: contact `ignore: [['PRP_chair_*', 'CHR_*']]`, floor
  breaches `floorIgnore: ['PRP_ball']`, intentional blockers per shot
  `occlusion: { ignore: ['PRP_ice_*'] }` (or `occlusion: false`), sanctioned
  pops per shot `pops: ['PRP_debris_*']`, camera margin `clearance: 0.05`.
- **The timeline has no gaps.** `shotList` throws if a frame has no owner —
  an editorial gap is declared as an explicit placeholder shot.
- **Everything is scoped to a context.** `createBlocking()` returns `ctx` with
  its own scene, groups, camera and palette — no module state, so the gate, a
  film, or a Remotion worker can build many scenes in one process.
- **Build once per worker, move only the camera — and the poses.** `def.make()`
  runs in a `useMemo`; CSG and BVH are build-time work. Objects that move do it
  through `defineScene({ animate })` — a pure function `({ ctx, frame }) => …`
  — or `defineScene({ timeline })`, an anime.js timeline built once and only
  seeked (`.seek()` is measured to be order-independent, so out-of-order
  workers agree). Either way `def.pose(ctx, frame)` is the single resolver
  the gate, the renderer and the inspector all share.
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
- Films are verified in **both modes**: `npm run render:film` (live — two
  `<ThreeCanvas>` scenes through a real TransitionSeries dissolve) and
  `npm run render:film:stitch` (scenes pre-rendered to `public/`, stitched via
  `<OffthreadVideo>`); the two dissolve frames match pixel for pixel. The film
  definition lives in plain-JS `film.js` so the gate audits the real file, and
  `filmComposition` throws if transitions are declared without injecting
  `TransitionSeries`/`linearTiming`. Composition ids allow no underscores.
