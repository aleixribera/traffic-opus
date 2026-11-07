import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";

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

/** Homes, shops and a works estate, `far` metres down a road from where the highway enters the map. */
function town(g: Game, far = 0) {
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) g.tiles.add(`${i},${j}`);
  road(g, v2(366, 473), v2(0, 0));
  const x0 = -far;
  if (far) road(g, v2(0, 0), v2(x0, 0));
  road(g, v2(x0 - 200, 0), v2(x0, 0));
  road(g, v2(x0, 0), v2(x0, -300));
  road(g, v2(x0 - 200, 0), v2(x0 - 200, -300));
  road(g, v2(x0 - 200, -300), v2(x0, -300));
  road(g, v2(x0 - 200, -150), v2(x0, -150));
  g.zones.rebuildAll();
  const cells = [...g.zones.allCells()].filter((c) => c.ok && c.c.x < x0 + 10 && c.c.x > x0 - 210);
  g.zonePaint(cells.filter((c) => c.c.y < -150), "resLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x < x0 - 100), "comLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x >= x0 - 100), "ind");
}

/** A big city sends most freight as virtual loads (see Game.truck): make every load one. */
const bigCity = (g: Game) => Object.defineProperty(g, "tripScale", { get: () => 40 });

const factories = (g: Game) => g.buildings.list.filter((b) => b.zone === "ind" && b.built >= 1 && !b.abandoned);

describe("Freight", () => {
  it("factories order materials early enough that they rarely stand idle, however far the highway entry is", () => {
    const g = new Game(7);
    town(g, 1800);
    bigCity(g);
    g.money = 1e6;
    let idle = 0, n = 0;
    for (let h = 0; h < 30; h++) {
      for (let i = 0; i < HOUR * 30; i++) g.step(1 / 30);
      if (h < 12) continue;
      for (const b of factories(g)) { n++; if (b.stock <= 0) idle++; }
    }
    expect(n).toBeGreaterThan(20);
    expect(idle / n).toBeLessThan(0.2);
  });

  it("a load from nearby isn't held up behind one coming from far away", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    for (let i = 0; i < 2 * HOUR * 30; i++) g.step(1 / 30);
    const [far, near] = factories(g).length >= 2 ? factories(g) : g.buildings.list.filter((b) => b.zone);
    const q = (g as any);
    q.cargoQ.length = 0;
    near.stock = 0;
    q.queueCargo({ t: g.time + 500, to: far.id, cargo: "materials" });
    q.queueCargo({ t: g.time + 5, to: near.id, cargo: "materials" });
    q.ordered.set(near.id, 1);
    for (let i = 0; i < 10 * 30; i++) g.step(1 / 30);
    expect(near.stock).toBeGreaterThan(0);
    expect(q.cargoQ.length).toBe(1);
  });

  it("goods and materials on their way still arrive after a save and load", () => {
    const g = new Game(7);
    town(g, 1800);
    bigCity(g);
    g.money = 1e6;
    for (let i = 0; i < 20 * HOUR * 30 && !(g as any).cargoQ.length; i++) g.step(1 / 30);
    const before = (g as any).cargoQ.length as number;
    expect(before).toBeGreaterThan(0);
    const l = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect((l as any).cargoQ.length).toBe(before);
    expect([...(l as any).ordered.values()].reduce((a: number, x: number) => a + x, 0)).toBeGreaterThanOrEqual(before);
  });
});
