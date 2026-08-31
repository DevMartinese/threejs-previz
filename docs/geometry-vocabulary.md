# Geometry Vocabulary

**Every shape lives in `geometry.js`.** There is no second module to check.
Helpers return plain `BufferGeometry`; the ones describing several coloured parts
— `stack`, `sandwich`, `cluster`, `figure` — return **descriptors**
(`[{ name, geometry, identity, position?, meta? }]`) which `ctx.parts()` turns
into named meshes. That keeps this module free of any dependency on the scene.

How to build blocking shapes in Three. The point of this file is **choosing the
right construction**: most blocking geometry is one of seven ideas, and picking
the wrong one turns a two-line shape into an afternoon of mesh editing.

## Table of contents

1. [Choosing a construction](#1-choosing-a-construction)
2. [Curves and sweeps](#2-curves-and-sweeps)
3. [2D shapes and extrusion](#3-2d-shapes-and-extrusion)
4. [Shells and walls](#4-shells-and-walls)
5. [Deformers](#5-deformers)
6. [Layout](#6-layout)
7. [Instancing](#7-instancing)
8. [Assemblies](#8-assemblies)
9. [Utilities](#9-utilities)
10. [Determinism](#10-determinism)

---

## 1. Choosing a construction

| The shape is… | Use | Example |
|---|---|---|
| symmetrical around an axis | `revolve()` | cup, glass, bottle, vase, moka body |
| a flat footprint with thickness | `extrude()` | slab, plate, sign, floor tile, letter |
| a cross-section travelling along a path | `sweep()` | pour, cable, trail, stream, pipe |
| a hollow cylinder | `wall()` | room, arena, silo, tube |
| a stack of bands | `stack()` | layered cross-section |
| many copies of one thing | `radial()` / `grid()` / `scatter()` + `instances()` | clones, crowd, debris |
| a rough organic blob | primitive + `roughen()` / `lobed()` | biscuit, rock, fruit |
| a character or furniture | `figure()` / `chair()` / `table()` | seated proxies, sets |

The two that get missed most often are **`revolve`** and **`extrude`**. Between
them they cover a large majority of props, and both are authored as a handful of
2D points rather than a mesh. Reach for those before reaching for CSG.

**CSG is for cuts, not for construction.** Subtracting a cylinder from a box to
make a hole works, but `extrude` with a hole is cheaper, more robust and stays
watertight. Save the booleans for cross-sections and slices, where there is no
alternative.

### When the helper doesn't exist: compose it

The named helpers are conveniences, not the vocabulary. The vocabulary is the
closed set underneath — primitives (`cone`, `box`, `ellipsoid`, `rim`, `disc`),
generators (`revolve` + profiles, `extrude` + shapes, `sweep` + curves),
deformers, and the composition ops: **`.translate()` / `.rotateX()` /
`.scale()` on any geometry, and `merge()`** to weld several into one mesh.
Anything blockable is reachable from that set; a helper like `sandwich()` is
just a saved composition (three translated cylinders — if it didn't exist you
would write it in build in four lines).

A worked example that is not in the catalog anywhere — a moka pot, one mesh,
one identity, built from three faceted cones:

```js
ctx.part('PRP_moka', geo.merge([
  geo.cone({ rBottom: .035, rTop: .02,  h: .05,  segments: 8 }).translate(0, .025,  0),
  geo.cone({ rBottom: .02,  rTop: .03,  h: .045, segments: 8 }).translate(0, .0725, 0),
  geo.cone({ rBottom: .008, rTop: .005, h: .01,  segments: 8 }).translate(0, .1,    0),
]), 'steel');
```

`segments: 8` is what makes it read as a moka rather than a vase — the facets
carry the identity. Two rules keep compositions healthy:

- **Author at the origin, place with the mesh.** Translate geometry only to
  arrange parts *within* the composition (the moka's three cones); position
  the finished part with `mesh.position`, so animation and CSG stay simple.
- **`merge()` when it shares one identity, separate parts when it doesn't.**
  One mesh = one colour and one audit name. A composition with two materials
  (a cookie's shell and fill) is separate `ctx.part`s posed together — that is
  also what lets an audit report `PRP_ck0_fill` instead of `Mesh`.

If a composition earns its keep across scenes, promote it into `geometry.js` —
that is how everything already in this file got here.

## 2. Curves and sweeps

```js
const path = curve([[0, .28, 0], [.02, .20, 0], [.05, .12, 0]]);
const pour = sweep(path, { r0: .004, r1: .012 });   // narrow at the top, wide at the bottom
```

`sweep` runs a circular cross-section along a curve and tapers it from `r0` to
`r1`. It is the pour / stream / cable primitive, and the thing most people build
badly by hand out of stretched cylinders.

For a non-linear section pass `profile(u)`:

```js
sweep(path, { profile: (u) => .01 * (1 + Math.sin(u * Math.PI)) });  // bulges in the middle
```

Supporting helpers:

- **`arcPath(from, to, { height })`** — a ballistic arc. Droplets, thrown objects,
  anything that leaves one place and lands in another.
- **`alongCurve(path, count, { jitter, seed })`** — evenly spaced transforms along
  a curve, each with its `tangent`. Beads on a string, a frozen stream of drops,
  footsteps on a route.
- **`helix({ radius, height, turns, taper })`** — spirals, and camera rails that
  climb while they orbit.

Curves are also useful as *camera paths*: `path.getPointAt(u)` is exactly the
`move(u)` signature a shot list wants, so a hand-shaped flythrough is
`(u) => ({ position: path.getPointAt(u).toArray(), target })`.

## 3. 2D shapes and extrusion

`roundedRect`, `polygonShape` and `starShape` return `Shape`s; `extrude` turns
them into solids.

```js
const slab = extrude(roundedRect({ w: 1, h: .6, r: .1 }), { depth: .08, bevel: .01 });

const ring = extrude(polygonShape({ sides: 8, radius: .5 }), {
  depth: .1,
  holes: [hole(polygonShape({ sides: 8, radius: .3 }))],
});
```

Notes worth knowing:

- **Holes beat booleans.** `holes` are subtracted during triangulation, so the
  result is clean and watertight. A CSG subtraction for the same thing is slower
  and can leave you with a non-manifold mesh that then refuses to be cut.
- **`extrude` lies the result flat by default** (rotated onto the XZ plane) and
  centres it, because slabs and floors are what you usually want. Pass
  `standing: true` to keep it facing +Z, for signage and letters.
- **A small `bevel` reads well even in flat colour** — it catches the light and
  separates a slab from the floor. Keep it under a tenth of the depth.

## 4. Shells and walls

```js
const room = wall({ radius: 2, height: 1, thickness: .03 });        // full cylinder
const halfRoom = wall({ radius: 2, height: 1, arc: 180 });          // open on one side
```

`wall` is a lathed hollow cylinder — closed and two-manifold, so it can be cut.
A partial `arc` leaves an opening, which is how you build an interior that the
camera can see into.

**Lathe sweeps in XZ starting from +Z**, so `x = r·sin(θ)` and `z = r·cos(θ)`.
The practical consequence: a 180° wall spans the **full diameter in Z** and only
the **radius in X** — measured on a radius-2 wall, 2.00 × 4.00, not 4.00 × 2.00.
If the opening faces the wrong way, rotate the object rather than fighting the
arc.

`gridBars()` builds the floor reference grid out of merged thin boxes. Real
geometry rather than `GridHelper` on purpose: it renders in the animatic, casts
into the render, and reads as part of the scene to a video model.

## 5. Deformers

`taper`, `twist`, `bend` and `roughen` operate on vertices in place, and turn a
primitive into something with character without leaving the blocking idiom.

```js
taper(new CylinderGeometry(.5, .5, 1, 24, 8), { factor: .3 });
lobed({ length: .09, width: .026, height: .016, lobes: 3 });   // biscuit silhouette
```

**The one thing that will bite you: deformers need tessellation.** They move
vertices, so a shape with no interior vertices cannot deform. Measured:

```
twist(BoxGeometry(1,1,1),        { angle: 90 })  ->  unchanged
twist(BoxGeometry(1,1,1,4,8,4),  { angle: 90 })  ->  bbox 1.41, a real twist
```

A default `BoxGeometry` has eight corners; rotating them by 90° maps corners onto
corners and nothing happens. Always pass segment counts to any primitive you
intend to deform — `BoxGeometry(w, h, d, 4, 8, 4)`,
`CylinderGeometry(r, r, h, 24, 8)`.

`roughen` is seeded and additive along the vertex normal. Keep `amount` small —
past a couple of percent of the object's size it stops reading as irregularity
and starts reading as a broken mesh.

## 6. Layout

Layout helpers return plain transforms `{ position, rotation, scale, index }`
rather than objects, so the same distribution can drive meshes, instances or
camera targets. `place(object, t)` applies one.

```js
radial(5, { radius: .17, from: 15, to: 150 })      // a fan behind the hero
  .forEach((t, i) => place(clones[i], t));

radial(6, { radius: 1 })                            // a full ring
grid(4, 3, { spacing: .5, jitter: .02, seed: 7 })
scatter(40, { bounds: [.3, .2, .3], seed: 3, scaleRange: [.7, 1.2] })
```

**Full circles do not duplicate the endpoint.** `radial(6, { from: 0, to: 360 })`
returns 0°, 60°, … 300° — not 0° and 360° on top of each other. A partial arc
*does* include both ends, because a fan from 15° to 150° should reach 150°. This
distinction is the difference between a clean ring and two clones occupying the
same spot.

`faceCentre` (default on) turns each transform to look at the centre, which is
what you want for chairs around a table and wrong for objects that should keep a
common orientation.

## 7. Instancing

```js
const beans = instances(beanGeo, material, scatter(200, { seed: 3 }), { name: 'PRP_beans' });
```

One draw call for many copies. Worth it above roughly fifty repeats.

**But the audits do not see instances.** `auditCollisions`, `auditFraming` and
`auditFloor` walk meshes; an `InstancedMesh` reports as a single object with the
bounding box of its source geometry, so per-instance framing and collisions are
invisible to them. Keep hero objects and anything whose position you actually
care about as real meshes, and reserve instancing for background multiplicity
where being slightly wrong does not matter.

## 8. Assemblies

`figure({ height, seated })` returns geometry parts keyed by name — `torso`,
`head`, `arms`, `legs` — rather than a finished object, so each can take its own
identity colour, or all be merged into one:

```js
const p = figure({ height: 1.7, seated: true });
part('CHR_person_01', merge(Object.values(p)), 'red', groups.CHR);
```

Keeping them separate is worth it when the head needs to be a different colour, or
when the arms will be animated. Merging is worth it when the figure is one
silhouette in a crowd.

`chair({ column })` and `table({ radius, height })` are the furniture equivalents.
Combined with `radial`, a six-person round table is about eight lines.

Remember what carries the read: **identity colour, not geometry.** A seated proxy
only has to have the right silhouette and the right colour. Detailing it is time
spent on something the generation pass will overwrite.

## 9. Utilities

- **`merge(geometries)`** — one mesh, fewer draw calls, and one object for the
  audits to report on. Merge sub-parts that never move independently.
- **`hull(geometryOrPoints)`** — convex hull. Quick collision proxies, and a fast
  way to turn a scatter of points into a solid.
- **`fitTo(geometry, size)`** — uniform scale so the largest dimension matches.
  Useful when an imported or generated shape arrives at the wrong scale.
- **`groundAtOrigin(geometry)`** — centre in X/Z, base at `y = 0`. Run it on every
  prop and the floor audit stops finding things you did not mean to sink.

## 10. Determinism

Every helper that could be random takes a `seed` and uses `rng(seed)`. Nothing in
this module calls `Math.random()`.

This is not tidiness — it is the contract that makes the scene renderable. A
Remotion render evaluates frames out of order and across workers; if a scatter
re-rolls, the debris teleports between frames. Same seed, same layout, every
time, in every process.

If you add your own helper to this module, take a `seed` parameter. There is no
case in a blocking scene where genuine randomness is what you want.
