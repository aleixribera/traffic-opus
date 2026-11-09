import * as THREE from "three";
import type { StageInfo } from "../game/construction";
import type { ModelSet } from "./models";

/**
 * Buildings going up (docs/design.md "Construction"): the corner stakes and material piles of a staked plot, the
 * slab being poured with the mixer truck beside it, a timber frame or a steel skeleton raised bay by bay, walls
 * closing in behind a scaffold, a tower crane slewing over the big ones, and the contractor's trucks driving in off
 * the street and away again. Every piece is a Blender model (tools/blender/build_models.py, "construction");
 * tiled and stretched pieces carry no detail that would show the stretch.
 */

/** One building (or one building of a company site) under construction, in its lot's space. */
export interface ConJob {
  /** stable per building piece */
  id: string;
  /** lot space to world: x along the street, +z toward it, y up (no scale) */
  base: THREE.Matrix4;
  /** the walls' footprint and the roof's height (lot space, m) */
  x0: number; x1: number; z0: number; z1: number; top: number;
  /** a steel skeleton and brick walls (blocks, towers, works) rather than a timber frame */
  heavy: boolean;
  stage: StageInfo;
  seed: number;
  /** the lot round it, where trucks park and materials are stacked (null: a works' building, inside its fence) */
  room: { x0: number; x1: number; z0: number; z1: number } | null;
}

export const CON_MODELS = [
  "con_stake", "con_slab", "con_trench", "con_string", "con_deck_wood", "con_frame_wood", "con_frame_steel", "con_wall_wood", "con_wall_brick", "con_scaffold",
  "con_lumber", "con_bricks", "con_steel", "con_gravel", "con_hut", "con_crane", "con_mixer", "con_lumbertruck",
] as const;
type ConModel = (typeof CON_MODELS)[number];

/** Model sizes (m), as built in Blender. */
const PILE: Partial<Record<ConModel, [number, number]>> = { con_lumber: [4.0, 1.4], con_bricks: [3.15, 1.2], con_steel: [6.2, 1.6], con_gravel: [3.35, 3.15] };
const TRUCK_L = 8.3, TRUCK_W = 2.3;
const WOOD_BAY = 3, STEEL_BAY = 6, STOREY = 4;
/** Sim seconds a truck takes to pull in off the street or away again. */
const DRIVE = 9;

interface Truck { model: ConModel; from: V; via: V; to: V; t0: number; out: boolean }
interface V { x: number; z: number }

const smooth = (u: number) => u * u * (3 - 2 * u);

export class Construction3D {
  readonly group = new THREE.Group();
  private meshes = new Map<ConModel, THREE.InstancedMesh>();
  private list = new Map<ConModel, THREE.Matrix4[]>();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  /** each job's truck (by job id): when it pulled in, for the drive in; a truck pulling away is kept a moment */
  private trucks = new Map<string, Truck & { base: THREE.Matrix4 }>();
  private leaving: (Truck & { base: THREE.Matrix4 })[] = [];
  private cranes: { base: THREE.Matrix4; x: number; z: number; sy: number; seed: number }[] = [];
  /** the number of instances drawn each frame (trucks and crane jibs) after the static ones, per model */
  private fixed = new Map<ConModel, number>();

  constructor(private models: ModelSet, private mat: THREE.Material) {}

  private add(model: ConModel, m: THREE.Matrix4) {
    let a = this.list.get(model);
    if (!a) this.list.set(model, (a = []));
    a.push(m.clone());
  }

  /** A piece at (x, y, z) in the job's lot space, turned `yaw` about the vertical, scaled. */
  private put(j: ConJob, model: ConModel, x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1) {
    this.tmp.makeRotationY(yaw).setPosition(x, y, z).multiply(this.tmp2.makeScale(sx, sy, sz));
    this.add(model, this.tmp.premultiply(j.base));
  }

  /** Lay out every job (call when the jobs' steps may have moved on: a few times a second). */
  update(jobs: ConJob[], now: number) {
    this.list.clear();
    this.cranes = [];
    const seen = new Set<string>();
    for (const j of jobs) {
      seen.add(j.id);
      this.job(j, now);
    }
    // trucks of jobs that finished (or were pulled down) drive off
    for (const [id, t] of this.trucks) if (!seen.has(id)) { this.trucks.delete(id); this.depart(t, now); }
    this.leaving = this.leaving.filter((t) => now - t.t0 < DRIVE);
    for (const [model, a] of this.list) this.fixed.set(model, a.length);
    for (const model of this.meshes.keys()) if (!this.list.has(model)) this.fixed.set(model, 0);
    this.dirty = true;
    this.frame(now);
  }

  private depart(t: Truck & { base: THREE.Matrix4 }, now: number) {
    // (out the way it came in when it backed in nose-first; otherwise on along the street)
    this.leaving.push({ ...t, from: t.to, via: t.via, to: t.from, t0: now, out: true });
  }

  private job(j: ConJob, now: number) {
    const { stage, k } = j.stage;
    const W = j.x1 - j.x0, D = j.z1 - j.z0, cx = (j.x0 + j.x1) / 2, cz = (j.z0 + j.z1) / 2;
    const area = W * D;
    const order = ["staked", "slab", "frame", "walls", "roof", "done"].indexOf(stage);
    // the walls' height: a timber house's one or two storeys; a block's floors of STOREY m
    const wallH = j.heavy ? Math.max(STOREY, Math.round((j.top * 0.85) / STOREY) * STOREY) : Math.min(6.4, Math.max(2.8, j.top * 0.62));
    const floors = j.heavy ? wallH / STOREY : wallH > 4.6 ? 2 : 1;
    const liftH = wallH / floors;

    // the plot dug over and set out: stakes round it, a builder's line from stake to stake, till the frame goes up
    // (above the lot's yard, which lies at 0.04)
    if (order === 0) this.put(j, "con_trench", cx, 0.03, cz, 0, W + 1.0, 1, D + 1.0);
    if (order <= 1) {
      const o = 0.8, xa = j.x0 - o, xb = j.x1 + o, za = j.z0 - o, zb = j.z1 + o;
      for (const [ax, az, ex, ez] of [[xa, za, xb, za], [xb, za, xb, zb], [xb, zb, xa, zb], [xa, zb, xa, za]]) {
        const len = Math.hypot(ex - ax, ez - az), n = Math.max(1, Math.round(len / 3.5));
        const yaw = Math.atan2(-(ez - az), ex - ax);
        this.put(j, "con_string", (ax + ex) / 2, 0, (az + ez) / 2, yaw, len, 1, 1);
        for (let i = 0; i < n; i++) this.put(j, "con_stake", ax + ((ex - ax) * i) / n, 0, az + ((ez - az) * i) / n, yaw);
      }
    }
    // the slab: poured through its step, then the floor everything stands on
    if (order >= 1) this.put(j, "con_slab", cx, 0, cz, 0, W + 0.4, order === 1 ? 0.25 + 0.75 * k : 1, D + 0.4);
    const y0 = order >= 1 ? 0.3 : 0;

    // the frame: bay by bay, floor by floor through its step; standing whole after
    const bay = j.heavy ? STEEL_BAY : WOOD_BAY;
    const nx = Math.max(1, Math.round(W / bay)), nz = Math.max(1, Math.round(D / bay));
    const bx = W / nx, bz = D / nz;
    if (order >= 2 && order <= 3) {
      const total = nx * nz * floors;
      const shown = order === 2 ? Math.ceil(total * Math.min(1, k * 1.05)) : total;
      let n = 0;
      for (let f = 0; f < floors && n < shown; f++)
        for (let ix = 0; ix < nx && n < shown; ix++)
          for (let iz = 0; iz < nz && n < shown; iz++, n++) {
            const x = j.x0 + bx * (ix + 0.5), z = j.z0 + bz * (iz + 0.5);
            this.put(j, j.heavy ? "con_frame_steel" : "con_frame_wood", x, y0 + f * liftH, z, 0, bx / bay, liftH / (j.heavy ? STOREY : WOOD_BAY), bz / bay);
          }
    }
    // the walls round the edge, a lift at a time, the scaffold a lift ahead of them; the scaffold stays while
    // the roof goes on
    const edges: [number, number, number, number][] = [[j.x0, j.z1, j.x1, j.z1], [j.x1, j.z1, j.x1, j.z0], [j.x1, j.z0, j.x0, j.z0], [j.x0, j.z0, j.x0, j.z1]];
    // (each edge's run of 3 m panels; `inx, inz` point into the building)
    const runs = edges.map(([ax, az, ex, ez]) => {
      const len = Math.hypot(ex - ax, ez - az), ux = (ex - ax) / len, uz = (ez - az) / len;
      const sgn = (cx - (ax + ex) / 2) * -uz + (cz - (az + ez) / 2) * ux > 0 ? 1 : -1;
      return { ax, az, ux, uz, len, n: Math.max(1, Math.round(len / 3)), yaw: Math.atan2(-uz, ux), inx: -uz * sgn, inz: ux * sgn };
    });
    if (order === 3) {
      const segs: { x: number; z: number; yaw: number; s: number }[] = [];
      // (inset half a wall so its face stays on the footprint)
      const ins = j.heavy ? 0.15 : 0.1;
      for (const e of runs) for (let i = 0; i < e.n; i++) {
        const t = (e.len * (i + 0.5)) / e.n;
        segs.push({ x: e.ax + e.ux * t + e.inx * ins, z: e.az + e.uz * t + e.inz * ins, yaw: e.yaw, s: e.len / e.n / 3 });
      }
      const total = segs.length * floors;
      const shown = Math.ceil(total * k);
      for (let i = 0; i < shown; i++) {
        const f = Math.floor(i / segs.length), g = segs[i % segs.length];
        this.put(j, j.heavy ? "con_wall_brick" : "con_wall_wood", g.x, y0 + f * liftH, g.z, g.yaw, g.s, liftH / (j.heavy ? 4 : 3), 1);
      }
      // the floors decked as the walls close in: a block's concrete floors one storey at a time between its
      // girders, a house's boarded attic floor over its joists (seen from above, the frame fills in bay by bay)
      const decks = j.heavy ? nx * nz * floors : nx * nz;
      const laid = Math.ceil(decks * Math.min(1, k * 1.1));
      for (let i = 0; i < laid; i++) {
        const f = j.heavy ? Math.floor(i / (nx * nz)) : floors - 1, b = i % (nx * nz);
        const x = j.x0 + bx * (Math.floor(b / nz) + 0.5), z = j.z0 + bz * ((b % nz) + 0.5);
        if (j.heavy) this.put(j, "con_slab", x, y0 + (f + 1) * liftH - 0.26, z, 0, bx - 0.3, 0.8, bz - 0.3);
        else this.put(j, "con_deck_wood", x, y0 + wallH, z, 0, bx / WOOD_BAY, 1, bz / WOOD_BAY);
      }
    }
    if (order === 3 || (order === 4 && k < 0.7)) {
      const lifts = Math.ceil((y0 + wallH) / 3);
      const upTo = order === 3 ? Math.min(lifts, Math.ceil(lifts * k) + 1) : lifts;
      for (const e of runs) for (let i = 0; i < e.n; i++) {
        const t = (e.len * (i + 0.5)) / e.n;
        const x = e.ax + e.ux * t - e.inx * 0.6, z = e.az + e.uz * t - e.inz * 0.6;
        for (let l = 0; l < upTo; l++) this.put(j, "con_scaffold", x, l * 3, z, e.yaw, e.len / e.n / 3, 1, 1);
      }
    }

    // a tower crane over the big ones, from the frame till the roof is on
    if (j.heavy && (j.top > 14 || area > 600) && order >= 2 && (order < 4 || k < 0.6)) {
      const sy = Math.max(1, (j.top + 6) / 21);
      this.cranes.push({ base: j.base, x: j.x0 + 2.2, z: j.z0 + 2.2, sy, seed: j.seed });
    }

    // the materials: stacked beside the plot as they're trucked in, used up as it goes up
    const pileN = Math.max(3, Math.min(6, Math.round(area / 60)));
    const want = order === 0 ? Math.ceil(j.stage.got * pileN) : order === 1 ? pileN : order === 2 ? pileN - Math.floor(k * pileN * 0.5) : order === 3 ? Math.ceil(pileN * 0.5 * (1 - k)) : 0;
    const kinds: ConModel[] = j.heavy ? ["con_steel", "con_bricks", "con_gravel", "con_bricks", "con_steel", "con_bricks"] : ["con_lumber", "con_gravel", "con_lumber", "con_bricks", "con_lumber", "con_gravel"];
    this.piles(j, kinds.slice(0, want), order, y0);

    // the hut on a big job's lot
    if (j.room && area > 300 && order <= 3) {
      const r = j.room;
      if (r.x1 - j.x1 > 3.6) this.put(j, "con_hut", r.x1 - 1.8, 0, r.z0 + 3.2, Math.PI / 2);
      else if (j.z0 - r.z0 > 3.6) this.put(j, "con_hut", r.x1 - 3.2, 0, r.z0 + 1.8);
    }

    // the contractor's truck: the mixer for the slab, the lumber truck with the frame
    const want2: ConModel | null = order === 1 ? "con_mixer" : order === 2 && k < 0.6 ? "con_lumbertruck" : null;
    const had = this.trucks.get(j.id);
    if (had && had.model !== want2) { this.trucks.delete(j.id); this.depart(had, now); }
    if (want2 && !this.trucks.has(j.id) && j.room) {
      const spot = this.spot(j);
      if (spot) {
        // (on a fresh load of a save, a truck already partway through its step is simply there)
        const t0 = k > 0.08 ? now - DRIVE : now;
        this.trucks.set(j.id, { model: want2, ...spot, t0, out: false, base: j.base });
      }
    }
  }

  /** Where a truck parks on the lot (in front of the walls or beside them), and the way in from the street. */
  private spot(j: ConJob): { from: V; via: V; to: V } | null {
    const r = j.room!;
    const road = r.z1 + 2.2;
    const front = r.z1 - j.z1;
    if (front >= TRUCK_W + 0.6 && r.x1 - r.x0 >= TRUCK_L + 0.6) {
      // parallel to the street in the front yard, pulled in forwards
      const x = Math.max(r.x0 + TRUCK_L / 2 + 0.3, Math.min(r.x1 - TRUCK_L / 2 - 0.3, (j.x0 + j.x1) / 2));
      const z = j.z1 + front / 2;
      return { from: { x: x - 16, z: road }, via: { x: x - 6, z }, to: { x, z } };
    }
    for (const side of [1, -1]) {
      const gap = side > 0 ? r.x1 - j.x1 : j.x0 - r.x0;
      if (gap < TRUCK_W + 0.6 || r.z1 - r.z0 < TRUCK_L + 0.6) continue;
      const x = side > 0 ? j.x1 + gap / 2 : j.x0 - gap / 2;
      const z = r.z1 - TRUCK_L / 2 - 0.3;
      return { from: { x: x - side * 14, z: road }, via: { x, z: road }, to: { x, z } };
    }
    return null;
  }

  private piles(j: ConJob, kinds: ConModel[], order: number, y0: number) {
    if (!kinds.length) return;
    const r = j.room;
    // behind the walls if the lot has room there, else beside them; a works' building (or a full lot) stacks
    // them on its own plot until the frame goes up
    const back = r ? j.z0 - r.z0 : 0;
    let x = r ? r.x0 + 0.6 : j.x0 + 0.4;
    let z: number, yaw = 0, along = true;
    if (r && back >= 1.9) z = r.z0 + Math.min(back, 3.6) / 2;
    else if (r && r.x1 - j.x1 >= 1.9) { along = false; x = j.x1 + Math.min(r.x1 - j.x1, 3.6) / 2; z = r.z0 + 0.6; yaw = Math.PI / 2; }
    else if (order <= 1) { z = j.z0 + 1.6; x = j.x0 + 0.4; }
    else return;
    const limit = along ? (r ? r.x1 - 0.6 : j.x1 - 0.4) : (r ? r.z1 - TRUCK_L - 1 : j.z1);
    const y = !r || (r && back < 1.9 && r.x1 - j.x1 < 1.9) ? y0 : 0;
    for (const m of kinds) {
      const [l, w] = PILE[m]!;
      const len = m === "con_gravel" ? w : l;
      if (along) {
        if (x + len > limit) break;
        this.put(j, m, x + len / 2, y, z, yaw);
        x += len + 0.5;
      } else {
        if (z + len > limit) break;
        this.put(j, m, x, y, z + len / 2, yaw);
        z += len + 0.5;
      }
    }
  }

  /** The moving parts, every frame: trucks pulling in and away, the cranes' jibs slewing. */
  frame(now: number) {
    const moving: [ConModel, THREE.Matrix4][] = [];
    const truck = (t: Truck & { base: THREE.Matrix4 }) => {
      const u = smooth(Math.min(1, Math.max(0, (now - t.t0) / DRIVE)));
      const at = (s: number) => {
        const a = 1 - s;
        return { x: a * a * t.from.x + 2 * a * s * t.via.x + s * s * t.to.x, z: a * a * t.from.z + 2 * a * s * t.via.z + s * s * t.to.z };
      };
      const p = at(u);
      const s0 = Math.min(u, 0.995), q0 = at(s0), q1 = at(s0 + 0.005);
      let yaw = Math.atan2(q1.x - q0.x, q1.z - q0.z);
      // (a truck backing out of a side spot faces the way it came)
      if (t.out && t.via.z === t.from.z && t.via.x === t.to.x) yaw += Math.PI;
      this.tmp.makeRotationY(yaw).setPosition(p.x, 0, p.z).premultiply(t.base);
      moving.push([t.model, this.tmp.clone()]);
    };
    for (const t of this.trucks.values()) truck(t);
    for (const t of this.leaving) truck(t);
    for (const c of this.cranes) {
      const yaw = c.seed * 2.4 + Math.sin(now / 55 + c.seed) * 1.3;
      this.tmp.makeRotationY(yaw).setPosition(c.x, 0, c.z).multiply(this.tmp2.makeScale(1, c.sy, 1)).premultiply(c.base);
      moving.push(["con_crane", this.tmp.clone()]);
    }
    const need = new Map<ConModel, number>();
    for (const [model, n] of this.fixed) need.set(model, n);
    for (const [model] of moving) need.set(model, (need.get(model) ?? 0) + 1);
    for (const [model, n] of need) {
      let mesh = this.meshes.get(model);
      if (n > 0 && (!mesh || mesh.instanceMatrix.count < n)) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        const geo = this.models.props.get(model)?.geo;
        if (!geo) continue;
        let cap = 16;
        while (cap < n) cap *= 2;
        mesh = new THREE.InstancedMesh(geo, this.mat, cap);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // (instances move every frame: culling by a sphere computed once would drop them)
        mesh.frustumCulled = false;
        this.meshes.set(model, mesh);
        this.group.add(mesh);
        // (a new mesh: the static pieces go in again)
        this.fixed.set(model, 0);
        const a = this.list.get(model) ?? [];
        a.forEach((m, i) => mesh!.setMatrixAt(i, m));
        this.fixed.set(model, a.length);
      }
      if (!mesh) continue;
      mesh.count = n;
    }
    // static pieces were set on update; write them again only when the update changed them
    if (this.dirty) {
      for (const [model, a] of this.list) {
        const mesh = this.meshes.get(model);
        if (mesh) a.forEach((m, i) => mesh.setMatrixAt(i, m));
      }
      this.dirty = false;
    }
    const at = new Map<ConModel, number>();
    for (const [model, m] of moving) {
      const mesh = this.meshes.get(model);
      if (!mesh) continue;
      const i = (this.fixed.get(model) ?? 0) + (at.get(model) ?? 0);
      at.set(model, (at.get(model) ?? 0) + 1);
      mesh.setMatrixAt(i, m);
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }
  private dirty = true;

  dispose() {
    for (const m of this.meshes.values()) { this.group.remove(m); m.dispose(); }
    this.meshes.clear();
  }
}
