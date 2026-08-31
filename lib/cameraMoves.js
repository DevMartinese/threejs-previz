/**
 * cameraMoves.js — engine-agnostic cinematic camera moves for Three.js.
 *
 * A "move" is a pure function  move(u) -> CameraState  with u in [0,1],
 * authored around a subject at the origin, camera looking down -Z.
 *
 *   CameraState = { position:[x,y,z], target:[x,y,z], fov:number, roll:number }
 *
 * Playback is separated from the move so the SAME move runs under the native
 * Three.js clock, GSAP, or Theatre.js. See the adapters at the bottom.
 *
 * Zero dependencies. `THREE` is only needed by the adapters (they take a
 * THREE.Camera); the move functions themselves are plain math.
 *
 * ---------------------------------------------------------------------------
 * QUICK START (native, no extra libs)
 *
 *   import { moves, playNative } from './cameraMoves.js';
 *   const move = moves.orbit360({ radius: 6, height: 1.5 });
 *   const anim = playNative(camera, move, { duration: 8, easing: 'linear' });
 *   // in your render loop:
 *   function tick() { anim.update(clock.getDelta()); renderer.render(scene, camera); requestAnimationFrame(tick); }
 *
 * react-three-fiber:
 *
 *   function useCameraMove(move, opts) {
 *     const anim = useMemo(() => makeAnimator(move, opts), [move, opts]);
 *     useFrame((state, dt) => anim.apply(state.camera, dt)); // apply advances + writes
 *   }
 *
 * ---------------------------------------------------------------------------
 * FRAMING: authored moves live around the origin. To drop a move into a real
 * scene, wrap it with `reframe(move, { center:[x,y,z], scale })` so the whole
 * path is translated/scaled to your subject without editing the move.
 */

/* =========================================================================
 * Easing functions  e(u) -> u'
 * ======================================================================= */
export const easings = {
  linear: (u) => u,
  easeInSine: (u) => 1 - Math.cos((u * Math.PI) / 2),
  easeOutSine: (u) => Math.sin((u * Math.PI) / 2),
  easeInOutSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  easeInCubic: (u) => u * u * u,
  easeOutCubic: (u) => 1 - Math.pow(1 - u, 3),
  easeInOutCubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  easeInQuart: (u) => u * u * u * u,
  easeOutQuart: (u) => 1 - Math.pow(1 - u, 4),
  easeInOutQuart: (u) => (u < 0.5 ? 8 * u * u * u * u : 1 - Math.pow(-2 * u + 2, 4) / 2),
  easeInExpo: (u) => (u === 0 ? 0 : Math.pow(2, 10 * u - 10)),
  easeOutExpo: (u) => (u === 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  easeInOutExpo: (u) =>
    u === 0 ? 0 : u === 1 ? 1 : u < 0.5
      ? Math.pow(2, 20 * u - 10) / 2
      : (2 - Math.pow(2, -20 * u + 10)) / 2,
  // Cinema Studio "impact": punch in fast, then hold near the end.
  impact: (u) => {
    const k = easings.easeInExpo(Math.min(u / 0.7, 1));
    return u < 0.7 ? k : 1;
  },
};

/* Cinema Studio speedramp -> easing name */
export const speedrampToEasing = {
  linear: 'linear',
  slowmo: 'easeOutCubic',
  speedup: 'easeInCubic',
  impact: 'impact',
  auto: 'easeInOutSine',
  custom: 'easeInOutSine',
};

/* =========================================================================
 * Small vector helpers (arrays, so moves stay dependency-free)
 * ======================================================================= */
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

/** spherical -> cartesian around a center. theta about Y, phi elevation. */
function spherical(R, theta, phi, center = [0, 0, 0]) {
  const cp = Math.cos(phi);
  return [
    center[0] + R * cp * Math.sin(theta),
    center[1] + R * Math.sin(phi),
    center[2] + R * cp * Math.cos(theta),
  ];
}

/* Cheap smooth value noise (deterministic) for handheld shake. */
function hash(n) { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); }
function vnoise(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1; // [-1,1]
}

/* =========================================================================
 * The move catalog.  Each factory returns  move(u) -> CameraState.
 * Defaults assume a subject at origin, ~1.5 tall, framed at radius 6.
 * ======================================================================= */
export const moves = {
  /** 1. Full horizontal circle around a static subject. */
  orbit360({ radius = 6, height = 1.5, phi = 0, startAngle = 0, arc = Math.PI * 2, fov = 45, target = [0, 1, 0] } = {}) {
    return (u) => ({
      position: spherical(radius, startAngle + arc * u, phi, [0, height, 0]),
      target, fov, roll: 0,
    });
  },

  /** 2. Product/character turntable: orbit + gentle push-in + rising elevation. */
  turntable({ radius = 6, arc = Math.PI * 2, startAngle = 0, pushIn = 0.85, phiLow = rad(8), phiHigh = rad(18), fov = 40, target = [0, 1, 0] } = {}) {
    return (u) => {
      const R = lerp(radius, radius * pushIn, u);
      const phi = lerp(phiLow, phiHigh, u);
      return { position: spherical(R, startAngle + arc * u, phi), target, fov, roll: 0 };
    };
  },

  /** 4. Push-in: straight dolly toward subject, FOV fixed. */
  pushIn({ from = 6, to = 3, height = 1.5, fov = 45, target = [0, 1, 0] } = {}) {
    return (u) => ({ position: [0, height, lerp(from, to, u)], target, fov, roll: 0 });
  },

  /** 5. Pull-out: reverse dolly. */
  pullOut({ from = 3, to = 8, height = 1.5, fov = 45, target = [0, 1, 0] } = {}) {
    return moves.pushIn({ from, to, height, fov, target });
  },

  /** 6. Crash zoom: very fast FOV narrowing, camera fixed. Use easing 'impact'. */
  crashZoom({ fovWide = 60, fovTight = 22, from = 5, height = 1.5, target = [0, 1, 0] } = {}) {
    return (u) => ({ position: [0, height, from], target, fov: lerp(fovWide, fovTight, u), roll: 0 });
  },

  /**
   * 7. Dolly zoom (Vertigo). Dolly from dStart->dEnd while deriving FOV to keep
   * the subject the same on-screen size. Do NOT lerp fov — it's computed.
   */
  dollyZoom({ dStart = 6, dEnd = 3, fovStart = 50, height = 1.5, target = [0, 1, 0] } = {}) {
    const k = Math.tan(rad(fovStart) / 2) * dStart;
    return (u) => {
      const d = lerp(dStart, dEnd, u);
      const fov = deg(2 * Math.atan(k / d));
      return { position: [0, height, d], target, fov, roll: 0 };
    };
  },

  /** 8. Boom/crane: vertical lift, target optionally drifting to a reveal point. */
  boomCrane({ yStart = 1.5, yEnd = 8, radius = 6, target = [0, 1, 0], revealTarget = null, fov = 45 } = {}) {
    return (u) => ({
      position: [0, lerp(yStart, yEnd, u), radius],
      target: revealTarget ? lerp3(target, revealTarget, u) : target,
      fov, roll: 0,
    });
  },

  /** 9. Earth zoom: exponential distance traversal. Reverse from/to for zoom-out. */
  earthZoom({ from = 5e6, to = 4, heightRatio = 0.2, fov = 45, target = [0, 0, 0] } = {}) {
    const ratio = to / from;
    return (u) => {
      const R = from * Math.pow(ratio, u);
      return { position: [0, heightRatio * R, R], target, fov, roll: 0 };
    };
  },

  /** 10. Bullet time: fast partial orbit (freeze the rest of the sim yourself). */
  bulletTime({ radius = 6, arc = Math.PI, startAngle = 0, phi = rad(6), fov = 45, target = [0, 1, 0] } = {}) {
    return moves.orbit360({ radius, phi, startAngle, arc, fov, target });
  },

  /** 12. Pan: camera fixed, look direction sweeps horizontally. */
  pan({ position = [0, 1.6, 6], startYaw = rad(-25), endYaw = rad(25), lookDist = 6 } = {}) {
    return (u) => {
      const yaw = lerp(startYaw, endYaw, u);
      return {
        position,
        target: [position[0] + lookDist * Math.sin(yaw), position[1], position[2] - lookDist * Math.cos(yaw)],
        fov: 45, roll: 0,
      };
    };
  },

  /** 13. Tilt: camera fixed, look direction sweeps vertically. */
  tilt({ position = [0, 1.6, 6], startPitch = rad(-15), endPitch = rad(20), lookDist = 6 } = {}) {
    return (u) => {
      const p = lerp(startPitch, endPitch, u);
      return {
        position,
        target: [position[0], position[1] + lookDist * Math.sin(p), position[2] - lookDist * Math.cos(p)],
        fov: 45, roll: 0,
      };
    };
  },

  /** 14. Whip pan: a fast, wide pan (use easing 'easeInOutExpo', short duration). */
  whipPan({ position = [0, 1.6, 6], startYaw = rad(-60), endYaw = rad(60), lookDist = 6 } = {}) {
    return moves.pan({ position, startYaw, endYaw, lookDist });
  },

  /** 15. Truck/crawl: straight slide between two points, look held on a target. */
  truck({ from = [-1, 1.5, 6], to = [1, 1.5, 6], target = [0, 1, 0], fov = 45 } = {}) {
    return (u) => ({ position: lerp3(from, to, u), target, fov, roll: 0 });
  },

  /** 16. Dutch angle: constant roll layered on a base move (or standalone hold). */
  dutchAngle({ base = null, maxRoll = rad(12), ramp = false } = {}) {
    const b = base || moves.pushIn();
    return (u) => {
      const s = b(u);
      return { ...s, roll: (s.roll || 0) + (ramp ? lerp(0, maxRoll, u) : maxRoll) };
    };
  },
};

/* =========================================================================
 * Modifiers — wrap a move to layer behavior on top.
 * ======================================================================= */

/** Handheld shake: coherent-noise wobble on position + roll. */
export function handheld(move, { duration = 5, posAmp = 0.12, rotAmp = rad(1), freq = 2.2 } = {}) {
  return (u) => {
    const s = move(u);
    const t = u * duration * freq;
    return {
      ...s,
      position: [
        s.position[0] + vnoise(t + 1.3) * posAmp,
        s.position[1] + vnoise(t + 5.7) * posAmp,
        s.position[2] + vnoise(t + 9.1) * posAmp * 0.5,
      ],
      roll: (s.roll || 0) + vnoise(t + 7.0) * rotAmp,
    };
  };
}

/**
 * Hand the target off along a chain of waypoints — the orbit whose gaze passes
 * face to face across a table. Eases within each leg, so it slows on every
 * waypoint without ever stopping. Repeat the last waypoint to end on a hold.
 */
export function retarget(move, { targets = [], easing = 'easeInOutSine' } = {}) {
  const e = easings[easing] || easings.linear;
  return (u) => {
    const s = move(u);
    if (!targets.length) return s;
    if (targets.length === 1) return { ...s, target: targets[0] };
    const span = targets.length - 1;
    const i = Math.min(span - 1, Math.floor(u * span));
    return { ...s, target: lerp3(targets[i], targets[i + 1], e(u * span - i)) };
  };
}

/**
 * Slow drift + breathing on the TARGET — the operator's attention, where
 * `handheld` is the operator's body. `duration` is the shot length in seconds so
 * `freq` reads in Hz; `breathe` adds a vertical sine at `breatheFreq`.
 */
export function drift(move, { duration = 5, amp = 0.05, freq = 0.25,
                              breathe = 0, breatheFreq = 0.3 } = {}) {
  return (u) => {
    const s = move(u);
    const t = u * duration * freq;
    const tgt = s.target || [0, 0, 0];
    return {
      ...s,
      target: [
        tgt[0] + vnoise(t + 2.1) * amp,
        tgt[1] + vnoise(t + 4.2) * amp
               + (breathe ? Math.sin(u * duration * breatheFreq * Math.PI * 2) * breathe : 0),
        tgt[2] + vnoise(t + 6.3) * amp,
      ],
    };
  };
}

/**
 * Play only a window of a move. This is how several shot entries share ONE
 * continuous move (a crawl whose framing hero changes mid-cut, say) without
 * restarting its noise or its easing at every entry boundary:
 *
 *   const whole = handheld(drift(base, ...), ...);      // one time base
 *   slice(whole, 0, 1/3)   slice(whole, 1/3, 2/3)   slice(whole, 2/3, 1)
 */
export function slice(move, from = 0, to = 1) {
  return (u) => move(from + (to - from) * u);
}

/** Reframe an origin-authored move onto a real subject (translate + scale). */
export function reframe(move, { center = [0, 0, 0], scale = 1 } = {}) {
  return (u) => {
    const s = move(u);
    const sc = (p) => [center[0] + p[0] * scale, center[1] + p[1] * scale, center[2] + p[2] * scale];
    return { ...s, position: sc(s.position), target: sc(s.target) };
  };
}

/* =========================================================================
 * Sequencing — chain moves into a timeline.
 * segments: [{ move, duration, easing }]
 * Returns a single move(u) over the TOTAL duration plus the total.
 * ======================================================================= */
export function sequence(segments) {
  const total = segments.reduce((a, s) => a + (s.duration ?? 1), 0);
  return {
    duration: total,
    move: (u) => {
      let t = u * total;
      for (const seg of segments) {
        const d = seg.duration ?? 1;
        if (t <= d || seg === segments[segments.length - 1]) {
          const local = d === 0 ? 0 : Math.min(t / d, 1);
          const e = easings[seg.easing] || easings.linear;
          return seg.move(e(local));
        }
        t -= d;
      }
    },
  };
}

/* =========================================================================
 * Core animator — advances time and produces eased CameraState. Engine-free.
 * ======================================================================= */
export function makeAnimator(move, { duration = 5, easing = 'linear', loop = false, onComplete } = {}) {
  const ease = typeof easing === 'function' ? easing : (easings[easing] || easings.linear);
  let elapsed = 0, done = false;
  return {
    reset() { elapsed = 0; done = false; },
    get progress() { return Math.min(elapsed / duration, 1); },
    /** advance by dt seconds, return eased CameraState (or null if finished & !loop) */
    sample(dt) {
      if (done) return null;
      elapsed += dt;
      let u = elapsed / duration;
      if (u >= 1) {
        if (loop) { elapsed %= duration; u = elapsed / duration; }
        else { u = 1; done = true; }
      }
      const st = move(ease(u));
      if (done && onComplete) onComplete();
      return st;
    },
    /** advance + write straight onto a THREE camera */
    apply(camera, dt) {
      const st = this.sample(dt);
      if (st) applyState(camera, st);
      return st;
    },
  };
}

/** Write a CameraState onto a THREE.PerspectiveCamera. */
export function applyState(camera, st) {
  camera.position.set(st.position[0], st.position[1], st.position[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(st.target[0], st.target[1], st.target[2]);
  if (st.roll) camera.rotateZ(st.roll); // roll about the view axis, after lookAt
  if (st.fov != null && camera.fov !== st.fov) {
    camera.fov = st.fov;
    camera.updateProjectionMatrix();
  }
}

/* =========================================================================
 * Adapters
 * ======================================================================= */

/** Native: drive from your render loop. Call anim.update(dt) each frame. */
export function playNative(camera, move, opts = {}) {
  const anim = makeAnimator(move, opts);
  return {
    update(dt) { return anim.apply(camera, dt); },
    reset: () => anim.reset(),
    get progress() { return anim.progress; },
  };
}

/**
 * GSAP: tween a single progress value; apply f(u) in onUpdate.
 * Pass your imported gsap instance. `ease` is a gsap ease string.
 */
export function playGSAP(gsap, camera, move, { duration = 5, ease = 'power2.inOut', ...rest } = {}) {
  const proxy = { u: 0 };
  return gsap.to(proxy, {
    u: 1, duration, ease, ...rest,
    onUpdate: () => applyState(camera, move(proxy.u)),
  });
}

/**
 * Theatre.js: expose the move's raw props as keyframable channels so it can be
 * scrubbed/edited in the studio. Pass a Theatre sheet object and the `types`
 * helper. The move is sampled by the sheet's own playhead (0..1 mapped to u).
 */
export function bindTheatre(sheetObjectFactory, camera, move, { key = 'camera' } = {}) {
  // sheetObjectFactory: (name, props) => theatreObject   (wrap sheet.object)
  const obj = sheetObjectFactory(key, { u: 0 });
  obj.onValuesChange((v) => applyState(camera, move(v.u)));
  return obj; // keyframe obj.props.u from 0->1 over the shot in Theatre studio
}

/* =========================================================================
 * Non-f(u) helpers (moves that read live scene state each frame)
 * ======================================================================= */

/** 3. Float spin: rotate an OBJECT in place (+ optional bob). Call each frame. */
export function floatSpin(object, dt, { speed = (Math.PI * 2) / 5, bobAmp = 0.1, bobFreq = 0.8, clock } = {}) {
  object.rotation.y += speed * dt;
  if (bobAmp && clock) object.position.y += Math.sin(clock.elapsedTime * bobFreq * Math.PI * 2) * bobAmp * dt;
}

/** 15. Tracking follow: hold an offset to a moving subject with damping. Call each frame. */
export function follow(camera, subject, { offset = [0, 2, 8], stiffness = 4, lookAhead = 0, velocity = [0, 0, 0] } = {}, dt = 1 / 60) {
  const p = subject.position;
  const desired = [p.x + offset[0], p.y + offset[1], p.z + offset[2]];
  const a = 1 - Math.exp(-stiffness * dt);
  camera.position.set(
    lerp(camera.position.x, desired[0], a),
    lerp(camera.position.y, desired[1], a),
    lerp(camera.position.z, desired[2], a),
  );
  camera.lookAt(p.x + lookAhead * velocity[0], p.y + lookAhead * velocity[1], p.z + lookAhead * velocity[2]);
}

export default { moves, easings, speedrampToEasing, handheld, retarget, drift, slice, reframe, sequence, makeAnimator, applyState, playNative, playGSAP, bindTheatre, floatSpin, follow };
