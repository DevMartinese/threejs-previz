# Lens & Framing — physical camera parameters in Three.js

The move catalog describes shots in terms of `fov` (vertical, degrees), because
that is what `PerspectiveCamera` takes. But shots are *specified* in millimetres —
"shoot it on an 85" — and any scene that comes out of Blender, Maya or a real
camera arrives with a focal length and a sensor size, not an FOV.

Three.js already speaks that language; the properties are just easy to miss. This
file covers how to drive a camera in mm, how to match a DCC camera exactly, and
the two framing controls (lens shift, near/far) that fix problems people usually
try to solve by moving the camera.

## Table of contents

1. [Focal length, film gauge, FOV](#1-focal-length-film-gauge-fov)
2. [Matching a Blender / DCC camera exactly](#2-matching-a-dcc-camera)
3. [Lens choice as a storytelling control](#3-lens-choice)
4. [Lens shift: `filmOffset`](#4-lens-shift)
5. [Near / far, and the miniature-scale trap](#5-near-far)
6. [Depth of field](#6-depth-of-field)
7. [Auditing framing with numbers](#7-auditing-framing)
8. [Importing a camera from a glTF](#8-importing-a-camera)

---

## 1. Focal length, film gauge, FOV

`PerspectiveCamera.fov` is the **vertical** field of view in degrees (default 50).
The mm-based API sits on top of it:

| Property / method | Meaning |
|---|---|
| `filmGauge` | film size on the **larger** axis, in mm. Default `35` |
| `getFilmWidth()` | `filmGauge` in landscape (`aspect >= 1`) |
| `getFilmHeight()` | `filmGauge / max(aspect, 1)` — the vertical extent |
| `setFocalLength(mm)` | sets `fov` from the focal length and the current gauge |
| `getFocalLength()` | the inverse |
| `getEffectiveFOV()` | `fov` with `zoom` applied |

The relation is ordinary optics:

```
fov = 2 · atan( filmHeight / (2 · focalLength) )
focalLength = (filmHeight / 2) / tan(fov / 2)
```

```js
camera.filmGauge = 36;          // see below
camera.setFocalLength(85);      // now think in millimetres
camera.updateProjectionMatrix();
```

Two things that bite:

- **`filmGauge` alone does nothing to the projection.** It only matters through
  `setFocalLength` / `getFocalLength`, and through `filmOffset`. Setting it does
  not change the image until you re-derive the FOV.
- **The vertical extent depends on `aspect`.** Because `getFilmHeight()` divides
  by the aspect ratio, the *same* focal length gives a different vertical FOV on a
  different aspect. Set `aspect` first, then `setFocalLength`, then
  `updateProjectionMatrix()`.

## 2. Matching a DCC camera

Blender's default sensor is **36 × 24 mm**, and with `sensor_fit = 'AUTO'` on a
landscape render it fits the **width** — exactly what Three.js does with
`filmGauge` on the larger axis. So the two agree once the gauge matches:

```js
camera.filmGauge = 36;                 // Blender's sensor_width
camera.aspect = 2520 / 1080;
camera.setFocalLength(blenderCamera.lens);
camera.updateProjectionMatrix();
```

Verified equivalence — Blender `lens = 50`, `sensor_width = 36`, sensor fit AUTO:

| aspect | Blender vertical FOV | Three, `filmGauge = 36` | Three, default `35` |
|---|---|---|---|
| 16:9 | 22.895° | **22.895°** | 22.275° |
| 21:9 | 17.542° | **17.542°** | 17.062° |

Leaving the default 35 is a ~0.5° error — small, but it is a *systematic* mismatch
that makes a web scene fail to line up with a rendered plate or a reference video.

Caveats when importing from a DCC:

- If the DCC camera used `sensor_fit = 'VERTICAL'`, set
  `camera.filmGauge = sensor_height * max(aspect, 1)` so the vertical extent works
  out, or just convert to an FOV and set `fov` directly.
- In portrait (`aspect < 1`) the gauge maps to the *height* in Three.js, which is
  the same "larger axis" rule but flips which sensor dimension you should match.

## 3. Lens choice

Focal length is not just framing — it sets how much perspective distorts, which is
why the genre table in `camera-moves.md` recommends FOV ranges. In mm on a 36 mm
gauge, roughly:

| Focal | vFOV @ 16:9 | vFOV @ 21:9 | Reads as |
|---|---|---|---|
| 18 mm | 62° | 46° | very wide; exaggerated depth, edges stretch |
| 24 mm | 48° | 36° | wide establishing, environments |
| 35 mm | 32° | 25° | natural-wide, handheld documentary |
| 50 mm | 23° | 18° | neutral |
| 85 mm | 14° | 10° | portrait / product; compressed, flattering |
| 135 mm | 8° | 6° | long lens; background looms, telephoto follow |

The composition rule behind Dolly Zoom lives here too: **distance sets how big the
subject is, focal length sets how the background relates to it.** Moving closer
with a wide lens and further with a long lens can keep the subject identical while
completely changing the shot.

## 4. Lens shift

`filmOffset` slides the frustum horizontally **without rotating the camera**, in
the same units as `filmGauge`:

```js
camera.filmGauge = 36;
camera.filmOffset = 3.6;        // 10% of the frame, to the side
camera.updateProjectionMatrix();
```

Use it when the subject must sit off-centre but vertical lines must stay vertical —
a packshot with the product on the left and clear space on the right for a logo.
Rotating the camera to get the same composition converges the verticals; shifting
does not. It is the same control as Blender's `shift_x`, which is expressed as a
*fraction* of the larger sensor dimension:

```
filmOffset = shift_x · filmGauge        // shift_x 0.1, gauge 36 -> 3.6
```

Three.js only exposes the horizontal offset. For a vertical shift (Blender's
`shift_y`), use `setViewOffset(fullW, fullH, x, y, w, h)`, which crops a window out
of a larger frustum and can offset in both axes. `clearViewOffset()` undoes it.

## 5. Near / far

Defaults are `near = 0.1`, `far = 2000`, and `near` must be greater than 0.

The default near plane is a real hazard in **product-scale scenes**: with a 9 cm
subject, a near plane at 10 cm slices straight through the geometry. The symptoms
are misleading — geometry that vanishes only at close range, "transparent" walls,
glass that never appears — so it reads as a modelling or material bug rather than a
camera setting. Rule of thumb: `near ≈ 5%` of the subject's size.

At the other end, the ratio `far / near` is what determines depth precision, not
the absolute values. Push `near` as large as the scene allows before pushing `far`
out. For the extreme range that `earthZoom` needs, enable
`logarithmicDepthBuffer: true` on the renderer or rescale the scene in stages.

## 6. Depth of field

`camera.focus` exists but **does not affect the projection matrix** — it is only
used by `StereoCamera`. Real DOF is a post-processing pass:

```js
// three/addons/postprocessing/BokehPass.js
new BokehPass(scene, camera, { focus: 4.5, aperture: 0.0002, maxblur: 0.01 });
```

`aperture` here is a blur-strength scalar, not an f-stop: larger = more blur, which
is the opposite direction to a real f-number. If you want to author in f-stops,
`postprocessing`'s `DepthOfFieldEffect` takes `focusDistance`, `focalLength` and
`bokehScale` and is closer to the physical model.

Two habits worth borrowing from 3D packages:

- **Focus on an object, not a number.** Keep an `Object3D` as the focus target and
  set `focus = camera.position.distanceTo(target.getWorldPosition(v))` each frame.
  A focus pull then becomes moving or switching the target.
- **A focus pull is a camera move.** It has a duration and an easing like any
  other; drive it with the same `f(u)` + easing pattern the catalog uses.

## 7. Auditing framing

Don't eyeball whether the subject stays in frame across a move — project its
bounding box and measure. `Vector3.project(camera)` returns NDC in `[-1, 1]`:

```js
import { Box3, Vector3 } from 'three';

function overshoot(object, camera, margin = 0.02) {
  const box = new Box3().setFromObject(object);
  const v = new Vector3();
  let worst = 0;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z).project(camera);
    if (v.z > 1) continue;                       // behind the camera
    worst = Math.max(worst, Math.abs(v.x) - 1, Math.abs(v.y) - 1, 0);
  }
  return worst;                                   // 0 = fully inside the frame
}
```

Sample it at the extremes of a move (`u = 0, 0.25, 0.5, 0.75, 1`) with
`camera.updateMatrixWorld()` called after each state is applied. The usual fix is
to scale the whole path away from the target — `reframe(move, { scale: 1.15 })` —
which preserves the move and only changes how much air it has. Tightening the FOV
instead changes the perspective and therefore the shot.

## 8. Importing a camera

`GLTFLoader` returns cameras as `PerspectiveCamera` with `fov`, `aspect`, `near`
and `far` already converted — glTF stores `yfov` in radians, so the vertical FOV
survives the trip and the focal length does not. If you need the millimetres back,
set `filmGauge` to the source sensor width and read `getFocalLength()`.

Coordinates: glTF is Y-up like Three.js, so an exported camera needs no conversion.
Blender is Z-up and its exporter maps `(x, y, z) -> (x, z, -y)`; that only matters
if you are porting raw coordinates by hand rather than going through a glTF.
Cameras look down their local `-Z` in Three.js, glTF and Blender alike.
