/**
 * The inspector app: pick a scene, scrub it, and look at the shot camera's
 * whole trajectory from outside. Every scene registered here is the SAME
 * definition Remotion renders — imported straight from src/scenes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { InspectorStage, shotAt } from '../lib/inspector.jsx';

import roundtable from '../src/scenes/roundtable.js';
import canspot from '../src/scenes/canspot.js';
import tiramisu from '../src/scenes/tiramisu.js';
import orbital from '../src/scenes/orbital.js';
import floors from '../src/scenes/floors.js';
import demo from '../src/scenes/demo.js';

const SCENES = { tiramisu, orbital, floors, canspot, roundtable, demo };

function App() {
  const [id, setId] = useState('orbital');
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState('free');
  const [playing, setPlaying] = useState(false);
  const [show, setShow] = useState({ path: true, cuts: true, frustum: true, grid: true, heroes: true });
  const def = SCENES[id];
  const last = def.list.duration - 1;

  // playback at the scene's own fps — the inspector is a viewer, so a clock
  // here is fine; the SCENE stays a pure function of the frame it is given
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let t0 = performance.now(), f0 = frame;
    const tick = (t) => {
      const f = f0 + Math.floor((t - t0) / 1000 * def.fps);
      setFrame(f > last ? 0 : f);
      if (f > last) { t0 = performance.now(); f0 = 0; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, def, last]); // eslint-disable-line

  useEffect(() => { setFrame(0); setPlaying(false); }, [id]);

  const info = useMemo(() => shotAt(def, frame), [def, frame]);
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div id="app">
      <header>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {Object.keys(SCENES).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className={mode === 'free' ? 'on' : ''} onClick={() => setMode('free')}>free orbit</button>
        <button className={mode === 'shot' ? 'on' : ''} onClick={() => setMode('shot')}>shot camera</button>
        <span className="dim">|</span>
        {['path', 'cuts', 'frustum', 'heroes', 'grid'].map((k) => (
          <label key={k}>
            <input type="checkbox" checked={show[k]} onChange={() => toggle(k)} />{k}
          </label>
        ))}
        <span className="dim">{def.width}×{def.height} · {def.fps}fps · {def.list.duration}f</span>
      </header>

      <div id="stage">
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{ position: [def.subjectSize * 6, def.subjectSize * 4, def.subjectSize * 6], fov: 45,
                    near: def.subjectSize * 0.02, far: def.subjectSize * 4000 }}
          gl={{ antialias: true }}
        >
          <InspectorStage def={def} frame={frame} mode={mode} show={show} />
        </Canvas>
      </div>

      <footer>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ pause' : '▶ play'}</button>
        <input type="range" min={0} max={last} value={frame}
               onChange={(e) => { setPlaying(false); setFrame(+e.target.value); }} />
        <span className="tag">f{frame}</span>
        <span className="dim">{(frame / def.fps).toFixed(2)}s</span>
        {info && (
          <>
            <span className="dim">|</span>
            <span className="tag">{info.name}</span>
            <span className="dim">[{info.from}–{info.to}) · {Math.round(info.progress * 100)}%</span>
            <span className="dim">hero: {info.hero}</span>
            {info.focalLength && <span className="dim">{info.focalLength}mm</span>}
          </>
        )}
      </footer>
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App />);
