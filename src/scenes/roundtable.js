/**
 * roundtable.js — six characters at a round table. The flagship scene, built the
 * way the pipeline is meant to be used: in stages, each stage audited before the
 * next is layered on, one git commit per stage as the backup.
 *
 *   stage 1  BLOCKING   table, chairs, six seated proxies, floor + round wall.
 *                       Shots are static views (wide / top / side) — the check
 *                       is "does the room read", not cinematography.
 *
 * Colour is identity: red, green, blue, yellow, purple, cyan ARE the characters.
 * "cyan over blue's shoulder" is an unambiguous stage direction because the
 * palette is the cast list.
 */
import { defineScene } from '../../lib/scene.js';

/* ---------------------------------------------------------------- layout --
 * Seats every 60°, assigned so that every over-the-shoulder pair in the shot
 * list sits face to face across the table:
 *
 *   red 0°        — orbit starts behind red
 *   cyan 60°      — orbit passes behind cyan mid-arc
 *   purple 120°
 *   yellow 180°   — across from red
 *   blue 240°     — across from cyan
 *   green 300°    — across from purple
 */
export const SEAT_R = 1.32;           // seat circle; table top is r 0.9
export const TABLE_R = 0.9;
export const TABLE_H = 0.72;
export const SEATS = {
  red: 0, cyan: 60, purple: 120, yellow: 180, blue: 240, green: 300,
};

const rad = (d) => (d * Math.PI) / 180;

/** World position on a circle, matching cameraMoves' spherical(): 0° -> +z. */
export const polar = (angleDeg, r, y = 0) =>
  [Math.sin(rad(angleDeg)) * r, y, Math.cos(rad(angleDeg)) * r];

/** A character's head centre in world space — the thing shots target. */
export const headPos = (colour) => polar(SEATS[colour], SEAT_R, 1.216);

export const identity = {
  grey: '#9a9a9a',
  wood: '#8a6136',
  slate: '#5a6570',
  red: '#c0392b',
  green: '#27ae60',
  blue: '#2980d9',
  yellow: '#f1c40f',
  purple: '#8e44ad',
  cyan: '#1abcb4',
};

/* Contact by design, declared rather than hidden: everyone sits on a chair, and
 * each figure's own parts (head on torso, legs on torso) touch by construction.
 * Declared per character so a red×green collision still counts. */
export const ignore = [
  ['PRP_chair_*', 'CHR_*'],
  ...Object.keys(SEATS).map((c) => [`CHR_${c}_torso`, `CHR_${c}_*`]),
];

/** The room + cast. Shared by every scene/vista built on this blocking. */
export function build({ ctx, geo }) {
  // The interior: neutral grey floor and a round wall so the space reads.
  ctx.part('ENV_floor', geo.disc({ radius: 4.5 }), 'grey', ctx.groups.ENV);
  ctx.part('ENV_wall', geo.wall({ radius: 4.5, height: 3, thickness: 0.06 }),
           'grey', ctx.groups.ENV);

  ctx.part('PRP_table', geo.table({ radius: TABLE_R, height: TABLE_H }),
           'wood', ctx.groups.PRP);

  // One seated character per identity colour: a rig pivot on the seat circle,
  // turned to face the table. Heads are separate parts on purpose — a head is a
  // framing hero in a way a whole body cannot be. Hands rest toward the table
  // (figure() puts a seated figure's arms forward).
  for (const [colour, angle] of Object.entries(SEATS)) {
    const pos = polar(angle, SEAT_R);
    const rig = ctx.pivot(`CHR_${colour}_rig`, pos, ctx.groups.CHR);
    rig.rotation.y = rad(angle) + Math.PI;       // figures face +z locally

    const f = geo.figure({ height: 1.7, seated: true });
    ctx.part(`CHR_${colour}_torso`, f.torso, colour, rig);
    ctx.part(`CHR_${colour}_head`, f.head, colour, rig);
    ctx.part(`CHR_${colour}_arms`, f.arms, colour, rig);
    ctx.part(`CHR_${colour}_legs`, f.legs, colour, rig);

    const chairRig = ctx.pivot(`PRP_chair_${colour}_rig`, pos, ctx.groups.PRP);
    chairRig.rotation.y = rad(angle) + Math.PI;
    ctx.part(`PRP_chair_${colour}`, geo.chair({ seatH: 0.48 }), 'slate', chairRig);
  }
}

/* ------------------------------------------------------------- the scene --
 * 24 fps, 21:9, 30 seconds. Stage 1 ships static blocking views; the camera
 * stage replaces them with the real cuts.
 */
const hold = (position, target, fov = 40) => () => ({ position, target, fov, roll: 0 });

export default defineScene({
  id: 'roundtable',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  build,
  shots: [
    { name: 'V01_wide', from: 0, to: 240, easing: 'linear', hero: 'PRP_table',
      move: hold([0, 2.2, 4.1], [0, 0.7, 0]) },
    { name: 'V02_top', from: 240, to: 480, easing: 'linear', hero: 'PRP_table',
      move: hold([0, 4.2, 0.01], [0, 0, 0], 60) },
    { name: 'V03_side', from: 480, to: 720, easing: 'linear', hero: 'PRP_table',
      move: hold([3.4, 1.0, 0], [0, 0.75, 0]) },
  ],
});
