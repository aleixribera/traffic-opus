// A works' building site isn't held up by one jammed gate (tests/balance.test.ts, 2026-11-09: the steel chain's sites
// sat at 29 of 30 planks for days). A load for a site still in its yard, behind a gate whose first truck out can't
// find a gap, used to count as on its way: the other sawmills saw the site covered and sent their planks to the
// towns, and each time the held truck gave up at the gate its load went back into the same yard and was sent to the
// same site again. Now another plant whose trucks can get out sends it; the jammed plant doesn't pile more into its
// own queue; and a load that lands after the site is finished goes back to its yard.

import { describe, expect, it } from "vitest";
import type { Building } from "../src/game/buildings";
import { Industry, type IndustryHost, type PlantKind } from "../src/game/industry";
import type { PendingSpawn, Trip, Vehicle } from "../src/sim/traffic";

function world() {
  let time = 0;
  const pending: PendingSpawn[] = [];
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  /** trips whose yard's gate is jammed (the traffic sim's "gate" hold) */
  const jammed = new Set<number>();
  const host: IndustryHost = {
    get time() { return time; },
    buildings: { list, byId } as any,
    has: () => false,
    connected: () => true,
    workersAt: (id) => byId.get(id)!.cap,
    get shops() { return list.filter((b) => !b.plant); },
    townOf: (b) => b.town ?? null,
    // (a town that always wants planks: the buyer the planks went to instead)
    want: (_t, p) => (p === "planks" ? 10 : -Infinity),
    sold: () => {},
    request: (p) => { pending.push(p); },
    trips: () => pending.map((p) => p.trip),
    held: () => new Map(pending.filter((p) => jammed.has(p.trip.from)).map((p) => [p.trip, "gate" as const])),
    earn: () => {},
    spend: () => {},
    truckClass: () => "light",
  };
  const ind = new Industry(host);
  ind.trucksOf = () => 4;
  let id = 1;
  const make = (kind: string, x: number, town?: number): Building => {
    const b = { id: id++, kind, c: { x, y: 0 }, rot: 0, hw: 10, hd: 10, front: { x, y: 0 }, access: { seg: 1, t: 0.5 } as any, side: 1, level: 1, cap: 20, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0, ...(town !== undefined ? { town } : {}) } as Building;
    if (kind !== "shop") ind.init(b, kind as PlantKind);
    list.push(b);
    byId.set(b.id, b);
    return b;
  };
  const tick = () => { time += 5; ind.tick(5); };
  return { ind, make, pending, jammed, tick };
}

const toSite = (pending: PendingSpawn[], site: Building) => pending.filter((p) => p.trip.haul?.leg === "out" && p.trip.haul.dest === site.id);

describe("a works' building site and a jammed gate", () => {
  it("another plant sends the site's last load when the one bound there is stuck behind its own gate", () => {
    const w = world();
    const site = w.make("smelter", 4000);
    site.plant!.site = { need: { planks: 50 }, got: { planks: 49 } };
    const jammedMill = w.make("sawmill", 0), freeMill = w.make("sawmill", 300);
    w.make("shop", 500, 1);
    // the jammed sawmill sends the last load: it waits in its yard behind a gate it can't get out of
    jammedMill.plant!.out.planks = 1;
    w.tick();
    expect(toSite(w.pending, site)).toHaveLength(1);
    w.jammed.add(jammedMill.id);
    // the other sawmill has planks and trucks that get out: the site's last load goes from there, not to the town
    freeMill.plant!.out.planks = 1;
    w.tick();
    const sent = toSite(w.pending, site);
    expect(sent).toHaveLength(2);
    expect(sent[1].trip.from).toBe(freeMill.id);
  });

  it("the jammed plant doesn't queue another load for the same site behind its own gate", () => {
    const w = world();
    const site = w.make("ironmine", 4000);
    site.plant!.site = { need: { planks: 30 }, got: { planks: 29 } };
    const mill = w.make("sawmill", 0);
    w.make("shop", 500, 1);
    mill.plant!.out.planks = 1;
    w.tick();
    w.jammed.add(mill.id);
    mill.plant!.out.planks = 1;
    w.tick();
    expect(toSite(w.pending, site)).toHaveLength(1);
  });

  it("a load that lands after its site is finished goes back to its yard, not into the works' store", () => {
    const w = world();
    const site = w.make("smelter", 4000);
    site.plant!.site = { need: { planks: 50 }, got: { planks: 49 } };
    const a = w.make("sawmill", 0);
    a.plant!.out.planks = 1;
    w.tick();
    const p = toSite(w.pending, site)[0];
    // another plant's truck got there first: the site is finished
    w.ind.deliver(site, "planks", 1);
    expect(site.plant!.site).toBeUndefined();
    w.ind.onArrive({ trip: p.trip } as Vehicle);
    expect(site.plant!.stock.planks ?? 0).toBe(0);
    expect(a.plant!.out.planks).toBe(1);
    void (null as unknown as Trip);
  });
});
