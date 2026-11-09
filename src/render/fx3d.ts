// A landmark's opening night: bursts of gold, cream and red sparks over it for a few seconds, the way the period opened
// a dam or a fair. Particle quads (additive), one draw call; nothing stays behind.

import * as THREE from "three";
import type { V2 } from "../core/math";

const N = 900;
const COLORS = [0xffd36a, 0xfff1c9, 0xff8a3d, 0xe8463a, 0xffe08a];

interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; t0: number; life: number; c: number }

function dot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Fireworks {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private sparks: Spark[] = [];
  private shows: { at: V2; h: number; t0: number; next: number; left: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ map: dot(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, N);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.mesh);
  }

  /** Called as each shell bursts, with where (the sound's crack lands with the sparks). */
  onBurst: ((x: number, y: number) => void) | null = null;

  /** A show over a place: `bursts` shells over about six seconds, bursting at about `h` metres up. */
  launch(at: V2, h: number, bursts = 14, now = performance.now() / 1000) {
    this.shows.push({ at, h, t0: now, next: now, left: bursts });
  }

  private burst(at: V2, h: number, now: number) {
    const r = Math.random;
    const x = at.x + (r() - 0.5) * h * 0.9, y = at.y + (r() - 0.5) * h * 0.9, z = h * (0.7 + r() * 0.5);
    this.onBurst?.(x, y);
    const c = COLORS[(r() * COLORS.length) | 0], n = 70 + ((r() * 40) | 0), sp = h * (0.5 + r() * 0.25);
    // (seen from above, a shell opens as a ring: its sparks fly out mostly level, on a sphere flattened top to bottom)
    for (let i = 0; i < n; i++) {
      const u = (r() * 2 - 1) * 0.45, a = (i / n) * Math.PI * 2 + r() * 0.08, k = Math.sqrt(1 - u * u);
      const s = sp * (0.85 + r() * 0.15);
      this.sparks.push({ x, y, z, vx: Math.cos(a) * k * s, vy: Math.sin(a) * k * s, vz: u * s, t0: now, life: 1.5 + r() * 0.8, c });
    }
    if (this.sparks.length > N) this.sparks.splice(0, this.sparks.length - N);
  }

  /** Every frame: shells go up and burst, sparks fall and fade. `camera` keeps each spark facing it. */
  update(camera: THREE.Camera, now = performance.now() / 1000) {
    for (const s of this.shows) {
      while (s.left > 0 && now >= s.next) { this.burst(s.at, s.h, now); s.left--; s.next += 0.25 + Math.random() * 0.4; }
    }
    this.shows = this.shows.filter((s) => s.left > 0);
    this.sparks = this.sparks.filter((p) => now - p.t0 < p.life);
    if (!this.sparks.length && !this.mesh.count) return;
    camera.getWorldQuaternion(this.q);
    let n = 0;
    for (const p of this.sparks) {
      const t = now - p.t0, f = 1 - t / p.life;
      // (they slow in the air and fall: a little drag, then gravity)
      const d = (1 - Math.exp(-1.6 * t)) / 1.6;
      this.v.set(p.x + p.vx * d, p.z + p.vz * d - 4.5 * t * t, p.y + p.vy * d);
      const size = 1.6 + 2.4 * f;
      this.m.compose(this.v, this.q, this.s.set(size, size, size));
      this.mesh.setMatrixAt(n, this.m);
      // (fading as it falls; never brighter than its colour, so overlapping sparks don't wash out to white)
      this.mesh.setColorAt(n, this.c.setHex(p.c).multiplyScalar(Math.max(0, Math.min(1, f * 1.2)) * 0.8));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
