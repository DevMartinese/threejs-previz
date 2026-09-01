/**
 * film.jsx — the React half: render a film definition as a composition.
 *
 * Deliberately thin, same split as scene.js / remotion.jsx: `film.js` owns the
 * definition (scenes, transitions, duration arithmetic, consistency checks)
 * and stays loadable by the Node audit gate; this file owns the component.
 *
 *   // src/Root.jsx
 *   import { TransitionSeries, linearTiming } from '@remotion/transitions';
 *   import { fade } from '@remotion/transitions/fade';
 *   import { filmComposition } from '../lib/film.jsx';
 *   import feature from './film.js';
 *
 *   <Composition {...filmComposition(feature, {
 *     TransitionSeries, linearTiming, presentation: fade(),
 *   })} />
 *
 * `TransitionSeries` / `linearTiming` are injected rather than imported so a
 * project with hard cuts only never needs @remotion/transitions installed.
 * Declaring transitions in the film and NOT injecting them here throws loudly
 * at registration — a silently-ignored dissolve is how films come out the
 * wrong length.
 */

import React from 'react';
import { AbsoluteFill, OffthreadVideo, Series, staticFile } from 'remotion';
import { sceneComponent } from './remotion.jsx';

/**
 * The React component for a film definition from `defineFilm()`.
 *
 * 'live' mounts each scene's own component in sequence; 'stitch' references
 * each scene's pre-rendered file in public/ via <OffthreadVideo> (override the
 * naming with `src`).
 */
export function filmComponent(def, {
  TransitionSeries = null,
  linearTiming = null,
  presentation = null,
  src = (scene) => staticFile(`${scene.id}.mp4`),
} = {}) {
  const hasTransitions = def.transitionFrames > 0;
  if (hasTransitions && (!TransitionSeries || !linearTiming)) {
    throw new Error(
      `film "${def.id}" declares transitions — pass { TransitionSeries, linearTiming } `
      + `from @remotion/transitions to filmComposition(), or they would be silently `
      + `ignored and the film would render ${def.transitionFrames} frames short`);
  }

  const liveComponents = new Map();
  function sceneBody(scene, params) {
    if (def.mode === 'live') {
      if (!liveComponents.has(scene.id)) liveComponents.set(scene.id, sceneComponent(scene));
      const C = liveComponents.get(scene.id);
      return <C params={params} />;
    }
    return (
      <OffthreadVideo
        src={src(scene)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  /**
   * A stitched film plays FILES. The frames already exist, so a parameter
   * handed to this composition could not reach the geometry that produced
   * them — it would be accepted, ignored, and the film would come out at the
   * defaults while the command said otherwise. That is precisely the class of
   * silent wrongness this module exists to prevent, so it throws and names
   * the fix: pass the parameters to the per-scene renders that fill public/,
   * then stitch.
   */
  function assertParamsUsable(params) {
    const given = Object.keys(params ?? {});
    if (!given.length || def.mode === 'live') return;
    throw new Error(
      `film "${def.id}" is in 'stitch' mode: it renders the files in public/, so `
      + `parameters for ${given.join(', ')} cannot reach it. Render those scenes `
      + `with the parameters first — e.g. remotion render ${given[0]} `
      + `public/${given[0]}.mp4 --props='{"params":{…}}' — then render the film.`);
  }

  function renderSeries(params) {
    return (
      <Series>
        {def.scenes.map((s) => (
          <Series.Sequence key={s.id} durationInFrames={s.list.duration} name={s.id}>
            {sceneBody(s, params?.[s.id])}
          </Series.Sequence>
        ))}
      </Series>
    );
  }

  function renderWithTransitions(params) {
    const out = [];
    def.scenes.forEach((s, i) => {
      out.push(
        // NOTE: no layout="none" here — deprecated and throws from Remotion 5.
        // Transition scenes must stay absolutely positioned. (The opposite of
        // a plain <Sequence> inside a <ThreeCanvas>, which needs it.)
        <TransitionSeries.Sequence key={s.id} durationInFrames={s.list.duration} name={s.id}>
          {sceneBody(s, params?.[s.id])}
        </TransitionSeries.Sequence>,
      );
      const t = def.transitions[s.id];
      if (t && i < def.scenes.length - 1) {
        out.push(
          <TransitionSeries.Transition
            key={`${s.id}->`}
            presentation={t.presentation ?? presentation ?? undefined}
            timing={t.timing ?? linearTiming({ durationInFrames: t.frames })}
          />,
        );
      }
    });
    return <TransitionSeries>{out}</TransitionSeries>;
  }

  function Component({ params }) {
    assertParamsUsable(params);
    // Validated against each scene's own declaration before anything mounts,
    // so a bad key fails at the film exactly as it would at the scene.
    if (params && Object.keys(params).length) def.resolve(params);
    return (
      <AbsoluteFill style={{ backgroundColor: def.background }}>
        {hasTransitions ? renderWithTransitions(params) : renderSeries(params)}
      </AbsoluteFill>
    );
  }
  Component.displayName = `Film(${def.id})`;
  return Component;
}

/** Spread straight into `<Composition>`: metadata from film.js, component from here. */
export function filmComposition(def, opts) {
  return { ...def.compositionProps, component: filmComponent(def, opts) };
}
