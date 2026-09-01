/**
 * orbital.js — three worlds, ONE scene, one continuous camera, no cuts.
 * 24 fps, 21:9, 720 frames. The worlds are stacked vertically 18 units apart,
 * so the surface the camera punches through is literally each world's floor:
 *
 *   world 1  y   0   a car with people sitting in it and standing around it
 *   world 2  y -18   a basketball court mid-game, ball above the rim
 *   world 3  y -36   night: a car drifting around a still artist, beam cones on
 *
 * THE MOVE — the same cycle three times, all of it one pure function
 * journey(u): the camera enters at ground level (~5 degrees elevation),
 * rises in a dome arc over the scene (crest ~78 degrees) while the dome
 * radius closes in, comes down the other side to ~5 degrees, then keeps
 * going: it punches through the floor facing it (the surface fills frame),
 * falls through the next world's sky facing its floor, and flares out at
 * ground level into the next dome. Continuity is guaranteed by construction
 * — the dive is a curve whose endpoints ARE the adjacent dome endpoints,
 * evaluated from the same formulas — and verified numerically by the
 * camera-path audit and the enforced joins between entries.
 *
 * The court is 28 m long, so its dome opens wider and its lens goes wider
 * (24 mm vs 32) or the players at the ends get cut on the far-side descent.
 */
import { defineScene } from '../../lib/scene.js';

const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

/* ---------------------------------------------------------------- worlds -- */
const DROP = 18;
const WY = [0, -DROP, -2 * DROP];
// per-world dome: [radius at entry, radius at exit, target height, lens]
// the court dome opens much wider — its world is 28 m long
// cx/cz: each dome mounts over its world's ACTION, not its origin — the
// court's play lives at the hoop end of a 28 m floor, so its dome centres on
// the play's centroid and opens far wider, on a far wider lens.
const DOME = [
  // scaled out ~10% from the first pass: on a 21:9 frame the vertical FOV is
  // the scarce one, and a 4.4 m car seen from a high dome fills it top to
  // bottom (v -0.04..0.96 @f130) while using barely a third of the width.
  { r0: 11.6, r1: 10.3, ty: 1.1, focal: 28, cx: 0, cz: 0 },
  // hard ceiling: worlds sit 18 apart, so this dome's crest must stay BELOW
  // world 1's floor (sin78 * r_crest < 17.5) or the camera looks at the court
  // through the floor above it — the occlusion audit caught exactly that.
  // The 28 m court therefore gets the widest lens instead of a taller dome.
  { r0: 20, r1: 15.5, ty: 1.5, focal: 18, cx: -5.5, cz: 0 },
  { r0: 8.5, r1: 6.0, ty: 1.1, focal: 32, cx: 0.6, cz: 0.4 },
];

const identity = {
  grey: '#9a9a9a', greyDeep: '#7a7a7a', line: '#cfcac0', night: '#2c2c2c',
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
const DCAR_PARTS = ['PRP_dcar_body', 'PRP_dcar_cabin',
  'PRP_dcar_wheel_fl', 'PRP_dcar_wheel_fr', 'PRP_dcar_wheel_rl', 'PRP_dcar_wheel_rr',
  'PRP_beam_l', 'PRP_beam_r'];
const ARTIST = [0.6, WY[2], 0.4];
const DRIFT_R = 3.4;

function buildCar(ctx, geo, { bodyId, cabinId, wheelId, prefix, y = 0 }) {
  ctx.part(`${prefix}_body`,
    geo.roundedBox({ x: 4.4, y: 0.8, z: 1.9, r: 0.16 }).translate(0, y + 0.85, 0), bodyId);
  ctx.part(`${prefix}_cabin`,
    geo.roundedBox({ x: 2.2, y: 0.4, z: 1.62, r: 0.14 }).translate(-0.35, y + 1.42, 0), cabinId);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    ctx.part(`${prefix}_wheel_${sx > 0 ? 'f' : 'r'}${sz > 0 ? 'l' : 'r'}`,
      geo.cone({ rBottom: 0.36, rTop: 0.36, h: 0.26, segments: 18 })
        .rotateX(Math.PI / 2).translate(1.42 * sx, y + 0.36, 0.95 * sz), wheelId);
  }
}

function person(ctx, geo, name, colour, [x, y, z], ry, seated, height = 1.72) {
  const rig = ctx.pivot(`CHR_${name}_rig`, [x, y, z], ctx.groups.CHR);
  rig.rotation.y = rad(ry);
  const f = geo.figure({ height, seated, armsForward: true });
  for (const p of ['torso', 'head', 'arms', 'legs'])
    ctx.part(`CHR_${name}_${p}`, f[p], colour, rig);
}

function build({ ctx, geo }) {
  // ---- world 1: the car and its people, ground level
    // Floors are 60 across, not 15: the dive crosses them ~10 units out from
  // the centre, and a small disc shows its RIM there — you see a floating
  // plate with the next world already visible underneath instead of a
  // surface being punched through.
  ctx.part('ENV_floor1', geo.disc({ radius: 60 }), 'grey', ctx.groups.ENV);
  buildCar(ctx, geo, { bodyId: 'crimson', cabinId: 'steel', wheelId: 'dark', prefix: 'PRP_car' });
  person(ctx, geo, 'red', 'red', [1.45, 0.74, 0.45], 25, true);      // on the hood
  person(ctx, geo, 'cyan', 'cyan', [-0.35, 0.78, 0.38], 90, true);   // riding high
  person(ctx, geo, 'yellow', 'yellow', [-0.75, 0.78, -0.38], 90, true);
  person(ctx, geo, 'green', 'green', [-3.3, 0, 1.5], 130, true);     // on the ground
  person(ctx, geo, 'violet', 'violet', [2.2, 0, -2.1], -30, false);

  // ---- world 2: the court, 28 m long, mid-game, 18 below
  const y2 = WY[1];
  ctx.part('ENV_floor2', geo.disc({ radius: 60 }), 'grey', ctx.groups.ENV)
    .position.y = y2;
  ctx.part('ENV_court', geo.box({ x: 28, y: 0.02, z: 15 }), 'greyDeep', ctx.groups.ENV)
    .position.y = y2 + 0.01;
  ctx.part('ENV_mid', geo.rim({ radius: 1.8, thickness: 0.035 }), 'line', ctx.groups.ENV)
    .rotation.x = Math.PI / 2;
  ctx.get('ENV_mid').position.y = y2 + 0.025;
  ctx.part('PRP_hoop_pole', geo.box({ x: 0.16, y: 3.6, z: 0.16 })
    .translate(-12.6, y2 + 1.8, 0), 'pole');
  ctx.part('PRP_hoop_board', geo.box({ x: 0.08, y: 1.05, z: 1.8 })
    .translate(-12.35, y2 + 3.35, 0), 'board');
  ctx.part('PRP_hoop_ring', geo.rim({ radius: 0.24, thickness: 0.02 })
    .rotateX(Math.PI / 2).translate(-12.05, y2 + 3.05, 0), 'hoop');
  person(ctx, geo, 'red1', 'red', [-10.8, y2 + 0.55, 0.3], 95, false, 1.85);  // the jumper
  person(ctx, geo, 'red2', 'red', [-4.5, y2, 2.2], 70, false, 1.85);
  person(ctx, geo, 'red3', 'red', [0.5, y2, -2.4], 50, false, 1.85);
  person(ctx, geo, 'cyan1', 'cyan', [-11.3, y2, -0.5], -100, false, 1.85);
  person(ctx, geo, 'cyan2', 'cyan', [1.2, y2, 2.4], -60, false, 1.85);
  ctx.part('PRP_ball', geo.ellipsoid({ rx: 0.12, ry: 0.12, rz: 0.12 })
    .translate(-11.6, y2 + 3.2, 0.12), 'ball');

  // ---- world 3: night drift around the artist, 36 below
  const y3 = WY[2];
  ctx.part('ENV_floor3', geo.disc({ radius: 60 }), 'night', ctx.groups.ENV)
    .position.y = y3;
  person(ctx, geo, 'artist', 'artist', ARTIST, 0, false, 1.78);
  buildCar(ctx, geo, { bodyId: 'nightcar', cabinId: 'nightsteel', wheelId: 'dark',
                       prefix: 'PRP_dcar' });
  const beamMat = ctx.material('beam');
  beamMat.transparent = true;
  beamMat.opacity = 0.3;
  for (const [name, sz] of [['PRP_beam_l', 0.58], ['PRP_beam_r', -0.58]]) {
    ctx.part(name, geo.cone({ rBottom: 0.07, rTop: 0.55, h: 3.6, segments: 16 })
      .rotateZ(-Math.PI / 2).translate(4.0, 0.72, sz), 'beam');
  }
}

/* The drift is object animation: the car circles the artist AGAINST the
 * camera's direction so it sweeps through frame, and it does not point where
 * it is going — the yaw is offset and oscillates. That is what reads as a
 * drift. Beams ride the car (their geometry is baked pointing out its nose). */
function animate({ ctx, frame }) {
  const angle = -frame * 1.7;                       // against the camera's turn
  const [dx, , dz] = polarXZ(angle, DRIFT_R);
  const yaw = rad(angle) + Math.PI / 2 + rad(26 + 9 * Math.sin(frame * 0.13));
  for (const name of DCAR_PARTS) {
    const o = ctx.get(name);
    o.visible = true;
    o.position.set(ARTIST[0] + dx, WY[2], ARTIST[2] + dz);
    o.rotation.set(0, yaw, 0);
  }
}

/* ---------------------------------------------------------------- journey --
 * One pure function of u over the whole 720 frames. Three cycles; each cycle
 * is dome (80% of the cycle) + dive (20%). Dive endpoints are the adjacent
 * dome endpoints evaluated from the same code — continuity by construction.
 */
const CYCLES = 3;
// 0.9 of each 240-frame cycle is dome, 0.1 is dive: 24 frames, of which ~19
// (0.8 s) are under the surface. The dive needs the length because the
// reveal swing at the far end has to stay under ~10 deg/frame. Making the punch-through FAST is safe for
// the camera-path audit precisely because each dive is its own shot entry —
// the audit measures every step against that shot's OWN median, so a
// uniformly quick dive has no outlier, while a discontinuity still would.
const DOME_FRAC = 0.9;
const AZ_SPAN = 180;                 // up one side, over the top, down the other

const PITCH = 0.92;                  // where the dome's gaze starts pitching down

const domePose = (k, s) => {         // s: 0..1 along world k's dome
  const { r0, r1, ty, cx, cz } = DOME[k];
  const az = rad(k * AZ_SPAN + AZ_SPAN * s);
  const phi = rad(5 + 73 * Math.sin(Math.PI * s));
  const r = lerp(r0, r1, smooth(s)); // closes in as it rises
  const cy = WY[k];
  const position = [cx + Math.sin(az) * Math.cos(phi) * r, cy + Math.sin(phi) * r,
                    cz + Math.cos(az) * Math.cos(phi) * r];
  // The dome ends 5 degrees above the floor — a metre off it. Pitching the
  // gaze DOWN over the dome's last 8% is what makes the punch-through read:
  // the surface fills frame while the camera is still above it, and only
  // then does it cross. Swinging the look down after crossing (the first
  // version) shows the floor edge-on and the next world already underneath.
  const w = smooth((s - PITCH) / (1 - PITCH));
  // Aimed 12% of the way toward the dome's axis rather than straight down:
  // a gaze exactly along the camera's own up axis is the lookAt singularity
  // — the view direction stays smooth while the FRAME SPINS (a 150-degree
  // up-vector flip in one frame, which the roll check now catches). This
  // caps the pitch near 80 degrees, and a 60-wide floor still fills frame.
  const down = [lerp(position[0], cx, 0.12), cy - 3.5, lerp(position[2], cz, 0.12)];
  const centre = [cx, cy + ty, cz];
  return {
    position,
    target: [0, 1, 2].map((i) => lerp(centre[i], down[i], w)),
  };
};

const journey = (u) => {
  const k = Math.min(CYCLES - 1, Math.floor(u * CYCLES));
  const t = u * CYCLES - k;
  if (t < DOME_FRAC || k === CYCLES - 1 && t >= DOME_FRAC && false) {
    // fallthrough below handles dive; dome:
  }
  if (t < DOME_FRAC) {
    const { position, target } = domePose(k, t / DOME_FRAC);
    return { position, target, fov: 45, roll: 0 };
  }
  // THE DIVE: from this dome's exact end to the next dome's exact start
  // (world 3's dive plunges into the dark below the last floor and the piece
  // ends there). Cubic bezier whose control points sit on the REAL dome
  // tangents (finite differences of the same domePose code), scaled so the
  // bezier's initial/final velocity matches the domes' frame step — C1
  // continuity by construction, then verified by the joins and the
  // camera-path audit.
  const d = (t - DOME_FRAC) / (1 - DOME_FRAC);
  const E = domePose(k, 1);
  const S = k < CYCLES - 1 ? domePose(k + 1, 0)
    : { position: [E.position[0] * 0.5, WY[2] - 12, E.position[2] * 0.5],
        target: [E.position[0] * 0.5, WY[2] - 30, E.position[2] * 0.5] };
  const P0 = E.position, P3 = S.position;
  const eps = 0.005;
  const domeFrames = 720 * DOME_FRAC / CYCLES, diveFrames = 720 * (1 - DOME_FRAC) / CYCLES;
  // exit tangent of this dome / entry tangent of the next, per dome-s unit
  const Eb = domePose(k, 1 - eps).position;
  const exitV = [0, 1, 2].map((i) => (P0[i] - Eb[i]) / eps / domeFrames);  // per frame
  const Sb = k < CYCLES - 1 ? domePose(k + 1, eps).position
    : [P3[0], P3[1] - 1, P3[2]];
  const entryV = k < CYCLES - 1
    ? [0, 1, 2].map((i) => (Sb[i] - P3[i]) / eps / domeFrames)
    : [0, -0.9, 0];   // still plunging when the piece ends
  // bezier'(0) = 3(P1-P0) over the dive's u; per frame that is 3(P1-P0)/n
  const P1 = [0, 1, 2].map((i) => P0[i] + exitV[i] * diveFrames / 3);
  // The camera must DIP BELOW the next world's floor and rise back through
  // it — that is what "emerges rising out of the floor" means, and it is
  // what hides the traverse: while the camera is under the surface the
  // surface fills frame, so the world is never seen approaching from far
  // away. Pulling P2 well below the floor makes the curve arrive at the
  // dome entry from underneath. (The last plunge has no next world, so it
  // keeps its dome-tangent control point.)
  const P2 = [0, 1, 2].map((i) => P3[i] - entryV[i] * diveFrames / 3);
  const a = (1 - d) ** 3, b = 3 * (1 - d) ** 2 * d, c = 3 * (1 - d) * d * d, e = d ** 3;
  const position = [0, 1, 2].map((i) => a * P0[i] + b * P1[i] + c * P2[i] + e * P3[i]);
  // gaze: ease OFF the dome's centre onto the surface being crossed (it
  // fills frame), then hand over to the next world's centre as the flare
  // begins — no gaze snap at either end of the dive
  // Nearly straight down (12% toward the axis, the same off-vertical margin
  // the dome pitch uses) — NOT half-way to the axis. Aimed inward it caught
  // the far edge of the next world from 16 units up, which is exactly the
  // "you see the other scene in the distance and the camera settles" read.
  // Aimed down it sees only the floor directly beneath, so the traverse is
  // featureless grey and the world is revealed at ground level.
  const hr = Math.hypot(position[0], position[2]) || 1;
  const inward = Math.max(0, 1 - 1.4 / hr);   // a fixed 1.4-unit lateral offset
  const downT = [position[0] * inward, position[1] - 8, position[2] * inward];
  // A transit dive turns twice — off this world, then onto the next — and
  // the two swings balance. The FINAL plunge has no hand-over, so front-
  // loading its single swing left the back half motionless and made the
  // swing itself an outlier against its own shot (17.5 deg/frame vs a 2.7
  // median). It gets the same total turn spread across the whole descent.
  const isLast = k === CYCLES - 1;
  const wIn = isLast ? smooth(d) : smooth(d / 0.5);
  const wOut = isLast ? 0 : smooth((d - 0.6) / 0.4);
  const target = [0, 1, 2].map((i) =>
    lerp(lerp(E.target[i], downT[i], wIn), S.target[i], wOut));
  return { position, target, fov: 45, roll: 0 };
};

const win = (a, b) => (u) => journey(a + (b - a) * u);
const F = (fr) => Math.round(720 * fr);
const C = 1 / CYCLES, DF = DOME_FRAC / CYCLES;
const DH = DF * PITCH;               // the hero-enforced part of each dome

/* ------------------------------------------------------------------ scene -- */
export default defineScene({
  id: 'orbital',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  floorY: WY[2] - 0.1,     // the audit floor is the LOWEST world's floor; the
                           // camera dives below it at the end, but no MESH may
  build,
  animate,
  shots: [
    { name: 'DOME1_car', from: 0, to: F(DH), focalLength: DOME[0].focal,
      easing: 'linear', hero: 'PRP_car_body',
      occlusion: { ignore: ['CHR_*', 'PRP_car_*'] },
      move: win(0, DH) },
    // The punch is two beats at different speeds, so it is two entries: the
    // APPROACH (still above the floor, gaze pitching onto it) and the
    // CROSSING (fast, through the surface). The hero is supposed to leave
    // frame in both: the floor is the shot.
    { name: 'APPROACH1', from: F(DH), to: F(DF), focalLength: DOME[0].focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(DH, DF) },
    { name: 'CROSS1', from: F(DF), to: F(C), focalLength: DOME[0].focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(DF, C) },
    { name: 'DOME2_court', from: F(C), to: F(C + DH), focalLength: DOME[1].focal,
      easing: 'linear',
      // explicit names: 'CHR_red*' would also match world 1's red — the
      // worlds share one scene, so globs must not leak across them
      hero: ['CHR_red1_*', 'CHR_red2_*', 'CHR_red3_*', 'CHR_cyan1_*', 'CHR_cyan2_*', 'PRP_ball'],
      occlusion: { ignore: ['CHR_*', 'PRP_hoop_*'] },
      joins: true, move: win(C, C + DH) },
    { name: 'APPROACH2', from: F(C + DH), to: F(C + DF), focalLength: DOME[1].focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(C + DH, C + DF) },
    { name: 'CROSS2', from: F(C + DF), to: F(2 * C), focalLength: DOME[1].focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(C + DF, 2 * C) },
    { name: 'DOME3_drift', from: F(2 * C), to: F(2 * C + DH), focalLength: DOME[2].focal,
      easing: 'linear', hero: ['CHR_artist_torso', 'CHR_artist_head'],
      occlusion: { ignore: ['PRP_dcar_*', 'PRP_beam_*', 'CHR_artist_*'] },
      joins: true, move: win(2 * C, 2 * C + DH) },
    { name: 'APPROACH3', from: F(2 * C + DH), to: F(2 * C + DF), focalLength: DOME[2].focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(2 * C + DH, 2 * C + DF) },
    { name: 'CROSS3', from: F(2 * C + DF), to: 720, focalLength: DOME[2].focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(2 * C + DF, 1) },
  ],
});
