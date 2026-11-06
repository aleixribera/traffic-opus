import * as THREE from "three";
import type { BuildingKind } from "../config";
import { fromAngle, right, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
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

export class Buildings3D {
  readonly group = new THREE.Group();
  private kinds = new Map<BuildingKind, THREE.InstancedMesh>();
  private parked: THREE.InstancedMesh[] = [];
  private drives: THREE.Mesh | null = null;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private driveMat = new THREE.MeshLambertMaterial({ color: PAL.driveway });
  private order = new Map<BuildingKind, Building[]>();
  private tmp = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(private models: ModelSet) {}

  rebuild(list: Building[]) {
    for (const m of this.kinds.values()) { this.group.remove(m); m.dispose(); }
    this.kinds.clear();
    for (const m of this.parked) { this.group.remove(m); m.dispose(); }
    this.parked = [];
    this.order.clear();
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
        mesh.setMatrixAt(i, lotMatrix(this.tmp, b.c, b.rot, b.side));
        mesh.setColorAt(i, this.col.set(1, 1, 1));
      });
      mesh.computeBoundingSphere();
      this.kinds.set(kind, mesh);
      this.group.add(mesh);
    }
    // parked cars, a deterministic share of bays filled
    const car = this.models.vehicles.get("car")!;
    const filled: { m: THREE.Matrix4; color: number }[] = [];
    for (const [kind, bs] of this.order) {
      const mm = this.models.buildings.get(kind)!;
      for (const b of bs) {
        lotMatrix(this.tmp, b.c, b.rot, b.side);
        mm.bays.forEach((bay, k) => {
          const hsh = (b.id * 73856093) ^ (k * 19349663);
          if ((hsh >>> 0) % 10 < 4) return; // ~60% occupied
          filled.push({ m: this.tmp.clone().multiply(bay), color: CAR_COLORS[(hsh >>> 3) % CAR_COLORS.length] });
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

  rebuildDrives(list: Building[]) {
    if (this.drives) { this.group.remove(this.drives); this.drives.geometry.dispose(); this.drives = null; }
    const pos: number[] = [];
    const idx: number[] = [];
    for (const b of list) {
      const u = fromAngle(b.rot);
      const toward = right(u); // * -side points at the road
      const ex = { x: b.c.x - toward.x * b.side * b.hd, y: b.c.y - toward.y * b.side * b.hd };
      // driveway from the kerb (b.front) straight back to the lot edge
      const a = b.front;
      const w = 1.7;
      const base = pos.length / 3;
      const y = 0.045;
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
    this.group.add(this.drives);
  }

  /** Tint buildings (overlays, magnifier highlights). null = normal colours. */
  tint(fn: ((b: Building) => number | null) | null) {
    for (const [kind, bs] of this.order) {
      const mesh = this.kinds.get(kind)!;
      bs.forEach((b, i) => {
        const c = fn ? fn(b) : null;
        mesh.setColorAt(i, c === null ? this.col.set(1, 1, 1) : this.col.setHex(c));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Ghost mesh for placement previews. */
  ghost(kind: BuildingKind): THREE.Mesh {
    const mm = this.models.buildings.get(kind)!;
    const m = new THREE.Mesh(mm.geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false }));
    m.renderOrder = 6;
    return m;
  }

}
