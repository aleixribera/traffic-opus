// Industrial-park links on the map (game/parks.ts): a belt conveyor (or a pipe bridge, for crude and fuel) striding on
// trestles from one plant's yard to the other's, a transfer tower at each end, and the goods visibly on the move: loads
// riding the belt, pulses of flow running along the pipe, as thick as the link is busy. All Blender models.

import * as THREE from "three";
import type { ParkLink } from "../game/parks";
import { LINK_CAP } from "../game/parks";
import type { ModelSet } from "./models";
import { CARGO_COLOR } from "./palette";
import { faceMatrix } from "./buildings3d";
import { seasonal } from "./envShader";

/** A segment model's length (m), and how high the belt and the pipe's middle stand (m; from the Blender models). */
const SEG = 12, BELT_Y = 7.16, PIPE_Y = 6.77, PIPE_X = -0.75;
/** Clear of each end tower's middle (m): the run starts at its face. */
const TOWER = 3;
/** How fast the goods move (m/s): a belt's loads, a pipe's flow. */
const BELT_V = 1.8, FLOW_V = 3.2;
/** A link standing still (a plant at one end has no road): its towers and run greyed down to this. */
const STOPPED = new THREE.Color(0.42, 0.42, 0.44), RUNNING = new THREE.Color(1, 1, 1);

export class Parks3D {
  readonly group = new THREE.Group();
  private mat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { roofs: true });
  private statics: THREE.InstancedMesh[] = [];
  private loads: THREE.InstancedMesh | null = null;
  private flows: THREE.InstancedMesh | null = null;
  private sig = "";
  private m = new THREE.Matrix4();
  private s = new THREE.Matrix4();
  private c = new THREE.Color();

  constructor(private models: ModelSet) {
    const load = models.sites.get("link_load"), flow = models.sites.get("link_flow");
    if (load) { this.loads = this.moving(load.geo); }
    if (flow) { this.flows = this.moving(flow.geo); }
  }

  private moving(geo: THREE.BufferGeometry): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, this.mat, 256);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(m);
    return m;
  }

  /** Where a link runs: from the face of the tower at one end to the face of the other's. */
  private run(l: ParkLink) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const f = { x: dx / len, y: dy / len };
    return { f, len: Math.max(0, len - 2 * TOWER), a: { x: l.a.x + f.x * TOWER, y: l.a.y + f.y * TOWER } };
  }

  /** The towers and belts (only when the links change). */
  private rebuild(links: ParkLink[]) {
    for (const m of this.statics) { this.group.remove(m); m.dispose(); }
    this.statics = [];
    type Piece = { m: THREE.Matrix4; off: boolean };
    const towers: Piece[] = [], belts: Piece[] = [], pipes: Piece[] = [];
    // (two products between the same plants share one link's towers and run)
    const seen = new Set<string>();
    for (const l of links) {
      const k = `${Math.min(l.from, l.to)}-${Math.max(l.from, l.to)}:${l.pipe}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const off = l.stopped !== undefined;
      const { f, len, a } = this.run(l);
      for (const p of [l.a, l.b]) towers.push({ m: faceMatrix(new THREE.Matrix4(), p, f), off });
      const n = Math.max(1, Math.round(len / SEG)), step = len / n;
      for (let i = 0; i < n; i++) {
        const c = { x: a.x + f.x * step * (i + 0.5), y: a.y + f.y * step * (i + 0.5) };
        const m = faceMatrix(new THREE.Matrix4(), c, f).multiply(this.s.makeScale(1, 1, step / SEG));
        (l.pipe ? pipes : belts).push({ m, off });
      }
    }
    for (const [name, ms] of [["link_tower", towers], ["link_conveyor", belts], ["link_pipe", pipes]] as const) {
      const mm = this.models.sites.get(name);
      if (!mm || !ms.length) continue;
      const im = new THREE.InstancedMesh(mm.geo, this.mat, ms.length);
      ms.forEach((x, i) => { im.setMatrixAt(i, x.m); im.setColorAt(i, x.off ? STOPPED : RUNNING); });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.statics.push(im);
    }
  }

  /** Every frame: the goods move along each busy link (`time` in seconds; the sim's clock, so a pause stops them). */
  update(links: ParkLink[], time: number) {
    const sig = links.map((l) => `${l.from}>${l.to}:${l.product}:${l.a.x.toFixed(1)},${l.a.y.toFixed(1)}${l.stopped !== undefined ? "x" : ""}`).join("|");
    if (sig !== this.sig) { this.sig = sig; this.rebuild(links); }
    let nl = 0, nf = 0;
    for (const l of links) {
      const rate = Math.max(l.last, l.now);
      if (rate <= 0 || l.stopped !== undefined) continue;
      const out = l.pipe ? this.flows : this.loads;
      if (!out) continue;
      const { f, len, a } = this.run(l);
      // (a busier link runs thicker: loads closer together)
      const gap = (l.pipe ? 7 : 4) + 8 * (1 - Math.min(1, rate / LINK_CAP));
      const v = l.pipe ? FLOW_V : BELT_V;
      const first = (time * v) % gap;
      this.c.setHex(CARGO_COLOR[l.product] ?? 0xcccccc);
      for (let s = first; s < len; s += gap) {
        const p = { x: a.x + f.x * s, y: a.y + f.y * s };
        faceMatrix(this.m, p, f, l.pipe ? PIPE_Y : BELT_Y);
        if (l.pipe) this.m.multiply(this.s.makeTranslation(PIPE_X, 0, 0));
        const i = l.pipe ? nf++ : nl++;
        if (i >= out.instanceMatrix.count) break;
        out.setMatrixAt(i, this.m);
        out.setColorAt(i, this.c);
      }
    }
    for (const [m, n] of [[this.loads, nl], [this.flows, nf]] as const) {
      if (!m) continue;
      m.count = Math.min(n, m.instanceMatrix.count);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
