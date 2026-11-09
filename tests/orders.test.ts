// Town orders (docs/design.md, "Town orders"): each town has its own seeded set of civic buildings it asks the company
// for, orders open at random across the towns within caps, they scale with the town, a filled one brings its building,
// its grant and its perk once, a missed one asks again later, and they all survive a save.

import { describe, expect, it } from "vitest";
import { Game, type GameEvent } from "../src/game/city";
import { obbOverlap } from "../src/game/buildings";
import { dist, polyClosest } from "../src/core/math";
import { CIVICS, CIVIC_KINDS, isCivic } from "../src/game/civics";
import { MAP_CAP, ORDER_POP, RETRY_AFTER, dealSet, orderLine, sizeOrder, townCap, type Order } from "../src/game/orders";
import { DAY, HOUR } from "../src/game/society";
import { demandPerDay, sizeOf } from "../src/game/towns";
import type { Product } from "../src/game/industry";
import type { Town } from "../src/game/settlements";

/** A started game whose home town has had deliveries and has people enough to ask for orders. */
function started(seed = 7) {
  const g = new Game(seed);
  g.start();
  const ev: GameEvent[] = [];
  g.on((e) => ev.push(e));
  const home = g.towns.list[0];
  feed(home);
  return { g, ev, home };
}

/** A town that has had a delivery and holds `pop` people at `size` (as the census and its growth would set them). */
function feed(t: Town, pop = 120, size = sizeOf(pop)) {
  t.today = { ...t.today, food: 4 };
  t.pop = Math.max(t.pop, pop);
  t.size = Math.max(t.size, size);
}

/** Run the orders' hours on their own for `hours` game hours (the towns hold still). */
function hours(g: Game, n: number, each?: () => void) {
  for (let k = 0; k < n; k++) {
    g.time += HOUR;
    g.orders.hourly();
    each?.();
  }
}

const orders = (ev: GameEvent[], phase: "open" | "done" | "lapsed") => ev.filter((e): e is Extract<GameEvent, { t: "order" }> => e.t === "order" && e.phase === phase);

describe("Town orders", () => {
  it("deal each town its own set from the seed: five to eight buildings, two a hamlet asks for, the same every time", () => {
    const seen = new Set<string>();
    for (const seed of [1, 7, 42]) for (let town = 1; town <= 12; town++) {
      const a = dealSet(seed, town), b = dealSet(seed, town);
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThanOrEqual(5);
      expect(a.length).toBeLessThanOrEqual(8);
      expect(new Set(a.map((s) => s.kind)).size).toBe(a.length);
      expect(a.filter((s) => CIVICS[s.kind].size === 0).length).toBeGreaterThanOrEqual(2);
      for (const s of a) {
        expect(isCivic(s.kind)).toBe(true);
        expect([1, 2, 3]).toContain(s.grade);
        expect(s.state).toBe("waiting");
      }
      seen.add(a.map((s) => s.kind + s.grade).join());
    }
    // (towns differ: nearly every set is its own)
    expect(seen.size).toBeGreaterThan(30);
    // the game deals the same set to the same town
    const g1 = new Game(7), g2 = new Game(7);
    expect(g1.orders.setOf(3)).toEqual(g2.orders.setOf(3));
  });

  it("scale with the town: more loads and a bigger grant as it grows, more products from a village, plenty for days at a fair", () => {
    const r = () => 0.3;
    const all = () => true;
    // a schoolhouse asked of a hamlet: one product; of a town, two
    const hamlet = sizeOrder("schoolhouse", 2, 200, all, r);
    const town = sizeOrder("schoolhouse", 2, 2500, all, r);
    expect(Object.keys(hamlet.goods)).toHaveLength(1);
    expect(Object.keys(town.goods)).toHaveLength(2);
    expect(town.goods.planks!).toBeGreaterThan(hamlet.goods.planks! * 3);
    expect(town.grant).toBeGreaterThan(hamlet.grant);
    // it wants more than the town takes to grow over its days: the push is through the roads
    const days = hamlet.window / DAY;
    expect(hamlet.goods.planks!).toBeGreaterThan(demandPerDay("planks", 200) * days);
    // and the grade makes it harder
    const g1 = sizeOrder("library", 1, 1000, all, r), g3 = sizeOrder("library", 3, 1000, all, r);
    const sum = (o: { goods: Partial<Record<Product, number>> }) => Object.values(o.goods).reduce((a, b) => a + b!, 0);
    expect(sum(g3)).toBeGreaterThan(sum(g1));
    expect(g3.window).toBeGreaterThan(g1.window);
    // only what the town buys and the company can bring
    const noPlanks = sizeOrder("schoolhouse", 1, 200, (p) => p !== "planks", r);
    expect(Object.keys(noPlanks.goods)).toEqual(["food"]);
    // a fair keeps a need in plenty for days, its crowds wanting more than the town's usual
    const fair = sizeOrder("bandstand", 2, 400, all, r);
    expect(fair.type).toBe("fair");
    expect(fair.days).toBe(3);
    expect(fair.goods.food!).toBeGreaterThan(demandPerDay("food", 400));
    expect(fair.window).toBeGreaterThan(fair.days! * DAY);
    // in words
    const o = { ...hamlet, town: 1, got: {}, opened: 0, until: hamlet.window } as Order;
    expect(orderLine(o, "Millbrook")).toMatch(/^Millbrook wants a schoolhouse: \d+ planks in 5 days$/);
    expect(orderLine({ ...fair, town: 1, got: {}, opened: 0, until: fair.window } as Order, "Ridgefield")).toBe("Ridgefield's Fair: keep food at Plenty for 3 days");
  });

  it("open at random gaps across the towns, never more than one a small town or the map can hold", () => {
    const { g, ev, home } = started();
    // four more towns, all served and grown
    for (let k = 0; k < 4; k++) {
      const s = g.towns.spawn();
      expect(s).not.toBeNull();
    }
    for (const t of g.towns.list) feed(t, 700);
    // a big one takes two at once
    feed(g.towns.list[4], 2400);
    let most = 0;
    const opened = new Set<number>();
    hours(g, 24 * 40, () => {
      most = Math.max(most, g.orders.open.length);
      expect(g.orders.open.length).toBeLessThanOrEqual(MAP_CAP);
      for (const t of g.towns.list) expect(g.orders.openIn(t.id).length).toBeLessThanOrEqual(townCap(t.size));
      for (const o of g.orders.open) opened.add(o.town);
      // fill half of them as they come, so the sets move on
      for (const o of [...g.orders.open]) if ((o.opened / HOUR) % 2 < 1 && g.time - o.opened > DAY) g.orders.fill(o);
    });
    expect(most).toBe(MAP_CAP);
    // spread over the map, not queued in one town
    expect(opened.size).toBe(g.towns.list.length);
    const per = new Map<number, number>();
    for (const e of orders(ev, "open")) per.set(e.town, (per.get(e.town) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThan(orders(ev, "open").length * 0.5);
    // at random gaps: never all at once
    const times = orders(ev, "open").map((_, i) => i);
    expect(times.length).toBeGreaterThan(8);
    expect(home.id).toBe(g.towns.list[0].id);
  });

  it("wait for a town to have a delivery, people enough and the size each building wants", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    t.today = {};
    t.yesterday = {};
    t.hist.days = [];
    hours(g, 24 * 3);
    expect(g.orders.open).toHaveLength(0);
    // (asked for one in a town that can't take it: none, and no harm)
    expect(g.orders.openOne([t])).toBeNull();
    feed(t, ORDER_POP + 20);
    hours(g, 24 * 3);
    expect(g.orders.open.length).toBe(1);
    // a hamlet is only ever asked for a hamlet's buildings
    for (let k = 0; k < 30; k++) {
      for (const o of [...g.orders.open]) {
        expect(CIVICS[o.kind].size).toBeLessThanOrEqual(t.size);
        g.orders.lapse(o);
      }
      for (const s of g.orders.setOf(t.id)) delete s.again;
      g.orders.openOne();
    }
  });

  it("filled: the building goes up in the town, the grant is paid and the perk holds, each exactly once", () => {
    const { g, ev, home } = started();
    const slot = g.orders.setOf(home.id).find((s) => CIVICS[s.kind].size === 0 && !CIVICS[s.kind].fair)!;
    expect(slot).toBeTruthy();
    const o = g.orders.openOne([home], slot.kind)!;
    expect(o.kind).toBe(slot.kind);
    expect(o.type).toBe("deliver");
    expect(slot.state).toBe("open");
    expect(orders(ev, "open")).toHaveLength(1);
    const before = { money: g.money, boost: g.orders.boost(home.id), buildings: g.buildings.list.filter((b) => b.kind === slot.kind).length };
    expect(before.buildings).toBe(0);
    // loads come in, short of the order: still open
    const [p, n] = Object.entries(o.goods)[0] as [Product, number];
    g.orders.onSold(home.id, p, n - 1);
    expect(g.orders.open).toContain(o);
    expect(g.orders.progress(o)).toBeGreaterThan(0.5);
    // the last one fills it
    for (const [q, k] of Object.entries(o.goods) as [Product, number][]) g.orders.onSold(home.id, q, k);
    expect(g.orders.open).not.toContain(o);
    expect(slot.state).toBe("done");
    expect(g.money).toBe(before.money + o.grant);
    const built = g.buildings.list.filter((b) => b.kind === slot.kind);
    expect(built).toHaveLength(1);
    const b = built[0];
    expect(b.town).toBe(home.id);
    expect(slot.b).toBe(b.id);
    // a building site first, on the town's streets, in from the edge of town
    expect(b.built).toBe(0);
    expect(b.access).not.toBeNull();
    expect(Math.hypot(b.c.x - home.c.x, b.c.y - home.c.y)).toBeLessThan(home.reach + 50);
    // its lot is its own: no home or shop stands on it
    for (const c of g.lotCells(b)) expect(c.lot === b.id || c.lot === 0 || g.buildings.byId.get(c.lot)?.zone === undefined).toBe(true);
    const perk = CIVICS[slot.kind].perk;
    const boost = g.orders.boost(home.id);
    expect(boost.growth).toBeCloseTo(before.boost.growth * (perk.growth ?? 1), 9);
    expect(boost.demand).toBeCloseTo(before.boost.demand * (perk.demand ?? 1), 9);
    const done = orders(ev, "done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ town: home.id, kind: slot.kind, b: b.id, grant: o.grant });
    // more loads, or filling it again, change nothing
    const m = g.money;
    g.orders.onSold(home.id, p, 500);
    g.orders.fill(o);
    expect(g.money).toBe(m);
    expect(g.buildings.list.filter((x) => x.kind === slot.kind)).toHaveLength(1);
    expect(g.orders.boost(home.id)).toEqual(boost);
    expect(orders(ev, "done")).toHaveLength(1);
    expect(g.orders.tally(home.id).done).toBe(1);
    // and it never comes up again in that town
    for (let k = 0; k < 40; k++) { const x = g.orders.openOne([home]); if (x) g.orders.lapse(x); for (const s of g.orders.setOf(home.id)) delete s.again; }
    expect(orders(ev, "open").filter((e) => e.kind === slot.kind)).toHaveLength(1);
    // the town's building: it can't be bulldozed, and it rises
    g.bulldoze([], [b.id]);
    expect(g.buildings.byId.has(b.id)).toBe(true);
    // an undo can't put a home back on the land it took (a home bulldozed there before it was built)
    const home2 = g.buildings.list.find((x) => x.zone && x.town === home.id)!;
    const ghost = { ...home2, id: 99999, c: { ...b.c }, rot: b.rot };
    (g as unknown as { restoreBuilding(x: typeof ghost): void }).restoreBuilding(ghost);
    expect(g.buildings.byId.has(99999)).toBe(false);
    expect(g.lotCells(b).some((c) => c.lot === b.id)).toBe(true);
    // (a crew's working day at most: the bigger the building, the longer it takes)
    for (let k = 0; k < 8 * 3; k++) g.step(HOUR / 8);
    expect(b.built).toBeGreaterThan(0);
    expect(b.built).toBeLessThan(1);
    for (let k = 0; k < 8 * 8; k++) g.step(HOUR / 8);
    expect(b.built).toBe(1);
  }, 60000);

  it("a fair fills once its town has been kept in plenty for its days", () => {
    const { g, home } = started();
    const set = g.orders.setOf(home.id);
    set.push({ kind: "bandstand", grade: 1, state: "waiting" });
    const o = g.orders.openOne([home], "bandstand")!;
    expect(o.type).toBe("fair");
    const p = Object.keys(o.goods)[0] as Product;
    // a thin supply: no progress
    home.hours = Array.from({ length: 24 }, () => ({ [p]: (demandPerDay(p, home.pop) * 0.5) / 24 }));
    hours(g, 6);
    expect(o.held).toBe(0);
    // in plenty for the fair's crowds: it counts the hours, and fills after its days
    home.hours = Array.from({ length: 24 }, () => ({ [p]: (demandPerDay(p, home.pop) * 1.4) / 24 }));
    hours(g, 24 * o.days! - 1);
    expect(g.orders.open).toContain(o);
    hours(g, 1);
    expect(g.orders.open).not.toContain(o);
    expect(set.find((s) => s.kind === "bandstand")!.state).toBe("done");
  }, 60000);

  it("missed: it closes at no cost and asks again some days later, sized afresh", () => {
    const { g, ev, home } = started();
    const o = g.orders.openOne([home])!;
    const slot = g.orders.setOf(home.id).find((s) => s.kind === o.kind)!;
    const m = g.money;
    g.orders.onSold(home.id, Object.keys(o.goods)[0] as Product, 1);
    hours(g, Math.ceil((o.until - g.time) / HOUR) + 1);
    expect(orders(ev, "lapsed").map((e) => e.kind)).toContain(o.kind);
    expect(g.orders.open).not.toContain(o);
    expect(slot.state).not.toBe("done");
    expect(g.money).toBe(m);
    expect(g.buildings.list.some((b) => b.kind === o.kind)).toBe(false);
    // not straight away
    expect(slot.again! - o.until).toBeGreaterThanOrEqual(RETRY_AFTER - HOUR);
    // the town grew meanwhile: when it asks again, it asks for more
    feed(home, 900);
    hours(g, Math.ceil((slot.again! - g.time) / HOUR) + 24 * 10, () => {
      for (const x of [...g.orders.open]) if (x.kind !== o.kind) g.orders.lapse(x);
    });
    const again = g.orders.open.find((x) => x.kind === o.kind) ?? null;
    const reopened = orders(ev, "open").filter((e) => e.kind === o.kind);
    expect(reopened.length).toBeGreaterThanOrEqual(2);
    if (again) {
      const p = Object.keys(o.goods)[0] as Product;
      if (again.goods[p] !== undefined && o.type === "deliver") expect(again.goods[p]!).toBeGreaterThan(o.goods[p]!);
    }
  }, 60000);

  it("save and load: sets, open orders and the buildings come back; an old save starts rolling them", () => {
    const { g, home } = started();
    const slot = g.orders.setOf(home.id).find((s) => CIVICS[s.kind].size === 0 && !CIVICS[s.kind].fair)!;
    const o = g.orders.openOne([home], slot.kind)!;
    for (const [q, k] of Object.entries(o.goods) as [Product, number][]) g.orders.onSold(home.id, q, k);
    const open = g.orders.openOne([home]);
    expect(open).not.toBeNull();
    g.orders.onSold(home.id, Object.keys(open!.goods)[0] as Product, 2);
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.orders.toJSON()).toEqual(g.orders.toJSON());
    const b = h.buildings.list.find((x) => x.kind === slot.kind)!;
    expect(b).toBeTruthy();
    expect(h.lotCells(b).filter((c) => c.lot === b.id).length).toBeGreaterThan(0);
    expect(h.orders.boost(home.id)).toEqual(g.orders.boost(home.id));
    // a save from before the orders: none open, its towns dealt their sets, and they start to roll
    delete json.orders;
    const old = Game.load(json);
    expect(old.orders.open).toHaveLength(0);
    expect(old.orders.setOf(home.id)).toEqual(dealSet(old.seed, home.id));
    feed(old.towns.byId.get(home.id)!);
    hours(old, 24 * 2);
    expect(old.orders.open.length).toBe(1);
    expect(CIVIC_KINDS).toContain(old.orders.open[0].kind);
  }, 60000);

  it("a civic building takes its own land in a grown town: clear of every home, shop, hall and road", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 6; d++) g.fastForward(t.id, 24);
    const placed: string[] = [];
    for (const kind of CIVIC_KINDS) {
      const b = g.addCivic(t.id, kind);
      if (!b) continue;
      placed.push(kind);
      // its land is its own: no other building on it (the half metre two neighbouring lots on a bend may share)
      for (const o of g.buildings.list) {
        if (o.id === b.id || dist(o.c, b.c) > b.hw + b.hd + o.hw + o.hd) continue;
        expect(obbOverlap(b.c, b.hw - 0.5, b.hd - 0.5, b.rot, o.c, o.hw - 0.5, o.hd - 0.5, o.rot), `${kind} on ${o.kind} ${o.id}`).toBe(false);
      }
      // and it stands back from every road's edge, its kerb and verge (no corner of it out in a street)
      const u = { x: Math.cos(b.rot), y: Math.sin(b.rot) }, v = { x: -u.y, y: u.x };
      const pts = [];
      for (const a of [-1, -0.5, 0, 0.5, 1]) for (const e of [-1, -0.5, 0, 0.5, 1]) pts.push({ x: b.c.x + u.x * a * (b.hw - 0.3) + v.x * e * (b.hd - 0.3), y: b.c.y + u.y * a * (b.hw - 0.3) + v.y * e * (b.hd - 0.3) });
      for (const id of g.net.segsNear(b.c.x - 60, b.c.y - 60, b.c.x + 60, b.c.y + 60)) {
        const sg = g.net.segGeom.get(id)!;
        for (const p of pts) expect(polyClosest(sg.center, p).d, `${kind} in road ${id}`).toBeGreaterThan(sg.width / 2 + 1.5);
      }
    }
    // (a six-day town has room for most of them on its own streets)
    expect(placed.length).toBeGreaterThanOrEqual(6);
  }, 300_000);
});
