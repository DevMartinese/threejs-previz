/**
 * The inspector app: pick a scene, scrub it, turn the knobs it declares, and
 * look at the shot camera's whole trajectory from outside. Every scene
 * registered here is the SAME definition Remotion renders — imported straight
 * from src/scenes — and every knob goes back through the same `def.make()`.
 *
 * Values are held PER SCENE and survive the dropdown, because the thing you
 * are usually building is an edit, not a shot: you settle scene one, move to
 * scene two, come back — and then take the whole film out in one command.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { InspectorStage, shotAt } from '../lib/inspector.jsx';
import { ParamPanel } from './params.jsx';
import { paramDiff } from '../lib/params.js';

import roundtable from '../src/scenes/roundtable.js';
import opening from '../src/scenes/opening.js';
import canspot from '../src/scenes/canspot.js';
import tiramisu from '../src/scenes/tiramisu.js';
import orbital from '../src/scenes/orbital.js';
import floors from '../src/scenes/floors.js';
import demo from '../src/scenes/demo.js';
import feature, { stitched } from '../src/film.js';

// The path is here rather than in the scene file: a scene should not have to
// know where on disk it lives. The inspector already imports each one by
// path, so it is the one place that honestly knows.
const SCENES = {
  tiramisu: [tiramisu, 'src/scenes/tiramisu.js'],
  orbital: [orbital, 'src/scenes/orbital.js'],
  floors: [floors, 'src/scenes/floors.js'],
  canspot: [canspot, 'src/scenes/canspot.js'],
  roundtable: [roundtable, 'src/scenes/roundtable.js'],
  opening: [opening, 'src/scenes/opening.js'],
  demo: [demo, 'src/scenes/demo.js'],
};

// The edits. `exportName` is null for the default export; the gate needs it to
// audit the right one, since a file may hold the same edit in two modes.
const FILMS = [
  { film: feature, file: 'src/film.js', exportName: null },
  { film: stitched, file: 'src/film.js', exportName: 'stitched' },
];

const STORE = 'previz-inspector-tuning';

/**
 * Tuning survives a reload, and saving to a scene file causes one — but the
 * FILE WINS. Alongside each scene's values we keep the defaults they were
 * based on; on restore, any knob whose default has moved is dropped, because a
 * changed default means the file changed under us. That is the case that
 * matters: you edit a scene by hand, come back to the tab, and the browser
 * must not quietly reinstate the number you just replaced.
 */
function loadTuning(scenes) {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; }
  const out = {};
  for (const [id, entry] of Object.entries(stored ?? {})) {
    const def = scenes[id]?.[0];
    if (!def || !entry?.values) continue;
    const kept = {};
    for (const [k, v] of Object.entries(entry.values)) {
      if (!(k in def.defaults)) continue;                    // knob is gone
      if (entry.base?.[k] !== def.defaults[k]) continue;      // the file moved it
      kept[k] = v;
    }
    try { out[id] = def.resolve(kept); } catch { /* out of range now: drop it */ }
  }
  return out;
}

function saveTuning(tuning, scenes) {
  const out = {};
  for (const [id, values] of Object.entries(tuning)) {
    const def = scenes[id]?.[0];
    if (def) out[id] = { values, base: def.defaults };
  }
  try { localStorage.setItem(STORE, JSON.stringify(out)); } catch { /* private mode */ }
}

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
  const [tuning, setTuning] = useState(() => loadTuning(SCENES));  // kept across switches AND reloads
  const [def, file] = SCENES[id];

  const values = tuning[id] ?? def.defaults;

  // Live values drive the readouts; the held copy drives the rebuild. The
  // scene id rides along so that switching scenes does NOT hand the previous
  // scene's values to the new one for 90 ms — that would throw on the first
  // knob the new scene does not declare.
  const pending = useMemo(() => ({ id, values }), [id, values]);
  const held = useDebounced(pending, 90);
  const active = held.id === id ? held.values : values;

  // A knob may move the cuts, so the shot list is derived from the values too.
  // `listFor` throws if a knob changed the duration; catching it here turns
  // what would be a blank canvas into a message next to the knob that did it.
  const key = JSON.stringify(active);
  const [built, error] = useMemo(() => {
    try { return [{ list: def.listFor(active), params: active }, null]; }
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

  useEffect(() => { setFrame(0); setPlaying(false); }, [id]);
  useEffect(() => { saveTuning(tuning, SCENES); }, [tuning]);

  const info = useMemo(() => shotAt(def, Math.min(frame, last), list), [def, list, frame, last]);
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));
  const setParam = (k, v) =>
    setTuning((s) => ({ ...s, [id]: { ...(s[id] ?? def.defaults), [k]: v } }));

  // Every film this scene belongs to, with what its scenes are currently
  // tuned to — so the film command carries the whole edit, not just this cut.
  const films = useMemo(() => FILMS
    .filter((f) => f.film.scenes.some((s) => s.id === id))
    .map((f) => ({
      ...f,
      tuned: Object.fromEntries(f.film.scenes.map((s) => {
        const v = tuning[s.id];
        const d = v ? paramDiff(s.params ?? {}, v) : {};
        return [s.id, d];
      }).filter(([, d]) => Object.keys(d).length)),
    })), [id, tuning]);

  const tunedScenes = Object.keys(tuning)
    .filter((k) => Object.keys(paramDiff(SCENES[k][0].params ?? {}, tuning[k])).length);

  return (
    <div id="app" className={panel ? 'with-panel' : ''}>
      <header>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {Object.keys(SCENES).map((k) => (
            <option key={k} value={k}>{tunedScenes.includes(k) ? `${k} •` : k}</option>
          ))}
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
        {tunedScenes.length > 0 && (
          <>
            <span className="tag hot">{tunedScenes.join(', ')} tuned</span>
            <button onClick={() => setTuning({})}>clear all</button>
          </>
        )}
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
        <ParamPanel def={def} file={file} values={values} error={error} films={films}
                    onChange={setParam}
                    onReset={() => setTuning((s) => ({ ...s, [id]: def.defaults }))} />
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
