/**
 * writeback.js — the inspector writes the knob values back into the scene file.
 *
 * This is the piece that makes the loop close. The intended way of working is a
 * round trip: ask for a scene, look at it, dislike something, change it, and
 * hand it back saying "carry on from this". That only works if the change is
 * IN THE REPO. A value that lives in a browser tab is invisible to the next
 * person, to git, and to whoever you hand the project to — including an agent
 * you ask to continue, which can read files and cannot read your tab.
 *
 * So the panel does not just print a block to paste. It rewrites the `params:`
 * block in the scene file, and then RUNS THE GATE on what it wrote, because a
 * value that was never audited is exactly what this repo refuses to produce.
 * The result comes back to the panel.
 *
 * Deliberately narrow, since it edits source from a web page:
 *
 *   - dev server only (`apply: 'serve'`); it cannot exist in a build.
 *   - only files under `src/scenes/`, only `.js`.
 *   - only the top-level `params: { … }` block is replaced. Everything else in
 *     the file — the build, the shots, the comments explaining why a number is
 *     what it is — is untouched, because a tool that rewrites a whole file is a
 *     tool that eventually eats a comment somebody needed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { declareParams } from '../lib/params.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ALLOWED = resolve(ROOT, 'src', 'scenes') + sep;

/**
 * Find the top-level `params: {` block by counting braces, skipping over
 * string literals so a `{` inside a `note:` cannot end the scan early.
 * Returns `[start, end)` over the whole `params: { … },` including the comma.
 */
export function findParamsBlock(source) {
  const m = /\n(\s*)params:\s*\{/.exec(source);
  if (!m) return null;
  const start = m.index + 1;                 // keep the newline out of the range
  let i = m.index + m[0].length;             // just past the opening brace
  let depth = 1, quote = null;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  if (source[i] === ',') i++;                // swallow the trailing comma
  return [start, i, m[1]];
}

/**
 * Refuse to write a block that changes anything except the VALUES.
 *
 * This exists because the first version of the generator quietly dropped
 * `label`, so saving from the panel would have deleted every custom label in
 * the file. A rewrite that loses information is worse than no rewrite, and the
 * person it happens to finds out by reading a diff they did not expect. So the
 * incoming block is parsed, re-declared, and compared field by field against
 * what the scene currently declares — ranges, units, labels and notes must
 * survive untouched, or nothing is written.
 */
async function assertOnlyValuesChanged(path, block) {
  const mod = await import(pathToFileURL(path).href);
  const current = mod.default?.params;
  if (!current || !Object.keys(current).length) return;   // nothing to protect

  let parsed;
  try {
    // The block is `params: { … },` — wrap it into an object literal.
    parsed = new Function(`return ({${block.replace(/,\s*$/, '')}})`)().params;
  } catch (err) {
    throw new Error(`the block does not parse as JavaScript: ${err.message}`);
  }
  const next = declareParams(mod.default.id, parsed);

  const shape = (d) => {
    const { value, ...rest } = d;   // eslint-disable-line no-unused-vars
    return JSON.stringify(rest);
  };
  const missing = Object.keys(current).filter((k) => !(k in next));
  if (missing.length) throw new Error(`the block drops ${missing.join(', ')}`);
  const added = Object.keys(next).filter((k) => !(k in current));
  if (added.length) throw new Error(`the block adds ${added.join(', ')} — declare knobs in the file, not here`);
  for (const k of Object.keys(current)) {
    if (shape(current[k]) !== shape(next[k])) {
      throw new Error(`the block would change the declaration of "${k}", not just its value`);
    }
  }
}

/** Run the gate on one file and hand back its report verbatim. */
function audit(file) {
  return new Promise((done) => {
    const p = spawn('node', ['lib/auditScenes.mjs', file], { cwd: ROOT });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ ok: code === 0, text: out.trim() }));
    p.on('error', (err) => done({ ok: false, text: `could not run the gate: ${err.message}` }));
  });
}

/** The Vite dev-server plugin behind the panel's "save to scene file". */
export function paramsWriteback() {
  return {
    name: 'previz-params-writeback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__params', (req, res) => {
        const send = (code, body) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'POST only' });

        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', async () => {
          try {
            const { file, block } = JSON.parse(raw);
            const path = resolve(ROOT, String(file ?? ''));
            if (!path.startsWith(ALLOWED) || !path.endsWith('.js')) {
              return send(403, { error: `refused: only src/scenes/*.js, got ${file}` });
            }
            const source = await readFile(path, 'utf8');
            const found = findParamsBlock(source);
            if (!found) {
              return send(422, {
                error: `no top-level \`params: { … }\` block in ${file} — add one `
                  + `(even empty) and it will be rewritten from then on`,
              });
            }
            const [start, end, indent] = found;
            const body = String(block).replace(/^\s*params:/, `${indent}params:`);
            await assertOnlyValuesChanged(path, body);
            await writeFile(path, source.slice(0, start) + body + source.slice(end));
            send(200, { ok: true, file, audit: await audit(file) });
          } catch (err) {
            send(500, { error: err.message });
          }
        });
      });
    },
  };
}
