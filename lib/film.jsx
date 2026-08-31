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
  function sceneBody(scene) {
    if (def.mode === 'live') {
      if (!liveComponents.has(scene.id)) liveComponents.set(scene.id, sceneComponent(scene));
      const C = liveComponents.get(scene.id);
      return <C />;
    }
    return (
      <OffthreadVideo
        src={src(scene)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  function renderSeries() {
    return (
      <Series>
        {def.scenes.map((s) => (
          <Series.Sequence key={s.id} durationInFrames={s.list.duration} name={s.id}>
            {sceneBody(s)}
          </Series.Sequence>
        ))}
      </Series>
    );
  }

  function renderWithTransitions() {
    const out = [];
    def.scenes.forEach((s, i) => {
      out.push(
        // NOTE: no layout="none" here — deprecated and throws from Remotion 5.
        // Transition scenes must stay absolutely positioned. (The opposite of
        // a plain <Sequence> inside a <ThreeCanvas>, which needs it.)
        <TransitionSeries.Sequence key={s.id} durationInFrames={s.list.duration} name={s.id}>
          {sceneBody(s)}
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

  function Component() {
    return (
      <AbsoluteFill style={{ backgroundColor: def.background }}>
        {hasTransitions ? renderWithTransitions() : renderSeries()}
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
