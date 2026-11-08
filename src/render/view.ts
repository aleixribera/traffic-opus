import * as THREE from "three";
import { clamp, type V2 } from "../core/math";

/**
 * Top-down orthographic view. World (x, y) maps to three (x, z); height is three y.
 * The view can turn about the vertical: at rot = 0 screen up is north (-y); positive rot turns the map anticlockwise on screen
 * by that many radians (screen right = (cos rot, sin rot) in world). The sun stays put in the world.
 */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  /** Centre of the view in world metres and half the visible height in metres. */
  cx = 1200;
  cy = 1200;
  halfH = 160;
  rot = 0;
  minHalfH = 28;
  maxHalfH = 30000;
  w = 1;
  h = 1;
  private sunDir = new THREE.Vector3(-0.42, 1, -0.62).normalize();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
    this.camera.up.set(0, 0, -1);
    // lighting: flat top faces read at their true palette colour, shadowed ones at ~64%
    const A = 0.64, D = (1 - A) / this.sunDir.y;
    this.ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, A * Math.PI);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, D * Math.PI);
    this.sun.castShadow = true;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.renderer.setSize(this.w, this.h, false);
    this.updateCamera();
  }

  /** Metres per CSS pixel. */
  get mpp() {
    return (this.halfH * 2) / this.h;
  }

  updateCamera() {
    const halfW = this.halfH * (this.w / this.h);
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = this.halfH;
    c.bottom = -this.halfH;
    c.position.set(this.cx, 900, this.cy);
    c.up.set(Math.sin(this.rot), 0, -Math.cos(this.rot));
    c.lookAt(this.cx, 0, this.cy);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    // fit the shadow frustum to what is on screen (+ room for long shadows from off-screen casters)
    const ext = Math.hypot(halfW, this.halfH) * 1.1 + 30;
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 10;
    sc.far = 1400;
    sc.updateProjectionMatrix();
    // snap the light to shadow texels so shadows don't shimmer while panning
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(this.cx / texel) * texel, tz = Math.round(this.cy / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 600, this.sunDir.y * 600, tz + this.sunDir.z * 600);
    this.sun.target.updateMatrixWorld();
  }

  /** CSS pixel -> world metres. */
  toWorld(px: number, py: number): V2 {
    const m = this.mpp, c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = (px - this.w / 2) * m, dy = (py - this.h / 2) * m;
    return { x: this.cx + dx * c - dy * s, y: this.cy + dx * s + dy * c };
  }

  toScreen(p: V2): V2 {
    const m = this.mpp, c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = p.x - this.cx, dy = p.y - this.cy;
    return { x: (dx * c + dy * s) / m + this.w / 2, y: (-dx * s + dy * c) / m + this.h / 2 };
  }

  /** A screen-space offset in CSS pixels as a world vector (metres). */
  screenVec(dx: number, dy: number): V2 {
    const m = this.mpp, c = Math.cos(this.rot), s = Math.sin(this.rot);
    return { x: (dx * c - dy * s) * m, y: (dx * s + dy * c) * m };
  }

  /** Move the map with the pointer: drag by (dx, dy) CSS pixels. */
  pan(dx: number, dy: number) {
    const v = this.screenVec(dx, dy);
    this.cx -= v.x;
    this.cy -= v.y;
  }

  /** Turn the view by da radians, keeping the world point under pixel (px, py) in place. */
  rotateAt(px: number, py: number, da: number) {
    const before = this.toWorld(px, py);
    this.rot = Math.atan2(Math.sin(this.rot + da), Math.cos(this.rot + da));
    const after = this.toWorld(px, py);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /** Half extents of the world-axis box around what is on screen. */
  extents(): { ex: number; ey: number } {
    const halfW = this.halfH * (this.w / this.h);
    const c = Math.abs(Math.cos(this.rot)), s = Math.abs(Math.sin(this.rot));
    return { ex: c * halfW + s * this.halfH, ey: s * halfW + c * this.halfH };
  }

  zoomAt(px: number, py: number, factor: number) {
    const before = this.toWorld(px, py);
    this.halfH = clamp(this.halfH * factor, this.minHalfH, this.maxHalfH);
    const after = this.toWorld(px, py);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  clampTo(x0: number, y0: number, x1: number, y1: number) {
    this.cx = clamp(this.cx, x0, x1);
    this.cy = clamp(this.cy, y0, y1);
  }

  /**
   * Light the map for a moment of the day (render/daylight.ts): `amb` and `sun` are what each gives a flat top (1 =
   * the palette's own colour), `dir` points from the ground to the sun or the moon.
   */
  setLight(amb: readonly number[], sun: readonly number[], dir: readonly number[]) {
    this.sunDir.set(dir[0], dir[1], dir[2]).normalize();
    this.ambient.color.setRGB(amb[0], amb[1], amb[2]);
    this.ambient.groundColor.setRGB(amb[0] * 0.85, amb[1] * 0.85, amb[2] * 0.85);
    this.ambient.intensity = Math.PI;
    // (the light's own strength is what reaches a flat top over how squarely it falls there)
    const m = Math.max(sun[0], sun[1], sun[2], 1e-4);
    this.sun.color.setRGB(sun[0] / m, sun[1] / m, sun[2] / m);
    this.sun.intensity = (m / Math.max(0.05, this.sunDir.y)) * Math.PI;
  }

  render() {
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
