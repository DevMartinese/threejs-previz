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
import { moves, retarget, handheld, drift, slice } from '../../lib/cameraMoves.js';

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
export const headPos = (colour, r = SEAT_R) => polar(SEATS[colour], r, 1.216);

/**
 * The knobs that belong to the ROOM rather than to a camera.
 *
 * They are exported because `build` is: opening.js reuses this room wholesale,
 * and a build that reads a parameter its scene never declared would get
 * `undefined` and quietly produce NaN geometry. A shared build means a shared
 * declaration — spread this into any scene that borrows it.
 */
export const roomParams = {
  seatRadius: { value: SEAT_R, min: 1.05, max: 1.9, step: 0.01, unit: 'm',
    label: 'seat circle',
    note: 'everything derives from this — the figures, the chairs and the heads the gaze hands off between' },
  tableRadius: { value: TABLE_R, min: 0.5, max: 1.4, step: 0.02, unit: 'm',
    label: 'table radius',
    note: 'the tabletop is the wide shot\'s hero, so widening it tightens the framing margin' },
};

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
  ['PRP_table_*', 'PRP_table_*'],   // top sits on leg sits on base
  ...Object.keys(SEATS).map((c) => [`CHR_${c}_torso`, `CHR_${c}_*`]),
];

/** The room + cast. Shared by every scene/vista built on this blocking. */
export function build({ ctx, geo, p }) {
  const seatR = p.seatRadius, tableR = p.tableRadius;
  // The interior: neutral grey floor and a round wall so the space reads.
  ctx.part('ENV_floor', geo.disc({ radius: 4.5 }), 'grey', ctx.groups.ENV);
  ctx.part('ENV_wall', geo.wall({ radius: 4.5, height: 3, thickness: 0.06 }),
           'grey', ctx.groups.ENV);

  // The table in three parts rather than geo.table()'s single merge, so the
  // TOP can be a framing hero on its own. "The table always in frame" really
  // means the tabletop and the hands — an orbit that lets the pedestal's base
  // slip out of the bottom of frame is normal cinematography, and a hero that
  // includes the base fails the audit for the wrong reason. Same logic as
  // figure() keeping the head separate.
  const top = ctx.part('PRP_table_top',
    geo.cone({ rBottom: tableR, rTop: tableR, h: 0.04 }), 'wood');
  top.position.y = TABLE_H - 0.02;
  const leg = ctx.part('PRP_table_leg',
    geo.cone({ rBottom: 0.07, rTop: 0.07, h: TABLE_H - 0.04 }), 'wood');
  leg.position.y = (TABLE_H - 0.04) / 2;
  const base = ctx.part('PRP_table_base',
    geo.cone({ rBottom: tableR * 0.36, rTop: tableR * 0.36, h: 0.03 }), 'wood');
  base.position.y = 0.015;

  // One seated character per identity colour: a rig pivot on the seat circle,
  // turned to face the table. Heads are separate parts on purpose — a head is a
  // framing hero in a way a whole body cannot be. Hands rest toward the table
  // (figure() puts a seated figure's arms forward).
  for (const [colour, angle] of Object.entries(SEATS)) {
    const pos = polar(angle, seatR);
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

/* -------------------------------------------------------------- the cuts --
 * 24 fps, 21:9, 30 seconds, four cuts. Cuts are hard by construction: shot
 * ranges are half-open, so [0, 360) owns frames 0–359 and frame 360 already
 * belongs to the next shot — camera, target and lens all change ON the cut,
 * not a single transition frame.
 *
 * An over-the-shoulder camera: behind a character's seat, azimuth offset to
 * one side so the gaze clears their head, below shoulder height.
 */
const otsCrawl = (behind, { offset = 12, crawl = 3, r = 2.05, y = 0.92 } = {}) => {
  const a = SEATS[behind] + offset;
  return { from: polar(a, r, y), to: polar(a + crawl, r, y) };
};

/* Real handheld, not wiggle: a lazy body sway in long waves on the camera plus
 * a very small tremor, and on the target a slow drift with breathing — the
 * operator's body and the operator's attention as separate layers. `seconds`
 * is the shot length, so the wave frequencies read in Hz. No fast jitter
 * anywhere: the sway sits at ~0.2 Hz, the tremor at ~1.5 Hz and millimetres. */
// `g` scales all four layers together — the one knob for "how alive is the
// operator". Scaling them TOGETHER is deliberate: what makes this read as a
// person rather than as wiggle is the ratio between the slow sway and the fast
// tremor, and a panel with four independent sliders is a panel that invites
// you to break it. At 0 the move is locked off, which is the honest way to see
// what the handheld is actually contributing.
const alive = (move, seconds, g = 1, { sway = 0.018, driftAmp = 0.012,
                                       breathe = 0.008, tremor = 0.003 } = {}) =>
  handheld(
    handheld(
      drift(move, { duration: seconds, amp: driftAmp * g, freq: 0.16,
                    breathe: breathe * g, breatheFreq: 0.24 }),
      { duration: seconds, posAmp: sway * g, rotAmp: 0.006 * g, freq: 0.2 },
    ),
    { duration: seconds, posAmp: tremor * g, rotAmp: 0.002 * g, freq: 1.5 },
  );

export default defineScene({
  id: 'roundtable',
  fps: 24,
  height: 720,
  aspect: 21 / 9,
  subjectSize: 2.5,
  identity,
  ignore,
  params: {
    ...roomParams,
    handheld: { value: 1, min: 0, max: 3, step: 0.05, unit: '×',
      note: 'scales the operator — sway, drift, breathing and tremor together. 0 is locked off' },
    orbitRadius: { value: 3.0, min: 2.2, max: 4.2, step: 0.05, unit: 'm',
      note: 'the wide orbit. Tuned against the audit twice: at 2.7 the tabletop left frame at f144' },
    orbitHeight: { value: 1.2, min: 0.6, max: 2.4, step: 0.05, unit: 'm' },
    orbitArc: { value: 110, min: 40, max: 200, step: 5, unit: 'deg',
      note: 'starts behind red and passes behind cyan; a wider arc keeps going past purple' },
    otsRadius: { value: 2.05, min: 1.6, max: 2.8, step: 0.05, unit: 'm',
      label: 'OTS radius' },
    otsOffset: { value: 12, min: 4, max: 28, step: 1, unit: 'deg',
      label: 'OTS offset',
      note: 'azimuth off the shoulder. Too small and the shot is through the head, not over it — the occlusion audit is what catches that' },
    otsFocal: { value: 55, min: 35, max: 85, step: 1, unit: 'mm', label: 'OTS lens' },
  },
  build,
  shots: (p) => [
    // 1 — slow orbit, camera slightly above the table, wide lens. Starts behind
    // red, passes behind cyan mid-arc, stops short of purple (arc 110°). The
    // gaze hands off face to face across the table — yellow → blue → green —
    // easing on each leg, so it slows on every face without stopping. Hero is
    // the table: at this radius a whole person does not fit vertically, and
    // that is geometry, not a mistake.
    { name: 'SC01_orbit', from: 0, to: 360, focalLength: 24, easing: 'linear',
      hero: 'PRP_table_top',
      // "We only pass behind red at the start and cyan in the middle" — the
      // orbit eclipsing the table behind the cast is the shot, declared.
      occlusion: { ignore: ['CHR_*', 'PRP_chair_*'] },
      // radius/height tuned against the audit, twice: at r 2.7 the table left
      // frame by 0.752 @f144, and at r 3.4 still by 0.414 — because the hero
      // was the WHOLE table, pedestal base included, and no orbit that looks
      // at faces keeps the floor in frame. The real statement is "the
      // tabletop always in frame", hence hero PRP_table_top.
      // Handheld a touch livelier here than in the dialogue cuts.
      move: alive(
        retarget(
          moves.orbit360({ radius: p.orbitRadius, height: p.orbitHeight,
                           startAngle: 0, arc: rad(p.orbitArc) }),
          { targets: [headPos('yellow', p.seatRadius), headPos('blue', p.seatRadius),
                      headPos('green', p.seatRadius)] },
        ),
        15, p.handheld, { sway: 0.032, driftAmp: 0.045, breathe: 0.014, tremor: 0.0045 },
      ) },

    // 2 — cyan over blue's shoulder, ~3 s. Below shoulder height, barely
    // crawling sideways, handheld completely lazy. Everyone else is supposed
    // to leave frame: hero cyan.
    { name: 'SC02_ots_cyan', from: 360, to: 432, focalLength: p.otsFocal, easing: 'linear',
      hero: 'CHR_cyan_head',
      move: alive(moves.truck({ ...otsCrawl('blue', { offset: p.otsOffset, r: p.otsRadius }),
                                target: headPos('cyan', p.seatRadius) }), 3, p.handheld) },

    // 3 — red over yellow's shoulder, 2.5 s, crawling the same way.
    { name: 'SC03_ots_red', from: 432, to: 492, focalLength: p.otsFocal, easing: 'linear',
      hero: 'CHR_red_head',
      move: alive(moves.truck({ ...otsCrawl('yellow', { offset: p.otsOffset, r: p.otsRadius }),
                                target: headPos('red', p.seatRadius) }), 2.5, p.handheld) },

    // 4 — purple over green's shoulder, long. Halfway through, the gaze slides
    // along the eyeline to cyan without a cut and ends there. ONE continuous
    // crawl at constant speed, declared as three shot entries because the
    // framing question changes mid-cut: purple owns the first half, the slide
    // itself is transitional (hero: [] — collisions and floor still audited,
    // framing waived), and cyan owns the end. The boundaries are invisible on
    // screen: linear move, same crawl speed, gaze eased within the slide.
    //
    // The position is geometry, worked out against stills, not taste: green
    // stays the near mass while the cut ends on cyan only if the camera sits
    // on the cyan→green line extended (offset -12° from green's seat), which
    // puts green dead on the end gaze — so the camera rides above green's
    // head (y 1.5) and the gaze clears it vertically. The 40mm keeps green's
    // head inside the bottom of frame; on a 50 it drops out. Offsetting to a
    // low shoulder instead swings green out of frame as the gaze slides, and
    // red's arm crosses in front of cyan — both checked, both worse.
    // The whole cut is ONE move — crawl, gaze waypoints (hold purple, slide,
    // hold cyan, matching the three entries exactly) and the handheld layers
    // share a single time base, then each entry plays its slice. That is what
    // keeps the entry boundaries invisible: the noise never restarts.
    ...(() => {
      const whole = alive(
        retarget(
          moves.truck(otsCrawl('green', { offset: -13, crawl: 2, r: 2.13, y: 1.5 })),
          { targets: [headPos('purple', p.seatRadius), headPos('purple', p.seatRadius),
                      headPos('cyan', p.seatRadius), headPos('cyan', p.seatRadius)] },
        ),
        9.5, p.handheld, { sway: 0.016, driftAmp: 0.01, breathe: 0.009, tremor: 0.0025 },
      );
      return [
        { name: 'SC04a_ots_purple', from: 492, to: 568, focalLength: 40,
          easing: 'linear', hero: 'CHR_purple_head', move: slice(whole, 0, 1 / 3) },
        { name: 'SC04b_slide', from: 568, to: 644, focalLength: 40,
          easing: 'linear', hero: [], joins: true, move: slice(whole, 1 / 3, 2 / 3) },
        { name: 'SC04c_end_cyan', from: 644, to: 720, focalLength: 40,
          easing: 'linear', hero: 'CHR_cyan_head', joins: true, move: slice(whole, 2 / 3, 1) },
      ];
    })(),
  ],
});
