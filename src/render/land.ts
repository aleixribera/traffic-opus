// The countryside's enclosures: where the open land between the towns is hedged into pasture and hay meadow. One
// rule set, worked out here on the CPU from hashed cells and the terrain's fields, and used three times: the ground
// shader paints the fields and their hedge lines from a byte per cell baked into each chunk (render/terrain3d.ts),
// the hedges, gates and haystacks that stand on them in 3D are placed from the same cells (render/landprops.ts), and
// the atlas draws them as its patchwork. Nothing here touches three.js: it is tested on its own (tests/land.test.ts).
//
// The rules. A survey grid of cells 128 m apart on average covers the map: each of its lines is set a little to one
// side of its place (so the fields are of all sizes), and the whole is bent by a slow noise so no boundary runs
// dead straight.
// A cell is enclosed when the land it covers is plain dry ground (its middle and its four corners: no water, no
// wood, no hill, no deposit showing, and not the fertile soil the company's farms want, which stays open prairie),
// it lies in one of the settled districts a slower noise marks out, and it has another field beside it. An enclosed cell is pasture or meadow; two
// neighbours of a kind are sometimes thrown together into a larger field. A hedge runs along every side of an
// enclosed cell that is not thrown open, with a gateway somewhere along it.

import { F, riverWater } from "../world/gen";
import { thashf } from "./forest";

/** An enclosure cell's side (m): eight field nodes. */
export const ENC = 128;
/**
 * How far the survey grid is bent (m either way) and over what length (m): a long swing that turns whole districts
 * a few degrees off the compass, and a shorter one that keeps any one boundary from running straight.
 */
export const ENC_WARP = [70, 24];
export const ENC_WARP_L = [1700, 390];
/** How far a line of the survey grid is set from its place (m either way): fields from 60 m to 196 m across. */
export const ENC_JIT = 34;
/** The furthest a point lies from the middle of its cell's place on the grid (the ground's chunks keep this margin). */
export const ENC_REACH = ENC_WARP[0] + ENC_WARP[1] + ENC / 2 + ENC_JIT;
/** A hedge's half thickness (m), and its gateway's half width. */
export const HEDGE_HW = 1.5;
export const GATE_HW = 3.2;

/** What a cell is. */
export const OPEN = 0, PASTURE = 1, MEADOW = 2;
/** A cell's byte: its kind in the low two bits, then a hedge on its east, north, west and south side. */
export const HEDGE_E = 4, HEDGE_N = 8, HEDGE_W = 16, HEDGE_S = 32;

/** Hash slots (their own range, clear of the trees'). */
const K = { warpX: 70, warpY: 71, warpX2: 72, warpY2: 73, district: 60, kind: 61, joinE: 62, joinN: 63, pick: 64, gate: 65, tint: 67, stack: 68, bare: 69, lineX: 74, lineY: 75 } as const;
export const LAND_K = K;

function tnoise(x: number, y: number, k: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = thashf(i, j, k), b = thashf(i + 1, j, k), c = thashf(i, j + 1, k), d = thashf(i + 1, j + 1, k);
  return a + (b - a) * ux + (c + (d - c) * ux - a - (b - a) * ux) * uy;
}

/** The bend of the survey grid at a world point: the cell a point is in is the cell of (x + dx, y + dy). */
export function encWarp(x: number, y: number): [number, number] {
  const [A, B] = ENC_WARP, [LA, LB] = ENC_WARP_L;
  return [
    (tnoise(x / LA + 3.3, y / LA + 8.1, K.warpX) - 0.5) * 2 * A + (tnoise(x / LB - 1.4, y / LB + 5.2, K.warpX2) - 0.5) * 2 * B,
    (tnoise(x / LA - 6.7, y / LA + 1.9, K.warpY) - 0.5) * 2 * A + (tnoise(x / LB + 7.6, y / LB - 3.8, K.warpY2) - 0.5) * 2 * B,
  ];
}

/** The world point that lands on a point of the bent grid (the inverse of the bend, by a few steps of iteration). */
export function encUnwarp(qx: number, qy: number): [number, number] {
  let x = qx, y = qy;
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = encWarp(x, y);
    x = qx - dx;
    y = qy - dy;
  }
  return [x, y];
}

/** Where line `i` of the survey grid runs, on the bent grid (m): axis 0 the lines of constant x, 1 of constant y. */
export const encLine = (i: number, axis: 0 | 1): number => i * ENC + (thashf(i, 0, K.lineX + axis) - 0.5) * 2 * ENC_JIT;

/** The cell a point of the bent grid lies in, where in it (m from its west and south lines), and the cell's size. */
export function encCell(qx: number, qy: number): { ci: number; cj: number; fx: number; fy: number; w: number; h: number } {
  const one = (q: number, axis: 0 | 1): [number, number, number] => {
    let i = Math.floor(q / ENC);
    if (q < encLine(i, axis)) i--;
    else if (q >= encLine(i + 1, axis)) i++;
    const a = encLine(i, axis);
    return [i, q - a, encLine(i + 1, axis) - a];
  };
  const [ci, fx, w] = one(qx, 0), [cj, fy, h] = one(qy, 1);
  return { ci, cj, fx, fy, w, h };
}

/** The same in GLSL (needs TREE_HASH_GLSL's tnoise). */
export const LAND_GLSL = /* glsl */ `
float encLineOff(float i, uint k) { return (thashf(ivec2(int(i), 0), k) - 0.5) * ${(2 * ENC_JIT).toFixed(1)}; }
/* one axis of the cell lookup: q along it; gives the cell's index, the distance in from its low line, its length */
vec3 encAxis(float q, uint k) {
  float i = floor(q / ${ENC.toFixed(1)}), f = q - i * ${ENC.toFixed(1)};
  float o0 = encLineOff(i, k), o1 = encLineOff(i + 1.0, k);
  if (f < o0) { i -= 1.0; f += ${ENC.toFixed(1)}; o1 = o0; o0 = encLineOff(i, k); }
  else if (f >= ${ENC.toFixed(1)} + o1) { i += 1.0; f -= ${ENC.toFixed(1)}; o0 = o1; o1 = encLineOff(i + 1.0, k); }
  return vec3(i, f - o0, ${ENC.toFixed(1)} + o1 - o0);
}
vec2 encWarp(vec2 p) {
  vec2 a = p / ${ENC_WARP_L[0].toFixed(1)}, b = p / ${ENC_WARP_L[1].toFixed(1)};
  return (vec2(tnoise(a + vec2(3.3, 8.1), ${K.warpX}u), tnoise(a + vec2(-6.7, 1.9), ${K.warpY}u)) - 0.5) * ${(2 * ENC_WARP[0]).toFixed(1)}
    + (vec2(tnoise(b + vec2(-1.4, 5.2), ${K.warpX2}u), tnoise(b + vec2(7.6, -3.8), ${K.warpY2}u)) - 0.5) * ${(2 * ENC_WARP[1]).toFixed(1)};
}
`;

/** A field's byte at node (i, j) of the 64 m grid (every fourth field node). */
export type NodeAt = (f: number, i: number, j: number) => number;

const DEPOSITS = [F.ore, F.oil, F.coal, F.lime, F.sand, F.copper];

/** Whether a 64 m node is plain dry ground an enclosure can cover. */
function plain(at: NodeAt, i: number, j: number): boolean {
  if (at(F.mtn, i, j) > 117 || at(F.forest, i, j) > 119 || at(F.fert, i, j) > 132 || at(F.lake, i, j) > 112) return false;
  return riverWater(at(F.river, i, j) / 255, at(F.flow, i, j) / 255) < 0.2;
}

/** What cell (ci, cj) would be by its own ground: open land, pasture or meadow. */
export function encKindAlone(ci: number, cj: number, at: NodeAt): number {
  // (the settled districts, a few cells across, and a gap here and there inside them)
  const d = tnoise(ci / 5.2 + 1.7, cj / 5.2 - 4.4, K.district) * 0.75 + tnoise(ci / 1.9 - 2.1, cj / 1.9 + 6.3, K.district + 100) * 0.25;
  if (d < 0.55 || thashf(ci, cj, K.pick) > 0.9) return OPEN;
  const i = ci * 2, j = cj * 2;
  if (!plain(at, i + 1, j + 1)) return OPEN;
  for (const f of DEPOSITS) if (at(f, i + 1, j + 1) > 122) return OPEN;
  if (!plain(at, i, j) || !plain(at, i + 2, j) || !plain(at, i, j + 2) || !plain(at, i + 2, j + 2)) return OPEN;
  return tnoise(ci / 2.3 + 9.1, cj / 2.3 + 3.7, K.kind) * 0.7 + thashf(ci, cj, K.kind + 100) * 0.3 > 0.5 ? PASTURE : MEADOW;
}

/** What cell (ci, cj) is: `alone(ci, cj)` gives a cell's kind by its own ground; a field with no field beside it is left open. */
export function encKind(ci: number, cj: number, alone: (ci: number, cj: number) => number): number {
  const k = alone(ci, cj);
  if (k === OPEN) return OPEN;
  return alone(ci + 1, cj) || alone(ci - 1, cj) || alone(ci, cj + 1) || alone(ci, cj - 1) ? k : OPEN;
}

/** Whether cell (ci, cj) is thrown together with its east / north neighbour (when both are of one kind). */
export const joinsE = (ci: number, cj: number): boolean => thashf(ci, cj, K.joinE) < 0.4;
export const joinsN = (ci: number, cj: number): boolean => thashf(ci, cj, K.joinN) < 0.4;
/** Whether the boundary on a cell's east / north side, between a pasture and a meadow, has no hedge (a fence line at most). */
const bareE = (ci: number, cj: number): boolean => thashf(ci, cj, K.bare) < 0.3;
const bareN = (ci: number, cj: number): boolean => thashf(ci, cj, K.bare + 100) < 0.3;

/** A cell's byte from the kinds of it and its four neighbours. */
export function encByte(ci: number, cj: number, kind: (ci: number, cj: number) => number): number {
  const k = kind(ci, cj), e = kind(ci + 1, cj), n = kind(ci, cj + 1), w = kind(ci - 1, cj), s = kind(ci, cj - 1);
  let b = k;
  // (no hedge between two cells thrown together, nor, sometimes, between a pasture and a meadow)
  const hedge = (a: number, c: number, joined: boolean, bare: boolean) => (a || c) && !(a === c && joined) && !(a && c && a !== c && bare);
  if (hedge(k, e, joinsE(ci, cj), bareE(ci, cj))) b |= HEDGE_E;
  if (hedge(k, n, joinsN(ci, cj), bareN(ci, cj))) b |= HEDGE_N;
  if (hedge(k, w, joinsE(ci - 1, cj), bareE(ci - 1, cj))) b |= HEDGE_W;
  if (hedge(k, s, joinsN(ci, cj - 1), bareN(ci, cj - 1))) b |= HEDGE_S;
  return b;
}

/** Where along a cell's west (side 0) or south (side 1) boundary its gateway is, as a share of that side's length. */
export const gateAt = (ci: number, cj: number, side: 0 | 1): number => 0.14 + thashf(ci, cj, K.gate + side) * 0.72;

/**
 * The cells' kinds, remembered: every chunk of the ground asks for the cells it covers and a ring round them, and
 * its neighbours ask for many of the same ones.
 */
export class Enclosures {
  private alone = new Map<number, number>();

  private aloneAt(ci: number, cj: number, at: NodeAt): number {
    const key = (ci + 32768) * 65536 + (cj + 32768);
    let k = this.alone.get(key);
    if (k === undefined) {
      if (this.alone.size > 200000) this.alone.clear();
      k = encKindAlone(ci, cj, at);
      this.alone.set(key, k);
    }
    return k;
  }

  /** `at`: the fields on the 64 m grid (any source: all of them give the same bytes). */
  kind(ci: number, cj: number, at: NodeAt): number {
    return encKind(ci, cj, (a, b) => this.aloneAt(a, b, at));
  }

  byte(ci: number, cj: number, at: NodeAt): number {
    return encByte(ci, cj, (a, b) => this.kind(a, b, at));
  }
}
