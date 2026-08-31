---
name: threejs-camera-moves
description: >-
  Create cinematic camera animations in Three.js using the vocabulary of
  Higgsfield / Cinema Studio camera moves — Orbit 360, Crash Zoom, Dolly Zoom
  (Vertigo), Push-in, Pull-out, Boom/Crane, Earth Zoom, Turntable, Bullet Time,
  Handheld shake, Pan/Tilt, Whip Pan, tracking shots, and speed ramps. Use this
  skill whenever the user wants to animate a camera in Three.js / react-three-fiber,
  asks for a named cinematic move (e.g. "make the camera do a dolly zoom",
  "orbit around the model", "crash zoom into the logo"), wants to reproduce a
  Higgsfield preset or Cinema Studio look in code, or needs an engine-agnostic
  camera-animation spec that works with GSAP, Theatre.js, or the native Three.js
  clock. Trigger even if they don't say "Three.js" explicitly but clearly want a
  scripted cinematic camera movement in a WebGL scene.
---

# Three.js Camera Moves

This skill turns named cinematic camera moves (the Higgsfield / Cinema Studio
vocabulary) into concrete Three.js camera animations. It is **engine-agnostic**:
every move is expressed as one small function and then played back by whatever
animation engine the project already uses.

## The core idea: a move is a function of normalized time

Every camera move — no matter how fancy — is just the camera's state changing
over time. We represent that state as:

```
CameraState = { position: [x,y,z], target: [x,y,z], fov: number, roll: number }
```

and each move as a pure function

```
move(u) -> CameraState        // u is normalized progress in [0, 1]
```

`u = 0` is the start of the shot, `u = 1` is the end. The function is
**time- and engine-independent**: it doesn't know about seconds, frame rate, or
which library drives it. That separation is what makes the same move play
identically under GSAP, Theatre.js, or a hand-rolled `requestAnimationFrame`
loop.

Three orthogonal pieces combine to produce a shot:

1. **The move** `f(u)` — the *path* (orbit, dolly, crane, …). See the catalog.
2. **The easing** `e(u)` — the *feel* (linear, easeInOut, expo punch, …). The
   player composes them as `f(e(u))`, so easing reshapes time, not geometry.
3. **The duration** — how many seconds `u` takes to go 0→1.

This is also exactly how Higgsfield's Cinema Studio splits things: the **preset**
is the path, the **speedramp** is the easing, the **genre** biases feel
(FOV, shake, cut rhythm). See `skills/camera-moves/references/camera-moves.md` for the full mapping.

## How to use this skill

1. **Identify the move(s)** the user wants from `skills/camera-moves/references/camera-moves.md`.
   That file is the catalog: for each named move it gives the parametric
   `f(u)`, a recommended easing, a typical duration, and gotchas. Read it before
   writing code — do not improvise the camera math from memory, the framing math
   (especially Dolly Zoom) is easy to get subtly wrong.

2. **Drop in the module.** `${CLAUDE_PLUGIN_ROOT}/lib/cameraMoves.js` is a zero-dependency module
   that already implements every move in the catalog plus a player and adapters.
   Copy it into the project (or adapt it) rather than rewriting from scratch.

3. **Play it with the project's engine.** Use the adapter that matches what the
   project already uses — don't add GSAP to a project that doesn't have it:
   - **Native** (no deps): `playNative(camera, move, { duration, easing })`
     drives the move from `THREE.Clock` inside the render loop.
   - **GSAP**: `playGSAP(camera, move, { duration, ease })` tweens a single
     progress value and applies `f(u)` in `onUpdate`.
   - **Theatre.js**: `bindTheatre(sheet, camera, move)` exposes the move's raw
     props as keyframable channels for the visual editor.
   - **react-three-fiber**: use the `useCameraMove` hook pattern shown in the
     module header, driven by `useFrame`.

4. **Compose shots** by sequencing moves (a timeline) or blending the end state
   of one into the start of the next. The module's `sequence([...])` helper
   chains moves with per-segment durations and easings.

5. **Set the lens, not just the FOV.** If the shot is specified in millimetres, or
   has to match a camera exported from Blender / Maya / a real plate, see
   `skills/camera-moves/references/lens-and-framing.md`: `filmGauge` + `setFocalLength()` let you
   author in mm, `filmOffset` shifts the frame without rotating the camera, and
   the near plane needs attention in product-scale scenes. That file also has the
   recipe for measuring whether a subject stays in frame across a move instead of
   eyeballing it.

## Conventions that keep moves reusable

- **Always aim via an explicit `target`, not `camera.rotation`.** Camera moves
  read as intentional when the lens keeps looking at a point of interest. The
  player calls `camera.lookAt(target)` every frame; `roll` is applied on top as
  a rotation about the view axis so Dutch-angle / barrel moves still work.
- **Frame relative to the subject, then to the world.** Moves in the catalog are
  authored around a subject at the origin looking down `-Z`, with a `radius`
  (distance) and `height`. To place a move in a real scene, pass the subject's
  world position + bounding radius as `frame` options; the player offsets the
  whole move so it composes with any scene without editing the move itself.
- **Keep FOV changes and dolly separate and intentional.** Pure dolly = move the
  camera, FOV fixed. Pure zoom = change FOV, camera fixed. Dolly Zoom = both, in
  opposite directions, tuned so the subject stays the same size. Conflating them
  is the #1 way cinematic moves end up looking wrong.
- **Update the projection matrix after changing FOV.** Whenever a move animates
  `fov`, the player sets `camera.fov` and calls
  `camera.updateProjectionMatrix()` — forgetting this is why "the zoom does
  nothing."

## When the user wants a look, not a single move

If the request is a *vibe* ("make it feel like an action-movie reveal") rather
than one named move, translate the Cinema Studio controls:
- **genre** → base FOV, amount of handheld shake, cut rhythm (see the genre
  table in the catalog).
- **speedramp** → which easing to apply (`impact` = fast-in/hold, `slowmo` =
  ease-out into a long tail, etc.).
- Then pick the path that matches the story beat (reveal = Boom/Crane or Earth
  Zoom out; impact = Crash Zoom; tension = slow Push-in; showcase = Turntable).

Explain the choice briefly so the user can adjust it.

## Building an animatic with these moves

For a **previz / blocking pass** — an untextured scene, hard cuts between shots,
and a render that has to be frame-exact for Remotion or as a motion reference for
a video model — pair this with the **blocking-scenes** skill in the same plugin.
`lib/shots.js` bridges them: it turns a frame number into a shot, a `u`, and a
camera state, using the moves defined here.

The division: this skill owns the **path** and thinks in seconds; `shots.js` owns
the **timeline** and thinks in frames and cuts. A move added here is usable in
both a live scene and an animatic — which is why new moves belong in this catalog
rather than in the bridge.

## Files

- `skills/camera-moves/references/camera-moves.md` — the catalog. Every move with its `f(u)`,
  easing, duration, and notes, plus the Cinema Studio genre/speedramp mapping.
  Has a table of contents at the top.
- `skills/camera-moves/references/lens-and-framing.md` — physical camera parameters in Three.js:
  focal length / film gauge / FOV maths, matching a Blender or DCC camera exactly,
  lens choice per focal length, lens shift (`filmOffset`), near/far and depth
  precision, depth of field, and a framing-audit snippet. Has a table of contents.
- `lib/cameraMoves.js` — drop-in, zero-dependency implementation of every
  move + the player + engine adapters + `sequence()`.
