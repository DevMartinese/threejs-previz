/**
 * tiramisu.js — the definitive recut: 11 shots, 720 frames, 24 fps, 2520x1080.
 * Product scale: the cup is 9 cm at the mouth, so subjectSize 0.09 brings the
 * near plane to ~0.0045 (nearFor) — the "about 0.005" the spec asks for.
 *
 * The cup is cut TWO ways at build time: the wall banded horizontally at
 * 22/22/26 mm for the hook, and wall + fillings + rim + dome halved
 * vertically for the close-up. The fillings follow the real product — base
 * layer wettest and darkest, thick soaked biscuit with thin cream veins, the
 * top cream thickest, a slightly domed cocoa disc over it, a paper lip.
 *
 * The moka, the glass and the cup are one chain: the cup pours into the
 * glass (6), the glass shows the result while a cube still falls in (8), and
 * the moka pours the coffee that soaks the biscuits (9) — the frozen droplet
 * arc runs from its spout anchor to the cup. Nothing is decoration.
 */
import { defineScene } from '../../lib/scene.js';
import { moves, retarget, slice, easings } from '../../lib/cameraMoves.js';

const rad = (d) => (d * Math.PI) / 180;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const ramp = (f, start, dur, ease = easings.easeInOutSine) =>
  ease(clamp01((f - start) / dur));
const lerp = (a, b, u) => a + (b - a) * u;
const fallEase = (u) => u * u;

/* ---------------------------------------------------------------- product -- */
const R_BOT = 0.0375, R_TOP = 0.045, CUP_H = 0.07, THICK = 0.0015, BASE = 0.002;
const HOVER = 0.085;
const CLONES = [0, 1, 2, 3, 4];                // clones are kraft, like the hero

/* The identity palette, straight from the spec's RGB floats. Scenery stays
 * Blender-grey — every colour on screen is a name to direct by. */
const identity = {
  grey: '#9a9a9a', greyDeep: '#7a7a7a', greyLine: '#b8b8b8',
  kraft: '#8c6138',
  cocoa: '#4d1f14',
  rim: '#ede6d9',
  soaked: '#291106',
  base: '#1c0b05',
  cream: '#f7edd1',
  tan: '#e0b87a',
  dark: '#211712',
  fill: '#f7f5e6',
  bean: '#422a1a',
  espresso: '#29170d',
  alu: '#c7c9d1',
  glass: '#dbe0e6',
  dust: '#4d1f14',       // the cloud — cocoa-dark, its own fadable material
};

/* Layers bottom to top, no gaps, per the real product (mm): base 14 / cream 8
 * / soaked 14 / cream 8 / soaked 13 / cream 10, then the domed cocoa disc and
 * the paper lip. Wall bands cut at 22/44 (pieces 22/22/26). */
const LAYERS = [
  { name: 'L01_base', t: 0.014, identity: 'base' },
  { name: 'L02_cream', t: 0.008, identity: 'cream' },
  { name: 'L03_soaked', t: 0.014, identity: 'soaked' },
  { name: 'L04_cream', t: 0.008, identity: 'cream' },
  { name: 'L05_soaked', t: 0.013, identity: 'soaked' },
  { name: 'L06_cream', t: 0.010, identity: 'cream' },
];
const CUTS = [0.022, 0.044];
// Which slice each assembly part rides in the hook's split. Layers straddling
// a wall cut simply ride the slice below and stand exposed in the gap.
const SLICE_OF = {
  PRP_cupS_b0: 0, PRP_cupS_b1: 1, PRP_cupS_b2: 2,
  PRP_L01_base: 0, PRP_L02_cream: 0, PRP_L03_soaked: 0,
  PRP_L04_cream: 1, PRP_L05_soaked: 1, PRP_L06_cream: 1,
  PRP_top_cocoa: 2, PRP_lip: 2,
};
const H_PARTS = ['PRP_cup', ...Object.keys(SLICE_OF)];
const V_NAMES = ['PRP_cupV', ...LAYERS.map((l) => `PRP_V${l.name}`),
                 'PRP_Vtop_cocoa', 'PRP_Vlip'];
const V_PARTS = V_NAMES.flatMap((n) => [`${n}_neg`, `${n}_pos`]);

/* The cocoa cloud: 14 chunky dark spheres up to 27 mm, seeded, shared by
 * build (meshes) and animate (detonation directions). */
const CLOUD = [];

/* Contact by design, declared per class. */
const ignore = [
  ['PRP_cup*', 'PRP_L*'], ['PRP_cup*', 'PRP_top_cocoa'], ['PRP_cup*', 'PRP_lip'],
  ['PRP_L*', 'PRP_top_cocoa'], ['PRP_lip', 'PRP_top_cocoa'], ['PRP_lip', 'PRP_L*'],
  ['PRP_cupS_*', 'PRP_cupS_*'],
  ['PRP_cup*', 'PRP_V*'], ['PRP_V*', 'PRP_V*'],
  ['PRP_lip', 'PRP_V*'], ['PRP_top_cocoa', 'PRP_V*'],
  ['PRP_cup', 'PRP_clone_*'], ['PRP_clone_*', 'PRP_L*'],
  ['PRP_clone_*', 'PRP_top_cocoa'], ['PRP_clone_*', 'PRP_lip'],
  ['PRP_ck0_*', 'PRP_ck0_*'], ['PRP_ck1_*', 'PRP_ck1_*'],
  ['PRP_ckS0_*', 'PRP_ckS0_*'], ['PRP_ckS1_*', 'PRP_ckS1_*'],
  ['PRP_ribbon', 'PRP_glass'], ['PRP_ribbon', 'PRP_cup*'],
  ['PRP_ribbon', 'PRP_L*'], ['PRP_ribbon', 'PRP_top_cocoa'], ['PRP_ribbon', 'PRP_lip'],
  ['PRP_glasscream', 'PRP_glass'],
  ['PRP_moka', 'PRP_moka_waist'],
  ['PRP_cloud_*', 'PRP_*'],
  ['PRP_puff_*', 'PRP_drop_*'], ['PRP_puff_*', 'PRP_cup*'],
];

/* Fillings, dome, lip and their vertical halves are part of the hero, never
 * blockers — the cup is a hollow wall. */
const FILLINGS = ['PRP_L*', 'PRP_top_cocoa', 'PRP_lip', 'PRP_V*'];

/* ------------------------------------------------------------------ build -- */
function build({ ctx, geo, blk }) {
  ctx.part('ENV_floor', geo.disc({ radius: 2 }), 'grey', ctx.groups.ENV);
  ctx.part('ENV_mound', geo.cone({ rBottom: 0.09, rTop: 0.02, h: 0.018 }),
           'greyDeep', ctx.groups.ENV).position.y = 0.009;
  // ten thin bars, 600 mm — the floor grid for the overhead
  ctx.part('ENV_grid',
    geo.gridBars({ size: 0.6, divisions: 9, thickness: 0.003, height: 0.0015 }),
    'greyLine', ctx.groups.ENV).position.y = 0.0015;

  ctx.get('LGT_hemi').groundColor.set('#8a8a8a');

  const wallGeo = () => geo.revolve(geo.cupProfile({
    rBottom: R_BOT, rTop: R_TOP, h: CUP_H, thickness: THICK, base: BASE }));
  const rAt = (y) => R_BOT + (y / CUP_H) * (R_TOP - R_BOT);
  const stackOpts = { layers: LAYERS, rAt, inset: THICK + 0.0004, y0: BASE };
  // The 7 mm cocoa disc, slightly domed, its underside sitting exactly on
  // the top cream so their vertical cut caps stay adjacent, never coplanar.
  const domeGeo = () => geo.ellipsoid({ rx: 0.0405, ry: 0.0035, rz: 0.0405 })
    .translate(0, 0.0725, 0);
  // rim() returns the torus in the XY plane — lay it FLAT before lifting it
  // to the mouth, or the lip renders as a giant vertical hoop and its
  // vertical halve becomes a full-height cut cap that z-fights the section.
  const lipGeo = () => geo.rim({ radius: 0.0448, thickness: 0.0012 })
    .rotateX(Math.PI / 2).translate(0, CUP_H, 0);

  // One cup, two cutting systems, both cut ONCE here: horizontal bands for
  // the hook; wall + fillings + dome + lip halved vertically for the close-up.
  ctx.part('PRP_cup', wallGeo(), 'kraft');
  blk.bands(ctx.part('PRP_cupS', wallGeo(), 'kraft'), 'y', CUTS);
  ctx.parts(geo.stack({ ...stackOpts, prefix: 'PRP_' }));
  ctx.part('PRP_top_cocoa', domeGeo(), 'cocoa');
  ctx.part('PRP_lip', lipGeo(), 'rim');
  blk.halve(ctx.part('PRP_cupV', wallGeo(), 'kraft'), 'z');
  for (const m of ctx.parts(geo.stack({ ...stackOpts, prefix: 'PRP_V' })))
    blk.halve(m, 'z');
  blk.halve(ctx.part('PRP_Vtop_cocoa', domeGeo(), 'cocoa'), 'z');
  blk.halve(ctx.part('PRP_Vlip', lipGeo(), 'rim'), 'z');

  // Sandwich cookies, 29 mm: dark 3.5 / fill 2.8 / dark 3.5. Whole + cracked.
  for (let i = 0; i < 2; i++) {
    ctx.parts(geo.sandwich({ name: `PRP_ck${i}`, radius: 0.0145, shell: 0.0035,
                             fill: 0.0028, outer: 'dark', inner: 'fill' }));
    const twin = ctx.parts(geo.sandwich({ name: `PRP_ckS${i}`, radius: 0.0145,
                             shell: 0.0035, fill: 0.0028, outer: 'dark', inner: 'fill' }));
    for (const m of twin) blk.halve(m, 'x');
  }

  // The cloud + puffs share the fadable 'dust' material.
  const dustMat = ctx.material('dust');
  dustMat.transparent = true;
  CLOUD.length = 0;
  CLOUD.push(...geo.cluster({ name: 'PRP_cloud', count: 14, radius: 0.055,
                              min: 0.004, max: 0.0135, identity: 'dust', seed: 7 }));
  ctx.parts(CLOUD);
  for (let i = 0; i < 8; i++)
    ctx.part(`PRP_puff_${i}`, geo.ellipsoid({ rx: 0.008, ry: 0.006, rz: 0.008 }), 'dust');

  // Ladyfingers 63x18x11 mm: a capsule widened on x — plus the 90 mm faller.
  const lfGeo = (k = 1) => geo.capsule({ r: 0.0055 * k, length: 0.052 * k })
    .scale(1.64, 1, 1);
  ctx.part('PRP_lf', lfGeo(90 / 63), 'tan');
  for (let i = 0; i < 3; i++) ctx.part(`PRP_lffloat_${i}`, lfGeo(), 'tan');

  // Beans 13x9x7 mm; mascarpone cubes 18 mm.
  for (let i = 0; i < 6; i++)
    ctx.part(`PRP_bean_${i}`, geo.ellipsoid({ rx: 0.0065, ry: 0.0035, rz: 0.0045 }), 'bean');
  for (let i = 0; i < 4; i++)
    ctx.part(`PRP_masc_${i}`, geo.box({ x: 0.018, y: 0.018, z: 0.018 }), 'cream');

  for (const i of CLONES)
    ctx.part(`PRP_clone_${i}`, wallGeo(), 'kraft').scale.setScalar(0.94);

  // The espresso glass, 76 across x 60 tall, with 22 mm of cream for cut 8.
  const glassMat = ctx.material('glass');
  glassMat.transparent = true;
  glassMat.opacity = 0.35;
  ctx.part('PRP_glass', geo.revolve(geo.cupProfile({
    rBottom: 0.028, rTop: 0.038, h: 0.06, thickness: 0.0015, base: 0.003 })), 'glass');
  ctx.part('PRP_glasscream',
    geo.cone({ rBottom: 0.03, rTop: 0.033, h: 0.022 }).translate(0, 0.016, 0), 'cream');

  // The ribbon: 180 mm tapered cone, 24 mm at the wide (mouth) end, hanging
  // from its origin so anchors + scale.y drive it.
  ctx.part('PRP_ribbon',
    geo.cone({ rBottom: 0.005, rTop: 0.012, h: 0.18 }).translate(0, -0.09, 0),
    'cream');

  // The moka: two octagonal cones meeting at a dark waist, lid, knob, handle
  // and spout — composed on the spot; the waist is its own (dark) part.
  ctx.part('PRP_moka', geo.merge([
    geo.cone({ rBottom: 0.033, rTop: 0.017, h: 0.0275, segments: 8 }).translate(0, 0.01375, 0),
    geo.cone({ rBottom: 0.017, rTop: 0.034, h: 0.0275, segments: 8 }).translate(0, 0.04925, 0),
    geo.cone({ rBottom: 0.034, rTop: 0.028, h: 0.008, segments: 8 }).translate(0, 0.067, 0),
    geo.cone({ rBottom: 0.006, rTop: 0.004, h: 0.008, segments: 8 }).translate(0, 0.075, 0),
    geo.box({ x: 0.007, y: 0.028, z: 0.012 }).translate(-0.042, 0.048, 0),
    geo.cone({ rBottom: 0.006, rTop: 0.0035, h: 0.016, segments: 8 })
      .rotateZ(rad(-55)).translate(0.038, 0.06, 0),
  ]), 'alu');
  ctx.part('PRP_moka_waist',
    geo.cone({ rBottom: 0.0165, rTop: 0.0165, h: 0.008, segments: 8 })
      .translate(0, 0.0315, 0), 'espresso');

  for (let i = 0; i < 8; i++)
    ctx.part(`PRP_drop_${i}`, geo.ellipsoid({ rx: 0.005, ry: 0.0055, rz: 0.005 }), 'espresso');

  // The macro stream set: 4 beans, 3 cookies, 3 ladyfingers.
  for (let i = 0; i < 10; i++) {
    const kind = i < 4 ? 'bean' : i < 7 ? 'ck' : 'lf';
    const g = kind === 'bean' ? geo.ellipsoid({ rx: 0.0065, ry: 0.0035, rz: 0.0045 })
      : kind === 'ck' ? geo.cone({ rBottom: 0.0145, rTop: 0.0145, h: 0.0098 })
      : lfGeo();
    ctx.part(`PRP_macro_${i}`, g, kind === 'bean' ? 'bean' : kind === 'ck' ? 'dark' : 'tan');
  }
}

/* ------------------------------------------------------------------ shots -- */
const CUT = {
  hook: [0, 90], spiral: [90, 155], travel: [155, 215], fan: [215, 290],
  close: [290, 350], pour: [350, 405], gap: [405, 420], overhead: [420, 480],
  arc: [480, 535], ring: [535, 610], macro: [610, 720],
};

const FAN_ANGLES = [100, 140, 180, 220, 260];
const FAN_R = 0.17;                             // the spec's ~17 cm fan
const RING_R = 0.12;                            // a ring at ~24 cm
const RING_ANGLES = [27, 99, 171, 243, 315];    // gap at 135° for the fly-through
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

// The frozen espresso arc: P0 is the moka's SPOUT anchor, computed per frame.
const ARC_P1 = [-0.11, 0.32, -0.04], ARC_P2 = [-0.05, 0.168, -0.012];
const SPOUT = [0.045, 0.068, 0];                // spout tip, moka local space
const arcAt = (p0, t) => [0, 1, 2].map((k) =>
  (1 - t) * (1 - t) * p0[k] + 2 * (1 - t) * t * ARC_P1[k] + t * t * ARC_P2[k]);

/* ---------------------------------------------------------------- animate -- */
const DYNAMIC = [
  ...H_PARTS, ...V_PARTS, 'PRP_lf',
  ...[0, 1].flatMap((i) => ['bot', 'fill', 'top'].flatMap((p) =>
    [`PRP_ck${i}_${p}`, `PRP_ckS${i}_${p}_neg`, `PRP_ckS${i}_${p}_pos`])),
  ...Array.from({ length: 3 }, (_, i) => `PRP_lffloat_${i}`),
  ...Array.from({ length: 6 }, (_, i) => `PRP_bean_${i}`),
  ...Array.from({ length: 4 }, (_, i) => `PRP_masc_${i}`),
  ...CLONES.map((i) => `PRP_clone_${i}`),
  'PRP_glass', 'PRP_glasscream', 'PRP_ribbon', 'PRP_moka', 'PRP_moka_waist', 'ENV_grid',
  ...Array.from({ length: 8 }, (_, i) => `PRP_drop_${i}`),
  ...Array.from({ length: 8 }, (_, i) => `PRP_puff_${i}`),
  ...Array.from({ length: 14 }, (_, i) => `PRP_cloud_${String(i).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `PRP_macro_${i}`),
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
  const placeCup = (y, { x = 0, z = 0, rotY = 0, rotZ = 0,
                         split = 0, mode = 'whole', lift = 0 } = {}) => {
    for (const name of H_PARTS) {
      const isWhole = name === 'PRP_cup';
      const isBand = name.startsWith('PRP_cupS');
      const visible = mode === 'vertical' ? false
        : mode === 'bands' ? !isWhole : !isBand;
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
  ctx.material('dust').opacity = 1;
  const cut = Object.entries(CUT).find(([, [a, b]]) => frame >= a && frame < b);
  if (!cut) return;
  const [name, [start]] = cut;
  const f = frame - start;

  if (name === 'hook') {
    // 90 frames at 24 fps: the 90 mm ladyfinger drops like a bullet (0-18),
    // buries in the mound; the cloud detonates at the impact and drifts; the
    // cup erupts with beans and cookies around it; freeze; the wall splits
    // into its three bands showing the layers (40-56), cookies crack; snap
    // (62-70); one sharp full turn at a 12 degree tilt (72-88). Cloud fades.
    if (f < 19) show('PRP_lf', [0.05, lerp(0.7, -0.01, f / 18), -0.03]);
    ctx.material('dust').opacity = 1 - ramp(f, 66, 18);
    const boom = ramp(f, 18, 8, easings.easeOutCubic);
    const driftT = Math.max(0, f - 26) / 64;
    CLOUD.forEach((d, i) => {
      const [bx, by, bz] = d.position;
      const e = 0.06 + boom * 0.99 + driftT * 0.35;
      const airY = 0.05 + Math.abs(by) * e * 0.8 + driftT * 0.03
        + 0.004 * Math.sin(f * 0.12 + i * 2);
      const o = show(`PRP_cloud_${String(i).padStart(2, '0')}`, [
        bx * e, lerp(0.006, airY, Math.min(1, boom * 1.2)), bz * e]);
      o.scale.setScalar(0.18 + 0.82 * boom);
      o.rotation.set(rad(i * 40 + f * 0.3), rad(i * 70), 0);
    });
    const rise = ramp(f, 18, 20, easings.easeOutCubic);
    const split = ramp(f, 40, 16) - ramp(f, 62, 8, easings.easeInOutCubic);
    const splitting = f >= 38 && f < 70;
    const turn = ramp(f, 72, 16, easings.easeInOutCubic);
    placeCup(lerp(0.004, HOVER, rise), {
      split, mode: splitting ? 'bands' : 'whole',
      rotY: Math.PI * 2 * turn, rotZ: rad(12) * Math.sin(Math.PI * turn) });
    if (f >= 20) {
      const up = ramp(f, 20, 20, easings.easeOutCubic);
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
      cookie(0, -0.062, lerp(0.005, 0.11, up), -0.03);
      cookie(1, 0.078, lerp(0.005, 0.16, up), 0.03);
    }
  }

  if (name === 'spiral') {
    placeCup(HOVER);
    for (let i = 0; i < 5; i++) {
      const [x, , z] = polarXZ(i * 72 + 15, 0.062 + (i % 3) * 0.012);
      show(`PRP_bean_${i}`, [x, 0.015 + ((f + i * 8) / 65) * 0.2, z])
        .rotation.set(rad(30 * i), rad(50 * i), 0);
    }
    for (let i = 0; i < 3; i++) {
      const [x, , z] = polarXZ(i * 120 + 55, 0.105);
      show(`PRP_lffloat_${i}`, [x, 0.04 + ((f + i * 12) / 65) * 0.2, z])
        .rotation.set(rad(20 + 25 * i), 0, rad(35 * i - 30));
    }
  }

  if (name === 'travel') placeCup(HOVER);

  if (name === 'fan') {
    placeCup(HOVER, { rotY: rad(0.2) * f });
    CLONES.forEach((c, i) => {
      const out = ramp(f, 6 + i * 9, 16, easings.easeInOutCubic);
      const back = ramp(f, 42 + i * 5, 12, easings.easeInOutCubic);
      const k = out * (1 - back);
      if (k <= 0) return;
      const [tx, , tz] = polarXZ(FAN_ANGLES[i], FAN_R);
      show(`PRP_clone_${c}`, [tx * k, HOVER, tz * k]);
    });
  }

  if (name === 'close') {
    // vertical system: swap whole -> halves at f8 (coincident), the FRONT
    // half lifts out of frame (8-20), holds, returns (40-50), swap back f52,
    // while the whole assembly sweeps -35 to +35 degrees.
    const rotY = rad(lerp(-35, 35, f / 60));
    const vertical = f >= 8 && f < 52;
    const lift = 0.19 * (ramp(f, 8, 12) - ramp(f, 40, 10));
    placeCup(0.105, { rotY, mode: vertical ? 'vertical' : 'whole', lift });
    for (let i = 0; i < 3; i++) {
      show(`PRP_masc_${i}`, [-0.07 - (i % 2) * 0.02,
                             0.02 + ((f + i * 11) / 60) * 0.2,
                             i === 1 ? 0.055 : -0.06])
        .rotation.set(rad(20 * i + f * 0.5), rad(15 * i), rad(9 * i));
    }
  }

  if (name === 'pour') {
    // the cup tilted ~120 degrees above the glass; ribbon origin, aim and
    // length all derived from anchors — mouth to glass mouth, wherever they
    // are. Fallers freeze their tumble at touchdown.
    show('PRP_glass', [-0.055, 0, 0]);
    placeCup(0.19, { x: 0.075, rotZ: rad(120) });
    const mouth = ctx.anchor('PRP_cup', [0, CUP_H, 0]);
    const glassMouth = ctx.anchor('PRP_glass', [0, 0.06, 0]);
    const dx = mouth.x - glassMouth.x, dy = mouth.y - glassMouth.y;
    const r = show('PRP_ribbon', [mouth.x, mouth.y, mouth.z]);
    r.rotation.z = Math.atan2(-dx, dy);
    r.scale.y = (Math.hypot(dx, dy) / 0.18) * lerp(0.7, 1, ramp(f, 0, 14));
    showCookie(0, [-0.14, lerp(0.42, 0.021, ramp(f, 0, 34, fallEase)), 0.05],
               [rad(20 + Math.min(f, 34)), 0, rad(15)]);
    showCookie(1, [0.17, lerp(0.5, 0.021, ramp(f, 12, 38, fallEase)), -0.06],
               [rad(Math.min(f, 50) * 1.5), rad(30), 0]);
    show('PRP_bean_2', [-0.1, lerp(0.36, 0.008, ramp(f, 6, 30, fallEase)), -0.07])
      .rotation.z = rad(40 + Math.min(f, 36));
    show('PRP_bean_3', [0.12, lerp(0.44, 0.008, ramp(f, 18, 32, fallEase)), 0.08])
      .rotation.x = rad(Math.min(f, 50) * 2);
  }

  // 'gap' — editorial placeholder, empty grey stage.

  if (name === 'overhead') {
    show('ENV_grid');
    show('PRP_glass', [0.1, 0, 0]);
    show('PRP_glasscream', [0.1, 0, 0]);
    show('PRP_masc_0', [0.1, lerp(0.3, 0.1, ramp(f, 0, 55, fallEase)), 0])
      .rotation.set(rad(f), rad(f * 1.3), 0);
    placeCup(HOVER, { rotY: rad(0.4) * f });
  }

  if (name === 'arc') {
    placeCup(HOVER);
    const mokaPos = [-0.24, 0.25 + 0.004 * Math.sin(f * 0.05), -0.06];
    show('PRP_moka', mokaPos).rotation.set(0, rad(10), rad(-35));
    show('PRP_moka_waist', mokaPos).rotation.set(0, rad(10), rad(-35));
    const spout = ctx.anchor('PRP_moka', SPOUT).toArray();
    for (let i = 0; i < 8; i++) {
      const [ax, ay, az] = arcAt(spout, 0.08 + 0.92 * (i / 7));
      const up = ramp(f, i * 4, 22, easings.easeOutCubic);
      show(`PRP_drop_${i}`, [ax, lerp(0.008, ay, up), az]);
      const bloom = ramp(f, i * 4 + 22, 7, easings.easeOutCubic);
      show(`PRP_puff_${i}`, [ax, ay + 0.005, az])
        .scale.setScalar(Math.max(0.001, bloom));
    }
  }

  if (name === 'ring') {
    placeCup(HOVER);
    RING_ANGLES.forEach((a, i) => {
      const down = ramp(f, i * 5, 20, easings.easeOutCubic);
      const [x, , z] = polarXZ(a, RING_R);
      show(`PRP_clone_${i}`, [x, lerp(0.45, 0.04, down), z]);
    });
  }

  if (name === 'macro') {
    // the stream set on an endless upward loop; wraps happen outside frame
    for (let i = 0; i < 10; i++) {
      const speed = 0.0034 + (i % 4) * 0.0013;
      const y = 0.03 + ((i * 0.026 + f * speed) % 0.26);
      const m = show(`PRP_macro_${i}`,
        [1.42 + (i % 7) * 0.026, y, -0.12 + ((i * 7) % 13) * 0.019]);
      m.rotation.set(rad(i * 30 + f * 1.5), rad(i * 50), rad(f * (1 + (i % 3))));
    }
  }
}

/* ------------------------------------------------------------------ scene -- */
const hold = (position, target) => moves.truck({ from: position, to: position, target });

export default defineScene({
  id: 'tiramisu',
  fps: 24,
  height: 1080,
  aspect: 21 / 9,
  subjectSize: 0.09,
  background: '#3a3a3a',
  identity,
  ignore,
  floorIgnore: ['PRP_lf'],
  // The chain, measured: pour from the mouth into the glass; arc from the
  // moka's spout to the cup. `settle` entries check once the move arrives.
  attachments: [
    { a: 'PRP_ribbon', b: 'PRP_cup', bLocal: [0, CUP_H, 0], tol: 0.004 },
    { a: 'PRP_ribbon', aLocal: [0, -0.18, 0],
      b: 'PRP_glass', bLocal: [0, 0.06, 0], tol: 0.025, settle: true },
    { a: 'PRP_drop_0', b: 'PRP_moka', bLocal: SPOUT, tol: 0.03, settle: true },
    { a: 'PRP_drop_7', b: 'PRP_cup', bLocal: [-0.045, 0.07, -0.012], tol: 0.018, settle: true },
  ],
  build,
  animate,
  shots: [
    // 1 — the hook, 45mm: impact transitional, then the cup/bands hold frame.
    { name: 'SC01a_impact', from: 0, to: 36, focalLength: 45, easing: 'linear',
      hero: [],
      move: slice(moves.pushIn({ from: 0.5, to: 0.42, height: 0.16, target: [0, 0.125, 0] }), 0, 0.4) },
    { name: 'SC01b_freeze', from: 36, to: 90, focalLength: 45, easing: 'linear', joins: true,
      hero: ['PRP_cup', 'PRP_cupS_*'],
      occlusion: { ignore: [...FILLINGS, 'PRP_cloud_*'] },
      move: slice(moves.pushIn({ from: 0.5, to: 0.42, height: 0.16, target: [0, 0.125, 0] }), 0.4, 1) },

    // 2 — spiral up from the cloud, 50mm.
    { name: 'SC02_spiral', from: 90, to: 155, focalLength: 50, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: FILLINGS },
      move: moves.turntable({ radius: 0.38, pushIn: 0.95, arc: rad(300),
                              phiLow: rad(3), phiHigh: rad(22), target: [0, 0.125, 0] }) },

    // 3 — hold at the cocoa top, then travel down the kraft wall, 50mm.
    { name: 'SC03a_top', from: 155, to: 180, focalLength: 50, easing: 'linear',
      hero: 'PRP_top_cocoa',
      move: hold([0.22, 0.44, 0.14], [0, 0.155, 0]) },
    { name: 'SC03b_down', from: 180, to: 215, focalLength: 50, easing: 'easeInOutSine',
      hero: [],
      move: retarget(
        moves.truck({ from: [0.22, 0.44, 0.14], to: [0.17, 0.07, 0.11] }),
        { targets: [[0, 0.155, 0], [0, 0.095, 0]] }) },

    // 4 — wide arc, clones fan to ~17 cm and get sucked back, 50mm.
    { name: 'SC04_fan', from: 215, to: 290, focalLength: 50, easing: 'linear',
      hero: 'PRP_cup', occlusion: { ignore: ['PRP_clone_*', ...FILLINGS] },
      move: moves.orbit360({ radius: 0.62, height: 0.24, startAngle: rad(-60),
                             arc: rad(120), target: [0, 0.11, 0] }) },

    // 5 — close-up, 50mm: the front half lifts out of frame by design.
    { name: 'SC05_close', from: 290, to: 350, focalLength: 50, easing: 'linear',
      hero: ['PRP_cup', 'PRP_cupV_neg'],
      occlusion: { ignore: [...FILLINGS, 'PRP_cupV_pos', 'PRP_masc_*'] },
      move: moves.pushIn({ from: 0.44, to: 0.4, height: 0.15, target: [-0.06, 0.145, 0] }) },

    // 6 — the pour from outside, 38mm, camera low and to the side; the whole
    // chain lives in the X-Y plane, so the camera sits out on +Z.
    { name: 'SC06_pour', from: 350, to: 405, focalLength: 38, easing: 'linear',
      hero: ['PRP_cup', 'PRP_glass'],
      occlusion: { ignore: [...FILLINGS, 'PRP_ribbon', 'PRP_ck*', 'PRP_bean_*'] },
      move: moves.truck({ from: [0.12, 0.05, 0.62], to: [0.09, 0.06, 0.65],
                          target: [0.02, 0.12, 0] }) },

    // 7 — GAP, 50mm.
    { name: 'SC07_gap', from: 405, to: 420, focalLength: 50, easing: 'linear',
      hero: [],
      move: hold([0, 0.18, 0.5], [0, 0.08, 1.2]) },

    // 8 — steep overhead circle: cup + glass (cream inside, cube falling in),
    // grid on the floor, 50mm.
    { name: 'SC08_overhead', from: 420, to: 480, focalLength: 50, easing: 'linear',
      hero: ['PRP_cup', 'PRP_glass'],
      occlusion: { ignore: [...FILLINGS, 'PRP_glasscream', 'PRP_masc_*'] },
      move: moves.orbit360({ radius: 0.95, height: 0, phi: rad(66),
                             startAngle: rad(-20), arc: rad(120), target: [0.05, 0.102, 0] }) },

    // 9 — the moka pours: eight droplets frozen spout-to-cup, a cocoa puff at
    // each, 35mm.
    { name: 'SC09_arc', from: 480, to: 535, focalLength: 35, easing: 'linear',
      hero: ['PRP_cup', 'PRP_moka'],
      occlusion: { ignore: [...FILLINGS, 'PRP_drop_*', 'PRP_puff_*', 'PRP_moka_waist'] },
      move: moves.truck({ from: [0.52, 0.22, 0.36], to: [0.48, 0.22, 0.4],
                          target: [-0.05, 0.19, 0] }) },

    // 10 — the ring at ~24 cm; the camera flies low between the cups on a
    // CURVED path (bezier), touching nothing — clearance is measured, 50mm.
    { name: 'SC10_ring', from: 535, to: 610, focalLength: 50, easing: 'easeInOutSine',
      hero: [],
      move: moves.bezier({ from: polarXZ(135, 0.3, 0.032), via: polarXZ(207, 0.08, 0.032),
                           to: polarXZ(279, 0.3, 0.032), target: [0, 0.1, 0] }) },

    // 11 — macro, 85mm: the stream set, frame never empty, hero out of shot.
    { name: 'SC11_macro', from: 610, to: 720, focalLength: 85, easing: 'linear',
      hero: [],
      move: moves.truck({ from: [1.5, 0.15, 0.5], to: [1.5, 0.15, 0.47],
                          target: [1.5, 0.15, 0] }) },
  ],
});
