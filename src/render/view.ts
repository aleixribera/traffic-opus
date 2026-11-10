import * as THREE from "three";
import { clamp, type V2 } from "../core/math";
import { cameraRig, groundBounds, groundRay, risenTilt, screenToGround, shadowFit, worldToScreen, MIN_HALF_H, TILT_DEFAULT, TILT_MAX, type GroundRay } from "./viewmath";

/**
 * The Diorama camera: an orthographic view of the ground, turned and pitched. World (x, y) maps to three (x, z);
 * height is three y. The view can turn about the vertical: at rot = 0 screen up is north (-y); positive rot turns the
 * map anticlockwise on screen by that many radians (screen right = (cos rot, sin rot) in world). `tilt` pitches it
 * from straight down (0: the Map view) toward the horizon. The sun stays put in the world.
 *
 * Two pitches, one written and one read. `pitch` is what the camera is asked for: the player's own (the Camera
 * setting, the tilt keys, a drag) or a cinematic shot's. `tilt` is what is drawn, and is never set: for the player's
 * view it is the pitch eased up to straight down as the camera pulls far back (viewmath.risenTilt), so everything
 * that turns pixels into the world or back reads `tilt` and stays right at every zoom.
 *
 * A pixel is a line of sight, not a ground point, so everything that goes between pixels and the world uses the two
 * helpers here: screenToGround (where the pixel's line of sight meets a height) and worldToScreen. The geometry
 * itself is in viewmath.ts.
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
  /** The pitch asked for, radians from straight down (0: the Map view; TILT_MAX: as low as it goes). */
  pitch = TILT_DEFAULT;
  /**
   * Whether the camera rises to straight down as it pulls far back. On for the player's own view; the cinematic
   * cameras and the title menu's backdrop film at the pitch they ask for (App.syncRise is the one place that sets it).
   */
  rise = true;
  minHalfH = MIN_HALF_H;
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
    // lighting: flat top faces read at their true palette colour, shadowed ones at ~64%
    const A = 0.64, D = (1 - A) / this.sunDir.y;
    this.ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, A * Math.PI);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, D * Math.PI);
    this.sun.castShadow = true;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
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

  /** The pitch drawn, radians from straight down: the pitch asked for, eased out with the zoom while `rise` is on. */
  get tilt(): number {
    const p = clamp(this.pitch, 0, TILT_MAX);
    return this.rise ? risenTilt(p, this.halfH) : p;
  }

  /** Metres per CSS pixel. */
  get mpp() {
    return (this.halfH * 2) / this.h;
  }

  /**
   * Metres per pixel for "how near is near" on the ground (snapping, pick radii): at a tilt a pixel covers more
   * ground up the screen than across it, and this is the mean of the two.
   */
  get pickMpp() {
    return this.mpp / Math.sqrt(Math.cos(this.tilt));
  }

  updateCamera() {
    this.pitch = clamp(this.pitch, 0, TILT_MAX);
    const halfW = this.halfH * (this.w / this.h);
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = this.halfH;
    c.bottom = -this.halfH;
    const rig = cameraRig(this);
    c.near = rig.near;
    c.far = rig.far;
    c.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    c.up.set(rig.up[0], rig.up[1], rig.up[2]);
    c.lookAt(this.cx, 0, this.cy);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    // fit the shadow frustum to the ground on screen (and to the long shadows of a low sun falling into it), and
    // snap the light to shadow texels so shadows don't shimmer while panning
    const fit = shadowFit(this, [this.sunDir.x, this.sunDir.y, this.sunDir.z], this.sun.shadow.mapSize.x);
    const sc = this.sun.shadow.camera;
    sc.left = -fit.ext;
    sc.right = fit.ext;
    sc.top = fit.ext;
    sc.bottom = -fit.ext;
    sc.near = fit.near;
    sc.far = fit.far;
    sc.updateProjectionMatrix();
    // (the depth bias, in metres: a texel or two along the light, more for a low sun whose texels stretch out; a
    // fixed bias would lift every shadow off its wall's foot when zoomed in, which shows at a tilt)
    const slope = this.sunDir.y / Math.max(0.05, Math.hypot(this.sunDir.x, this.sunDir.z));
    const biasM = clamp(fit.texel * (1 + 1 / Math.max(0.2, slope)), 0.06, 0.7);
    this.sun.shadow.bias = -biasM / (fit.far - fit.near);
    this.sun.target.position.set(fit.target[0], fit.target[1], fit.target[2]);
    this.sun.position.set(fit.pos[0], fit.pos[1], fit.pos[2]);
    this.sun.target.updateMatrixWorld();
  }

  /** CSS pixel -> the ground point seen there, on the plane at height h (0: the ground itself). */
  screenToGround(px: number, py: number, h = 0): V2 {
    return screenToGround(this, px, py, h);
  }

  /** A world point (x, y on the ground, h above it) -> CSS pixel. */
  worldToScreen(x: number, y: number, h = 0): V2 {
    return worldToScreen(this, x, y, h);
  }

  /** The line of sight through a CSS pixel (see viewmath.ts). */
  ray(px: number, py: number): GroundRay {
    return groundRay(this, px, py);
  }

  /** A screen-space offset in CSS pixels as a vector along the ground (metres). */
  screenVec(dx: number, dy: number): V2 {
    const m = this.mpp, c = Math.cos(this.rot), s = Math.sin(this.rot);
    const v = (dy * m) / Math.cos(this.tilt);
    return { x: dx * m * c - v * s, y: dx * m * s + v * c };
  }

  /** Move the map with the pointer: drag by (dx, dy) CSS pixels, and the ground follows the pointer. */
  pan(dx: number, dy: number) {
    const v = this.screenVec(dx, dy);
    this.cx -= v.x;
    this.cy -= v.y;
  }

  /** Turn the view by da radians, keeping the ground point under pixel (px, py) in place. */
  rotateAt(px: number, py: number, da: number) {
    const before = this.screenToGround(px, py);
    this.rot = Math.atan2(Math.sin(this.rot + da), Math.cos(this.rot + da));
    const after = this.screenToGround(px, py);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /**
   * The world-axis box round the ground on screen (plus `pad` metres): what to draw, cull and load by. With `hMax`
   * it also holds whatever stands below the screen's bottom edge and is tall enough (up to hMax) to lean into view.
   */
  bounds(hMax = 0, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
    return groundBounds(this, hMax, pad);
  }

  /**
   * Zoom by `factor`, keeping the ground point under pixel (px, py) in place. The pitch drawn changes with the zoom
   * (the camera rises as it pulls back), and `before` and `after` are each taken at their own: the point holds.
   */
  zoomAt(px: number, py: number, factor: number) {
    const before = this.screenToGround(px, py);
    this.halfH = clamp(this.halfH * factor, this.minHalfH, this.maxHalfH);
    const after = this.screenToGround(px, py);
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
