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

/* ------------------------------------------------------------- the move -- */
const Y0 = 1, TRAVEL = 26;              // 1 -> 27, through six slabs
const LOOK = 10;                        // how far ahead the fixed gaze sits

/** Speed as a fraction of full speed. Symmetric about the midpoint. */
const SPEED = (t) => {
  if (t < 0.15) return smooth(t / 0.15);                       // accelerate in
  if (t < 0.5) return lerp(1, 0.15, smooth((t - 0.15) / 0.35)); // slow to 15%
  if (t < 0.85) return lerp(0.15, 1, smooth((t - 0.5) / 0.35)); // back to full
  return lerp(1, 0, smooth((t - 0.85) / 0.15));                 // decelerate out
};

/** Position is the normalised integral of SPEED — trapezoid, 4000 steps. */
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

/** Where the camera lands at the midpoint of the speed profile. Derived. */
export const MID_Y = Y0 + TRAVEL * travelled(0.5);

/** The one move, shared verbatim by all three takes. */
const pass = (t) => {
  const y = Y0 + TRAVEL * travelled(t);
  return { position: [0, y, 0], target: [0, y, -LOOK], fov: 45, roll: 0 };
};

/* ------------------------------------------------------------- the world -- */
const SLABS = [4, 8, 12, 16, 20, 24];   // six, every 4 units
const SLAB_T = 0.4;
const HERO_H = 3.4;                     // fits the 12..16 storey with air
const STOREYS = [0, 4.2, 8.2, 12.2, 16.2, 20.2, 24.2];
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

function build({ ctx, geo }) {
  for (const k of Object.keys(PROPS)) PROPS[k].length = 0;

  ctx.part('ENV_ground', geo.box({ x: 40, y: 0.2, z: 40 }), 'ground', ctx.groups.ENV)
    .position.y = -0.1;
  ctx.part('ENV_wall', geo.box({ x: 30, y: 34, z: 0.3 }), 'wall', ctx.groups.ENV)
    .position.set(0, 15, -14);

  // Six opaque slabs. DoubleSide is what makes the crossing a dark flash:
  // inside the slab, its interior renders and fills the frame.
  ctx.material('slab').side = DoubleSide;
  SLABS.forEach((y, i) => {
    ctx.part(`ENV_slab_${i}`, geo.box({ x: 40, y: SLAB_T, z: 40 }), 'slab', ctx.groups.ENV)
      .position.y = y;
  });

  // The hero: centred on the height the speed profile actually reaches at
  // t=0.5, dead on the camera's fixed view axis.
  ctx.part('PRP_hero', geo.box({ x: 1.6, y: HERO_H, z: 1.6 }), 'hero')
    .position.set(0, MID_Y, -LOOK);

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
      put('wh', `rkp${s}${n}a`, geo.box({ x: 0.14, y: 3.2, z: 0.14 }), 'rack', [x - 1.5, y + 1.6, z]);
      put('wh', `rkp${s}${n}b`, geo.box({ x: 0.14, y: 3.2, z: 0.14 }), 'rack', [x + 1.5, y + 1.6, z]);
      put('wh', `rks${s}${n}a`, geo.box({ x: 3.2, y: 0.1, z: 1.0 }), 'rack', [x, y + 1.0, z]);
      put('wh', `rks${s}${n}b`, geo.box({ x: 3.2, y: 0.1, z: 1.0 }), 'rack', [x, y + 2.2, z]);
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
const win = (a, b) => (u) => pass(a + (b - a) * u);
const FOCAL = 35;
// the midpoint window: 12 frames centred on the pass's t = 0.5
const M0 = 114 / 240, M1 = 126 / 240;

const take = (i, label) => {
  const b = i * 240;
  return [
    { name: `T${i + 1}_${label}_up`, from: b, to: b + 114, focalLength: FOCAL,
      easing: 'linear', hero: [], clearance: 0, move: win(0, M0) },
    // the only shot with an enforced hero: at the midpoint it must be in frame
    { name: `T${i + 1}_${label}_mid`, from: b + 114, to: b + 126, focalLength: FOCAL,
      easing: 'linear', hero: 'PRP_hero', joins: true, move: win(M0, M1) },
    { name: `T${i + 1}_${label}_out`, from: b + 126, to: b + 240, focalLength: FOCAL,
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
  build,
  animate,
  shots: [...take(0, 'office'), ...take(1, 'apt'), ...take(2, 'warehouse')],
});
