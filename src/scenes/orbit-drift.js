/**
 * orbit-drift.js — scene three: night. The artist stands centre stage while
 * the car DRIFTS around them, headlights on — nose yawed into the circle, the
 * beam cones sweeping as it goes. The camera runs the same shared orbit in
 * counter-rotation and lingers on the artist. Rises from scene two's dive;
 * no dive out — the piece ends here.
 */
import { defineScene } from '../../lib/scene.js';
import { orbitalShots, buildCar } from '../orbitRecipe.js';

const rad = (d) => (d * Math.PI) / 180;
const polarXZ = (deg, r, y = 0) => [Math.sin(rad(deg)) * r, y, Math.cos(rad(deg)) * r];

const identity = {
  nightfloor: '#2c2c2c',
  crimson: '#6e2429', steel: '#3d454d', dark: '#232325',
  beam: '#e8dfb8',
  artist: '#f5efe0',
};

const ignore = [
  ['PRP_car_*', 'PRP_car_*'],
  ['PRP_beam_*', 'PRP_car_*'],      // beams pour out of the headlights
  ['PRP_beam_*', 'PRP_beam_*'],
  ['PRP_beam_*', 'CHR_*'],          // light sweeping across the artist IS the shot
  ['CHR_artist_torso', 'CHR_artist_*'],
];

const CAR_PARTS = ['PRP_car_body', 'PRP_car_cabin',
  'PRP_car_wheel_fl', 'PRP_car_wheel_fr', 'PRP_car_wheel_rl', 'PRP_car_wheel_rr',
  'PRP_beam_l', 'PRP_beam_r'];
const DRIFT_R = 3.4, DRIFT_YAW = 28;              // nose yawed into the circle
const ARTIST = [0.6, 0, 0.4];   // off the plunge axis — the camera bursts up
                                // through the floor at the origin, not through them

function build({ ctx, geo }) {
  ctx.part('ENV_floor', geo.disc({ radius: 14 }), 'nightfloor', ctx.groups.ENV);

  const f = geo.figure({ height: 1.78, seated: false });
  const rig = ctx.pivot('CHR_artist_rig', ARTIST, ctx.groups.CHR);
  for (const p of ['torso', 'head', 'arms', 'legs'])
    ctx.part(`CHR_artist_${p}`, f[p], 'artist', rig);

  buildCar(ctx, geo, { bodyId: 'crimson', cabinId: 'steel', wheelId: 'dark' });
  // headlight cones, translucent, baked pointing out of the nose (+x)
  const beamMat = ctx.material('beam');
  beamMat.transparent = true;
  beamMat.opacity = 0.3;
  for (const [name, sz] of [['PRP_beam_l', 0.58], ['PRP_beam_r', -0.58]]) {
    ctx.part(name, geo.cone({ rBottom: 0.07, rTop: 0.55, h: 3.6, segments: 16 })
      .rotateZ(-Math.PI / 2).translate(2.2 + 1.8, 0.72, sz), 'beam');
  }
}

/** The drift is object animation: the whole car (beams included) circles the
 *  artist, nose yawed inward — a pure function of the frame. */
function animate({ ctx, frame }) {
  const angle = frame * 1.6;                       // ~3.2 laps over the film
  const [dx, , dz] = polarXZ(angle, DRIFT_R);
  const x = ARTIST[0] + dx, z = ARTIST[2] + dz;
  for (const name of CAR_PARTS) {
    const o = ctx.get(name);
    o.visible = true;
    o.position.set(x, 0, z);
    o.rotation.set(0, rad(angle + DRIFT_YAW), 0);
  }
}

export default defineScene({
  id: 'orbit-drift',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  background: '#161616',
  identity,
  ignore,
  build,
  animate,
  shots: orbitalShots({
    startDeg: 105,  // = the court scene's exit azimuth
    center: [0.6, 1.0, 0.4],
    key: [0.6, 1.62, 0.4],                         // the artist's head
    // torso + head, not limbs: arms hug the torso and self-occlude
    heroWide: ['CHR_artist_torso', 'CHR_artist_head'], heroKey: 'CHR_artist_head',
    // the car crossing the artist IS the drift; and a figure's own limbs
    // are never blockers of its own torso
    occlusionIgnore: ['PRP_car_*', 'PRP_beam_*', 'CHR_artist_*'],
    rise: true, dive: false,
  }),
});
