/**
 * blocking.js — build blocking scenes in Three.js instead of a DCC.
 *
 * A blocking scene is primitives with flat identity colours, no textures and no
 * materials worth the name. It exists to lock down three things — what is where,
 * when it moves, and how it is framed — so they can be judged and corrected
 * cheaply, and then handed to a video model as a motion reference.
 *
 * Three rules the whole module is built around:
 *
 *   1. COLOUR IS IDENTITY, not decoration. Every part gets a named colour from a
 *      registered palette. That is what makes a grey blob readable, and what lets
 *      you direct in prose ("cyan over blue's shoulder").
 *   2. EVERYTHING IS NAMED AND GROUPED. `ENV_ / PRP_ / CHR_ / CAM_ / LGT_` so the
 *      scene is addressable by string, not by hunting through a tree.
 *   3. THE SCENE IS A PURE FUNCTION OF THE FRAME. Never `clock.getDelta()`, never
 *      accumulated state. `applyFrame(n)` must produce the same result whether it
 *      is called in order, out of order, or twice. This is what makes the scene
 *      renderable by Remotion and reproducible between passes.
 *
 * Shapes live in `geometry.js`. There is no second place to look.
 *
 * Zero React. `remotion.jsx` renders a context; `shots.js` drives its camera.
 *
 * ---------------------------------------------------------------------------
 * QUICK START
 *
 *   import * as blk from './blocking.js';
 *
 *   import * as blk from './blocking.js';
 *   import * as geo from './geometry.js';
 *
 *   const ctx = blk.createBlocking({ subjectSize: .09 });
 *   ctx.defineIdentity({ kraft: '#8a6136', cream: '#f5efe0', cocoa: '#4c1f13' });
 *
 *   ctx.part('PRP_cup', geo.revolve(geo.cupProfile({ rBottom: .0375, rTop: .045, h: .07 })),
 *            'kraft', ctx.groups.PRP);
 *
 *   const [back, front] = blk.halve(ctx.get('PRP_cup'), 'z');
 *   blk.auditCollisions(ctx.subjects());
 */

import {
  Box3, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, Scene, Vector3,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';

export { SUBTRACTION, INTERSECTION };

/* =========================================================================
 * The scene context
 *
 * Everything scene-specific hangs off a context: its own scene, groups, camera
 * and palette. Nothing lives at module level, so two scenes can be built in the
 * same process — which happens in a film, in the audit gate, and whenever a
 * Remotion worker renders more than one composition — without the second quietly
 * answering questions about the first.
 * ======================================================================= */

export const GROUPS = ['ENV', 'PRP', 'CHR', 'CAM', 'LGT'];

/** A near plane that will not slice through a subject of this size. */
export function nearFor(subjectSize) {
  return Math.max(1e-4, Math.min(0.1, subjectSize * 0.05));
}

/**
 * A scene with the standard groups, a flat light rig, a camera and a palette.
 *
 * `subjectSize` (metres) drives the near plane: the 0.1 default slices through
 * product-scale scenes, and the symptoms — geometry vanishing at close range,
 * glass that never appears — read as modelling bugs rather than camera settings.
 */
export function createBlocking({
  subjectSize = 1,
  aspect = 21 / 9,
  filmGauge = 36,
  focalLength = 50,
  background = '#3a3a3a',
  shaded = true,
} = {}) {
  const scene = new Scene();
  scene.background = new Color(background);

  const groups = {};
  for (const name of GROUPS) {
    const g = new Group();
    g.name = name;
    scene.add(g);
    groups[name] = g;
  }

  const hemi = new HemisphereLight(0xffffff, 0x606060, 2.0);
  hemi.name = 'LGT_hemi';
  const key = new DirectionalLight(0xffffff, 1.6);
  key.name = 'LGT_key';
  key.position.set(-1, 1.4, 1.2).multiplyScalar(Math.max(subjectSize, 1) * 3);
  groups.LGT.add(hemi, key);

  const camera = new PerspectiveCamera(45, aspect, 1, 1000);
  camera.name = 'CAM_main';
  camera.filmGauge = filmGauge;
  camera.near = nearFor(subjectSize);
  camera.far = Math.max(100, subjectSize * 1e4);
  camera.setFocalLength(focalLength);
  camera.updateProjectionMatrix();
  groups.CAM.add(camera);

  const palette = new Map();

  const ctx = {
    scene, groups, camera, palette, subjectSize,

    /** Register this scene's identity colours. Scoped: no other scene sees them. */
    defineIdentity(map, opts = {}) {
      const M = (opts.shaded ?? shaded) ? MeshLambertMaterial : MeshBasicMaterial;
      for (const [name, hex] of Object.entries(map)) {
        palette.set(name, new M({ color: new Color(hex), name }));
      }
      return ctx;
    },

    material(name) {
      const m = palette.get(name);
      if (!m) {
        throw new Error(`unknown identity "${name}" — call ctx.defineIdentity() first `
          + `(known: ${[...palette.keys()].join(', ') || 'none'})`);
      }
      return m;
    },

    /** A named, identity-coloured mesh. The name is how you address it later. */
    part(name, geometry, identity, parent = groups.PRP) {
      const mesh = new Mesh(geometry, ctx.material(identity));
      mesh.name = name;
      mesh.userData.identity = identity;
      parent.add(mesh);
      return mesh;
    },

    /**
     * Materialise descriptors from `geometry.js` — `stack()`, `sandwich()` and
     * `cluster()` all return `[{ name, geometry, identity, position?, meta? }]`.
     */
    parts(descriptors, parent = groups.PRP) {
      return descriptors.map((d) => {
        const mesh = ctx.part(d.name, d.geometry, d.identity, parent);
        if (d.position) mesh.position.set(...d.position);
        if (d.rotation) mesh.rotation.set(...d.rotation);
        if (d.scale) mesh.scale.set(...d.scale);
        if (d.meta) Object.assign(mesh.userData, d.meta);
        return mesh;
      });
    },

    /** A named empty — aim targets, orbit pivots, rigs. */
    pivot(name, position = [0, 0, 0], parent = groups.PRP) {
      const o = new Object3D();
      o.name = name;
      o.position.set(...position);
      parent.add(o);
      return o;
    },

    /** Look a part up **in this scene**. Throws rather than returning undefined. */
    get(name) {
      const o = scene.getObjectByName(name);
      if (!o) throw new Error(`no object named "${name}" in this scene`);
      return o;
    },

    /** Every mesh in this scene. */
    meshes() { return meshesOf(scene); },

    /** The meshes the audits care about — scenery excluded. */
    subjects(opts) { return subjectsOf(scene, opts); },
  };

  return ctx;
}

/* =========================================================================
 * Traversal
 * ======================================================================= */

/** Every mesh under a root, flattened. */
export function meshesOf(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

/**
 * The meshes the audits actually care about: everything except scenery.
 *
 * Floors and walls are *supposed* to run past the frame edge and *supposed* to be
 * touched by everything resting on them, so auditing them produces noise that
 * drowns the real findings. Excluded by group name, `ENV` by default.
 */
export function subjectsOf(root, { exclude = ['ENV'] } = {}) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (exclude.includes(p.name)) return;
    out.push(o);
  });
  return out;
}

/* =========================================================================
 * CSG — the cuts
 *
 * Brushes must be two-manifold (watertight). Open shells produce garbage, so
 * build cut targets closed: `cupProfile` returns a closed profile for exactly
 * this reason.
 * ======================================================================= */

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];

/** Boolean two meshes. Returns a new named mesh; neither input is modified. */
export function boolean(a, b, op = SUBTRACTION, { name, material } = {}) {
  const ba = a instanceof Brush ? a : new Brush(a.geometry.clone(), a.material);
  const bb = b instanceof Brush ? b : new Brush(b.geometry.clone(), b.material);
  ba.position.copy(a.position); ba.rotation.copy(a.rotation); ba.scale.copy(a.scale);
  bb.position.copy(b.position); bb.rotation.copy(b.rotation); bb.scale.copy(b.scale);
  ba.updateMatrixWorld(true); bb.updateMatrixWorld(true);

  const result = evaluator.evaluate(ba, bb, op);
  result.name = name || `${a.name}_cut`;
  result.material = material || a.material;
  result.userData.identity = a.userData.identity;
  return result;
}

function halfSpace(axis, side, size) {
  const g = new BoxGeometry(size, size, size);
  const off = (size / 2) * (side > 0 ? 1 : -1);
  g.translate(axis === 'x' ? off : 0, axis === 'y' ? off : 0, axis === 'z' ? off : 0);
  return new Brush(g);
}

/**
 * Cut a mesh in half along a world axis. Returns `[negative, positive]`, both
 * named and both carrying the original identity — the cross-section reveal.
 */
export function halve(mesh, axis = 'z', { size = 100, parent = mesh.parent } = {}) {
  const out = ['neg', 'pos'].map((tag, i) => {
    const cutter = halfSpace(axis, i === 0 ? -1 : 1, size);
    cutter.updateMatrixWorld(true);
    const half = boolean(mesh, cutter, INTERSECTION, { name: `${mesh.name}_${tag}` });
    if (parent) parent.add(half);
    return half;
  });
  if (parent) parent.remove(mesh);
  return out;
}

/**
 * Slice a mesh into bands along an axis. `cuts` are the world coordinates of the
 * planes: `bands(cup, 'y', [0.172, 0.194])` gives three slices.
 */
export function bands(mesh, axis = 'y', cuts = [], { size = 100, parent = mesh.parent } = {}) {
  const edges = [-size / 2, ...cuts, size / 2];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const g = new BoxGeometry(size, size, size);
    const mid = (Math.max(lo, -size / 2) + Math.min(hi, size / 2)) / 2;
    g.scale(axis === 'x' ? (hi - lo) / size : 1,
            axis === 'y' ? (hi - lo) / size : 1,
            axis === 'z' ? (hi - lo) / size : 1);
    g.translate(axis === 'x' ? mid : 0, axis === 'y' ? mid : 0, axis === 'z' ? mid : 0);
    const cutter = new Brush(g);
    cutter.updateMatrixWorld(true);
    const slice = boolean(mesh, cutter, INTERSECTION, { name: `${mesh.name}_b${out.length}` });
    if (slice.geometry.attributes.position.count === 0) continue;   // cut fell outside
    if (parent) parent.add(slice);
    out.push(slice);
  }
  if (parent) parent.remove(mesh);
  return out;
}

/* =========================================================================
 * The three audits
 *
 * Blocking is validated by measuring, not by looking. Every one of these
 * catches a class of error that reads as fine in a still and wrong in motion.
 * ======================================================================= */

/** `'PRP_chair_*'` -> RegExp, so intentional contact can be declared by pattern. */
function globToRe(glob) {
  return new RegExp('^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                      .replace(/\*/g, '.*') + '$');
}

/** Layers built by `stack` touch their neighbours on purpose — not a collision. */
function isStackNeighbour(a, b) {
  const sa = a.userData.stack, sb = b.userData.stack;
  return sa !== undefined && sa === sb &&
         Math.abs(a.userData.stackIndex - b.userData.stackIndex) === 1;
}

function ensureBVH(mesh) {
  if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
  return mesh.geometry.boundsTree;
}

/**
 * Which meshes actually intersect. Broad-phase on world AABBs, then exact
 * triangle-level via BVH. Returns `[{ a, b }]`.
 *
 * Pass `ignore: [['PRP_cup','PRP_lid']]` for pairs that are meant to touch.
 */
export function auditCollisions(objects, { ignore = [], ignoreAdjacent = true } = {}) {
  const meshes = objects.filter((o) => o.isMesh && o.visible);
  // updateWorldMatrix(true, …) walks the ancestors too — a mesh inside a rig
  // pivot measures at the pivot's position, not at the origin. Plain
  // updateMatrixWorld(true) trusts the parent's matrixWorld, which headless
  // Node has never computed.
  meshes.forEach((m) => m.updateWorldMatrix(true, false));
  const patterns = ignore.map(([a, b]) => [globToRe(a), globToRe(b)]);
  const skipPair = (x, y) =>
    patterns.some(([pa, pb]) => (pa.test(x) && pb.test(y)) || (pa.test(y) && pb.test(x)));
  const boxes = meshes.map((m) => new Box3().setFromObject(m));
  const hits = [];
  const mat = new Matrix4();

  for (let i = 0; i < meshes.length; i++) {
    for (let j = i + 1; j < meshes.length; j++) {
      if (skipPair(meshes[i].name, meshes[j].name)) continue;
      if (ignoreAdjacent && isStackNeighbour(meshes[i], meshes[j])) continue;
      if (!boxes[i].intersectsBox(boxes[j])) continue;          // broad phase
      const bvh = ensureBVH(meshes[i]);
      ensureBVH(meshes[j]);
      mat.copy(meshes[i].matrixWorld).invert().multiply(meshes[j].matrixWorld);
      if (bvh.intersectsGeometry(meshes[j].geometry, mat)) {
        hits.push({ a: meshes[i].name, b: meshes[j].name });
      }
    }
  }
  return hits;
}

/**
 * How far outside the frame the subject goes. 0 = fully inside.
 * The single most useful check: it catches shots that read fine in the viewport
 * and clip the hero at the frame edge in the render.
 */
export function auditFraming(objects, camera, { margin = 0.02 } = {}) {
  camera.updateMatrixWorld(true);
  const v = new Vector3();
  let worst = 0, who = null;
  const bounds = { uMin: 1, uMax: 0, vMin: 1, vMax: 0 };

  for (const o of objects) {
    if (!o.isMesh || !o.visible) continue;
    o.updateWorldMatrix(true, false);
    const b = new Box3().setFromObject(o);
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      v.project(camera);
      if (v.z > 1) continue;                                     // behind camera
      const u = (v.x + 1) / 2, w = (v.y + 1) / 2;
      bounds.uMin = Math.min(bounds.uMin, u); bounds.uMax = Math.max(bounds.uMax, u);
      bounds.vMin = Math.min(bounds.vMin, w); bounds.vMax = Math.max(bounds.vMax, w);
      const over = Math.max(-u, u - 1, -w, w - 1, 0);
      if (over > worst) { worst = over; who = o.name; }
    }
  }
  return { ...bounds, overshoot: worst, worstObject: who, ok: worst <= margin };
}

/** Nothing should sink through the ground plane. Returns the lowest offender. */
export function auditFloor(objects, { y = 0, tolerance = 1e-3 } = {}) {
  let min = Infinity, who = null;
  for (const o of objects) {
    if (!o.isMesh || !o.visible) continue;
    o.updateWorldMatrix(true, false);
    const b = new Box3().setFromObject(o);
    if (b.min.y < min) { min = b.min.y; who = o.name; }
  }
  return { minY: min, worstObject: who, ok: min >= y - tolerance };
}

/* =========================================================================
 * Visibility
 *
 * Shots, camera paths and the audit-across-a-timeline live in `shots.js`, which
 * bridges this module with the camera-moves catalog. Visibility stays here
 * because it is a property of the scene, not of the camera.
 * ======================================================================= */

/** Visibility as a pure function of frame: [{ name, from, to }]. */
export function applyVisibility(scene, spans, frame) {
  for (const s of spans) {
    const o = scene.getObjectByName(s.name);
    if (o) o.visible = frame >= s.from && frame < s.to;
  }
}
