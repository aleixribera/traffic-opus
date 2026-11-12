// Towns spring up by themselves (docs/design.md "Towns"): a milestone's reward is a fresh hamlet far out, each one
// further than the last, with its own first streets and no road to the company's network. The player never founds one.

import { describe, expect, it } from "vitest";
import { Game, type GameEvent } from "../src/game/city";
import { SPAWN_ROAD_CLEAR, TOWN_SPACING, spawnDistance } from "../src/game/settlements";
import { sizeOf } from "../src/game/towns";
import { MILESTONES } from "../src/game/progression";
import { dist } from "../src/core/math";
import appSrc from "../src/app.ts?raw";
import hudSrc from "../src/ui/hud.ts?raw";

/** A started game whose home town has just grown to `pop` (the milestones look at it next check). */
function grown(seed = 7, pop = 160) {
  const g = new Game(seed);
  g.start();
  const ev: GameEvent[] = [];
  g.on((e) => ev.push(e));
  g.towns.list[0].pop = pop;
  return { g, ev, home: g.towns.list[0] };
}

describe("Towns springing up", () => {
  it("a hamlet growing to 150 brings a fresh town a short drive out: level 0, its own streets, no road to the company", () => {
    const { g, ev, home } = grown();
    const m0 = g.money;
    g.checkMilestones();
    const ms = ev.filter((e) => e.t === "milestone").map((e) => (e.t === "milestone" ? e : null)!);
    const hamlet = ms.find((e) => e.m.id === "hamlet150");
    expect(hamlet?.towns?.length).toBe(1);
    expect(g.towns.list.length).toBe(2);
    const t = g.towns.list[1];
    expect(hamlet!.towns![0]).toBe(t.id);
    expect(t.spawned).toBe(true);
    expect(sizeOf(t.pop)).toBe(0);
    expect(t.pop).toBeGreaterThan(0);
    expect(g.progress.spawned.hamlet150).toEqual([t.id]);
    // the event a banner is made from: who it is near, how far and which way
    const sp = ev.find((e) => e.t === "townSpawned");
    expect(sp).toMatchObject({ t: "townSpawned", town: t.id, from: home.id });
    if (sp?.t !== "townSpawned") throw new Error("no townSpawned event");
    expect(sp.dist).toBeCloseTo(dist(home.c, t.c), 3);
    expect(sp.dir).toMatch(/^(north|south|east|west|north-east|north-west|south-east|south-west)$/);
    // the first is 1.5 to 2.5 km out, on dry land
    expect(sp.dist).toBeGreaterThan(1500);
    expect(sp.dist).toBeLessThan(2500);
    expect(g.world.isWater(t.c)).toBe(false);
    // it laid its own first streets, and nothing of the company's comes near: it starts cut off
    expect([...g.net.segs.values()].filter((s) => s.town === t.id).length).toBeGreaterThanOrEqual(4);
    for (const s of g.net.segs.values()) {
      if (s.town === t.id) continue;
      const a = g.net.nodes.get(s.a)!.p, b = g.net.nodes.get(s.b)!.p;
      expect(Math.min(dist(a, t.c), dist(b, t.c))).toBeGreaterThan(SPAWN_ROAD_CLEAR);
    }
    // it cost the company nothing (the milestone's grant aside)
    const grants = ms.reduce((s, e) => s + (e.m.unlocks.grant ?? 0), 0);
    expect(g.money).toBeCloseTo(m0 + grants, 0);
  });

  it("each town springs up further out than the last, roughly exponentially, and never near another", () => {
    const g = new Game(7);
    g.start();
    const home = g.towns.list[0];
    const out: number[] = [];
    for (let k = 0; k < 6; k++) {
      const s = g.towns.spawn();
      expect(s, `town ${k + 1}`).not.toBeNull();
      out.push(dist(home.c, s!.town.c));
      expect(out[k] / spawnDistance(k), `town ${k + 1}`).toBeGreaterThan(0.5);
      expect(out[k] / spawnDistance(k), `town ${k + 1}`).toBeLessThan(2);
    }
    for (let k = 1; k < out.length; k++) expect(out[k], `town ${k + 1}`).toBeGreaterThan(out[k - 1]);
    expect(out[5] / out[0]).toBeGreaterThan(4);
    for (const a of g.towns.list) for (const b of g.towns.list) if (a !== b) expect(dist(a.c, b.c)).toBeGreaterThan(TOWN_SPACING * 1.5);
    // none on a company site, none in water
    for (const t of g.towns.list) expect(g.world.isWater(t.c)).toBe(false);
  }, 60000);

  it("is the same town in the same place every time from the seed, and another on another seed", () => {
    const run = (seed: number) => {
      const { g } = grown(seed);
      g.checkMilestones();
      const t = g.towns.list[1];
      return { name: t.name, x: Math.round(t.c.x), y: Math.round(t.c.y) };
    };
    const a = run(7);
    expect(run(7)).toEqual(a);
    expect(run(11)).not.toEqual(a);
  });

  it("a game saved with a town that sprang up loads with it, its marker state and the milestone that brought it", () => {
    const { g } = grown();
    g.checkMilestones();
    const t = g.towns.list[1];
    for (let i = 0; i < 40 * 30 * 6; i++) g.step(1 / 30);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    const u = h.towns.byId.get(t.id)!;
    expect(u.name).toBe(t.name);
    expect(u.spawned).toBe(true);
    expect(u.hours?.length).toBe(t.hours?.length);
    expect(h.progress.spawned.hamlet150).toEqual([t.id]);
    expect(h.progress.isDone("hamlet150")).toBe(true);
    // a town from an old save (founded by the player) loads as it was: not one that sprang up
    const old = JSON.parse(JSON.stringify(g.serialize()));
    for (const x of old.towns.towns) { delete x.spawned; delete x.hours; delete x.hourNow; }
    const o = Game.load(old);
    expect(o.towns.byId.get(t.id)!.spawned).toBeFalsy();
  }, 60000);

  it("only milestones bring towns: the founding tool, its cost and its button are gone", () => {
    expect(appSrc).not.toMatch(/"town"\s*\|/);
    expect(appSrc).not.toMatch(/towns\.found\(/);
    expect(appSrc).not.toMatch(/TOWN_COST/);
    expect(hudSrc).not.toMatch(/Found a town/i);
    expect(hudSrc).not.toMatch(/tool: "town"/);
    expect(MILESTONES.filter((m) => m.unlocks.towns).every((m) => !/^Run /.test(m.goal))).toBe(true);
  });

  it("the people in all towns is the towns' own figures, at once: a new hamlet counts while its card pauses the game (review 2026-11-12, C8)", () => {
    const g = new Game(7);
    g.start();
    const before = g.towns.people();
    expect(before).toBe(g.towns.list[0].pop);
    // (the game paused on the new town's card: no tick runs between its arrival and the bar's next look)
    expect(g.towns.spawn()).toBeTruthy();
    const plaques = g.towns.list.reduce((a, t) => a + t.pop, 0);
    expect(g.towns.list[1].pop).toBeGreaterThan(0);
    expect(g.towns.people()).toBe(plaques);
    // (the society's own head count waits for its next quarter-hour: it is not what the bar says)
    expect(g.people.stats.population).not.toBe(plaques);
    expect(hudSrc).toContain("fmtNum(g.towns.people())");
    expect(hudSrc).not.toContain("st.population");
  });
});
