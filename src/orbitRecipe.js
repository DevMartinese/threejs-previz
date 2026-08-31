/**
 * orbitRecipe.js — ONE cinematic orbit, repeated across scenes.
 *
 * The motif: the camera circles smoothly, accelerating in, decelerating into a
 * LINGER on the scene's key moment (30% of the time for 15% of the arc, gaze
 * eased onto the key via retarget), then accelerating out — and between scenes
 * it DIVES through the floor and emerges from it in the next: a seamless
 * match-cut, declared honestly (`hero: []`, `clearance: 0`) so the audits know
 * the camera is meant to pass through the surface.
 *
 * All three scenes call this with the same R/H/arc, so the orbit is literally
 * the same move — only the world under it changes.
 */
import { moves, retarget, slice } from '../lib/cameraMoves.js';

const rad = (d) => (d * Math.PI) / 180;
const polar = (deg, r, y) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

export function orbitalShots({
  R = 8, H = 2.4, startDeg = -30, arcDeg = 300, focal = 32,
  center = [0, 1.1, 0], key = null,
  heroWide, heroKey = null, occlusionIgnore = [],
  rise = false, dive = true, from = 0, to = 240,
}) {
  const orbit = retarget(
    moves.orbit360({ radius: R, height: H, startAngle: rad(startDeg),
                     arc: rad(arcDeg), target: center }),
    { targets: key ? [center, center, key, center, center] : [center] });
  const start = polar(startDeg, R, H);
  const end = polar(startDeg + arcDeg, R, H);
  const occ = { ignore: occlusionIgnore };
  const oa = from + (rise ? 40 : 0);
  const ob = dive ? to - 40 : to;
  const span = ob - oa;
  const f = (frac) => oa + Math.round(span * frac);

  const shots = [];
  if (rise) {
    shots.push({ name: 'RISE', from, to: oa, focalLength: focal,
      easing: 'easeOutCubic', hero: [], clearance: 0,
      move: moves.bezier({ from: [0, -0.06, 0],
                           via: [start[0] * 0.35, H * 0.5, start[2] * 0.35],
                           to: start, target: center }) });
  }
  shots.push(
    { name: 'ORB_in', from: oa, to: f(0.4), focalLength: focal,
      easing: 'easeInOutSine', hero: heroWide, occlusion: occ,
      move: slice(orbit, 0, 0.4) },
    { name: 'ORB_linger', from: f(0.4), to: f(0.7), focalLength: focal,
      easing: 'linear', hero: heroKey ?? heroWide, occlusion: occ,
      move: slice(orbit, 0.4, 0.55) },
    { name: 'ORB_out', from: f(0.7), to: ob, focalLength: focal,
      easing: 'easeInOutSine', hero: heroWide, occlusion: occ,
      move: slice(orbit, 0.55, 1) });
  if (dive) {
    shots.push({ name: 'DIVE', from: ob, to, focalLength: focal,
      easing: 'easeInCubic', hero: [], clearance: 0,
      move: moves.bezier({ from: end, via: [end[0] * 0.3, H * 0.55, end[2] * 0.3],
                           to: [0, -0.06, 0], target: [0, 0.2, 0] }) });
  }
  return shots;
}

/**
 * A car proxy shared by two scenes: rounded body + cabin, four wheels, all
 * offsets baked into the GEOMETRY so every part shares one position/rotation
 * (the drift scene spins the whole car as a unit). ~4.4 m long, nose at +x.
 */
export function buildCar(ctx, geo, { bodyId, cabinId, wheelId, prefix = 'PRP_car' } = {}) {
  const parts = [];
  parts.push(ctx.part(`${prefix}_body`,
    geo.roundedBox({ x: 4.4, y: 0.8, z: 1.9, r: 0.16 }).translate(0, 0.85, 0), bodyId));
  parts.push(ctx.part(`${prefix}_cabin`,
    geo.roundedBox({ x: 2.2, y: 0.62, z: 1.62, r: 0.18 }).translate(-0.35, 1.52, 0), cabinId));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    parts.push(ctx.part(`${prefix}_wheel_${sx > 0 ? 'f' : 'r'}${sz > 0 ? 'l' : 'r'}`,
      geo.cone({ rBottom: 0.36, rTop: 0.36, h: 0.26, segments: 18 })
        .rotateX(Math.PI / 2).translate(1.42 * sx, 0.36, 0.95 * sz), wheelId));
  }
  return parts;
}
