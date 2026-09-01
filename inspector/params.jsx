/**
 * params.jsx — the knob panel, and the command that carries what you found.
 *
 * The controls are lil-gui, the standard Three.js panel, but nothing about the
 * panel is written by hand: every controller is generated from `def.params`,
 * the scene's own declaration. A scene that declares a knob gets a control, a
 * scene that declares none gets a panel that says so. That is the same rule
 * the audits follow — the scene states its intent, the tool reads it.
 *
 * lil-gui is imperative and React is not, so the split is:
 *
 *   React owns the VALUES.       They live in the app's state, they are what
 *                                rebuilds the scene, and they persist.
 *   lil-gui owns the WIDGETS.    Built once per scene, torn down with it.
 *
 * The GUI mutates its own target object and reports each change upward; when
 * values change from anywhere else (a reset, a reload, switching scenes) the
 * target is refilled and `updateDisplay()` pulls the widgets back in line.
 * Getting that direction of flow backwards is how these panels start lying
 * about what is actually rendering.
 *
 * Three ways out, because a value found by dragging is worth nothing until it
 * leaves the browser:
 *
 *   save to scene file    writes the values into the scene's own `params:`
 *                         block and runs the gate on what it wrote. This is
 *                         the one that makes a change permanent, versioned,
 *                         and visible to anyone who reads the repo afterwards.
 *   copy render command   the audit AND the render, joined by `&&`, with the
 *                         tuned values on both. For a one-off variant.
 *   copy film · <id>      the same for a whole edit, carrying every scene's
 *                         current values.
 *
 * The render command carries its audit for a reason. If tuned values could
 * reach a render without passing back through the gate, every check in this
 * repo would only ever have run against the defaults.
 */
import React, { useEffect, useRef, useState } from 'react';
import GUI from 'lil-gui';
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
  const host = useRef(null);
  const guiRef = useRef(null);
  const targetRef = useRef({});
  const filmCtrls = useRef([]);
  const [note, setNote] = useState('');
  const [saveState, setSaveState] = useState(null);

  const knobs = Object.values(def.params ?? {});
  const diff = knobs.length ? paramDiff(def.params, values) : {};

  // Everything the imperative GUI needs to reach at click time. Kept in a ref
  // so the panel is built once per scene rather than rebuilt on every render —
  // a GUI that is torn down mid-drag loses the drag.
  const live = useRef({});
  live.current = { def, file, values, onChange, onReset, films, setSaveState, setNote };

  useEffect(() => {
    if (!host.current) return undefined;
    const l = () => live.current;
    const gui = new GUI({ container: host.current, title: def.id, width: 280 });
    guiRef.current = gui;

    const target = { ...l().values };
    targetRef.current = target;

    if (!knobs.length) {
      gui.add({ note: 'this scene declares no params' }, 'note').disable();
    }

    for (const d of knobs) {
      const c = d.kind === 'number' ? gui.add(target, d.key, d.min, d.max, d.step)
        : d.kind === 'enum' ? gui.add(target, d.key, d.options)
        : gui.add(target, d.key);
      c.name(d.unit && d.kind === 'number' ? `${d.label} (${d.unit})` : d.label);
      // The declaration's `note` is the hard-won bit — why this number is what
      // it is. lil-gui has nowhere to print it, so it becomes the tooltip.
      if (d.note) c.domElement.title = d.note;
      c.onChange((v) => l().onChange(d.key, v));
    }

    const out = gui.addFolder('output');
    out.add({ f: () => save(l().file, paramSource(l().def.params, l().values), l().setSaveState) }, 'f')
      .name('save to scene file');
    out.add({ f: () => copy(renderCommand(l().def, l().file, l().values), l().setNote) }, 'f')
      .name('copy render command');
    out.add({ f: () => copy(paramSource(l().def.params, l().values), l().setNote) }, 'f')
      .name('copy params block');
    out.add({ f: () => l().onReset() }, 'f').name('reset to defaults');

    // The films this scene belongs to. Which films those are depends only on
    // the scene, so the buttons are stable; only their labels move, and those
    // are refreshed below.
    filmCtrls.current = [];
    if (l().films.length) {
      const ff = gui.addFolder('films');
      l().films.forEach((entry, i) => {
        filmCtrls.current.push(ff.add({ f: () => {
          const now = l().films[i];
          copy(filmCommand(now.film, now.file, now.exportName, now.tuned), l().setNote);
        } }, 'f'));
      });
    }

    return () => { gui.destroy(); guiRef.current = null; filmCtrls.current = []; };
  }, [def]); // eslint-disable-line

  // Values changed from outside the GUI — a reset, a reload, a scene switch.
  // Refill the target and pull the widgets back in line, and mark the ones
  // that no longer sit at their declared default.
  useEffect(() => {
    const gui = guiRef.current;
    if (!gui) return;
    Object.assign(targetRef.current, values);
    for (const c of gui.controllersRecursive()) {
      if (!(c.property in values)) continue;
      c.updateDisplay();
      c.domElement.classList.toggle('dirty', c.property in diff);
    }
  }, [values, diff]);

  // Film labels carry how much of the edit is currently tuned, which changes
  // as you move through the scenes.
  useEffect(() => {
    if (!guiRef.current) return;
    films.forEach((entry, i) => {
      const n = Object.keys(entry.tuned).length;
      // Short enough to fit the button: the long form wrapped and clipped.
      filmCtrls.current[i]?.name(`film · ${entry.film.id}${n ? ` (${n})` : ''}`);
    });
  }, [films]);

  return (
    <aside id="params">
      <div ref={host} className="gui-host" />
      {films.length > 0 && (
        <p className="dim note">
          A film command renders the edit with every scene at the values held
          here. A stitched film renders its scenes into <code>public/</code>{' '}
          first — parameters cannot reach frames that already exist.
        </p>
      )}
      {note && <p className="dim note">{note}</p>}
      {error && <pre className="error">{error}</pre>}
      {saveState && <pre className={saveState.bad ? 'error' : 'report'}>{saveState.text}</pre>}
      {!saveState && Object.keys(diff).length > 0 && (
        <p className="dim note">
          <b>Save</b> writes these into <code>{file}</code> and runs the gate on
          what it wrote — that is what makes the change reviewable, versioned,
          and visible to anyone (or anything) that reads the repo afterwards.
        </p>
      )}
    </aside>
  );
}
