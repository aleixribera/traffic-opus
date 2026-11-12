// The tips under the goals check the live map before they show (owner, 2026-11-08: "they are annoying, and sometimes
// wrong for the current state of the map"): each stays away once its step is done or no longer applies, names a town
// only when that town needs it, and the player can dismiss each or turn them all off, kept per browser.

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { v2, type V2 } from "../src/core/math";
import { DAY } from "../src/game/society";
import type { PlacedKind } from "../src/game/placed";
import { DEPOSIT_GOALS, TipPrefs, cutOff, joinedUp, soilInReach, tipFor, wants, type TipId } from "../src/ui/tips";
import { MILESTONES } from "../src/game/progression";
import { planRoad, snap } from "../src/roads/planner";
import { road } from "./helpers";
import { nextTown } from "../src/ui/nextTown";
import { distFrom, distText } from "../src/ui/distance";
import { PLANTS } from "../src/game/industry";

function started(seed = 7) {
  const g = new Game(seed);
  g.start();
  return { g, home: g.towns.list[0] };
}

/** Place a site of `kind` somewhere it can go and a road reaches (its gate on one, or a street laid to one), nearest the home town first. */
function placeNear(g: Game, kind: PlacedKind, c: V2) {
  for (let r = 150; r < 3000; r += 100) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const p = v2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      const pl = g.placedPlan(kind, p);
      if (!pl?.ok || !(pl.access || pl.link)) continue;
      const b = g.place(kind, p);
      if (b) return b;
    }
  }
  throw new Error(`nowhere to place a ${kind}`);
}

/** A storage that is a plain map (what localStorage keeps). */
function memStore() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("tips follow the map", () => {
  it("a new company is asked for a farm, worded for whether fertile soil already lies by its roads", () => {
    const { g } = started();
    const t = tipFor(g)!;
    expect(t.id).toBe("farm");
    if (soilInReach(g)) {
      expect(t.cat).toBe("industry");
      expect(t.html).not.toMatch(/lay a road/i);
    } else {
      expect(t.cat).toBe("roads");
      expect(t.html).toMatch(/lay a road/i);
    }
  });

  it("the soil check follows the roads: none with no roads at all, and it looks again when the roads change", () => {
    const g = new Game(7);
    expect(g.net.segs.size).toBe(0);
    expect(soilInReach(g)).toBe(false);
    // a street out across fertile ground
    let at: V2 | null = null;
    for (let r = 200; r < 6000 && !at; r += 150) for (let k = 0; k < 16 && !at; k++) {
      const a = (k / 16) * Math.PI * 2;
      const p = v2(Math.cos(a) * r, Math.sin(a) * r);
      if (g.placedPlan("farm", p)?.ok) at = p;
    }
    expect(at).toBeTruthy();
    road(g, v2(at!.x - 150, at!.y), v2(at!.x + 150, at!.y));
    expect(soilInReach(g)).toBe(true);
    const t = tipFor(g)!;
    expect(t.id).toBe("farm");
    expect(t.html).not.toMatch(/lay a road/i);
  });

  it("names the town only when it wants food", () => {
    const { g, home } = started();
    home.supply.food = 0;
    expect(wants(home, "food")).toBe(true);
    expect(tipFor(g)!.html).toContain(home.name);
    home.supply.food = 1;
    expect(wants(home, "food")).toBe(false);
    expect(tipFor(g)!.id).toBe("farm");
    expect(tipFor(g)!.html).not.toContain(home.name);
  });

  it("never asks for a farm once one is placed, nor for a food plant once that is", () => {
    const { g, home } = started();
    placeNear(g, "farm", home.c);
    expect(tipFor(g)?.id).not.toBe("farm");
    expect(tipFor(g)?.id).toBe("foodplant");
    placeNear(g, "foodplant", home.c);
    const ids: (TipId | undefined)[] = [tipFor(g)?.id];
    expect(ids).not.toContain("farm");
    expect(ids).not.toContain("foodplant");
  });

  it("a farm placed out of its gate street's reach asks for a road to it; one placed in reach does not", () => {
    const a = started();
    expect(cutOff(a.g, placeNear(a.g, "farm", a.home.c))).toBe(false);
    expect(tipFor(a.g)?.id).toBe("foodplant");
    const { g, home } = started();
    let far: ReturnType<Game["place"]> = null;
    for (let r = 900; r < 4000 && !far; r += 150) for (let k = 0; k < 24 && !far; k++) {
      const q = (k / 24) * Math.PI * 2;
      const p = v2(home.c.x + Math.cos(q) * r, home.c.y + Math.sin(q) * r);
      const pl = g.placedPlan("farm", p);
      if (pl?.ok && !pl.access && !pl.link) far = g.place("farm", p);
    }
    expect(far).toBeTruthy();
    expect(cutOff(g, far!)).toBe(true);
    const t = tipFor(g)!;
    expect(t.id).toBe("noroad");
    expect(t.html).toMatch(/your farm/);
  });
  it("asks for planks only before a sawmill, naming the town that will want them", () => {
    const { g, home } = started();
    placeNear(g, "farm", home.c);
    placeNear(g, "foodplant", home.c);
    home.pop = 40;
    expect(tipFor(g)?.id).not.toBe("planks");
    home.pop = 90;
    // (not while the first load of food has still to land: one chain at a time. Owner, 2026-11-10)
    expect(tipFor(g)?.id).not.toBe("planks");
    g.progress.sold.food = 1;
    const t = tipFor(g)!;
    expect(t.id).toBe("planks");
    expect(t.html).toContain(home.name);
    expect(t.html).toMatch(/will want planks/);
    home.pop = 120;
    expect(tipFor(g)!.html).toMatch(/wants planks now/);
    placeNear(g, "sawmill", home.c);
    expect(tipFor(g)?.id).not.toBe("planks");
  });

  it("a goal's new mines: the power plant first, then where each deposit lies, and nothing once the goals are old or all reached (owner, 2026-11-10)", () => {
    const { g } = started();
    const upTo = (id: string) => MILESTONES.slice(0, MILESTONES.findIndex((m) => m.id === id) + 1).map((m) => m.id);
    const only = (...ids: TipId[]) => tipFor(g, (id) => !ids.includes(id));
    // Village just reached: the power plant comes before the mines it runs, as the goal's banner says
    g.progress.done = upTo("village");
    expect(g.placedUnlocked("coalplant")).toBe(true);
    const first = only("power", "deposits")!;
    expect(first.id).toBe("power");
    expect(first.html).toMatch(/^<b>Build a Power plant first\.<\/b>/);
    // with that one out of the way (dismissed, or built): the coal mine's ground, the first of the mines to build
    const dep = only("deposits")!;
    expect(dep.html).toMatch(/^<b>The coal mine goes on /);
    // where it lies, by the same measure as the pointer to it ("3.8 km from a road", review 2026-11-12, C5)
    const near = g.terrain.gen.depositsNear(PLANTS.coalmine.deposit!.field, g.towns.list[0].c.x, g.towns.list[0].c.y, 24000)[0];
    expect(dep.html).toContain(`The nearest lies ${distText(distFrom(g, near)!.m)} `);
    // two goals on, those mines are old news: the tip does not nag about them
    const i = MILESTONES.findIndex((m) => m.id === "village");
    g.progress.done = [...upTo("village"), ...MILESTONES.slice(i + 1, i + 1 + DEPOSIT_GOALS).map((m) => m.id)];
    expect(only("deposits")?.html ?? "").not.toMatch(/coal mine/);
    expect(only("power")).toBeNull();
    // every goal reached: no deposit tip at all (it asked for an oil well at 20 of 20)
    g.progress.done = MILESTONES.map((m) => m.id);
    expect(only("deposits")).toBeNull();
    expect(only("power")).toBeNull();
  });

  it("points out a town that sprang up with no road to it, and drops it once a road joins it", () => {
    const { g, home } = started();
    home.pop = 160;
    g.checkMilestones();
    const t = g.towns.list.find((x) => x.spawned)!;
    expect(t).toBeTruthy();
    expect(joinedUp(g, t)).toBe(false);
    // (with the earlier steps out of the way)
    const skip = (id: TipId) => id !== "newtown";
    // in its first game day its card and the pointer to it say where it is: the tip is the reminder after that (C7)
    expect(tipFor(g, skip)).toBeNull();
    t.founded -= DAY;
    const tip = tipFor(g, skip)!;
    expect(tip.id).toBe("newtown");
    expect(tip.html).toContain(t.name);
    expect(tip.html).toContain(home.name);
    // a street from one of its own out a little: now it is on a road beyond its own streets (from the first of its
    // street ends with room to lay one: the town's own plan, gardens and greens fill some of them)
    let built = false;
    for (const s of [...g.net.segs.values()].filter((x) => x.town === t.id)) {
      for (const [ea, eb] of [[s.a, s.b], [s.b, s.a]]) {
        const end = g.net.nodes.get(eb)!.p, from = g.net.nodes.get(ea)!.p;
        const L = Math.hypot(end.x - from.x, end.y - from.y);
        for (const side of [1, -1]) for (const len of [120, 80, 160]) {
          if (built) break;
          const out = v2(end.x + side * ((end.y - from.y) / L) * len, end.y - side * ((end.x - from.x) / L) * len);
          const plan = planRoad(g.net, g.world, { start: snap(g.net, end, { mpp: 0.5, level: 0, type: "street" }), end: { p: out, h: 0, guides: [] }, mode: "straight", type: "street" });
          if (!plan.errors.length && g.build(plan)) built = true;
        }
        if (built) break;
      }
      if (built) break;
    }
    expect(built).toBe(true);
    // (a stub of road out of it is no road to it: nothing a load could come from is on it)
    expect(joinedUp(g, t)).toBe(false);
    expect(tipFor(g, skip)?.id).toBe("newtown");
    // nor is a logging camp at its edge; a food plant on its roads is
    placeNear(g, "loggingcamp", t.c);
    expect(joinedUp(g, t)).toBe(false);
    placeNear(g, "foodplant", t.c);
    expect(joinedUp(g, t)).toBe(true);
    expect(tipFor(g, skip)).toBeNull();
  });

  it("a dismissed tip stays away, and the next one that applies shows instead", () => {
    const { g } = started();
    expect(tipFor(g)!.id).toBe("farm");
    const prefs = new TipPrefs(memStore());
    prefs.dismiss("farm");
    expect(tipFor(g, (id) => prefs.dismissed.has(id))?.id).not.toBe("farm");
  });
});

describe("tip settings, kept per browser", () => {
  it("remembers dismissals and tips off under flowtown.* keys, and turning them on again brings them all back", () => {
    const s = memStore();
    const a = new TipPrefs(s);
    expect(a.off).toBe(false);
    a.dismiss("farm");
    a.dismiss("power");
    a.setOff(true);
    expect([...s.m.keys()].every((k) => k.startsWith("flowtown."))).toBe(true);
    const b = new TipPrefs(s);
    expect(b.off).toBe(true);
    expect([...b.dismissed].sort()).toEqual(["farm", "power"]);
    b.setOff(false);
    b.reset();
    const c = new TipPrefs(s);
    expect(c.off).toBe(false);
    expect(c.dismissed.size).toBe(0);
  });

  it("works with no storage, or storage that throws", () => {
    const none = new TipPrefs(null);
    none.dismiss("farm");
    none.setOff(true);
    expect(none.off).toBe(true);
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    const p = new TipPrefs(bad);
    expect(p.off).toBe(false);
    p.dismiss("farm");
    p.setOff(true);
    expect(p.dismissed.has("farm")).toBe(true);
  });
});

describe("the next town", () => {
  it("names the goal that brings it and how far along that is, and how many goals lie before it opens", () => {
    const { g, home } = started();
    home.pop = 36;
    const a = nextTown(g)!;
    expect(a.m.id).toBe("hamlet150");
    expect([a.have, a.need, a.before]).toEqual([36, 150, 0]);
    home.pop = 160;
    g.checkMilestones();
    const b = nextTown(g)!;
    expect(b.m.id).not.toBe("hamlet150");
    expect(b.m.unlocks.towns).toBeGreaterThan(0);
    // the next one with towns comes after goals still to reach: open now only if it is among the first three left
    expect(b.before).toBeGreaterThanOrEqual(0);
    expect(g.progress.open().some((m) => m.id === b.m.id)).toBe(b.before === 0);
  });
});