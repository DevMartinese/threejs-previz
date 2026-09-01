# Parameters — the knobs a scene declares

A scene is a pure function of the frame. Parameters do not change that; they
make it a pure function of **(params, frame)**, where the parameters are fixed
for a whole render and resolved once, at build time.

They exist because of a specific failure in how this repo was built. Almost
every number in these scenes — the dome radius, the speed at the midpoint of
the rise, how far the clones fan out — was found by editing a file, running the
audit, rendering, looking, and editing again. That loop is minutes long and
most of it is spent waiting. The knob panel is that loop, at 90 milliseconds,
with the gate still standing at the end of it.

---

## Declaring them

```js
export default defineScene({
  id: 'orbital',
  params: {
    dipDepth: { value: -3.6, min: -8, max: -1.5, step: 0.1, unit: 'm',
                note: 'how far under the floor the camera sinks' },
    apex:     { value: 78, min: 20, max: 86, step: 1, unit: 'deg' },
    lights:   { value: true },
    grade:    { value: 'night', options: ['day', 'dusk', 'night'] },
  },
  build: ({ ctx, geo, p }) => { /* p.dipDepth, p.apex, … */ },
  animate: ({ ctx, frame, p }) => { /* … */ },
  shots: (p) => [ /* … */ ],
});
```

Three kinds: **number** (a slider), **boolean** (a checkbox), **enum** (a
select, declared with `options`). `label` and `note` are optional; the note is
printed under the control, and it is the right place for what you learned the
hard way about that number.

A number **must** declare `min` and `max`. Not because the maths needs them,
but because a knob without a range is an invitation to drag it until the shot
breaks and then widen the audit to match. The range is the author stating what
the scene is still the scene inside.

`build`, `animate` and `shots` all receive the resolved values. `shots` may be
a plain array when no knob moves the camera, or a function of `p` when one
does. The resolved set is also on the context as `ctx.params`, which is why
adding parameters changed no downstream signature: `ctx` was always the scope,
and the parameters are part of it.

### The duration may not vary

`durationInFrames` is composition metadata — Remotion reads it before any props
exist. A parameter that shortened the shot list would render frames past the
end of the move, silently, as a freeze on the last pose. `defineScene` measures
the list for every parameter set and throws if the duration moved. A knob that
wants a different length is a different scene.

---

## Turning them

```bash
pnpm inspect
```

The panel on the right is **lil-gui**, generated entirely from the declaration
— there is no list of controls anywhere in the inspector. A scene that declares
a knob gets a control (a slider for a number, a checkbox for a boolean, a select
for an enum), its `unit` goes in the label, its `note` becomes the tooltip, and
a value that has left its declared default is highlighted. A scene that declares
none gets a panel that says so.

Turning a knob calls `def.make(params)`, the same build the renderer runs, and
redraws the camera path from the shot list those values imply. It is a rebuild,
not a nudge: what you are looking at is always a scene that could be rendered
as it stands. The camera itself stays read-only. Nothing in the inspector can
drag a camera into a pose, because the moment a camera is placed by eye instead
of by a move, the pipeline has lost what it is for.

Two ways out, because a value found by dragging is worth nothing until it
leaves the browser:

**copy render command** — the audit and the render, joined by `&&`, with the
tuned values on both:

```bash
pnpm exec node lib/auditScenes.mjs src/scenes/orbital.js --params='{"apex":68}' \
  && pnpm exec remotion render orbital out/orbital.mp4 --props='{"params":{"apex":68}}'
```

**save to scene file** — writes those values into the scene file's own
`params:` block and then runs the gate on what it wrote, showing you the
report. This is the one that makes a change permanent. (**copy params block**
puts the same text on the clipboard if you would rather paste it yourself.)

---

## The round trip

The workflow this is built for is a conversation, not a session:

1. You ask for a scene. It gets built, audited, rendered.
2. Something is off. You open `pnpm inspect`, turn the knob, save.
3. You say *"carry on from what I changed."*

Step 3 only works because step 2 wrote to the file. A value that lives in a
browser tab is invisible to git, to whoever you hand the project to, and to an
agent you ask to continue — which can read files and cannot read your tab.
That is the whole reason the panel writes back instead of only printing a block
to paste: **the repo is the handoff.**

The same holds in the other direction. Edit a scene file by hand and the
inspector picks it up: it stores, alongside each scene's tuning, the defaults
that tuning was based on, and drops any knob whose default has since moved.
The file wins. You are never quietly handed back the number you just replaced.

What the writeback will NOT do:

- touch anything but the top-level `params: { … }` block — your build, your
  shots and the comments explaining why a number is what it is are untouched,
  because a tool that rewrites whole files eventually eats a comment somebody
  needed;
- write outside `src/scenes/*.js`;
- change a *declaration*. It parses the incoming block, re-declares it and
  compares field by field: ranges, units, labels and notes must survive
  untouched or nothing is written. (The first version of the generator dropped
  `label`, which would have silently deleted every custom label in the file.
  Widen a range by editing the scene, where the change is reviewable.)
- exist outside the dev server. The plugin is `apply: 'serve'`.

It *will* save values that fail the gate — the file is your working state, and
a panel that refuses to save is a panel that fights you — but the report comes
back red and every render script stays shut until you fix it.

---

## Films

A film is an edit of scenes, so a film's knobs are its scenes' knobs, keyed by
scene id. Nothing is declared at the film level:

```bash
pnpm exec node lib/auditScenes.mjs src/film.js \
    --params='{"opening":{"tilt":80},"roundtable":{"orbitRadius":3.6}}' \
  && pnpm exec remotion render feature out/feature.mp4 \
    --props='{"params":{"opening":{"tilt":80},"roundtable":{"orbitRadius":3.6}}}'
```

The inspector holds tuning **per scene, across the dropdown**, so you can
settle scene one, move to scene two, come back, and then take the whole edit
out with **copy film · &lt;id&gt;**. The panel lists every film the current scene
belongs to and how many of its scenes are tuned.

Three things this had to get right:

**The film's duration cannot move**, and that comes free: `defineScene` already
refuses a parameter set that changes a scene's length, so every scene keeps its
frame count and the transition arithmetic stays valid whatever the knobs say.

**The seam check has to measure the tuned values.** A knob that moves a camera
moves where a scene *ends*, and a dive-through that spliced at the defaults may
not splice any more. `film.check(params)` rebuilds each scene's shot list from
the parameters before measuring the boundary poses.

**A stitched film cannot take parameters at all.** It plays the files in
`public/`; those frames already exist, so a parameter handed to the film
composition could not reach the geometry that produced them. It would be
accepted, ignored, and the film would come out at the defaults with the command
claiming otherwise — the exact class of silent wrongness the film checks exist
to prevent. So it throws, and the generated stitch command does the right thing
instead: render each tuned scene into `public/` **first**, then stitch.

```bash
pnpm exec node lib/auditScenes.mjs src/film.js --export=stitched --params='{…}' \
  && pnpm exec remotion render opening public/opening.mp4 --props='{"params":{"tilt":80}}' \
  && pnpm exec remotion render roundtable public/roundtable.mp4 --props='{"params":{…}}' \
  && pnpm exec remotion render feature-stitch out/feature-stitch.mp4
```

Auditing a film with parameters audits the **scenes** with them too. The
film-level checks only look at how scenes join; if a knob put a hero out of
frame inside one of them, nothing at the film level would ever see it, and
`--params` on a film would have been a way past the gate.

---

## Why the render command carries its own audit

Because otherwise the knobs would be the way around the gate. You would tune in
the browser, render with `--props`, and every check in this repo would only ever
have run against the defaults.

So `--params` exists on the gate, and the values it accepts are exactly the
values `--props` accepts. Both refuse an unknown key or an out-of-range value
rather than clamping it: a command copied months ago, against a scene that has
since dropped a knob, fails loudly instead of rendering something that is
quietly not what the command says.

The gate is live on the knobs, not decorative. Some measured examples:

| scene | knob | what the audit says |
|---|---|---|
| orbital | `radius: 0.6` | `FAIL DOME1_car framing 0.413 <PRP_car_body @f167>` |
| orbital | `lens: 1.5` | `FAIL DOME2_court framing 0.180 <CHR_cyan1_arms @f324>` |
| floors | `slabGap: 2.5` | `FAIL T1_office_mid occlusion 0.40 of PRP_hero <ENV_slab_2 @f114>` |
| floors | `focal: 60` | `FAIL T1_office_mid framing 0.223 <PRP_hero @f114>` |
| tiramisu | `hover: 0.16` | `FAIL SC02_spiral framing 0.727 <PRP_cup @f154>` |
| orbital | `apex: 62` | `FAIL DOME2_court occlusion 0.60 of CHR_cyan1_torso <PRP_ball @f365>` |

Each one names the frame and the object. None of them is fixed by widening a
margin.

That last row is the argument for auditing every value rather than the ones you
happen to look at. `apex` is clean at 55 and clean at 68; at 62 the dome passes
through the one height where the ball hangs directly between the camera and
cyan1, and 60% of a player disappears behind it for part of the arc. Everything
is in frame the whole time, so a framing check sees nothing wrong — and a
human scrubbing the timeline would very likely not catch it either.

---

## What NOT to make a knob

**Anything a brief fixed.** The tiramisu cup is built to a spec in millimetres:
22/22/26 mm wall bands, layers of 14/8/14/8/13/10, a 7 mm cocoa disc. Those are
not opinions to drag a slider through, and a `cupRadius` knob would let anyone
quietly render something that is no longer the product the spec describes. What
is open there is the staging and the lenses: how high the cup floats, how far
the section turns to camera, how far the clones travel.

**Geometry that was worked out, not chosen.** The roundtable's fourth cut sits
at −13° from green's seat at r 2.13, y 1.5, because that is the only position on
the cyan→green line extended that keeps green the near mass while the gaze ends
on cyan. It was derived against stills. A slider on it would invite someone to
lose the reason.

**Anything derived.** In `floors`, the hero's height is the integral of the
speed profile at its midpoint. It has no knob; it is recomputed from whatever
the profile knobs currently say. Leaving it as a constant would have let the two
drift the first time anyone touched a slider — the hero would sit at the height
the *old* profile reached, and the one shot with an enforced hero would fail for
a reason that looks like nothing to do with the knob you turned.

**Four sliders where the ratio is the point.** The roundtable's `handheld` knob
scales sway, drift, breathing and tremor together. What makes that read as a
person rather than as wiggle is the ratio between the slow sway and the fast
tremor; a panel with four independent sliders is a panel that invites you to
break it. At `0` the move is locked off, which is the honest way to see what the
handheld is contributing.

---

## What each scene declares

| scene | knobs |
|---|---|
| `orbital` | `domeAzimuth` `apex` `radius` `lens` `domeFraction` `dipAzimuth` `dipDepth` `startAzimuth` `driftRate` `driftRadius` |
| `floors` | `midSpeed` `holdSpeed` `slabGap` `boundarySlab` `crossSlab` `look` `heroHeight` `focal` |
| `tiramisu` | `hover` `sweep` `lift` `fanRadius` `ringRadius` `pourTilt` `cloudSpread` `lens` |
| `canspot` | `hover` `fanRadius` `revealRadius` `ringRadius` `lens` |
| `roundtable` | `seatRadius` `tableRadius` `handheld` `orbitRadius` `orbitHeight` `orbitArc` `otsRadius` `otsOffset` `otsFocal` |
| `opening` | `seatRadius` `tableRadius` `height` `tilt` |
| `demo` | `tableRadius` `wideRadius` `otsFocal` `handheld` |

`roundtable` exports its room knobs as `roomParams`, and `opening` spreads them
in — because `opening` reuses `roundtable`'s `build`, and a build that reads a
parameter its own scene never declared would get `undefined` and quietly
produce NaN geometry. A shared build means a shared declaration.
