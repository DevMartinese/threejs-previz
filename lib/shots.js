/**
 * shots.js — the bridge between a blocking scene and the camera-moves catalog.
 *
 * This file deliberately owns almost nothing. The two skills it joins already
 * have the pieces:
 *
 *   cameraMoves.js  the PATH   — `moves.orbit360()`, `dollyZoom()`, `handheld()`,
 *                                `reframe()`, the easing curves, and `applyState`,
 *                                which writes a CameraState onto a THREE camera.
 *   blocking.js     the SCENE  — geometry, identity, and the audits that measure
 *                                whether a shot works.
 *
 * What is left over, and all this file adds, is the **timeline**: which shot owns
 * which frame, and how a frame number becomes a `u` in [0,1]. That is the one
 * thing neither skill has, because `cameraMoves` thinks in seconds and blends
 * while an animatic thinks in frames and cuts.
 *
 *   frame ──► shot (hard cut) ──► u ──► easing ──► move(u) ──► applyState
 *
 * ---------------------------------------------------------------------------
 * REQUIRES `cameraMoves.js` from the `threejs-camera-moves` skill sitting
 * alongside this file. Copy it in; do not re-implement the moves here. If a move
 * you need is missing, it belongs in that catalog, not in this one.
 *
 * ---------------------------------------------------------------------------
 * QUICK START
 *
 *   import { moves, handheld, reframe } from './cameraMoves.js';
 *   import { shotList, applyFrame, auditShots } from './shots.js';
 *
 *   const shots = shotList([
 *     { name: 'SC01', from: 0,   to: 90,
 *       move: moves.turntable({ radius: .45, target: [0, .035, 0] }),
 *       easing: 'easeInOutSine', focalLength: 35 },
 *
 *     { name: 'SC02', from: 90,  to: 150,
 *       move: moves.dollyZoom({ dStart: .5, dEnd: .22, fovStart: 40 }),
 *       easing: 'easeInOutSine' },
 *
 *     { name: 'SC03', from: 150, to: 240,
 *       move: handheld(moves.pushIn({ from: .4, to: .25 }), { posAmp: .004 }),
 *       easing: 'easeOutCubic', focalLength: 85 },
 *   ]);
 *
 *   applyFrame(camera, shots, frame);        // pure: same frame -> same camera
 */

import { easings, applyState } from './cameraMoves.js';
import { subjectsOf, auditFraming, auditFloor, auditCollisions } from './blocking.js';

/**
 * A timeline of shots. Ranges are **half-open**: `{ from: 0, to: 60 }` owns
 * frames 0–59, and frame 60 belongs to the next shot. Cuts are hard — there is
 * no blending between shots, because an animatic is an edit, not a single move.
 */
export function shotList(shots) {
  const sorted = [...shots].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) {
      throw new Error(`shots overlap: "${sorted[i - 1].name}" and "${sorted[i].name}"`);
    }
  }
  return {
    shots: sorted,
    get duration() { return sorted.length ? sorted[sorted.length - 1].to : 0; },

    /** The shot that owns this frame. Clamps outside the timeline. */
    at(frame) {
      for (const s of sorted) if (frame >= s.from && frame < s.to) return s;
      if (!sorted.length) return null;
      return frame < sorted[0].from ? sorted[0] : sorted[sorted.length - 1];
    },

    /** Progress within the owning shot, in [0,1]. */
    progress(frame) {
      const s = this.at(frame);
      if (!s) return 0;
      const span = Math.max(1, s.to - s.from);
      return Math.min(Math.max((frame - s.from) / span, 0), 1);
    },

    /** Frames to sample when auditing a shot — never the boundary frame. */
    samplesFor(shot, n = 5) {
      const last = Math.max(shot.from, shot.to - 1);
      return Array.from({ length: n }, (_, i) =>
        Math.round(shot.from + (last - shot.from) * (i / Math.max(1, n - 1))));
    },
  };
}

/**
 * Resolve a frame and write the result onto the camera.
 *
 * Pure by construction: it reads only `frame`, never a clock and never previous
 * state, so it produces the same camera whether called in order, out of order or
 * twice. That is the contract Remotion needs, since it renders frames across
 * workers in no particular order.
 *
 * Per-shot `focalLength` (mm) is applied after the move's `fov`, so a shot can be
 * specified the way a DP would — "this one's on an 85" — while the move stays
 * expressed in FOV. Set `camera.filmGauge = 36` to match a Blender / full-frame
 * lens exactly.
 */
export function applyFrame(camera, list, frame, { easings: extra = {} } = {}) {
  const shot = list.at(frame);
  if (!shot) return null;

  const ease = typeof shot.easing === 'function'
    ? shot.easing
    : (extra[shot.easing] || easings[shot.easing] || easings.linear);

  const state = shot.move(ease(list.progress(frame)));
  applyState(camera, { target: [0, 0, 0], ...state });

  if (shot.focalLength) {
    camera.setFocalLength(shot.focalLength);
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  return shot;
}

/**
 * Run the three audits across every shot, at the frames that matter.
 *
 * Two scopes, and getting them right is what makes the report worth reading:
 *
 *   COLLISIONS run on all **subjects** — scenery is excluded, because floors and
 *   walls are meant to be touched by everything resting on them. Declare
 *   intentional contact with wildcards: `ignore: [['PRP_chair_*','CHR_*']]`.
 *
 *   FRAMING runs on the shot's **hero** only. In an over-the-shoulder or a
 *   close-up, everything else is *supposed* to leave frame; measuring against all
 *   subjects there reports enormous overshoot for a shot that is perfectly
 *   composed. Give each shot a `hero` (name or wildcard, or a list) and the audit
 *   answers the question you actually care about: "is the hero always in frame?"
 *   Without one it falls back to every subject, which is right for a wide.
 */
export function auditShots(scene, camera, list, {
  samples = 5, ignore = [], exclude = ['ENV'], onFrame = null,
} = {}) {
  const report = [];
  for (const shot of list.shots) {
    let framing = null, floor = null;
    const collisions = [];

    const heroes = shot.hero ? [].concat(shot.hero).map(globToRe) : null;

    for (const f of list.samplesFor(shot, samples)) {
      applyFrame(camera, list, f);
      if (onFrame) onFrame(f, shot);
      const meshes = subjectsOf(scene, { exclude }).filter((m) => m.visible);
      const framed = heroes
        ? meshes.filter((m) => heroes.some((re) => re.test(m.name)))
        : meshes;

      const fr = auditFraming(framed, camera);
      if (!framing || fr.overshoot > framing.overshoot) framing = { ...fr, frame: f };

      const fl = auditFloor(meshes);
      if (!floor || fl.minY < floor.minY) floor = { ...fl, frame: f };

      for (const hit of auditCollisions(meshes, { ignore })) {
        if (!collisions.some((c) => c.a === hit.a && c.b === hit.b)) {
          collisions.push({ ...hit, frame: f });
        }
      }
    }
    report.push({
      shot: shot.name,
      frames: [shot.from, shot.to],
      hero: shot.hero || null,
      framing, floor, collisions,
      ok: framing.ok && floor.ok && collisions.length === 0,
    });
  }
  return report;
}

/** `'CHR_*'` -> RegExp, so heroes and ignore-pairs can be declared by pattern. */
function globToRe(glob) {
  return new RegExp('^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                      .replace(/\*/g, '.*') + '$');
}

/** One-line pass/fail summary for a report from `auditShots`. */
export function formatReport(report) {
  return report.map((r) => {
    const bits = [`${r.shot} [${r.frames[0]}-${r.frames[1]})`];
    bits.push(`framing ${r.framing.overshoot.toFixed(3)}` +
              (r.hero ? ` [hero ${[].concat(r.hero).join(',')}]` : '') +
              (r.framing.ok ? '' : ` <${r.framing.worstObject} @f${r.framing.frame}>`));
    if (!r.floor.ok) bits.push(`floor ${r.floor.minY.toFixed(4)} <${r.floor.worstObject}>`);
    if (r.collisions.length) bits.push(`collisions ${r.collisions.map((c) => `${c.a}x${c.b}`).join(',')}`);
    return `${r.ok ? 'ok  ' : 'FAIL'} ${bits.join('  ')}`;
  }).join('\n');
}

export { easings };
