# Blocking Scenes — method

How to build a blocking pass in Three.js: what it is for, the conventions that
make it readable, the CSG rules that decide whether a cut works, the three audits
that replace eyeballing, and the determinism contract that lets Remotion render it.

## Table of contents

1. [What a blocking scene is for](#1-what-a-blocking-scene-is-for)
2. [Colour is identity](#2-colour-is-identity)
3. [Naming and groups](#3-naming-and-groups)
4. [Stages, and a backup per stage](#4-stages)
5. [The primitive vocabulary](#5-the-primitive-vocabulary)
6. [CSG: making the cuts work](#6-csg)
7. [The three audits](#7-the-three-audits)
8. [Camera: use the moves catalog](#8-camera-use-the-moves-catalog)
9. [Determinism: the Remotion contract](#9-determinism)
10. [Worked example](#10-worked-example)
11. [What to leave out](#11-what-to-leave-out)

---

## 1. What a blocking scene is for

A blocking scene answers three questions and no others: **what is where, when
does it move, and how is it framed.** It is not a look-development pass and it is
not supposed to be pretty. Everything that would make it pretty — textures,
materials, lighting design, depth of field — costs time to author and, worse,
*hides structural mistakes behind surface appeal*.

Two things consume a blocking scene:

- **You**, judging timing and staging while corrections still cost one number.
- **A video model**, which receives the render as a motion reference. It supplies
  the texture and the light; what it cannot invent reliably is consistent spatial
  relationships and timing. That is exactly what blocking pins down.

This is the same division of labour a 3D animatic serves in a DCC. Doing it in
Three has one concrete advantage for this pipeline: the scene is *code*, so the
audits below are functions you run, not judgements you make.

## 2. Colour is identity

Every part gets a colour from a **registered, named palette**, and the name is the
vocabulary you then direct in.

```js
const ctx = createBlocking({ subjectSize: .09 });
ctx.defineIdentity({ kraft:'#8a6136', cream:'#f5efe0', soaked:'#5c3316' });
ctx.part('PRP_wall', geometry, 'kraft', ctx.groups.PRP);
```

The palette belongs to the context, not to the module. Two scenes built in the
same process — a film, the audit gate, a Remotion worker rendering more than one
composition — keep their own colours and their own `get()`.

This is not decoration, and it does two distinct jobs:

- **It makes an untextured scene readable.** A grey cross-section is a blob; the
  same cross-section with a dark band for soaked biscuit and a pale band for cream
  is legible at a glance — and legible to the model, which reads those bands as
  "these are different materials" rather than one object.
- **It gives you names to direct with.** Once six characters are red, green, blue,
  yellow, purple and cyan, you can write *"cyan over blue's shoulder, green stays
  the near mass"* and it is unambiguous. Identity colour turns the palette into a
  cast list.

Use `MeshLambertMaterial` (the default, `shaded: true`) so form still reads
through shading, or `MeshBasicMaterial` (`shaded: false`) for pure flats when you
want the silhouette only.

**Colours are authored in sRGB hex and Three converts them.** If a colour renders
lighter than the picker suggested, that is colour management, not a wrong hex —
pick against the render, not against the swatch.

## 3. Naming and groups

Five groups, always: `ENV` environment, `PRP` props, `CHR` characters, `CAM`
cameras, `LGT` lights. Parts are named with the group as a prefix.

```
ENV_floor   PRP_wall   PRP_L03_biscuit   CHR_person_01   CAM_SC02   LGT_key
```

The point is that the scene becomes **addressable by string**. `get('PRP_L03')`
instead of threading a reference through five function calls, and audits can
report `PRP_wall x PRP_L01` instead of `Mesh x Mesh`. When a scene has 130 objects
this is the difference between a report you can act on and one you cannot.

## 4. Stages

Build in stages, and **save a copy after each one**. Blocking → props → camera →
motion polish. Each stage is judged on its own before the next is layered on.

The reason is not tidiness. Later stages *mask* earlier mistakes: once a camera
is moving and there is handheld on top, a staging error reads as "something feels
off" rather than "the hero is 4 cm inside the table". Freeze the stage, audit it,
then move on.

Serialise with `scene.toJSON()` or just keep the authoring script under version
control — the scene is code, so a commit per stage is the backup.

## 5. The primitive vocabulary

Deliberately small. Anything more specific is a combination.

| Helper | Makes | Used for |
|---|---|---|
| `revolve(profile)` | solid of revolution (`LatheGeometry`) | cups, glasses, bottles, rims — the workhorse |
| `cupProfile()` | a **closed** walled-cup profile | anything you intend to cut |
| `cone()` | truncated cone / cylinder | tapered bodies, discs |
| `ellipsoid()` | squashed sphere | biscuits, beans, pebbles |
| `box()` | cube | slabs, furniture, proxies |
| `rim()` | torus | lips, rings, orbits |
| `stack()` | tapered layers, bottom to top, no gaps | cross-sections |
| `sandwich()` | three discs, outer/inner/outer | anything with a filling |
| `cluster()` | seeded cloud of spheres | powder, splash, debris |

`revolve` deserves the emphasis: most product blocking is a profile spun around an
axis, and a profile is six points you can reason about, versus a mesh you have to
model. Reach for it first.

For characters, seated or standing proxies out of `box` + `ellipsoid` are enough —
the identity colour does the work of telling them apart, not the geometry.

## 6. CSG

Cuts are what make blocking earn its keep: the cross-section reveal, the object
split into slices. `three-bvh-csg` handles them, with one hard requirement.

**Brushes must be two-manifold — watertight, no self-intersection.** An open shell
produces garbage, silently. This is why `cupProfile` returns a *closed* profile
that goes up the outside, across the rim, down the inside and along the base:
it is a solid, so it can be cut.

```js
const [back, front] = halve(cup, 'z');          // cross-section reveal
const slices = bands(cup, 'y', [0.030, 0.038]); // three horizontal slices
```

Practical rules:

- **`halve` returns `[negative, positive]`** along the given world axis, both
  carrying the original identity, and removes the source from its parent.
- **`bands` drops empty slices.** A cut plane outside the object's extent produces
  no geometry; getting back two slices instead of three means a cut fell outside,
  which is worth noticing rather than silently carrying a degenerate mesh.
- **Cut before you position.** The helpers work in world space via
  `updateMatrixWorld`, but the mental model is far simpler if a part is cut at the
  origin and placed afterwards.
- **Cutting is not free.** It is a build-time operation, not something to run per
  frame. Cut once, keep the result, animate the halves.
- **Watch insets against wall thickness.** A layer inset by less than the wall
  thickness pokes through the wall. See the worked example — the audit catches it,
  but knowing the failure mode saves a round trip.

## 7. The three audits

Blocking is validated by measuring. Each audit catches a class of error that looks
fine in a still and is obvious — too late — in motion.

### `auditCollisions(meshes, { ignore, ignoreAdjacent })`

Which meshes actually interpenetrate. Broad-phase on world AABBs, then exact
triangle-level through `three-mesh-bvh`. Returns `[{ a, b }]` by name.

Catches: a camera path through a solid, a prop inside the hero, a layer poking
through a wall. `stack` tags its layers so neighbours touching by design are not
reported; pass `ignore: [['A','B']]` for other intentional contacts.

### `auditFraming(meshes, camera)`

Projects every mesh's bounding box into NDC and returns the **overshoot** — how
far outside the frame the worst corner lands. `0` means everything is inside.

Catches: the hero clipped at the frame edge. This is the one that finds problems
you cannot see while authoring, because the authoring viewport is not the render
aspect. Sample it at the extremes of every shot, not once.

The usual fix is to scale the camera path away from its target — the move is
preserved and only the air around the subject changes. Tightening the lens instead
changes the perspective, which changes the shot.

### `auditFloor(meshes, { y })`

The lowest point in the scene. Catches things sinking through the ground plane —
which happens constantly the moment anything rotates about a pivot that is not at
its base.

### Subjects vs scenery

Audits run on **subjects**, not on everything. Floors and walls are supposed to
run past the frame edge and supposed to be touched by everything resting on them,
so including them buries the real findings under noise — measured on a six-person
round table, auditing the whole scene produced twenty collision pairs, of which
fourteen were "things are on the floor".

```js
ctx.subjects()                       // every mesh except the ENV group
ctx.subjects({ exclude: ['ENV', 'BG'] })
```

`auditShots` uses `subjectsOf` by default. Pass `exclude: []` to audit literally
everything, which is occasionally what you want when the environment itself is
the thing being staged.

### Declaring intentional contact

Resting, seating and stacking are contact by design. Declare them rather than
lowering the threshold, so the pair is documented as intended instead of hidden.
`ignore` accepts `*` wildcards, which keeps a six-seat table to one line:

```js
auditCollisions(ctx.subjects(), { ignore: [['PRP_chair_*','CHR_*']] });   // []
```

The same list passes straight into `auditShots({ ignore })`. Anything not
declared is a finding — which is the point.

### Running them across a timeline

```js
const report = auditShots(scene, camera, shots, { samples: 5 });
```

Samples each shot at its extremes over the subjects, and reports the worst
framing, the worst floor breach and every collision pair with the frame it
happened on. A real run on the round-table scene: collisions clean, floor clean,
and `CHR_green` leaving frame at f90 — one actionable line out of a scene that
looked fine while authoring. This is the
pre-render checklist: **all three clean before you spend a render.**

Shot ranges are half-open — `{ from: 0, to: 60 }` owns frames 0–59 and frame 60
belongs to the next shot. Sampling the boundary frame would measure the *next*
shot's camera and blame this one; `auditShots` samples `to - 1`.

## 8. Camera: use the moves catalog

**This skill does not own camera paths.** They come from the `threejs-camera-moves`
skill — orbit, turntable, dolly zoom, crash zoom, boom, handheld, and the
genre/speedramp vocabulary — and `assets/shots.js` is the bridge between the two.

The split is deliberate:

| | owns |
|---|---|
| `cameraMoves.js` | the **path**: `move(u) -> { position, target, fov, roll }`, easings, `applyState` |
| `shots.js` | the **timeline**: which shot owns which frame, hard cuts, per-shot lens |
| `blocking.js` | the **scene**: geometry, identity, the audits |

`cameraMoves` thinks in seconds and blends; an animatic thinks in frames and cuts.
That gap is all `shots.js` fills.

```js
import { moves, handheld, reframe } from './cameraMoves.js';
import { shotList, applyFrame, auditShots, formatReport } from './shots.js';

const shots = shotList([
  { name: 'SC01_wide', from: 0, to: 450, focalLength: 28, easing: 'easeInOutSine',
    hero: 'PRP_table',
    //  reframe adds `center` to BOTH position and target, so zero the move's
    //  own target or turntable's default [0,1,0] leaks in and the camera aims high
    move: reframe(moves.turntable({ radius: 5, pushIn: .95, arc: Math.PI * 1.1, target: [0, 0, 0] }),
                  { center: [0, .7, 0] }) },

  { name: 'SC02_ots', from: 450, to: 540, focalLength: 85, easing: 'linear',
    hero: 'CHR_green_head',
    move: handheld(reframe(moves.pushIn({ from: 3, to: 2.2, height: .25 }),
                           { center: headPos }), { posAmp: .01 }) },
]);

applyFrame(camera, shots, frame);
```

If a move you need is missing, **it belongs in the moves catalog**, not here.
Adding it there keeps it usable in a live Three scene as well as an animatic.

### `hero`: what must stay in frame

The framing audit runs against the shot's `hero` — a name or wildcard, or a list.
Without one it measures every subject, which is right for a wide and wrong for
everything else: in an over-the-shoulder or a close-up the rest of the cast is
*supposed* to leave frame, and auditing all of them reports enormous overshoot
for a shot that is perfectly composed.

`hero` is the shot's directorial statement — "the hero always in frame" made
measurable. Measured on the round-table scene:

```
ok   SC01_wide  [0-450)   framing 0.000 [hero PRP_table]
ok   SC02_ots   [450-540) framing 0.000 [hero CHR_green_head]
ok   SC03_crash [540-570) framing 0.000 [hero CHR_green_head]
```

Declaring `hero: ['PRP_table','CHR_*']` on that same wide instead **fails** at
0.769 — because in a close orbit the nearest character genuinely is cut off
vertically. Both answers are correct; `hero` is how you say which question you
are asking.

The wide above also needed tuning to reach 0.000: `turntable`'s default
`pushIn: 0.85` closes the orbit by 15% and the table stopped fitting at the end
of the arc (overshoot 0.215, worst at the last frame). `pushIn: .95` and a wider
radius fixed it. That is the loop this whole file exists for — the audit names the
frame and the object, and the fix is one parameter.

This is also why `figure()` returns parts rather than one mesh: keeping the head
separate gives you a hero for over-the-shoulder framing that the whole body
cannot be.

## 9. Determinism

If this scene is going to be rendered by Remotion, or used as a one-to-one motion
reference, it must be a **pure function of the frame number**.

```js
applyFrame(camera, shots, frame);   // same frame in -> same state out. Always.
```

Rules that follow from that, all of them non-negotiable:

- **Never read a clock.** No `getDelta()`, no `state.clock.elapsedTime`, no
  accumulating `position.x += speed`. Out-of-order frames and re-renders will
  drift, and Remotion renders frames out of order across workers.
- **Never `Math.random()`.** Use the seeded `mulberry32(seed)`. A cloud of debris
  must land in the same place on every render.
- **Visibility is a function of frame too** — `applyVisibility(scene, spans, frame)`,
  not a mutation you toggle once.
- **In R3F, drive from props.** `<ShotCamera frame={frame} />` reading
  `useCurrentFrame()`, never `useFrame`. Use `frameloop="demand"` while authoring.
- **`@remotion/three`'s `ThreeCanvas`** pins the loop and waits for the draw before
  capturing. Anything animated outside that contract tears between preview and
  render.

The shot list itself is plain data — `{ name, from, to, move, easing }` — where
`move(u) -> { position, target, fov, roll }` is the same signature the cinematic
camera-move catalog uses, so moves are portable between the two.

## 10. Worked example

Rebuilding a 9 cm product cup, cut open, and finding a real bug:

```js
const ctx = createBlocking({ subjectSize: 0.09, aspect: 21/9 });
ctx.defineIdentity({ kraft:'#8a6136', cream:'#f5efe0', biscuit:'#8f5527',
                     soaked:'#5c3316', cocoa:'#4c1f13' });

const R_BOT = 0.0375, R_TOP = 0.045, H = 0.07, THICK = 0.0015, BASE = 0.002;

ctx.part('PRP_wall',
  geo.revolve(geo.cupProfile({ rBottom: R_BOT, rTop: R_TOP, h: H,
                               thickness: THICK, base: BASE })),
  'kraft', ctx.groups.ENV === undefined ? undefined : ctx.groups.PRP);

const rAt = (y) => R_BOT + (y / H) * (R_TOP - R_BOT);
ctx.parts(geo.stack({                       // stack returns descriptors; ctx.parts builds them
  layers: [ { name:'L01', t:.014, identity:'soaked' }, { name:'L02', t:.008, identity:'cream' },
            { name:'L03', t:.014, identity:'biscuit' }, /* ... */ ],
  rAt, inset: THICK + 0.0003, y0: BASE,      //  <-- both of these matter
  prefix: 'PRP_',
}));

const [back, front] = halve(ctx.get('PRP_wall'), 'z');

auditCollisions(ctx.subjects());
// [{ a: 'PRP_wall', b: 'PRP_L01' }]   <- the base layer *sitting on* the floor
```

Three things this example encodes, all found by measuring rather than looking:

- **`inset` smaller than `THICK`** puts the layers inside the cup wall — here by
  0.3 mm, which no render will ever show you. Reported as `PRP_wall x PRP_L01`.
- **`y0: 0` instead of `y0: BASE`** starts the bottom layer below the cup's inner
  floor, so it pokes out through the base. Invisible from outside; you find it
  once the cup is cut open, which may be twenty iterations later.
- **Coplanar contact counts as an intersection.** With `y0: BASE` the layer's
  bottom face lands exactly on the cup's inner floor, and triangle-level testing
  reports touching faces as intersecting — which is why the example above still
  returns one pair. That is correct behaviour and often useful (it tells you two
  parts share a face), but for contact that is intentional, either declare it:

  ```js
  auditCollisions(meshes, { ignore: [['PRP_wall', 'PRP_L01']] });   // []
  ```

  or leave a deliberate hairline gap (`y0: BASE + 0.0001`). Declaring it is
  usually better: the pair is then documented as intended rather than hidden.

`stack` already declares this for its own layers — neighbouring bands touch by
design and are skipped unless you pass `ignoreAdjacent: false`.

## 11. What to leave out

Things that belong to the generation pass, not to blocking:

- **Textures and real materials.** The model supplies them, guided by reference
  photos of the actual product.
- **Chaos.** Swarms of particles, splashes, debris streams flying through frame —
  a video model does these better unprompted than you will block them, and they
  eat authoring time for nothing. Block the *geometric* beats: exact cuts,
  positioned clones, specific framings, the hand-off of a pour.
- **Fine detail on props.** A sandwich cookie is three discs. Embossing it is time
  spent on something the model will overwrite.
- **Logos and text.** Generated text is unreliable; composite it afterwards.

The test for whether something belongs in blocking: *would a model get this wrong
if left to itself, and would that be obvious?* Spatial relationships and timing,
yes. Surface and turbulence, no.
