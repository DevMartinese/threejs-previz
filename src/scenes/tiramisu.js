/**
 * tiramisu.js — the canspot structure recut as a warm Italian pasticceria:
 * 30 fps, 21:9, 900 frames, 11 cuts. Colours are identity — kraft cup, cream,
 * coffee-soaked layers, espresso, cocoa — and everything floats.
 *
 * The cup is the canonical revolve(cupProfile) build. The cut-1 split needs no
 * CSG on the fillings: only the WALL is banded; the layers are separate,
 * identity-coloured meshes (stack descriptors) that simply travel with their
 * slice. Cookies crack via pre-halved twins. All cuts happen at build time.
 */
import { defineScene } from '../../lib/scene.js';
import { moves, retarget, slice, easings } from '../../lib/cameraMoves.js';

const rad = (d) => (d * Math.PI) / 180;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const ramp = (f, start, dur, ease = easings.easeInOutSine) =>
  ease(clamp01((f - start) / dur));
const lerp = (a, b, u) => a + (b - a) * u;

/* ---------------------------------------------------------------- product -- */
const R_BOT = 0.0375, R_TOP = 0.045, CUP_H = 0.07, THICK = 0.0015, BASE = 0.002;
const HOVER = 0.085;                    // the cup's resting base height
const CLONES = ['cream', 'beige', 'biscuit', 'espresso', 'cocoa'];

const identity = {
  cocoa: '#4c1f13',
  beige: '#cdb894',
  kraft: '#8a6136',
  cream: '#f5efe0',
  soaked: '#5c3316',
  biscuit: '#d8a35f',
  espresso: '#31201a',
  bean: '#5d3a22',
  glass: '#d8cfc0',
  steel: '#8f8a80',
};

/* Contact by design, declared per class: the layer stack lives inside the cup
 * wall and rides its slices; clones are born inside the mother cup; the cream
 * ribbon pours from the cup into the glass; each cocoa puff blooms on its own
 * droplet; a cookie's parts (and its cracked halves) touch by construction. */
const ignore = [
  ['PRP_cup*', 'PRP_L*'], ['PRP_cup*', 'PRP_top_cocoa'],
  ['PRP_cupS_*', 'PRP_cupS_*'],
  ['PRP_cup', 'PRP_clone_*'], ['PRP_clone_*', 'PRP_L*'], ['PRP_clone_*', 'PRP_top_cocoa'],
  ['PRP_ck0_*', 'PRP_ck0_*'], ['PRP_ck1_*', 'PRP_ck1_*'],
  ['PRP_ckS0_*', 'PRP_ckS0_*'], ['PRP_ckS1_*', 'PRP_ckS1_*'],
  ['PRP_ribbon', 'PRP_glass'], ['PRP_ribbon', 'PRP_cup*'],
  ['PRP_ribbon', 'PRP_L*'], ['PRP_ribbon', 'PRP_top_cocoa'],
  ['PRP_drop_*', 'PRP_puff_*'],
];

/* ------------------------------------------------------------------ build -- */
const LAYERS = [
  { name: 'L01_soaked', t: 0.018, identity: 'soaked' },
  { name: 'L02_cream', t: 0.012, identity: 'cream' },
  { name: 'L03_soaked', t: 0.014, identity: 'soaked' },
  { name: 'L04_cream', t: 0.012, identity: 'cream' },
  { name: 'top_cocoa', t: 0.003, identity: 'cocoa' },
];
// wall band cuts on layer boundaries, so no layer straddles a slice
const CUTS = [0.020, 0.046];
// which slice (0/1/2) each assembly part rides during the split
// The reveal lives in this table: L02 stays with the slice BELOW its wall
// band and L04 with the middle one, so when the bands lift apart each gap is
// filled by an exposed cream edge — the split shows the fillings, instead of
// three closed kraft rings with dark air between them.
const SLICE_OF = {
  PRP_cupS_b0: 0, PRP_cupS_b1: 1, PRP_cupS_b2: 2,
  PRP_L01_soaked: 0, PRP_L02_cream: 0, PRP_L03_soaked: 1,
  PRP_L04_cream: 1, PRP_top_cocoa: 2,
};
const ASSEMBLY = ['PRP_cup', ...Object.keys(SLICE_OF)];

function build({ ctx, geo, blk }) {
  // A cocoa bed for a floor, warm beige world, a soft cocoa mound at the
  // impact point. All ENV — scenery, not subjects.
  ctx.part('ENV_floor', geo.disc({ radius: 2 }), 'cocoa', ctx.groups.ENV);
  ctx.part('ENV_mound', geo.cone({ rBottom: 0.09, rTop: 0.02, h: 0.018 }),
           'cocoa', ctx.groups.ENV).position.y = 0.009;
  ctx.part('ENV_grid',
    geo.gridBars({ size: 0.9, divisions: 12, thickness: 0.003, height: 0.0015 }),
    'beige', ctx.groups.ENV).position.y = 0.0015;

  // Warm fill from below: the default ground light leaves an up-shot (the
  // glass POV) in full silhouette — cream ribbon on dark cup, both black.
  ctx.get('LGT_hemi').groundColor.set('#9c8f7d');

  const wallGeo = () => geo.revolve(geo.cupProfile({
    rBottom: R_BOT, rTop: R_TOP, h: CUP_H, thickness: THICK, base: BASE }));

  ctx.part('PRP_cup', wallGeo(), 'kraft');
  const wallS = ctx.part('PRP_cupS', wallGeo(), 'kraft');
  blk.bands(wallS, 'y', CUTS);          // -> PRP_cupS_b0 / _b1 / _b2

  // The fillings: separate identity-coloured meshes, geometry pre-translated
  // to its own height so the whole assembly shares one position + rotation.
  const rAt = (y) => R_BOT + (y / CUP_H) * (R_TOP - R_BOT);
  ctx.parts(geo.stack({ layers: LAYERS, rAt, inset: THICK + 0.0004,
                        y0: BASE, prefix: 'PRP_' }));

  // Two sandwich cookies, whole + pre-cracked twins (halve each disc).
  for (let i = 0; i < 2; i++) {
    ctx.parts(geo.sandwich({ name: `PRP_ck${i}`, radius: 0.014, shell: 0.004,
                             fill: 0.003, outer: 'biscuit', inner: 'cream' }));
    const twin = ctx.parts(geo.sandwich({ name: `PRP_ckS${i}`, radius: 0.014,
                             shell: 0.004, fill: 0.003, outer: 'biscuit', inner: 'cream' }));
    for (const m of twin) blk.halve(m, 'x');   // -> PRP_ckS<i>_bot_neg …
  }

  // Ladyfingers: the falling one, floaters for the spiral, a broken pair.
  const lfGeo = () => geo.ellipsoid({ rx: 0.0085, ry: 0.024, rz: 0.0085 });
  ctx.part('PRP_lf', lfGeo(), 'biscuit');
  for (let i = 0; i < 3; i++) ctx.part(`PRP_lffloat_${i}`, lfGeo(), 'biscuit');
  const lfbrk = ctx.part('PRP_lfbrk', lfGeo(), 'biscuit');
  blk.halve(lfbrk, 'y');                // -> PRP_lfbrk_neg / _pos

  for (let i = 0; i < 5; i++)
    ctx.part(`PRP_bean_${i}`, geo.ellipsoid({ rx: 0.006, ry: 0.0045, rz: 0.0075 }), 'bean');
  for (let i = 0; i < 3; i++)
    ctx.part(`PRP_masc_${i}`, geo.box({ x: 0.011, y: 0.011, z: 0.011 }), 'cream');

  // Clones a hair smaller than the original — coincident walls z-fight while
  // a clone is still inside the mother cup.
  for (const c of CLONES)
    ctx.part(`PRP_clone_${c}`, wallGeo(), c).scale.setScalar(0.94);

  const glassMat = ctx.material('glass');
  glassMat.transparent = true;
  glassMat.opacity = 0.35;
  ctx.part('PRP_glass', geo.revolve(geo.cupProfile({
    rBottom: 0.018, rTop: 0.026, h: 0.05, thickness: 0.0015, base: 0.003 })), 'glass');

  // The mascarpone ribbon: authored hanging from its origin (top at y 0,
  // reaching down), so scale.y stretches it downward from the cup's mouth.
  ctx.part('PRP_ribbon',
    geo.cone({ rBottom: 0.008, rTop: 0.005, h: 0.19 }).translate(0, -0.095, 0),
    'cream');

  // A faceted moka pot proxy: two eight-sided cones and a knob, one mesh.
  ctx.part('PRP_moka', geo.merge([
    geo.cone({ rBottom: 0.035, rTop: 0.02, h: 0.05, segments: 8 }).translate(0, 0.025, 0),
    geo.cone({ rBottom: 0.02, rTop: 0.03, h: 0.045, segments: 8 }).translate(0, 0.0725, 0),
    geo.cone({ rBottom: 0.008, rTop: 0.005, h: 0.01, segments: 8 }).translate(0, 0.1, 0),
  ]), 'steel');

  for (let i = 0; i < 8; i++) {
    ctx.part(`PRP_drop_${i}`, geo.ellipsoid({ rx: 0.0045, ry: 0.0055, rz: 0.0045 }), 'espresso');
    ctx.part(`PRP_puff_${i}`, geo.ellipsoid({ rx: 0.007, ry: 0.005, rz: 0.007 }), 'cocoa');
  }

  // The macro stream: ladyfingers, beans, cocoa flakes, cookie proxies, drops.
  const macro = ['lfM', 'bean', 'flake', 'ck', 'drop'];
  for (let i = 0; i < 15; i++) {
    const kind = macro[i % 5];
    const g = kind === 'lfM' ? lfGeo()
      : kind === 'bean' ? geo.ellipsoid({ rx: 0.007, ry: 0.005, rz: 0.009 })
      : kind === 'flake' ? geo.box({ x: 0.006, y: 0.002, z: 0.006 })
      : kind === 'ck' ? geo.cone({ rBottom: 0.014, rTop: 0.014, h: 0.011 })
      : geo.ellipsoid({ rx: 0.005, ry: 0.006, rz: 0.005 });
    const colour = kind === 'bean' ? 'bean' : kind === 'flake' ? 'cocoa'
      : kind === 'drop' ? 'espresso' : 'biscuit';
    ctx.part(`PRP_macro_${i}`, g, colour);
  }
}

/* ------------------------------------------------------------------ cuts -- */
const CUT = {
  hook: [0, 150], spiral: [150, 225], travel: [225, 300], fan: [300, 420],
  close: [420, 495], glass: [495, 570], gap: [570, 600], overhead: [600, 660],
  drops: [660, 735], ring: [735, 810], macro: [810, 900],
};

const RING_R = 0.15;
const RING_ANGLES = [27, 99, 171, 243, 315];   // gap at 135° = the camera's chord
// Back hemisphere so clones emerge and never cross the mother cup — and 40°
// apart at r 0.14: at the canspot spacing (30°/0.11) the fanned CUPS touched
// each other (chord 0.057 < two rims 0.085); cups are wider than cans.
const FAN_ANGLES = [100, 140, 180, 220, 260];
const FAN_R = 0.14;
// The fillings are part of the hero, not blockers: the cup is a hollow wall,
// so a sightline to its bbox centre legitimately hits the cream inside it.
const FILLINGS = ['PRP_L*', 'PRP_top_cocoa'];
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

/* ---------------------------------------------------------------- animate -- */
const DYNAMIC = [
  ...ASSEMBLY, 'PRP_lf', 'PRP_lfbrk_neg', 'PRP_lfbrk_pos',
  ...[0, 1].flatMap((i) => ['bot', 'fill', 'top'].flatMap((p) =>
    [`PRP_ck${i}_${p}`, `PRP_ckS${i}_${p}_neg`, `PRP_ckS${i}_${p}_pos`])),
  ...Array.from({ length: 3 }, (_, i) => `PRP_lffloat_${i}`),
  ...Array.from({ length: 5 }, (_, i) => `PRP_bean_${i}`),
  ...Array.from({ length: 3 }, (_, i) => `PRP_masc_${i}`),
  ...CLONES.map((c) => `PRP_clone_${c}`),
  'PRP_glass', 'PRP_ribbon', 'PRP_moka', 'ENV_grid',
  ...Array.from({ length: 8 }, (_, i) => `PRP_drop_${i}`),
  ...Array.from({ length: 8 }, (_, i) => `PRP_puff_${i}`),
  ...Array.from({ length: 15 }, (_, i) => `PRP_macro_${i}`),
];

function animate({ ctx, frame }) {
  const get = ctx.get;
  for (const name of DYNAMIC) {
    const o = get(name);
    o.visible = false;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
  }
  const show = (name, [x, y, z] = [0, 0, 0]) => {
    const o = get(name);
    o.visible = true;
    o.position.set(x, y, z);
    return o;
  };
  /** The whole cup assembly — wall (or its slices), fillings, cocoa top —
   *  shares one position and rotation; `split` opens the slices. */
  const placeCup = (y, { x = 0, z = 0, rotY = 0, rotZ = 0, split = 0, sliced = false } = {}) => {
    for (const name of ASSEMBLY) {
      const isWhole = name === 'PRP_cup';
      const isBand = name.startsWith('PRP_cupS');
      if ((isWhole && sliced) || (isBand && !sliced)) { get(name).visible = false; continue; }
      const off = (SLICE_OF[name] ?? 0) * 0.012 * split;
      const o = show(name, [x, y + off, z]);
      o.rotation.set(0, rotY, rotZ);
    }
  };
  const cut = Object.entries(CUT).find(([, [a, b]]) => frame >= a && frame < b);
  if (!cut) return;
  const [name, [start]] = cut;
  const f = frame - start;

  if (name === 'hook') {
    // Ladyfinger like a bullet (f0-30), landing beside the cup and burying
    // itself in the cocoa mound — it vanishes occluded by scenery, which the
    // continuity audit accepts without declarations. The cup sits on the
    // mound from frame 0 and erupts at the impact. Beans and cookies rise
    // from below frame, freeze, crack (66-96), snap (96-108), one sharp full
    // turn at a tilt (112-142).
    if (f < 30) show('PRP_lf', [0.05, lerp(0.7, -0.004, f / 29), -0.03]);
    const rise = ramp(f, 26, 30, easings.easeOutCubic);
    const cupY = lerp(0.004, HOVER, rise);
    const split = ramp(f, 66, 30) - ramp(f, 96, 12, easings.easeInOutCubic);
    const splitting = f >= 63 && f < 108;
    const turn = ramp(f, 112, 30, easings.easeInOutCubic);
    placeCup(cupY, { split, sliced: splitting,
                     rotY: Math.PI * 2 * turn, rotZ: rad(14) * Math.sin(Math.PI * turn) });
    if (f >= 30) {
      const up = ramp(f, 30, 30, easings.easeOutCubic);
      show('PRP_bean_0', [-0.075, lerp(0.005, 0.13, up), 0.012]).rotation.z = rad(30);
      show('PRP_bean_1', [0.065, lerp(0.005, 0.17, up), -0.018]).rotation.x = rad(50);
      const cookie = (i, cx, cy, cz) => {
        for (const p of ['bot', 'fill', 'top']) {
          if (splitting) {
            const dx = 0.009 * split;
            show(`PRP_ckS${i}_${p}_neg`, [cx - dx, cy, cz]);
            show(`PRP_ckS${i}_${p}_pos`, [cx + dx, cy, cz]);
          } else {
            show(`PRP_ck${i}_${p}`, [cx, cy, cz]);
          }
        }
      };
      cookie(0, -0.06, lerp(0.005, 0.11, up), -0.03);
      cookie(1, 0.075, lerp(0.005, 0.155, up), 0.03);
    }
  }

  if (name === 'spiral') {
    placeCup(HOVER);
    for (let i = 0; i < 5; i++) {
      const [x, , z] = polarXZ(i * 72 + 15, 0.06 + (i % 3) * 0.012);
      show(`PRP_bean_${i}`, [x, 0.015 + ((f + i * 9) / 75) * 0.2, z])
        .rotation.set(rad(30 * i), rad(50 * i), 0);
    }
    for (let i = 0; i < 3; i++) {
      const [x, , z] = polarXZ(i * 120 + 55, 0.1);
      show(`PRP_lffloat_${i}`, [x, 0.03 + ((f + i * 14) / 75) * 0.2, z])
        .rotation.set(rad(20 + 25 * i), 0, rad(35 * i - 30));
    }
  }

  if (name === 'travel') placeCup(HOVER);

  if (name === 'fan') {
    placeCup(HOVER, { rotY: rad(0.2) * f });
    CLONES.forEach((c, i) => {
      const out = ramp(f, 10 + i * 12, 22, easings.easeInOutCubic);
      const back = ramp(f, 70 + i * 8, 14, easings.easeInOutCubic);
      const k = out * (1 - back);
      if (k <= 0) return;
      // born inside the mother cup, sliding out radially — see canspot
      const [tx, , tz] = polarXZ(FAN_ANGLES[i], FAN_R);
      show(`PRP_clone_${c}`, [tx * k, HOVER, tz * k]);
    });
  }

  if (name === 'close') {
    placeCup(0.105, { rotY: rad(0.8) * f });
    // mascarpone cubes and broken ladyfingers on the left, front and behind
    for (let i = 0; i < 3; i++) {
      show(`PRP_masc_${i}`, [-0.055 - (i % 2) * 0.02,
                             0.02 + ((f + i * 13) / 75) * 0.22,
                             i === 1 ? 0.055 : -0.06])
        .rotation.set(rad(20 * i + f * 0.5), rad(15 * i), rad(9 * i));
    }
    show('PRP_lfbrk_neg', [-0.07, 0.03 + (f / 75) * 0.2, 0.045]).rotation.z = rad(40);
    show('PRP_lfbrk_pos', [-0.05, 0.06 + (f / 75) * 0.2, 0.05]).rotation.z = rad(-25);
  }

  if (name === 'glass') {
    show('PRP_glass');
    // tilted +80° the cup extends toward -x, so the base sits at +x and the
    // mouth hangs over the glass — and the ribbon stretches down from it
    placeCup(0.24, { x: 0.07, rotZ: rad(80) });
    // The ribbon leans 14° so the up-shot sees a falling LINE: a perfectly
    // vertical strand is coaxial with this camera and reads as a dot.
    const pour = ramp(f, 8, 52, easings.easeInOutSine);
    const r = show('PRP_ribbon', [0.03, 0.24, 0]);
    r.rotation.z = rad(14);
    r.scale.y = lerp(0.12, 1, pour);
  }

  // 'gap' — editorial placeholder, empty warm stage.

  if (name === 'overhead') {
    show('ENV_grid');
    show('PRP_glass', [0.09, 0, 0]);
    placeCup(HOVER, { rotY: rad(0.4) * f });
  }

  if (name === 'drops') {
    placeCup(HOVER);
    show('PRP_moka', [-0.22, 0.1 + 0.004 * Math.sin(f * 0.05), -0.1])
      .rotation.set(0, rad(25), rad(18));
    for (let i = 0; i < 8; i++) {
      const [x, , z] = polarXZ(i * 44 + 10, 0.09 + (i % 4) * 0.035);
      const h = 0.06 + ((i * 37) % 5) * 0.035;
      const up = ramp(f, i * 5, 26, easings.easeOutCubic);
      show(`PRP_drop_${i}`, [x, 0.008 + h * up, z]);
      // a tiny cocoa puff blooms where each droplet freezes — declared pops
      if (f >= i * 5 + 26) show(`PRP_puff_${i}`, [x, 0.012 + h, z]);
    }
  }

  if (name === 'ring') {
    placeCup(HOVER);
    RING_ANGLES.forEach((a, i) => {
      const down = ramp(f, i * 6, 24, easings.easeOutCubic);
      const [x, , z] = polarXZ(a, RING_R);
      show(`PRP_clone_${CLONES[i]}`, [x, lerp(0.45, 0.04, down), z]);
    });
  }

  if (name === 'macro') {
    // endless warm stream at different depths; wraps happen outside frame
    for (let i = 0; i < 15; i++) {
      const speed = 0.0038 + (i % 4) * 0.0014;
      const y = 0.03 + ((i * 0.019 + f * speed) % 0.24);
      // lanes keyed off 7 and 13 so pieces i and i+5 never share one — two
      // ladyfingers on the same lane collided mid-stream
      const m = show(`PRP_macro_${i}`,
        [1.42 + (i % 7) * 0.024, y, -0.13 + ((i * 7) % 13) * 0.02]);
      m.rotation.set(rad(i * 30 + f * 1.5), rad(i * 50), rad(f * (1 + (i % 3))));
    }
  }

}

/* ------------------------------------------------------------------ shots -- */
const hold = (position, target) => moves.truck({ from: position, to: position, target });

export default defineScene({
  id: 'tiramisu',
  fps: 30,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 0.09,
  background: '#e6d9c3',
  identity,
  ignore,
  floorIgnore: ['PRP_lf'],   // it buries itself in the cocoa mound
  build,
  animate,
  shots: [
    // 1 — the hook, two entries of one camera move: the impact is transitional
    // (ladyfinger in from above, cup erupting through the bottom of frame);
    // from the freeze on, the cup (or its slices) holds frame.
    { name: 'SC01a_impact', from: 0, to: 60, focalLength: 32, easing: 'linear',
      hero: [],
      move: slice(moves.pushIn({ from: 0.38, to: 0.3, height: 0.15, target: [0, 0.13, 0] }), 0, 0.4) },
    { name: 'SC01b_freeze', from: 60, to: 150, focalLength: 32, easing: 'linear',
      hero: ['PRP_cup', 'PRP_cupS_*'], occlusion: { ignore: FILLINGS },
      move: slice(moves.pushIn({ from: 0.38, to: 0.3, height: 0.15, target: [0, 0.13, 0] }), 0.4, 1) },

    // 2 — spiral up around the cup from the cocoa cloud (phiLow stays above
    // the floor — the canspot audit taught us where a negative phi ends up).
    { name: 'SC02_spiral', from: 150, to: 225, focalLength: 40, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: FILLINGS },
      move: moves.turntable({ radius: 0.33, pushIn: 0.95, arc: rad(300),
                              phiLow: rad(3), phiHigh: rad(22), target: [0, 0.12, 0] }) },

    // 3 — hold at the cocoa-dusted top (its own part, so it can be the hero),
    // then travel down the kraft wall — transitional by nature.
    { name: 'SC03a_top', from: 225, to: 250, focalLength: 60, easing: 'linear',
      hero: 'PRP_top_cocoa',
      move: hold([0.22, 0.44, 0.14], [0, 0.146, 0]) },
    { name: 'SC03b_down', from: 250, to: 300, focalLength: 60, easing: 'easeInOutSine',
      hero: [],
      move: retarget(
        moves.truck({ from: [0.22, 0.44, 0.14], to: [0.16, 0.07, 0.1] }),
        { targets: [[0, 0.146, 0], [0, 0.095, 0]] }) },

    // 4 — wide arc; five clone cups fan out from behind, one by one, and are
    // sucked back in. Clones crossing the mother cup is the shot — declared.
    { name: 'SC04_fan', from: 300, to: 420, focalLength: 35, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: ['PRP_clone_*', ...FILLINGS] },
      move: moves.orbit360({ radius: 0.5, height: 0.21, startAngle: rad(-60),
                             arc: rad(120), target: [0, 0.1, 0] }) },

    // 5 — the cup spins slowly in the right half; mascarpone and broken
    // ladyfingers float up left, in front and behind — scripted blockers.
    { name: 'SC05_close', from: 420, to: 495, focalLength: 50, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: ['PRP_masc_*', 'PRP_lfbrk_*', ...FILLINGS] },
      move: moves.pushIn({ from: 0.41, to: 0.37, height: 0.14, target: [-0.055, 0.142, 0] }) },

    // 6 — from inside the glass espresso cup, looking up; the kraft cup hangs
    // almost horizontal, a slow ribbon of mascarpone stretching down. The
    // glass is translucent (never blocks); the ribbon is scripted to cross.
    { name: 'SC06_glass', from: 495, to: 570, focalLength: 24, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: ['PRP_ribbon', ...FILLINGS] },
      move: hold([0, 0.025, 0.008], [0.045, 0.36, 0.015]) },

    // 7 — GAP: an editorial placeholder, empty warm stage.
    { name: 'SC07_gap', from: 570, to: 600, focalLength: 35, easing: 'linear',
      hero: [],
      move: hold([0, 0.18, 0.45], [0, 0.08, 1.2]) },

    // 8 — circling the cup and the espresso glass from above, warm grid on
    // the floor. Steep phi compresses a tall-plus-low pair (canspot lesson).
    { name: 'SC08_overhead', from: 600, to: 660, focalLength: 32, easing: 'linear',
      hero: ['PRP_cup', 'PRP_glass'], occlusion: { ignore: FILLINGS },
      move: moves.orbit360({ radius: 0.64, height: 0, phi: rad(66),
                             startAngle: rad(-20), arc: rad(120), target: [0.04, 0.09, 0] }) },

    // 9 — espresso droplets rise and freeze, cocoa puffs on each impact
    // (declared pops — they bloom from nothing by script), moka pot floating
    // tilted in the background.
    { name: 'SC09_drops', from: 660, to: 735, focalLength: 32, easing: 'linear',
      hero: 'PRP_cup', pops: ['PRP_puff_*'], occlusion: { ignore: FILLINGS },
      move: moves.truck({ from: [0.42, 0.17, 0.3], to: [0.38, 0.17, 0.33],
                          target: [0, 0.11, 0] }) },

    // 10 — clones down from the sky into a ring; the camera flies low between
    // the cups, touching nothing — the clearance audit measures it.
    { name: 'SC10_ring', from: 735, to: 810, focalLength: 28, easing: 'easeInOutSine',
      hero: [],
      move: moves.truck({ from: [0.27, 0.035, 0.18], to: [-0.18, 0.035, -0.27],
                          target: [0, 0.09, 0] }) },

    // 11 — macro finale: an endless warm stream at different depths; the
    // frame is never empty. Explicitly nothing has to stay in frame.
    { name: 'SC11_macro', from: 810, to: 900, focalLength: 50, easing: 'linear',
      hero: [],
      move: moves.truck({ from: [1.5, 0.15, 0.35], to: [1.5, 0.15, 0.32],
                          target: [1.5, 0.15, 0] }) },
  ],
});
