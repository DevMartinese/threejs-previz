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

import { Vector3, Box3 } from 'three';
import { easings, applyState } from './cameraMoves.js';
import {
  subjectsOf, meshesOf, auditFraming, auditFloor, auditCollisions,
  auditOcclusion, auditCameraClearance, inFrustum, isOccluded,
} from './blocking.js';

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
    if (sorted[i].from > sorted[i - 1].to) {
      // A frame in a gap has no owner and silently resolves to the wrong
      // camera. An editorial gap is a shot too — declare it explicitly.
      throw new Error(
        `timeline gap: "${sorted[i - 1].name}" ends at ${sorted[i - 1].to} but `
        + `"${sorted[i].name}" starts at ${sorted[i].from} — every frame needs an `
        + `owner; declare an explicit placeholder shot for an editorial gap`);
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
 * Run every audit across every shot, at the frames that matter: collisions,
 * framing, floor, occlusion and camera clearance at sampled frames, plus a
 * full-frame-rate continuity sweep (pops and teleports).
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
  floorIgnore = [], floorY = 0, subjectSize = 1, clearance = null, attachments = [],
} = {}) {
  const report = [];
  const pose = (f, shot) => { applyFrame(camera, list, f); if (onFrame) onFrame(f, shot); };
  // Translucent things don't block a sightline; everything else opaque does —
  // scenery included, because a hero behind a wall is exactly the finding.
  const sightBlockers = () => meshesOf(scene).filter((m) =>
    m.visible && !(m.material && m.material.transparent && m.material.opacity < 0.5));

  let prevPathEnd = null;
  for (const shot of list.shots) {
    let framing = null, floor = null, occlusion = null, clear = null, attach = null;
    const collisions = [];
    const sampleFrames = list.samplesFor(shot, samples);
    const lastSample = sampleFrames[sampleFrames.length - 1];

    const heroes = shot.hero ? [].concat(shot.hero).map(globToRe) : null;
    const occCfg = shot.occlusion === false || !heroes || !heroes.length ? null
      : { max: 0.2, ignore: [],
          ...(typeof shot.occlusion === 'number' ? { max: shot.occlusion } : (shot.occlusion || {})) };
    const occSkip = occCfg ? occCfg.ignore.map(globToRe) : [];

    for (const f of sampleFrames) {
      pose(f, shot);
      const meshes = subjectsOf(scene, { exclude }).filter((m) => m.visible);
      const framed = heroes
        ? meshes.filter((m) => heroes.some((re) => re.test(m.name)))
        : meshes;

      const fr = auditFraming(framed, camera);
      if (!framing || fr.overshoot > framing.overshoot) framing = { ...fr, frame: f };

      const fl = auditFloor(meshes, { y: floorY, ignore: floorIgnore });
      if (!floor || fl.minY < floor.minY) floor = { ...fl, frame: f };

      for (const hit of auditCollisions(meshes, { ignore })) {
        if (!collisions.some((c) => c.a === hit.a && c.b === hit.b)) {
          collisions.push({ ...hit, frame: f });
        }
      }

      // OCCLUSION: the framing audit proves the hero is inside the frame;
      // this proves the camera can actually SEE it — "nobody blocks cyan at
      // the end", measured. Runs only on declared heroes; intentional
      // blockers (a near mass crossing, floating ice) are declared per shot:
      // `occlusion: { ignore: ['PRP_ice_*'] }`, or `occlusion: false`.
      if (occCfg) {
        const blockers = sightBlockers().filter((b) => !occSkip.some((re) => re.test(b.name)));
        for (const hero of framed) {
          const oc = auditOcclusion(hero, blockers, camera);
          if (!occlusion || oc.fraction > occlusion.fraction) {
            occlusion = { ...oc, hero: hero.name, frame: f };
          }
        }
        if (occlusion) occlusion.ok = occlusion.fraction <= occCfg.max;
      }

      // ATTACHMENTS: declared connections, measured — "the ribbon hangs from
      // the cup's MOUTH", "the last droplet sits on the cup's lip". Each
      // entry joins a local-space point on `a` to one on `b`; the audit
      // checks their world distance whenever both are visible (posed through
      // the scene graph, scale and rotation included). `settle: true` checks
      // only at the shot's last sampled frame — for connections a move is
      // still reaching for. A prop chain declared here cannot silently pour
      // out of the belly of anything.
      for (const at of attachments) {
        const A = scene.getObjectByName(at.a), B = scene.getObjectByName(at.b);
        if (!A || !B || !A.visible || !B.visible) continue;
        if (at.settle && f !== lastSample) continue;
        A.updateWorldMatrix(true, false);
        B.updateWorldMatrix(true, false);
        const pa = A.localToWorld(new Vector3(...(at.aLocal ?? [0, 0, 0])));
        const pb = B.localToWorld(new Vector3(...(at.bLocal ?? [0, 0, 0])));
        const tol = at.tol ?? subjectSize * 0.05;
        const d = pa.distanceTo(pb);
        if (!attach || d - tol > attach.distance - attach.tol) {
          attach = { a: at.a, b: at.b, distance: d, tol, frame: f, ok: d <= tol };
        }
      }

      // CAMERA CLEARANCE: exact BVH distance from the camera to everything
      // visible (scenery included). Closer than the near plane clips a hole
      // through the object; "the camera touches nothing" is now measured,
      // not promised. Override per shot with `clearance: <metres>`.
      const cl = auditCameraClearance(meshesOf(scene), camera,
        { min: shot.clearance ?? clearance ?? camera.near });
      if (!clear || cl.distance < clear.distance) clear = { ...cl, frame: f };
    }

    const continuity = auditContinuity(scene, camera, list, shot,
      { exclude, pose, subjectSize, sightBlockers });

    // BOUNDARIES: a hard cut is supposed to jump, so the step across a shot
    // boundary is informational — unless the shot declares `joins: true`
    // (several entries playing slices of ONE continuous move), in which case
    // the splice is enforced: position within 3x the median step, direction
    // within 10 degrees.
    let join = null;
    const cp = continuity.cameraPath;
    if (prevPathEnd && cp.first) {
      const dPos = prevPathEnd.p.distanceTo(cp.first.p);
      const dAng = (prevPathEnd.dir.angleTo(cp.first.dir) * 180) / Math.PI;
      join = { dPos, dAng, enforced: !!shot.joins,
               ok: !shot.joins
                 || (dPos <= Math.max(3 * cp.medStep, subjectSize * 0.02) && dAng <= 10) };
    }
    prevPathEnd = cp.last;

    report.push({
      shot: shot.name,
      frames: [shot.from, shot.to],
      hero: shot.hero || null,
      framing, floor, collisions, occlusion, clearance: clear, continuity, attach, join,
      ok: framing.ok && floor.ok && collisions.length === 0
        && (!occlusion || occlusion.ok) && clear.ok && continuity.ok
        && (!attach || attach.ok) && (!join || join.ok),
    });
  }
  return report;
}

/**
 * CONTINUITY: nothing appears from thin air, vanishes into it, or teleports —
 * on screen. The one class of error the sampled audits can never see, because
 * it lives between frames. Swept at full frame rate (cheap: no BVH, position
 * and visibility only), then the few suspicious frames get the expensive
 * frustum and sightline checks.
 *
 * What is automatically legitimate, with no declaration needed:
 *   - appearing/vanishing OUTSIDE the frustum (entering from off-screen);
 *   - appearing/vanishing while OCCLUDED (a clone emerging from inside the
 *     can, a ball sinking under the water, an actor stepping out from a wall);
 *   - a SWAP: one mesh replaced by others in the same place on the same frame
 *     (a can swapped for its CSG slices) — overlapping boxes excuse each other;
 *   - anything across a cut (shots own their own frames).
 * Anything else is a finding. Escape hatch per shot: `pops: ['PRP_debris_*']`.
 */
function auditContinuity(scene, camera, list, shot,
  { exclude, pose, subjectSize, sightBlockers }) {
  const rec = new Map();     // name -> { mesh, vis: [bool], pos: [Vector3|null] }
  const camPos = [], camDir = [];
  for (let f = shot.from; f < shot.to; f++) {
    pose(f, shot);
    camPos.push(camera.position.clone());
    camDir.push(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    for (const m of subjectsOf(scene, { exclude })) {
      let r = rec.get(m.name);
      if (!r) { r = { mesh: m, vis: [], pos: [] }; rec.set(m.name, r); }
      r.vis.push(m.visible);
      r.pos.push(m.visible ? m.getWorldPosition(new Vector3()) : null);
    }
  }

  // CAMERA PATH: the orbit-jump class of bug. A discontinuous path — an
  // angle wrap, a window past its end — reads on screen as the camera
  // passing through objects and reappearing elsewhere. Continuous motion
  // advances by roughly the same amount each frame, so any step wildly
  // larger than the shot's median (position) or an isolated whip far beyond
  // the shot's own turning rate (direction) is a finding. Thresholds tuned
  // against a real close fly-by (1.35x median step, 12deg/frame smooth
  // whip): 5x median / max(5x angular median, 15deg) never flags it; a
  // half-turn wrap always does. Never smooth or clamp past this — fix the
  // path.
  const camJumps = [];
  const steps = [], angs = [];
  for (let i = 1; i < camPos.length; i++) {
    steps.push(camPos[i].distanceTo(camPos[i - 1]));
    angs.push((camDir[i].angleTo(camDir[i - 1]) * 180) / Math.PI);
  }
  const median = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  const medStep = median(steps), medAng = median(angs);
  for (let i = 0; i < steps.length; i++) {
    const badPos = steps[i] > Math.max(5 * medStep, subjectSize * 0.05);
    const badAng = angs[i] > Math.max(5 * medAng, 15);
    if ((badPos || badAng) && camJumps.length < 8) {
      camJumps.push({ frame: shot.from + i + 1,
                      step: steps[i], angle: angs[i] });
    }
  }
  const cameraPath = {
    jumps: camJumps, medStep,
    first: { p: camPos[0], dir: camDir[0] },
    last: { p: camPos[camPos.length - 1], dir: camDir[camDir.length - 1] },
    ok: camJumps.length === 0,
  };
  const allowed = (shot.pops || []).map(globToRe);
  const pops = [], teleports = [];

  // visibility transitions, grouped per frame boundary so swaps can excuse
  const events = [];
  for (const [name, r] of rec) {
    for (let i = 1; i < r.vis.length; i++) {
      if (r.vis[i] !== r.vis[i - 1]) events.push({ name, mesh: r.mesh, i, appear: r.vis[i] });
    }
  }
  const boxAt = (mesh, f) => { pose(f, shot); return new Box3().setFromObject(mesh); };
  for (const e of events) {
    if (allowed.some((re) => re.test(e.name))) continue;
    // a child whose visibility flips together with an ancestor's (a lid on a
    // can) is not its own finding — the ancestor is the one being judged
    let inherited = false;
    for (let p = e.mesh.parent; p && !inherited; p = p.parent) {
      inherited = events.some((o) => o.mesh === p && o.i === e.i);
    }
    if (inherited) continue;
    const fVisible = shot.from + (e.appear ? e.i : e.i - 1);
    // swap: an opposite transition on the same boundary whose box overlaps
    const swap = events.some((o) => o !== e && o.i === e.i && o.appear !== e.appear
      && boxAt(o.mesh, shot.from + (o.appear ? o.i : o.i - 1))
           .intersectsBox(boxAt(e.mesh, fVisible)));
    if (swap) continue;
    pose(fVisible, shot);
    if (!inFrustum(e.mesh, camera)) continue;
    const blockers = sightBlockers().filter((b) => b !== e.mesh);
    if (e.appear) e.mesh.visible = true;          // judge the frame it exists on
    if (isOccluded(e.mesh, blockers, camera)) continue;
    if (pops.length < 8) pops.push({ name: e.name, frame: fVisible, kind: e.appear ? 'in' : 'out' });
  }

  // teleports: a step wildly larger than its neighbours, while on screen
  for (const [name, r] of rec) {
    const step = (i) => (r.pos[i] && r.pos[i - 1]) ? r.pos[i].distanceTo(r.pos[i - 1]) : null;
    for (let i = 1; i < r.vis.length; i++) {
      const s = step(i);
      if (s === null || s < subjectSize * 0.05) continue;
      const prev = step(i - 1) ?? 0, next = step(i + 1) ?? 0;
      const ref = Math.max(prev, next, subjectSize * 0.002);
      if (s < 8 * ref) continue;
      const f = shot.from + i;
      pose(f, shot);
      const seen = inFrustum(r.mesh, camera)
        || (pose(f - 1, shot), inFrustum(r.mesh, camera));
      if (seen && teleports.length < 8) teleports.push({ name, frame: f, step: s });
    }
  }
  return { pops, teleports, cameraPath,
           ok: pops.length === 0 && teleports.length === 0 && cameraPath.ok };
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
    if (r.occlusion && !r.occlusion.ok) {
      bits.push(`occlusion ${r.occlusion.fraction.toFixed(2)} of ${r.occlusion.hero}`
        + ` <${r.occlusion.blocker} @f${r.occlusion.frame}>`);
    }
    if (r.clearance && !r.clearance.ok) {
      bits.push(`camera ${r.clearance.distance.toFixed(4)} < ${r.clearance.min.toFixed(4)}`
        + ` <${r.clearance.object} @f${r.clearance.frame}>`);
    }
    if (r.continuity && r.continuity.pops.length) {
      bits.push(`pops ${r.continuity.pops.map((p) => `${p.name}@f${p.frame}(${p.kind})`).join(',')}`);
    }
    if (r.attach && !r.attach.ok) {
      bits.push(`attach ${r.attach.a}<->${r.attach.b} ${r.attach.distance.toFixed(4)}`
        + ` > ${r.attach.tol.toFixed(4)} @f${r.attach.frame}`);
    }
    if (r.continuity && r.continuity.cameraPath && r.continuity.cameraPath.jumps.length) {
      bits.push(`camera ${r.continuity.cameraPath.jumps.map((j) =>
        `jump ${j.step.toFixed(3)}m/${j.angle.toFixed(1)}deg@f${j.frame}`).join(',')}`);
    }
    if (r.join && !r.join.ok) {
      bits.push(`join<-prev ${r.join.dPos.toFixed(4)}m/${r.join.dAng.toFixed(1)}deg`);
    }
    if (r.continuity && r.continuity.teleports.length) {
      bits.push(`teleports ${r.continuity.teleports.map((t) => `${t.name}@f${t.frame}(${t.step.toFixed(3)})`).join(',')}`);
    }
    return `${r.ok ? 'ok  ' : 'FAIL'} ${bits.join('  ')}`;
  }).join('\n');
}

export { easings };
