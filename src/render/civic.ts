// A town hall's square, laid out in its lot's own space: x along the main street, z towards it (+z is the front, the
// way the hall faces). It grows more civic with the hall: a hamlet's green with a ring of old trees, a village's paved
// market forecourt between rows of trees, a town's square paved to the kerbs with lawn beds and an avenue along the
// street, a city's plaza with tree rows down its sides and a grove behind the hall.

import type { BuildingKind } from "../config";

export interface SquareRect {
  x: number; z: number; // centre
  w: number; d: number; // size along x and z
  rot: number; // turned by this much (radians, about the vertical; only the path to the door turns)
  kind: "lawn" | "pave" | "path";
}
export interface SquareTree { x: number; z: number; r: number }
export interface SquarePlan {
  base: "lawn" | "pave"; // the whole lot
  rects: SquareRect[]; // laid over it, in order
  trees: SquareTree[];
}

export const HALL_TIER: Partial<Record<BuildingKind, number>> = { hamlethall: 0, villagehall: 1, townhall: 2, cityhall: 3 };

/** The hall's footprint in lot space (its model's bounds). */
export interface Footprint { x0: number; x1: number; z0: number; z1: number }

/** A small deterministic jitter in [-1, 1) for spot k of hall `seed`. */
function jit(seed: number, k: number): number {
  const h = Math.imul(seed * 374761393 + k * 668265263, 1274126177) >>> 0;
  return ((h ^ (h >>> 15)) % 2000) / 1000 - 1;
}

/** Distance from p to the segment a-b. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/**
 * The square for a hall of this tier in a lot `half` across from its centre, the hall standing on `fp`, its door at
 * `door` and the kerb in front at `kerb` (both lot space; the path runs between them). `seed` varies the trees.
 */
export function squarePlan(tier: number, half: number, fp: Footprint, door: { x: number; z: number }, kerb: { x: number; z: number }, seed: number): SquarePlan {
  const H = half - 0.4; // the lot's ground stops just short of the pavement
  const rects: SquareRect[] = [];
  const trees: SquareTree[] = [];
  const rect = (x0: number, x1: number, z0: number, z1: number, kind: SquareRect["kind"]) => {
    const a = Math.max(-H, Math.min(x0, x1)), b = Math.min(H, Math.max(x0, x1));
    const c = Math.max(-H, Math.min(z0, z1)), d = Math.min(H, Math.max(z0, z1));
    if (b - a > 0.5 && d - c > 0.5) rects.push({ x: (a + b) / 2, z: (c + d) / 2, w: b - a, d: d - c, rot: 0, kind });
  };
  // the path from the door to the kerb (stopping at the lot's edge)
  const pathW = [3.2, 4, 5, 6][tier] ?? 6;
  const kz = Math.min(kerb.z, H), kx = door.x + (kerb.x - door.x) * ((kz - door.z) / (kerb.z - door.z || 1));
  const pathLen = Math.hypot(kx - door.x, kz - door.z);
  const pathRect: SquareRect | null = pathLen > 0.5
    ? { x: (door.x + kx) / 2, z: (door.z + kz) / 2, w: pathW, d: pathLen, rot: Math.atan2(kx - door.x, kz - door.z), kind: "path" }
    : null;

  /** A tree at (x, z) if its crown keeps inside the lot, off the hall and the path, and clear of the trees so far. */
  const tree = (x: number, z: number, r: number) => {
    if (Math.abs(x) > H - r * 0.8 || Math.abs(z) > H - r * 0.8) return;
    const m = r * 0.75 + 1;
    if (x > fp.x0 - m && x < fp.x1 + m && z > fp.z0 - m && z < fp.z1 + m) return;
    if (pathRect && segDist(x, z, door.x, door.z, kx, kz) < pathW / 2 + r * 0.8) return;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < (t.r + r) * 0.8) return;
    trees.push({ x, z, r });
  };
  /** A row of trees from (x0, z0) to (x1, z1), about `every` apart, each `r` (a little varied). */
  const row = (x0: number, z0: number, x1: number, z1: number, every: number, r: number, wobble = 0) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / every));
    for (let i = 0; i <= n; i++) {
      const t = i / n, k = trees.length * 7 + i;
      tree(x0 + (x1 - x0) * t + jit(seed, k) * wobble, z0 + (z1 - z0) * t + jit(seed, k + 99) * wobble, r * (1 + 0.08 * jit(seed, k + 51)));
    }
  };

  let base: SquarePlan["base"] = "lawn";
  if (tier <= 0) {
    // the green: lawn to the pavements, a stone apron round the hall, old trees in a loose ring round its edge
    rect(fp.x0 - 2.5, fp.x1 + 2.5, fp.z0 - 2.5, fp.z1 + 2.5, "pave");
    const e = H - 6;
    row(-e, -e, e, -e, 13, 3.6, 2.5);
    row(-e, -e, -e, e, 13, 3.6, 2.5);
    row(e, -e, e, e, 13, 3.6, 2.5);
    row(-e, e, e, e, 13, 3.6, 2.5);
  } else if (tier === 1) {
    // the market square: paved in front of the hall and round it, lawns either side with a row of trees on each
    const xs = Math.max(-fp.x0, fp.x1) + 7;
    rect(-xs, xs, fp.z0 - 3, H, "pave");
    row(-xs - 4.5, fp.z0, -xs - 4.5, H - 4, 8.5, 3);
    row(xs + 4.5, fp.z0, xs + 4.5, H - 4, 8.5, 3);
    row(-H + 5, -H + 5, H - 5, -H + 5, 10, 3.2, 1.5);
  } else if (tier === 2) {
    // the town square: paved to the kerbs, lawn beds beside and behind the hall planted in rows, an avenue along the front
    base = "pave";
    rect(fp.x0 - 2, fp.x1 + 2, fp.z0 - 2, fp.z1 + 2, "pave"); // an apron round the hall, set off by its own border
    const xs = Math.max(-fp.x0, fp.x1) + 4;
    rect(xs, H - 3, fp.z0, fp.z1 + 2, "lawn");
    rect(-H + 3, -xs, fp.z0, fp.z1 + 2, "lawn");
    rect(-H + 3, H - 3, -H + 3, fp.z0 - 4, "lawn");
    const bx = (xs + H - 3) / 2;
    row(bx, fp.z0 + 3, bx, fp.z1 - 1, 8, 2.8);
    row(-bx, fp.z0 + 3, -bx, fp.z1 - 1, 8, 2.8);
    row(-H + 8, (-H + 3 + fp.z0 - 4) / 2, H - 8, (-H + 3 + fp.z0 - 4) / 2, 9, 3);
    row(-H + 5, H - 4.5, H - 5, H - 4.5, 9, 2.7);
  } else {
    // the city's plaza: paved to the kerbs, tree rows down both sides and along the street, a grove on a lawn behind
    base = "pave";
    rect(fp.x0 - 2, fp.x1 + 2, fp.z0 - 2, fp.z1 + 2, "pave");
    rect(-H + 2.5, H - 2.5, -H + 2.5, fp.z0 - 3, "lawn");
    row(-H + 4.5, fp.z0, -H + 4.5, H - 4.5, 8, 2.6);
    row(H - 4.5, fp.z0, H - 4.5, H - 4.5, 8, 2.6);
    row(-H + 11, H - 4.5, H - 11, H - 4.5, 8, 2.6);
    const back = (-H + 2.5 + fp.z0 - 3) / 2;
    row(-H + 6, back - 3.5, H - 6, back - 3.5, 8.5, 3, 1);
    row(-H + 10, back + 3.5, H - 10, back + 3.5, 8.5, 3, 1);
  }
  if (pathRect) rects.push(pathRect);
  return { base, rects, trees };
}
