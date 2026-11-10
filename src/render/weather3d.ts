// The weather on the map (docs/design.md, "Weather"): rain streaks or snowflakes falling over the view, and a
// morning mist lying in a few thin layers over the ground. The light (render/daycycle.ts) and the wet roads
// (render/envShader.ts, envPuddle) are drawn by the materials the map already has; this is only what falls and
// what hangs in the air.
//
// Two draw calls at most, nothing moved on the CPU: the drops are a fixed pool of instanced quads whose places are
// hashed into a tile of ground that wraps round the view, and the vertex shader drops them through a column of air
// and draws each as a streak (rain) or a soft flake (snow) a pixel or a few across, at every zoom. The column, the
// streak and the fall are scaled to the view, so rain reads the same zoomed in or out (a stylised rain: real drops
// seen from a kilometre up would not show at all). The mist is three stacked sheets of soft noise drifting with the
// wind; whatever is taller than the mist stands out of it.

import * as THREE from "three";
import type { Weather } from "../game/weather";
import { ENV } from "./envShader";
import type { View } from "./view";
import { windNow } from "./wind";

/** Drops in the pool (rain and snow share it): the most that fall at once, in a downpour. */
export const MAX_DROPS = 9000;
/** Mist sheets, and how high each lies (m). */
const MIST_H = [0.9, 2.6, 5.2];
/** The precipitation's clock wraps at this (s): every rate in it is free to jump once a wrap, unseen in a downpour. */
const CLOCK_LOOP = 600;
/** Past this zoom (half the view's height, m) the rain and the mist fade out: from there the map is an atlas. */
const FADE_FROM = 1300, FADE_TO = 2400;

const PRECIP_VS = /* glsl */ `
attribute vec4 aR;
uniform vec2 uC; uniform float uT; uniform float uH; uniform float uSpeed; uniform float uLen; uniform float uTime;
uniform float uSnow; uniform vec2 uDrift; uniform vec2 uPx; uniform float uWidth; uniform float uSway;
varying vec2 vUv; varying float vA;
void main() {
  // its column of air: a place hashed into a tile of ground that wraps round the view
  vec2 p = aR.xy * uT;
  p -= uT * floor((p - (uC - 0.5 * uT)) / uT);
  // how high it is now: falling from the top of the column to the ground, then round again
  float sp = uSpeed * (0.82 + 0.36 * fract(aR.w * 7.31));
  float k = fract(aR.z - uTime * sp / uH);
  float h = k * uH;
  // it falls with the wind's lean, landing on its own spot
  vec3 lean = vec3(-uDrift.x, 1.0, -uDrift.y);
  vec3 A = vec3(p.x, 0.0, p.y) + lean * h;
  // (a flake wanders as it comes down)
  A.xz += uSnow * uSway * vec2(sin(uTime * 1.3 + aR.z * 41.0), cos(uTime * 1.07 + aR.x * 37.0));
  vec3 B = A + lean * uLen;
  vec4 ca = projectionMatrix * viewMatrix * vec4(A, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(B, 1.0);
  // across the screen, in pixels: a streak from the drop up along its fall, a pixel or so wide
  vec2 d = (cb.xy - ca.xy) / uPx;
  float L = length(d);
  vec2 dir = L > 0.01 ? d / L : vec2(0.0, 1.0);
  // (turned so the quad keeps its winding: the other way round it faces away and is culled)
  vec2 nrm = vec2(dir.y, -dir.x);
  float len = mix(max(L, 5.0), 0.0, uSnow);
  float w = mix(uWidth, uWidth * (0.75 + 0.6 * fract(aR.w * 3.7)), uSnow);
  vec2 off = mix(nrm * position.x * w + dir * (position.y + 0.5) * len, position.xy * w, uSnow);
  gl_Position = vec4(ca.xy + off * uPx, ca.z, 1.0);
  vUv = position.xy * 2.0;
  // (faint as it starts at the top of its column, and as it reaches the ground)
  vA = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.75, 1.0, k)) * (0.55 + 0.45 * fract(aR.w * 13.1));
}`;

const PRECIP_FS = /* glsl */ `
uniform float uFade; uniform float uSnow; uniform vec3 uLit;
varying vec2 vUv; varying float vA;
void main() {
  float a;
  vec3 col;
  if (uSnow > 0.5) {
    // a soft flake, white at its heart and a little grey-blue at its rim, so it shows over the snow lying below too
    float r = length(vUv);
    a = 1.0 - smoothstep(0.55, 1.0, r);
    col = mix(vec3(1.0), vec3(0.6, 0.65, 0.74), smoothstep(0.15, 0.85, r)) * uLit;
    a *= 0.95;
  } else {
    // a streak: brightest at its head, thinning along its tail
    a = (1.0 - smoothstep(0.2, 1.0, abs(vUv.x))) * (1.0 - 0.6 * (vUv.y * 0.5 + 0.5));
    col = vec3(0.8, 0.85, 0.92) * uLit;
    a *= 0.42;
  }
  a *= vA * uFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const MIST_VS = /* glsl */ `
attribute float aLayer;
uniform vec2 uC; uniform float uT;
varying vec2 vW; varying float vLayer;
void main() {
  vec3 p = vec3(uC.x + position.x * uT, position.y, uC.y + position.z * uT);
  vW = p.xz;
  vLayer = aLayer;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const MIST_FS = /* glsl */ `
uniform float uMist; uniform vec2 uOff; uniform float uScale; uniform vec3 uLit;
varying vec2 vW; varying float vLayer;
float mHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float mNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // each sheet its own drifting banks, the higher ones thinner and faster
  vec2 q = (vW + uOff * (1.0 + vLayer * 0.45)) / (uScale * (1.0 + vLayer * 0.35)) + vLayer * 17.3;
  float n = mNoise(q) * 0.55 + mNoise(q * 2.3 + 5.1) * 0.3 + mNoise(q * 5.7 - 2.3) * 0.15;
  float bank = smoothstep(0.28, 0.78, n);
  float a = uMist * bank * (vLayer < 0.5 ? 0.34 : vLayer < 1.5 ? 0.24 : 0.15);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.9, 0.91, 0.93) * uLit, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Weather3D {
  /** what falls (rain or snow) */
  readonly precip: THREE.Mesh;
  /** the mist's sheets */
  readonly mist: THREE.Mesh;
  readonly group = new THREE.Group();
  private pgeo: THREE.InstancedBufferGeometry;
  private PU = {
    uC: { value: new THREE.Vector2() }, uT: { value: 1000 }, uH: { value: 100 }, uSpeed: { value: 100 }, uLen: { value: 10 }, uTime: { value: 0 },
    uSnow: { value: 0 }, uDrift: { value: new THREE.Vector2() }, uPx: { value: new THREE.Vector2(0.001, 0.001) }, uWidth: { value: 1.2 },
    uSway: { value: 1 }, uFade: { value: 1 }, uLit: { value: new THREE.Vector3(1, 1, 1) },
  };
  private MU = {
    uC: { value: new THREE.Vector2() }, uT: { value: 1000 }, uMist: { value: 0 }, uOff: { value: new THREE.Vector2() }, uScale: { value: 60 },
    uLit: { value: new THREE.Vector3(1, 1, 1) },
  };
  private clock = 0;
  private wetClock = 0;
  /** what the last frame drew, for the stats and the tests */
  drops = 0;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = (this.pgeo = new THREE.InstancedBufferGeometry());
    g.setIndex(quad.getIndex());
    g.setAttribute("position", quad.getAttribute("position"));
    // (the same random places every session: a hash, not Math.random)
    const R = new Float32Array(MAX_DROPS * 4);
    let s = 0x2f6b1a3d;
    const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0; return ((s >>> 8) & 0xffffff) / 16777216; };
    for (let i = 0; i < R.length; i++) R[i] = rnd();
    g.setAttribute("aR", new THREE.InstancedBufferAttribute(R, 4));
    g.instanceCount = 0;
    this.precip = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.PU, vertexShader: PRECIP_VS, fragmentShader: PRECIP_FS, transparent: true, depthWrite: false,
    }));
    this.precip.frustumCulled = false;
    this.precip.renderOrder = 9;
    // the mist: three flat sheets in one geometry, each a quad at its own height
    const pos: number[] = [], layer: number[] = [], idx: number[] = [];
    MIST_H.forEach((h, i) => {
      const o = i * 4;
      pos.push(-0.5, h, -0.5, 0.5, h, -0.5, 0.5, h, 0.5, -0.5, h, 0.5);
      layer.push(i, i, i, i);
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    mg.setAttribute("aLayer", new THREE.Float32BufferAttribute(layer, 1));
    mg.setIndex(idx);
    this.mist = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      uniforms: this.MU, vertexShader: MIST_VS, fragmentShader: MIST_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mist.frustumCulled = false;
    // (before the lamps' pools, which then glow in it at night)
    this.mist.renderOrder = 3;
    this.precip.visible = this.mist.visible = false;
    this.group.add(this.mist, this.precip);
  }

  /** The light it is seen in (the day cycle's). */
  setLight(amb: readonly number[], sun: readonly number[]) {
    this.PU.uLit.value.set(amb[0] + sun[0] * 0.5, amb[1] + sun[1] * 0.5, amb[2] + sun[2] * 0.5);
    this.MU.uLit.value.set(amb[0] + sun[0] * 0.75, amb[1] + sun[1] * 0.75, amb[2] + sun[2] * 0.75);
  }

  /**
   * Once a frame: `W` the weather shown, `dt` seconds of the animation clock (0 while paused: the rain hangs, as the
   * smoke does), `hide` for the data maps.
   */
  update(view: View, W: Weather, dt: number, hide: boolean) {
    const halfH = view.halfH;
    const far = 1 - THREE.MathUtils.smoothstep(halfH, FADE_FROM, FADE_TO);
    const atlas = ENV.uEnvAtlas.value;
    const fade = hide ? 0 : far * (1 - atlas);
    this.clock = (this.clock + dt) % CLOCK_LOOP;
    if (W.rain > 0) this.wetClock = (this.wetClock + dt) % CLOCK_LOOP;
    ENV.uWetT.value = this.wetClock;
    // the ground the view sees (and what stands up into it from below the screen)
    const snow = W.snow > W.rain;
    const amount = snow ? W.snow : W.rain;
    const H = (snow ? 0.42 : 0.36) * halfH;
    const b = view.bounds(H, 0);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, T = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.04 + 1;
    // ---- rain or snow
    const n = fade > 0 && amount > 0.005 ? Math.ceil(MAX_DROPS * Math.min(1, amount * (snow ? 0.7 : 1))) : 0;
    this.drops = n;
    this.precip.visible = n > 0;
    if (n > 0) {
      const U = this.PU, w = windNow;
      U.uC.value.set(cx, cy);
      U.uT.value = T;
      U.uH.value = H;
      U.uTime.value = this.clock;
      U.uSnow.value = snow ? 1 : 0;
      // (rain falls fast across the view, snow drifts; both lean with the wind: from straight above that lean is
      // all that shows of a drop's fall)
      U.uSpeed.value = (snow ? 0.13 : 1.15) * halfH;
      U.uLen.value = snow ? 0 : 0.065 * halfH;
      const lean = snow ? 0.25 + 0.5 * w.strength : 0.12 + 0.3 * w.strength;
      U.uDrift.value.set(w.x * lean, w.y * lean);
      U.uSway.value = 0.012 * halfH;
      U.uPx.value.set(2 / Math.max(1, view.w), 2 / Math.max(1, view.h));
      U.uWidth.value = snow ? 4.2 : 1.25;
      // (straight down, the streaks are short: fainter, so the Map view is not a screen of dashes)
      U.uFade.value = fade * (0.5 + 0.5 * Math.min(1, view.tilt / 0.5)) * (snow ? 1 : 0.6 + 0.4 * amount);
      this.pgeo.instanceCount = n;
    }
    // ---- the mist
    const mist = W.mist * fade;
    this.mist.visible = mist > 0.005;
    if (this.mist.visible) {
      const M = this.MU, w = windNow;
      M.uC.value.set(cx, cy);
      M.uT.value = T * 1.3;
      M.uMist.value = mist;
      M.uScale.value = Math.max(45, halfH * 0.22);
      // (it drifts slowly downwind)
      M.uOff.value.x -= w.x * w.speed * 0.35 * dt;
      M.uOff.value.y -= w.y * w.speed * 0.35 * dt;
      if (Math.abs(M.uOff.value.x) > 1e5 || Math.abs(M.uOff.value.y) > 1e5) M.uOff.value.set(0, 0);
    }
  }

  dispose() {
    this.pgeo.dispose();
    this.mist.geometry.dispose();
    (this.precip.material as THREE.Material).dispose();
    (this.mist.material as THREE.Material).dispose();
  }
}
