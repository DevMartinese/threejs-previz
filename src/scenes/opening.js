/**
 * opening.js — a 3-second overhead establishing view of the round table,
 * reusing roundtable.js's build wholesale. Exists mostly to give the film a
 * second scene: same fps, same dimensions, so the film-level checks pass.
 */
import { defineScene } from '../../lib/scene.js';
import { moves } from '../../lib/cameraMoves.js';

const rad = (d) => (d * Math.PI) / 180;
import { build, identity, ignore } from './roundtable.js';

export default defineScene({
  id: 'opening',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  build,
  shots: [
    // A slow drift almost straight down — the room read as a diagram before
    // the orbit gets to work. Nobody blocks the table from directly above.
    { name: 'OP01_top', from: 0, to: 72, focalLength: 24, easing: 'easeInOutSine',
      hero: 'PRP_table_top',
      move: moves.orbit360({ radius: 4.6, height: 0, phi: rad(72),
                             startAngle: rad(-10), arc: rad(20), target: [0, 0.4, 0] }) },
  ],
});
