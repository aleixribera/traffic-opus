import * as THREE from "three";
import { clamp, type V2 } from "../core/math";

/**
 * Top-down orthographic view. World (x, y) maps to three (x, z); height is three y.
 * Screen up is north (-y). The sun sits up-left so shadows fall down-right like the reference.
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
  minHalfH = 28;
  maxHalfH = 1300;
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
    c.lookAt(this.cx, 0, this.cy);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    // fit the shadow frustum to what is on screen (+ room for long shadows from off-screen casters)
    const ext = Math.max(halfW, this.halfH) * 1.25 + 30;
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
    const m = this.mpp;
    return { x: this.cx + (px - this.w / 2) * m, y: this.cy + (py - this.h / 2) * m };
  }

  toScreen(p: V2): V2 {
    const m = this.mpp;
    return { x: (p.x - this.cx) / m + this.w / 2, y: (p.y - this.cy) / m + this.h / 2 };
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

  render() {
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
