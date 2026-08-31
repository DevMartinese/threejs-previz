/**
 * tiramisu.js — a 13-cut piece for a 9 cm kraft tiramisu cup, one scene.
 * 30 fps, 21:9, 900 frames, product scale. Colours are identity: kraft wall,
 * cocoa dusted top, soaked-dark and cream-pale layers, tan ladyfingers,
 * dark-cream-dark sandwich cookies. Everything floats.
 *
 * The cup is built to be cut TWO ways, both at build time:
 *   - three horizontal wall bands for the hook's split. The fillings are not
 *     CSG'd: they are separate identity meshes assigned to slices so each gap
 *     is filled by an exposed layer edge — soaked in the lower gap, thick
 *     cream in the upper one.
 *   - a vertical halving (wall AND fillings) for the close-up: the front half
 *     lifts out of frame and the flat cross-section sweeps past camera.
 *
 * The moka, the glass and the cup are one chain: the cup pours into the glass
 * (6), the glass shows the result while a cube is still falling in (8), and
 * the moka's frozen espresso arc runs from its spout to the cup (9).
 */
import { defineScene } from '../../lib/scene.js';
import { moves, retarget, slice, easings } from '../../lib/cameraMoves.js';

const rad = (d) => (d * Math.PI) / 180;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const ramp = (f, start, dur, ease = easings.easeInOutSine) =>
  ease(clamp01((f - start) / dur));
const lerp = (a, b, u) => a + (b - a) * u;
const fallEase = (u) => u * u;                 // falling accelerates

/* ---------------------------------------------------------------- product -- */
const R_BOT = 0.0375, R_TOP = 0.045, CUP_H = 0.07, THICK = 0.0015, BASE = 0.002;
const HOVER = 0.085;
const CLONES = ['cream', 'beige', 'tan', 'espresso', 'cocoa'];

const identity = {
  // scenery: neutral greys, like a Blender viewport — the world carries no
  // colour, so every colour on screen is an identity you can direct by
  grey: '#9a9a9a',
  greyDeep: '#7a7a7a',
  greyLine: '#b8b8b8',
  // the cast
  cocoa: '#4c1f13',
  beige: '#cdb894',
  kraft: '#8a6136',
  cream: '#f5efe0',
  soaked: '#5c3316',
  tan: '#d8a35f',
  espresso: '#31201a',
  bean: '#5d3a22',
  glass: '#d8cfc0',
  steel: '#8f8a80',
};

/* Layers follow the real product: thick soaked biscuit with thin cream veins,
 * the top cream the thickest, cocoa dust above it. Wall band cuts sit on
 * layer boundaries so no layer straddles a slice. */
const LAYERS = [
  { name: 'L01_soaked', t: 0.016, identity: 'soaked' },
  { name: 'L02_cream', t: 0.004, identity: 'cream' },    // vein
  { name: 'L03_soaked', t: 0.016, identity: 'soaked' },
  { name: 'L04_cream', t: 0.004, identity: 'cream' },    // vein
  { name: 'L05_soaked', t: 0.010, identity: 'soaked' },
  { name: 'L06_cream', t: 0.012, identity: 'cream' },    // the thick one
  { name: 'top_cocoa', t: 0.003, identity: 'cocoa' },
];
const CUTS = [0.022, 0.052];
// The reveal lives here: L03 stays with the bottom slice so the lower gap
// shows a SOAKED edge; L06 stays with the middle one so the upper gap shows
// the thick CREAM edge.
const SLICE_OF = {
  PRP_cupS_b0: 0, PRP_cupS_b1: 1, PRP_cupS_b2: 2,
  PRP_L01_soaked: 0, PRP_L02_cream: 0, PRP_L03_soaked: 0,
  PRP_L04_cream: 1, PRP_L05_soaked: 1, PRP_L06_cream: 1,
  PRP_top_cocoa: 2,
};
const H_PARTS = ['PRP_cup', ...Object.keys(SLICE_OF)];
const V_PARTS = ['PRP_cupV', ...LAYERS.map((l) => `PRP_V${l.name}`)]
  .flatMap((n) => [`${n}_neg`, `${n}_pos`]);

/* Contact by design, declared per class. */
const ignore = [
  ['PRP_cup*', 'PRP_L*'], ['PRP_cup*', 'PRP_top_cocoa'],
  ['PRP_cupS_*', 'PRP_cupS_*'],
  ['PRP_cup*', 'PRP_V*'], ['PRP_V*', 'PRP_V*'],
  ['PRP_cup', 'PRP_clone_*'], ['PRP_clone_*', 'PRP_L*'], ['PRP_clone_*', 'PRP_top_cocoa'],
  ['PRP_ck0_*', 'PRP_ck0_*'], ['PRP_ck1_*', 'PRP_ck1_*'],
  ['PRP_ckS0_*', 'PRP_ckS0_*'], ['PRP_ckS1_*', 'PRP_ckS1_*'],
  ['PRP_ribbon', 'PRP_glass'], ['PRP_ribbon', 'PRP_cup*'],
  ['PRP_ribbon', 'PRP_L*'], ['PRP_ribbon', 'PRP_top_cocoa'],
  ['PRP_glasscream', 'PRP_glass'],
];

/* The fillings (and their vertical halves) are part of the hero, never
 * blockers: the cup is a hollow wall, so a sightline to its bbox centre
 * legitimately lands on the cream inside it. */
const FILLINGS = ['PRP_L*', 'PRP_top_cocoa', 'PRP_V*'];

/* ------------------------------------------------------------------ build -- */
function build({ ctx, geo, blk }) {
  ctx.part('ENV_floor', geo.disc({ radius: 2 }), 'grey', ctx.groups.ENV);
  ctx.part('ENV_mound', geo.cone({ rBottom: 0.09, rTop: 0.02, h: 0.018 }),
           'greyDeep', ctx.groups.ENV).position.y = 0.009;
  ctx.part('ENV_grid',
    geo.gridBars({ size: 0.9, divisions: 12, thickness: 0.003, height: 0.0015 }),
    'greyLine', ctx.groups.ENV).position.y = 0.0015;

  // Brighter neutral fill from below: without it, low-angle shots (the
  // pour seen from low) render in silhouette.
  ctx.get('LGT_hemi').groundColor.set('#8a8a8a');

  const wallGeo = () => geo.revolve(geo.cupProfile({
    rBottom: R_BOT, rTop: R_TOP, h: CUP_H, thickness: THICK, base: BASE }));
  const rAt = (y) => R_BOT + (y / CUP_H) * (R_TOP - R_BOT);
  const stackOpts = { layers: LAYERS, rAt, inset: THICK + 0.0004, y0: BASE };

  // The whole cup, its horizontal twin (banded), its vertical twin (halved —
  // wall AND fillings, so the cross-section is flat, not a nest of shells).
  ctx.part('PRP_cup', wallGeo(), 'kraft');
  blk.bands(ctx.part('PRP_cupS', wallGeo(), 'kraft'), 'y', CUTS);
  blk.halve(ctx.part('PRP_cupV', wallGeo(), 'kraft'), 'z');
  ctx.parts(geo.stack({ ...stackOpts, prefix: 'PRP_' }));
  for (const m of ctx.parts(geo.stack({ ...stackOpts, prefix: 'PRP_V' })))
    blk.halve(m, 'z');

  // Sandwich cookies: dark-cream-dark, whole + pre-cracked twins.
  for (let i = 0; i < 2; i++) {
    ctx.parts(geo.sandwich({ name: `PRP_ck${i}`, radius: 0.014, shell: 0.004,
                             fill: 0.003, outer: 'espresso', inner: 'cream' }));
    const twin = ctx.parts(geo.sandwich({ name: `PRP_ckS${i}`, radius: 0.014,
                             shell: 0.004, fill: 0.003, outer: 'espresso', inner: 'cream' }));
    for (const m of twin) blk.halve(m, 'x');
  }

  // a ladyfinger IS a capsule — same envelope the ellipsoid faked (h .048)
  const lfGeo = () => geo.capsule({ r: 0.0085, length: 0.031 });
  ctx.part('PRP_lf', lfGeo(), 'tan');
  for (let i = 0; i < 3; i++) ctx.part(`PRP_lffloat_${i}`, lfGeo(), 'tan');

  for (let i = 0; i < 5; i++)
    ctx.part(`PRP_bean_${i}`, geo.ellipsoid({ rx: 0.006, ry: 0.0045, rz: 0.0075 }), 'bean');
  for (let i = 0; i < 3; i++)
    ctx.part(`PRP_masc_${i}`, geo.box({ x: 0.011, y: 0.011, z: 0.011 }), 'cream');

  for (const c of CLONES)
    ctx.part(`PRP_clone_${c}`, wallGeo(), c).scale.setScalar(0.94);

  const glassMat = ctx.material('glass');
  glassMat.transparent = true;
  glassMat.opacity = 0.35;
  ctx.part('PRP_glass', geo.revolve(geo.cupProfile({
    rBottom: 0.018, rTop: 0.026, h: 0.05, thickness: 0.0015, base: 0.003 })), 'glass');
  // the pour's result, shown in the overhead cut — the chain, not decoration
  ctx.part('PRP_glasscream',
    geo.cone({ rBottom: 0.0155, rTop: 0.017, h: 0.012 }).translate(0, 0.02, 0), 'cream');

  ctx.part('PRP_ribbon',
    geo.cone({ rBottom: 0.008, rTop: 0.005, h: 0.19 }).translate(0, -0.095, 0),
    'cream');

  // Moka pot: not in the catalog — composed from three faceted cones.
  ctx.part('PRP_moka', geo.merge([
    geo.cone({ rBottom: 0.035, rTop: 0.02, h: 0.05, segments: 8 }).translate(0, 0.025, 0),
    geo.cone({ rBottom: 0.02, rTop: 0.03, h: 0.045, segments: 8 }).translate(0, 0.0725, 0),
    geo.cone({ rBottom: 0.008, rTop: 0.005, h: 0.01, segments: 8 }).translate(0, 0.1, 0),
  ]), 'steel');

  for (let i = 0; i < 8; i++)
    ctx.part(`PRP_drop_${i}`, geo.ellipsoid({ rx: 0.0045, ry: 0.0055, rz: 0.0045 }), 'espresso');

  const macro = ['lfM', 'bean', 'flake', 'ck', 'drop'];
  for (let i = 0; i < 15; i++) {
    const kind = macro[i % 5];
    const g = kind === 'lfM' ? lfGeo()
      : kind === 'bean' ? geo.ellipsoid({ rx: 0.007, ry: 0.005, rz: 0.009 })
      : kind === 'flake' ? geo.box({ x: 0.006, y: 0.002, z: 0.006 })
      : kind === 'ck' ? geo.cone({ rBottom: 0.014, rTop: 0.014, h: 0.011 })
      : geo.ellipsoid({ rx: 0.005, ry: 0.006, rz: 0.005 });
    const colour = kind === 'bean' ? 'bean' : kind === 'flake' ? 'cocoa'
      : kind === 'drop' ? 'espresso' : 'tan';
    ctx.part(`PRP_macro_${i}`, g, colour);
  }
}

/* ------------------------------------------------------------------ cuts -- */
const CUT = {
  hook: [0, 150], spiral: [150, 225], travel: [225, 290], fan: [290, 395],
  close: [395, 475], pour: [475, 545], gap: [545, 570], overhead: [570, 625],
  arc: [625, 700], ring: [700, 765], macro: [765, 810], reveal: [810, 860],
  pack: [860, 900],
};

const RING_R = 0.15;
const RING_ANGLES = [27, 99, 171, 243, 315];   // gap at 135° = the camera's chord
const FAN_ANGLES = [100, 140, 180, 220, 260];  // 40° apart: cups are wide
const FAN_R = 0.14;
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

// The frozen espresso arc, spout -> cup top (quadratic bezier).
// Wide arc: x(t) stays monotonic with >=12 mm between the droplets' vertical
// rise columns — with a near-vertical tail they all rose through one tube and
// collided with the ones already frozen. P0 is NOT typed here: the arc starts
// at the moka's spout anchor, computed per frame from its posed transform.
const ARC_P1 = [-0.10, 0.33, -0.03], ARC_P2 = [-0.052, 0.162, -0.012];
const SPOUT = [0.03, 0.095, 0];                // the moka's spout, local space
const arcAt = (p0, t) => [0, 1, 2].map((k) =>
  (1 - t) * (1 - t) * p0[k] + 2 * (1 - t) * t * ARC_P1[k] + t * t * ARC_P2[k]);

/* ---------------------------------------------------------------- animate -- */
const DYNAMIC = [
  ...H_PARTS, ...V_PARTS, 'PRP_lf',
  ...[0, 1].flatMap((i) => ['bot', 'fill', 'top'].flatMap((p) =>
    [`PRP_ck${i}_${p}`, `PRP_ckS${i}_${p}_neg`, `PRP_ckS${i}_${p}_pos`])),
  ...Array.from({ length: 3 }, (_, i) => `PRP_lffloat_${i}`),
  ...Array.from({ length: 5 }, (_, i) => `PRP_bean_${i}`),
  ...Array.from({ length: 3 }, (_, i) => `PRP_masc_${i}`),
  ...CLONES.map((c) => `PRP_clone_${c}`),
  'PRP_glass', 'PRP_glasscream', 'PRP_ribbon', 'PRP_moka', 'ENV_grid',
  ...Array.from({ length: 8 }, (_, i) => `PRP_drop_${i}`),
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
  /** One cup, three states: whole wall, horizontal bands (split opens them),
   *  or vertical halves (lift raises the front half). Everything shares one
   *  position and rotation. */
  const placeCup = (y, { x = 0, z = 0, rotY = 0, rotZ = 0,
                         split = 0, mode = 'whole', lift = 0 } = {}) => {
    for (const name of H_PARTS) {
      const isWhole = name === 'PRP_cup';
      const isBand = name.startsWith('PRP_cupS');
      const visible = mode === 'whole' ? !isBand : mode === 'bands' ? !isWhole : false;
      if (!visible) { get(name).visible = false; continue; }
      const off = (SLICE_OF[name] ?? 0) * 0.012 * split;
      show(name, [x, y + off, z]).rotation.set(0, rotY, rotZ);
    }
    for (const name of V_PARTS) {
      if (mode !== 'vertical') { get(name).visible = false; continue; }
      const up = name.endsWith('_pos') ? lift : 0;
      show(name, [x, y + up, z]).rotation.set(0, rotY, rotZ);
    }
  };
  const showCookie = (i, [x, y, z], rot = [0, 0, 0]) => {
    for (const p of ['bot', 'fill', 'top'])
      show(`PRP_ck${i}_${p}`, [x, y, z]).rotation.set(...rot);
  };
  const cut = Object.entries(CUT).find(([, [a, b]]) => frame >= a && frame < b);
  if (!cut) return;
  const [name, [start]] = cut;
  const f = frame - start;

  if (name === 'hook') {
    // Ladyfinger like a bullet, landing beside the cup and burying itself in
    // the cocoa mound (vanishes occluded by scenery). The cup sits on the
    // mound and erupts at the impact; beans and cookies rise from below
    // frame; freeze, split (66-96) showing the layer edges, cookies crack
    // open showing the cream, snap (96-108), one sharp full turn at a tilt.
    if (f < 30) show('PRP_lf', [0.05, lerp(0.7, -0.004, f / 29), -0.03]);
    const rise = ramp(f, 26, 30, easings.easeOutCubic);
    const split = ramp(f, 66, 30) - ramp(f, 96, 12, easings.easeInOutCubic);
    const splitting = f >= 63 && f < 108;
    const turn = ramp(f, 112, 30, easings.easeInOutCubic);
    placeCup(lerp(0.004, HOVER, rise), {
      split, mode: splitting ? 'bands' : 'whole',
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
      const back = ramp(f, 62 + i * 7, 14, easings.easeInOutCubic);
      const k = out * (1 - back);
      if (k <= 0) return;
      const [tx, , tz] = polarXZ(FAN_ANGLES[i], FAN_R);
      show(`PRP_clone_${c}`, [tx * k, HOVER, tz * k]);
    });
  }

  if (name === 'close') {
    // The vertical reveal: swap whole -> halves at f12 (coincident, a swap),
    // the FRONT half lifts out of frame (12-28), holds, returns (52-66),
    // swap back at f68 — while the whole assembly sweeps -35° to +35° so the
    // cross-section's layers pass the camera. Snapped back before the cut.
    const rotY = rad(lerp(-35, 35, f / 80));
    const vertical = f >= 12 && f < 68;
    const lift = 0.17 * (ramp(f, 12, 16) - ramp(f, 52, 14));
    placeCup(0.105, { rotY, mode: vertical ? 'vertical' : 'whole', lift });
    for (let i = 0; i < 3; i++) {
      show(`PRP_masc_${i}`, [-0.06 - (i % 2) * 0.018,
                             0.02 + ((f + i * 13) / 80) * 0.22,
                             i === 1 ? 0.05 : -0.055])
        .rotation.set(rad(20 * i + f * 0.5), rad(15 * i), rad(9 * i));
    }
  }

  if (name === 'pour') {
    // seen from OUTSIDE: cup tilted over the glass, the mascarpone ribbon
    // running diagonally from its MOUTH into the glass, cookies and beans
    // falling and landing. The ribbon is derived from anchors, not typed
    // numbers: origin = the cup's mouth through the scene graph (tilt
    // included), aim + length = whatever reaches the glass mouth. The glass
    // sits off-axis so the pour has somewhere to run diagonally TO.
    show('PRP_glass', [-0.06, 0, 0]);
    placeCup(0.16, { x: 0.07, rotZ: rad(80) });
    const mouth = ctx.anchor('PRP_cup', [0, CUP_H, 0]);
    const glassMouth = ctx.anchor('PRP_glass', [0, 0.05, 0]);
    const dx = mouth.x - glassMouth.x, dy = mouth.y - glassMouth.y;
    const r = show('PRP_ribbon', [mouth.x, mouth.y, mouth.z]);
    r.rotation.z = Math.atan2(-dx, dy);   // Rz(t)*(0,-L) = (+L sin t, -L cos t)
    r.scale.y = (Math.hypot(dx, dy) / 0.19) * lerp(0.7, 1, ramp(f, 0, 18));
    showCookie(0, [-0.13, lerp(0.42, 0.02, ramp(f, 0, 45, fallEase)), 0.05],
               [rad(20 + Math.min(f, 45)), 0, rad(15)]);
    showCookie(1, [0.16, lerp(0.5, 0.02, ramp(f, 15, 50, fallEase)), -0.06],
               [rad(Math.min(f, 65) * 1.5), rad(30), 0]);
    show('PRP_bean_2', [-0.09, lerp(0.36, 0.008, ramp(f, 8, 40, fallEase)), -0.07])
      .rotation.z = rad(40 + Math.min(f, 48));
    show('PRP_bean_3', [0.11, lerp(0.44, 0.008, ramp(f, 25, 42, fallEase)), 0.08])
      .rotation.x = rad(Math.min(f, 67) * 2);
  }

  // 'gap' — editorial placeholder, empty warm stage.

  if (name === 'overhead') {
    // the chain's result: cream in the glass, one cube still falling in
    show('ENV_grid');
    show('PRP_glass', [0.09, 0, 0]);
    show('PRP_glasscream', [0.09, 0, 0]);
    show('PRP_masc_0', [0.09, lerp(0.3, 0.09, ramp(f, 0, 55, fallEase)), 0])
      .rotation.set(rad(f), rad(f * 1.3), 0);
    placeCup(HOVER, { rotY: rad(0.4) * f });
  }

  if (name === 'arc') {
    // droplets rise and freeze along the pour arc, spout -> cup top; the
    // moka floats tilted above, pouring.
    placeCup(HOVER);
    show('PRP_moka', [-0.22, 0.25 + 0.004 * Math.sin(f * 0.05), -0.07])
      .rotation.set(0, rad(15), rad(-35));
    const spout = ctx.anchor('PRP_moka', SPOUT).toArray();
    for (let i = 0; i < 8; i++) {
      const [ax, ay, az] = arcAt(spout, 0.08 + 0.92 * (i / 7));
      const up = ramp(f, i * 5, 26, easings.easeOutCubic);
      show(`PRP_drop_${i}`, [ax, lerp(0.008, ay, up), az]);
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
    for (let i = 0; i < 15; i++) {
      const speed = 0.0038 + (i % 4) * 0.0014;
      const y = 0.03 + ((i * 0.019 + f * speed) % 0.24);
      const m = show(`PRP_macro_${i}`,
        [1.42 + (i % 7) * 0.024, y, -0.13 + ((i * 7) % 13) * 0.02]);
      m.rotation.set(rad(i * 30 + f * 1.5), rad(i * 50), rad(f * (1 + (i % 3))));
    }
  }

  if (name === 'reveal') {
    const cupY = lerp(0.075, 0.125, ramp(f, 0, 36, easings.easeOutCubic));
    placeCup(cupY, { rotY: rad(3) * f });
    CLONES.forEach((c, i) => {
      const bloom = ramp(f, 6 + i * 6, 14, easings.easeInOutCubic);
      if (bloom <= 0) return;
      const [tx, , tz] = polarXZ(FAN_ANGLES[i], 0.17);
      show(`PRP_clone_${c}`,
        [tx * bloom, lerp(cupY, 0.075 + i * 0.01, bloom), tz * bloom]);
    });
  }

  if (name === 'pack') {
    placeCup(0.12 + 0.005 * Math.sin(f * 0.08), { rotY: rad(0.5) * f });
    show('PRP_bean_0', [-0.075, 0.13 + 0.003 * Math.sin(f * 0.1), 0.02]).rotation.z = rad(30);
    show('PRP_bean_1', [-0.065, 0.18 + 0.003 * Math.sin(f * 0.1 + 2), -0.02]).rotation.x = rad(60);
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
  background: '#3a3a3a',
  identity,
  ignore,
  floorIgnore: ['PRP_lf'],   // it buries itself in the cocoa mound
  // The chain, measured: the pour hangs from the cup's mouth and lands in the
  // glass; the espresso arc starts at the moka's spout and ends on the cup's
  // lip. `settle` entries are checked once the move has arrived.
  attachments: [
    { a: 'PRP_ribbon', b: 'PRP_cup', bLocal: [0, CUP_H, 0], tol: 0.004 },
    { a: 'PRP_ribbon', aLocal: [0, -0.19, 0],
      b: 'PRP_glass', bLocal: [0, 0.05, 0], tol: 0.02, settle: true },
    { a: 'PRP_drop_0', b: 'PRP_moka', bLocal: [0.03, 0.095, 0], tol: 0.03, settle: true },
    { a: 'PRP_drop_7', b: 'PRP_cup', bLocal: [-0.045, 0.07, -0.012], tol: 0.016, settle: true },
  ],
  build,
  animate,
  shots: [
    // 1 — the hook: impact transitional, then the cup (or its bands) holds.
    { name: 'SC01a_impact', from: 0, to: 60, focalLength: 32, easing: 'linear',
      hero: [],
      move: slice(moves.pushIn({ from: 0.38, to: 0.3, height: 0.15, target: [0, 0.13, 0] }), 0, 0.4) },
    { name: 'SC01b_freeze', from: 60, to: 150, focalLength: 32, easing: 'linear',
      hero: ['PRP_cup', 'PRP_cupS_*'], occlusion: { ignore: FILLINGS },
      move: slice(moves.pushIn({ from: 0.38, to: 0.3, height: 0.15, target: [0, 0.13, 0] }), 0.4, 1) },

    // 2 — spiral up from the cocoa cloud.
    { name: 'SC02_spiral', from: 150, to: 225, focalLength: 40, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: FILLINGS },
      move: moves.turntable({ radius: 0.33, pushIn: 0.95, arc: rad(300),
                              phiLow: rad(3), phiHigh: rad(22), target: [0, 0.12, 0] }) },

    // 3 — hold at the cocoa-dusted top, then travel down the kraft wall.
    { name: 'SC03a_top', from: 225, to: 250, focalLength: 60, easing: 'linear',
      hero: 'PRP_top_cocoa',
      move: hold([0.22, 0.44, 0.14], [0, 0.146, 0]) },
    { name: 'SC03b_down', from: 250, to: 290, focalLength: 60, easing: 'easeInOutSine',
      hero: [],
      move: retarget(
        moves.truck({ from: [0.22, 0.44, 0.14], to: [0.16, 0.07, 0.1] }),
        { targets: [[0, 0.146, 0], [0, 0.095, 0]] }) },

    // 4 — wide arc, clones fan out from behind and get sucked back.
    { name: 'SC04_fan', from: 290, to: 395, focalLength: 35, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: ['PRP_clone_*', ...FILLINGS] },
      move: moves.orbit360({ radius: 0.5, height: 0.21, startAngle: rad(-60),
                             arc: rad(120), target: [0, 0.1, 0] }) },

    // 5 — close-up right half: the front half lifts OUT of frame by design
    // (it is a declared blocker, not a hero) while the cross-section sweeps.
    { name: 'SC05_close', from: 395, to: 475, focalLength: 50, easing: 'linear',
      hero: ['PRP_cup', 'PRP_cupV_neg'],
      occlusion: { ignore: [...FILLINGS, 'PRP_cupV_pos', 'PRP_masc_*'] },
      move: moves.pushIn({ from: 0.41, to: 0.37, height: 0.14, target: [-0.055, 0.142, 0] }) },

    // 6 — the pour from outside, camera low and to the side; cookies and
    // beans fall around it — scripted crossers.
    { name: 'SC06_pour', from: 475, to: 545, focalLength: 32, easing: 'linear',
      hero: ['PRP_cup', 'PRP_glass'],
      occlusion: { ignore: [...FILLINGS, 'PRP_ribbon', 'PRP_ck*', 'PRP_bean_*'] },
      // The whole pour lives in the X-Y plane (tilted cup, diagonal ribbon,
      // glass below), so the camera sits out on +Z and sees it in profile —
      // from +X it stared at the cup's base and the ribbon hid behind it.
      move: moves.truck({ from: [0.12, 0.06, 0.52], to: [0.09, 0.07, 0.55],
                          target: [0.045, 0.118, 0] }) },

    // 7 — GAP.
    { name: 'SC07_gap', from: 545, to: 570, focalLength: 35, easing: 'linear',
      hero: [],
      move: hold([0, 0.18, 0.45], [0, 0.08, 1.2]) },

    // 8 — overhead circle: cup + glass (with the pour's result inside it and
    // a cube still falling in), warm grid on the floor.
    { name: 'SC08_overhead', from: 570, to: 625, focalLength: 32, easing: 'linear',
      hero: ['PRP_cup', 'PRP_glass'],
      occlusion: { ignore: [...FILLINGS, 'PRP_glasscream', 'PRP_masc_*'] },
      move: moves.orbit360({ radius: 0.64, height: 0, phi: rad(66),
                             startAngle: rad(-20), arc: rad(120), target: [0.04, 0.09, 0] }) },

    // 9 — the frozen espresso arc, spout to cup; moka floating above.
    { name: 'SC09_arc', from: 625, to: 700, focalLength: 28, easing: 'linear',
      hero: ['PRP_cup', 'PRP_moka'],
      occlusion: { ignore: [...FILLINGS, 'PRP_drop_*'] },
      move: moves.truck({ from: [0.5, 0.22, 0.34], to: [0.46, 0.22, 0.38],
                          target: [-0.04, 0.19, 0] }) },

    // 10 — clones ring, camera flies low between the cups, touching nothing.
    { name: 'SC10_ring', from: 700, to: 765, focalLength: 28, easing: 'easeInOutSine',
      hero: [],
      move: moves.truck({ from: [0.27, 0.035, 0.18], to: [-0.18, 0.035, -0.27],
                          target: [0, 0.09, 0] }) },

    // 11 — macro: endless warm stream; explicitly nothing has to stay in frame.
    { name: 'SC11_macro', from: 765, to: 810, focalLength: 50, easing: 'linear',
      hero: [],
      move: moves.truck({ from: [1.5, 0.15, 0.35], to: [1.5, 0.15, 0.32],
                          target: [1.5, 0.15, 0] }) },

    // 12 — the reveal: lift + spin, clones bloom, camera slowly circles.
    { name: 'SC12_reveal', from: 810, to: 860, focalLength: 40, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: ['PRP_clone_*', ...FILLINGS] },
      move: moves.orbit360({ radius: 0.42, height: 0.19, startAngle: rad(20),
                             arc: rad(70), target: [0, 0.14, 0] }) },

    // 13 — packshot: cup on the left, two beans beside it, the right third
    // empty for the wordmark in post. No text built.
    { name: 'SC13_pack', from: 860, to: 900, focalLength: 45, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: FILLINGS },
      move: hold([0.02, 0.16, 0.5], [0.08, 0.15, 0]) },
  ],
});
