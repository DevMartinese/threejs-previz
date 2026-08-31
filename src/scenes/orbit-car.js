/**
 * orbit-car.js — scene one of the orbital triptych: a car with people sitting
 * in and around it, frozen daylight. The shared orbit lingers on red, sitting
 * on the hood; the cut dives through the floor into scene two.
 */
import { defineScene } from '../../lib/scene.js';
import { orbitalShots, buildCar } from '../orbitRecipe.js';

const rad = (d) => (d * Math.PI) / 180;
const CAST = ['red', 'cyan', 'yellow', 'green', 'violet'];

const identity = {
  grey: '#9a9a9a',
  crimson: '#8e2f35', steel: '#5a6570', dark: '#2e2e30',
  red: '#c0392b', cyan: '#1abcb4', yellow: '#f1c40f',
  green: '#27ae60', violet: '#8e44ad',
};

const ignore = [
  ['PRP_car_*', 'PRP_car_*'],       // cabin sits on body, wheels tuck under
  ['PRP_car_*', 'CHR_*'],           // people sit in and on the car by design
  ...CAST.map((c) => [`CHR_${c}_torso`, `CHR_${c}_*`]),
];

function build({ ctx, geo }) {
  ctx.part('ENV_floor', geo.disc({ radius: 14 }), 'grey', ctx.groups.ENV);
  buildCar(ctx, geo, { bodyId: 'crimson', cabinId: 'steel', wheelId: 'dark' });

  const person = (c, [x, y, z], ry, seated) => {
    const rig = ctx.pivot(`CHR_${c}_rig`, [x, y, z], ctx.groups.CHR);
    rig.rotation.y = rad(ry);
    const f = geo.figure({ height: 1.72, seated });
    for (const p of ['torso', 'head', 'arms', 'legs'])
      ctx.part(`CHR_${c}_${p}`, f[p], c, rig);
  };
  person('red', [1.45, 0.74, 0.45], 25, true);     // on the hood, legs over the side
  person('cyan', [-0.35, 0.78, 0.38], 90, true);   // in the open cabin, riding high
  person('yellow', [-0.75, 0.78, -0.38], 90, true);
  person('green', [-3.3, 0, 1.5], 130, true);      // sitting on the ground by the trunk
  person('violet', [2.2, 0, -2.1], -30, false);    // standing clear of the nose
}

export default defineScene({
  id: 'orbit-car',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  build,
  shots: orbitalShots({
    startDeg: -30,
    center: [0, 1.1, 0],
    // gaze leans TOWARD red on the hood without centring them — a smaller
    // excursion, so the return leg doesn't push the car out of ORB_out
    key: [0.85, 1.6, 0.3],
    heroWide: 'PRP_car_body', heroKey: 'CHR_red_head',
    occlusionIgnore: ['CHR_*', 'PRP_car_*'],       // the cast eclipses the car; that's the orbit
    rise: false, dive: true,
  }),
});
