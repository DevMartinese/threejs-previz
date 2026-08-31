/**
 * film-orbital.js — the orbital triptych: one cinematic orbit repeated across
 * three scenes (a car with its people / a court mid-game / a night drift
 * around the artist), the camera diving through the floor between them and
 * emerging in the next. Hard cuts — the dive IS the transition, so no
 * TransitionSeries needed. 3 x 240 = 720 frames at 24 fps.
 */
import { defineFilm } from '../lib/film.js';
import car from './scenes/orbit-car.js';
import court from './scenes/orbit-court.js';
import drift from './scenes/orbit-drift.js';

export default defineFilm({
  id: 'orbital',
  scenes: [car, court, drift],
  mode: 'live',
  // the dive-through demands it: boundary camera poses are measured, so the
  // hard cut genuinely hides behind the surface
  seams: true,
});
