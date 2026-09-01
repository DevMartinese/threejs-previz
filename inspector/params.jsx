/**
 * params.jsx — the knob panel, and the command that carries what you found.
 *
 * The panel is generated entirely from `def.params`, the scene's own
 * declaration. There is no list of controls anywhere: a scene that declares a
 * knob gets a control, a scene that declares none gets a panel that says so.
 * That is the same rule the audits follow — the scene states its intent, the
 * tool reads it.
 *
 * Two ways out of here, because a value found by dragging is worth nothing
 * until it leaves the browser:
 *
 *   copy render command   audit AND render, joined by `&&`, with the tuned
 *                         values on both. One-off: good for a variant you want
 *                         to look at, not for one you want to keep.
 *   copy params block     the `params:` block for the scene file, current
 *                         values as the new defaults. This is the one that
 *                         makes a change permanent, versioned and gated.
 *
 * The render command carries its audit for a reason. If tuned values could
 * reach a render without passing back through the gate, every check in this
 * repo would only ever have run against the defaults.
 */
import React, { useState } from 'react';
import { paramDiff, paramSource } from '../lib/params.js';

/** JSON with no spaces — these end up inside single quotes in a shell command. */
const j = (v) => JSON.stringify(v);

export function renderCommand(def, file, values) {
  const diff = paramDiff(def.params, values);
  const out = `out/${def.id}.mp4`;
  if (!Object.keys(diff).length)
    return `pnpm audit:scenes && pnpm exec remotion render ${def.id} ${out}`;
  const props = j({ params: diff });
  return `pnpm exec node lib/auditScenes.mjs ${file} --params='${j(diff)}' \\\n`
    + `  && pnpm exec remotion render ${def.id} ${out} --props='${props}'`;
}

/**
 * The same thing for a FILM: the edit, rendered with whatever its scenes are
 * currently tuned to. `tuned` is `{sceneId: diff}` for the scenes of this film
 * that differ from their defaults.
 *
 * The two modes need genuinely different commands, and getting that wrong is
 * silent rather than loud, so it is generated rather than remembered:
 *
 *   live    one render; the scenes are mounted and the parameters go straight
 *           to the film composition, which routes them per scene.
 *   stitch  the film plays FILES. Parameters cannot reach frames that already
 *           exist, so each tuned scene is re-rendered into public/ FIRST and
 *           the film is stitched from those. Scenes nobody touched are
 *           re-rendered too — the command has to be able to run in a clean
 *           checkout, where public/ is empty.
 */
export function filmCommand(film, file, exportName, tuned) {
  const target = exportName ? `${file} --export=${exportName}` : file;
  const some = Object.keys(tuned).length > 0;
  const audit = some
    ? `pnpm exec node lib/auditScenes.mjs ${target} --params='${j(tuned)}'`
    : `pnpm exec node lib/auditScenes.mjs ${target}`;

  if (film.mode === 'live') {
    const props = some ? ` --props='${j({ params: tuned })}'` : '';
    return `${audit} \\\n  && pnpm exec remotion render ${film.id} out/${film.id}.mp4${props}`;
  }
  const steps = film.scenes.map((s) => {
    const over = tuned[s.id];
    const props = over ? ` --props='${j({ params: over })}'` : '';
    return `  && pnpm exec remotion render ${s.id} public/${s.id}.mp4${props}`;
  });
  steps.push(`  && pnpm exec remotion render ${film.id} out/${film.id}.mp4`);
  return [audit, ...steps].join(' \\\n');
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    done('copied');
  } catch {
    // Clipboard access can be refused even on localhost; a selected textarea
    // still lets you hit ⌘C, which beats a button that silently does nothing.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    document.body.removeChild(ta);
    done(ok ? 'copied' : 'press ⌘C');
  }
}

function Knob({ d, value, onChange }) {
  if (d.kind === 'bool') {
    return (
      <label className="knob-row">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span>{d.label}</span>
      </label>
    );
  }
  if (d.kind === 'enum') {
    return (
      <div className="knob">
        <div className="knob-head"><span>{d.label}</span></div>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  const dp = Math.max(0, -Math.floor(Math.log10(d.step)));
  return (
    <div className="knob">
      <div className="knob-head">
        <span>{d.label}</span>
        <span className={value === d.value ? 'dim' : 'tag hot'}>
          {Number(value).toFixed(dp)}{d.unit}
        </span>
      </div>
      <input type="range" min={d.min} max={d.max} step={d.step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/**
 * Write the values into the scene file and run the gate on what was written.
 * The panel shows the gate's own report — not a summary of it — because the
 * whole reason to save through here rather than paste is that the saved value
 * is immediately a value somebody has checked.
 */
async function save(file, block, set) {
  set({ busy: true, text: 'saving…' });
  try {
    const r = await fetch('/__params', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, block }),
    });
    const body = await r.json();
    if (!r.ok) return set({ busy: false, bad: true, text: body.error ?? `HTTP ${r.status}` });
    set({ busy: false, bad: !body.audit.ok, saved: true,
          text: `saved to ${body.file}\n\n${body.audit.text}` });
  } catch (err) {
    set({ busy: false, bad: true, text: `could not reach the dev server: ${err.message}` });
  }
}

export function ParamPanel({ def, file, values, onChange, onReset, error, films = [] }) {
  const [note, setNote] = useState('');
  const [saveState, setSaveState] = useState(null);
  const knobs = Object.values(def.params ?? {});
  const diff = knobs.length ? paramDiff(def.params, values) : {};
  const dirty = Object.keys(diff).length;

  const flash = (msg) => { setNote(msg); setTimeout(() => setNote(''), 1400); };

  return (
    <aside id="params">
      <div className="panel-head">
        <b>parameters</b>
        <span className="dim">{def.id}</span>
        {dirty ? <button onClick={onReset}>reset {dirty}</button> : <span className="dim">defaults</span>}
      </div>

      {!knobs.length && (
        <p className="dim note">
          This scene declares no parameters. Add a <code>params</code> block to
          <code>defineScene</code> and the controls appear here.
        </p>
      )}

      {knobs.map((d) => (
        <div key={d.key}>
          <Knob d={d} value={values[d.key]} onChange={(v) => onChange(d.key, v)} />
          {d.note && <p className="dim note">{d.note}</p>}
        </div>
      ))}

      {error && <p className="error">{error}</p>}

      {knobs.length > 0 && (
        <div className="panel-foot">
          <button className={dirty ? 'on' : ''} disabled={saveState?.busy}
                  onClick={() => save(file, paramSource(def.params, values), setSaveState)}>
            save to scene file
          </button>
          <button onClick={() => copy(renderCommand(def, file, values), flash)}>
            copy render command
          </button>
          <button onClick={() => copy(paramSource(def.params, values), flash)}>
            copy params block
          </button>
          <span className="dim">{note}</span>
          {saveState && (
            <pre className={saveState.bad ? 'error' : 'report'}>{saveState.text}</pre>
          )}
          {dirty > 0 && !saveState && (
            <p className="dim note">
              <b>Save</b> writes these into <code>{file}</code> and runs the gate on
              what it wrote — that is what makes the change reviewable, versioned,
              and visible to anyone (or anything) that reads the repo afterwards.
              The command is for a one-off variant instead.
            </p>
          )}
        </div>
      )}

      {/* The films this scene belongs to. Values are held per scene and survive
          the dropdown, so you can tune three scenes and then take the whole
          edit out in one command. */}
      {films.length > 0 && (
        <div className="panel-foot">
          <b>films</b>
          {films.map(({ film, file: ffile, exportName, tuned }) => {
            const n = Object.keys(tuned).length;
            return (
              <div key={film.id + (exportName ?? '')} className="film-row">
                <button onClick={() => copy(filmCommand(film, ffile, exportName, tuned), flash)}>
                  copy film · {film.id}
                </button>
                <span className="dim">
                  {film.mode} · {film.scenes.length} scenes · {film.durationInFrames}f
                  {n ? ` · ${n} tuned` : ' · at defaults'}
                </span>
              </div>
            );
          })}
          <p className="dim note">
            Renders the edit with every scene at the values held here. A stitched
            film renders its scenes into <code>public/</code> first — parameters
            cannot reach frames that already exist.
          </p>
        </div>
      )}
    </aside>
  );
}
