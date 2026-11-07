import * as THREE from "three";
import type { BuildingKind } from "../config";
import { fromAngle, right, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { ZONE_GROUP } from "../game/growables";
import type { ModelSet } from "./models";
import { CAR_COLORS, PAL } from "./palette";

/** Model matrix for a lot: model +z (its front) faces the road, origin at the footprint centre. */
export function lotMatrix(out: THREE.Matrix4, c: V2, rot: number, side: 1 | -1, y = 0) {
  const u = fromAngle(rot);
  const away = right(u);
  const zx = -away.x * side, zz = -away.y * side;
  out.makeBasis(new THREE.Vector3(zz, 0, -zx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(zx, 0, zz));
  out.setPosition(c.x, y, c.y);
  return out;
}

/** Where a car goes in and out of a lot: the kerb, the end of the driveway, the way into the lot, and its empty bays. */
export interface LotWay {
  kerb: V2;
  drive: V2;
  into: V2; // unit, from the road into the lot
  h: number;
  bays: { p: V2; dir: V2 }[]; // empty parking bays: centre, and where a parked car's nose points
}

/** A bay a static parked car fills (the rest are free for cars that come and go). */
const bayTaken = (b: Building, k: number) => (((b.id * 73856093) ^ (k * 19349663)) >>> 0) % 10 >= 4;

/** Front yard depth (m) for a lot with this much depth to spare around its model. */
const setback = (spare: number) => Math.min(spare * 0.68, 5);

const SITE = 0xb59d6a; // construction site: bare earth
/** Tints multiplied over a model's own colours, picked per building. */
const VARY = [0xffffff, 0xffffff, 0xf2ebe4, 0xe2dcd8, 0xfbf3e6, 0xdcdcdc, 0xf5f0f0];
/** Ground of a grown lot: lawn for homes, paving for business. */
const YARD: Record<string, number> = { res: 0x99994f, com: 0xb3ae9b, ind: 0xaaa490, off: 0xb3ae9b };
const ABANDONED = 0x77736b;

export class Buildings3D {
  readonly group = new THREE.Group();
  private kinds = new Map<BuildingKind, THREE.InstancedMesh>();
  private parked: THREE.InstancedMesh[] = [];
  private yards: THREE.InstancedMesh | null = null;
  private yardGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private drives: THREE.Mesh | null = null;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private driveMat = new THREE.MeshLambertMaterial({ color: PAL.driveway });
  private order = new Map<BuildingKind, Building[]>();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private col = new THREE.Color();
  private tintFn: ((b: Building) => number | null) | null = null;
  private building: { b: Building; kind: BuildingKind; i: number }[] = [];

  constructor(private models: ModelSet) {}

  /** Model and matrix for a building that isn't placed yet (the placement ghost). */
  ghost(kind: BuildingKind, c: V2, rot: number, side: 1 | -1): { geo: THREE.BufferGeometry; m: THREE.Matrix4 } | null {
    const mm = this.models.buildings.get(kind);
    if (!mm) return null;
    return { geo: mm.geo, m: lotMatrix(new THREE.Matrix4(), c, rot, side, 0.1) };
  }

  /** Model depth (m) after fitting the lot. */
  private depth(b: Building): number {
    const mm = this.models.buildings.get(b.kind)!;
    const bb = mm.geo.boundingBox!;
    return (bb.max.z - bb.min.z) * b.fit;
  }

  /** Full matrix of a building's model: fitted to its lot, set back from the road, raised as it is built. */
  private matrix(out: THREE.Matrix4, b: Building): THREE.Matrix4 {
    lotMatrix(out, b.c, b.rot, b.side);
    if (!b.zone) return out;
    // the model stands near the street; deep lots keep the rest as a back yard
    const spare = Math.max(0, b.hd * 2 - this.depth(b));
    const grow = b.built >= 1 ? 1 : 0.08 + 0.92 * b.built;
    this.tmp2.makeScale(b.fit, b.fit * b.tall * grow, b.fit).setPosition(0, 0, spare / 2 - setback(spare));
    return out.multiply(this.tmp2);
  }

  private baseColor(b: Building): number | null {
    if (b.abandoned) return ABANDONED;
    if (b.built < 1) return SITE;
    // a street of the same model shouldn't look stamped: weathering and paint vary a little from one to the next
    return VARY[(Math.imul(b.id, 2654435761) >>> 28) % VARY.length];
  }

  rebuild(list: Building[]) {
    for (const m of this.kinds.values()) { this.group.remove(m); m.dispose(); }
    this.kinds.clear();
    for (const m of this.parked) { this.group.remove(m); m.dispose(); }
    this.parked = [];
    if (this.yards) { this.group.remove(this.yards); this.yards.dispose(); this.yards = null; }
    const lots = list.filter((b) => b.zone);
    if (lots.length) {
      const ym = new THREE.InstancedMesh(this.yardGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), lots.length);
      ym.receiveShadow = true;
      ym.renderOrder = 1;
      const sc = new THREE.Matrix4();
      lots.forEach((b, i) => {
        lotMatrix(this.tmp, b.c, b.rot, b.side, 0.04);
        // the lot is hw along the road and hd deep; in lot space x runs along the road
        ym.setMatrixAt(i, this.tmp.multiply(sc.makeScale(b.hw * 2 - 0.8, 1, b.hd * 2 - 0.8)));
        ym.setColorAt(i, this.col.setHex(b.built < 1 ? SITE : YARD[ZONE_GROUP[b.zone!]]));
      });
      ym.computeBoundingSphere();
      this.yards = ym;
      this.group.add(ym);
    }
    this.order.clear();
    this.building = [];
    for (const b of list) {
      let a = this.order.get(b.kind);
      if (!a) this.order.set(b.kind, (a = []));
      a.push(b);
    }
    for (const [kind, bs] of this.order) {
      const mm = this.models.buildings.get(kind)!;
      const mesh = new THREE.InstancedMesh(mm.geo, this.mat, bs.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bs.forEach((b, i) => {
        mesh.setMatrixAt(i, this.matrix(this.tmp, b));
        if (b.built < 1) this.building.push({ b, kind, i });
      });
      mesh.computeBoundingSphere();
      this.kinds.set(kind, mesh);
      this.group.add(mesh);
    }
    this.applyColors();
    // parked cars, a deterministic share of bays filled (cars keep their size whatever the model's scale)
    const car = this.models.vehicles.get("car")!;
    const filled: { m: THREE.Matrix4; color: number }[] = [];
    const inv = new THREE.Matrix4();
    for (const [kind, bs] of this.order) {
      const mm = this.models.buildings.get(kind)!;
      for (const b of bs) {
        if (b.built < 1 || b.abandoned) continue;
        const M = this.matrix(this.tmp, b).clone();
        const s = b.zone ? b.fit : 1;
        const tall = b.zone ? b.tall : 1;
        inv.makeScale(1 / s, 1 / (s * tall), 1 / s);
        mm.bays.forEach((bay, k) => {
          const hsh = (b.id * 73856093) ^ (k * 19349663);
          if (!bayTaken(b, k)) return; // ~60% occupied
          filled.push({ m: M.clone().multiply(bay).multiply(inv), color: CAR_COLORS[(hsh >>> 3) % CAR_COLORS.length] });
        });
      }
    }
    if (filled.length) {
      for (const p of car.parts) {
        const im = new THREE.InstancedMesh(p.geo, p.tint ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : this.mat, filled.length);
        im.castShadow = true;
        filled.forEach((f, i) => {
          im.setMatrixAt(i, f.m);
          if (p.tint) im.setColorAt(i, this.col.setHex(f.color));
        });
        im.computeBoundingSphere();
        this.parked.push(im);
        this.group.add(im);
      }
    }
    this.rebuildDrives(list);
  }

  /** Raise buildings under construction (cheap; call a few times a second). */
  updateConstruction() {
    if (!this.building.length) return;
    const touched = new Set<THREE.InstancedMesh>();
    for (const it of this.building) {
      const mesh = this.kinds.get(it.kind);
      if (!mesh) continue;
      mesh.setMatrixAt(it.i, this.matrix(this.tmp, it.b));
      touched.add(mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  /** How cars get into and out of this building's lot. */
  lotWay(b: Building): LotWay {
    const u = fromAngle(b.rot);
    const away = right(u);
    const into = { x: away.x * b.side, y: away.y * b.side };
    const reach = b.zone ? b.hd - setback(Math.max(0, b.hd * 2 - this.depth(b))) + 0.5 : b.hd;
    const drive = { x: b.c.x - into.x * reach, y: b.c.y - into.y * reach };
    const kerb = { ...b.front };
    const bays: LotWay["bays"] = [];
    const mm = this.models.buildings.get(b.kind);
    if (mm?.bays.length && b.built >= 1 && !b.abandoned) {
      const M = this.matrix(new THREE.Matrix4(), b);
      const s = b.zone ? b.fit : 1;
      const inv = new THREE.Matrix4().makeScale(1 / s, 1 / (s * (b.zone ? b.tall : 1)), 1 / s);
      const W = new THREE.Matrix4();
      mm.bays.forEach((bay, k) => {
        if (bayTaken(b, k)) return;
        const e = W.copy(M).multiply(bay).multiply(inv).elements;
        const L = Math.hypot(e[8], e[10]) || 1;
        bays.push({ p: { x: e[12], y: e[14] }, dir: { x: e[8] / L, y: e[10] / L } });
      });
    }
    return { kerb, drive, into, h: 0, bays };
  }

  rebuildDrives(list: Building[]) {
    if (this.drives) { this.group.remove(this.drives); this.drives.geometry.dispose(); this.drives = null; }
    const pos: number[] = [];
    const idx: number[] = [];
    for (const b of list) {
      const u = fromAngle(b.rot);
      const away = right(u); // * side points away from the road
      // placed buildings: from the kerb to the lot edge; zoned lots start at the kerb, so to the model's front
      const reach = b.zone ? b.hd - setback(Math.max(0, b.hd * 2 - this.depth(b))) + 0.5 : b.hd;
      const ex = { x: b.c.x - away.x * b.side * reach, y: b.c.y - away.y * b.side * reach };
      const a = b.front;
      if (Math.hypot(ex.x - a.x, ex.y - a.y) < 0.6) continue;
      const w = b.zone && b.hw > 14 ? 2.6 : 1.7;
      const base = pos.length / 3;
      const y = 0.08;
      pos.push(a.x - u.x * w, y, a.y - u.y * w, a.x + u.x * w, y, a.y + u.y * w);
      pos.push(ex.x - u.x * w, y, ex.y - u.y * w, ex.x + u.x * w, y, ex.y + u.y * w);
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    // make sure faces point up
    const p = g.getAttribute("position");
    const ix = g.getIndex()!.array as Uint16Array;
    for (let t = 0; t < ix.length; t += 3) {
      const ux = p.getX(ix[t + 1]) - p.getX(ix[t]), uz = p.getZ(ix[t + 1]) - p.getZ(ix[t]);
      const vx = p.getX(ix[t + 2]) - p.getX(ix[t]), vz = p.getZ(ix[t + 2]) - p.getZ(ix[t]);
      if (uz * vx - ux * vz < 0) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
    }
    this.drives = new THREE.Mesh(g, this.driveMat);
    this.drives.receiveShadow = true;
    this.drives.renderOrder = 3;
    this.group.add(this.drives);
  }

  private applyColors() {
    for (const [kind, bs] of this.order) {
      const mesh = this.kinds.get(kind)!;
      bs.forEach((b, i) => {
        const c = this.tintFn?.(b) ?? this.baseColor(b);
        mesh.setColorAt(i, c === null ? this.col.set(1, 1, 1) : this.col.setHex(c));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Tint buildings (overlays). null = normal colours. */
  tint(fn: ((b: Building) => number | null) | null) {
    this.tintFn = fn;
    this.applyColors();
  }
}
