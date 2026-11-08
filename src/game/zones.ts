// Zoning, the way Cities: Skylines 2 does it: blocks of 8 m cells along both sides of every road that allows
// driveways, 6 cells deep, following curves. Overlapping cells go to the older block. Zone types are painted onto
// cells; buildings grow on runs of cells (lots). Cells are rebuilt around road edits and keep their zone and lot by
// position, so splitting or reshaping a road doesn't wipe the zoning next to it.

import { LANE_W, ROAD_TYPES } from "../config";
import { add, dist, fromAngle, pointSegDist2, polyAt, polyDir, right, scale, type V2 } from "../core/math";
import type { ChangeSet, RoadNetwork } from "../roads/network";

export const CELL = 8;
export const DEPTH = 6;
/** The shallowest lot any zone grows (cells): shallower strips aren't zoneable. */
export const MIN_LOT_DEPTH = 2;

export type ZoneId = "resLow" | "resRow" | "resMed" | "resHigh" | "resTower" | "comLow" | "comMid" | "comHigh" | "comTower";
export type ZoneGroup = "res" | "com";

export interface ZoneDef {
  id: ZoneId;
  name: string;
  short: string;
  group: ZoneGroup;
  high: boolean;
  color: number; // cell tint
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  resLow: { id: "resLow", name: "Residential low density", short: "Low homes", group: "res", high: false, color: 0x6cc56a },
  resRow: { id: "resRow", name: "Residential row housing", short: "Row homes", group: "res", high: false, color: 0x4fae5c },
  resMed: { id: "resMed", name: "Residential medium density", short: "Mid homes", group: "res", high: true, color: 0x2f9a4e },
  resHigh: { id: "resHigh", name: "Residential high density", short: "High homes", group: "res", high: true, color: 0x1d7a3c },
  resTower: { id: "resTower", name: "Residential towers", short: "Towers", group: "res", high: true, color: 0x14602f },
  comLow: { id: "comLow", name: "Commercial low density", short: "Low shops", group: "com", high: false, color: 0x4f9be8 },
  comMid: { id: "comMid", name: "Commercial medium density", short: "Mid shops", group: "com", high: false, color: 0x3d85dc },
  comHigh: { id: "comHigh", name: "Commercial high density", short: "High shops", group: "com", high: true, color: 0x2a6fcf },
  comTower: { id: "comTower", name: "Commercial towers", short: "Towers", group: "com", high: true, color: 0x1d55a8 },
};
export const ZONE_ORDER: ZoneId[] = ["resLow", "resRow", "resMed", "resHigh", "resTower", "comLow", "comMid", "comHigh", "comTower"];
/** How dense a zone is within its group (a town only ever rezones its land denser). */
export const ZONE_RANK: Record<ZoneId, number> = { resLow: 0, resRow: 1, resMed: 2, resHigh: 3, resTower: 4, comLow: 0, comMid: 1, comHigh: 2, comTower: 3 };

export interface Cell {
  c: V2; // centre
  rot: number; // angle of the road tangent (cell's x axis runs along the road)
  ok: boolean;
  zone: ZoneId | null;
  lot: number; // building id standing on it, 0 = empty
  block: Block;
  col: number;
  row: number; // 0 = next to the road
}

export interface Block {
  key: string; // `${seg}:${side}`
  seg: number;
  side: 1 | -1;
  age: number;
  cols: number;
  /** Arc length (on the seg's centreline) of the middle of each column. */
  colS: number[];
  cells: Cell[]; // col * DEPTH + row
}

/** What the zone map needs from the world. */
export interface ZoneWorld {
  isWater(p: V2): boolean;
  isMountain(p: V2): boolean;
  owned(p: V2): boolean;
  /** land a cell may never be zoned on (inside an industry site's fence) */
  taken?(p: V2): boolean;
}

const BUCKET = 16;
const bkey = (x: number, y: number) => ((Math.floor(x / BUCKET) + 32768) * 65536) + (Math.floor(y / BUCKET) + 32768);

export class ZoneMap {
  blocks = new Map<string, Block>();
  private grid = new Map<number, Cell[]>();
  /** Bumped on every change, for renderers. */
  version = 0;
  /** Seg id -> age (creation order); a split piece keeps its parent's age. */
  private ages = new Map<number, number>();
  private nextAge = 1;

  constructor(private net: RoadNetwork, private world: ZoneWorld) {}

  cell(b: Block, col: number, row: number): Cell | undefined {
    return b.cells[col * DEPTH + row];
  }

  // ------------------------------------------------------------------ queries

  /** The cell under p (null if none). */
  cellAt(p: V2): Cell | null {
    let best: Cell | null = null, bd = Infinity;
    for (const c of this.near(p, CELL)) {
      const u = fromAngle(c.rot);
      const dx = p.x - c.c.x, dy = p.y - c.c.y;
      const a = Math.abs(dx * u.x + dy * u.y), b = Math.abs(-dx * u.y + dy * u.x);
      if (a > CELL / 2 || b > CELL / 2) continue;
      const d = a + b;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Cells whose centre is within r of p. */
  near(p: V2, r: number): Cell[] {
    const out: Cell[] = [];
    const x0 = Math.floor((p.x - r) / BUCKET), x1 = Math.floor((p.x + r) / BUCKET);
    const y0 = Math.floor((p.y - r) / BUCKET), y1 = Math.floor((p.y + r) / BUCKET);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const L = this.grid.get((i + 32768) * 65536 + (j + 32768));
      if (!L) continue;
      for (const c of L) if (Math.abs(c.c.x - p.x) <= r && Math.abs(c.c.y - p.y) <= r && dist(c.c, p) <= r) out.push(c);
    }
    return out;
  }

  /** Cells whose centre lies in the polygon (convex, any winding). */
  inPoly(poly: V2[]): Cell[] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const out: Cell[] = [];
    for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) for (let j = Math.floor(y0 / BUCKET); j <= Math.floor(y1 / BUCKET); j++) {
      const L = this.grid.get((i + 32768) * 65536 + (j + 32768));
      if (L) for (const c of L) if (convexContains(poly, c.c)) out.push(c);
    }
    return out;
  }

  *allCells(): Iterable<Cell> {
    for (const b of this.blocks.values()) for (const c of b.cells) yield c;
  }

  /** Cells reached from `start` through neighbours with the same zone (paint-bucket fill), up to `max`. */
  flood(start: Cell, max = 4000): Cell[] {
    const want = start.zone;
    const seen = new Set<Cell>([start]);
    const out: Cell[] = [];
    const q = [start];
    while (q.length && out.length < max) {
      const c = q.pop()!;
      out.push(c);
      for (const n of this.near(c.c, CELL * 1.2)) {
        if (seen.has(n) || !n.ok || n.zone !== want) continue;
        seen.add(n);
        q.push(n);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ painting

  /** Set the zone of the given cells (only valid ones). Returns the cells that changed and what they were. */
  paint(cells: Iterable<Cell>, zone: ZoneId | null): { cell: Cell; from: ZoneId | null }[] {
    const ch: { cell: Cell; from: ZoneId | null }[] = [];
    for (const c of cells) {
      if (!c.ok || c.zone === zone) continue;
      ch.push({ cell: c, from: c.zone });
      c.zone = zone;
    }
    if (ch.length) this.version++;
    return ch;
  }

  /** Set zones by position (undo/redo after cells were rebuilt). */
  paintAt(items: { p: V2; zone: ZoneId | null }[]) {
    for (const it of items) {
      const c = this.cellAt(it.p);
      if (c && c.ok) c.zone = it.zone;
    }
    this.version++;
  }

  // ------------------------------------------------------------------ building the blocks

  /** Build every block from scratch (new game, load). */
  rebuildAll() {
    const old = [...this.allCells()];
    this.blocks.clear();
    this.grid.clear();
    // segs without an age yet get one in id order (creation order), before sorting
    const ids = [...this.net.segs.keys()].sort((a, b) => a - b);
    for (const id of ids) this.ageOf(id);
    ids.sort((a, b) => this.ageOf(a) - this.ageOf(b));
    for (const id of ids) this.addBlocks(id);
    this.inherit(old, [...this.allCells()]);
    this.version++;
  }

  /** Rebuild the blocks a road edit can affect. */
  onNetworkChange(cs: ChangeSet) {
    for (const sp of cs.splits) {
      const a = this.ageOf(sp.old);
      for (const pt of sp.parts) if (!this.ages.has(pt.seg)) this.ages.set(pt.seg, a);
    }
    // region the edit touched: every dirty or removed seg, padded by two block depths
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (bb: { x0: number; y0: number; x1: number; y1: number }) => {
      x0 = Math.min(x0, bb.x0); y0 = Math.min(y0, bb.y0); x1 = Math.max(x1, bb.x1); y1 = Math.max(y1, bb.y1);
    };
    for (const id of cs.dirtySegs) { const g = this.net.segGeom.get(id); if (g) grow(g.bbox); }
    for (const id of cs.removedSegs) for (const side of [1, -1]) {
      const b = this.blocks.get(`${id}:${side}`);
      if (b) for (const c of b.cells) grow({ x0: c.c.x, y0: c.c.y, x1: c.c.x, y1: c.c.y });
    }
    for (const n of cs.dirtyNodes) { const nd = this.net.nodes.get(n); if (nd) grow({ x0: nd.p.x, y0: nd.p.y, x1: nd.p.x, y1: nd.p.y }); }
    if (x0 === Infinity) return;
    const pad = 2 * (DEPTH * CELL + 30);
    const affected = new Set<number>(this.net.segsNear(x0 - pad, y0 - pad, x1 + pad, y1 + pad));
    for (const id of cs.dirtySegs) if (this.net.segs.has(id)) affected.add(id);
    // drop the old blocks of affected and removed segs
    const old: Cell[] = [];
    const drop = (id: number) => {
      for (const side of [1, -1]) {
        const key = `${id}:${side}`;
        const b = this.blocks.get(key);
        if (!b) continue;
        for (const c of b.cells) { old.push(c); this.unindex(c); }
        this.blocks.delete(key);
      }
    };
    for (const id of affected) drop(id);
    for (const id of cs.removedSegs) drop(id);
    // a dropped block may have been holding cells of a younger block outside the region: re-open them
    // (each such block once: it is revalidated as a whole)
    const reopen = new Set<Block>();
    for (const c of old) for (const n of this.near(c.c, CELL)) if (!n.ok && n.block.age > c.block.age) reopen.add(n.block);
    for (const b of reopen) if (this.blocks.get(b.key) === b) this.revalidate(b);
    const ids = [...affected].filter((id) => this.net.segs.has(id)).sort((a, b) => a - b);
    for (const id of ids) this.ageOf(id); // new segs get ages in creation order
    ids.sort((a, b) => this.ageOf(a) - this.ageOf(b));
    const fresh: Cell[] = [];
    for (const id of ids) for (const b of this.addBlocks(id)) fresh.push(...b.cells);
    this.inherit(old, fresh);
    for (const id of cs.removedSegs) if (!this.net.segs.has(id)) this.ages.delete(id);
    this.version++;
  }

  /** Seg ages, for saves: they decide which block owns overlapping cells. */
  agesJSON(): [number, number][] {
    return [...this.ages].filter(([id]) => this.net.segs.has(id));
  }

  loadAges(a: [number, number][]) {
    this.ages = new Map(a);
    this.nextAge = a.reduce((m, [, x]) => Math.max(m, x), 0) + 1;
  }

  private ageOf(seg: number): number {
    let a = this.ages.get(seg);
    if (a === undefined) { a = this.nextAge++; this.ages.set(seg, a); }
    return a;
  }

  private index(c: Cell) {
    const k = bkey(c.c.x, c.c.y);
    let L = this.grid.get(k);
    if (!L) this.grid.set(k, (L = []));
    L.push(c);
  }

  private unindex(c: Cell) {
    const L = this.grid.get(bkey(c.c.x, c.c.y));
    if (!L) return;
    const i = L.indexOf(c);
    if (i >= 0) L.splice(i, 1);
  }

  /** Make the blocks of one seg (both sides) and index their cells. */
  private addBlocks(id: number): Block[] {
    const s = this.net.segs.get(id);
    const g = this.net.segGeom.get(id);
    if (!s || !g || !ROAD_TYPES[s.type].allowsAccess) return [];
    // ground-level roads only
    for (const h of g.hs) if (h > 0.5) return [];
    const pl = g.center;
    const s0 = g.trimA + 0.5, s1 = pl.length - g.trimB - 0.5;
    const cols = Math.floor((s1 - s0) / CELL);
    if (cols < 1) return [];
    const off = s0 + (s1 - s0 - cols * CELL) / 2;
    const out: Block[] = [];
    const age = this.ageOf(id);
    for (const side of [1, -1] as const) {
      const b: Block = { key: `${id}:${side}`, seg: id, side, age, cols, colS: [], cells: [] };
      for (let k = 0; k < cols; k++) {
        const sm = off + (k + 0.5) * CELL;
        b.colS.push(sm);
        const p = polyAt(pl, sm);
        const t = polyDir(pl, sm);
        const n = scale(right(t), side);
        const rot = Math.atan2(t.y, t.x);
        for (let r = 0; r < DEPTH; r++) {
          const c = add(p, scale(n, g.width / 2 + (r + 0.5) * CELL));
          b.cells.push({ c, rot, ok: true, zone: null, lot: 0, block: b, col: k, row: r });
        }
      }
      this.blocks.set(b.key, b);
      for (const c of b.cells) this.index(c);
      this.revalidate(b);
      out.push(b);
    }
    return out;
  }

  /** Work out which cells of a block are usable: terrain, ownership, roads, older blocks, and depth from the road. */
  private revalidate(b: Block) {
    for (let k = 0; k < b.cols; k++) {
      let blocked = false;
      for (let r = 0; r < DEPTH; r++) {
        const c = b.cells[k * DEPTH + r];
        if (!blocked && !this.cellFree(c)) blocked = true;
        c.ok = !blocked;
      }
    }
    // cells of the same block overlapping each other on the inside of a bend
    for (let k = 1; k < b.cols; k++) for (let r = 0; r < DEPTH; r++) {
      const c = b.cells[k * DEPTH + r];
      if (!c.ok) continue;
      const prev = b.cells[(k - 1) * DEPTH + r];
      if (prev.ok && dist(prev.c, c.c) < CELL * 0.7) for (let rr = r; rr < DEPTH; rr++) b.cells[k * DEPTH + rr].ok = false;
    }
    // older blocks win overlapping cells; this block wins over younger ones
    const touched = new Set<Block>([b]);
    for (const c of b.cells) {
      if (!c.ok) continue;
      for (const o of this.near(c.c, CELL * 0.92)) {
        if (o.block === b || !o.ok) continue;
        if (o.block.age < b.age || (o.block.age === b.age && o.block.side < b.side)) { this.cut(c); break; }
        this.cut(o);
        touched.add(o.block);
      }
    }
    for (const t of touched) this.trimUnusable(t);
  }

  /**
   * Columns no lot could ever stand on aren't zoneable: too shallow, or with no neighbour beside them, deep and in
   * line enough, to make the narrowest lot (two cells) with. They'd only ever sit there zoned and empty.
   */
  private trimUnusable(b: Block) {
    const deep = (k: number) => k >= 0 && k < b.cols && b.cells[k * DEPTH + MIN_LOT_DEPTH - 1].ok;
    const pair = (k: number) => deep(k) && deep(k + 1) && Math.abs(Math.cos(b.cells[k * DEPTH].rot - b.cells[(k + 1) * DEPTH].rot)) >= 0.97;
    const dead: number[] = [];
    for (let k = 0; k < b.cols; k++) if (!pair(k - 1) && !pair(k)) dead.push(k);
    for (const k of dead) for (let r = 0; r < DEPTH; r++) b.cells[k * DEPTH + r].ok = false;
  }

  /** Disable a cell and everything behind it in its column (all of it, if what's left is too shallow for any lot). */
  private cut(c: Cell) {
    const b = c.block;
    for (let r = c.row; r < DEPTH; r++) b.cells[c.col * DEPTH + r].ok = false;
  }

  private cellFree(c: Cell): boolean {
    const w = this.world;
    const u = fromAngle(c.rot), v = right(u);
    const h = CELL / 2 - 0.6;
    const probes = [c.c, add(c.c, add(scale(u, h), scale(v, h))), add(c.c, add(scale(u, -h), scale(v, h))), add(c.c, add(scale(u, h), scale(v, -h))), add(c.c, add(scale(u, -h), scale(v, -h)))];
    for (const p of probes) if (w.isWater(p) || w.isMountain(p) || !w.owned(p) || w.taken?.(p)) return false;
    // clear of every road surface at ground level (its own road included, for the inside of tight bends)
    const r = CELL;
    for (const id of this.net.segsNear(c.c.x - r - 20, c.c.y - r - 20, c.c.x + r + 20, c.c.y + r + 20)) {
      const g = this.net.segGeom.get(id)!;
      const lim = g.width / 2 + CELL / 2 - 0.4;
      const pts = g.center.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        if (g.hs[i] > 6 && g.hs[i + 1] > 6) continue;
        if (pointSegDist2(c.c, pts[i], pts[i + 1]).d2 < lim * lim) return false;
      }
      // where turn pockets widen it, its lanes reach further out
      if (g.ends.a.pocket || g.ends.b.pocket) {
        const ll = LANE_W / 2 + CELL / 2 + 0.3;
        for (const l of g.lanes) {
          const q = l.pl.pts;
          for (let i = 0; i < q.length - 1; i++) if (pointSegDist2(c.c, q[i], q[i + 1]).d2 < ll * ll) return false;
        }
      }
    }
    // junction areas
    for (const n of this.net.nodesNear(c.c, 40)) {
      const ng = this.net.nodeGeom.get(n.id);
      if (!ng || ng.kind === "end") continue;
      if (dist(n.p, c.c) < ng.radius + CELL / 2) return false;
    }
    return true;
  }

  /** New cells take the zone and lot of the old cell they sit on. */
  private inherit(old: Cell[], fresh: Cell[]) {
    if (!old.length) return;
    const idx = new Map<number, Cell[]>();
    for (const c of old) {
      if (!c.zone && !c.lot) continue;
      const k = bkey(c.c.x, c.c.y);
      let L = idx.get(k);
      if (!L) idx.set(k, (L = []));
      L.push(c);
    }
    if (!idx.size) return;
    for (const c of fresh) {
      let best: Cell | null = null, bd = CELL * 0.45;
      const i0 = Math.floor(c.c.x / BUCKET), j0 = Math.floor(c.c.y / BUCKET);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (const o of idx.get((i + 32768) * 65536 + (j + 32768)) ?? []) {
          const d = dist(o.c, c.c);
          if (d < bd && Math.abs(Math.cos(o.rot - c.rot)) > 0.9) { bd = d; best = o; }
        }
      }
      if (best) { c.zone = c.ok ? best.zone : null; c.lot = best.lot; }
    }
  }
}

function convexContains(poly: V2[], p: V2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cr === 0) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
