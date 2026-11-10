// One vehicle kind drawn in one call: its whole model is one geometry (render/models.ts splitVehicle), and each
// instance brings its own three paints (body, second, cargo), which the shader lays on the parts they belong to.

import * as THREE from "three";
import type { VehicleModel } from "./models";

const PARS = `
attribute float role;
attribute vec3 iBody;
attribute vec3 iSecond;
attribute vec4 iCargo;
`;
/** (an open body running empty: its load's vertices fold to a point) */
const FOLD = `
if (role > 2.5 && iCargo.a < 0.5) transformed *= 0.0;
`;

/** The materials every painted vehicle shares: the lit one, and the one its shadow is drawn with. */
export class PaintMaterials {
  readonly lit = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

  constructor() {
    this.lit.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + PARS)
        .replace("#include <color_vertex>", `#include <color_vertex>
vColor.rgb *= role < 0.5 ? vec3(1.0) : role < 1.5 ? iBody : role < 2.5 ? iSecond : iCargo.rgb;`)
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + FOLD);
    };
    this.depth.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + PARS)
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + FOLD);
    };
  }
}

/** Hex colours as the renderer's own (linear) numbers, kept: every vehicle asks every frame. */
const LIN = new Map<number, readonly [number, number, number]>();
const tmpC = new THREE.Color();
export function lin(hex: number): readonly [number, number, number] {
  let c = LIN.get(hex);
  if (!c) {
    tmpC.setHex(hex);
    c = [tmpC.r, tmpC.g, tmpC.b];
    LIN.set(hex, c);
  }
  return c;
}

/** A vehicle kind's instances: the model near, its few-triangle `far` (if it has one), a paint for each. */
export class Painted {
  mesh!: THREE.InstancedMesh;
  cap = 0;
  private near = new THREE.BufferGeometry();
  private farGeo: THREE.BufferGeometry | null = null;
  private body!: THREE.InstancedBufferAttribute;
  private second!: THREE.InstancedBufferAttribute;
  private cargo!: THREE.InstancedBufferAttribute;

  constructor(private model: VehicleModel, cap: number, private mats: PaintMaterials, private parent: THREE.Object3D) {
    this.make(cap);
  }

  private make(cap: number) {
    this.cap = cap;
    this.body = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.second = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.cargo = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.body, this.second, this.cargo]) a.setUsage(THREE.DynamicDrawUsage);
    const wrap = (src: THREE.BufferGeometry) => {
      // (the model's own buffers, shared; the paints are this batch's)
      const g = new THREE.BufferGeometry();
      for (const k of ["position", "normal", "color", "role"]) g.setAttribute(k, src.getAttribute(k));
      g.setAttribute("iBody", this.body);
      g.setAttribute("iSecond", this.second);
      g.setAttribute("iCargo", this.cargo);
      return g;
    };
    this.near = wrap(this.model.geo);
    this.farGeo = this.model.far ? wrap(this.model.far) : null;
    this.mesh = new THREE.InstancedMesh(this.near, this.mats.lit, cap);
    this.mesh.customDepthMaterial = this.mats.depth;
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.parent.add(this.mesh);
  }

  /** Room for n instances (what was written is lost: every instance is written again each time). */
  ensure(n: number) {
    if (n <= this.cap) return;
    this.drop();
    this.make(Math.max(n, this.cap * 2));
  }

  /** Free this batch's own buffers (the model's are shared with every other batch of it: they stay). */
  private drop() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    for (const g of [this.near, this.farGeo]) {
      if (!g) continue;
      for (const k of ["position", "normal", "color", "role"]) g.deleteAttribute(k);
      g.dispose();
    }
  }

  /** Draw the few-triangle model (a car a handful of pixels long) or the full one. */
  far(on: boolean) {
    const g = on && this.farGeo ? this.farGeo : this.near;
    if (this.mesh.geometry !== g) this.mesh.geometry = g;
  }

  /** Instance i: where it is and what it wears (`cargo` null: nothing on it). */
  set(i: number, m: THREE.Matrix4, body: number, second: number, cargo: number | null) {
    this.mesh.setMatrixAt(i, m);
    const b = lin(body), s = lin(second), c = lin(cargo ?? 0xffffff);
    this.body.setXYZ(i, b[0], b[1], b[2]);
    this.second.setXYZ(i, s[0], s[1], s[2]);
    this.cargo.setXYZW(i, c[0], c[1], c[2], cargo === null ? 0 : 1);
  }

  /** n instances were written. */
  commit(n: number) {
    this.mesh.count = n;
    if (!n) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.body.needsUpdate = this.second.needsUpdate = this.cargo.needsUpdate = true;
    for (const a of [this.mesh.instanceMatrix, this.body, this.second, this.cargo]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
    }
  }

  dispose() {
    this.drop();
  }
}
