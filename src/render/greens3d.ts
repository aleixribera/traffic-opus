// The towns' greens (game/townplan.ts, docs/design.md "Towns run themselves"): a block of a town's plan kept as a
// park among its homes, drawn as a lawn inside its pavements with a row of trees round the edge and clumps within.

import * as THREE from "three";
import type { Green } from "../game/settlements";
import type { PlantedTree } from "./trees3d";

/** A green's lawn: the hall squares' lawn colour, a touch fresher. */
const LAWN = 0x93a050;

export class Greens3D {
  readonly group = new THREE.Group();
  private mat = new THREE.MeshLambertMaterial({ color: LAWN, side: THREE.DoubleSide });
  private lawn: THREE.Mesh | null = null;
  /** The greens' trees (the 3D trees draw them, render/trees3d.ts), and a count of how often they changed. */
  trees: PlantedTree[] = [];
  treeVersion = 0;
  private key = "";

  /** Show these greens (nothing is rebuilt while `key` is the same as last time). */
  update(key: string, list: Green[]) {
    if (key === this.key) return;
    this.key = key;
    if (this.lawn) { this.group.remove(this.lawn); this.lawn.geometry.dispose(); this.lawn = null; }
    this.trees = list.flatMap((g) => g.trees.map((t): PlantedTree => ({ x: t.p.x, y: t.p.y, r: t.r, style: "park" })));
    this.treeVersion++;
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
  }
}
