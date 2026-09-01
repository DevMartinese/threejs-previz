/**
 * orbital.js — three worlds, ONE scene, one camera that never stops orbiting.
 * 24 fps, 21:9, 720 frames.
 *
 * THE MOVE, three times: a dome orbit — in at ground level (~5 degrees), up
 * one side, over the top (~78), down the other side back to ground level —
 * and then, still turning, the camera DIPS THROUGH THE FLOOR. Under the
 * floor the frame is opaque, the world is swapped, and the camera rises back
 * out of the ground into the next dome. It never leaves ground level except
 * to go over the top or under the floor.
 *
 * The worlds are CO-LOCATED, not stacked: each orbit happens at ground level
 * in its own place, and the floor is the reset. Only one world is visible at
 * a time, so they never meet.
 *
 *   1  a car with people sitting in it and standing around it
 *   2  a basketball court mid-game, ball above the rim
 *   3  night: a car drifting around a still artist, headlight cones on
 *
 * Continuity is by construction: dome and dip are one pure journey(u), and
 * the dip's endpoints ARE the adjacent domes' endpoints, evaluated from the
 * same formulas.
 */
import { defineScene } from '../../lib/scene.js';

const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

/* ---------------------------------------------------------------- worlds --
 * All three sit on the same ground. The court needs a far wider dome and a
 * far wider lens: its world is 28 m long where the others are compact.
 */
const WORLDS = [
  { key: 'car', r0: 11.6, r1: 10.3, focal: 28, cx: 0, cz: 0, ty: 1.1 },
  { key: 'court', r0: 22, r1: 18, focal: 20, cx: -5.5, cz: 0, ty: 1.5 },
  { key: 'drift', r0: 8.5, r1: 6.0, focal: 32, cx: 0.6, cz: 0.4, ty: 1.0 },
];

const identity = {
  grey: '#9a9a9a', greyDeep: '#7a7a7a', line: '#cfcac0', night: '#23262b',
  crimson: '#8e2f35', steel: '#5a6570', dark: '#2e2e30',
  red: '#c0392b', cyan: '#1abcb4', yellow: '#f1c40f',
  green: '#27ae60', violet: '#8e44ad',
  board: '#dcd8cf', hoop: '#d98c46', ball: '#c9601e', pole: '#4a4a4e',
  beam: '#e8dfb8', artist: '#f5efe0',
  nightcar: '#6e2429', nightsteel: '#3d454d',
};

const CAST1 = ['red', 'cyan', 'yellow', 'green', 'violet'];
const PLAYERS = ['red1', 'red2', 'red3', 'cyan1', 'cyan2'];

const ignore = [
  ['PRP_car_*', 'PRP_car_*'], ['PRP_car_*', 'CHR_*'],
  ['PRP_dcar_*', 'PRP_dcar_*'], ['PRP_beam_*', 'PRP_dcar_*'],
  ['PRP_beam_*', 'PRP_beam_*'], ['PRP_beam_*', 'CHR_*'],
  ['PRP_hoop_*', 'PRP_hoop_*'],
  ...CAST1.map((c) => [`CHR_${c}_torso`, `CHR_${c}_*`]),
  ...PLAYERS.map((c) => [`CHR_${c}_torso`, `CHR_${c}_*`]),
  ['CHR_artist_torso', 'CHR_artist_*'],
];

/* ------------------------------------------------------------------ build -- */
const WORLD_PARTS = { car: [], court: [], drift: [] };
const ARTIST = [0.6, 0, 0.4];
const DRIFT_R = 3.4;
const DCAR = ['PRP_dcar_body', 'PRP_dcar_cabin', 'PRP_dcar_wheel_fl',
  'PRP_dcar_wheel_fr', 'PRP_dcar_wheel_rl', 'PRP_dcar_wheel_rr',
  'PRP_beam_l', 'PRP_beam_r'];

function build({ ctx, geo }) {
  for (const k of Object.keys(WORLD_PARTS)) WORLD_PARTS[k].length = 0;
  const own = (world, m) => { WORLD_PARTS[world].push(m.name); return m; };

  const person = (world, name, colour, [x, y, z], ry, seated, height = 1.72) => {
    const rig = ctx.pivot(`CHR_${name}_rig`, [x, y, z], ctx.groups.CHR);
    rig.rotation.y = rad(ry);
    const f = geo.figure({ height, seated, armsForward: true });
    for (const p of ['torso', 'head', 'arms', 'legs'])
      own(world, ctx.part(`CHR_${name}_${p}`, f[p], colour, rig));
  };
  const car = (world, prefix, bodyId, cabinId) => {
    own(world, ctx.part(`${prefix}_body`,
      geo.roundedBox({ x: 4.4, y: 0.8, z: 1.9, r: 0.16 }).translate(0, 0.85, 0), bodyId));
    own(world, ctx.part(`${prefix}_cabin`,
      geo.roundedBox({ x: 2.2, y: 0.4, z: 1.62, r: 0.14 }).translate(-0.35, 1.42, 0), cabinId));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      own(world, ctx.part(`${prefix}_wheel_${sx > 0 ? 'f' : 'r'}${sz > 0 ? 'l' : 'r'}`,
        geo.cone({ rBottom: 0.36, rTop: 0.36, h: 0.26, segments: 18 })
          .rotateX(Math.PI / 2).translate(1.42 * sx, 0.36, 0.95 * sz), dark(bodyId)));
    }
  };
  const dark = () => 'dark';

  // Each world brings its OWN floor — opaque, 0.2 thick, so the dip under it
  // is genuinely dark from below — and they are toggled together with the
  // props, which is how three co-located worlds never meet.
  const floor = (world, id) => own(world,
    ctx.part(`ENV_floor_${world}`, geo.box({ x: 90, y: 0.2, z: 90 }), id, ctx.groups.ENV))
    .position.y = -0.1;

  // ---- world 1: the car and its people
  floor('car', 'grey');
  car('car', 'PRP_car', 'crimson', 'steel');
  person('car', 'red', 'red', [1.45, 0.74, 0.45], 25, true);
  person('car', 'cyan', 'cyan', [-0.35, 0.78, 0.38], 90, true);
  person('car', 'yellow', 'yellow', [-0.75, 0.78, -0.38], 90, true);
  person('car', 'green', 'green', [-3.3, 0, 1.5], 130, true);
  person('car', 'violet', 'violet', [2.2, 0, -2.1], -30, false);

  // ---- world 2: the court, 28 m long, mid-game
  floor('court', 'grey');
  own('court', ctx.part('ENV_court', geo.box({ x: 28, y: 0.02, z: 15 }), 'greyDeep', ctx.groups.ENV))
    .position.y = 0.01;
  const mid = own('court', ctx.part('ENV_mid', geo.rim({ radius: 1.8, thickness: 0.035 }),
    'line', ctx.groups.ENV));
  mid.rotation.x = Math.PI / 2; mid.position.y = 0.025;
  own('court', ctx.part('PRP_hoop_pole', geo.box({ x: 0.16, y: 3.6, z: 0.16 })
    .translate(-12.6, 1.8, 0), 'pole'));
  own('court', ctx.part('PRP_hoop_board', geo.box({ x: 0.08, y: 1.05, z: 1.8 })
    .translate(-12.35, 3.35, 0), 'board'));
  own('court', ctx.part('PRP_hoop_ring', geo.rim({ radius: 0.24, thickness: 0.02 })
    .rotateX(Math.PI / 2).translate(-12.05, 3.05, 0), 'hoop'));
  person('court', 'red1', 'red', [-10.8, 0.55, 0.3], 95, false, 1.85);
  person('court', 'red2', 'red', [-4.5, 0, 2.2], 70, false, 1.85);
  person('court', 'red3', 'red', [0.5, 0, -2.4], 50, false, 1.85);
  person('court', 'cyan1', 'cyan', [-11.3, 0, -0.5], -100, false, 1.85);
  person('court', 'cyan2', 'cyan', [1.2, 0, 2.4], -60, false, 1.85);
  own('court', ctx.part('PRP_ball', geo.ellipsoid({ rx: 0.12, ry: 0.12, rz: 0.12 })
    .translate(-11.6, 3.2, 0.12), 'ball'));

  // ---- world 3: night, the drift
  floor('drift', 'night');
  person('drift', 'artist', 'artist', ARTIST, 0, false, 1.78);
  car('drift', 'PRP_dcar', 'nightcar', 'nightsteel');
  const beamMat = ctx.material('beam');
  beamMat.transparent = true;
  beamMat.opacity = 0.3;
  for (const [name, sz] of [['PRP_beam_l', 0.58], ['PRP_beam_r', -0.58]]) {
    own('drift', ctx.part(name, geo.cone({ rBottom: 0.07, rTop: 0.55, h: 3.6, segments: 16 })
      .rotateZ(-Math.PI / 2).translate(4.0, 0.72, sz), 'beam'));
  }
}

/* ---------------------------------------------------------------- journey --
 * Per cycle: DOME (180 degrees of azimuth, 5 -> 78 -> 5 elevation, radius
 * closing in as it rises) then DIP (the azimuth keeps turning while the
 * camera sinks through the floor and rises back out). The world is swapped
 * at the bottom of the dip, under an opaque floor.
 */
const CYCLES = 3;
const DOME_AZ = 180, DIP_AZ = 45;
const DOME_FRAC = 0.875;                 // 210 of each 240-frame cycle
const DIP_DEPTH = -3.6;
const START_AZ = -30;
const cycleAz = DOME_AZ + DIP_AZ;

const domePose = (k, s) => {
  const { r0, r1, cx, cz, ty } = WORLDS[k];
  const az = rad(START_AZ + k * cycleAz + DOME_AZ * s);
  const phi = rad(5 + 73 * Math.sin(Math.PI * s));
  const r = lerp(r0, r1, smooth(s));
  return {
    position: [cx + Math.sin(az) * Math.cos(phi) * r, Math.sin(phi) * r,
               cz + Math.cos(az) * Math.cos(phi) * r],
    target: [cx, ty, cz],
  };
};

const journey = (u) => {
  const k = Math.min(CYCLES - 1, Math.floor(u * CYCLES));
  const t = u * CYCLES - k;
  if (t < DOME_FRAC) {
    const { position, target } = domePose(k, t / DOME_FRAC);
    return { position, target, fov: 45, roll: 0 };
  }
  // THE DIP: out of this dome's exact end, under the floor, and back out into
  // the next dome's exact start. The last cycle has no next world, so it
  // sinks and stays — the piece ends under the ground it came from.
  const d = (t - DOME_FRAC) / (1 - DOME_FRAC);
  const E = domePose(k, 1);
  const next = (k + 1) % CYCLES;
  const S = k < CYCLES - 1 ? domePose(next, 0) : null;
  const az = rad(START_AZ + k * cycleAz + DOME_AZ + DIP_AZ * d);
  const w = WORLDS[k], wn = WORLDS[next];
  const cx = S ? lerp(w.cx, wn.cx, smooth(d)) : w.cx;
  const cz = S ? lerp(w.cz, wn.cz, smooth(d)) : w.cz;
  const rE = Math.hypot(E.position[0] - w.cx, E.position[2] - w.cz);
  const rS = S ? Math.hypot(S.position[0] - wn.cx, S.position[2] - wn.cz) : rE;
  const r = lerp(rE, rS, smooth(d));
  // height: down through the floor and back up — or, on the last cycle, down
  // and gone. A sine arc keeps the two ends at the domes' own ground height.
  const yE = E.position[1], yS = S ? S.position[1] : DIP_DEPTH;
  const y = S
    ? lerp(yE, yS, smooth(d)) + DIP_DEPTH * Math.sin(Math.PI * d) * 1.6
    : lerp(yE, DIP_DEPTH * 1.6, smooth(d));
  const target = S
    ? [lerp(w.cx, wn.cx, smooth(d)), lerp(w.ty, wn.ty, smooth(d)), lerp(w.cz, wn.cz, smooth(d))]
    : [w.cx, w.ty, w.cz];
  return {
    position: [cx + Math.sin(az) * r, y, cz + Math.cos(az) * r],
    target, fov: 45, roll: 0,
  };
};

const win = (a, b) => (u) => journey(a + (b - a) * u);
const F = (fr) => Math.round(720 * fr);
const C = 1 / CYCLES, DF = DOME_FRAC / CYCLES;

/* ---------------------------------------------------------------- animate --
 * One world at a time. The swap happens inside a shot, at the bottom of the
 * dip where the floor fills the frame — so the continuity audit sees it, and
 * the occlusion rule (a change hidden behind geometry is legitimate) is what
 * makes it pass.
 */
const KEYS = ['car', 'court', 'drift'];
function animate({ ctx, frame }) {
  const u = frame / 720;
  const k = Math.min(CYCLES - 1, Math.floor(u * CYCLES));
  const t = u * CYCLES - k;
  // the next world takes over halfway through the dip, under the floor
  const active = t < DOME_FRAC + (1 - DOME_FRAC) * 0.5 ? k : Math.min(CYCLES - 1, k + 1);
  KEYS.forEach((key, i) => {
    for (const name of WORLD_PARTS[key]) ctx.get(name).visible = i === active;
  });
  if (KEYS[active] !== 'drift') return;
  // the drift: the car circles the artist AGAINST the camera's turn, yaw
  // offset and oscillating — that is what reads as a drift, not a circle
  const angle = -frame * 1.7;
  const [dx, , dz] = polarXZ(angle, DRIFT_R);
  const yaw = rad(angle) + Math.PI / 2 + rad(26 + 9 * Math.sin(frame * 0.13));
  for (const name of DCAR) {
    const o = ctx.get(name);
    o.position.set(ARTIST[0] + dx, 0, ARTIST[2] + dz);
    o.rotation.set(0, yaw, 0);
  }
}

/* ------------------------------------------------------------------ scene -- */
const HEROES = [
  { hero: 'PRP_car_body', occ: ['CHR_*', 'PRP_car_*'] },
  { hero: ['CHR_red1_*', 'CHR_red2_*', 'CHR_red3_*', 'CHR_cyan1_*', 'CHR_cyan2_*', 'PRP_ball'],
    occ: ['CHR_*', 'PRP_hoop_*'] },
  { hero: ['CHR_artist_torso', 'CHR_artist_head'],
    occ: ['PRP_dcar_*', 'PRP_beam_*', 'CHR_artist_*'] },
];

const shots = [];
for (let k = 0; k < CYCLES; k++) {
  const a = k * C, dome = a + DF, end = (k + 1) * C;
  const n = F(end) - F(dome);
  shots.push(
    { name: `DOME${k + 1}_${WORLDS[k].key}`, from: F(a), to: F(dome),
      focalLength: WORLDS[k].focal, easing: 'linear',
      hero: HEROES[k].hero, occlusion: { ignore: HEROES[k].occ },
      joins: k > 0, move: win(a, dome) },
    // Half-open ranges: the last RENDERED frame is to-1, which maps to
    // progress (n-1)/n. Stretch the window so that frame lands exactly on
    // the next dome's u=0, or the splice is one frame of trajectory short —
    // the seam check measured 0.64 m of it on the widest radius change.
    { name: `DIP${k + 1}`, from: F(dome), to: F(end),
      focalLength: WORLDS[k].focal, easing: 'linear',
      hero: [], clearance: 0, joins: true,
      move: win(dome, dome + (end - dome) * n / (n - 1)) },
  );
}

export default defineScene({
  id: 'orbital',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  build,
  animate,
  shots,
});
