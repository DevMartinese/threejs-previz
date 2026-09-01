/**
 * inspector.jsx — look at a scene from outside the shot.
 *
 * The audits tell you a shot fails and name the frame and the object; this
 * tells you what that looks like in space. It is READ-ONLY on purpose: the
 * gate stays the authority, the inspector explains its findings. Nothing
 * here can be dragged into a new value, because the moment a camera is
 * placed by eye instead of by a move, the pipeline loses what it is for.
 *
 * It reuses `defineScene`'s own `make()`, `applyFrame` and `animate` — the
 * same pure functions Remotion renders — so what you inspect IS what
 * renders. There is no second implementation to drift.
 *
 * Two modes:
 *   SHOT  the free camera is slaved to the shot camera: exactly the render.
 *   FREE  orbit anywhere; the shot camera is drawn as a frustum travelling
 *         along its own path, which is drawn as a line coloured per shot.
 */
import React, { useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import {
  BufferGeometry, CameraHelper, Color, Float32BufferAttribute, GridHelper,
  Line, LineBasicMaterial, PerspectiveCamera, SphereGeometry, MeshBasicMaterial,
  Mesh, Box3, Box3Helper,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useThree, useFrame } from '@react-three/fiber';
import { applyFrame } from './shots.js';
import { nearFor } from './blocking.js';

/** Distinct hues per shot so cuts are visible as colour changes on the path. */
const SHOT_HUES = [0.02, 0.13, 0.28, 0.42, 0.52, 0.62, 0.72, 0.82, 0.9, 0.07,
                   0.18, 0.34, 0.47, 0.57, 0.67, 0.77];

/**
 * The camera path as a coloured polyline plus a marker at every cut.
 * Sampled with the scene's own `applyFrame` on a throwaway camera, so the
 * line is the trajectory that will actually be rendered.
 */
export function buildPath(def) {
  const cam = new PerspectiveCamera(45, def.width / def.height, 0.01, 1e5);
  cam.filmGauge = def.filmGauge ?? 36;
  const pos = [], col = [], cuts = [];
  const c = new Color();
  def.list.shots.forEach((shot, si) => {
    c.setHSL(SHOT_HUES[si % SHOT_HUES.length], 0.85, 0.55);
    for (let f = shot.from; f < shot.to; f++) {
      applyFrame(cam, def.list, f);
      pos.push(cam.position.x, cam.position.y, cam.position.z);
      col.push(c.r, c.g, c.b);
    }
    applyFrame(cam, def.list, shot.from);
    cuts.push({ name: shot.name, frame: shot.from, p: cam.position.clone(), colour: c.clone() });
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return { geometry: g, cuts };
}

/** Everything the inspector adds on top of the scene, as one group. */
function Overlay({ def, ctx, shotCam, frame, show }) {
  const { scene } = useThree();
  const path = useMemo(() => buildPath(def), [def]);

  const objects = useMemo(() => {
    const made = [];
    const line = new Line(path.geometry,
      new LineBasicMaterial({ vertexColors: true, depthTest: false }));
    line.renderOrder = 999;
    line.name = 'INS_path';
    made.push(['path', line]);

    for (const cut of path.cuts) {
      const m = new Mesh(new SphereGeometry(def.subjectSize * 0.06, 12, 8),
        new MeshBasicMaterial({ color: cut.colour, depthTest: false }));
      m.position.copy(cut.p);
      m.renderOrder = 1000;
      made.push(['cuts', m]);
    }

    const helper = new CameraHelper(shotCam);
    helper.name = 'INS_frustum';
    made.push(['frustum', helper]);

    const grid = new GridHelper(def.subjectSize * 40, 40, 0x666666, 0x3a3a3a);
    grid.material.depthTest = false;
    made.push(['grid', grid]);
    return made;
  }, [def, path, shotCam]);

  useLayoutEffect(() => {
    for (const [, o] of objects) scene.add(o);
    return () => { for (const [, o] of objects) scene.remove(o); };
  }, [scene, objects]);

  useLayoutEffect(() => {
    for (const [kind, o] of objects) o.visible = show[kind] !== false;
  }, [objects, show]);

  // hero boxes for the shot that owns this frame — what must stay in frame
  const heroRef = useRef([]);
  useLayoutEffect(() => {
    for (const h of heroRef.current) scene.remove(h);
    heroRef.current = [];
    if (show.heroes === false) return;
    const shot = def.list.at(frame);
    if (!shot || !shot.hero) return;
    const pats = [].concat(shot.hero).map((g) =>
      new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
    ctx.scene.traverse((m) => {
      if (!m.isMesh || !m.visible || !pats.some((re) => re.test(m.name))) return;
      const h = new Box3Helper(new Box3().setFromObject(m), 0x00ff88);
      h.material.depthTest = false;
      scene.add(h);
      heroRef.current.push(h);
    });
  }, [scene, ctx, def, frame, show.heroes]);

  useFrame(() => {
    const h = objects.find(([k]) => k === 'frustum');
    if (h) h[1].update();
  });
  return null;
}

/**
 * The inspector stage. Mount inside an R3F `<Canvas>`.
 *
 * `mode` is 'shot' (the free camera is driven to match the render exactly)
 * or 'free' (orbit; the shot camera becomes a visible frustum).
 */
export function InspectorStage({ def, frame, mode = 'free', show = {} }) {
  const { camera, gl, scene, size } = useThree();
  const ctx = useMemo(() => def.make(), [def]);

  // Switching scenes builds a whole new context; without this the old one's
  // buffers stay on the GPU. Measured on tiramisu: 115 geometries and 17
  // materials leaked per switch. Remotion never hits this (one build per
  // worker, then the process ends) — an interactive viewer does, every time
  // you change the dropdown.
  useEffect(() => () => {
    ctx.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose();
      }
    });
  }, [ctx]);

  const shotCam = useMemo(() => {
    const c = new PerspectiveCamera(45, def.width / def.height,
      nearFor(def.subjectSize), Math.max(100, def.subjectSize * 1e4));
    c.filmGauge = def.filmGauge ?? 36;
    return c;
  }, [def]);

  // the scene itself, mounted WHOLE — <primitive> reparents what it mounts,
  // and mounting the groups one by one silently empties ctx.scene
  useLayoutEffect(() => {
    scene.add(ctx.scene);
    scene.background = ctx.scene.background;
    return () => { scene.remove(ctx.scene); };
  }, [scene, ctx]);

  const controls = useRef(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    controls.current = c;
    return () => c.dispose();
  }, [camera, gl]);

  // per frame: pose the objects, then the shot camera — the same order and
  // the same functions the renderer uses
  useLayoutEffect(() => {
    if (def.pose) def.pose(ctx, frame);
    else if (def.animate) def.animate({ ctx, frame, fps: def.fps });
    applyFrame(shotCam, def.list, frame);
    shotCam.updateMatrixWorld(true);
  }, [ctx, def, frame, shotCam]);

  useFrame(() => {
    if (mode === 'shot') {
      camera.position.copy(shotCam.position);
      camera.quaternion.copy(shotCam.quaternion);
      camera.fov = shotCam.fov;
      camera.filmGauge = shotCam.filmGauge;
      camera.near = shotCam.near;
      camera.far = shotCam.far;
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      if (controls.current) controls.current.enabled = false;
    } else {
      if (controls.current) { controls.current.enabled = true; controls.current.update(); }
    }
  });

  return <Overlay def={def} ctx={ctx} shotCam={shotCam} frame={frame} show={show} />;
}

/** The report for the frame under the playhead — which shot owns it. */
export function shotAt(def, frame) {
  const s = def.list.at(frame);
  if (!s) return null;
  return {
    name: s.name, from: s.from, to: s.to,
    hero: s.hero ? [].concat(s.hero).join(', ') : '(transitional)',
    focalLength: s.focalLength ?? null,
    progress: def.list.progress(frame),
  };
}
