/**
 * floors.js — three takes back to back with a floors effect. 24 fps, 21:9,
 * 720 frames, one scene, hard cuts between takes.
 *
 * THE MOVE is pure vertical translation: the camera rises straight up and
 * NEVER turns — target = position + (0,0,-1)*D, so the view direction is a
 * constant and the floors enter at the top of frame and leave at the bottom.
 * The speed profile is the point: full speed at 15% and 85% of the pass and
 * 15% of that at the midpoint. Position is the INTEGRAL of that profile,
 * computed numerically here, which is also how the hero's height is derived
 * — MID_Y is where the camera actually lands at t=0.5, not a guess.
 *
 * THE FLOORS are six opaque slabs every 4 units. The dark flash at each
 * crossing is geometry, not a post trick: the slab material is DoubleSide,
 * so while the camera is inside a slab its interior fills the frame.
 *
 * THE WORLDS — office, apartment, warehouse — share the floors, the hero and
 * the move; only the props change, toggled per take by `animate`.
 */
import { DoubleSide } from 'three';
import { defineScene } from '../../lib/scene.js';

const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

/* ------------------------------------------------------------- the move --
 * Everything here is derived from the parameters, not written down twice.
 * That matters more in this scene than in any other: the hero's height is the
 * INTEGRAL of the speed profile at its midpoint, so a knob that reshapes the
 * profile moves the hero. Leaving MID_Y as a constant would have let the two
 * drift apart the first time anyone touched a slider — the hero would sit at
 * the height the OLD profile reached, and the one shot with an enforced hero
 * would fail for a reason that looks like nothing to do with the knob.
 */

/**
 * The whole geometry of one pass, for one set of parameters.
 *
 * The pass STARTS AND ENDS INSIDE A SLAB (both are slab centres), so each take
 * opens and closes on darkness and the hard cut lands inside that flash — the
 * world changes while the frame is black. That invariant is why `slabGap` is
 * the knob and the travel is derived from it, rather than the other way round:
 * a travel you could set independently is a travel you could set to a value
 * that ends the pass in mid-air.
 */
function profile(p) {
  const SLABS = [1, 2, 3, 4, 5, 6].map((i) => i * p.slabGap);
  const Y0 = SLABS[0], TRAVEL = SLABS[5] - SLABS[0];
  // The two slabs the pass begins and ends inside are THICKER than the four it
  // crosses on the way. Making the cut's flash the same length as every other
  // floor pass hid it too well: the world simply swapped with no punctuation,
  // which reads as a glitch rather than a transition. A deliberate beat of
  // darkness at the boundary — twice any normal crossing — is what makes the
  // change land.
  const SLAB_T = [p.boundarySlab, p.crossSlab, p.crossSlab,
                  p.crossSlab, p.crossSlab, p.boundarySlab];

  /**
   * Speed as a fraction of full speed, symmetric about the midpoint.
   *
   * It holds FULL speed at both ends rather than ramping from and to zero.
   * Ramping to zero made the camera stop dead before every cut and crawl back
   * up afterwards (measured: 0.0010 per frame at the last frame of a take,
   * 0.5% of full speed) — the takes read as coarse and slow to change. The
   * acceleration the move needs is the one OUT of the mid-pass slowdown; the
   * ends carry momentum straight through the cut.
   */
  const hold = p.holdSpeed, mid = p.midSpeed, ramp = 0.5 - hold;
  const SPEED = (t) => {
    if (t <= hold) return 1;                                 // enter at speed
    if (t < 0.5) return lerp(1, mid, smooth((t - hold) / ramp));
    if (t < 1 - hold) return lerp(mid, 1, smooth((t - 0.5) / ramp));
    return 1;                                                // leave at speed
  };

  // Position is the normalised integral of SPEED — trapezoid, 4000 steps.
  const N = 4000;
  const TABLE = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    TABLE[i] = TABLE[i - 1] + ((SPEED((i - 1) / N) + SPEED(i / N)) / 2) / N;
  }
  const TOTAL = TABLE[N];
  const travelled = (t) => {
    const x = clamp01(t) * N, i = Math.floor(x);
    return lerp(TABLE[i], TABLE[Math.min(N, i + 1)], x - i) / TOTAL;
  };

  // Where the camera lands at the midpoint of the speed profile. Derived.
  const midY = Y0 + TRAVEL * travelled(0.5);

  // The one move, shared verbatim by all three takes.
  const pass = (t) => {
    const y = Y0 + TRAVEL * travelled(t);
    return { position: [0, y, 0], target: [0, y, -p.look], fov: 45, roll: 0 };
  };

  // A storey sits ON the top face of the slab it dresses, so it follows the
  // slabs rather than repeating their arithmetic. Deriving it also settled a
  // 5 cm float the hand-written list had on the ground storey alone — the
  // four above it were already exactly on their slab.
  const STOREYS = SLABS.slice(0, 5).map((y, i) => y + SLAB_T[i] / 2);

  return { SLABS, SLAB_T, STOREYS, Y0, TRAVEL, midY, pass };
}

/** The default pass, for anything outside the scene that wants the numbers. */
export const MID_Y = profile({ slabGap: 4, boundarySlab: 1.4, crossSlab: 0.6,
                               holdSpeed: 0.15, midSpeed: 0.15, look: 10 }).midY;
// Six dressing spots per storey, spread across the frame and in depth so a
// world reads at any height — including the hero's storey, where they flank
// the block without crossing it (the occlusion audit checks that).
const SPOTS = [[-5.2, -6.2], [-2.9, -11.0], [3.0, -6.6],
               [5.4, -10.2], [-4.6, -12.8], [4.4, -13.0]];

const identity = {
  slab: '#3c3c3f', wall: '#8e8e8e', ground: '#9a9a9a',
  hero: '#c0392b',
  desk: '#7d6a52', screen: '#2b3a45', chair: '#4c5a63',
  sofa: '#6d7f93', table: '#8a6136', lamp: '#e8dfb8', plant: '#3f8a4b',
  crate: '#b08447', rack: '#5a6570',
};

const PROPS = { office: [], apt: [], wh: [] };

const ignore = [
  ['PRP_hero', 'ENV_*'],
  ['PRP_of_*', 'PRP_of_*'], ['PRP_ap_*', 'PRP_ap_*'], ['PRP_wh_*', 'PRP_wh_*'],
];

function build({ ctx, geo, p }) {
  const { SLABS, SLAB_T, STOREYS, midY } = profile(p);
  for (const k of Object.keys(PROPS)) PROPS[k].length = 0;

  ctx.part('ENV_ground', geo.box({ x: 40, y: 0.2, z: 40 }), 'ground', ctx.groups.ENV)
    .position.y = -0.1;
  // The wall sits BEYOND the slabs' own footprint (they span z -20..20).
  // At -14 it was inside them, so a camera in a slab saw the wall through a
  // slit at eye level and the "opaque" flash was a letterbox band. Behind
  // -20 the horizontal ray hits the slab's own far face first: the frame
  // goes properly dark.
  ctx.part('ENV_wall', geo.box({ x: 44, y: 34, z: 0.3 }), 'wall', ctx.groups.ENV)
    .position.set(0, 15, -22);

  // Six opaque slabs. DoubleSide is what makes the crossing a dark flash:
  // inside the slab, its interior renders and fills the frame.
  ctx.material('slab').side = DoubleSide;
  SLABS.forEach((y, i) => {
    ctx.part(`ENV_slab_${i}`, geo.box({ x: 40, y: SLAB_T[i], z: 40 }), 'slab', ctx.groups.ENV)
      .position.y = y;
  });

  // The hero: centred on the height the speed profile actually reaches at
  // t=0.5, dead on the camera's fixed view axis. Both come from `profile(p)`,
  // so reshaping the speed curve carries the hero with it.
  ctx.part('PRP_hero', geo.box({ x: 1.6, y: p.heroHeight, z: 1.6 }), 'hero')
    .position.set(0, midY, -p.look);

  const put = (take, name, g, id, [x, y, z], ry = 0) => {
    const m = ctx.part(`PRP_${take}_${name}`, g, id);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    PROPS[{ of: 'office', ap: 'apt', wh: 'wh' }[take]].push(m.name);
    return m;
  };

  STOREYS.forEach((y, s) => {
    const P = SPOTS;
    // 1 — office: desks, monitors, chairs
    [0, 2, 4].forEach((i, n) => {
      const [x, z] = P[i];
      put('of', `desk${s}${n}`, geo.box({ x: 2.4, y: 0.12, z: 1.1 }), 'desk', [x, y + 0.75, z]);
      put('of', `dleg${s}${n}`, geo.box({ x: 2.2, y: 0.72, z: 0.08 }), 'desk', [x, y + 0.36, z - 0.42]);
      put('of', `scr${s}${n}`, geo.box({ x: 1.0, y: 0.6, z: 0.06 }), 'screen', [x, y + 1.15, z - 0.35]);
    });
    [1, 3, 5].forEach((i, n) => {
      const [x, z] = P[i];
      put('of', `chs${s}${n}`, geo.box({ x: 0.62, y: 0.1, z: 0.62 }), 'chair', [x, y + 0.45, z]);
      put('of', `chb${s}${n}`, geo.box({ x: 0.62, y: 0.75, z: 0.08 }), 'chair', [x, y + 0.82, z - 0.3]);
      put('of', `chl${s}${n}`, geo.box({ x: 0.1, y: 0.45, z: 0.1 }), 'chair', [x, y + 0.225, z]);
    });

    // 2 — apartment: sofa, low table, lamp, a plant, a screen, a shelf
    put('ap', `sofa${s}`, geo.roundedBox({ x: 2.6, y: 0.7, z: 1.0, r: 0.12 }), 'sofa', [P[0][0], y + 0.35, P[0][1]]);
    put('ap', `sofb${s}`, geo.roundedBox({ x: 2.6, y: 0.7, z: 0.3, r: 0.1 }), 'sofa', [P[0][0], y + 0.7, P[0][1] - 0.45]);
    put('ap', `tab${s}`, geo.box({ x: 1.4, y: 0.1, z: 0.8 }), 'table', [P[1][0], y + 0.45, P[1][1]]);
    put('ap', `tabl${s}`, geo.box({ x: 1.2, y: 0.4, z: 0.08 }), 'table', [P[1][0], y + 0.2, P[1][1]]);
    put('ap', `lampp${s}`, geo.cone({ rBottom: 0.05, rTop: 0.05, h: 1.5 }), 'rack', [P[2][0], y + 0.75, P[2][1]]);
    put('ap', `lamps${s}`, geo.cone({ rBottom: 0.42, rTop: 0.22, h: 0.4 }), 'lamp', [P[2][0], y + 1.7, P[2][1]]);
    put('ap', `pot${s}`, geo.cone({ rBottom: 0.26, rTop: 0.32, h: 0.45 }), 'table', [P[3][0], y + 0.225, P[3][1]]);
    put('ap', `leaf${s}`, geo.ellipsoid({ rx: 0.6, ry: 0.75, rz: 0.6 }), 'plant', [P[3][0], y + 1.15, P[3][1]]);
    put('ap', `tv${s}`, geo.box({ x: 1.7, y: 0.95, z: 0.08 }), 'screen', [P[4][0], y + 1.25, P[4][1]]);
    put('ap', `tvs${s}`, geo.box({ x: 1.5, y: 0.5, z: 0.4 }), 'table', [P[4][0], y + 0.25, P[4][1]]);
    put('ap', `shelf${s}`, geo.box({ x: 1.6, y: 1.7, z: 0.4 }), 'table', [P[5][0], y + 0.85, P[5][1]]);

    // 3 — warehouse: crates of different heights, a shelving rack
    [[0, 1.3], [1, 0.8], [3, 1.7], [4, 1.0]].forEach(([i, h], n) => {
      const [x, z] = P[i];
      put('wh', `crate${s}${n}`, geo.box({ x: 1.2, y: h, z: 1.2 }), 'crate', [x, y + h / 2, z]);
      if (n % 2 === 0) {
        put('wh', `crat2${s}${n}`, geo.box({ x: 0.9, y: 0.7, z: 0.9 }), 'crate', [x + 0.2, y + h + 0.35, z + 0.1]);
      }
    });
    [2, 5].forEach((i, n) => {
      const [x, z] = P[i];
      put('wh', `rkp${s}${n}a`, geo.box({ x: 0.14, y: 2.6, z: 0.14 }), 'rack', [x - 1.5, y + 1.3, z]);
      put('wh', `rkp${s}${n}b`, geo.box({ x: 0.14, y: 2.6, z: 0.14 }), 'rack', [x + 1.5, y + 1.3, z]);
      put('wh', `rks${s}${n}a`, geo.box({ x: 3.2, y: 0.1, z: 1.0 }), 'rack', [x, y + 1.0, z]);
      put('wh', `rks${s}${n}b`, geo.box({ x: 3.2, y: 0.1, z: 1.0 }), 'rack', [x, y + 1.9, z]);
      put('wh', `rkc${s}${n}`, geo.box({ x: 0.9, y: 0.7, z: 0.8 }), 'crate', [x - 0.6, y + 1.4, z]);
    });
  });
}

/** Only the active take's props are visible. Takes are separate shots, so a
 *  swap at a take boundary is a hard cut, not a pop. */
const TAKE_KEY = ['office', 'apt', 'wh'];
function animate({ ctx, frame }) {
  const k = Math.min(2, Math.floor(frame / 240));
  TAKE_KEY.forEach((key, i) => {
    for (const name of PROPS[key]) ctx.get(name).visible = i === k;
  });
}

/* ------------------------------------------------------------- the shots -- */
// the midpoint window: 12 frames centred on the pass's t = 0.5
const M0 = 114 / 240, M1 = 126 / 240;

const take = (p, pass, i, label) => {
  const b = i * 240;
  const win = (a, c) => (u) => pass(a + (c - a) * u);
  return [
    { name: `T${i + 1}_${label}_up`, from: b, to: b + 114, focalLength: p.focal,
      easing: 'linear', hero: [], clearance: 0, move: win(0, M0) },
    // the only shot with an enforced hero: at the midpoint it must be in frame
    { name: `T${i + 1}_${label}_mid`, from: b + 114, to: b + 126, focalLength: p.focal,
      easing: 'linear', hero: 'PRP_hero', joins: true, move: win(M0, M1) },
    { name: `T${i + 1}_${label}_out`, from: b + 126, to: b + 240, focalLength: p.focal,
      easing: 'linear', hero: [], clearance: 0, joins: true, move: win(M1, 1) },
  ];
};

export default defineScene({
  id: 'floors',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  params: {
    midSpeed: { value: 0.15, min: 0.02, max: 1, step: 0.01, unit: '×',
      note: 'speed at the midpoint as a fraction of full — this is the floors effect; at 1 the pass is a constant rise' },
    holdSpeed: { value: 0.15, min: 0.02, max: 0.4, step: 0.01,
      note: 'how much of each end holds full speed. Do not take it to zero: ramping from a standstill is what made the cuts read as coarse' },
    slabGap: { value: 4, min: 2.5, max: 6, step: 0.1, unit: 'm',
      note: 'spacing of the floors; the travel is six of these, so the pass always starts and ends inside a slab' },
    boundarySlab: { value: 1.4, min: 0.6, max: 3, step: 0.1, unit: 'm',
      note: 'thickness of the two slabs the takes begin and end inside — this is the length of the dark beat at the cut' },
    crossSlab: { value: 0.6, min: 0.2, max: 1.6, step: 0.05, unit: 'm',
      note: 'thickness of the four the pass crosses on the way; keep it under the boundary or the cut stops reading as punctuation' },
    look: { value: 10, min: 5, max: 18, step: 0.5, unit: 'm',
      note: 'how far ahead the fixed gaze sits — the hero sits on that axis, so this moves it too' },
    heroHeight: { value: 3.2, min: 1.5, max: 5, step: 0.1, unit: 'm' },
    focal: { value: 35, min: 18, max: 60, step: 1, unit: 'mm' },
  },
  build,
  animate,
  shots: (p) => {
    const { pass } = profile(p);
    return [...take(p, pass, 0, 'office'), ...take(p, pass, 1, 'apt'),
            ...take(p, pass, 2, 'warehouse')];
  },
});
