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
  /** The whole lap as one pure move: azimuth 0..360 with height/radius
   *  envelopes for the spiral rise/dive, a gaze bump onto the key, and a
   *  symmetric floor-facing gaze at both ends so seams splice exactly. */
  const lap = (u) => {
    const az = rad(startDeg + 360 * u);
    let h = H, r = R;
    if (rise && u < 0.12) {
      const t = u / 0.12;
      h = lerp(-0.08, H, 1 - (1 - t) ** 3);
      r = lerp(R * 0.45, R, t);
    }
    if (dive && u > 0.88) {
      const t = (u - 0.88) / 0.12;
      h = lerp(H, -0.08, t * t * t);
      r = lerp(R, R * 0.45, t);
    }
    const position = [Math.sin(az) * r, h, Math.cos(az) * r];
    let target = center;
    if (key) {
      const w = smooth((u - 0.42) / 0.09) - smooth((u - 0.58) / 0.09);
      target = [lerp(center[0], key[0], w), lerp(center[1], key[1], w),
                lerp(center[2], key[2], w)];
    }
    const floorGaze = (t) => [
      lerp(target[0], position[0] * 0.4, t),
      lerp(target[1], h - 1.2, t),
      lerp(target[2], position[2] * 0.4, t)];
    if (dive && u > 0.9) target = floorGaze(smooth((u - 0.9) / 0.1));
    if (rise && u < 0.1) target = floorGaze(smooth((0.1 - u) / 0.1));
    return { position, target, fov: 45, roll: 0 };
  };
  const win = (a, b) => (u) => lap(a + (b - a) * u);

  const span = to - from;
  const F = (frac) => from + Math.round(span * frac);
  const occ = { ignore: occlusionIgnore };
  const shots = [];
  if (rise) {
    shots.push({ name: 'RISE', from, to: F(0.12), focalLength: focal,
      easing: 'linear', hero: [], clearance: 0, move: win(0, 0.12) });
  }
  shots.push(
    { name: 'ORB_in', from: rise ? F(0.12) : from, to: F(0.42), focalLength: focal,
      easing: 'easeInOutSine', hero: heroWide, occlusion: occ,
      move: win(rise ? 0.12 : 0, 0.47) },
    { name: 'ORB_linger', from: F(0.42), to: F(0.63), focalLength: focal,
      easing: 'linear', hero: heroKey ?? heroWide, occlusion: occ,
      move: win(0.47, 0.55) },
    { name: 'ORB_out', from: F(0.63), to: dive ? F(0.88) : to, focalLength: focal,
      easing: 'easeInOutSine', hero: heroWide, occlusion: occ,
      move: win(0.55, dive ? 0.88 : 1) });
  if (dive) {
    // Half-open arithmetic: the last RENDERED frame of this scene is to-1,
    // which maps to progress (n-1)/n — stretch the window so that frame
    // lands exactly on u=1, or the boundary pose misses the next scene's
    // u=0 by one frame of trajectory (the seam check caught 0.306m of it).
    const dF = to - F(0.88);
    shots.push({ name: 'DIVE', from: F(0.88), to, focalLength: focal,
      easing: 'linear', hero: [], clearance: 0,
      move: win(0.88, 0.88 + 0.12 * dF / (dF - 1)) });
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
