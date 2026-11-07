import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { polyAt, polyClosest, v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { EXPORT_PRICE, TRADE, pickPartner } from "../src/game/trade";

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

const demand = (g: Game) => { (g as any).computeDemand(); return g.demand; };

describe("Trade with the gateway cities", () => {
  it("the start's motorway links two of them, and they show in demand", () => {
    const g = new Game(7);
    expect(g.linked.size).toBe(2);
    const names = [...g.linked].map((id) => g.gatewayOf(id)!);
    // seed 7: a farm town and a capital
    expect(names.map((n) => n.kind).sort()).toEqual(["capital", "farm"]);
    const cap = names.find((n) => n.kind === "capital")!;
    town(g);
    const d = demand(g);
    expect(d.res.factors).toContainEqual({ label: `Trade with ${cap.name}`, v: TRADE.capital.demand.res });
  });

  it("a road built into another gateway city opens it; removing the road closes it", () => {
    const g = new Game(7);
    town(g);
    const gw = { id: 99, name: "Testford", kind: "capital" as const, p: v2(-200, -760), r: 160 };
    g.gateways.push(gw);
    const before = new Set(g.net.segs.keys());
    road(g, v2(-200, -300), v2(-200, -700));
    const link = [...g.net.segs.keys()].filter((id) => !before.has(id));
    expect(link.length).toBeGreaterThan(0);
    expect(g.linked.has(99)).toBe(true);
    expect(g.entries.some((p) => p.gate === 99)).toBe(true);
    expect(g.exits.some((p) => p.gate === 99)).toBe(true);
    // two capitals linked now: both bring migrants, capped
    const f = demand(g).res.factors.filter((x) => x.label.startsWith("Trade with"));
    expect(f.map((x) => x.label)).toContain("Trade with Testford");
    expect(f.reduce((a, x) => a + x.v, 0)).toBeLessThanOrEqual(20);
    // a road into it that isn't joined to the city doesn't count
    g.bulldoze(link, []);
    expect(g.linked.has(99)).toBe(false);
    road(g, v2(-600, -760), v2(-300, -760));
    expect(g.linked.has(99)).toBe(false);
  });

  it("factories export through the exits their roads reach, at the partner's price, and import from it", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    // add up each hour's tally (the city keeps the last full hour's)
    const sum = new Map<number, { exports: number; imports: number; earned: number }>();
    for (let h = 0; h < 16; h++) {
      run(g, 1);
      for (const [gate, x] of g.trade) {
        const s = sum.get(gate) ?? { exports: 0, imports: 0, earned: 0 };
        s.exports += x.exports; s.imports += x.imports; s.earned += x.earned;
        sum.set(gate, s);
      }
    }
    const t = [...sum.entries()];
    const ex = t.filter(([, x]) => x.exports > 0);
    expect(ex.length).toBeGreaterThan(0);
    for (const [gate, x] of ex) {
      // the town joins only one carriageway: it can only reach the exit downstream of its junction
      expect(g.exits.find((p) => p.gate === gate)).toBeTruthy();
      const kind = g.gatewayOf(gate)!.kind;
      expect(x.earned / x.exports).toBeCloseTo(EXPORT_PRICE * TRADE[kind].goods * (g.tax.ind / 10), 6);
    }
    expect(t.some(([, x]) => x.imports > 0)).toBe(true);
    expect(g.materialsFactor).toBeCloseTo(1 + (1 - g.materialsPrice) * 0.6, 9);
  });

  it("trucks leaving by a road into a gateway city drive off its end, not stall at it", () => {
    const g = new Game(7);
    town(g);
    g.gateways.push({ id: 99, name: "Testford", kind: "capital", p: v2(-200, -760), r: 160 });
    road(g, v2(-200, -300), v2(-200, -700));
    const port = g.exits.find((p) => p.gate === 99)!;
    expect(port).toBeTruthy();
    run(g, 3);
    const from = g.buildings.list.find((b) => b.zone === "ind" && b.access)!;
    const t0 = g.time;
    const mine = (trip: any) => trip.kind === "cargo" && trip.to < 0 && trip.from === from.id && trip.startT === t0;
    const fails: string[] = [];
    let arrived = 0;
    const onFail = (g as any).onFail.bind(g), onArrive = (g as any).onArrive.bind(g);
    (g as any).onFail = (trip: any, why: string) => { if (mine(trip)) fails.push(why); onFail(trip, why); };
    (g as any).onArrive = (v: any, now: number) => { if (mine(v.trip)) arrived++; onArrive(v, now); };
    for (let k = 0; k < 3; k++) (g as any).truck(from, null, "goods", port);
    run(g, 5);
    expect(fails).toEqual([]);
    // they drove off the map into the gateway city
    expect(arrived).toBe(3);
  });

  it("factories pay what the partners their roads reach charge: joining the other carriageway opens cheaper materials", () => {
    const g = new Game(7);
    town(g);
    run(g, 3);
    expect(g.buildings.list.some((b) => b.zone === "ind")).toBe(true);
    // the town's junction is on the carriageway coming from the capital (dear materials)
    const reach = g.entries.filter((p) => g.connected(p.a.seg, g.buildings.list.find((b) => b.zone === "ind")!.access!.seg));
    expect(reach.map((p) => g.gatewayOf(p.gate)!.kind)).toEqual(["capital"]);
    expect(g.materialsPrice).toBe(TRADE.capital.materials);
    expect(g.materialsFactor).toBeLessThan(1);
    // a link road onto the other carriageway: the farm town's materials are in reach
    const town0 = g.buildings.list.find((b) => b.zone === "ind")!.access!.seg;
    let best: { p: V2; d: number } | null = null;
    for (const id of g.net.segsNear(200, 300, 550, 650)) {
      if (g.connected(id, town0)) continue;
      const geo = g.net.segGeom.get(id)!;
      const c = polyClosest(geo.center, v2(366, 473));
      if (!best || c.d < best.d) best = { p: polyAt(geo.center, c.s), d: c.d };
    }
    expect(best && best.d < 80).toBe(true);
    road(g, v2(366, 473), best!.p);
    expect(g.materialsPrice).toBe(TRADE.farm.materials);
    expect(g.materialsFactor).toBeGreaterThan(1);
  });

  it("better payers take most of the exports", () => {
    const parts = [{ n: "cap", p: TRADE.capital.goods }, { n: "farm", p: TRADE.farm.goods }];
    let cap = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (pickPartner(parts, (x) => x.p, (i + 0.5) / N)!.n === "cap") cap++;
    const a = TRADE.capital.goods ** 4, b = TRADE.farm.goods ** 4;
    expect(cap / N).toBeCloseTo(a / (a + b), 2);
    expect(cap / N).toBeGreaterThan(0.6);
  });
});
