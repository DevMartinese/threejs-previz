/**
 * remotion.jsx — the React half: render a scene definition as a composition.
 *
 * Deliberately thin. Everything that can be plain JavaScript lives in `scene.js`
 * so that `auditScenes.mjs` can load a real scene file in Node — see the note at
 * the top of that file for why that constraint drives the whole split.
 *
 *   scene.js      the definition + audit   (Node can import it)
 *   remotion.jsx  the component            (needs React, a bundler, Remotion)
 *
 * ---------------------------------------------------------------------------
 * THE FOUR REMOTION RULES, and how this file keeps them
 *
 *   1. Every animation is driven by `useCurrentFrame()`, never `useFrame()`.
 *      `<PrevizStage>` reads the frame once and hands it to `applyFrame`.
 *   2. `<ThreeCanvas>` needs explicit `width`/`height` — from `useVideoConfig()`.
 *   3. Any `<Sequence>` *inside* the canvas needs `layout="none"`.
 *      (The opposite of `<TransitionSeries.Sequence>`, which must not have it.)
 *   4. Nothing holds state between frames. Remotion renders frames out of order
 *      across workers; the scene is built once per worker and every frame is
 *      computed from scratch.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   // src/Root.tsx
 *   import { Composition } from 'remotion';
 *   import { sceneComposition } from '../lib/remotion.jsx';
 *   import roundtable from './scenes/roundtable.js';
 *
 *   export const RemotionRoot = () => (
 *     <Composition {...sceneComposition(roundtable)} />
 *   );
 */

import React, { useMemo, useLayoutEffect } from 'react';
import { ThreeCanvas } from '@remotion/three';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { useThree } from '@react-three/fiber';

import * as blk from './blocking.js';
import { applyFrame } from './shots.js';

/**
 * The React component for a scene definition.
 *
 * `def.make()` runs inside `useMemo` with no dependencies — **once per worker**,
 * never per frame. CSG cuts, merges and BVH construction are build-time work;
 * doing them per frame is slow and a determinism hazard, because a boolean
 * re-evaluated repeatedly can produce marginally different triangles at the seams.
 */
export function sceneComponent(def) {
  function Scene() {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    const ctx = useMemo(() => def.make(), []);

    return (
      <ThreeCanvas width={width} height={height}>
        <PrevizStage ctx={ctx} list={def.list} frame={frame}
                     visibility={def.visibility} subjectSize={def.subjectSize}
                     filmGauge={def.filmGauge} />
      </ThreeCanvas>
    );
  }
  Scene.displayName = `Scene(${def.id})`;
  return Scene;
}

/** Spread straight into `<Composition>`: metadata from the definition, component from here. */
export function sceneComposition(def) {
  return { ...def.compositionProps, component: sceneComponent(def) };
}

/**
 * Attaches the built groups, fixes the lens for the scene's scale, and resolves
 * the frame. Works inside any R3F `<Canvas>`, not only Remotion's — which is why
 * there is no separate preview layer.
 */
export function PrevizStage({ ctx, list, frame, visibility = [],
                              subjectSize = 1, filmGauge = 36 }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    // Scale-correct the lens first: the default 0.1 near plane slices straight
    // through a product-scale scene, and the symptom looks like broken geometry
    // rather than a camera setting.
    camera.near = blk.nearFor(subjectSize);
    camera.far = Math.max(100, subjectSize * 1e4);
    camera.filmGauge = filmGauge;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }, [camera, subjectSize, filmGauge, size.width, size.height]);

  useLayoutEffect(() => {
    if (visibility.length) blk.applyVisibility(ctx.scene, visibility, frame);
    applyFrame(camera, list, frame);
  }, [camera, ctx, list, frame, visibility]);

  return (
    <>
      {Object.values(ctx.groups).map((g) => (
        <primitive key={g.name} object={g} />
      ))}
    </>
  );
}

/** Register several scenes at once. */
export function sceneCompositions(defs, Composition) {
  return defs.map((d) => <Composition key={d.id} {...sceneComposition(d)} />);
}
