/**
 * The inspector app: pick a scene, scrub it, turn the knobs it declares, and
 * look at the shot camera's whole trajectory from outside. Every scene
 * registered here is the SAME definition Remotion renders — imported straight
 * from src/scenes — and every knob goes back through the same `def.make()`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { InspectorStage, shotAt } from '../lib/inspector.jsx';
import { ParamPanel } from './params.jsx';

import roundtable from '../src/scenes/roundtable.js';
import canspot from '../src/scenes/canspot.js';
import tiramisu from '../src/scenes/tiramisu.js';
import orbital from '../src/scenes/orbital.js';
import floors from '../src/scenes/floors.js';
import demo from '../src/scenes/demo.js';

// The path is here rather than in the scene file: a scene should not have to
// know where on disk it lives. The inspector already imports each one by
// path, so it is the one place that honestly knows.
const SCENES = {
  tiramisu: [tiramisu, 'src/scenes/tiramisu.js'],
  orbital: [orbital, 'src/scenes/orbital.js'],
  floors: [floors, 'src/scenes/floors.js'],
  canspot: [canspot, 'src/scenes/canspot.js'],
  roundtable: [roundtable, 'src/scenes/roundtable.js'],
  demo: [demo, 'src/scenes/demo.js'],
};

/** Committing on every slider pixel rebuilds the scene — CSG included — per
 *  event. A short trailing delay keeps the readout live and the rebuild rare. */
function useDebounced(value, ms) {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return held;
}

function App() {
  const [id, setId] = useState('orbital');
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState('free');
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState(true);
  const [show, setShow] = useState({ path: true, cuts: true, frustum: true, grid: true, heroes: true });
  const [def, file] = SCENES[id];

  // Live values drive the readouts; the held copy drives the rebuild.
  const [values, setValues] = useState(() => ({ ...def.defaults }));
  const committed = useDebounced(values, 90);
  const key = JSON.stringify(committed);

  // A knob may move the cuts, so the shot list is derived from the values too.
  // `listFor` throws if a knob changed the duration; catching it here turns
  // what would be a blank canvas into a message next to the knob that did it.
  const [built, error] = useMemo(() => {
    try { return [{ list: def.listFor(committed), params: committed }, null]; }
    catch (err) { return [null, err.message]; }
  }, [def, key]); // eslint-disable-line

  const list = built?.list ?? def.list;
  const last = list.duration - 1;

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

  useEffect(() => {
    setFrame(0); setPlaying(false); setValues({ ...SCENES[id][0].defaults });
  }, [id]);

  const info = useMemo(() => shotAt(def, Math.min(frame, last), list), [def, list, frame, last]);
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));
  const setParam = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div id="app" className={panel ? 'with-panel' : ''}>
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
        <button className={panel ? 'on' : ''} onClick={() => setPanel((p) => !p)}>
          params{Object.keys(def.params ?? {}).length ? ` (${Object.keys(def.params).length})` : ''}
        </button>
        <span className="dim">{def.width}×{def.height} · {def.fps}fps · {list.duration}f</span>
      </header>

      <div id="stage">
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{ position: [def.subjectSize * 6, def.subjectSize * 4, def.subjectSize * 6], fov: 45,
                    near: def.subjectSize * 0.02, far: def.subjectSize * 4000 }}
          gl={{ antialias: true }}
        >
          {built && (
            <InspectorStage def={def} frame={Math.min(frame, last)} mode={mode}
                            show={show} params={built.params} />
          )}
        </Canvas>
      </div>

      {panel && (
        <ParamPanel def={def} file={file} values={values} error={error}
                    onChange={setParam} onReset={() => setValues({ ...def.defaults })} />
      )}

      <footer>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ pause' : '▶ play'}</button>
        <input type="range" min={0} max={last} value={Math.min(frame, last)}
               onChange={(e) => { setPlaying(false); setFrame(+e.target.value); }} />
        <span className="tag">f{Math.min(frame, last)}</span>
        <span className="dim">{(Math.min(frame, last) / def.fps).toFixed(2)}s</span>
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
