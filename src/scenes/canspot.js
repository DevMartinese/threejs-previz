/**
 * canspot.js — a 13-cut product piece for a soda can, recut as ONE scene.
 * 30 fps, 21:9, 900 frames. The stress test for the pipeline: CSG slices,
 * cracked fruit, clone choreography, object animation as a pure function of
 * the frame, and a hero declared on every cut.
 *
 * Colours are identity: the can is aluminium; the five clones are blueberry,
 * cherry, lime, orange and raspberry — direction happens by those names.
 *
 * All geometry is cut ONCE at build time (bands for the can, halve for the
 * fruit); animate() only moves and shows/hides what already exists.
 */
import { defineScene } from '../../lib/scene.js';
import { moves, retarget, slice, easings } from '../../lib/cameraMoves.js';

const rad = (d) => (d * Math.PI) / 180;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
/** Progress of a local-frame window: 0 before `start`, 1 after `start+dur`. */
const ramp = (f, start, dur, ease = easings.easeInOutSine) =>
  ease(clamp01((f - start) / dur));
const lerp = (a, b, u) => a + (b - a) * u;

/* ------------------------------------------------------------------ cast -- */
const CAN_R = 0.032, CAN_H = 0.122;
const HOVER = 0.12;                     // the can's resting base height
const CLONES = ['blueberry', 'cherry', 'lime', 'orange', 'raspberry'];

const identity = {
  water: '#3f6c8e',
  grid: '#7d8a94',
  aluminium: '#c3c9cf',
  glass: '#bcd9dd',
  ice: '#e4f2f6',
  lemon: '#f5d442',
  blueberry: '#4f6ddc',
  cherry: '#b91d2e',
  lime: '#7ac143',
  orange: '#f39c12',
  raspberry: '#d94f8a',
};

/* The can slices and the fruit halves touch their siblings by construction —
 * the split animation opens and closes those exact contacts. Declared per
 * object so a slice hitting anything else still counts. The clones OVERLAP
 * the main can while emerging: they are born inside it and slide out of its
 * silhouette (fan and reveal), which is the point of the shot — clones come
 * out of the can, they don't spawn beside it. Contact by design, declared. */
const ignore = [
  ['PRP_canS_*', 'PRP_canS_*'],
  ['PRP_can', 'PRP_can_lid'],
  ['PRP_can', 'PRP_clone_*'],
  ['PRP_fruitS_rasp_*', 'PRP_fruitS_rasp_*'],
  ['PRP_fruitS_lime_*', 'PRP_fruitS_lime_*'],
];

/* ------------------------------------------------------------------ build -- */
function build({ ctx, geo, blk }) {
  ctx.part('ENV_water', geo.disc({ radius: 3 }), 'water', ctx.groups.ENV);
  ctx.part('ENV_grid',
    geo.gridBars({ size: 1.2, divisions: 12, thickness: 0.004, height: 0.002 }),
    'grid', ctx.groups.ENV).position.y = 0.002;

  const canGeo = () => geo.cone({ rBottom: CAN_R - 0.001, rTop: CAN_R, h: CAN_H })
    .translate(0, CAN_H / 2, 0);          // base at y 0, so position = base

  const can = ctx.part('PRP_can', canGeo(), 'aluminium');
  // The lid as its own part, parented to the can so it inherits every
  // transform — same logic as the roundtable's separate tabletop: "hold at
  // the lid" needs a lid that can be a framing hero.
  const lid = ctx.part('PRP_can_lid', geo.disc({ radius: CAN_R * 0.86 }), 'aluminium');
  can.add(lid);
  lid.position.y = CAN_H + 0.001;

  // The sliceable twin, cut once at build time into three horizontal bands.
  const canS = ctx.part('PRP_canS', canGeo(), 'aluminium');
  blk.bands(canS, 'y', [0.042, 0.082]);   // -> PRP_canS_b0 / _b1 / _b2

  // Two fruits for the hook: a whole version and a pre-halved twin each.
  const fruit = (name, colour, r) => {
    ctx.part(`PRP_fruit_${name}`, geo.ellipsoid({ rx: r, ry: r * 0.9, rz: r }), colour);
    const s = ctx.part(`PRP_fruitS_${name}`,
      geo.ellipsoid({ rx: r, ry: r * 0.9, rz: r }), colour);
    blk.halve(s, 'x');                    // -> PRP_fruitS_<name>_neg / _pos
  };
  fruit('rasp', 'raspberry', 0.016);
  fruit('lime', 'lime', 0.018);

  // A hair smaller than the original: while a clone is still inside the can
  // their walls would otherwise be coplanar and z-fight during the emergence.
  for (const c of CLONES) ctx.part(`PRP_clone_${c}`, canGeo(), c).scale.setScalar(0.94);

  const glassMat = ctx.material('glass');
  glassMat.transparent = true;
  glassMat.opacity = 0.35;
  ctx.part('PRP_glass',
    geo.revolve(geo.cupProfile({ rBottom: 0.024, rTop: 0.032, h: 0.095,
                                 thickness: 0.002, base: 0.004 })), 'glass');

  for (let i = 0; i < 6; i++)
    ctx.part(`PRP_ice_${i}`, geo.box({ x: 0.016, y: 0.016, z: 0.016 }), 'ice');

  ctx.part('PRP_ball', geo.ellipsoid({ rx: 0.014, ry: 0.014, rz: 0.014 }), 'aluminium');
  for (let i = 0; i < 8; i++)
    ctx.part(`PRP_ballr_${i}`, geo.ellipsoid({ rx: 0.01, ry: 0.01, rz: 0.01 }), 'ice');

  const berryColours = ['blueberry', 'cherry', 'raspberry', 'blueberry',
                        'raspberry', 'cherry', 'blueberry', 'raspberry'];
  berryColours.forEach((c, i) =>
    ctx.part(`PRP_berry_${i}`, geo.ellipsoid({ rx: 0.008, ry: 0.008, rz: 0.008 }), c));

  const macroColours = ['lemon', 'lime', 'ice'];
  for (let i = 0; i < 12; i++) {
    const c = macroColours[i % 3];
    ctx.part(`PRP_macro_${i}`, c === 'ice'
      ? geo.box({ x: 0.018, y: 0.018, z: 0.018 })
      : geo.ellipsoid({ rx: 0.015, ry: 0.011, rz: 0.011 }), c);
  }
}

/* ------------------------------------------------------------------ cuts -- */
const CUT = {
  hook: [0, 150], spiral: [150, 225], travel: [225, 300], fan: [300, 420],
  close: [420, 495], glass: [495, 555], gap: [555, 585], overhead: [585, 645],
  balls: [645, 705], ring: [705, 765], macro: [765, 810], reveal: [810, 860],
  pack: [860, 900],
};

const RING_R = 0.18;                                   // cut 10 clone ring
const RING_ANGLES = [27, 99, 171, 243, 315];           // gap at 135° = the camera's path
// Fan/bloom targets live in the BACK hemisphere (the camera orbits the front):
// a path from the hiding spot behind the can to a front-side target would pass
// straight through the can — the collision audit caught exactly that.
const FAN_ANGLES = [120, 150, 180, 210, 240];
const FAN_R = 0.16;
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

/* ---------------------------------------------------------------- animate --
 * Pure function of the frame: every dynamic object is hidden, then the active
 * cut shows and poses what it needs — no state survives between frames.
 */
const DYNAMIC = [
  'PRP_can', 'PRP_canS_b0', 'PRP_canS_b1', 'PRP_canS_b2',
  'PRP_fruit_rasp', 'PRP_fruit_lime',
  'PRP_fruitS_rasp_neg', 'PRP_fruitS_rasp_pos',
  'PRP_fruitS_lime_neg', 'PRP_fruitS_lime_pos',
  ...CLONES.map((c) => `PRP_clone_${c}`),
  'PRP_glass', 'ENV_grid', 'PRP_ball',
  ...Array.from({ length: 6 }, (_, i) => `PRP_ice_${i}`),
  ...Array.from({ length: 8 }, (_, i) => `PRP_ballr_${i}`),
  ...Array.from({ length: 8 }, (_, i) => `PRP_berry_${i}`),
  ...Array.from({ length: 12 }, (_, i) => `PRP_macro_${i}`),
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
  // The lid is a child of the can: it inherits every transform and is never
  // posed directly — only its visibility mirrors the can's (the audits check
  // each mesh's own flag, not the ancestor chain).
  get('PRP_can_lid').visible = false;
  const cut = Object.entries(CUT).find(([, [a, b]]) => frame >= a && frame < b);
  if (!cut) return;
  const [name, [start]] = cut;
  const f = frame - start;                             // local frame

  if (name === 'hook') {
    // Ball like a bullet (f0-26), the can out of the impact (26-56), fruit up
    // (30-60), freeze, split (66-96), snap back (96-108), one sharp turn.
    if (f < 26) show('PRP_ball', [0, lerp(1.0, 0.012, f / 26), 0]);
    const rise = ramp(f, 26, 30, easings.easeOutCubic);
    const canY = lerp(0.004, HOVER, rise);
    const split = ramp(f, 66, 30) - ramp(f, 96, 12, easings.easeInOutCubic);
    const splitting = f >= 63 && f < 108;
    if (f >= 26 && !splitting) {
      const can = show('PRP_can', [0, canY, 0]);
      const turn = ramp(f, 112, 30, easings.easeInOutCubic);
      can.rotation.y = Math.PI * 2 * turn;
      can.rotation.z = rad(14) * Math.sin(Math.PI * turn);
    }
    if (splitting) {
      show('PRP_canS_b0', [0, canY, 0]);
      show('PRP_canS_b1', [0, canY + 0.02 * split, 0]);
      show('PRP_canS_b2', [0, canY + 0.04 * split, 0]);
    }
    if (f >= 30) {
      const fRise = ramp(f, 30, 30, easings.easeOutCubic);
      const pose = { rasp: [-0.09, lerp(0.022, 0.17, fRise), 0.015],
                     lime: [0.075, lerp(0.022, 0.23, fRise), -0.02] };
      for (const [fr, p] of Object.entries(pose)) {
        if (splitting) {
          const dx = 0.016 * split;
          show(`PRP_fruitS_${fr}_neg`, [p[0] - dx, p[1], p[2]]);
          show(`PRP_fruitS_${fr}_pos`, [p[0] + dx, p[1], p[2]]);
        } else {
          show(`PRP_fruit_${fr}`, p);
        }
      }
    }
  }

  if (name === 'spiral') {
    show('PRP_can', [0, HOVER, 0]);
    for (let i = 0; i < 8; i++) {
      const [x, , z] = polarXZ(i * 45 + 20, 0.07 + (i % 3) * 0.022);
      show(`PRP_berry_${i}`, [x, 0.02 + ((f + i * 9) / 75) * 0.3, z]);
    }
  }

  if (name === 'travel') show('PRP_can', [0, HOVER, 0]);

  if (name === 'fan') {
    const can = show('PRP_can', [0, HOVER, 0]);
    can.rotation.y = rad(0.25) * f;
    CLONES.forEach((c, i) => {
      // ease IN-out: easeOutCubic's first visible frame was already 13% of
      // the way out — the continuity audit reads that as popping into view
      // beside the can instead of emerging from inside it.
      const out = ramp(f, 10 + i * 12, 22, easings.easeInOutCubic);
      const back = ramp(f, 70 + i * 8, 14, easings.easeInOutCubic);
      const k = out * (1 - back);
      if (k <= 0) return;
      // Each clone is born at the can's own position and slides out of its
      // silhouette along its own ray — clones come OUT of the can, they
      // don't spawn beside it. Radial paths never cross each other; the
      // overlap with the main can during emergence is declared in `ignore`.
      const [tx, , tz] = polarXZ(FAN_ANGLES[i], FAN_R);
      show(`PRP_clone_${c}`, [tx * k, HOVER, tz * k]);
    });
  }

  if (name === 'close') {
    const can = show('PRP_can', [0, 0.148, 0]);
    can.rotation.y = rad(0.8) * f;
    for (let i = 0; i < 6; i++) {
      const front = i % 2 === 0;
      show(`PRP_ice_${i}`, [-0.03 + (i % 3) * 0.035,
                            0.02 + ((f + i * 12) / 75) * 0.32,
                            front ? 0.075 : -0.085]).rotation
        .set(rad(20 * i + f), rad(15 * i), rad(9 * i));
    }
  }

  if (name === 'glass') {
    show('PRP_glass');
    // No spin: a horizontal can's swinging AABB walked out of frame (audit
    // caught it at f542). It hangs, pouring — that's the pose. Tilted +80°
    // the body extends toward -x, so the base sits at +x with the pouring
    // tip over the glass mouth at the origin.
    show('PRP_can', [0.12, 0.38, 0]).rotation.z = rad(80);
  }

  // 'gap' — an editorial placeholder: nothing on stage, camera on empty water.

  if (name === 'overhead') {
    show('ENV_grid');
    show('PRP_glass', [0.09, 0, 0]);
    show('PRP_can', [0, HOVER, 0]).rotation.y = rad(0.4) * f;
  }

  if (name === 'balls') {
    show('PRP_can', [0, HOVER, 0]);
    for (let i = 0; i < 8; i++) {
      const [x, , z] = polarXZ(i * 44 + 10, 0.12 + (i % 4) * 0.045);
      const h = 0.08 + ((i * 37) % 5) * 0.05;
      // rising from below, decelerating to a dead stop — frozen mid-air
      show(`PRP_ballr_${i}`, [x, 0.012 + h * ramp(f, i * 5, 26, easings.easeOutCubic), z]);
    }
  }

  if (name === 'ring') {
    show('PRP_can', [0, HOVER, 0]);
    RING_ANGLES.forEach((a, i) => {
      const down = ramp(f, i * 6, 24, easings.easeOutCubic);
      const [x, , z] = polarXZ(a, RING_R);
      show(`PRP_clone_${CLONES[i]}`, [x, lerp(0.6, 0.06, down), z]);
    });
  }

  if (name === 'macro') {
    // an endless upward stream at different depths; wraps happen outside frame
    for (let i = 0; i < 12; i++) {
      const speed = 0.0045 + (i % 4) * 0.0016;
      const y = 0.03 + ((i * 0.021 + f * speed) % 0.24);
      const m = show(`PRP_macro_${i}`,
        [1.44 + (i % 5) * 0.03, y, -0.14 + ((i * 7) % 12) * 0.02]);
      m.rotation.set(rad(i * 30 + f * 2), rad(i * 50), rad(f * (1 + (i % 3))));
    }
  }

  if (name === 'reveal') {
    const canY = lerp(0.1, 0.15, ramp(f, 0, 40, easings.easeOutCubic));
    const can = show('PRP_can', [0, canY, 0]);
    can.rotation.y = rad(3) * f;
    CLONES.forEach((c, i) => {
      const bloom = ramp(f, 8 + i * 7, 16, easings.easeInOutCubic);
      if (bloom <= 0) return;
      // Born inside the rising can, blooming out of it radially — same
      // emergence contract as the fan cut.
      const [tx, , tz] = polarXZ(FAN_ANGLES[i], 0.19);
      show(`PRP_clone_${c}`,
        [tx * bloom, lerp(canY, 0.1 + i * 0.012, bloom), tz * bloom]);
    });
  }

  if (name === 'pack') {
    const can = show('PRP_can', [0, 0.16 + 0.006 * Math.sin(f * 0.08), 0]);
    can.rotation.y = rad(0.5) * f;
    show('PRP_berry_0', [-0.07, 0.15 + 0.004 * Math.sin(f * 0.1), 0.03]);
    show('PRP_berry_1', [-0.06, 0.23 + 0.004 * Math.sin(f * 0.1 + 2), -0.02]);
  }

  get('PRP_can_lid').visible = get('PRP_can').visible;
}

/* ------------------------------------------------------------------ shots -- */
const hold = (position, target) => moves.truck({ from: position, to: position, target });

export default defineScene({
  id: 'canspot',
  fps: 30,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 0.15,
  background: '#2e3742',
  identity,
  ignore,
  build,
  animate,
  shots: [
    // 1 — the hook, in two entries of one camera move: the impact itself is
    // transitional (the ball enters from above, the can erupts from below —
    // both cross the frame edge by design), then from the freeze on, the can
    // must hold frame. Hero includes the slices: during the split the whole
    // can is hidden and the three bands ARE the can.
    { name: 'SC01a_impact', from: 0, to: 60, focalLength: 32, easing: 'linear',
      hero: [],
      move: slice(moves.pushIn({ from: 0.5, to: 0.42, height: 0.2, target: [0, 0.18, 0] }), 0, 0.4) },
    { name: 'SC01b_freeze', from: 60, to: 150, focalLength: 32, easing: 'linear',
      hero: ['PRP_can', 'PRP_canS_*'],
      move: slice(moves.pushIn({ from: 0.5, to: 0.42, height: 0.2, target: [0, 0.18, 0] }), 0.4, 1) },

    // 2 — spiral up around the can from the water (turntable = orbit + rise).
    // phiLow was -2°, which put the camera 7 mm UNDER the water plane at the
    // start — the occlusion audit reported the water blocking 100% of the
    // hero, which is what an underwater camera looking up at a disc sees.
    { name: 'SC02_spiral', from: 150, to: 225, focalLength: 40, easing: 'linear',
      hero: 'PRP_can',
      move: moves.turntable({ radius: 0.46, pushIn: 0.95, arc: rad(300),
                              phiLow: rad(2), phiHigh: rad(22), target: [0, 0.19, 0] }) },

    // 3 — hold at the lid, then travel down along the can. The lid is the
    // hold's hero; the travel is transitional — a close travel along a
    // product keeps nothing whole in frame, by design.
    { name: 'SC03a_lid', from: 225, to: 250, focalLength: 60, easing: 'linear',
      hero: 'PRP_can_lid',
      move: hold([0.26, 0.3, 0.15], [0, 0.25, 0]) },
    { name: 'SC03b_down', from: 250, to: 300, focalLength: 60, easing: 'easeInOutSine',
      hero: [],
      move: retarget(
        moves.truck({ from: [0.26, 0.3, 0.15], to: [0.26, 0.11, 0.15] }),
        { targets: [[0, 0.25, 0], [0, 0.14, 0]] }) },

    // 4 — wide arc; the five clones fan out from behind, one by one, and are
    // sucked back in. Clones wrapping/crossing the mother can is the shot:
    // declared for occlusion just like it is for collisions.
    { name: 'SC04_fan', from: 300, to: 420, focalLength: 35, easing: 'linear',
      hero: 'PRP_can', occlusion: { ignore: ['PRP_clone_*'] },
      move: moves.orbit360({ radius: 0.7, height: 0.3, startAngle: rad(-60),
                             arc: rad(120), target: [0, 0.14, 0] }) },

    // 5 — the can spins slowly in the right half of frame, ice floating up in
    // front of and behind it.
    { name: 'SC05_close', from: 420, to: 495, focalLength: 50, easing: 'linear',
      hero: 'PRP_can',
      move: moves.pushIn({ from: 0.52, to: 0.46, height: 0.2, target: [-0.083, 0.209, 0] }) },

    // 6 — from inside the translucent glass, looking up; the can hangs almost
    // horizontal, like it's pouring.
    { name: 'SC06_glass', from: 495, to: 555, focalLength: 24, easing: 'linear',
      hero: 'PRP_can',
      move: hold([0, 0.03, 0.01], [0.06, 0.5, 0.02]) },

    // 7 — GAP: an editorial placeholder, empty water. Nothing to frame.
    { name: 'SC07_gap', from: 555, to: 585, focalLength: 35, easing: 'linear',
      hero: [],
      move: hold([0, 0.25, 0.6], [0, 0.1, 1.4]) },

    // 8 — circling the can and the glass from above, grid on the floor.
    { name: 'SC08_overhead', from: 585, to: 645, focalLength: 32, easing: 'linear',
      hero: ['PRP_can', 'PRP_glass'],
      // phi tuned against the audit: at 55° the can's top left the frame
      // mid-arc while the glass grazed the bottom — a steeper look-down
      // compresses the vertical span of a tall-plus-low pair.
      move: moves.orbit360({ radius: 0.72, height: 0, phi: rad(66),
                             startAngle: rad(-20), arc: rad(120), target: [0.05, 0.15, 0] }) },

    // 9 — balls fall from below upward and freeze like they've hit water.
    { name: 'SC09_balls', from: 645, to: 705, focalLength: 40, easing: 'linear',
      hero: 'PRP_can',
      move: moves.truck({ from: [0.42, 0.2, 0.28], to: [0.38, 0.2, 0.32],
                          target: [0, 0.16, 0] }) },

    // 10 — clones hang in a ring; the camera flies low between the cans.
    // The ring leaves its gap at 135°, which is exactly the camera's chord —
    // clearances are checked numerically, not assumed. No framing hero: at
    // the closest pass nothing whole can stay in frame, and that is the shot.
    { name: 'SC10_ring', from: 705, to: 765, focalLength: 28, easing: 'easeInOutSine',
      hero: [],
      move: moves.truck({ from: [0.382, 0.05, 0.255], to: [-0.255, 0.05, -0.382],
                          target: [0, 0.12, 0] }) },

    // 11 — macro: an endless stream of lemons, limes and ice at different
    // depths. Explicitly no hero — nothing has to stay in frame.
    { name: 'SC11_macro', from: 765, to: 810, focalLength: 50, easing: 'linear',
      hero: [],
      move: moves.truck({ from: [1.5, 0.15, 0.35], to: [1.5, 0.15, 0.33],
                          target: [1.5, 0.15, 0] }) },

    // 12 — the reveal: the can lifts and spins, clones bloom one by one, the
    // camera slowly circles.
    { name: 'SC12_reveal', from: 810, to: 860, focalLength: 40, easing: 'linear',
      hero: 'PRP_can', occlusion: { ignore: ['PRP_clone_*'] },
      move: moves.orbit360({ radius: 0.55, height: 0.22, startAngle: rad(20),
                             arc: rad(70), target: [0, 0.185, 0] }) },

    // 13 — packshot: can levitating on the left, berries beside it, the right
    // third empty for the wordmark in post. No text built.
    { name: 'SC13_pack', from: 860, to: 900, focalLength: 45, easing: 'linear',
      hero: 'PRP_can',
      move: hold([0.02, 0.21, 0.55], [0.1, 0.21, 0]) },
  ],
});
