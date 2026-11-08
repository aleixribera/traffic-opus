import { describe, expect, it } from "vitest";
import { BASE, FIRST_CAP, MILESTONES, OPEN_AT_ONCE, Progress, RETIRED, levelBy, levelCap, unlockedBy, unlocksOf, type ProgressView } from "../src/game/progression";
import { ROAD_TYPES, type RoadTypeId } from "../src/config";
import { TRUCK_CLASS_ORDER } from "../src/game/trucks";
import { SITE_LEVELS } from "../src/game/sites";
import { PLANTS, type PlantKind } from "../src/game/industry";
import { Game } from "../src/game/city";

const view = (o: Partial<ProgressView> = {}): ProgressView => ({ towns: [], made: {}, sold: {}, bestDay: {}, bestEarned: 0, powered: 0, ...o });

describe("Milestones", () => {
  it("are a short ladder of tiers 1 to 5: unique, each with a goal and something concrete to unlock or a grant", () => {
    // (trimmed 2026-11-08 to the real steps: town sizes, first loads, towns supplied, landmarks)
    expect(MILESTONES.length).toBeGreaterThanOrEqual(15);
    expect(MILESTONES.length).toBeLessThanOrEqual(20);
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
    for (const m of MILESTONES) {
      expect(m.goal.length).toBeGreaterThan(5);
      const u = m.unlocks;
      const n = (u.roads?.length ?? 0) + (u.features?.length ?? 0) + (u.buildings?.length ?? 0) + (u.towns ?? 0) + (u.levels ? 1 : 0) + (u.trucks?.length ?? 0) + (u.grant ? 1 : 0);
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
    // (every kind of site a milestone holds back is cleared to the top level by the end of the ladder)
    for (const k of Object.keys(PLANTS) as PlantKind[]) expect(levelCap(all, k, SITE_LEVELS), k).toBe(SITE_LEVELS);
  });

  it("milestones clear named kinds of site for their next level: no extra trucks or loads, the fleet comes with the level", () => {
    for (const m of MILESTONES) expect(Object.keys(m.unlocks).some((k) => k === "bays" || k === "load"), m.id).toBe(false);
    const start = unlocksOf([]);
    expect(levelCap(start, "sawmill", SITE_LEVELS)).toBe(FIRST_CAP);
    // (a kind no milestone names, a warehouse, grows to the top)
    expect(levelCap(start, "warehouse", SITE_LEVELS)).toBe(SITE_LEVELS);
    const goal = levelBy("sawmill", 3)!;
    expect(goal.unlocks.levels!.kinds).toContain("sawmill");
    const upTo = MILESTONES.slice(0, MILESTONES.indexOf(goal) + 1).map((m) => m.id);
    expect(levelCap(unlocksOf(upTo), "sawmill", SITE_LEVELS)).toBe(3);
    // a kind whose level 3 needs the chemical works' supplies (a farm: fertilizer) is never cleared for it by a goal
    // the player can't yet use: the supplies are its gate, and goals name only its level 4
    for (const m of MILESTONES) for (const k of m.unlocks.levels?.kinds ?? []) if (PLANTS[k].supplies) expect(m.unlocks.levels!.to, `${m.id} ${k}`).toBe(SITE_LEVELS);
    expect(levelCap(start, "farm", SITE_LEVELS)).toBe(3);
    // every capped kind has a goal for each level past the first cap, after the one that unlocks it
    for (const k of Object.keys(PLANTS) as PlantKind[]) {
      if (levelCap(start, k, SITE_LEVELS) === SITE_LEVELS) continue;
      const open = MILESTONES.findIndex((m) => m.unlocks.buildings?.includes(k));
      for (let L = FIRST_CAP + 1; L <= SITE_LEVELS; L++) {
        const by = levelBy(k, L);
        expect(by, `${k} ${L}`).toBeDefined();
        expect(MILESTONES.indexOf(by!), `${k} ${L}`).toBeGreaterThanOrEqual(open);
      }
    }
  });

  it("a site at its kind's cap is told which goal clears the next level", () => {
    const g = new Game(7);
    const h = (g.industry as unknown as { h: { levelCap(k: PlantKind, at: number): { level: number; goal?: string } } }).h;
    expect(h.levelCap("sawmill", FIRST_CAP)).toEqual({ level: FIRST_CAP, goal: levelBy("sawmill", FIRST_CAP + 1)!.name });
    // (a sawmill an older save left at level 3 waits for level 4's goal, not the one it already passed)
    expect(h.levelCap("sawmill", 3)).toEqual({ level: FIRST_CAP, goal: levelBy("sawmill", 4)!.name });
    g.progress.done = MILESTONES.map((m) => m.id);
    expect(h.levelCap("sawmill", SITE_LEVELS)).toEqual({ level: SITE_LEVELS, goal: undefined });
  });

  it("tier 3 opens on the way to Town size: oil, sand, glass and goods together, then construction parts", () => {
    const at = (id: string) => MILESTONES.findIndex((m) => m.id === id);
    const by = (k: PlantKind) => unlockedBy((u) => u.buildings?.includes(k))!.id;
    for (const k of ["oilwell", "refinery", "sandpit", "glassworks", "furniture"] as PlantKind[]) expect(by(k), k).toBe("pop1000");
    expect(by("constructionplant")).toBe("goods1");
    // every tier 3 plant is unlocked before the Town milestone, and its first-load milestones come after its unlock
    for (const k of ["oilwell", "sandpit", "refinery", "glassworks", "furniture", "constructionplant"] as PlantKind[]) {
      expect(PLANTS[k].tier, k).toBe(3);
      expect(at(by(k)), k).toBeLessThan(at("town"));
    }
    expect(at("fuel1")).toBeGreaterThan(at("pop1000"));
    expect(at("goods1")).toBeGreaterThan(at("pop1000"));
  });

  it("tier 4 opens whole on the way to a City; the City, its first machinery and a City supplied follow, then the landmarks and tier 5", () => {
    const at = (id: string) => MILESTONES.findIndex((m) => m.id === id);
    const by = (k: PlantKind) => unlockedBy((u) => u.buildings?.includes(k))!.id;
    for (const k of ["coppermine", "coppersmelter", "electronics", "machineworks"] as PlantKind[]) {
      expect(by(k), k).toBe("pop4000");
      expect(PLANTS[k].tier, k).toBe(4);
      expect(at(by(k)), k).toBeLessThan(at("city"));
      // after every tier 3 unlock
      expect(at(by(k)), k).toBeGreaterThan(at(by("constructionplant")));
    }
    for (const id of ["machinery1", "citySupplied"]) expect(at(id), id).toBeGreaterThan(at("city"));
    // then the convoys and landmarks, straight after tier 4, and only then tier 5 (the Motor Works, with the fair)
    expect([at("citySupplied"), at("bigiron"), at("worldsfair"), at("cars1")]).toEqual([0, 1, 2, 3].map((i) => at("citySupplied") + i));
    for (const k of ["hydrodam", "skylinetower"] as PlantKind[]) expect(by(k), k).toBe("bigiron");
    for (const k of ["exposition", "rubberplant", "motorworks"] as PlantKind[]) expect(by(k), k).toBe("worldsfair");
  });

  it("tier 4 milestones measure machinery, and a City supplied in everything", () => {
    const m = (id: string) => MILESTONES.find((x) => x.id === id)!;
    expect(m("machinery1").measure(view({ made: { machinery: 2 } }))).toEqual([2, 1]);
    const sup = m("citySupplied");
    const town = { food: 1, planks: 1, cement: 1, goods: 1, fuel: 1 };
    expect(sup.measure(view({ towns: [{ pop: 5000, supply: town }] }))[0]).toBe(0);
    expect(sup.measure(view({ towns: [{ pop: 6500, supply: town }] }))[0]).toBe(0);
    expect(sup.measure(view({ towns: [{ pop: 6500, supply: { ...town, electronics: 0.9, machinery: 0.8 } }] }))[0]).toBe(1);
  });

  it("tier 3 milestones measure fuel, goods and parts, and a Town supplied in everything", () => {
    const m = (id: string) => MILESTONES.find((x) => x.id === id)!;
    expect(m("fuel1").measure(view({ made: { fuel: 1 } }))).toEqual([1, 1]);
    expect(m("goods1").measure(view({ made: { goods: 3 } }))).toEqual([3, 1]);
    const sup = m("townSupplied");
    const all = { food: 1, planks: 1, cement: 1 };
    // a village fully supplied doesn't count; a Town needs its goods and fuel too
    expect(sup.measure(view({ towns: [{ pop: 1200, supply: all }] }))[0]).toBe(0);
    expect(sup.measure(view({ towns: [{ pop: 1600, supply: all }] }))[0]).toBe(0);
    expect(sup.measure(view({ towns: [{ pop: 1600, supply: { ...all, goods: 0.9, fuel: 0.85 } }] }))[0]).toBe(1);
    expect(m("villages2").measure(view({ towns: [{ pop: 1600, supply: {} }, { pop: 300, supply: {} }, { pop: 290, supply: {} }] }))).toEqual([2, 2]);
  });

  it("a few are open at once, in ladder order; reaching one opens the next", () => {
    const p = new Progress();
    expect(p.open().map((m) => m.id)).toEqual(MILESTONES.slice(0, OPEN_AT_ONCE).map((m) => m.id));
    // the second and third open ones are met (a village of 310 is past 150 as well): both are reached, the next two open
    expect(MILESTONES[2].id).toBe("village");
    const got = p.check(view({ towns: [{ pop: 310, supply: {} }] }));
    expect(got.map((m) => m.id)).toEqual(["hamlet150", "village"]);
    expect(p.open().map((m) => m.id)).toEqual([MILESTONES[0].id, MILESTONES[3].id, MILESTONES[4].id]);
    // a goal further up the ladder doesn't count until it is open
    expect(p.check(view({ made: { steel: 5 } }))).toEqual([]);
  });

  it("reaching one can open another that is met already: they come in order", () => {
    const p = new Progress();
    const v = view({ sold: { food: 10 }, towns: [{ pop: 320, supply: {} }, { pop: 10, supply: {} }], made: { planks: 12 } });
    expect(p.check(v).map((m) => m.id)).toEqual(["food10", "hamlet150", "village", "planks10"]);
  });

  it("the milestone that unlocks cement counts loads delivered, so a village that wants cement can still meet it", () => {
    const heavy = MILESTONES.find((m) => m.id === "heavy")!;
    expect(heavy.unlocks.buildings).toContain("cementworks");
    expect(heavy.measure(view({ sold: { food: 90, planks: 60 }, towns: [{ pop: 700, supply: { food: 0.9, planks: 0.85 } }] }))).toEqual([150, 150]);
    expect(heavy.measure(view({ sold: { food: 90 } }))).toEqual([90, 150]);
    // the later milestone that asks for every need does want the cement
    const sup2 = MILESTONES.find((m) => m.id === "townSupplied")!;
    expect(sup2.measure(view({ towns: [{ pop: 1700, supply: { food: 1, planks: 1, goods: 1, fuel: 1 } }] }))[0]).toBe(0);
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

  it("old saves: the town-slot milestones load as the growth milestones that replaced them, and spawned towns are kept", () => {
    const p = new Progress();
    p.onSold("food", 10);
    p.check(p.view([], 0));
    p.spawned.hamlet150 = [2];
    const old = { ...JSON.parse(JSON.stringify(p.toJSON())), done: ["food10", "town2", "towns3", "hamlet150"] };
    const q = new Progress();
    q.load(old);
    expect(q.done).toEqual(["food10", "hamlet150", "villages2"]);
    expect(q.spawned).toEqual({ hamlet150: [2] });
    // a save from before towns sprang up has no record of them
    const r = new Progress();
    const { spawned: _s, ...older } = old;
    r.load(older);
    expect(r.spawned).toEqual({});
  });

  it("every road type, tool and truck class is reached on the way: nothing the trim cut is left locked", () => {
    const all = unlocksOf(MILESTONES.map((m) => m.id));
    for (const r of Object.keys(ROAD_TYPES) as RoadTypeId[]) expect(all.roads.has(r), r).toBe(true);
    for (const f of ["roundabout", "signals", "parallel", "transit"] as const) expect(all.features.has(f), f).toBe(true);
    for (const c of TRUCK_CLASS_ORDER) expect(all.trucks.has(c), c).toBe(true);
    // (and the grants of the goals cut went to the kept ones: the ladder pays what it paid before the trim)
    expect(MILESTONES.reduce((s, m) => s + (m.unlocks.grant ?? 0), 0)).toBe(1_505_000);
    // the towns spring up at the same steps as before: 14 over the ladder, the first at 150 people
    expect(MILESTONES.reduce((s, m) => s + (m.unlocks.towns ?? 0), 0)).toBe(14);
    // every goal cut names a kept one that carries its unlocks
    for (const [id, to] of Object.entries(RETIRED)) {
      expect(MILESTONES.some((m) => m.id === id), id).toBe(false);
      expect(MILESTONES.some((m) => m.id === to), `${id} -> ${to}`).toBe(true);
    }
  });

  it("a save from before the trim: goals since cut are dropped, and what they unlocked stays unlocked until the kept goal is reached", () => {
    const p = new Progress();
    p.onSold("food", 30);
    const old = { ...JSON.parse(JSON.stringify(p.toJSON())), done: ["food10", "hamlet150", "village", "planks10", "food20", "supplied", "steel", "powered3", "heavy", "cement", "dairy", "milk1", "towns5"] };
    const q = new Progress();
    q.load(old);
    expect(q.done).toEqual(["food10", "hamlet150", "village", "planks10", "steel", "heavy", "cement"]);
    // the dairy and creamery came with "Milk round" and "Fresh milk": they stay, and "Two villages" is still to reach
    expect(q.unlocked.buildings.has("dairyfarm")).toBe(true);
    expect(q.unlocked.buildings.has("creamery")).toBe(true);
    expect(q.isDone("villages2")).toBe(false);
    expect(q.open().map((m) => m.id)).toEqual(["villages2", "pop1000", "fuel1"]);
    // (a town-slot id from older still: it stood for "Three villages", cut, whose town now comes with "Town supplied")
    expect(q.legacy).toEqual(["villages2", "townSupplied"]);
    // it saves and loads with the game
    const g = new Game(7);
    g.progress.load(q.toJSON());
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(h.placedUnlocked("creamery")).toBe(true);
    expect(h.progress.done).toEqual(q.done);
    // a new game has none of it
    expect(new Game(7).placedUnlocked("creamery")).toBe(false);
  });

  it("no milestone asks the company to run a number of towns: new ones come from the towns there are growing", () => {
    expect(BASE).not.toHaveProperty("towns");
    const spawners = MILESTONES.filter((m) => m.unlocks.towns);
    expect(spawners.length).toBeGreaterThanOrEqual(4);
    expect(spawners[0].id).toBe("hamlet150");
    for (const m of MILESTONES) expect(m.goal, m.id).not.toMatch(/^Run \w+ towns/);
  });
});
