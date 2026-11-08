// The tips under the goals check the live map before they show (owner, 2026-11-08: "they are annoying, and sometimes
// wrong for the current state of the map"): each stays away once its step is done or no longer applies, names a town
// only when that town needs it, and the player can dismiss each or turn them all off, kept per browser.

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { v2, type V2 } from "../src/core/math";
import type { PlacedKind } from "../src/game/placed";
import { TipPrefs, cutOff, joinedUp, soilInReach, tipFor, wants, type TipId } from "../src/ui/tips";
import { road } from "./helpers";
import { nextTown } from "../src/ui/nextTown";

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
    const t = tipFor(g)!;
    expect(t.id).toBe("planks");
    expect(t.html).toContain(home.name);
    expect(t.html).toMatch(/will want planks/);
    home.pop = 120;
    expect(tipFor(g)!.html).toMatch(/wants planks now/);
    placeNear(g, "sawmill", home.c);
    expect(tipFor(g)?.id).not.toBe("planks");
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
    const tip = tipFor(g, skip)!;
    expect(tip.id).toBe("newtown");
    expect(tip.html).toContain(t.name);
    expect(tip.html).toContain(home.name);
    // a street from one of its own out a little: now it is on a road beyond its own streets
    const s = [...g.net.segs.values()].find((x) => x.town === t.id)!;
    const end = g.net.nodes.get(s.b)!.p, from = g.net.nodes.get(s.a)!.p;
    const L = Math.hypot(end.x - from.x, end.y - from.y);
    const out = v2(end.x + ((end.y - from.y) / L) * 120, end.y - ((end.x - from.x) / L) * 120);
    road(g, end, out);
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