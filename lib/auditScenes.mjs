#!/usr/bin/env node
/**
 * auditScenes.mjs — the gate between authoring and rendering.
 *
 * Runs the collision / framing / floor audits on every scene, headlessly, and
 * exits non-zero if any shot fails. Wire it into the render script so a shot that
 * cuts the hero off never becomes a thirty-second render:
 *
 *   "scripts": {
 *     "audit":  "node lib/auditScenes.mjs src/scenes/*.js",
 *     "render": "npm run audit && remotion render roundtable out/roundtable.mp4"
 *   }
 *
 * No WebGL, no browser, no GPU — every audit is bounding boxes, BVH intersection
 * and NDC projection, all of which are plain maths. It runs in a second or two on
 * a scene that takes minutes to render, which is the entire point.
 *
 * Each module must default-export the result of `defineScene()` — or of
 * `defineFilm()`, in which case the cross-scene consistency checks run instead:
 * mismatched fps or dimensions between scenes, and transitions longer than the
 * scenes they join. Those fail silently at render time; the film simply comes out
 * wrong.
 *
 * Flags:
 *   --samples=N   frames sampled per shot (default 6)
 *   --json        machine-readable output
 *   --quiet       only report failures
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

if (!files.length) {
  console.error('usage: node auditScenes.mjs <scene files...> [--samples=6] [--json] [--quiet]');
  process.exit(2);
}

const samples = Number(flag('samples', 6));
const results = [];

for (const file of files) {
  const url = pathToFileURL(resolve(file)).href;
  let mod;
  try {
    mod = await import(url);
  } catch (err) {
    results.push({ id: file, ok: false, error: `import failed: ${err.message}` });
    continue;
  }
  const def = mod.default;

  // A film: no geometry of its own, but the consistency checks between scenes are
  // exactly the failures that come out subtly wrong instead of erroring.
  if (def && typeof def.check === 'function' && Array.isArray(def.scenes)) {
    const problems = def.check();
    results.push({
      id: def.id, file, kind: 'film', ok: problems.length === 0, problems,
      frames: def.durationInFrames,
      text: problems.length
        ? problems.map((p) => `FAIL ${p}`).join('\n')
        : `ok   ${def.scenes.length} scenes, ${def.sceneFrames} frames`
          + (def.transitionFrames ? ` - ${def.transitionFrames} in transitions` : '')
          + ` = ${def.durationInFrames}`,
      ms: 0,
    });
    continue;
  }

  const scene = def;
  if (!scene || typeof scene.audit !== 'function') {
    results.push({ id: file, ok: false, error: 'no defineScene() or defineFilm() default export' });
    continue;
  }
  try {
    const t0 = Date.now();
    const r = scene.audit({ samples });
    results.push({ ...r, file, ms: Date.now() - t0, frames: scene.list.duration });
  } catch (err) {
    results.push({ id: scene.id ?? file, ok: false, error: err.message });
  }
}

const failed = results.filter((r) => !r.ok);

if (has('json')) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  for (const r of results) {
    if (r.error) { console.error(`FAIL ${r.id}: ${r.error}`); continue; }
    if (has('quiet') && r.ok) continue;
    console.log(`\n${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  (${r.frames} frames, audited in ${r.ms}ms)`);
    console.log(r.text.split('\n').map((l) => '  ' + l).join('\n'));
  }
  console.log(failed.length
    ? `\n${failed.length} of ${results.length} scene(s) failed — not safe to render.`
    : `\nall ${results.length} scene(s) clean.`);
}

process.exit(failed.length ? 1 : 0);
