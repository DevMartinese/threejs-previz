/**
 * film.js — define a film. No React, no JSX, no bundler.
 *
 * Same constraint that split scene.js from remotion.jsx: **the audit gate has
 * to be able to import a real film file in plain Node.** A film module that
 * imports React cannot be loaded by `node auditScenes.mjs src/film.js`, and
 * then the cross-scene consistency checks — the ones that fail *silently* at
 * render time — never run. So:
 *
 *   film.js    the definition: scenes, transitions, duration arithmetic,
 *              the consistency checks, timeline. Plain ES modules.
 *   film.jsx   the React component that renders a definition.
 *
 * A film is an *edit* of scenes. A scene is a unit of work: you build it,
 * audit it, render it, and stop thinking about it. Keeping the two separate is
 * what lets you change scene 3 without re-rendering the other five.
 *
 * ---------------------------------------------------------------------------
 * TWO MODES
 *
 *   'stitch'  (default) — each scene has already been rendered to a video in
 *             public/; the film references the files. Change one scene,
 *             re-render only it, re-stitch in seconds.
 *   'live'    — the film mounts each scene's component and renders everything
 *             in one pass. No intermediate files; every change re-renders the
 *             whole film. Fine for two or three short scenes.
 *
 * ---------------------------------------------------------------------------
 * DURATION IS DERIVED, INCLUDING THE TRANSITION ARITHMETIC
 *
 * `<TransitionSeries>` renders both scenes during a transition and **shortens
 * the total by the transition length**: 100 + 100 − 30 = 170. That subtraction
 * is the most common off-by-N in a Remotion edit, so `defineFilm` does it.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   // src/film.js — plain JS, the audit gate loads it directly
 *   import { defineFilm } from '../lib/film.js';
 *   export default defineFilm({
 *     id: 'feature',
 *     scenes: [opening, roundtable],
 *     mode: 'live',
 *     transitions: { opening: { frames: 12 } },   // dissolve after `opening`
 *   });
 *
 *   // src/Root.jsx — the React half binds the component
 *   <Composition {...filmComposition(feature, { TransitionSeries, linearTiming, presentation: fade() })} />
 */

/**
 * Compose scenes into a film. `scenes` are `defineScene()` results.
 * `transitions` is keyed by the id of the scene the transition comes AFTER:
 * `{ opening: { frames: 12 } }`. Omit for hard cuts — usually what previz wants.
 */
export function defineFilm({
  id,
  scenes,
  mode = 'stitch',
  transitions = {},
  background = '#000000',
}) {
  if (!scenes || !scenes.length) throw new Error(`film "${id}" has no scenes`);

  const fps = scenes[0].fps;
  const width = scenes[0].width;
  const height = scenes[0].height;

  const transitionFrames = scenes.reduce((sum, s, i) => {
    const t = transitions[s.id];
    return sum + (t && i < scenes.length - 1 ? t.frames : 0);
  }, 0);
  const sceneFrames = scenes.reduce((sum, s) => sum + s.list.duration, 0);
  const durationInFrames = sceneFrames - transitionFrames;

  return {
    id, fps, width, height, scenes, mode, transitions, background,
    durationInFrames, sceneFrames, transitionFrames,
    problems: check(scenes, transitions),
    /** Re-run the consistency checks. Used by the audit gate. */
    check: () => check(scenes, transitions),
    /** Where each scene starts on the film timeline (hard cuts only). */
    timeline: scenes.reduce((acc, s) => {
      const from = acc.length ? acc[acc.length - 1].to : 0;
      acc.push({ id: s.id, from, to: from + s.list.duration });
      return acc;
    }, []),
    /**
     * Everything `<Composition>` needs except `component`, which comes from
     * `filmComposition()` in film.jsx — same split as a scene.
     */
    compositionProps: { id, durationInFrames, fps, width, height },
  };
}

/**
 * The checks that matter when joining scenes. All of these fail *silently* at
 * render time — the film comes out subtly wrong rather than erroring — which
 * is exactly why they are asserted up front, in Node, before any render.
 */
function check(scenes, transitions) {
  const problems = [];
  const { fps, width, height } = scenes[0];

  for (const s of scenes) {
    // Mismatched fps is the worst of these: a stitched film plays each clip at
    // the film's fps, so a 24 fps scene inside a 30 fps film runs fast and
    // every cut after it lands early.
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
  }

  return problems;
}
