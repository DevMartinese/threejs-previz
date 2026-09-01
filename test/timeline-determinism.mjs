#!/usr/bin/env node
/**
 * `defineScene({ timeline })` rests on one claim: seeking a tween timeline is
 * independent of call order. Remotion renders frames out of order across
 * workers, so a timeline that remembers where it was last would hand
 * different workers different frames — silently, with no error.
 *
 * This is the experiment, kept in the repo so the claim stays checkable
 * rather than remembered. `timeline` is duck-typed — anything with
 * `.seek(ms)` that passes this qualifies; anime.js is simply the library
 * measured here.
 *
 *   npm test
 */
import 'animejs/adapters/three';
import { createTimeline } from 'animejs';
import { Object3D } from 'three';

const FPS = 24, N = 48;
const shuffle = () => [...Array(N).keys()].sort(() => Math.random() - 0.5);
const snap = (o) => [o.position.x, o.position.y, o.rotation.y, o.visible ? 1 : 0]
  .map((v) => +Number(v).toFixed(9)).join(',');

/** Read the same frames three ways; return how many disagree. */
function orderSkew(build) {
  const read = (s, f) => { s.tl.seek((f / FPS) * 1000); return snap(s.o); };
  const a = build(), seq = [];
  for (let f = 0; f < N; f++) seq.push(read(a, f));
  const b = build(), shuf = new Array(N);
  for (const f of shuffle()) shuf[f] = read(b, f);
  const c = build(), rev = new Array(N);
  for (let f = N - 1; f >= 0; f--) rev[f] = read(c, f);
  return seq.filter((s, i) => s !== shuf[i] || s !== rev[i]).length;
}
const scene = (props, at = 250, pre = null) => () => {
  const o = new Object3D();
  const tl = createTimeline({ autoplay: false });
  if (pre) tl.add(o, pre, 0);
  tl.add(o, typeof props === 'function' ? props(o) : props, at);
  return { o, tl };
};

let failed = 0;
const expect = (label, build, shouldBeSafe) => {
  const bad = orderSkew(build);
  const safe = bad === 0;
  const ok = safe === shouldBeSafe;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${
    safe ? `${N} frames identical` : `${bad}/${N} frames differ by seek order`}`);
};

console.log('SAFE forms — a scene may be driven by these:');
expect('absolute target', scene({ x: 5, rotateY: 360, duration: 1000, ease: 'inOutQuad' }), true);
expect("relative '+='", scene({ x: '+=5', duration: 1000 }), true);
expect('implicit from = object state', scene((o) => { o.position.x = 2; return { x: 5, duration: 1000 }; }), true);
expect('boolean visible', scene((o) => { o.visible = false; return { visible: true, duration: 1 }; }), true);
expect('[from,to] starting at 0', scene({ x: [1, 5], duration: 1000 }, 0), true);

console.log('\nTHE TRAP — an explicit [from,to] that starts LATE does not restore');
console.log('its own `from` when seeked backwards past its start:');
expect('[from,to] starting at 250ms', scene({ x: [1, 5], duration: 1000 }, 250), false);

console.log('\nThe obvious workaround does NOT hold — pinning the start with a');
console.log('keyframe at 0 still skews under shuffled (not merely reversed) order:');
expect('...pinned by a keyframe at 0', scene({ x: [1, 5], duration: 1000 }, 250, { x: 1, duration: 1 }), false);

console.log('\nWhat actually works:');
expect('...moved to time 0', scene({ x: [1, 5], duration: 1000 }, 0), true);
expect('...or an absolute target at the same offset',
  scene((o) => { o.position.x = 1; return { x: 5, duration: 1000 }; }, 250), true);

console.log(failed
  ? `\n${failed} expectation(s) broke — re-read before driving a scene with a timeline.`
  : '\nall expectations hold: seeking is order-independent except where documented.');
process.exit(failed ? 1 : 0);
