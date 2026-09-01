import React from 'react';
import { Composition } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { sceneComposition } from '../lib/remotion.jsx';
import { filmComposition } from '../lib/film.jsx';
import demo from './scenes/demo.js';
import roundtable from './scenes/roundtable.js';
import opening from './scenes/opening.js';
import canspot from './scenes/canspot.js';
import tiramisu from './scenes/tiramisu.js';
import feature, { stitched } from './film.js';
import orbital from './scenes/orbital.js';

// One <Composition> per scene and per film. Everything — id, fps, size,
// durationInFrames — is derived from the definitions; nothing is restated.
// TransitionSeries/linearTiming are injected here so lib/ never hard-depends
// on @remotion/transitions.
const transitionKit = { TransitionSeries, linearTiming, presentation: fade() };

export const RemotionRoot = () => (
  <>
    <Composition {...sceneComposition(roundtable)} />
    <Composition {...sceneComposition(opening)} />
    <Composition {...sceneComposition(canspot)} />
    <Composition {...sceneComposition(tiramisu)} />
    <Composition {...sceneComposition(demo)} />
    <Composition {...sceneComposition(orbital)} />
    <Composition {...filmComposition(feature, transitionKit)} />
    <Composition {...filmComposition(stitched, transitionKit)} />
  </>
);
