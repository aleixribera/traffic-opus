import * as THREE from "three";
import type { Traffic, Vehicle } from "../sim/traffic";
import type { ModelSet, VehicleKind } from "./models";
import { CARGO_COLOR } from "./palette";

interface Batch {
  kind: VehicleKind;
  meshes: { mesh: THREE.InstancedMesh; tint: "body" | "cargo" | null }[];
  cap: number;
}

const LIFT = 0.07;

/** All moving vehicles as instanced Blender models, interpolated between sim steps. */
export class Vehicles3D {
  readonly group = new THREE.Group();
  private batches = new Map<VehicleKind, Batch>();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private tintMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private X = new THREE.Vector3();
  private Y = new THREE.Vector3(0, 1, 0);
  private Z = new THREE.Vector3();
  private S = new THREE.Vector3();

  constructor(private models: ModelSet) {
    for (const k of ["car", "van", "truck"] as VehicleKind[]) this.batches.set(k, this.makeBatch(k, 256));
  }

  private makeBatch(kind: VehicleKind, cap: number): Batch {
    const vm = this.models.vehicles.get(kind)!;
    const meshes = vm.parts.map((p) => {
      const mesh = new THREE.InstancedMesh(p.geo, p.tint ? this.tintMat : this.mat, cap);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      if (p.tint) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      return { mesh, tint: p.tint ? (p.name === "cargo" ? "cargo" as const : "body" as const) : null };
    });
    return { kind, meshes, cap };
  }

  private ensure(kind: VehicleKind, n: number): Batch {
    let b = this.batches.get(kind)!;
    if (n <= b.cap) return b;
    for (const x of b.meshes) { this.group.remove(x.mesh); x.mesh.dispose(); }
    b = this.makeBatch(kind, Math.max(n, b.cap * 2));
    this.batches.set(kind, b);
    return b;
  }

  static kindOf(v: Vehicle): VehicleKind {
    if (v.truck) return "truck";
    return v.id % 6 === 0 ? "van" : "car";
  }

  /** Write one vehicle pose into a matrix (also used for parked cars). */
  pose(out: THREE.Matrix4, x: number, y: number, h: number, ang: number, s = 1) {
    const cx = Math.cos(ang), sz = Math.sin(ang);
    this.Z.set(cx, 0, sz);
    this.X.set(sz, 0, -cx);
    out.makeBasis(this.X, this.Y, this.Z);
    if (s !== 1) out.scale(this.S.set(s, s, s));
    out.setPosition(x, h + LIFT, y);
  }

  update(traffic: Traffic, alpha: number) {
    const lists: Record<VehicleKind, Vehicle[]> = { car: [], van: [], truck: [] };
    for (const v of traffic.vehicles) lists[Vehicles3D.kindOf(v)].push(v);
    for (const kind of ["car", "van", "truck"] as VehicleKind[]) {
      const vs = lists[kind];
      const b = this.ensure(kind, vs.length);
      for (const { mesh } of b.meshes) mesh.count = vs.length;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        const x = v.px + (v.x - v.px) * alpha;
        const y = v.py + (v.y - v.py) * alpha;
        const h = v.ph + (v.h - v.ph) * alpha;
        let da = v.ang - v.pang;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        const ang = v.pang + da * alpha;
        const f = v.fade < 1 ? 0.55 + 0.45 * v.fade : 1;
        this.pose(this.m, x, y, h, ang, f);
        for (const { mesh, tint } of b.meshes) {
          mesh.setMatrixAt(i, this.m);
          if (tint === "body") mesh.setColorAt(i, this.c.setHex(v.color));
          else if (tint === "cargo") mesh.setColorAt(i, this.c.setHex(v.trip.cargo ? CARGO_COLOR[v.trip.cargo] ?? 0xf2f2ee : 0xf2f2ee));
        }
      }
      for (const { mesh } of b.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
