/**
 * orbitRecipe.js — ONE cinematic orbit, repeated across scenes, never stopping.
 *
 * Each scene is a FULL 360° lap. The scene change rides the orbit itself: in
 * the last 12% of the lap the camera spirals down and inward through the
 * floor (still orbiting), and the next scene opens with the camera spiralling
 * up out of the floor at the SAME azimuth, radius, height, gaze and angular
 * rate — so across the hard cut the orbital motion is continuous and a new
 * world simply appears around it. The film declares `seams: true`, so the
 * boundary poses are MEASURED by the film-level continuity check, not
 * promised. Dive/rise entries carry `hero: []` and `clearance: 0` — the
 * camera is meant to pass through the surface.
 *
 * Mid-lap the orbit lingers on the scene's key moment — 21% of the time for
 * 8% of the arc, the gaze easing onto the key and back.
 */
const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

export function orbitalShots({
  R = 8, H = 2.4, startDeg = -30, focal = 32,
  center = [0, 1.1, 0], key = null,
  heroWide, heroKey = null, occlusionIgnore = [],
  rise = false, dive = true, from = 0, to = 240,
}) {
  // A FULL 360-degree lap at orbit height around every world — the vuelta is
  // complete before the world changes. The rise/dive are EXTRA azimuth (45
  // degrees each) beyond the lap: the camera keeps turning while it swoops
  // over and in, so each scene starts where the last one ended angularly and
  // the whole film is one continuous rotation.
  const TDEG = 45;
  const azTotal = 360 + (rise ? TDEG : 0) + (dive ? TDEG : 0);
  const rU = rise ? TDEG / azTotal : 0;      // u spent rising
  const dU = dive ? TDEG / azTotal : 0;      // u spent diving
  const W = 1 - rU - dU;                     // the at-height lap window
  /** The whole lap as one pure move: azimuth 0..360. The transition is an
   *  OVER-THE-TOP plunge: in the last 14% the camera keeps orbiting while it
   *  climbs above the scene (apex ~0.32R over orbit height) and dives down
   *  through the scene's centre — through the subject's surface — ending
   *  just under the floor, gaze straight down. The next scene mirrors it:
   *  up out of the surface, over the top looking down at the NEW world, and
   *  back out into the same orbit. Both ends share the exact pose, so the
   *  film's seam check can prove the splice. */
  const DIP = -0.12;
  const overTop = (t) => {          // t: 0 at orbit -> 1 at the plunge point
    const e = smooth(t);
    return {
      rx: R * (1 - 0.98 * e),       // never exactly on axis: lookAt stays sane
      h: lerp(H, DIP, e) + R * 0.32 * Math.sin(Math.PI * e),
      down: smooth((t - 0.25) / 0.75),
    };
  };
  const lap = (u) => {
    const az = rad(startDeg + azTotal * u);
    let rx = R, h = H, down = 0;
    if (rise && u < rU) ({ rx, h, down } = overTop(1 - u / rU));
    if (dive && u > 1 - dU) ({ rx, h, down } = overTop((u - (1 - dU)) / dU));
    const position = [Math.sin(az) * rx, h, Math.cos(az) * rx];
    let target = center;
    if (key) {
      const w = smooth((u - (rU + 0.37 * W)) / (0.06 * W))
              - smooth((u - (rU + 0.51 * W)) / (0.06 * W));
      target = [lerp(center[0], key[0], w), lerp(center[1], key[1], w),
                lerp(center[2], key[2], w)];
    }
    if (down > 0) {
      target = [lerp(target[0], 0, down), lerp(target[1], h - 1.5, down),
                lerp(target[2], 0, down)];
    }
    return { position, target, fov: 45, roll: 0 };
  };
  const win = (a, b) => (u) => lap(a + (b - a) * u);

  const span = to - from;
  const F = (frac) => from + Math.round(span * frac);
  const occ = { ignore: occlusionIgnore };
  // time fractions: transitions are quick beats; the linger buys its slowness
  // with time (22% of the frames for 8% of the lap's arc)
  const tRise = rise ? 0.10 : 0;
  const tDive = dive ? 0.10 : 0;
  const seg = (fr) => tRise + (1 - tRise - tDive) * fr;
  const u1 = rU + 0.40 * W, u2 = rU + 0.48 * W;   // the linger's arc
  const shots = [];
  if (rise) {
    shots.push({ name: 'RISE', from, to: F(tRise), focalLength: focal,
      easing: 'linear', hero: [], clearance: 0, move: win(0, rU) });
  }
  shots.push(
    { name: 'ORB_in', from: rise ? F(tRise) : from, to: F(seg(0.40)), focalLength: focal,
      easing: 'easeInOutSine', hero: heroWide, occlusion: occ, joins: rise,
      move: win(rU, u1) },
    { name: 'ORB_linger', from: F(seg(0.40)), to: F(seg(0.62)), focalLength: focal,
      easing: 'linear', hero: heroKey ?? heroWide, occlusion: occ, joins: true,
      move: win(u1, u2) },
    { name: 'ORB_out', from: F(seg(0.62)), to: dive ? F(1 - tDive) : to, focalLength: focal,
      easing: 'easeInOutSine', hero: heroWide, occlusion: occ, joins: true,
      move: win(u2, dive ? 1 - dU : 1) });
  if (dive) {
    // Half-open arithmetic: the last RENDERED frame of this scene is to-1 —
    // stretch the window so that frame lands exactly on u=1, or the boundary
    // pose misses the next scene's u=0 by one frame of trajectory.
    const dF = to - F(1 - tDive);
    shots.push({ name: 'DIVE', from: F(1 - tDive), to, focalLength: focal,
      easing: 'linear', hero: [], clearance: 0, joins: true,
      move: win(1 - dU, 1 - dU + dU * dF / (dF - 1)) });
  }
  return shots;
}

/**
 * A car proxy shared by two scenes: rounded body + a LOW open cabin, so
 * people sitting in it actually read — heads and shoulders out, convertible
 * style. All offsets baked into the GEOMETRY so every part shares one
 * position/rotation. ~4.4 m long, nose at +x.
 */
export function buildCar(ctx, geo, { bodyId, cabinId, wheelId, prefix = 'PRP_car' } = {}) {
  const parts = [];
  parts.push(ctx.part(`${prefix}_body`,
    geo.roundedBox({ x: 4.4, y: 0.8, z: 1.9, r: 0.16 }).translate(0, 0.85, 0), bodyId));
  parts.push(ctx.part(`${prefix}_cabin`,
    geo.roundedBox({ x: 2.2, y: 0.4, z: 1.62, r: 0.14 }).translate(-0.35, 1.42, 0), cabinId));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    parts.push(ctx.part(`${prefix}_wheel_${sx > 0 ? 'f' : 'r'}${sz > 0 ? 'l' : 'r'}`,
      geo.cone({ rBottom: 0.36, rTop: 0.36, h: 0.26, segments: 18 })
        .rotateX(Math.PI / 2).translate(1.42 * sx, 0.36, 0.95 * sz), wheelId));
  }
  return parts;
}
