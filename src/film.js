/**
 * film.js — the feature: opening + roundtable, one 12-frame dissolve.
 *
 * Plain JS on purpose: the audit gate loads this exact file and runs the
 * cross-scene consistency checks (fps, dimensions, transition arithmetic) —
 * the failures that come out subtly wrong at render time instead of erroring.
 *
 *   default export — 'live':   both scenes render in one pass. 72 + 720 − 12
 *                              = 780 frames; defineFilm does the subtraction.
 *   `stitched`     — 'stitch': references public/opening.mp4 and
 *                              public/roundtable.mp4 (render those first).
 */
import { defineFilm } from '../lib/film.js';
import opening from './scenes/opening.js';
import roundtable from './scenes/roundtable.js';

export default defineFilm({
  id: 'feature',
  scenes: [opening, roundtable],
  mode: 'live',
  transitions: { opening: { frames: 12 } },
});

export const stitched = defineFilm({
  // NB: Remotion composition ids allow only [a-z A-Z 0-9 -] — no underscores.
  id: 'feature-stitch',
  scenes: [opening, roundtable],
  mode: 'stitch',
  transitions: { opening: { frames: 12 } },
});
