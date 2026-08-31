import React from 'react';
import { Composition } from 'remotion';
import { sceneComposition } from '../lib/remotion.jsx';
import demo from './scenes/demo.js';
import roundtable from './scenes/roundtable.js';

// One <Composition> per scene. Everything — id, fps, size, durationInFrames —
// is derived from the scene definition; nothing is restated here.
export const RemotionRoot = () => (
  <>
    <Composition {...sceneComposition(roundtable)} />
    <Composition {...sceneComposition(demo)} />
  </>
);
