import { describe, expect, it } from "vitest";
import { BASE, MILESTONES, OPEN_AT_ONCE, Progress, unlockedBy, unlocksOf, type ProgressView } from "../src/game/progression";
import { PLANTS, type PlantKind } from "../src/game/industry";
import { Game } from "../src/game/city";

const view = (o: Partial<ProgressView> = {}): ProgressView => ({ towns: [], made: {}, sold: {}, bestDay: {}, bestEarned: 0, powered: 0, ...o });

describe("Milestones", () => {
  it("are a ladder of tiers 1 to 3: unique, each with a goal and something concrete to unlock or a grant", () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(28);
    expect(MILESTONES.length).toBeLessThanOrEqual(40);
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
    for (const m of MILESTONES) {
      expect(m.goal.length).toBeGreaterThan(5);
      const u = m.unlocks;
      const n = (u.roads?.length ?? 0) + (u.features?.length ?? 0) + (u.buildings?.length ?? 0) + (u.towns ?? 0) + (u.bays ?? 0) + (u.load ?? 0) + (u.grant ? 1 : 0);
      expect(n, m.id).toBeGreaterThan(0);
    }
  });

  it("every tier 2 and 3 building unlocks with a milestone, tier 1 from the start", () => {
    const start = unlocksOf([]);
    for (const k of Object.keys(PLANTS) as PlantKind[]) {
      if (PLANTS[k].tier === 1) expect(start.buildings.has(k), k).toBe(true);
      else {
        expect(start.buildings.has(k), k).toBe(false);
        expect(unlockedBy((u) => u.buildings?.includes(k)), k).toBeDefined();
      }
    }
    const all = unlocksOf(MILESTONES.map((m) => m.id));
    expect(all.buildings.size).toBe(Object.keys(PLANTS).length);
    expect(all.bays).toBeGreaterThan(0);
    expect(all.load).toBe(4);
  });

  it("tier 3 opens on the way to Town size: oil first, then glass and goods, then construction parts", () => {
    const at = (id: string) => MILESTONES.findIndex((m) => m.id === id);
    const by = (k: PlantKind) => unlockedBy((u) => u.buildings?.includes(k))!.id;
    expect(by("oilwell")).toBe("pop1000");
    expect(by("refinery")).toBe("pop1000");
    for (const k of ["sandpit", "glassworks", "furniture"] as PlantKind[]) expect(by(k)).toBe("planks30");
    expect(by("constructionplant")).toBe("cement30");
    // every tier 3 plant is unlocked before the Town milestone, and its first-load milestones come after its unlock
    for (const k of ["oilwell", "sandpit", "refinery", "glassworks", "furniture", "constructionplant"] as PlantKind[]) {
      expect(PLANTS[k].tier, k).toBe(3);
      expect(at(by(k)), k).toBeLessThan(at("town"));
    }
    expect(at("fuel1")).toBeGreaterThan(at("pop1000"));
    expect(at("goods1")).toBeGreaterThan(at("planks30"));
    expect(at("parts1")).toBeGreaterThan(at("cement30"));
    expect(at("city")).toBe(MILESTONES.length - 1);
  });

  it("tier 3 milestones measure fuel, goods and parts, and a Town supplied in everything", () => {
    const m = (id: string) => MILESTONES.find((x) => x.id === id)!;
    expect(m("fuel1").measure(view({ made: { fuel: 1 } }))).toEqual([1, 1]);
    expect(m("goods30").measure(view({ bestDay: { goods: 12 } }))).toEqual([12, 30]);
    expect(m("parts20").measure(view({ sold: { parts: 7 } }))).toEqual([7, 20]);
    const sup = m("townSupplied");
    const all = { food: 1, planks: 1, cement: 1 };
    // a village fully supplied doesn't count; a Town needs its goods and fuel too
    expect(sup.measure(view({ towns: [{ pop: 1200, supply: all }] }))[0]).toBe(0);
    expect(sup.measure(view({ towns: [{ pop: 1600, supply: all }] }))[0]).toBe(0);
    expect(sup.measure(view({ towns: [{ pop: 1600, supply: { ...all, goods: 0.9, fuel: 0.85 } }] }))[0]).toBe(1);
    expect(m("towns2town").measure(view({ towns: [{ pop: 1600, supply: {} }, { pop: 1500, supply: {} }, { pop: 900, supply: {} }] }))).toEqual([2, 2]);
  });

  it("a few are open at once, in ladder order; reaching one opens the next", () => {
    const p = new Progress();
    expect(p.open().map((m) => m.id)).toEqual(MILESTONES.slice(0, OPEN_AT_ONCE).map((m) => m.id));
    // the third open one is met: it is reached, and the fourth opens
    const third = MILESTONES[2];
    expect(third.id).toBe("village");
    const got = p.check(view({ towns: [{ pop: 310, supply: {} }] }));
    expect(got.map((m) => m.id)).toEqual(["village"]);
    expect(p.open().map((m) => m.id)).toEqual([MILESTONES[0].id, MILESTONES[1].id, MILESTONES[3].id]);
    // a goal further up the ladder doesn't count until it is open
    expect(p.check(view({ made: { steel: 5 } }))).toEqual([]);
  });

  it("reaching one can open another that is met already: they come in order", () => {
    const p = new Progress();
    const v = view({ sold: { food: 10 }, towns: [{ pop: 320, supply: {} }, { pop: 10, supply: {} }], made: { planks: 12 } });
    expect(p.check(v).map((m) => m.id)).toEqual(["food10", "town2", "village", "planks10"]);
  });

  it("a village big enough to want cement can still meet the milestone that unlocks cement", () => {
    const sup = MILESTONES.find((m) => m.id === "supplied")!;
    expect(sup.unlocks.buildings).toContain("cementworks");
    const v = (cement: number) => view({ towns: [{ pop: 700, supply: { food: 0.9, planks: 0.85, cement } }] });
    expect(sup.measure(v(0))).toEqual([1, 1]);
    expect(sup.measure(view({ towns: [{ pop: 700, supply: { food: 0.9, planks: 0.2 } }] }))).toEqual([0, 1]);
    // the later milestone that asks for every need does want the cement
    const sup2 = MILESTONES.find((m) => m.id === "supplied2")!;
    expect(sup2.measure(view({ towns: [{ pop: 700, supply: { food: 1, planks: 1 } }, { pop: 700, supply: { food: 1, planks: 1 } }] }))[0]).toBe(0);
  });

  it("counts today toward the best day, and keeps the best day", () => {
    const p = new Progress();
    p.onSold("food", 12);
    expect(p.view([], 0).bestDay.food).toBe(12);
    p.daily();
    p.onSold("food", 5);
    expect(p.view([], 0).bestDay.food).toBe(12);
    p.onEarned(900);
    expect(p.view([], 0).bestEarned).toBe(900);
    expect(p.sold.food).toBe(17);
  });

  it("saves and loads", () => {
    const p = new Progress();
    p.onMade("steel", 3);
    p.onSold("food", 10);
    p.check(p.view([], 0));
    const q = new Progress();
    q.load(JSON.parse(JSON.stringify(p.toJSON())));
    expect(q.done).toEqual(["food10"]);
    expect(q.made.steel).toBe(3);
    expect(q.unlocked.roads.has("avenue")).toBe(true);
    const g = new Game(7);
    g.progress.load(p.toJSON());
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(h.progress.done).toEqual(["food10"]);
  });

  it("the company may run as many towns as its milestones allow", () => {
    const g = new Game(7);
    g.start();
    expect(g.townSlots).toBe(BASE.towns);
    g.money = 1e7;
    // fill the slots, then the next town is refused with the reason
    const spots = [];
    for (let r = 1500; r < 6000 && spots.length < 3; r += 150) for (let k = 0; k < 16 && spots.length < 3; k++) {
      const a = (k / 16) * Math.PI * 2;
      const q = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      if (!g.towns.foundBlock(q)) { const t = g.towns.found(q); if (typeof t !== "string") spots.push(t); }
    }
    expect(g.towns.list.length).toBe(BASE.towns);
    expect(spots.length).toBe(BASE.towns - 1);
    const q = { x: -4000, y: 2500 };
    expect(g.towns.foundBlock(q)).toMatch(/^You can run 2 towns for now/);
  });
});
