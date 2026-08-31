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
  build,
  shots,
  animate = null,
  visibility = [],
  ignore = [],
  floorIgnore = [],
  attachments = [],
  exclude = ['ENV'],
}) {
  if (!id) throw new Error('defineScene: an id is required');
  if (typeof build !== 'function') throw new Error(`defineScene(${id}): build must be a function`);

  const w = width ?? Math.round(height * aspect);
  const list = Array.isArray(shots) ? shotList(shots) : shots;
  if (!list || !list.duration) throw new Error(`defineScene(${id}): the shot list is empty`);

  /**
   * Construct the scene. Pure — a fresh context every time, no module state
   * touched, so calling it twice (two workers, a film, the gate) is safe.
   */
  function make() {
    const ctx = blk.createBlocking({
      subjectSize, aspect: w / height, filmGauge, focalLength, background, shaded,
    });
    ctx.defineIdentity(identity);
    build({ ctx, blk, geo, groups: ctx.groups, scene: ctx.scene, camera: ctx.camera });
    return ctx;
  }

  /**
   * Run every audit headlessly. No WebGL, no browser, no GPU: bounding
   * boxes, BVH intersection and NDC projection are all plain maths.
   */
  function audit({ samples = 6 } = {}) {
    const ctx = make();
    for (const s of visibility) {
      const o = ctx.scene.getObjectByName(s.name);
      if (o) o.visible = true;
    }
    // `animate` is posed at every sampled frame, after the camera and before
    // the measurements — the audits measure the scene as it will render.
    const onFrame = animate ? (f) => animate({ ctx, frame: f, fps }) : null;
    const report = auditShots(ctx.scene, ctx.camera, list,
      { samples, ignore, exclude, onFrame, floorIgnore, subjectSize, attachments });
    return { id, report, ok: report.every((r) => r.ok), text: formatReport(report) };
  }

  return {
    id, fps, width: w, height, subjectSize, filmGauge,
    list, visibility, ignore, exclude, animate,
    make, audit,
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
    },
  };
}
