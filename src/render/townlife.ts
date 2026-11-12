// A town's centre lived in: its square furnished (benches, the market's stalls, the newsstand, the telephone, the
// memorial or a fountain, planters: render/civic.ts lays them out), and townspeople about it, at the stalls, round
// the memorial, strolling to the hall's door and up and down the pavements in front of the shops. More of them the
// nearer the hall, by day than by night, in summer than in winter. The people are drawn only close in (one draw call
// a look, a two-box model when they are a few pixels tall), and only those in view are written each frame.

import * as THREE from "three";
import type { MergedModel } from "./models";
import { seasonal } from "./envShader";
import type { SquarePlan } from "./civic";
import { SEASON_DAYS } from "../game/calendar";

/** The six looks of the townspeople (tools/blender/town_h_life.py). */
export const PEOPLE = ["a", "b", "c", "d", "e", "f"] as const;
const SQUARE_PROPS = ["life_bench", "life_stall_a", "life_stall_b", "life_kiosk", "life_phonebox", "life_memorial", "life_fountain", "life_planter", "life_flagbed"] as const;
export const LIFE_MODELS: string[] = [...PEOPLE.flatMap((k) => [`life_person_${k}`, `life_person_${k}_far`]), ...SQUARE_PROPS];

/** A town hall's square: its lot to the world (render/buildings3d.ts lotMatrix) and its plan. */
export interface LifeSquare { base: THREE.Matrix4; plan: SquarePlan; seed: number }
/**
 * A lot's frontage on its pavement: lot to world, its half width along the street, where its pavement runs (lot z,
 * from the back of the pavement to the kerb), what it is, and how near the town's centre (1 at the hall, less out).
 */
export interface LifeFront {
  base: THREE.Matrix4; hw: number; z0: number; z1: number; kind: "shop" | "home"; centre: number; seed: number;
  /** how far past the lot's -x and +x ends its walkers may go (short of a side street's kerb; 3 m if none) */
  past?: [number, number];
  /** how busy its town's pavements are for its size (1 a town's; less in a hamlet, more in a city) */
  band?: number;
}

/** Someone in a park (render/greenplan.ts): standing at a, turned to (sin rot, cos rot), or walking a to b and back. */
export interface ParkFolk { a: { x: number; y: number }; b?: { x: number; y: number }; rot: number }

/** How near the camera must be (m a pixel) for the people to be drawn at all, and in full rather than two boxes. */
export const PEOPLE_SEE = 0.42, PEOPLE_FULL = 0.2;
/** And for the square's furniture. */
const PROPS_SEE = 1.0;

interface Folk {
  /** where they stand, or the two ends of their walk (world x, z) */
  ax: number; az: number; bx: number; bz: number;
  /** standing: which way they look */
  yaw: number;
  walk: boolean;
  /** m/s, s paused at each end, phase (s) */
  v: number; rest: number; t0: number;
  /** (worked out once) the walk's time one way and its round trip, and its heading out */
  go: number; cyc: number; head: number;
  /** drawn while the hour's share of the town out of doors is above it */
  rank: number;
  look: number;
  size: number;
}

/** A steady random number in [0, 1) for (a, b). */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x9e37, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The share of the townspeople out of doors at this hour (0..1): hardly any in the small hours, the morning's errands,
 * the busy middle of the day and the evening's shopping, home again after dark. Fewer in the cold.
 */
export function outdoors(hour: number, season: number): number {
  const keys: [number, number][] = [[0, 0.05], [5, 0.04], [7, 0.35], [9, 0.75], [12, 1], [14, 0.9], [17.5, 1], [19.5, 0.55], [21.5, 0.15], [24, 0.05]];
  const h = ((hour % 24) + 24) % 24;
  let k = 1;
  while (k < keys.length - 1 && keys[k][0] < h) k++;
  const [h0, v0] = keys[k - 1], [h1, v1] = keys[k];
  const v = v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  return v * ([0.95, 1, 0.9, 0.7][season] ?? 1);
}

export class TownLife {
  readonly group = new THREE.Group();
  private propMat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { windows: true });
  // (the people's own colours: no snow settles on a hat)
  private folkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private props: THREE.InstancedMesh[] = [];
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private folk: Folk[] = [];
  private empty = new THREE.BufferGeometry();
  private shown = false;

  constructor(private models: Map<string, MergedModel>) {}

  /** Furnish the squares and people the squares and the pavements (when the buildings or the roads change). */
  set(squares: LifeSquare[], fronts: LifeFront[]) {
    for (const m of this.props) { this.group.remove(m); m.dispose(); }
    this.props = [];
    const v = new THREE.Vector3(), w = new THREE.Vector3(), R = new THREE.Matrix4(), M = new THREE.Matrix4();
    const byModel = new Map<string, THREE.Matrix4[]>();
    const folk: Folk[] = [];
    const yawOf = (base: THREE.Matrix4, rot: number) => {
      // (the lot's +z turned by rot, into the world)
      v.set(Math.sin(rot), 0, Math.cos(rot)).transformDirection(base);
      return Math.atan2(v.x, v.z);
    };
    const add = (f: Omit<Folk, "rank" | "look" | "size" | "go" | "cyc" | "head">, k: number) => {
      const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
      const walk = f.walk && len > 0.05 && f.v > 0;
      const go = walk ? len / f.v : 0;
      folk.push({
        ...f, walk, go, cyc: 2 * (go + f.rest), head: walk ? Math.atan2(f.bx - f.ax, f.bz - f.az) : f.yaw,
        rank: hash(k, 11), look: Math.floor(hash(k, 12) * PEOPLE.length), size: 0.93 + hash(k, 13) * 0.12,
      });
    };
    for (const sq of squares) {
      for (const p of sq.plan.props) {
        let a = byModel.get(p.model);
        if (!a) byModel.set(p.model, (a = []));
        a.push(M.copy(sq.base).multiply(R.makeRotationY(p.rot).setPosition(p.x, 0, p.z)).clone());
      }
      sq.plan.folk.forEach((f, i) => {
        // (keyed on the hall, so its people stay who they are when another hall is built or lost)
        const k = sq.seed * 7919 + i * 31 + 1;
        v.set(f.x, 0, f.z).applyMatrix4(sq.base);
        if (f.to) {
          w.set(f.to.x, 0, f.to.z).applyMatrix4(sq.base);
          add({ ax: v.x, az: v.z, bx: w.x, bz: w.z, yaw: 0, walk: true, v: 1.0 + hash(k, 1) * 0.4, rest: 2 + hash(k, 2) * 6, t0: hash(k, 3) * 60 }, k);
        } else {
          add({ ax: v.x, az: v.z, bx: v.x, bz: v.z, yaw: yawOf(sq.base, f.rot), walk: false, v: 0, rest: 0, t0: 0 }, k);
        }
        // (the square is the town's busiest ground: its people are nearly always about)
        folk[folk.length - 1].rank *= 0.6;
      });
    }
    // the pavements: shoppers up and down in front of the shops, now and then someone outside a house; a few
    // looking in a shop's window
    for (const fr of fronts) {
      const shop = fr.kind === "shop";
      const per = (shop ? (fr.hw * 2 * fr.centre) / 7 : 0.3 * fr.centre) * (fr.band ?? 1);
      let n = Math.floor(per) + (hash(fr.seed, 1) < per - Math.floor(per) ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const k = fr.seed * 13 + i * 101;
        const z = fr.z0 + (fr.z1 - fr.z0) * (0.25 + 0.5 * hash(k, 4));
        const [p0, p1] = fr.past ?? [3, 3];
        v.set(-fr.hw - Math.min(p0, fr.hw) * hash(k, 5), 0, z).applyMatrix4(fr.base);
        w.set(fr.hw + Math.min(p1, fr.hw) * hash(k, 6), 0, z).applyMatrix4(fr.base);
        if (hash(k, 7) < 0.5) [v.x, v.z, w.x, w.z] = [w.x, w.z, v.x, v.z];
        add({ ax: v.x, az: v.z, bx: w.x, bz: w.z, yaw: 0, walk: true, v: 1.1 + hash(k, 8) * 0.45, rest: 0.5 + hash(k, 9) * 4, t0: hash(k, 10) * 90 }, k);
      }
      n = shop && hash(fr.seed, 2) < 0.8 * fr.centre ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const k = fr.seed * 17 + 7;
        v.set((hash(k, 4) - 0.5) * fr.hw * 1.4, 0, fr.z0 + 0.45).applyMatrix4(fr.base);
        add({ ax: v.x, az: v.z, bx: v.x, bz: v.z, yaw: yawOf(fr.base, Math.PI + (hash(k, 5) - 0.5) * 0.6), walk: false, v: 0, rest: 0, t0: 0 }, k);
      }
    }
    this.base = folk;
    for (const [model, mats] of byModel) {
      const mm = this.models.get(model);
      if (!mm) continue;
      const mesh = new THREE.InstancedMesh(mm.geo, this.propMat, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      zoomCull(mesh, PROPS_SEE);
      this.props.push(mesh);
      this.group.add(mesh);
    }
    this.people();
  }

  /**
   * More people from elsewhere, a list a `source`: the parks' (render/greens3d.ts, when the greens change), those
   * waiting at the bus stops (render/transit3d.ts).
   */
  setExtra(source: string, list: ParkFolk[], seed = 0) {
    const folk: Folk[] = [];
    list.forEach((p, i) => {
      const k = seed * 7 + i * 131 + 5;
      const walk = !!p.b && Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) > 0.05;
      const v = walk ? 0.9 + hash(k, 1) * 0.4 : 0, b = p.b ?? p.a;
      const go = walk ? Math.hypot(b.x - p.a.x, b.y - p.a.y) / v : 0, rest = walk ? 1 + hash(k, 2) * 6 : 0;
      folk.push({
        ax: p.a.x, az: p.a.y, bx: b.x, bz: b.y, yaw: p.rot, walk, v, rest, t0: hash(k, 3) * 120,
        go, cyc: 2 * (go + rest), head: walk ? Math.atan2(b.x - p.a.x, b.y - p.a.y) : p.rot,
        // (a park's people go home before the shops' do: fewer of them out at the edges of the day)
        rank: 0.15 + hash(k, 11) * 0.85, look: Math.floor(hash(k, 12) * PEOPLE.length), size: 0.93 + hash(k, 13) * 0.12,
      });
    });
    this.extra.set(source, folk);
    this.people();
  }

  /** The squares', the pavements' and the parks' people, a mesh for each look, near and far. */
  private people() {
    const folk = (this.folk = [...this.base, ...[...this.extra.values()].flat()]);
    // a mesh for each look, near and far, as big as all of that look
    const counts = PEOPLE.map((_, i) => folk.filter((f) => f.look === i).length);
    for (const m of [...this.near, ...this.far]) { this.group.remove(m); m.dispose(); }
    const make = (name: string, n: number) => {
      const mm = this.models.get(name);
      const mesh = new THREE.InstancedMesh(mm?.geo ?? this.empty, this.folkMat, Math.max(1, n));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    };
    this.near = PEOPLE.map((k, i) => make(`life_person_${k}`, counts[i]));
    this.far = PEOPLE.map((k, i) => make(`life_person_${k}_far`, counts[i]));
    this.shown = true;
  }

  private base: Folk[] = [];
  private extra = new Map<string, Folk[]>();
  private n = PEOPLE.map(() => 0);
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  /**
   * Once a frame: walk the people in view. `t` a clock in real seconds (they walk at their own pace, whatever the
   * game's speed), `hour` and `yday` the time the map shows.
   */
  frame(camera: THREE.Camera, mpp: number, t: number, hour: number, yday: number) {
    if (mpp > PEOPLE_SEE || !this.folk.length) {
      if (this.shown) for (const m of [...this.near, ...this.far]) m.count = 0;
      this.shown = false;
      return;
    }
    this.shown = true;
    // the ground in view (a little more, for those just off its edges)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [nx, ny] of CORNERS) {
      const a = this.a.set(nx, ny, -1).unproject(camera), b = this.b.set(nx, ny, 1).unproject(camera);
      const k = Math.abs(a.y - b.y) > 1e-6 ? a.y / (a.y - b.y) : 0;
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const pad = 8;
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const share = outdoors(hour, Math.floor((((yday % (SEASON_DAYS * 4)) + SEASON_DAYS * 4) % (SEASON_DAYS * 4)) / SEASON_DAYS));
    const full = mpp <= PEOPLE_FULL;
    const meshes = full ? this.near : this.far;
    for (const m of full ? this.far : this.near) m.count = 0;
    const n = this.n.fill(0);
    for (const f of this.folk) {
      if (f.rank >= share) continue;
      let x = f.ax, z = f.az, yaw = f.yaw, y = 0;
      if (f.walk) {
        // (the whole walk out of view: skip the sums)
        if (Math.max(f.ax, f.bx) < x0 || Math.min(f.ax, f.bx) > x1 || Math.max(f.az, f.bz) < z0 || Math.min(f.az, f.bz) > z1) continue;
        const go = f.go;
        let u = (t + f.t0) % f.cyc;
        let back = false;
        if (u > go + f.rest) { u -= go + f.rest; back = true; }
        const s = Math.min(1, u / go);
        const k = back ? 1 - s : s;
        x = f.ax + (f.bx - f.ax) * k;
        z = f.az + (f.bz - f.az) * k;
        yaw = f.head + (back ? Math.PI : 0);
        if (u < go) y = 0.035 * Math.abs(Math.sin((t + f.t0) * 5.6));
      }
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const mesh = meshes[f.look], i = n[f.look]++;
      const c = Math.cos(yaw) * f.size, s = Math.sin(yaw) * f.size, e = mesh.instanceMatrix.array as Float32Array, o = i * 16;
      e[o] = c; e[o + 1] = 0; e[o + 2] = -s; e[o + 3] = 0;
      e[o + 4] = 0; e[o + 5] = f.size; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = s; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
      e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    }
    meshes.forEach((m, i) => {
      m.count = n[i];
      if (n[i]) {
        // (only the ones written this frame go up to the card)
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, n[i] * 16);
        m.instanceMatrix.needsUpdate = true;
      }
    });
  }

  /** How many people are out and in view (for the tests and the dev hook). */
  get drawn(): number {
    return [...this.near, ...this.far].reduce((s, m) => s + m.count, 0);
  }
  get population(): number {
    return this.folk.length;
  }

  dispose() {
    for (const m of [...this.props, ...this.near, ...this.far]) { this.group.remove(m); m.dispose(); }
    this.props = [];
    this.near = [];
    this.far = [];
    this.folk = [];
    this.base = [];
    this.extra.clear();
    this.propMat.dispose();
    this.folkMat.dispose();
    this.empty.dispose();
  }
}

const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** Draw the mesh's instances only while a pixel is no more than `maxMpp` metres (the view's own camera says). */
export function zoomCull(mesh: THREE.InstancedMesh, maxMpp: number) {
  const all = mesh.count, size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const c = camera as THREE.OrthographicCamera;
    if (!c.isOrthographicCamera) return;
    const h = renderer.getSize(size).y || 1;
    mesh.count = (c.top - c.bottom) / c.zoom / h <= maxMpp ? all : 0;
  };
}
