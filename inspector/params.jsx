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

export function ParamPanel({ def, file, values, onChange, onReset, error }) {
  const [note, setNote] = useState('');
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
          <button onClick={() => copy(renderCommand(def, file, values), flash)}>
            copy render command
          </button>
          <button onClick={() => copy(paramSource(def.params, values), flash)}>
            copy params block
          </button>
          <span className="dim">{note}</span>
          {dirty > 0 && (
            <p className="dim note">
              The command runs the audit on these values first, then renders. To keep
              them, paste the params block over the one in <code>{file}</code>.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
