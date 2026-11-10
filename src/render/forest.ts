// The map's wild trees and shrubs: where each one stands. One rule set, worked out here on the CPU from hashed cells
// and the terrain's fields, and used twice: the 3D trees are instanced from it (render/trees3d.ts), and the ground
// shader paints its far crowns from a small texture baked from the very same list (render/terrain3d.ts), so a tree
// standing near is the crown painted far, in the same place, the same size and the same colour, and the handover
// between them by zoom is invisible. Nothing here touches three.js: it is tested on its own (tests/forest.test.ts).
//
// The rules. Two grids of cells cover the map: a forest grid of 7.5 m cells and a scrub grid of 15 m ones (one scrub
// cell is two by two forest cells). A cell holds at most one tree, at a hashed spot near its middle:
//   - a forest cell's tree stands when the forest field at its spot is over a half and the cell's hash is under the
//     canopy's density (so a forest closes up into canopy, with a gap here and there);
//   - a scrub cell's stands when its spot is outside the forest and the cell's hash is under the scrub's density
//     there, which a slow noise bunches into loose clumps;
//   - never on water or a hill's tiers (its crown clear of both), and never where its crown would reach built
//     ground: a road, its pavement and verge, a junction, a site, a plot (render/clearing.ts).
// Everything else about a tree (its crown's radius, its tone, which kind it is, the way it faces) is hashed from its
// cell too, with an integer hash that gives the same bits in GLSL (TREE_HASH_GLSL below).

import { F, MOUNTAIN_STEPS } from "../world/gen";
import { RES, type Terrain } from "../world/terrain";
import { CLEAR_RANGE, clearDist, type ClearShape } from "./clearing";
import { KEEP } from "./furniture";

/** A forest cell's side (m); a scrub cell is twice it. */
export const TREE_CELL = 7.5;
/** Forest cells along a tile's side (a tile: the unit trees are worked out, cached and drawn by). */
export const TILE_CELLS = 16;
/** A tile's side in metres. */
export const TILE_M = TREE_CELL * TILE_CELLS;
/** The share of forest cells that hold a tree. */
export const CANOPY = 0.85;
/** How far a tree's spot strays from its cell's middle, as a share of the cell either way (so two never touch). */
const JITTER = 0.55;
/** The share of evergreens among the trees: most in the forests (the ground shader and the 3D trees both read it). */
export const EVERGREEN = { scrub: 0.28, forest: 0.55, street: 0.2 };

/** Hash slots: what each of a cell's hashes decides (a scrub cell's are these + SCRUB). */
export const H = { r: 0, jx: 1, jy: 2, dens: 3, tone: 4, kind: 5, wob: 6, rot: 7 } as const;
export const SCRUB = 16;

/** An integer hash of a cell and a slot: 32 well-mixed bits, the same in JavaScript and GLSL. */
export function thash(i: number, j: number, k: number): number {
  let x = (Math.imul(i, 0x9e3779b1) + Math.imul(j, 0x85ebca77) + Math.imul(k, 0xc2b2ae3d)) | 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return x >>> 0;
}
/** The same as a number 0 .. 1 (24 bits: exact in a float on the GPU too). */
export const thashf = (i: number, j: number, k: number): number => (thash(i, j, k) >>> 8) / 16777216;

/** The hash and the clump noise in GLSL (ES 3.0: integer maths), bit for bit what thash gives. */
export const TREE_HASH_GLSL = /* glsl */ `
uint thash(ivec2 c, uint k) {
  uint x = uint(c.x) * 0x9E3779B1u + uint(c.y) * 0x85EBCA77u + k * 0xC2B2AE3Du;
  x ^= x >> 15; x *= 0x2C1B3C6Du; x ^= x >> 12; x *= 0x297A2D39u; x ^= x >> 15;
  return x;
}
float thashf(ivec2 c, uint k) { return float(thash(c, k) >> 8) * (1.0 / 16777216.0); }
float tnoise(vec2 p, uint k) {
  vec2 i = floor(p), f = p - i;
  ivec2 c = ivec2(i);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(thashf(c, k), thashf(c + ivec2(1, 0), k), u.x), mix(thashf(c + ivec2(0, 1), k), thashf(c + ivec2(1, 1), k), u.x), u.y);
}
/* how thick the scrub grows at a point outside the forests (the share of scrub cells with a tree) */
float scrubDensity(vec2 p) {
  float n = tnoise(p / 90.0 + 4.4, 90u) * 0.7 + tnoise(p / 48.0 - 12.1, 91u) * 0.3;
  return 0.1 + 0.42 * smoothstep(0.42, 0.75, n);
}
`;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function tnoise(x: number, y: number, k: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = thashf(i, j, k), b = thashf(i + 1, j, k), c = thashf(i, j + 1, k), d = thashf(i + 1, j + 1, k);
  return a + (b - a) * ux + (c + (d - c) * ux - a - (b - a) * ux) * uy;
}
/** How thick the scrub grows at a point outside the forests: the share of scrub cells that hold a tree. */
export function scrubDensity(x: number, y: number): number {
  const n = tnoise(x / 90 + 4.4, y / 90 + 4.4, 90) * 0.7 + tnoise(x / 48 - 12.1, y / 48 - 12.1, 91) * 0.3;
  return 0.1 + 0.42 * smooth(0.42, 0.75, n);
}

/** How much wider a forest tree's crown is than a lone one's (m): in a forest they close up into canopy. */
export const FOREST_R = 1.9;
/** A crown's radius (m) from its cell's hash: scrub and lone trees 1.1 .. 2.4, forest trees FOREST_R more. */
export const crownRadius = (h: number, forest: boolean): number => 1.1 + 1.3 * h + (forest ? FOREST_R : 0);

/** A tile's trees, as columns. */
export interface TreeTile {
  ti: number; tj: number;
  n: number;
  x: Float32Array; y: Float32Array;
  /** crown radius, m */
  r: Float32Array;
  /** 0 a forest cell's tree, 1 a scrub cell's */
  grid: Uint8Array;
  /** its cell (in its own grid) */
  ci: Int32Array; cj: Int32Array;
  /** 1 standing, 0 cleared by something built */
  alive: Uint8Array;
  /** a new number each time `alive` changes, and whenever the tile is worked out afresh (never one used before) */
  version: number;
  /** `alive` needs working out again */
  stale: boolean;
  /** the roadside furniture `alive` was worked out against (KEEP.version) */
  keep: number;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

const BUCKET = 64; // metres: the grid the built shapes are found by
const MAX_TILES = 5000;
const tkey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

export class Forest {
  private tiles = new Map<number, TreeTile>();
  private shapes: ClearShape[] = [];
  private buckets = new Map<number, number[]>();
  private keys = new Map<number, Rect>();
  private at = { x: 0, y: 0 };
  /** the last version handed out: one count for every tile, so a tile dropped and grown again is never an old number */
  private versions = 0;

  /** `maxTiles`: how many tiles are kept worked out (the oldest goes first). */
  constructor(private terrain: Terrain, private maxTiles = MAX_TILES) {}

  /**
   * What is built now (clearing.ts clearShapes). Returns the ground whose trees may have changed: rectangles round
   * every shape that came or went, or null when so much changed that everything should be looked at again.
   */
  setShapes(shapes: ClearShape[]): Rect[] | null {
    const keys = new Map<number, Rect>();
    const dirty: Rect[] = [];
    const m = CLEAR_RANGE + 0.5;
    this.buckets.clear();
    shapes.forEach((sh, idx) => {
      const line = "line" in sh, pts = line ? sh.line : sh.poly;
      // the shape's key: what it is, how hard it clears and every point to 2 cm, as two 32-bit hashes in one number
      // (53 bits of them. This runs over the whole map, tens of thousands of points, each time anything is built:
      // spelling the key out as text cost more than the rest of the frame)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      let ka = line ? 0x9e3779b1 | 0 : 0x85ebca77 | 0, kb = Math.round(sh.hard * 100) | 0;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
        const qx = Math.round(p.x * 50) | 0, qy = Math.round(p.y * 50) | 0;
        ka = Math.imul(ka ^ qx, 0x2c1b3c6d); ka ^= ka >>> 15; ka = Math.imul(ka ^ qy, 0x297a2d39); ka ^= ka >>> 13;
        kb = Math.imul(kb + qx, 0x85ebca6b) ^ (kb >>> 16); kb = Math.imul(kb + qy, 0xc2b2ae35) ^ (kb >>> 13);
      }
      const k = (ka >>> 0) * 2097152 + (kb >>> 11);
      const box = { x0: x0 - sh.hard - m, y0: y0 - sh.hard - m, x1: x1 + sh.hard + m, y1: y1 + sh.hard + m };
      keys.set(k, box);
      if (!this.keys.has(k)) dirty.push(box);
      // (a long road is filed piece by piece, so it is not looked at by every tree in its bounding box; most pieces
      // lie in the buckets the one before did, and are not filed twice)
      const e = sh.hard + m;
      let pi0 = NaN, pi1 = NaN, pj0 = NaN, pj1 = NaN;
      const file = (ax: number, ay: number, bx: number, by: number) => {
        const i0 = Math.floor((Math.min(ax, bx) - e) / BUCKET), i1 = Math.floor((Math.max(ax, bx) + e) / BUCKET);
        const j0 = Math.floor((Math.min(ay, by) - e) / BUCKET), j1 = Math.floor((Math.max(ay, by) + e) / BUCKET);
        if (i0 === pi0 && i1 === pi1 && j0 === pj0 && j1 === pj1) return;
        pi0 = i0; pi1 = i1; pj0 = j0; pj1 = j1;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const bk = tkey(i, j);
            const list = this.buckets.get(bk);
            if (!list) this.buckets.set(bk, [idx]);
            else if (list[list.length - 1] !== idx) list.push(idx);
          }
        }
      };
      if (line && pts.length > 1) for (let i = 0; i < pts.length - 1; i++) file(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      else file(x0, y0, x1, y1);
    });
    for (const [k, box] of this.keys) if (!keys.has(k)) dirty.push(box);
    this.keys = keys;
    this.shapes = shapes;
    if (!dirty.length) return dirty;
    const all = dirty.length > 400;
    for (const t of this.tiles.values()) {
      if (all) { t.stale = true; continue; }
      const x0 = t.ti * TILE_M, y0 = t.tj * TILE_M;
      for (const d of dirty) if (d.x1 > x0 && d.x0 < x0 + TILE_M && d.y1 > y0 && d.y0 < y0 + TILE_M) { t.stale = true; break; }
    }
    return all ? null : dirty;
  }

  /** Would a crown of radius r at (x, y) reach built ground? Exactly clearing.ts crownCleared, found through a grid. */
  cleared(x: number, y: number, r: number): boolean {
    // (nor a billboard: render/furniture.ts places them, after the roads and the lots)
    if (KEEP.hit(x, y, r + 0.4)) return true;
    const list = this.buckets.get(tkey(Math.floor(x / BUCKET), Math.floor(y / BUCKET)));
    if (!list) return false;
    const p = this.at;
    p.x = x; p.y = y;
    for (const idx of list) if (clearDist(this.shapes[idx], p) < r) return true;
    return false;
  }

  /** The trees of tile (ti, tj): the ground from ti * TILE_M to (ti + 1) * TILE_M, and the same down. */
  tile(ti: number, tj: number): TreeTile {
    const k = tkey(ti, tj);
    let t = this.tiles.get(k);
    if (!t) {
      t = this.grow(ti, tj);
      if (this.tiles.size >= this.maxTiles) this.tiles.delete(this.tiles.keys().next().value!);
      this.tiles.set(k, t);
    }
    if (t.stale || t.keep !== KEEP.version) {
      let changed = false;
      for (let i = 0; i < t.n; i++) {
        const a = this.cleared(t.x[i], t.y[i], t.r[i]) ? 0 : 1;
        if (a !== t.alive[i]) { t.alive[i] = a; changed = true; }
      }
      if (changed) t.version = ++this.versions;
      t.stale = false;
      t.keep = KEEP.version;
    }
    return t;
  }

  /** Whether tile (ti, tj) is worked out and current (asking for it would cost nothing). */
  ready(ti: number, tj: number): boolean {
    const t = this.tiles.get(tkey(ti, tj));
    return !!t && !t.stale && t.keep === KEEP.version;
  }

  /** A tile's trees as nature has them (before anything is built): the hashed cells against the terrain's fields. */
  private grow(ti: number, tj: number): TreeTile {
    const T = this.terrain;
    const X0 = ti * TILE_M, Y0 = tj * TILE_M;
    // what the field nodes round the tile rule out: a B-spline sample never leaves the range of its nodes
    let fLo = 255, fHi = 0, mHi = 0;
    for (let j = Math.floor(Y0 / RES) - 1; j <= Math.floor((Y0 + TILE_M) / RES) + 2; j++) {
      for (let i = Math.floor(X0 / RES) - 1; i <= Math.floor((X0 + TILE_M) / RES) + 2; i++) {
        const f = T.node(F.forest, i, j);
        if (f < fLo) fLo = f;
        if (f > fHi) fHi = f;
        const m = T.node(F.mtn, i, j);
        if (m > mHi) mHi = m;
      }
    }
    const noForest = fHi < 127.5, allForest = fLo >= 127.5, flat = mHi / 255 < MOUNTAIN_STEPS[0] - 1e-6;
    const xs: number[] = [], ys: number[] = [], rs: number[] = [], gs: number[] = [], cis: number[] = [], cjs: number[] = [];
    const p = { x: 0, y: 0 };
    /** dry, level ground under the whole crown (its middle and four points round it) */
    const stands = (x: number, y: number, r: number): boolean => {
      for (let k = 0; k < 5; k++) {
        p.x = x + (k === 1 ? r : k === 2 ? -r : 0) * 0.8;
        p.y = y + (k === 3 ? r : k === 4 ? -r : 0) * 0.8;
        if (T.isWater(p)) return false;
        if (!flat && T.sample(F.mtn, p.x, p.y) >= MOUNTAIN_STEPS[0]) return false;
      }
      return true;
    };
    for (let grid = 0; grid < 2; grid++) {
      if (grid === 0 ? noForest : allForest) continue;
      const cell = TREE_CELL * (grid + 1), n = TILE_CELLS >> grid, ko = grid * SCRUB;
      const i0 = ti * n, j0 = tj * n;
      for (let cj = j0; cj < j0 + n; cj++) {
        for (let ci = i0; ci < i0 + n; ci++) {
          const hd = thashf(ci, cj, H.dens + ko);
          // (the scrub is never thicker than 0.52: most cells are turned down on their hash alone)
          if (hd > (grid === 0 ? CANOPY : 0.52)) continue;
          const x = (ci + 0.5 + (thashf(ci, cj, H.jx + ko) - 0.5) * JITTER) * cell;
          const y = (cj + 0.5 + (thashf(ci, cj, H.jy + ko) - 0.5) * JITTER) * cell;
          const inForest = allForest || (!noForest && T.sample(F.forest, x, y) >= 0.5);
          if (inForest !== (grid === 0)) continue;
          if (grid === 1 && hd > scrubDensity(x, y)) continue;
          const r = crownRadius(thashf(ci, cj, H.r + ko), grid === 0);
          if (!stands(x, y, r)) continue;
          xs.push(x); ys.push(y); rs.push(r); gs.push(grid); cis.push(ci); cjs.push(cj);
        }
      }
    }
    const n = xs.length;
    return {
      ti, tj, n,
      x: Float32Array.from(xs), y: Float32Array.from(ys), r: Float32Array.from(rs), grid: Uint8Array.from(gs),
      ci: Int32Array.from(cis), cj: Int32Array.from(cjs), alive: new Uint8Array(n).fill(1), version: ++this.versions, stale: true, keep: -1,
    };
  }

  /**
   * The trees of a square of forest cells as the ground shader reads them: n * n texels from cell (c0i, c0j) (which
   * must be even: a scrub cell's corner), 4 bytes each: byte 0 a forest cell's tree stands, byte 1 the scrub cell's
   * this forest cell lies in does.
   */
  bake(c0i: number, c0j: number, n: number): Uint8Array {
    const out = new Uint8Array(n * n * 4);
    const t0i = Math.floor(c0i / TILE_CELLS), t0j = Math.floor(c0j / TILE_CELLS);
    const t1i = Math.floor((c0i + n - 1) / TILE_CELLS), t1j = Math.floor((c0j + n - 1) / TILE_CELLS);
    for (let tj = t0j; tj <= t1j; tj++) {
      for (let ti = t0i; ti <= t1i; ti++) {
        const t = this.tile(ti, tj);
        for (let k = 0; k < t.n; k++) {
          if (!t.alive[k]) continue;
          if (t.grid[k] === 0) {
            const a = t.ci[k] - c0i, b = t.cj[k] - c0j;
            if (a >= 0 && b >= 0 && a < n && b < n) out[(b * n + a) * 4] = 255;
          } else {
            const a = t.ci[k] * 2 - c0i, b = t.cj[k] * 2 - c0j;
            for (let v = b; v < b + 2; v++) for (let u = a; u < a + 2; u++) if (u >= 0 && v >= 0 && u < n && v < n) out[(v * n + u) * 4 + 1] = 255;
          }
        }
      }
    }
    return out;
  }
}

/** Which model a tree is, from its hashes: the ground's painted crown and the 3D tree agree on evergreen or not. */
export type TreeModel = "tree_round" | "tree_tall" | "tree_spread" | "tree_pine" | "tree_spruce" | "shrub_round" | "shrub_clump";
export const TREE_MODELS: TreeModel[] = ["tree_round", "tree_tall", "tree_spread", "tree_pine", "tree_spruce", "shrub_round", "shrub_clump"];
/**
 * kind: the tree's kind hash (H.kind); r: its crown radius; evergreen: the share of evergreens where it stands.
 * Under the share it is a conifer; the rest are broadleaves, the small ones out in the scrub shrubs.
 */
export function treeModel(kind: number, r: number, evergreen: number, shrubs: boolean): number {
  // (another few bits of the same hash pick among the shapes)
  const v = (kind * 977) % 1;
  if (kind < evergreen) return v < 0.55 ? 3 : 4;
  if (shrubs && r < 1.75) return v < 0.5 ? 5 : 6;
  return v < 0.4 ? 0 : v < 0.7 ? 1 : 2;
}
