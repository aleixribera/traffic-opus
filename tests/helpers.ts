// Shared test scaffolding. Players no longer zone land: towns lay and zone their own streets. Tests that need homes
// and shops in a set layout (bus stops on known streets, a suburb a kilometre out) draw the streets themselves and
// hand them to a "host" town with `zoneFor`, as if that town had laid them.

import { expect } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { dist, v2, type V2 } from "../src/core/math";
import { LEVEL_H } from "../src/config";
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

/**
 * A street from a to b laid the way a player would get one through: straight, bent round an obstacle, or over a
 * bridge (with ramps up to it) where water is in the way. It costs no more than `budget`. The legs it was laid in
 * and what it cost; "money" if every way through costs more; "blocked" if there is none.
 */
export function layRoad(g: Game, a: V2, b: V2, budget = Infinity): { legs: [V2, V2][]; cost: number; bridge: number } | "money" | "blocked" {
  const at = (p: V2, level: number): Snap => {
    const s = snap(g.net, p, { mpp: 0.4, level, type: "street" });
    return s.node !== undefined || s.seg !== undefined ? s : { p, h: level * LEVEL_H, guides: [] };
  };
  const L = dist(a, b), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
  const routes: { p: V2; lv: number }[][] = [];
  for (const off of [0, 250, -250, 500, -500, 900, -900]) {
    const mid = v2((a.x + b.x) / 2 + n.x * off, (a.y + b.y) / 2 + n.y * off);
    routes.push(off === 0 ? [{ p: a, lv: 0 }, { p: b, lv: 0 }] : [{ p: a, lv: 0 }, { p: mid, lv: 0 }, { p: b, lv: 0 }]);
  }
  // a bridge deck (level 1) over the water on the straight line
  const along = (d: number) => v2(a.x + (b.x - a.x) * (d / L), a.y + (b.y - a.y) * (d / L));
  let w0 = -1, w1 = -1;
  for (let d = 0; d <= L; d += 10) if (g.world.isWater(along(d))) { if (w0 < 0) w0 = d; w1 = d; }
  if (w0 > 80 && w1 < L - 80) routes.push([{ p: a, lv: 0 }, { p: along(w0 - 70), lv: 1 }, { p: along(w1 + 70), lv: 1 }, { p: b, lv: 0 }]);
  let dear = false;
  for (const r of routes) {
    const legs = r.slice(1).map((q, k) => [r[k], q] as const);
    const plans = legs.map(([p, q]) => planRoad(g.net, g.world, { start: at(p.p, p.lv), end: at(q.p, q.lv), mode: "straight", type: "street" }));
    if (plans.some((p) => p.errors.length)) continue;
    const cost = plans.reduce((s, p) => s + p.cost, 0);
    if (cost > budget) { dear = true; continue; }
    // (each leg after the first is planned again once the one before is down, to join it)
    let built = 0;
    for (const [k, [p, q]] of legs.entries()) {
      const pl = k === 0 ? plans[0] : planRoad(g.net, g.world, { start: at(p.p, p.lv), end: at(q.p, q.lv), mode: "straight", type: "street" });
      if (pl.errors.length || !g.build(pl)) break;
      built++;
    }
    if (built < legs.length) { for (let k = 0; k < built; k++) g.undo(); continue; }
    return { legs: legs.map(([p, q]) => [p.p, q.p]), cost, bridge: r.length === 4 ? w1 - w0 + 140 : 0 };
  }
  return dear ? "money" : "blocked";
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
