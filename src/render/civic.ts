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
/** A piece of the square's furniture (render/townlife.ts LIFE_MODELS), its front turned to (sin rot, cos rot). */
export interface SquareProp { model: string; x: number; z: number; rot: number }
/** Someone on the square: standing, turned to (sin rot, cos rot), or strolling to `to` and back. */
export interface SquareFolk { x: number; z: number; rot: number; to?: { x: number; z: number } }
export interface SquarePlan {
  base: "lawn" | "pave"; // the whole lot
  rects: SquareRect[]; // laid over it, in order
  trees: SquareTree[];
  /** its benches, market stalls, newsstand, telephone, memorial or fountains, planters */
  props: SquareProp[];
  /** the townspeople about it: at the stalls, round the memorial, along the path */
  folk: SquareFolk[];
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
 * `front`: where the open ground in front ends at the street's pavement (lot z; a deep front strip carries the
 * square's paving on past the lot).
 */
export function squarePlan(
  tier: number, half: number, fp: Footprint, door: { x: number; z: number }, kerb: { x: number; z: number }, seed: number, front = half - 0.4,
): SquarePlan {
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
  // (the open ground ends at the pavement: short of the lot's edge, should a widened street take some of it)
  const fz = Math.max(door.z + 2, Math.min(front, kerb.z));
  const fx = door.x + (kerb.x - door.x) * ((fz - door.z) / (kerb.z - door.z || 1));
  const { props, folk } = furnish(tier, H, fz, fp, door, { x: fx, z: fz }, pathW, trees, seed);
  return { base, rects, trees, props, folk };
}

/** How much room each piece of furniture takes (m, a radius). */
const ROOM: Record<string, number> = {
  life_bench: 1.0, life_stall_a: 1.8, life_stall_b: 1.8, life_kiosk: 1.4, life_phonebox: 0.7, life_memorial: 2.0,
  life_fountain: 3.1, life_planter: 0.55,
};

/**
 * The square's furniture and its people, kept off the hall, its path, the trees' trunks and each other. A hamlet's
 * green gets its memorial and a bench or two; a village's market square its stalls in two rows with shoppers between;
 * a town's square a memorial and a fountain, planters, the newsstand and the telephone; a city's plaza two fountains.
 * Lot space, as squarePlan: +z toward the street, the door at `door`, the path running on to `kerb`; the ground runs
 * H either way across and back, and on to F in front.
 */
function furnish(
  tier: number, H: number, F: number, fp: Footprint, door: { x: number; z: number }, kerb: { x: number; z: number }, pathW: number,
  trees: SquareTree[], seed: number,
): { props: SquareProp[]; folk: SquareFolk[] } {
  const props: SquareProp[] = [];
  const folk: SquareFolk[] = [];
  const offPath = (x: number, z: number, r: number) => segDist(x, z, door.x, door.z, kerb.x, kerb.z) > pathW / 2 + r + 0.3;
  const free = (x: number, z: number, r: number) => {
    if (Math.abs(x) > H - r - 0.3 || z < -H + r + 0.3 || z > F - r - 0.3) return false;
    if (x > fp.x0 - r - 1.5 && x < fp.x1 + r + 1.5 && z > fp.z0 - r - 1.5 && z < fp.z1 + r + 1.5) return false;
    if (!offPath(x, z, r)) return false;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < r + Math.max(0.9, t.r * 0.6)) return false;
    for (const p of props) if (Math.hypot(p.x - x, p.z - z) < r + (ROOM[p.model] ?? 1) + 0.4) return false;
    return true;
  };
  const put = (model: string, x: number, z: number, rot: number): boolean => {
    if (!free(x, z, ROOM[model] ?? 1)) return false;
    props.push({ model, x, z, rot });
    return true;
  };
  /** Someone standing at (x, z) looking to (lx, lz), if there is room (off the path, the furniture and the trees). */
  const stand = (x: number, z: number, lx: number, lz: number) => {
    if (Math.abs(x) > H - 0.5 || z < -H + 0.5 || z > F - 0.5) return;
    if (x > fp.x0 - 0.8 && x < fp.x1 + 0.8 && z > fp.z0 - 0.8 && z < fp.z1 + 0.8) return;
    if (!offPath(x, z, 0)) return;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 0.8) return;
    for (const p of props) if (Math.hypot(p.x - x, p.z - z) < (ROOM[p.model] ?? 1) * 0.8) return;
    for (const f of folk) if (Math.hypot(f.x - x, f.z - z) < 0.6) return;
    folk.push({ x, z, rot: Math.atan2(lx - x, lz - z) });
  };
  /** A knot of two or three about (x, z), talking. */
  const knot = (x: number, z: number, k: number) => {
    const n = jit(seed, k) > 0 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + jit(seed, k + i) * 0.5;
      stand(x + Math.sin(a) * 0.55, z + Math.cos(a) * 0.55, x, z);
    }
  };
  const front0 = fp.z1 + 2, side = pathW / 2;
  // the front: the ground between the hall and the street, either side of the path
  const fz = (front0 + F) / 2;
  /** Put it at (x, z), or as near there as there is room (a few metres either way). */
  const near = (model: string, x: number, z: number, rot: number): boolean => {
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, -3], [0, 3], [5, -3], [-5, -3], [6, 2], [-6, 2]])
      if (put(model, x + dx, z + dz, rot)) return true;
    return false;
  };
  // the monuments: a hamlet's memorial on its green; a town's memorial and a fountain either side of the path; a
  // city's two fountains, its memorial further out
  if (tier <= 0) {
    if (!near("life_memorial", -(side + 6), fz, 0)) near("life_memorial", side + 6, fz, 0);
  } else if (tier === 2) {
    near("life_memorial", -(side + 6.5), fz, 0);
    near("life_fountain", side + 7.5, fz, 0);
  } else if (tier >= 3) {
    near("life_fountain", side + 7.5, fz, 0);
    near("life_fountain", -(side + 7.5), fz, 0);
    near("life_memorial", -(side + 19), fz, 0);
  }
  if (tier >= 2)
    // planters flanking the door and the path's end at the street
    for (const s of [-1, 1]) {
      put("life_planter", door.x + s * (side + 0.9), front0 + 0.6, 0);
      put("life_planter", kerb.x + s * (side + 0.9), F - 1.2, 0);
    }
  // the newsstand and the telephone by the street, at the front corners
  if (tier >= 1 && !put("life_kiosk", H - 2.6, F - 2.4, 0)) put("life_kiosk", H - 2.6, F - 7, Math.PI / 2);
  if (!put("life_phonebox", -(H - 1.4), F - 1.4, 0)) put("life_phonebox", -(H - 1.4), F - 5, 0);
  // benches along the path, facing it, and either side of the memorial and the fountains
  const len = Math.hypot(kerb.x - door.x, kerb.z - door.z), ux = (kerb.x - door.x) / (len || 1), uz = (kerb.z - door.z) / (len || 1);
  for (let t = 4; t < len - 3; t += 8)
    for (const s of [-1, 1]) {
      // (s: which side of the path; the bench's front turned back across it)
      const nx = uz * s, nz = -ux * s;
      put("life_bench", door.x + ux * t + nx * (side + 1.4), door.z + uz * t + nz * (side + 1.4), Math.atan2(-nx, -nz));
    }
  for (const p of props.filter((p) => p.model === "life_memorial" || p.model === "life_fountain")) {
    const r = (ROOM[p.model] ?? 2) + 1.6;
    for (const a of [Math.PI / 2, -Math.PI / 2]) put("life_bench", p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, a + Math.PI);
    knot(p.x + jit(seed, 31) * 1.5, p.z + r + 0.6, 40);
  }
  // the market on what open ground is left: pairs of stalls facing each other over an aisle, from the path out,
  // shoppers in the aisle; a village's square is its market place, a town's and a city's have a few stalls
  let stalls = [0, 10, 6, 10][tier] ?? 10, k = 0;
  for (let zA = front0 + 2.2; zA + 6.2 < F - 1.5 && stalls > 0; zA += 15)
    for (let x = side + 2.6; x < H - 2 && stalls > 0; x += 3.9)
      for (const s of [-1, 1])
        for (const [z, rot] of [[zA, 0], [zA + 6.2, Math.PI]] as const) {
          k++;
          if (stalls <= 0) break;
          const model = (k + (jit(seed, k * 13) > 0.5 ? 1 : 0)) % 2 ? "life_stall_a" : "life_stall_b";
          if (!put(model, s * x, z, rot)) continue;
          stalls--;
          const dz = rot === 0 ? 1.7 : -1.7;
          if (jit(seed, k * 3) > -0.4) stand(s * x + jit(seed, k * 5) * 0.8, z + dz, s * x, z);
          if (jit(seed, k * 7) > 0.3) stand(s * x + 0.9 + jit(seed, k * 11) * 0.3, z + dz * 1.15, s * x, z);
        }
  // people: about the newsstand, a knot or two on the open ground, and strolling along the path to the door
  const kiosk = props.find((p) => p.model === "life_kiosk");
  if (kiosk) stand(kiosk.x + Math.sin(kiosk.rot) * 1.6, kiosk.z + Math.cos(kiosk.rot) * 1.6, kiosk.x, kiosk.z);
  for (let i = 0; i < 1 + tier; i++) knot(jit(seed, 60 + i) * (H - 4), front0 + (0.5 + jit(seed, 70 + i) * 0.4) * (F - front0), 80 + i * 5);
  // and some crossing the open ground in front, along the street, on a line clear of the furniture and the trees
  for (let i = 0; i < tier * 2; i++) {
    const z = front0 + 1.5 + (0.5 + jit(seed, 120 + i) * 0.5) * (F - front0 - 3), x0 = -H + 2, x1 = H - 2;
    let clear = true;
    for (let x = x0; x <= x1 && clear; x += 1) {
      for (const p of props) if (Math.hypot(p.x - x, p.z - z) < (ROOM[p.model] ?? 1) + 0.3) clear = false;
      for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 0.7) clear = false;
    }
    if (clear) folk.push(i % 2 ? { x: x0, z, rot: 0, to: { x: x1, z } } : { x: x1, z, rot: 0, to: { x: x0, z } });
  }
  const walkers = [2, 3, 5, 7][tier] ?? 7;
  for (let i = 0; i < walkers; i++) {
    const o = jit(seed, 90 + i) * side * 0.6, t0 = 2 + Math.max(0, jit(seed, 95 + i)) * len * 0.3;
    folk.push({ x: door.x + ux * t0 + uz * o, z: door.z + uz * t0 - ux * o, rot: 0, to: { x: kerb.x + uz * o, z: Math.min(F, kerb.z - ux * o) } });
  }
  return { props, folk };
}
