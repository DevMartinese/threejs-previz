/**
 * orbit-court.js — scene two: a court mid-basketball game, frozen. The scene
 * is authored around the play (the hoop sits at +x), so the shared orbit
 * centres on the action; the linger finds the ball hanging at the rim. The
 * camera rises out of the floor from scene one's dive, and dives again at the
 * end.
 */
import { defineScene } from '../../lib/scene.js';
import { orbitalShots } from '../orbitRecipe.js';

const rad = (d) => (d * Math.PI) / 180;
const CAST = ['red1', 'red2', 'red3', 'cyan1', 'cyan2'];

const identity = {
  grey: '#9a9a9a', line: '#cfcac0',
  board: '#dcd8cf', hoop: '#d98c46', ball: '#c9601e', pole: '#4a4a4e',
  red: '#c0392b', cyan: '#1abcb4',
};

const ignore = [
  ['PRP_hoop_*', 'PRP_hoop_*'],
  ...CAST.map((c) => [`CHR_${c}_torso`, `CHR_${c}_*`]),
];

function build({ ctx, geo }) {
  ctx.part('ENV_floor', geo.disc({ radius: 14 }), 'grey', ctx.groups.ENV);
  // court markings — scenery, slightly lighter grey
  ctx.part('ENV_key', geo.box({ x: 4.4, y: 0.012, z: 3.6 }), 'line', ctx.groups.ENV)
    .position.set(-1.2, 0.006, 0);
  ctx.part('ENV_circle', geo.rim({ radius: 1.6, thickness: 0.03 }), 'line', ctx.groups.ENV)
    .rotation.x = Math.PI / 2;
  ctx.get('ENV_circle').position.set(4.5, 0.012, 0);

  // the hoop at +x
  ctx.part('PRP_hoop_pole', geo.box({ x: 0.16, y: 3.6, z: 0.16 }).translate(-3.4, 1.8, 0), 'pole');
  ctx.part('PRP_hoop_board', geo.box({ x: 0.08, y: 1.05, z: 1.8 }).translate(-3.15, 3.35, 0), 'board');
  ctx.part('PRP_hoop_ring', geo.rim({ radius: 0.24, thickness: 0.02 })
    .rotateX(Math.PI / 2).translate(-2.85, 3.05, 0), 'hoop');

  const player = (c, colour, [x, y, z], ry) => {
    const rig = ctx.pivot(`CHR_${c}_rig`, [x, y, z], ctx.groups.CHR);
    rig.rotation.y = rad(ry);
    const f = geo.figure({ height: 1.85, seated: false, armsForward: true });
    for (const p of ['torso', 'head', 'arms', 'legs'])
      ctx.part(`CHR_${c}_${p}`, f[p], colour, rig);
  };
  player('red1', 'red', [-1.6, 0.55, 0.3], 95);    // the jumper, frozen mid-air
  player('red2', 'red', [0.8, 0, 1.4], 70);
  player('red3', 'red', [1.6, 0, -1.2], 50);
  player('cyan1', 'cyan', [-2.1, 0, -0.4], -100);    // contesting under the rim
  player('cyan2', 'cyan', [-0.2, 0, -1.8], -60);

  // the ball, hanging just off the rim — the frozen moment the linger finds
  ctx.part('PRP_ball', geo.ellipsoid({ rx: 0.12, ry: 0.12, rz: 0.12 })
    .translate(-2.45, 3.0, 0.12), 'ball');
}

export default defineScene({
  id: 'orbit-court',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  build,
  shots: orbitalShots({
    center: [-0.85, 1.62, 0],
    key: [-2.45, 3.0, 0.12],                        // the ball at the rim
    heroWide: 'PRP_ball', heroKey: 'PRP_ball',
    occlusionIgnore: ['CHR_*', 'PRP_hoop_*'],      // bodies and board cross the ball mid-game
    rise: true, dive: true,
  }),
});
