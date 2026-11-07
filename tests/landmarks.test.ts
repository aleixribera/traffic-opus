import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { ZONE_GROUP } from "../src/game/growables";
import { SERVICES, type ServiceKind } from "../src/game/services";
import type { Building } from "../src/game/buildings";

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

function road(g: Game, a: V2, b: V2, type: any = "street") {
  const sa = snap(g.net, a, { mpp: 0.5, level: 0, type });
  const sb = snap(g.net, b, { mpp: 0.5, level: 0, type });
  const plan = planRoad(g.net, g.world, {
    start: sa.node !== undefined || sa.seg !== undefined ? sa : free(a),
    end: sb.node !== undefined || sb.seg !== undefined ? sb : free(b), mode: "straight", type,
  });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}

const run = (g: Game, hours: number) => { for (let i = 0; i < hours * HOUR * 30; i++) g.step(1 / 30); };

function town(g: Game) {
  road(g, v2(366, 473), v2(0, 0));
  road(g, v2(-200, 0), v2(0, 0));
  road(g, v2(0, 0), v2(0, -300));
  road(g, v2(-200, 0), v2(-200, -300));
  road(g, v2(-200, -300), v2(0, -300));
  road(g, v2(-200, -150), v2(0, -150));
  const cells = [...g.zones.allCells()].filter((c) => c.ok);
  g.zonePaint(cells.filter((c) => c.c.y < -150), "resLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x < -100), "comLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x >= -100), "ind");
}

/** A spot beside the motorway link where `kind` fits (`skip` such spots first). */
function spot(g: Game, kind: ServiceKind, skip = 0): V2 {
  const a = v2(0, 0), b = v2(366, 473);
  const L = Math.hypot(b.x - a.x, b.y - a.y), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
  for (let k = 0; k < 60; k++) {
    const t = 0.1 + k * 0.014;
    for (const side of [1, -1]) {
      const p = v2(a.x + (b.x - a.x) * t + side * n.x * 45, a.y + (b.y - a.y) * t + side * n.y * 45);
      const pl = g.servicePlan(kind, p);
      if ((pl?.ok || pl?.reason === "Not unlocked yet" || pl?.reason === "Only one per city") && skip-- <= 0) return p;
    }
  }
  throw new Error("no spot for " + kind);
}

const homes = (g: Game) => g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && b.built >= 1);

describe("Landmarks", () => {
  it("each later milestone unlocks one", () => {
    const at = (Object.values(SERVICES).filter((s) => s.unique).map((s) => s.unlock)).sort();
    expect(at).toEqual([5, 6, 7, 8, 9]);
  });

  it("are locked until their milestone, one per city, and lift the town round them", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e7;
    run(g, 8);
    const before = new Map(homes(g).map((b) => [b.id, g.services.happiness(b)]));
    expect(before.size).toBeGreaterThan(0);
    const p = spot(g, "townhall");
    expect(g.servicePlan("townhall", p)?.reason).toBe("Not unlocked yet");
    g.milestone = 5;
    const hall: Building | null = g.placeService("townhall", p);
    expect(hall).not.toBeNull();
    // a second one anywhere is refused
    const p2 = spot(g, "townhall");
    expect(Math.hypot(p2.x - p.x, p2.y - p.y)).toBeGreaterThan(40);
    expect(g.servicePlan("townhall", p2)?.reason).toBe("Only one per city");
    run(g, 1);
    const near = homes(g).filter((b) => before.has(b.id));
    expect(near.length).toBeGreaterThan(0);
    for (const b of near) expect(g.services.cov.get(b.id)?.landmark ?? 0).toBeGreaterThan(0);
    for (const b of near) expect(g.services.happiness(b)).toBeGreaterThan(before.get(b.id)! - 1e-9);
    expect(near.some((b) => g.services.happiness(b) > before.get(b.id)! + 0.01)).toBe(true);
    expect(g.demand.com.factors.some((f) => f.label === "Visitors to landmarks" && f.v > 0)).toBe(true);
    // residents drive over to see it
    run(g, 16);
    expect(hall!.visits).toBeGreaterThan(0);
  });
});
