/**
 * params.js — a scene's knobs, declared.
 *
 * A scene is a pure function of the frame. Parameters do not change that: they
 * make it a pure function of `(params, frame)`, where `params` is fixed for the
 * whole render and resolved ONCE, at build time. Nothing reads a knob per frame
 * from a mutable global, so two workers rendering frames 0 and 400 of the same
 * job cannot disagree.
 *
 * They are DECLARED, in the same spirit as `ignore` and `hero`: the scene states
 * what may vary and inside what range, and everything else — the inspector's
 * sliders, the range check on a pasted render command, the block you copy back
 * into the scene file — is derived from that declaration and never restated.
 *
 *   params: {
 *     dipDepth:  { value: -3.6, min: -8, max: -1, step: 0.1, unit: 'm',
 *                  note: 'how far under the floor the camera sinks' },
 *     apex:      { value: 73, min: 20, max: 88, step: 1, unit: 'deg' },
 *     headlights:{ value: true },
 *     lens:      { value: 'wide', options: ['wide', 'normal', 'long'] },
 *   }
 *
 * A number MUST declare `min` and `max`. Not because the maths needs them, but
 * because a knob without a range is an invitation to drag it until the shot
 * breaks and then widen the audit to match. The range is the author saying what
 * the scene is still the scene inside.
 *
 * `resolve` REJECTS an unknown key or an out-of-range value rather than clamping
 * it. A render command copied out of the inspector months ago, against a scene
 * that has since dropped a knob, must fail loudly — not render something that
 * is quietly not what the command says.
 */

/** Normalise a declaration into a uniform table: {key: {kind, value, ...}}. */
export function declareParams(id, params = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(params)) {
    const d = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { value: raw };
    const where = `defineScene(${id}).params.${key}`;
    if (d.value === undefined) throw new Error(`${where}: needs a value`);

    if (Array.isArray(d.options)) {
      if (!d.options.includes(d.value))
        throw new Error(`${where}: value ${JSON.stringify(d.value)} is not one of ${d.options.join(', ')}`);
      out[key] = { kind: 'enum', key, value: d.value, options: d.options, label: d.label ?? key, note: d.note ?? '' };
      continue;
    }
    if (typeof d.value === 'boolean') {
      out[key] = { kind: 'bool', key, value: d.value, label: d.label ?? key, note: d.note ?? '' };
      continue;
    }
    if (typeof d.value !== 'number')
      throw new Error(`${where}: only numbers, booleans and enums (declare \`options\`)`);
    if (typeof d.min !== 'number' || typeof d.max !== 'number')
      throw new Error(`${where}: a number needs min and max — a knob without a range is a knob you drag until the shot breaks`);
    if (d.min > d.max) throw new Error(`${where}: min ${d.min} is above max ${d.max}`);
    if (d.value < d.min || d.value > d.max)
      throw new Error(`${where}: default ${d.value} is outside [${d.min}, ${d.max}]`);
    out[key] = {
      kind: 'number', key, value: d.value, min: d.min, max: d.max,
      step: d.step ?? Number(((d.max - d.min) / 100).toPrecision(1)),
      unit: d.unit ?? '', label: d.label ?? key, note: d.note ?? '',
    };
  }
  return out;
}

/** The declared defaults, as a plain object — what renders when nothing is passed. */
export function paramDefaults(schema) {
  const out = {};
  for (const [k, d] of Object.entries(schema)) out[k] = d.value;
  return out;
}

/**
 * Defaults with `overrides` applied, validated against the declaration.
 * Throws on an unknown key or an out-of-range value; see the note above.
 */
export function resolveParams(id, schema, overrides = {}) {
  const out = paramDefaults(schema);
  if (!overrides) return out;
  for (const [key, v] of Object.entries(overrides)) {
    const d = schema[key];
    if (!d) {
      const known = Object.keys(schema);
      throw new Error(`${id}: unknown parameter "${key}"`
        + (known.length ? ` — declared: ${known.join(', ')}` : ' — this scene declares none'));
    }
    if (d.kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${id}.${key}: ${JSON.stringify(v)} is not a number`);
      if (n < d.min || n > d.max)
        throw new Error(`${id}.${key}: ${n} is outside the declared range [${d.min}, ${d.max}]`);
      out[key] = n;
    } else if (d.kind === 'bool') {
      out[key] = Boolean(v);
    } else {
      if (!d.options.includes(v))
        throw new Error(`${id}.${key}: ${JSON.stringify(v)} is not one of ${d.options.join(', ')}`);
      out[key] = v;
    }
  }
  return out;
}

/** Only what differs from the declared defaults — what a render command has to carry. */
export function paramDiff(schema, values) {
  const out = {};
  for (const [k, d] of Object.entries(schema)) {
    if (values[k] !== undefined && values[k] !== d.value) out[k] = values[k];
  }
  return out;
}

/**
 * The `params:` block to paste back into the scene file, with the current
 * values as the new defaults. The point of the inspector is to FIND a value;
 * the point of this is that the value then lives in the scene, under the gate,
 * instead of in a shell command someone has to remember.
 */
export function paramSource(schema, values, indent = '  ') {
  // Single quotes, because that is what these files are written in and a tool
  // that rewrites source should leave it looking like the source.
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  const lines = Object.values(schema).map((d) => {
    const v = values[d.key] ?? d.value;
    const parts = [`value: ${typeof v === 'string' ? q(v) : v}`];
    if (d.kind === 'number') {
      parts.push(`min: ${d.min}`, `max: ${d.max}`, `step: ${d.step}`);
      if (d.unit) parts.push(`unit: ${q(d.unit)}`);
    }
    if (d.kind === 'enum') parts.push(`options: [${d.options.map(q).join(', ')}]`);
    // `label` is emitted whenever it is not just the key. It was dropped here
    // once, and saving from the panel silently deleted every custom label in
    // the file — a rewrite that loses information is worse than no rewrite.
    if (d.label && d.label !== d.key) parts.push(`label: ${q(d.label)}`);

    const head = `${indent}  ${d.key}: { ${parts.join(', ')}`;
    if (!d.note) return `${head} },`;
    // Long entries wrap the note onto its own line, which is how these blocks
    // are written by hand — a saved file should not be diffable only by
    // reformatting it back.
    const oneLine = `${head}, note: ${q(d.note)} },`;
    return oneLine.length <= 100
      ? oneLine
      : `${head},\n${indent}    note: ${q(d.note)} },`;
  });
  return `${indent}params: {\n${lines.join('\n')}\n${indent}},`;
}
