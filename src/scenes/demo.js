/**
 * demo.js — the smallest scene that exercises the whole pipeline.
 *
 * Two characters at a round table, two shots: a wide turntable and an
 * over-the-shoulder push-in with handheld. Plain JS on purpose — the audit gate
 * loads this exact file in Node (`npm run audit`) before Remotion ever renders it.
 */
import { defineScene } from '../../lib/scene.js';
import { moves, handheld, reframe } from '../../lib/cameraMoves.js';

const SEAT_R = 1.15; // chairs just outside the table top (radius 0.7)

export default defineScene({
  id: 'demo',
  fps: 30,
  height: 720,
  aspect: 16 / 9,
  subjectSize: 2.5,

  // Colour is identity: the palette is the cast list.
  identity: {
    grey: '#9a9a9a',
    wood: '#8a6136',
    slate: '#5a6570',
    green: '#27ae60',
    red: '#c0392b',
  },

  // Contact by design is declared, not hidden: figures sit on chairs, and each
  // figure's own parts (head on torso, legs on torso) touch by construction.
  // Declared per character so a green×red collision still counts.
  ignore: [
    ['PRP_chair_*', 'CHR_*'],
    ['CHR_green_torso', 'CHR_green_*'],
    ['CHR_red_torso', 'CHR_red_*'],
  ],

  build: ({ ctx, geo }) => {
    ctx.part('ENV_floor', geo.disc({ radius: 6 }), 'grey', ctx.groups.ENV);
    ctx.part('PRP_table', geo.table({ radius: 0.7, height: 0.72 }), 'wood', ctx.groups.PRP);

    // One seated character: a rig pivot placed on the seat circle, facing the
    // table. The head is a separate part so it can be a framing hero.
    const seat = (colour, angle) => {
      const pos = [Math.sin(angle) * SEAT_R, 0, Math.cos(angle) * SEAT_R];
      const rig = ctx.pivot(`CHR_${colour}_rig`, pos, ctx.groups.CHR);
      rig.rotation.y = angle + Math.PI; // figures face +z locally; turn to centre

      const f = geo.figure({ height: 1.7, seated: true });
      ctx.part(`CHR_${colour}_torso`, f.torso, colour, rig);
      ctx.part(`CHR_${colour}_head`, f.head, colour, rig);
      ctx.part(`CHR_${colour}_arms`, f.arms, colour, rig);
      ctx.part(`CHR_${colour}_legs`, f.legs, colour, rig);

      const chairRig = ctx.pivot(`PRP_chair_${colour}_rig`, pos, ctx.groups.PRP);
      chairRig.rotation.y = angle + Math.PI;
      ctx.part(`PRP_chair_${colour}`, geo.chair({ seatH: 0.48 }), 'slate', chairRig);
    };

    seat('green', 0);        // at +z, facing -z
    seat('red', Math.PI);    // across the table, facing +z
  },

  shots: [
    // SC01: wide turntable around the table. Hero is the table — in a wide this
    // close, the nearest character is *supposed* to graze the frame edge.
    {
      name: 'SC01_wide', from: 0, to: 120,
      focalLength: 32, easing: 'easeInOutSine',
      hero: 'PRP_table',
      // reframe adds `center` to BOTH position and target, so the move's own
      // target is zeroed — otherwise turntable's default [0,1,0] leaks in.
      move: reframe(
        moves.turntable({ radius: 4.4, pushIn: 0.95, arc: Math.PI * 1.2, target: [0, 0, 0] }),
        { center: [0, 0.72, 0] },
      ),
    },

    // SC02: over green's shoulder, pushing in on red. Hero is red's head — the
    // rest of the cast is supposed to leave frame here.
    {
      name: 'SC02_ots', from: 120, to: 180,
      focalLength: 58, easing: 'easeOutCubic',
      hero: 'CHR_red_head',
      move: handheld(
        reframe(
          moves.pushIn({ from: 2.6, to: 1.9, height: 0.25, target: [0, 0, 0] }),
          { center: [0, 1.05, 0.2] },
        ),
        { posAmp: 0.012, freq: 2.0 },
      ),
    },
  ],
});
