// Shared test scaffolding. Players no longer zone land: towns lay and zone their own streets. Tests that need homes
// and shops in a set layout (bus stops on known streets, a suburb a kilometre out) draw the streets themselves and
// hand them to a "host" town with `zoneFor`, as if that town had laid them.

import { expect } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import type { Town } from "../src/game/settlements";
import type { Cell, ZoneId } from "../src/game/zones";
import type { Building } from "../src/game/buildings";
import type { PlacedKind } from "../src/game/placed";

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

/** Lay a road, joining existing roads at either end (as the road tool's snapping would). */
export function road(g: Game, a: V2, b: V2, type: any = "street") {
  const sa = snap(g.net, a, { mpp: 0.5, level: 0, type });
  const sb = snap(g.net, b, { mpp: 0.5, level: 0, type });
  const plan = planRoad(g.net, g.world, {
    start: sa.node !== undefined || sa.seg !== undefined ? sa : free(a),
    end: sb.node !== undefined || sb.seg !== undefined ? sb : free(b), mode: "straight", type,
  });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}

/** Run the sim for some game hours. */
export function run(g: Game, hours: number, each?: () => void) {
  for (let i = 0; i < hours * HOUR * 30; i++) {
    g.step(1 / 30);
    if (each) each();
  }
}

export const okCells = (g: Game) => [...g.zones.allCells()].filter((c) => c.ok);

/**
 * A town that owns hand-drawn streets instead of laying its own: it never lays a street (it has no grid), its
 * target stays where the test puts it whatever it is supplied, and it zones nothing itself (`zoneFor` does).
 */
export function hostTown(g: Game, households: number): Town {
  const id = 900;
  let t = g.towns.byId.get(id);
  if (!t) {
    t = {
      id, name: "Testbury", c: v2(0, 0), ang: 0, built: new Set(), failed: new Set(), target: households,
      today: {}, yesterday: {}, supply: {}, trend: 0, founded: g.time, pop: 0, households: 0, homes: 0, shops: 0, reach: 0,
    };
    g.towns.list.push(t);
    g.towns.byId.set(id, t);
    const daily = g.towns.daily.bind(g.towns), host = t;
    g.towns.daily = () => { const k = host.target; daily(); host.target = k; };
  }
  t.target = households;
  return t;
}

/** Zone cells for the host town (whose streets they front from now on). */
export function zoneFor(g: Game, cells: Cell[], zone: ZoneId, households = 400): number {
  const t = hostTown(g, households);
  for (const c of cells) {
    const s = g.net.segs.get(c.block.seg);
    if (s) s.town = t.id;
  }
  return g.zoneCells(cells, zone);
}

/** Every shop gets a load of food (the deliveries a test town has no food plant for). */
export function stockShops(g: Game) {
  for (const b of g.shops) b.stock = Math.max(b.stock, 8);
}

/** A placed building beside a street from a to b, as close to its start as fits. */
export function placeAlong(g: Game, kind: PlacedKind, a: V2, b: V2, off = 40): Building {
  const L = Math.hypot(b.x - a.x, b.y - a.y), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
  for (let k = 0; k < 70; k++) {
    const t = 0.08 + k * 0.012;
    if (t > 0.95) break;
    const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    for (const side of [1, -1]) for (const o of [off, off + 15]) {
      const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
      if (g.placedPlan(kind, p)?.ok) return g.place(kind, p)!;
    }
  }
  throw new Error("no spot for " + kind);
}
