/**
 * film.jsx — compose several scenes into one longer piece.
 *
 * A scene is a unit of work: you build it, audit it, render it, and stop thinking
 * about it. A film is an *edit* of scenes. Keeping the two separate is what lets
 * you change scene 3 without re-rendering the other five.
 *
 * ---------------------------------------------------------------------------
 * TWO MODES, and the choice matters more than it looks
 *
 *   'stitch'  (default) — each scene has already been rendered to a video file;
 *              the film references them with <OffthreadVideo>. Change one scene,
 *              re-render only that scene, re-stitch in seconds. This is how a real
 *              edit works: you cut negatives that are already developed.
 *
 *   'live'    — the film mounts each scene's React component inside a Sequence and
 *              renders everything in one pass. No intermediate files, but every
 *              scene rebuilds its geometry, a WebGL context is mounted and torn
 *              down per scene, and any change re-renders the whole film.
 *              Fine for two or three short scenes; painful past that.
 *
 * Start in 'live' while the piece is short and you are still moving cuts around.
 * Switch to 'stitch' once scenes stabilise and the render starts to hurt.
 *
 * ---------------------------------------------------------------------------
 * DURATION IS DERIVED, INCLUDING THE TRANSITION ARITHMETIC
 *
 * `<TransitionSeries>` renders both scenes during a transition and **shortens the
 * total by the transition length**. Two 100-frame scenes with a 30-frame
 * transition make a 170-frame film, not 200 and not 230. That subtraction is the
 * single most common off-by-N in a Remotion edit, so `defineFilm` does it.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   import { defineFilm } from '../../lib/film.jsx';
 *   import intro from './scenes/intro.js';
 *   import table from './scenes/roundtable.js';
 *
 *   export default defineFilm({
 *     id: 'feature',
 *     scenes: [intro, table],
 *     mode: 'stitch',
 *     transitions: { intro: { frames: 15 } },   // 15-frame dissolve after `intro`
 *   });
 *
 *   // Root.tsx — scenes stay individually renderable
 *   <>
 *     <Composition {...intro.compositionProps} />
 *     <Composition {...table.compositionProps} />
 *     <Composition {...feature.compositionProps} />
 *   </>
 */

import React from 'react';
import { AbsoluteFill, OffthreadVideo, Series, staticFile } from 'remotion';
import { sceneComponent } from './remotion.jsx';

/**
 * Compose scenes into a film.
 *
 * `scenes` are `defineScene()` results. `transitions` is keyed by the id of the
 * scene the transition comes **after**: `{ intro: { frames: 15, presentation } }`.
 * Omit it for hard cuts, which is usually what previz wants.
 */
export function defineFilm({
  id,
  scenes,
  mode = 'stitch',
  transitions = {},
  src = (scene) => staticFile(`${scene.id}.mp4`),
  background = '#000000',
  TransitionSeries = null,        // pass in from @remotion/transitions to use it
  defaultPresentation = null,
}) {
  if (!scenes || !scenes.length) throw new Error(`film "${id}" has no scenes`);

  const problems = check(scenes, transitions, mode, TransitionSeries);
  const fps = scenes[0].fps;
  const width = scenes[0].width;
  const height = scenes[0].height;

  const transitionFrames = scenes.reduce((sum, s, i) => {
    const t = transitions[s.id];
    return sum + (t && i < scenes.length - 1 ? t.frames : 0);
  }, 0);
  const sceneFrames = scenes.reduce((sum, s) => sum + s.list.duration, 0);
  const durationInFrames = sceneFrames - transitionFrames;

  function Component() {
    const body = TransitionSeries && transitionFrames > 0
      ? renderWithTransitions()
      : renderSeries();
    return <AbsoluteFill style={{ backgroundColor: background }}>{body}</AbsoluteFill>;
  }
  Component.displayName = `Film(${id})`;

  const liveComponents = new Map();
  function sceneBody(scene) {
    if (mode === 'live') {
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
        {scenes.map((s) => (
          <Series.Sequence key={s.id} durationInFrames={s.list.duration} name={s.id}>
            {sceneBody(s)}
          </Series.Sequence>
        ))}
      </Series>
    );
  }

  function renderWithTransitions() {
    const out = [];
    scenes.forEach((s, i) => {
      out.push(
        // NOTE: do not pass layout="none" here — it is deprecated and throws from
        // Remotion 5. Transition scenes must stay absolutely positioned.
        <TransitionSeries.Sequence key={s.id} durationInFrames={s.list.duration} name={s.id}>
          {sceneBody(s)}
        </TransitionSeries.Sequence>,
      );
      const t = transitions[s.id];
      if (t && i < scenes.length - 1) {
        out.push(
          <TransitionSeries.Transition
            key={`${s.id}->`}
            presentation={t.presentation ?? defaultPresentation ?? undefined}
            timing={t.timing}
          />,
        );
      }
    });
    return <TransitionSeries>{out}</TransitionSeries>;
  }

  return {
    id, fps, width, height, scenes, mode,
    durationInFrames, sceneFrames, transitionFrames,
    problems,
    Component,
    /** Re-run the consistency checks. Used by the audit gate. */
    check: () => check(scenes, transitions, mode, TransitionSeries),
    /** Where each scene starts on the film timeline (hard cuts only). */
    timeline: scenes.reduce((acc, s) => {
      const from = acc.length ? acc[acc.length - 1].to : 0;
      acc.push({ id: s.id, from, to: from + s.list.duration });
      return acc;
    }, []),
    compositionProps: {
      id, component: Component, durationInFrames, fps, width, height,
    },
  };
}

/**
 * The checks that matter when joining scenes. All of these fail *silently* at
 * render time — the film comes out subtly wrong rather than erroring — which is
 * exactly why they are worth asserting up front.
 */
function check(scenes, transitions, mode, TransitionSeries) {
  const problems = [];
  const { fps, width, height } = scenes[0];

  for (const s of scenes) {
    // Mismatched fps is the worst of these: the stitched film plays each clip at
    // the film's fps, so a 24 fps scene inside a 30 fps film runs fast and every
    // cut after it lands early.
    if (s.fps !== fps) {
      problems.push(`${s.id}: fps ${s.fps} != film fps ${fps} — timing will drift`);
    }
    if (s.width !== width || s.height !== height) {
      problems.push(`${s.id}: ${s.width}x${s.height} != film ${width}x${height} — will letterbox or crop`);
    }
    if (!s.list.duration) {
      problems.push(`${s.id}: zero-length shot list`);
    }
  }

  for (const [after, t] of Object.entries(transitions)) {
    const i = scenes.findIndex((s) => s.id === after);
    if (i === -1) {
      problems.push(`transition after "${after}": no such scene`);
      continue;
    }
    if (i === scenes.length - 1) {
      problems.push(`transition after "${after}": it is the last scene, transition ignored`);
    }
    const next = scenes[i + 1];
    const shortest = Math.min(scenes[i].list.duration, next ? next.list.duration : Infinity);
    if (t.frames >= shortest) {
      problems.push(`transition after "${after}": ${t.frames} frames is >= the shortest adjacent scene (${shortest})`);
    }
    if (!TransitionSeries) {
      problems.push(`transition after "${after}": pass TransitionSeries from @remotion/transitions, or it will be ignored`);
    }
  }

  return problems;
}

/** Register scenes and films together; scenes stay individually renderable. */
export function filmCompositions(film, Composition) {
  return [
    ...film.scenes.map((s) => <Composition key={s.id} {...s.compositionProps} />),
    <Composition key={film.id} {...film.compositionProps} />,
  ];
}
