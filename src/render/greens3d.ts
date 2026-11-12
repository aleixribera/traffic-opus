// The towns' greens (game/townplan.ts, docs/design.md "Towns run themselves"): a block of a town's plan kept as a
// park among its homes, drawn as a lawn inside its pavements with a row of trees round the edge and clumps within,
// and laid out as a park (render/greenplan.ts): gravel paths, benches, the town green's flower bed and flagpole, a
// lay-by of parked cars along its streets, and townspeople walking it. The ground round a hall's square is one too.

import * as THREE from "three";
import type { Green } from "../game/settlements";
import type { PlantedTree } from "./trees3d";
import { seasonal } from "./envShader";
import { LOTS } from "./furniture";
import { greenPlan, type GreenPlan } from "./greenplan";
import type { MergedModel } from "./models";
import { setParked, type ParkSlot } from "./parked3d";
import { zoomCull, type ParkFolk, type TownLife } from "./townlife";
import { PAL } from "./palette";

/** A green's lawn: the hall squares' lawn colour, a touch fresher. */
const LAWN = 0x93a050;
/** The parks' paths (raked gravel), the lay-bys (the driveways' asphalt) and the white lines between their bays. */
const GRAVEL = 0xcdbf9c, LAYBY = PAL.driveway, TICK = 0xe6e2d6;
/** How high each lies (m): the lawn (the ground round a hall's square lies under the square's own), the lay-by, the paths. */
const LAWN_Y = 0.05, UNDER_Y = 0.02, LAYBY_Y = 0.055, PATH_Y = 0.07, TICK_Y = 0.065;
/** How near (m a pixel) for the parks' furniture to be drawn (the squares' is the same: render/townlife.ts). */
const PROPS_SEE = 1.0;

export class Greens3D {
  readonly group = new THREE.Group();
  // (under the season and the hour like every other lawn: it yellows, takes the snow, and goes dark at night)
  private mat = seasonal(new THREE.MeshLambertMaterial({ color: LAWN, side: THREE.DoubleSide }), { atlas: "park" });
  private groundMat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }));
  private propMat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { windows: true });
  private lawn: THREE.Mesh | null = null;
  private ground: THREE.Mesh | null = null;
  private props: THREE.InstancedMesh[] = [];
  /** The greens' trees (the 3D trees draw them, render/trees3d.ts), and a count of how often they changed. */
  trees: PlantedTree[] = [];
  treeVersion = 0;
  private key = "";
  /** The parks as last laid out (for the tests and the dev hook). */
  plans: GreenPlan[] = [];

  constructor(private models?: Map<string, MergedModel>, private life?: TownLife) {
    // (no cars left in the lay-bys of the game before: a game with no greens never updates them)
    setParked([], "greens");
  }

  /** Show these greens (nothing is rebuilt while `key` is the same as last time). */
  update(key: string, list: Green[]) {
    if (key === this.key) return;
    this.key = key;
    if (this.lawn) { this.group.remove(this.lawn); this.lawn.geometry.dispose(); this.lawn = null; }
    if (this.ground) { this.group.remove(this.ground); this.ground.geometry.dispose(); this.ground = null; }
    for (const m of this.props) { this.group.remove(m); m.dispose(); }
    this.props = [];
    const plans = (this.plans = list.map((g) => greenPlan(g, seedOf(g))));
    this.trees = plans.flatMap((p) => p.trees.map((t): PlantedTree => ({ x: t.p.x, y: t.p.y, r: t.r, style: "park" })));
    this.treeVersion++;
    // (no roadside furniture on a green: render/furniture.ts)
    LOTS.set("greens", list.map((g) => g.pts));
    this.parked(plans);
    const folk: ParkFolk[] = plans.flatMap((p) => p.folk);
    this.life?.setExtra("parks", folk, list.length);
    if (!list.length) return;
    // every lawn in one mesh (the map's x and y are the scene's x and z)
    const pos: number[] = [], idx: number[] = [];
    for (const g of list) {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(g.pts.map((p) => new THREE.Vector2(p.x, p.y)))).rotateX(Math.PI / 2);
      const y = g.hole ? UNDER_Y : LAWN_Y;
      const base = pos.length / 3;
      const P = geo.getAttribute("position");
      for (let i = 0; i < P.count; i++) pos.push(P.getX(i), y, P.getZ(i));
      const I = geo.getIndex();
      // (wound to face up, so the snow that lies on what faces up lies on it)
      if (I) for (let i = 0; i < I.count; i += 3) idx.push(base + I.getX(i), base + I.getX(i + 2), base + I.getX(i + 1));
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
    this.groundOf(plans);
    this.furnish(plans);
  }

  /** The paths, the lay-bys and their lines: flat strips, all in one mesh. */
  private groundOf(plans: GreenPlan[]) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const quad = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, y: number, hex: number, ext = 0) => {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 0.05) return;
      const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L, nx = -dy * (w / 2), ny = dx * (w / 2);
      const ax = a.x - dx * ext, ay = a.y - dy * ext, bx = b.x + dx * ext, by = b.y + dy * ext;
      const o = pos.length / 3;
      pos.push(ax + nx, y, ay + ny, ax - nx, y, ay - ny, bx - nx, y, by - ny, bx + nx, y, by + ny);
      c.setHex(hex);
      for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
      // (wound to face up: the scene's z is the map's y)
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    };
    for (const p of plans) {
      for (const lb of p.laybys) {
        const n = lb.inner.length, o = pos.length / 3;
        c.setHex(LAYBY);
        for (let i = 0; i < n; i++) {
          pos.push(lb.inner[i].x, LAYBY_Y, lb.inner[i].y, lb.outer[i].x, LAYBY_Y, lb.outer[i].y);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        for (let i = 0; i + 1 < n; i++) {
          const a = o + i * 2;
          // (up, whichever side of the street it is: the cross of along and across says)
          const ax = lb.inner[i + 1].x - lb.inner[i].x, ay = lb.inner[i + 1].y - lb.inner[i].y;
          const bx = lb.outer[i].x - lb.inner[i].x, by = lb.outer[i].y - lb.inner[i].y;
          if (ax * by - ay * bx > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      for (const t of p.ticks) quad(t.a, t.b, 0.14, TICK_Y, TICK);
      for (const d of p.discs) {
        const n = 24, o = pos.length / 3;
        c.setHex(GRAVEL);
        pos.push(d.c.x, PATH_Y, d.c.y);
        col.push(c.r, c.g, c.b);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          pos.push(d.c.x + Math.cos(a) * d.r, PATH_Y, d.c.y + Math.sin(a) * d.r);
          col.push(c.r, c.g, c.b);
        }
        // (up: round the way the scene's z is the map's y)
        for (let i = 0; i < n; i++) idx.push(o, o + 1 + ((i + 1) % n), o + 1 + i);
      }
      for (const w of p.paths) quad(w.a, w.b, w.w, PATH_Y, GRAVEL, w.w / 2);
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.ground = new THREE.Mesh(geo, this.groundMat);
    this.ground.receiveShadow = true;
    this.ground.renderOrder = 1;
    this.group.add(this.ground);
  }

  /** The benches, flower beds, fountains and planters: one instanced mesh a model, drawn only close in. */
  private furnish(plans: GreenPlan[]) {
    if (!this.models) return;
    const by = new Map<string, THREE.Matrix4[]>();
    for (const p of plans) for (const f of p.props) {
      let a = by.get(f.model);
      if (!a) by.set(f.model, (a = []));
      a.push(new THREE.Matrix4().makeRotationY(f.rot).setPosition(f.x, 0, f.y));
    }
    for (const [model, mats] of by) {
      const mm = this.models.get(model);
      if (!mm) continue;
      const mesh = new THREE.InstancedMesh(mm.geo, this.propMat, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      zoomCull(mesh, PROPS_SEE);
      this.props.push(mesh);
      this.group.add(mesh);
    }
  }

  /** The lay-bys' cars, for render/parked3d.ts to draw with the lots'. */
  private parked(plans: GreenPlan[]) {
    const slots: ParkSlot[] = [];
    for (const p of plans) for (const b of p.bays) {
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(b.dir.x, b.dir.y)).setPosition(b.p.x, 0, b.p.y);
      slots.push({ m, look: b.look, home: b.home });
    }
    setParked(slots, "greens");
  }

  dispose() {
    for (const m of this.props) m.dispose();
    this.mat.dispose();
    this.groundMat.dispose();
    this.propMat.dispose();
  }
}

/** A green's own number, from where it is (the same each time it is laid out). */
function seedOf(g: Green): number {
  return (Math.imul(Math.round(g.mid.x * 4), 73856093) ^ Math.imul(Math.round(g.mid.y * 4), 19349663) ^ Math.imul(g.town, 83492791)) >>> 0;
}
