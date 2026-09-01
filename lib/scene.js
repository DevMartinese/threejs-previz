/**
 * scene.js — define a scene. No React, no JSX, no bundler.
 *
 * This module exists because of a hard constraint: **the audit gate has to be
 * able to import a real scene file in plain Node.** If `defineScene` lived in a
 * `.jsx` file that imports React and Remotion, `node auditScenes.mjs` cannot load
 * it, and the gate can only ever audit a hand-written stub — which is worth
 * nothing, because the thing you actually render is never the thing you checked.
 *
 * So the split is:
 *
 *   scene.js      the definition: id, size, palette, build, shots, audit()
 *                 plain ES modules — Node loads it directly
 *   remotion.jsx  the React component that renders a definition
 *
 * A scene file imports from here and stays loadable by both.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   // src/scenes/roundtable.js
 *   import { defineScene } from '../../lib/scene.js';
 *   import { moves, reframe } from '../../lib/cameraMoves.js';
 *
 *   export default defineScene({
 *     id: 'roundtable',
 *     fps: 30, height: 1080, aspect: 21 / 9, subjectSize: 2.5,
 *     identity: { grey: '#9a9a9a', wood: '#8a6136' },
 *     ignore: [['PRP_chair_*', 'CHR_*']],
 *     build: ({ ctx, geo }) => {
 *       ctx.part('ENV_floor', geo.disc({ radius: 8 }), 'grey', ctx.groups.ENV);
 *       ctx.part('PRP_table', geo.table({ radius: .9 }), 'wood', ctx.groups.PRP);
 *     },
 *     shots: [{ name: 'SC01', from: 0, to: 450, hero: 'PRP_table', move, easing }],
 *   });
 *
 *   // audit it, in Node, with no browser:
 *   //   node lib/auditScenes.mjs src/scenes/roundtable.js
 */

import * as blk from './blocking.js';
import * as geo from './geometry.js';
import { shotList, auditShots, formatReport } from './shots.js';
import { declareParams, paramDefaults, resolveParams } from './params.js';

/**
 * Describe a scene once. Everything downstream — the composition metadata, the
 * audit, the React component — is derived from this and never restated.
 */
export function defineScene({
  id,
  fps = 30,
  height = 1080,
  aspect = 21 / 9,
  width = null,
  subjectSize = 1,
  filmGauge = 36,
  focalLength = 50,
  background = '#3a3a3a',
  identity = {},
  shaded = true,
  params = {},
  build,
  shots,
  animate = null,
  visibility = [],
  ignore = [],
  floorIgnore = [],
  floorY = 0,
  attachments = [],
  exclude = ['ENV'],
}) {
  if (!id) throw new Error('defineScene: an id is required');
  if (typeof build !== 'function') throw new Error(`defineScene(${id}): build must be a function`);

  const w = width ?? Math.round(height * aspect);

  // The knobs, and the values that render when nothing is passed. Everything
  // below resolves through these, so a value that is not declared cannot reach
  // the scene from a URL, a slider or a stale shell command.
  const schema = declareParams(id, params);
  const defaults = paramDefaults(schema);
  const resolve = (over) => resolveParams(id, schema, over);

  /**
   * The shot list for a set of parameters. `shots` may be a function when a
   * knob moves the camera, which most of the interesting ones do.
   *
   * The DURATION may not vary. `durationInFrames` is composition metadata, read
   * before any props exist, so a parameter that shortened the list would render
   * frames past the end of the move — silently, as a freeze on the last pose.
   * A knob that wants a different length is a different scene.
   */
  let canonical = null;
  function listFor(p) {
    const raw = typeof shots === 'function' ? shots(p) : shots;
    const l = Array.isArray(raw) ? shotList(raw) : raw;
    if (!l || !l.duration) throw new Error(`defineScene(${id}): the shot list is empty`);
    if (canonical && l.duration !== canonical.duration)
      throw new Error(`defineScene(${id}): parameters changed the duration `
        + `(${canonical.duration} -> ${l.duration} frames). A knob may move the camera, `
        + `not the length of the piece — durationInFrames is fixed before props are read.`);
    return l;
  }
  const list = canonical = listFor(defaults);

  /**
   * Construct the scene. Pure — a fresh context every time, no module state
   * touched, so calling it twice (two workers, a film, the gate) is safe.
   *
   * The resolved parameters and the shot list they imply are attached to the
   * context, which is what every consumer already carries around. That is why
   * adding knobs did not change a single downstream signature: `ctx` was
   * always the scope, and the parameters are part of it.
   */
  function make(overrides) {
    const p = resolve(overrides);
    const ctx = blk.createBlocking({
      subjectSize, aspect: w / height, filmGauge, focalLength, background, shaded,
    });
    ctx.params = p;
    ctx.list = listFor(p);
    ctx.defineIdentity(identity);
    build({ ctx, blk, geo, groups: ctx.groups, scene: ctx.scene, camera: ctx.camera, p });
    return ctx;
  }

  /**
   * Put the scene in the state frame `n` requires. The ONE place object
   * motion is resolved, so the audit gate, the Remotion component and the
   * inspector cannot drift apart.
   */
  function pose(ctx, frame) {
    if (animate) animate({ ctx, frame, fps, p: ctx.params ?? defaults });
  }

  /**
   * Run every audit headlessly. No WebGL, no browser, no GPU: bounding
   * boxes, BVH intersection and NDC projection are all plain maths.
   *
   * `params` audits a variant. The gate has to accept them or the knobs would
   * be a way around it: you tune in the inspector, render with `--props`, and
   * nothing ever checks the shot you actually shipped.
   */
  function audit({ samples = 6, params: overrides = null } = {}) {
    const ctx = make(overrides);
    const list = ctx.list;
    for (const s of visibility) {
      const o = ctx.scene.getObjectByName(s.name);
      if (o) o.visible = true;
    }
    // `animate` is posed at every sampled frame, after the camera and before
    // the measurements — the audits measure the scene as it will render.
    const onFrame = animate ? (f) => pose(ctx, f) : null;
    const report = auditShots(ctx.scene, ctx.camera, list,
      { samples, ignore, exclude, onFrame, floorIgnore, floorY, subjectSize, attachments });
    return { id, report, ok: report.every((r) => r.ok), text: formatReport(report) };
  }

  return {
    id, fps, width: w, height, subjectSize, filmGauge,
    list, visibility, ignore, exclude, animate,
    params: schema, defaults, resolve, listFor,
    make, audit, pose,
    /**
     * Everything `<Composition>` needs except `component`, which comes from
     * `sceneComponent()` in remotion.jsx. `durationInFrames` is derived from the
     * shot list, so extending a shot cannot silently truncate the render.
     */
    compositionProps: {
      id,
      durationInFrames: list.duration,
      fps,
      width: w,
      height,
      // `--props='{"params":{...}}'` on the render command lands here. Empty by
      // default: the scene file's declared values are what renders, and a
      // command that passes nothing is the same render as no command at all.
      defaultProps: { params: {} },
    },
  };
}
