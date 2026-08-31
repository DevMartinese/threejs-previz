/**
 * geometry.js — the shape vocabulary for blocking scenes.
 *
 * `blocking.js` gives you the scene, the identity palette and the audits. This
 * module gives you the shapes: the six or seven constructions that between them
 * cover almost everything a blocking pass needs, plus the layout helpers that
 * place many copies of them.
 *
 * Design rules, all of them consequences of blocking being a *judgement* pass:
 *
 *   - EVERYTHING RETURNS PLAIN `BufferGeometry` (or a `Group` for assemblies), so
 *     it composes with `part()`, with CSG, and with the audits.
 *   - EVERY RANDOM SOURCE IS SEEDED. A cloud of debris must land in the same place
 *     on every render, or the scene stops being a function of the frame.
 *   - GEOMETRY IS BUILT AT THE ORIGIN and placed afterwards. Cutting, mirroring
 *     and arraying are all far easier to reason about that way.
 *   - LOW SEGMENT COUNTS BY DEFAULT. Blocking is judged on silhouette and timing;
 *     smooth tessellation costs build time and hides nothing.
 *
 * ---------------------------------------------------------------------------
 * QUICK START
 *
 *   import * as geo from './geometry.js';
 *
 *   // a pour: a tapered tube along a curve
 *   const pour = geo.sweep(geo.curve([[0,.28,0],[.02,.20,0],[.05,.12,0]]),
 *                          { r0: .004, r1: .012 });
 *
 *   // five clones fanned out behind the hero
 *   geo.radial(5, { radius: .17, from: 15, to: 150 })
 *      .forEach((t, i) => place(clone(i), t));
 */

import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, CylinderGeometry,
  ExtrudeGeometry, InstancedMesh, LatheGeometry, Object3D, Path, Quaternion,
  RingGeometry, Shape, SphereGeometry, TorusGeometry, TubeGeometry,
  Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const V3 = (p) => (p instanceof Vector3 ? p : new Vector3(p[0], p[1], p[2]));
const lerp = (a, b, u) => a + (b - a) * u;
const rad = (d) => (d * Math.PI) / 180;

/** Seeded PRNG. Never `Math.random()` in a blocking scene. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =========================================================================
 * 0. Base primitives
 *
 * Every shape in the vocabulary lives in this module — there is no second place
 * to look. Helpers return plain `BufferGeometry`; the ones that describe several
 * coloured parts return **descriptors**, which `ctx.parts()` turns into named
 * meshes. That keeps this module free of any dependency on the scene.
 * ======================================================================= */

/** Profile -> solid of revolution. The workhorse: cups, glasses, bottles, rims. */
export function revolve(profile, segments = 64) {
  const pts = profile.map((p) => (p instanceof Vector2 ? p : new Vector2(p[0], p[1])));
  return new LatheGeometry(pts, segments);
}

/** Closed profile for a walled cup: up the outside, across the rim, down inside. */
export function cupProfile({ rBottom, rTop, h, thickness = 0.0015, base = 0.002 }) {
  const rTopIn = rTop - thickness;
  const rBotIn = rBottom - thickness;
  return [
    [0, 0], [rBottom, 0], [rTop, h], [rTopIn, h],
    [rBotIn, base], [0, base], [0, 0],
  ];
}

/** Truncated cone / cylinder. `open` leaves the caps off. */
export function cone({ rBottom = 0.5, rTop = 0.5, h = 1, segments = 48, open = false } = {}) {
  return new CylinderGeometry(rTop, rBottom, h, segments, 1, open);
}

export function ellipsoid({ rx = 1, ry = 1, rz = 1, segments = 24, rings = 14 } = {}) {
  const g = new SphereGeometry(1, segments, rings);
  g.scale(rx, ry, rz);
  return g;
}

export function box({ x = 1, y = 1, z = 1, segments = 1 } = {}) {
  return new BoxGeometry(x, y, z, segments, segments, segments);
}

export function rim({ radius = 1, thickness = 0.02, segments = 64, tube = 12 } = {}) {
  return new TorusGeometry(radius, thickness, tube, segments);
}

/**
 * A stack of tapered layers — the cross-section vocabulary.
 *
 * Returns **descriptors**, not meshes: `[{ name, geometry, identity, meta }]`.
 * Pass them to `ctx.parts()` to materialise. Neighbouring layers touch by design,
 * so each descriptor is tagged and the collision audit skips adjacent pairs.
 */
export function stack({ layers, rAt, y0 = 0, inset = 0, segments = 48, prefix = '',
                        stackId = `stack${_stackSeq++}` }) {
  const out = [];
  let y = y0;
  for (const layer of layers) {
    const top = y + layer.t;
    const g = new CylinderGeometry(rAt(top) - inset, rAt(y) - inset, layer.t, segments, 1);
    g.translate(0, (y + top) / 2, 0);
    out.push({
      name: prefix + layer.name,
      geometry: g,
      identity: layer.identity,
      meta: { band: [y, top], stack: stackId, stackIndex: out.length },
    });
    y = top;
  }
  return out;
}
let _stackSeq = 0;

/** Three stacked discs — the sandwich-cookie silhouette. Returns descriptors. */
export function sandwich({ name, radius = 0.021, shell = 0.005, fill = 0.004,
                           outer = 'dark', inner = 'cream', segments = 32 }) {
  const mk = (suffix, r, h, y, id) => {
    const g = new CylinderGeometry(r, r, h, segments, 1);
    g.translate(0, y, 0);
    return { name: name + suffix, geometry: g, identity: id };
  };
  return [
    mk('_bot', radius, shell, -(fill / 2 + shell / 2), outer),
    mk('_fill', radius * 0.92, fill, 0, inner),
    mk('_top', radius, shell, +(fill / 2 + shell / 2), outer),
  ];
}

/** A seeded cloud of spheres — powder, splash, debris. Returns descriptors. */
export function cluster({ name, count = 14, radius = 0.05, min = 0.012, max = 0.026,
                          identity, seed = 1 }) {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const size = min + r() * (max - min);
    return {
      name: `${name}_${String(i).padStart(2, '0')}`,
      geometry: new SphereGeometry(size, 12, 8),
      identity,
      position: [(r() * 2 - 1) * radius, (r() * 2 - 1) * radius * 0.6, (r() * 2 - 1) * radius],
    };
  });
}

/* =========================================================================
 * 1. Curves and sweeps
 *
 * A surprising amount of blocking is "a shape travelling along a path":
 * pours, cables, trails, tubes, ribbons of liquid.
 * ======================================================================= */

/** A smooth curve through points. `closed` for loops, `tension` for tightness. */
export function curve(points, { closed = false, tension = 0.5, type = 'catmullrom' } = {}) {
  return new CatmullRomCurve3(points.map(V3), closed, type, tension);
}

/**
 * Sweep a circular cross-section along a curve, optionally tapering.
 * This is the pour / stream / cable primitive.
 *
 * `r0` is the radius at the start, `r1` at the end. `profile(u)` overrides both
 * for anything non-linear (a bulge, a pinch).
 */
export function sweep(path, { r0 = 0.01, r1 = null, segments = 48, radial = 12,
                              closed = false, profile = null } = {}) {
  const rEnd = r1 == null ? r0 : r1;
  const g = new TubeGeometry(path, segments, 1, radial, closed);
  const pos = g.attributes.position;
  // TubeGeometry lays out (segments+1) rings of (radial+1) verts, in order.
  const rings = segments + 1, perRing = radial + 1;
  const centre = new Vector3(), v = new Vector3();
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1);
    const scale = profile ? profile(u) : lerp(r0, rEnd, u);
    centre.copy(path.getPointAt(Math.min(u, 1)));
    for (let j = 0; j < perRing; j++) {
      const k = i * perRing + j;
      v.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(scale).add(centre);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Points spaced evenly along a curve — drops in an arc, beads on a string. */
export function alongCurve(path, count, { jitter = 0, seed = 1 } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    const p = path.getPointAt(u).clone();
    if (jitter) {
      p.x += (r() * 2 - 1) * jitter;
      p.y += (r() * 2 - 1) * jitter;
      p.z += (r() * 2 - 1) * jitter;
    }
    out.push({ position: p.toArray(), u, tangent: path.getTangentAt(u).toArray() });
  }
  return out;
}

/** A ballistic arc between two points — a thrown object, a droplet's path. */
export function arcPath(from, to, { height = 0.1, segments = 24 } = {}) {
  const a = V3(from), b = V3(to);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = a.clone().lerp(b, u);
    p.y += Math.sin(u * Math.PI) * height;
    pts.push(p);
  }
  return curve(pts);
}

/** A helix — spiral staircases, springs, camera rails that climb. */
export function helix({ radius = 1, height = 2, turns = 2, segments = 96, taper = 1 } = {}) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = u * turns * Math.PI * 2;
    const r = radius * lerp(1, taper, u);
    pts.push(new Vector3(r * Math.cos(a), height * u, r * Math.sin(a)));
  }
  return curve(pts);
}

/* =========================================================================
 * 2. 2D shapes and extrusion
 *
 * Anything with a constant cross-section and a flat footprint: slabs, plates,
 * signage, letters, cut-outs.
 * ======================================================================= */

export function roundedRect({ w = 1, h = 1, r = 0.1 } = {}) {
  const s = new Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);      s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);      s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);          s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function polygonShape({ sides = 6, radius = 1, rotation = 0 } = {}) {
  const s = new Shape();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const p = [radius * Math.cos(a), radius * Math.sin(a)];
    i ? s.lineTo(...p) : s.moveTo(...p);
  }
  s.closePath();
  return s;
}

export function starShape({ points = 5, outer = 1, inner = 0.45 } = {}) {
  const s = new Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const p = [r * Math.cos(a), r * Math.sin(a)];
    i ? s.lineTo(...p) : s.moveTo(...p);
  }
  s.closePath();
  return s;
}

/**
 * Extrude a shape into a solid. `holes` are `Path`s subtracted from it — cheaper
 * and far more reliable than a CSG subtraction for anything flat.
 *
 * Extrusion runs along +Z and is re-oriented to stand on the XZ plane by default,
 * which is what you want for slabs and floors.
 */
export function extrude(shape, { depth = 0.1, bevel = 0, bevelSegments = 2,
                                 holes = [], curveSegments = 12, standing = false } = {}) {
  for (const h of holes) shape.holes.push(h);
  const g = new ExtrudeGeometry(shape, {
    depth, curveSegments,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments,
  });
  g.center();
  if (!standing) g.rotateX(-Math.PI / 2);
  return g;
}

/** A `Path` for use as a hole in `extrude`. */
export function hole(shape) {
  const p = new Path();
  p.curves = shape.curves;
  return p;
}

/* =========================================================================
 * 3. Shells and walls
 * ======================================================================= */

/**
 * A hollow cylinder wall — rooms, arenas, tubes, silos. `arc` under 360 leaves an
 * opening. Closed (two-manifold) so it can be cut.
 */
export function wall({ radius = 2, height = 1, thickness = 0.02, arc = 360,
                       segments = 64 } = {}) {
  const outer = radius, inner = radius - thickness;
  const pts = [
    new Vector2(inner, 0), new Vector2(outer, 0),
    new Vector2(outer, height), new Vector2(inner, height),
    new Vector2(inner, 0),
  ];
  return new LatheGeometry(pts, Math.max(3, Math.round(segments * (arc / 360))),
                           0, rad(arc));
}

/** A flat ring — table tops with a hole, discs, halos. */
export function disc({ radius = 1, innerRadius = 0, segments = 48 } = {}) {
  if (innerRadius <= 0) {
    const g = new CylinderGeometry(radius, radius, 0.0001, segments);
    return g;
  }
  const g = new RingGeometry(innerRadius, radius, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A floor grid built from thin bars — the reference grid, readable in solid mode. */
export function gridBars({ size = 2, divisions = 8, thickness = 0.004, height = 0.002 } = {}) {
  const parts = [];
  const step = size / divisions;
  for (let i = 0; i <= divisions; i++) {
    const o = -size / 2 + i * step;
    const a = new BoxGeometry(size, height, thickness); a.translate(0, 0, o);
    const b = new BoxGeometry(thickness, height, size); b.translate(o, 0, 0);
    parts.push(a, b);
  }
  return mergeGeometries(parts);
}

/* =========================================================================
 * 4. Deformers
 *
 * Vertex-level operations that turn a primitive into something with character
 * without leaving the blocking idiom. All deterministic, all in place.
 * ======================================================================= */

function deform(geometry, fn) {
  const pos = geometry.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v, i);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Scale cross-sections along an axis: 1 at the bottom, `factor` at the top. */
export function taper(geometry, { axis = 'y', factor = 0.6, from = null, to = null } = {}) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const lo = from ?? bb.min[axis], hi = to ?? bb.max[axis];
  const span = hi - lo || 1;
  const others = ['x', 'y', 'z'].filter((a) => a !== axis);
  return deform(geometry, (v) => {
    const u = Math.min(Math.max((v[axis] - lo) / span, 0), 1);
    const s = lerp(1, factor, u);
    for (const a of others) v[a] *= s;
  });
}

/** Rotate cross-sections progressively around an axis. */
export function twist(geometry, { axis = 'y', angle = 90 } = {}) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const lo = bb.min[axis], span = (bb.max[axis] - lo) || 1;
  const a = rad(angle);
  const q = new Quaternion(), up = new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  return deform(geometry, (v) => {
    const u = (v[axis] - lo) / span;
    q.setFromAxisAngle(up, a * u);
    v.applyQuaternion(q);
  });
}

/** Bend along an axis — a curved slab, a slouch, a wilting shape. */
export function bend(geometry, { axis = 'y', towards = 'z', angle = 30 } = {}) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const lo = bb.min[axis], span = (bb.max[axis] - lo) || 1;
  const a = rad(angle);
  return deform(geometry, (v) => {
    const u = (v[axis] - lo) / span;
    v[towards] += Math.sin(u * a) * span * u * 0.5;
  });
}

/** Seeded vertex noise — irregularity for organic props. Keep it small. */
export function roughen(geometry, { amount = 0.01, seed = 1, frequency = 1 } = {}) {
  const r = rng(seed);
  const table = Array.from({ length: 512 }, () => r() * 2 - 1);
  const at = (x, y, z) => {
    const i = Math.abs(Math.floor((x * 73.1 + y * 19.7 + z * 41.3) * frequency * 100)) % 512;
    return table[i];
  };
  return deform(geometry, (v) => {
    const n = at(v.x, v.y, v.z);
    v.addScaledVector(v.clone().normalize(), n * amount);
  });
}

/** Lobed capsule — the biscuit / ladyfinger silhouette, in one call. */
export function lobed({ length = 0.09, width = 0.026, height = 0.016, lobes = 3,
                        depth = 0.12, segments = 32 } = {}) {
  const g = new CapsuleGeometry(width / 2, length - width, 6, segments);
  g.rotateZ(Math.PI / 2);
  g.scale(1, height / width, 1);
  return deform(g, (v) => {
    const u = v.x / (length / 2);
    const s = 1 - depth * Math.abs(Math.sin(u * lobes * Math.PI));
    v.y *= s; v.z *= s;
  });
}

/* =========================================================================
 * 5. Layout — where the copies go
 *
 * Returns plain transforms `{ position, rotation, scale }` rather than objects,
 * so the same distribution drives meshes, instances or camera targets.
 * ======================================================================= */

/** Evenly around a circle. `from`/`to` in degrees for a partial fan. */
export function radial(count, { radius = 1, from = 0, to = 360, y = 0,
                                faceCentre = true, centre = [0, 0, 0] } = {}) {
  const out = [];
  const span = to - from;
  const full = Math.abs(span % 360) < 1e-6 && span !== 0;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (full ? count : count - 1);
    const a = rad(from + span * t);
    const x = centre[0] + radius * Math.cos(a);
    const z = centre[2] + radius * Math.sin(a);
    out.push({
      position: [x, centre[1] + y, z],
      rotation: [0, faceCentre ? -a + Math.PI / 2 : 0, 0],
      scale: [1, 1, 1],
      angle: from + span * t,
      index: i,
    });
  }
  return out;
}

/** A rectangular grid of transforms. */
export function grid(cols, rows, { spacing = 1, y = 0, jitter = 0, seed = 1 } = {}) {
  const r = rng(seed);
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * spacing + (jitter ? (r() * 2 - 1) * jitter : 0);
      const z = (j - (rows - 1) / 2) * spacing + (jitter ? (r() * 2 - 1) * jitter : 0);
      out.push({ position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1], index: out.length });
    }
  }
  return out;
}

/** Seeded scatter inside a box — floating debris, crowds, props. */
export function scatter(count, { bounds = [1, 1, 1], seed = 1, centre = [0, 0, 0],
                                 rotate = true, scaleRange = [1, 1] } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = lerp(scaleRange[0], scaleRange[1], r());
    out.push({
      position: [
        centre[0] + (r() * 2 - 1) * bounds[0],
        centre[1] + (r() * 2 - 1) * bounds[1],
        centre[2] + (r() * 2 - 1) * bounds[2],
      ],
      rotation: rotate ? [r() * 6.283, r() * 6.283, r() * 6.283] : [0, 0, 0],
      scale: [s, s, s],
      index: i,
    });
  }
  return out;
}

/** Apply a transform from any of the layout helpers to an Object3D. */
export function place(object, t) {
  object.position.set(...t.position);
  if (t.rotation) object.rotation.set(...t.rotation);
  if (t.scale) object.scale.set(...t.scale);
  return object;
}

/**
 * One draw call for many copies. Use above ~50 repeats — coffee beans, crowds,
 * debris. Note the audits work on meshes, so keep hero objects as real meshes and
 * reserve instancing for background multiplicity.
 */
export function instances(geometry, material, transforms, { name } = {}) {
  const mesh = new InstancedMesh(geometry, material, transforms.length);
  if (name) mesh.name = name;
  const dummy = new Object3D();
  transforms.forEach((t, i) => {
    place(dummy, t);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/* =========================================================================
 * 6. Assemblies — proxies built from primitives
 *
 * Character and furniture blocking. Identity colour does the work of telling
 * them apart; the geometry only has to read as the right silhouette.
 * ======================================================================= */

/**
 * A seated or standing figure proxy. Returns geometry parts keyed by name so the
 * caller can colour them and assemble with `part()`.
 */
export function figure({ height = 1.7, seated = false, armsForward = seated } = {}) {
  const h = height;
  const parts = {};
  const torsoH = seated ? h * 0.34 : h * 0.32;
  const torsoY = seated ? h * 0.30 : h * 0.56;

  const torso = new BoxGeometry(h * 0.20, torsoH, h * 0.12);
  torso.translate(0, torsoY + torsoH / 2, 0);
  parts.torso = torso;

  const head = new SphereGeometry(h * 0.075, 16, 12);
  head.translate(0, torsoY + torsoH + h * 0.075, 0);
  parts.head = head;

  const armL = new BoxGeometry(h * 0.05, h * 0.26, h * 0.05);
  const armR = armL.clone();
  if (armsForward) {
    armL.rotateX(-Math.PI / 2); armR.rotateX(-Math.PI / 2);
    armL.translate(-h * 0.13, torsoY + torsoH * 0.78, h * 0.11);
    armR.translate(+h * 0.13, torsoY + torsoH * 0.78, h * 0.11);
  } else {
    armL.translate(-h * 0.13, torsoY + torsoH * 0.62, 0);
    armR.translate(+h * 0.13, torsoY + torsoH * 0.62, 0);
  }
  parts.arms = mergeGeometries([armL, armR]);

  if (seated) {
    const thighs = new BoxGeometry(h * 0.18, h * 0.07, h * 0.24);
    thighs.translate(0, torsoY, h * 0.13);
    const shins = new BoxGeometry(h * 0.16, h * 0.30, h * 0.07);
    shins.translate(0, torsoY - h * 0.15, h * 0.22);
    parts.legs = mergeGeometries([thighs, shins]);
  } else {
    const legL = new BoxGeometry(h * 0.07, h * 0.52, h * 0.07);
    const legR = legL.clone();
    legL.translate(-h * 0.05, h * 0.26, 0);
    legR.translate(+h * 0.05, h * 0.26, 0);
    parts.legs = mergeGeometries([legL, legR]);
  }
  return parts;
}

/** A chair proxy: seat, back, and either four legs or a single column. */
export function chair({ seatH = 0.45, seatW = 0.45, seatD = 0.45, backH = 0.5,
                        column = false } = {}) {
  const t = 0.04;
  const seat = new BoxGeometry(seatW, t, seatD);
  seat.translate(0, seatH, 0);
  const back = new BoxGeometry(seatW, backH, t);
  back.translate(0, seatH + backH / 2, -seatD / 2 + t / 2);
  const parts = [seat, back];
  if (column) {
    const col = new CylinderGeometry(0.03, 0.03, seatH, 12);
    col.translate(0, seatH / 2, 0);
    const base = new CylinderGeometry(seatW * 0.35, seatW * 0.35, 0.02, 16);
    base.translate(0, 0.01, 0);
    parts.push(col, base);
  } else {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new BoxGeometry(t, seatH, t);
      leg.translate(sx * (seatW / 2 - t), seatH / 2, sz * (seatD / 2 - t));
      parts.push(leg);
    }
  }
  return mergeGeometries(parts);
}

/** A round table on a single column — the archetypal blocking prop. */
export function table({ radius = 0.7, height = 0.72, topThickness = 0.04,
                        columnRadius = 0.07, baseRadius = 0.32, segments = 48 } = {}) {
  const top = new CylinderGeometry(radius, radius, topThickness, segments);
  top.translate(0, height - topThickness / 2, 0);
  const col = new CylinderGeometry(columnRadius, columnRadius, height - topThickness, 16);
  col.translate(0, (height - topThickness) / 2, 0);
  const base = new CylinderGeometry(baseRadius, baseRadius, 0.03, segments);
  base.translate(0, 0.015, 0);
  return mergeGeometries([top, col, base]);
}

/* =========================================================================
 * 7. Utilities
 * ======================================================================= */

/** Merge many geometries into one — fewer draw calls, one mesh for the audits. */
export function merge(geometries) {
  return mergeGeometries(geometries.filter(Boolean));
}

/** Convex hull around points or an existing geometry — quick collision proxies. */
export function hull(input) {
  let points = input;
  if (input instanceof BufferGeometry) {
    const pos = input.attributes.position;
    points = Array.from({ length: pos.count }, (_, i) =>
      new Vector3().fromBufferAttribute(pos, i));
  } else {
    points = input.map(V3);
  }
  return new ConvexGeometry(points);
}

/** Uniform scale so the geometry's largest dimension equals `size`. */
export function fitTo(geometry, size) {
  geometry.computeBoundingBox();
  const d = new Vector3();
  geometry.boundingBox.getSize(d);
  const k = size / Math.max(d.x, d.y, d.z);
  geometry.scale(k, k, k);
  return geometry;
}

/** Move geometry so its base sits on y=0 and it is centred in x/z. */
export function groundAtOrigin(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  return geometry;
}
