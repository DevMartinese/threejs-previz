# Camera Moves Catalog

Every move is a function `f(u) -> CameraState` with `u ∈ [0,1]`, authored around
a **subject at the origin**, camera looking toward it down `-Z`. Two framing
scalars parameterize the neutral pose:

- `radius` (`R`) — distance from camera to subject.
- `height` (`H`) — camera height above the subject's center.

`CameraState = { position:[x,y,z], target:[x,y,z], fov, roll }`
(`fov` in degrees, `roll` in radians about the view axis; `target` defaults to
the subject center `[0, H_target, 0]`).

The player composes easing as `f(e(u))`, so the entries below give the **path**;
the "Easing" column is the recommended *feel* and "Duration" a sane default. All
of these are implemented in `assets/cameraMoves.js` — this file explains the
math so you can tune or extend them.

## Table of contents

1. [Orbit 360](#1-orbit-360)
2. [Turntable / 3D Render / CGI Breakdown](#2-turntable)
3. [Float Spin (subject spin)](#3-float-spin)
4. [Push-in / Dolly-in](#4-push-in)
5. [Pull-out / Dolly-out](#5-pull-out)
6. [Crash Zoom](#6-crash-zoom)
7. [Dolly Zoom / Vertigo](#7-dolly-zoom)
8. [Boom / Crane (lift reveal)](#8-boom-crane)
9. [Earth Zoom (in / out)](#9-earth-zoom)
10. [Bullet Time](#10-bullet-time)
11. [Handheld / Shake](#11-handheld)
12. [Pan](#12-pan)
13. [Tilt](#13-tilt)
14. [Whip Pan](#14-whip-pan)
15. [Tracking / Follow](#15-tracking)
16. [Dutch Angle / Roll](#16-dutch-angle)
17. [Cinema Studio: genre & speedramp mapping](#17-cinema-studio-mapping)

Angles use `θ` for azimuth (around world Y) and `φ` for elevation.
`lerp(a,b,u) = a + (b-a)*u`.

---

## 1. Orbit 360
**Higgsfield:** ORBIT 360. A full horizontal circle around a static subject.

```
θ(u) = θ0 + 2π·u
position = [ R·sin θ(u), H, R·cos θ(u) ]
target   = [ 0, H_target, 0 ]
fov      = const
```
- **Easing:** `linear` (a constant orbit reads as mechanical/elegant; add a hair
  of `easeInOutSine` for a hand-operated feel).
- **Duration:** 6–10 s.
- **Notes:** For a partial arc (e.g. 120° hero reveal) sweep `θ0 → θ0 + arc`.

## 2. Turntable
**Higgsfield:** 3D RENDER, CGI BREAKDOWN, ORBITAL PRESENCE. Product/character
showcase: an orbit, usually with a slight push-in and a small elevation drift so
it doesn't feel flat.

```
θ(u) = θ0 + arc·u                     // arc often 2π, or 1.5π for a "reveal"
R(u) = lerp(R_start, R_end, u)        // small push-in, e.g. R*1.15 -> R*0.9
φ(u) = lerp(φ_low, φ_high, u)         // subtle rise, e.g. 8° -> 18°
position = spherical(R(u), θ(u), φ(u))
target   = subject center
```
- **Easing:** `easeInOutSine`.
- **Duration:** 5–8 s.
- **Notes:** Pair with rotating key lights for the "software render" look.

## 3. Float Spin
**Higgsfield:** FLOAT SPIN. The *subject* rotates 360° in place; the camera is
static. This is an **object** animation, not a camera move — the "move" here
returns a constant camera and instead drives a target object's `rotation.y`.
The module exposes it as `floatSpin(object)` rather than a camera `f(u)`.
- **Easing:** `linear`.
- **Duration:** 4–6 s.
- **Notes:** Add a gentle vertical bob (`object.position.y += sin(2π u)*A`) for
  the "levitate" feel.

## 4. Push-in
**Higgsfield:** slow Push-in (tension beat). Camera translates straight toward
the subject along the view axis; FOV fixed.

```
R(u) = lerp(R_start, R_end, u)        // e.g. 6 -> 3
position = [0, H, R(u)]               // along -Z toward target
target   = subject center
fov      = const
```
- **Easing:** `easeInOutCubic` (slow, deliberate).
- **Duration:** 4–8 s.

## 5. Pull-out
Reverse of Push-in (`R_start < R_end`). Great for reveals of context/scale.
- **Easing:** `easeOutCubic`.
- **Duration:** 4–8 s.

## 6. Crash Zoom
**Higgsfield:** the punchy "crash zoom" impact. A *very fast* FOV narrowing (or
fast dolly-in) that snaps onto the subject, often held at the end.

```
fov(u) = lerp(fov_wide, fov_tight, u) // e.g. 60° -> 22°
position, target = const              // pure zoom: camera doesn't move
```
- **Easing:** `easeInExpo` or a custom "fast-then-hold" (`impact`).
- **Duration:** 0.4–0.8 s (it's supposed to be abrupt).
- **Notes:** Remember `updateProjectionMatrix()`. For a "dolly crash" variant,
  animate `R` fast instead of `fov`.

## 7. Dolly Zoom
**Higgsfield / cinema:** the Vertigo / Jaws effect. Dolly the camera one way
while zooming the opposite way so the **subject stays the same on-screen size**
but the background perspective warps. This is the move people most often get
wrong, so the framing constraint is explicit.

The on-screen size of a subject of real height `h` at distance `d` through a
vertical FOV `α` is governed by `screenSize ∝ h / (d · tan(α/2))`. To keep it
constant while dollying from `d_start` to `d_end`, the FOV must satisfy:

```
tan(α(u)/2) = tan(α_start/2) · d_start / d(u)
=>  α(u) = 2·atan( tan(α_start/2) · d_start / d(u) )

d(u)     = lerp(d_start, d_end, u)          // choose the dolly, e.g. 6 -> 3
position = [0, H, d(u)]
target   = subject center
fov      = degrees( α(u) )                  // derived, do NOT lerp fov directly
```
- **Easing:** `easeInOutSine` on `u` (the *disorienting* feel comes from the
  geometry, not the easing).
- **Duration:** 2–4 s.
- **Notes:** Dolly **in** + zoom **out** (widen FOV) makes the background rush
  away; dolly **out** + zoom **in** makes it loom closer. Never `lerp` the FOV —
  compute it from `d(u)` or the subject visibly grows/shrinks.

## 8. Boom / Crane
**Higgsfield:** FAIRYTALE CASTLE lift, ELEVATE. The camera rises (or drops)
vertically while keeping the subject framed, revealing what's above/beyond.

```
y(u)   = lerp(y_start, y_end, u)      // e.g. 1.5 -> 8
position = [0, y(u), R]
target   = lerp(subject, reveal_point, u)   // optionally tilt up to a horizon
```
- **Easing:** `easeInOutCubic`.
- **Duration:** 5–9 s.
- **Notes:** Let `target` drift upward near the end to "discover" the reveal.

## 9. Earth Zoom
**Higgsfield:** EARTH ZOOM, Earth zoom in / out. Extreme scale traversal from
orbit to a close scene (or vice versa). The key is that distance must be
interpolated **exponentially** — linear interpolation over a 1,000,000× range
spends almost the whole shot at one end.

```
// zoom IN: R_start huge (e.g. 5e6), R_end small (e.g. 4)
R(u) = R_start · (R_end / R_start)^u        // geometric / log interpolation
position = [0, H_ratio·R(u), R(u)]
target   = subject center
fov      = const (or slight narrowing)
```
- **Easing:** `linear` on `u` (the exponential `R` already provides the feel);
  or `easeInOutSine` for softer ends.
- **Duration:** 6–12 s.
- **Notes:** With such range you will hit depth-buffer precision limits — use
  `logarithmicDepthBuffer: true` on the renderer, or scale the scene in stages.
  Reverse start/end for zoom-out.

## 10. Bullet Time
**Higgsfield:** frozen-moment orbit. Same path as Orbit 360 (often a fast
partial arc), but the **simulation is paused** — freeze physics/animation
mixers while the camera flies. The move is just an orbit; the "bullet time" is
what you do to the rest of the scene.

```
θ(u) = θ0 + arc·u          // arc ~ π, fast
position = spherical(R, θ(u), φ)
```
- **Easing:** `easeInOutQuart` (whip in, glide, settle).
- **Duration:** 1–2 s.
- **Notes:** In the render loop, stop advancing `mixer.update` / physics while
  the move plays; resume after.

## 11. Handheld / Shake
**Higgsfield:** SUMMER HAZE, RED CARPET, RACE TRACK (handheld / camera shake).
A **modifier** layered on top of any base move: adds smooth pseudo-random
positional and rotational noise. Implemented as a wrapper `handheld(baseMove,
{ posAmp, rotAmp, freq })` that samples value-noise so it's smooth, not jittery.

```
state   = baseMove(u)
t       = u · duration
state.position += noise3(t·freq)            · posAmp
state.roll     += noise1(t·freq + 7.0)      · rotAmp
```
- **Amounts:** subtle documentary `posAmp≈0.02·R, rotAmp≈0.5°`; energetic
  `posAmp≈0.08·R, rotAmp≈2°`.
- **Notes:** Use coherent (value/Perlin) noise, never `Math.random()` per frame,
  or it strobes.

## 12. Pan
Camera fixed; the **target** sweeps horizontally (rotate look direction about Y).

```
ψ(u) = lerp(ψ_start, ψ_end, u)
target = [ position.x + D·sin ψ(u), position.y, position.z - D·cos ψ(u) ]
```
- **Easing:** `easeInOutSine`.
- **Duration:** 3–6 s.

## 13. Tilt
Like Pan but vertical: sweep the target's elevation while the camera stays put.
- **Easing:** `easeInOutSine`. **Duration:** 3–6 s.

## 14. Whip Pan
A Pan that is *very fast* with a big angle, used as a transition. Motion blur
sells it (radial/directional blur pass, or a high-shutter motion-blur effect).
- **Easing:** `easeInOutExpo` (accelerate hard, decelerate hard).
- **Duration:** 0.25–0.5 s.
- **Notes:** Often cut at mid-blur to hide a scene change.

## 15. Tracking / Follow
**Higgsfield:** FOOTBALL INVADER, telephoto follow. Camera holds a fixed offset
relative to a **moving** subject. Not a fixed `f(u)` — it reads the subject's
current world position each frame and maintains offset + optional lag.

```
desired = subject.position + offset
camera.position.lerp(desired, 1 - exp(-k·dt))   // critically-ish damped follow
target  = subject.position + lookAhead·subject.velocity
```
- **Notes:** The module exposes `follow(camera, subject, { offset, stiffness })`
  to call inside the render loop. `stiffness` low = loose telephoto lag, high =
  locked.

## 16. Dutch Angle / Roll
A modifier that ramps `roll` (camera tilt about the view axis) for unease/style.
Combine with any base move.

```
state.roll += lerp(0, maxRoll, u)     // or hold a constant roll for the shot
```
- **Duration/easing:** match the base move.

### `reframe` and the move's own target

`reframe(move, { center, scale })` offsets the **whole state** — position *and*
target — so a move's default target is added to `center`, not replaced by it.
`turntable` defaults to `target: [0,1,0]`, so

```js
reframe(moves.turntable({ radius: 5 }), { center: [0, .7, 0] })
// -> camera orbits the right place, but aims at [0, 1.7, 0]
```

Zero the move's target when you are going to reframe it:

```js
reframe(moves.turntable({ radius: 5, target: [0, 0, 0] }), { center: [0, .7, 0] })
```

The symptom is a shot that looks almost right and frames slightly high — easy to
mistake for a composition choice, and caught immediately by a framing audit.

---

## 17. Cinema Studio mapping

The Higgsfield Cinema Studio parameters map cleanly onto this system, which is
useful when the user asks for a *look* rather than a named move.

### speedramp → easing
| speedramp | easing to use | feel |
|---|---|---|
| `linear` | `linear` | constant, mechanical |
| `slowmo` | `easeOutCubic` / long tail | decelerate into a held beat |
| `speedup` | `easeInCubic` | accelerate away |
| `impact` | `easeInExpo` then hold | snap + freeze (crash zoom, hits) |
| `custom`/`auto` | pick per beat | — |

### genre → base parameters
| genre | base FOV | shake (handheld) | cut rhythm | typical path |
|---|---|---|---|---|
| action | 40–55° | medium–high | fast cuts | Crash Zoom, Bullet Time, tracking |
| horror | 30–45° | low, creeping | long holds | slow Push-in, Dutch angle |
| suspense | 35–50° | low | slow | Push-in, slow Pan |
| intimate | 50–70° | very low | few cuts | slow Push-in, gentle Orbit |
| western | 25–40° (long lens) | none | slow | wide Pull-out, Boom reveal |
| comedy | 45–60° | low | snappy | Whip Pan, Crash Zoom |
| spectacle | 20–35° (wide/anamorphic) | low | sweeping | Boom/Crane, Earth Zoom, Orbit |
| auto | 45° | none | — | choose by story beat |

### story beat → path (quick picker)
- **Reveal / establish** → Boom-Crane, Pull-out, Earth Zoom out.
- **Impact / punch** → Crash Zoom, Whip Pan.
- **Tension / dread** → slow Push-in, Dutch angle.
- **Showcase / product** → Turntable, Orbit 360.
- **Disorient** → Dolly Zoom.
- **Energy / chase** → Tracking + handheld.
