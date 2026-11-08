// The towns' greens (game/townplan.ts, docs/design.md "Towns run themselves"): a block of a town's plan kept as a
// park among its homes, drawn as a lawn inside its pavements with a row of trees round the edge and clumps within.

import * as THREE from "three";
import type { Green } from "../game/settlements";
import { makeTreeMesh } from "./roads3d";

/** A green's lawn: the hall squares' lawn colour, a touch fresher. */
const LAWN = 0x93a050;

export class Greens3D {
  readonly group = new THREE.Group();
  private mat = new THREE.MeshLambertMaterial({ color: LAWN, side: THREE.DoubleSide });
  private lawn: THREE.Mesh | null = null;
  private trees: THREE.InstancedMesh | null = null;
  private key = "";

  /** Show these greens (nothing is rebuilt while `key` is the same as last time). */
  update(key: string, list: Green[]) {
    if (key === this.key) return;
    this.key = key;
    if (this.lawn) { this.group.remove(this.lawn); this.lawn.geometry.dispose(); this.lawn = null; }
    if (this.trees) { this.group.remove(this.trees); this.trees.geometry.dispose(); (this.trees.material as THREE.Material).dispose(); this.trees.dispose(); this.trees = null; }
    if (!list.length) return;
    // every lawn in one mesh (the map's x and y are the scene's x and z)
    const geos = list.map((g) => new THREE.ShapeGeometry(new THREE.Shape(g.pts.map((p) => new THREE.Vector2(p.x, p.y)))).rotateX(Math.PI / 2));
    const pos: number[] = [], idx: number[] = [];
    for (const geo of geos) {
      const base = pos.length / 3;
      const P = geo.getAttribute("position");
      for (let i = 0; i < P.count; i++) pos.push(P.getX(i), 0.05, P.getZ(i));
      const I = geo.getIndex();
      if (I) for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i));
      geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.lawn = new THREE.Mesh(geo, this.mat);
    this.lawn.receiveShadow = true;
    this.lawn.renderOrder = 1;
    this.group.add(this.lawn);
    const n = list.reduce((s, g) => s + g.trees.length, 0);
    if (!n) return;
    this.trees = makeTreeMesh(n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const g of list) for (const t of g.trees) {
      // (a hair apart in height so crowns that touch never flicker)
      this.trees.setMatrixAt(k, m.makeScale(t.r * 2, 1, t.r * 2).setPosition(t.p.x, 0.12 + (k % 8) * 0.0005, t.p.y));
      k++;
    }
    this.trees.count = k;
    this.trees.instanceMatrix.needsUpdate = true;
    this.group.add(this.trees);
  }
}
