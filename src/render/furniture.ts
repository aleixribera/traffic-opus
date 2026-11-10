// What stands along the country roads of 1930 (models: tools/blender/town_f_furniture.py): the telegraph line, a
// pole every fifty metres on the verge with six wires sagging between them, and the billboards a town puts out to
// meet the traffic coming in.
//
// None of it is in the game's state: it is placed again from the roads, the towns' streets and what is built each
// time one of them changes, by rules alone, so it is the same in every session of a save. It never stands on a road,
// a driveway, a lot, a works site or water (Roads3D asks, through `free`), and it is drawn only when the camera is
// near enough to make it out (zoomCull): from far up it costs nothing.

import * as THREE from "three";
import { dist, dot, norm, pointSegDist2, polyAt, polyClosest, polyDirSmooth, polygonContains, right, type Polyline, type V2 } from "../core/math";
import { townAt, type TownRuns } from "../game/rural";
import { seasonal } from "./envShader";
import type { MergedModel } from "./models";

// ---------------------------------------------------------------------------------------------
// Ground that is taken
// ---------------------------------------------------------------------------------------------

const CELL = 32, REACH = 12;
const ckey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/** Shapes on the map found through a grid: is a point within r of any of them? */
export class Occupied {
  /** Goes up each time the shapes change. */
  version = 0;
  private sets = new Map<string, { sig: number; polys: V2[][] }>();
  private cells: Map<number, V2[][]> | null = null;

  /** `who` says what stands where now (nothing changes while its `sig` is what it was). */
  set(who: string, polys: V2[][], sig = NaN) {
    const had = this.sets.get(who);
    if (had && had.sig === sig) return;
    if (!had && !polys.length) return;
    this.sets.set(who, { sig, polys });
    this.cells = null;
    this.version++;
  }

  private index(): Map<number, V2[][]> {
    const cells = new Map<number, V2[][]>();
    for (const { polys } of this.sets.values()) {
      for (const poly of polys) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        for (let j = Math.floor((y0 - REACH) / CELL); j <= Math.floor((y1 + REACH) / CELL); j++) {
          for (let i = Math.floor((x0 - REACH) / CELL); i <= Math.floor((x1 + REACH) / CELL); i++) {
            const k = ckey(i, j), list = cells.get(k);
            if (list) list.push(poly); else cells.set(k, [poly]);
          }
        }
      }
    }
    return cells;
  }

  /** Is (x, y) inside a shape, or within r of one (r up to 12 m)? */
  hit(x: number, y: number, r: number): boolean {
    if (!this.sets.size) return false;
    this.cells ??= this.index();
    const list = this.cells.get(ckey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return false;
    const p = { x, y };
    for (const poly of list) {
      if (polygonContains(poly, p)) return true;
      for (let i = 0; i < poly.length; i++) if (pointSegDist2(p, poly[i], poly[(i + 1) % poly.length]).d2 < r * r) return true;
    }
    return false;
  }
}

/** Every lot, works site and green on the map, as the layers that draw them last said (Buildings3D, Greens3D). */
export const LOTS = new Occupied();
/** Where the furniture's bigger pieces stand: the wild trees keep off them (render/forest.ts). */
export const KEEP = new Occupied();

// ---------------------------------------------------------------------------------------------
// Placing it
// ---------------------------------------------------------------------------------------------

/** A road as the furniture sees it (no roundabout's ring is one). */
export interface RoadLine {
  id: number;
  /** its end nodes */
  a: number; b: number;
  center: Polyline;
  /** its height at each of the centreline's points */
  hs: ArrayLike<number>;
  halfW: number;
  /** the stretch of the centreline it is drawn over (the rest is under its junctions) */
  from: number; to: number;
  /** its town stretches (none: country all along) */
  runs: TownRuns | undefined;
  /** a road the telegraph follows and billboards stand by (not a motorway) */
  carries: boolean;
  /** widens into turn lanes at this end */
  pocketA: boolean; pocketB: boolean;
}

export interface Pole { x: number; y: number; h: number; dx: number; dy: number; road: number; s: number }
/** A span of wire between two poles (their places in `poles`). */
export interface Span { a: number; b: number }
/** A billboard: its middle, the way its poster faces, which poster, its footprint, and the ground kept clear of wild
 * trees round it (its footprint and the view of its poster). */
export interface Board { x: number; y: number; h: number; fx: number; fy: number; art: number; road: number; poly: V2[]; keep: V2[] }
export interface Placed { poles: Pole[]; spans: Span[]; boards: Board[] }

/** A pole about this often along a road (m), this far beyond its edge, and clear of its ends by this much. */
export const POLE_EVERY = 46;
export const POLE_OFF = 2.6;
const POLE_ENDS = 7;
/** The longest span of wire (m). */
export const SPAN_MAX = 98;
/** A pole and a billboard keep this clear of everything built (m). */
export const POLE_CLEAR = 1.2, BOARD_CLEAR = 1.5;
/** A billboard: its hoarding's half width and depth (m), how far it is turned to the road, how far before the town it
 * stands (the first of these along the road that is free), and how near another may stand. */
export const BOARD_SCALE = 1.25, BOARD_HW = 3.9 * BOARD_SCALE, BOARD_HD = 1.0 * BOARD_SCALE;
const BOARD_TURN = (38 * Math.PI) / 180;
const BOARD_BACK = [40, 56, 72];
const BOARD_APART = 160;
export const BOARD_ARTS = 3;

const hash = (a: number, b: number) => ((Math.imul(a + 11, 2654435761) ^ Math.imul(b + 5, 2246822519)) >>> 0) / 4294967296;

/** A road's height at s along it. */
function heightAt(r: RoadLine, s: number): number {
  const cum = r.center.cum;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const f = Math.min(1, Math.max(0, (s - cum[i]) / (cum[i + 1] - cum[i] || 1)));
  return r.hs[i] + (r.hs[i + 1] - r.hs[i]) * f;
}

/** Is the road out in the country and on the ground at s? */
const wild = (r: RoadLine, s: number) => !townAt(r.runs, s) && heightAt(r, s) < 0.3;

/**
 * The telegraph line and the billboards for these roads. `roadsAt` names the roads meeting at a node; `free` says
 * whether a spot of radius r is clear of everything but the road it stands by (other roads, driveways, lots, water);
 * `taken` whether a spot is on a lot or a works site (no wire is strung across one).
 */
export function placeFurniture(
  roads: RoadLine[], roadsAt: (node: number) => number[], free: (x: number, y: number, r: number, own: number) => boolean,
  taken: (x: number, y: number, r: number) => boolean = () => false,
): Placed {
  const byId = new Map(roads.map((r) => [r.id, r]));
  const poles: Pole[] = [], spans: Span[] = [];
  /** each road's poles, in order along it */
  const along = new Map<number, number[]>();

  // the poles: on one side of the road (the same side for roads running the same way, so the line keeps to it; the
  // north and west side, so that in the view as it opens the wires hang over the verge, not the dark of the road),
  // evenly along each piece of it
  for (const r of roads) {
    if (!r.carries) continue;
    const L = r.center.length, usable = r.to - r.from - POLE_ENDS * 2;
    if (usable < 18) continue;
    const mid = polyDirSmooth(r.center, L / 2, 6);
    const side = dot(right(mid), { x: 0.39, y: 0.92 }) >= 0 ? -1 : 1;
    const n = Math.max(1, Math.round(usable / POLE_EVERY));
    const mine: number[] = [];
    for (let k = 0; k < n; k++) {
      const s = r.from + POLE_ENDS + (usable * (k + 0.5)) / n;
      if (!wild(r, s) || !wild(r, s - 4) || !wild(r, s + 4)) continue;
      // (clear of the lanes a road opens into before a junction)
      if ((r.pocketA && s < 60) || (r.pocketB && L - s < 60)) continue;
      const p = polyAt(r.center, s), d = polyDirSmooth(r.center, s, 4), q = right(d), off = (r.halfW + POLE_OFF) * side;
      const x = p.x + q.x * off, y = p.y + q.y * off;
      // (on the inside of a sharp bend the road itself comes round to meet it)
      if (polyClosest(r.center, { x, y }).d < r.halfW + POLE_OFF - 0.4) continue;
      if (!free(x, y, POLE_CLEAR, r.id)) continue;
      mine.push(poles.length);
      poles.push({ x, y, h: heightAt(r, s), dx: d.x, dy: d.y, road: r.id, s });
    }
    if (mine.length) along.set(r.id, mine);
  }

  // the wires: pole to pole along a road, and on round a bend or across a junction to the next road's first pole
  const linked = new Set<number>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const k = Math.min(a, b) * 1048576 + Math.max(a, b);
    const p = poles[a], q = poles[b], d = dist(p, q);
    if (linked.has(k) || d > SPAN_MAX || d < 6) return;
    // (not over a yard or a works: the line stops at its fence and takes up again past it)
    for (let n = Math.ceil(d / 7), i = 1; i < n; i++) if (taken(p.x + ((q.x - p.x) * i) / n, p.y + ((q.y - p.y) * i) / n, 0.5)) return;
    linked.add(k);
    spans.push({ a, b });
  };
  for (const [id, mine] of along) {
    const r = byId.get(id)!;
    for (let i = 0; i + 1 < mine.length; i++) {
      const p = poles[mine[i]], q = poles[mine[i + 1]];
      // (not over a stretch of town street between them)
      if (wild(r, (p.s + q.s) / 2)) link(mine[i], mine[i + 1]);
    }
  }
  /** The first poles met going out of `node` along every road but `from`, no farther than `budget` by road. */
  const reach = (node: number, from: number, budget: number, depth: number, out: number[]) => {
    for (const oid of roadsAt(node)) {
      if (oid === from) continue;
      const o = byId.get(oid);
      if (!o || !o.carries) continue;
      const L = o.center.length, ps = along.get(oid);
      if (ps) {
        const pi = o.a === node ? ps[0] : ps[ps.length - 1];
        const d = o.a === node ? poles[pi].s : L - poles[pi].s;
        if (d <= budget) out.push(pi);
      } else if (L < budget && depth < 3 && o.a !== o.b) {
        reach(o.a === node ? o.b : o.a, oid, budget - L, depth + 1, out);
      }
    }
  };
  for (const [id, mine] of along) {
    const r = byId.get(id)!, L = r.center.length;
    for (const [node, pi, d] of [[r.a, mine[0], poles[mine[0]].s], [r.b, mine[mine.length - 1], L - poles[mine[mine.length - 1]].s]] as const) {
      const found: number[] = [];
      reach(node, id, SPAN_MAX + 12 - d, 0, found);
      for (const q of found) link(pi, q);
    }
  }
  // each pole's crossarms square to the line through it
  const sum = poles.map(() => ({ x: 0, y: 0 }));
  for (const { a, b } of spans) {
    const d = norm({ x: poles[b].x - poles[a].x, y: poles[b].y - poles[a].y });
    for (const i of [a, b]) {
      const sg = d.x * poles[i].dx + d.y * poles[i].dy >= 0 ? 1 : -1;
      sum[i].x += d.x * sg; sum[i].y += d.y * sg;
    }
  }
  poles.forEach((p, i) => {
    if (Math.hypot(sum[i].x, sum[i].y) < 0.5) return;
    const d = norm(sum[i]);
    p.dx = d.x; p.dy = d.y;
  });

  // the billboards: where a country road comes to a town, on the right of the traffic coming in and turned to it
  const boards: Board[] = [];
  /** A board by road r for the traffic that reaches the town at `edge` going `way` (1: a to b) along it. */
  const board = (r: RoadLine, edge: number, way: 1 | -1) => {
    const L = r.center.length;
    for (const back of BOARD_BACK) {
      const s = edge - way * back;
      if (s < r.from + 6 || s > r.to - 6) return;
      if (!wild(r, s) || !wild(r, s - 14) || !wild(r, s + 14)) continue;
      if ((r.pocketA && s < 70) || (r.pocketB && L - s < 70)) continue;
      const p = polyAt(r.center, s), t0 = polyDirSmooth(r.center, s, 6);
      const t = { x: t0.x * way, y: t0.y * way }, n = right(t);
      // facing back down the road and a little in towards it
      const cs = Math.cos(BOARD_TURN), sn = Math.sin(BOARD_TURN);
      const f = { x: -t.x * cs - n.x * sn, y: -t.y * cs - n.y * sn }, u = right(f);
      // (its near corner a little off the verge)
      const off = r.halfW + 3.0 + BOARD_HW * cs + BOARD_HD * sn;
      const c = { x: p.x + n.x * off, y: p.y + n.y * off };
      // (its hoarding stands just behind its middle: braces out the back, lamps out the front)
      const rect = (front: number, back: number) => [[-BOARD_HW, -front], [BOARD_HW, -front], [BOARD_HW, back], [-BOARD_HW, back]]
        .map(([a, o]) => ({ x: c.x + u.x * a - f.x * o, y: c.y + u.y * a - f.y * o }));
      const poly = rect(BOARD_HD * 0.9, BOARD_HD * 1.9);
      // (and the trees keep off it: a strip before each face, a little to either side)
      const keep = [[-BOARD_HW - 2.5, -11], [BOARD_HW + 2.5, -11], [BOARD_HW + 2.5, 8], [-BOARD_HW - 2.5, 8]]
        .map(([a, o]) => ({ x: c.x + u.x * a - f.x * o, y: c.y + u.y * a - f.y * o }));
      if (boards.some((b) => dist(b, c) < BOARD_APART)) return;
      const probes = [c, ...poly, { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }, { x: (poly[2].x + poly[3].x) / 2, y: (poly[2].y + poly[3].y) / 2 }];
      if (probes.some((q) => polyClosest(r.center, q).d < r.halfW + 1.6 || !free(q.x, q.y, BOARD_CLEAR, r.id))) continue;
      boards.push({ x: c.x, y: c.y, h: heightAt(r, s), fx: f.x, fy: f.y, art: Math.floor(hash(r.id, way + 2) * BOARD_ARTS) % BOARD_ARTS, road: r.id, poly, keep });
      return;
    }
  };
  /** Is some road at this node a town street there? */
  const townNode = (node: number) => roadsAt(node).some((oid) => {
    const o = byId.get(oid);
    return !!o && townAt(o.runs, o.a === node ? 0 : o.center.length);
  });
  for (const r of roads) {
    if (!r.carries) continue;
    const L = r.center.length;
    for (const [u, v] of r.runs ?? []) {
      if (u > 1) board(r, u, 1);
      if (v < L - 1) board(r, v, -1);
    }
    if (!townAt(r.runs, 0) && townNode(r.a)) board(r, 0, -1);
    if (!townAt(r.runs, L) && r.b !== r.a && townNode(r.b)) board(r, L, 1);
  }
  // (no two neighbours with the same poster)
  boards.forEach((b, i) => {
    const near = boards.slice(0, i).filter((o) => dist(o, b) < 900).map((o) => o.art);
    for (let k = 0; k < BOARD_ARTS && near.includes(b.art); k++) b.art = (b.art + 1) % BOARD_ARTS;
  });
  return { poles, spans, boards };
}

// ---------------------------------------------------------------------------------------------
// Drawing it
// ---------------------------------------------------------------------------------------------

/** Draw the mesh's instances only while a pixel is no more than `maxMpp` metres (the view's own camera says). */
function zoomCull(mesh: THREE.InstancedMesh, maxMpp: number) {
  const full = mesh.count, size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const c = camera as THREE.OrthographicCamera;
    if (!c.isOrthographicCamera) return;
    const h = renderer.getSize(size).y || 1;
    mesh.count = (c.top - c.bottom) / c.zoom / h <= maxMpp ? full : 0;
  };
}

/** How near the camera must be for each to be drawn (metres a pixel): a wire is a hair, a pole a stroke. */
const SEE = { pole: 0.56, wire: 0.26, board: 1.0 };

export class Furniture3D {
  readonly group = new THREE.Group();
  // (their own colours, the season's snow on them, a billboard's poster lit at night like a sign)
  private mat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { windows: true });
  private meshes: THREE.InstancedMesh[] = [];

  constructor(private props: Map<string, MergedModel>) {}

  show(placed: Placed) {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const make = (model: string, n: number, see: number, shadow: boolean, at: (i: number) => void) => {
      const mm = this.props.get(model);
      if (!mm || !n) return;
      const mesh = new THREE.InstancedMesh(mm.geo, this.mat, n);
      for (let i = 0; i < n; i++) { at(i); mesh.setMatrixAt(i, M); }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false; // (they stand all over the map)
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      zoomCull(mesh, see);
      this.meshes.push(mesh);
      this.group.add(mesh);
    };
    const { poles, spans, boards } = placed;
    // (a model's front, Blender's -Y, is three's +z: turned onto the way it faces)
    make("telegraphpole", poles.length, SEE.pole, true, (i) => {
      const p = poles[i];
      M.compose(pos.set(p.x, p.h, p.y), q.setFromAxisAngle(up, Math.atan2(p.dx, p.dy)), sc.set(1, 1, 1));
    });
    make("telegraphwire", spans.length, SEE.wire, false, (i) => {
      const a = poles[spans[i].a], b = poles[spans[i].b];
      M.compose(pos.set(a.x, (a.h + b.h) / 2, a.y), q.setFromAxisAngle(up, Math.atan2(b.x - a.x, b.y - a.y)), sc.set(1, 1, Math.hypot(b.x - a.x, b.y - a.y)));
    });
    for (let art = 0; art < BOARD_ARTS; art++) {
      const mine = boards.filter((b) => b.art === art);
      make("billboard_" + "abc"[art], mine.length, SEE.board, true, (i) => {
        const b = mine[i];
        M.compose(pos.set(b.x, b.h, b.y), q.setFromAxisAngle(up, Math.atan2(b.fx, b.fy)), sc.set(BOARD_SCALE, BOARD_SCALE, BOARD_SCALE));
      });
    }
  }
}
