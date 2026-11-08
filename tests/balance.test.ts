// The early game, played headless: a scripted company on seed 7 plays from the start the way a player would (a food
// chain, timber, a second town, then tier 2's mines, power plant, smelter, quarry and cement works) and spends only
// what it has. It checks the milestones come in the ladder's order, that the company stays solvent all the way, and
// prints the timeline: the numbers docs/design.md's "Pacing" is judged on. (Vitest shows it with --silent=false:
// `npx vitest run tests/balance.test.ts --silent=false`.)

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Game, START_MONEY } from "../src/game/city";
import { DAY, HOUR } from "../src/game/society";
import { BLOCK, gridPt } from "../src/game/towns";
import { TOWN_COST, TOWN_SPACING, type Town } from "../src/game/settlements";
import { PLANTS, type PlantKind } from "../src/game/industry";
import { MILESTONES, OPEN_AT_ONCE, tilePrice } from "../src/game/progression";
import { F } from "../src/world/gen";
import { BUILDING_TYPES } from "../src/config";
import { add, dist, norm, scale, sub, v2, type V2 } from "../src/core/math";
import { layRoad } from "./helpers";
import type { Building } from "../src/game/buildings";

const MAX_DAYS = 40;
/** The pace the early game is held to: first steel and first cement by these days. */
const STEEL_BY = 32, CEMENT_BY = 38;
/** What the company keeps in hand for wages and fuel: it doesn't build with its last dollars. */
const RESERVE = 8000;

function play() {
  const g = new Game(7);
  g.start();
  const lines: string[] = [];
  const stamp = () => `day ${(g.time / DAY).toFixed(2).padStart(5)}`;
  const say = (s: string) => lines.push(`${stamp()}  ${s}`);
  const reached: { id: string; t: number }[] = [];
  g.on((e) => {
    if (e.t === "milestone") { reached.push({ id: e.m.id, t: g.time }); say(`MILESTONE ${e.m.name} (${e.m.id}) · $${Math.round(g.money).toLocaleString("en-US")}`); }
  });

  // ---------------------------------------------------------------- building, as a player would, with the money there is
  /** The straight legs of the last road built (one, two round an obstacle, or three over a bridge). */
  let lastLegs: [V2, V2][] = [];
  /** A street from a to b, as a player would get one through (round an obstacle, or over a bridge): built, too dear for now, or no way through. */
  const road = (name: string, a: V2, b: V2): true | "money" | "blocked" => {
    const r = layRoad(g, a, b, g.money - RESERVE);
    if (typeof r === "string") return r;
    say(`road ${name}: ${(dist(a, b) / 1000).toFixed(2)} km${r.bridge ? ` with a ${Math.round(r.bridge)} m bridge` : ""}, $${Math.round(r.cost).toLocaleString("en-US")}`);
    lastLegs = r.legs;
    return true;
  };
  /** A plant beside the street a-b, from fraction t0 of the way along toward t1. */
  const place = (kind: PlantKind, a: V2, b: V2, t0 = 0.5, t1 = 0.95): Building | null => {
    if (PLANTS[kind].cost > g.money - RESERVE) return null;
    const L = dist(a, b), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
    const steps = Math.ceil(Math.abs(t1 - t0) * L / 12);
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (t1 - t0) * (k / steps);
      const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      for (const side of [1, -1]) for (const o of [35, 50]) {
        const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
        let pl = g.placedPlan(kind, p);
        if (pl && !pl.ok && pl.reason?.startsWith("Not your land") && buyLand(kind, p)) pl = g.placedPlan(kind, p);
        if (pl?.ok) {
          const x = g.place(kind, p)!;
          say(`place ${kind}${x.plant!.yld < 1 ? ` (${Math.round(x.plant!.yld * 100)}% on its deposit)` : ""}, ${(dist(p, A.c) / 1000).toFixed(1)} km from ${A.name} · $${Math.round(g.money).toLocaleString("en-US")} left`);
          return x;
        }
      }
    }
    return null;
  };
  /** Buy the tiles a lot at p stands on (only when it would then fit, on its deposit, with money to spare). */
  const buyLand = (kind: PlantKind, p: V2): boolean => {
    const T = BUILDING_TYPES[kind], half = Math.hypot(T.w, T.d) / 2;
    const need = new Set<string>();
    for (const [dx, dy] of [[0, 0], [half, 0], [-half, 0], [0, half], [0, -half], [half, half], [-half, -half], [half, -half], [-half, half]]) {
      const [i, j] = g.tileOf(v2(p.x + dx, p.y + dy));
      if (!g.tiles.has(`${i},${j}`)) need.add(`${i},${j}`);
    }
    if (!need.size || need.size > g.tileSlotsLeft) return false;
    let price = 0;
    for (let k = 0; k < need.size; k++) price += tilePrice(g.tiles.size + k);
    if (price + PLANTS[kind].cost > g.money - RESERVE) return false;
    // (a lot only partly on a deposit isn't worth the land)
    const D = PLANTS[kind].deposit;
    if (D && g.industry.depositShare(D.field, p, 0, T.w / 2, T.d / 2) < 0.5) return false;
    for (const key of need) {
      const [i, j] = key.split(",").map(Number);
      if (!g.unlockTile(i, j)) return false;
    }
    say(`bought ${need.size} tile${need.size > 1 ? "s" : ""} of land for $${price.toLocaleString("en-US")}`);
    return true;
  };
  /** The nearest spot to p (from `from` m out) whose 75 m square is mostly on a deposit field. */
  const deposit = (field: number, p: V2, from: number, to: number): V2 | null => {
    for (let r = from; r < to; r += 50) for (let k = 0; k < 96; k++) {
      const q = v2(p.x + Math.cos((k / 96) * Math.PI * 2) * r, p.y + Math.sin((k / 96) * Math.PI * 2) * r);
      if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q)) continue;
      let ok = 0;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
      if (ok >= 23) return q;
    }
    return null;
  };
  /** The town's street end nearest a point (where a road out of it starts). */
  const edge = (t: Town, toward: V2) => {
    let best = gridPt(t.c, t.ang, 1, 0), bd = Infinity;
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const q = gridPt(t.c, t.ang, i, j);
      if (dist(q, toward) < bd) { bd = dist(q, toward); best = q; }
    }
    return best;
  };
  const has = (k: PlantKind) => g.buildings.list.some((b) => b.kind === k);
  const count = (k: PlantKind) => g.buildings.list.filter((b) => b.kind === k).length;

  const A = g.towns.list[0];
  say(`start: ${A.name}, ${A.pop} people, $${START_MONEY.toLocaleString("en-US")}`);
  const soil = deposit(F.fert, gridPt(A.c, A.ang, 1 + 320 / BLOCK, 0), 60, 1500)!;
  const wood = deposit(F.forest, A.c, 400, 3000)!;
  /** Spots on a deposit field, nearest the start first (one per patch or so). */
  const spots = (field: number): V2[] => {
    const out: V2[] = [];
    for (let r = 2500; r < 8000 && out.length < 8; r += 100) for (let k = 0; k < 96; k++) {
      const q = v2(A.c.x + Math.cos((k / 96) * Math.PI * 2) * r, A.c.y + Math.sin((k / 96) * Math.PI * 2) * r);
      if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q) || out.some((o) => dist(o, q) < 450)) continue;
      let ok = 0;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
      if (ok >= 23) out.push(q);
    }
    return out;
  };
  const tier2 = { ore: spots(F.ore), coal: spots(F.coal), lime: spots(F.lime) };
  const km1 = (l: V2[]) => (l.length ? `${(dist(l[0], A.c) / 1000).toFixed(1)} km` : "none");
  say(`deposits from ${A.name}: soil ${(dist(soil, A.c) / 1000).toFixed(1)} km, forest ${(dist(wood, A.c) / 1000).toFixed(1)} km, iron ore ${km1(tier2.ore)}, coal ${km1(tier2.coal)}, limestone ${km1(tier2.lime)}`);
  const blocked = new Set<string>();
  /** Where a new road to q starts: the nearest of the company's road ends and the towns' street ends. */
  const startFor = (q: V2): V2 =>
    [edge(A, q), ...(B ? [edge(B, q)] : []), ...Object.values(roads).flat()].sort((x, y) => dist(x, q) - dist(y, q))[0];
  /**
   * A site on a deposit, the way a player places one: the plot near `near` with the most of the field under it,
   * standing free with its gate toward the nearest road end, then a street from there to the gate. (With no street
   * through, the site is taken back and the next plot tried.) "money": not for now.
   */
  const site = (kind: PlantKind, field: number, near: V2, key?: string, R = 700): Building | null | "money" => {
    if (PLANTS[kind].cost > g.money - RESERVE) return "money";
    const T = BUILDING_TYPES[kind];
    const plots: { q: V2; s: number }[] = [];
    for (let x = -R; x <= R; x += 50) for (let y = -R; y <= R; y += 50) {
      const q = v2(near.x + x, near.y + y);
      if (Math.hypot(x, y) > R || !g.world.inBounds(q) || !g.terrain.has(field, q)) continue;
      const sh = g.industry.depositShare(field, q, 0, T.w / 2, T.d / 2);
      if (sh >= 0.5) plots.push({ q, s: sh - 0.3 * dist(q, near) / R });
    }
    plots.sort((x, y) => y.s - x.s);
    let tries = 0;
    for (const { q } of plots) {
      if (tries >= 10) break;
      const a = startFor(q);
      const opts = { down: norm(sub(a, q)) };
      let pl = g.placedPlan(kind, q, opts);
      if (pl && !pl.ok && pl.reason?.startsWith("Not your land") && buyLand(kind, q)) pl = g.placedPlan(kind, q, opts);
      if (!pl?.ok) continue;
      tries++;
      const b = g.place(kind, q, opts)!;
      const done = () => {
        say(`place ${kind}${b.plant!.yld < 1 ? ` (${Math.round(b.plant!.yld * 100)}% on its deposit)` : ""}, ${(dist(b.c, A.c) / 1000).toFixed(1)} km from ${A.name} · $${Math.round(g.money).toLocaleString("en-US")} left`);
        return b;
      };
      if (b.access) return done();
      // a street to 4 m past the kerb in front of its gate
      const e = add(b.front, scale(norm(sub(b.front, b.c)), 4));
      const r = road(`to the ${T.name.toLowerCase()}`, a, e);
      if (r !== true) { g.undo(); if (r === "money") return "money"; continue; }
      if (key) { roads[key] = [a, e]; paths[key] = lastLegs; }
      return done();
    }
    return null;
  };
  /** A tier 2 mine on the nearest patch of its deposit a street reaches. */
  const mine = (key: "ore" | "coal" | "lime", kind: PlantKind, field: number, name: string) => {
    if (has(kind) || blocked.has(key) || g.money < RESERVE + PLANTS[kind].cost + 8000) return;
    for (const d of tier2[key]) {
      const r = site(kind, field, d, key, 500);
      if (r) return;
    }
    say(`no way through to the ${name}`);
    blocked.add(key);
  };

  const roads: Record<string, [V2, V2]> = {};
  const paths: Record<string, [V2, V2][]> = {};
  let B: Town | null = null;
  let lastFarm = 0;
  let low = g.money;
  const plan = () => {
    const u = g.progress.unlocked.buildings;
    // tier 1: food first (the hamlet's only need), a second town to sell to, then timber as the hamlet nears
    // Village size (the goals and tips lead a player the same way)
    if (count("farm") < 1) site("farm", F.fert, soil, "farm");
    if (roads.farm && has("farm") && !has("foodplant")) place("foodplant", ...roads.farm, 0.1, 0.5);
    const timber = Math.max(...g.towns.list.map((t) => t.pop)) >= 200;
    if (has("foodplant") && timber && !has("loggingcamp")) site("loggingcamp", F.forest, wood, "wood");
    if (has("loggingcamp") && !has("sawmill")) place("sawmill", ...roads.wood, 0.15, 0.6);
    // a second farm with the second town, and more (one every two days) while the towns go short of food
    if (B && count("farm") < 2) site("farm", F.fert, soil);
    const hungry = g.towns.list.some((t) => t.pop > 150 && (t.supply.food ?? 0) < 0.7);
    if (hungry && count("farm") >= 2 && count("farm") < 2 * count("foodplant") && g.time - lastFarm > 2 * DAY && g.money > PLANTS.farm.cost + RESERVE) {
      lastFarm = g.time;
      site("farm", F.fert, soil, undefined, 1200);
    }
    // a second town, down the road, once there is money for it
    if (has("foodplant") && !B && g.money > TOWN_COST + RESERVE + 7000 && g.townSlots > 1) {
      for (let r = TOWN_SPACING + 100; r < 2600 && !B; r += 100) for (let k = 0; k < 24 && !B; k++) {
        const an = A.ang + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const q = v2(A.c.x + Math.cos(an) * r, A.c.y + Math.sin(an) * r);
        if (g.towns.foundBlock(q) || g.terrain.has(F.fert, q) || g.terrain.has(F.forest, q)) continue;
        const t = g.towns.found(q);
        if (typeof t !== "string") { B = t; say(`found ${t.name}, ${(dist(A.c, t.c) / 1000).toFixed(1)} km away`); }
      }
    }
    if (B && !roads.towns) { const a = edge(A, B.c), b = edge(B, A.c); if (road("between the towns", a, b) === true) roads.towns = [a, b]; }
    if (roads.towns && has("sawmill") && count("foodplant") < 2) place("foodplant", ...roads.towns, 0.3, 0.7);
    // tier 2: the mines first (they wait as building sites for planks), then the power plant and the smelter
    // (the hub: halfway along the road from the ore to the coal, so both hauls are short)
    const hub = (k: PlantKind) => {
      const mines = g.buildings.list.filter((b) => b.kind === "ironmine" || b.kind === "coalmine").map((b) => b.c);
      const opts: { r: [V2, V2]; t: number; d: number }[] = [];
      for (const r of [...(paths.ore ?? []), ...(paths.coal ?? [])]) for (let t = 0; t <= 1; t += 0.05) {
        const q = v2(r[0].x + (r[1].x - r[0].x) * t, r[0].y + (r[1].y - r[0].y) * t);
        opts.push({ r, t, d: mines.reduce((s, m) => s + dist(m, q), 0) });
      }
      opts.sort((x, y) => x.d - y.d);
      for (const o of opts.slice(0, 3)) {
        const x = place(k, ...o.r, Math.max(0, o.t - 0.1), Math.min(1, o.t + 0.15));
        if (x) return x;
      }
      return null;
    };
    if (u.has("ironmine") && has("sawmill")) mine("ore", "ironmine", F.ore, "iron ore");
    if (u.has("coalmine") && has("ironmine")) mine("coal", "coalmine", F.coal, "coal");
    if (u.has("coalplant") && has("coalmine") && !has("coalplant")) hub("coalplant");
    if (u.has("smelter") && has("coalmine") && !has("smelter")) hub("smelter");
    if (u.has("quarry") && has("smelter")) mine("lime", "quarry", F.lime, "limestone");
    if (u.has("cementworks") && has("quarry") && !has("cementworks")) hub("cementworks");
  };

  // ---------------------------------------------------------------- the clock
  let steel = -1, cement = -1;
  for (let h = 0; h < MAX_DAYS * 24; h++) {
    plan();
    for (let i = 0; i < HOUR * 30; i++) {
      g.step(1 / 30);
      if (g.money < low) low = g.money;
    }
    const made = g.progress.made;
    if (steel < 0 && (made.steel ?? 0) >= 1) { steel = g.time; say("FIRST STEEL"); }
    if (cement < 0 && (made.cement ?? 0) >= 1) { cement = g.time; say("FIRST CEMENT"); }
    if (h % 24 === 23) {
      const towns = g.towns.list.map((t) => `${t.name} ${t.pop} ${JSON.stringify(t.supply)}`).join(", ");
      const sites = g.buildings.list.filter((b) => b.plant?.site).map((b) => `${b.kind} ${b.plant!.site!.got.planks ?? 0}/${b.plant!.site!.need.planks}`).join(", ");
      say(`end of day: $${Math.round(g.money).toLocaleString("en-US")} · ${towns} · made ${JSON.stringify(made)}${sites ? ` · sites ${sites}` : ""}`);
      for (const b of g.buildings.list) if (b.plant && b.problem) lines.push(`             ${b.kind}: ${b.problem}`);
    }
    if (steel >= 0 && cement >= 0 && g.progress.isDone("cement")) break;
  }
  return { g, lines, reached, low, steel, cement };
}

describe("Balance: the early game", () => {
  // traffic draws a few things at random (car looks, lane picks): a seeded stand-in keeps the timeline the same each run
  beforeAll(() => {
    let x = 0x2f6b1d3;
    vi.spyOn(Math, "random").mockImplementation(() => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 4294967296;
    });
  });
  afterAll(() => vi.restoreAllMocks());

  it("a scripted company reaches first steel and first cement, in ladder order, and stays solvent", () => {
    const t0 = Date.now();
    const { g, lines, reached, low, steel, cement } = play();
    const ids = reached.map((r) => r.id);
    console.log(["", "Balance timeline (seed 7):", ...lines,
      `milestones: ${reached.map((r) => `${r.id}@${(r.t / DAY).toFixed(2)}`).join(" ")}`,
      `first steel day ${(steel / DAY).toFixed(2)}, first cement day ${(cement / DAY).toFixed(2)}; lowest balance $${Math.round(low).toLocaleString("en-US")}; ${((Date.now() - t0) / 1000).toFixed(0)} s`].join("\n"));
    // solvent all the way
    expect(low).toBeGreaterThanOrEqual(0);
    expect(g.money).toBeGreaterThan(0);
    // first steel and first cement made, at a pace that keeps the early game moving (seed 7 runs day 27 and day 33;
    // a day is 4 minutes at 4x)
    expect(steel).toBeGreaterThan(0);
    expect(cement).toBeGreaterThan(0);
    expect(steel / DAY).toBeLessThan(STEEL_BY);
    expect(cement / DAY).toBeLessThan(CEMENT_BY);
    // milestones in the ladder's order where one gates the next
    const at = (id: string) => ids.indexOf(id);
    for (const id of ["food10", "town2", "planks10", "village", "supplied", "steel", "cement"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    expect(at("food10")).toBeLessThan(at("village"));
    expect(at("village")).toBeLessThan(at("steel"));
    expect(at("supplied")).toBeLessThan(at("cement"));
    expect(at("steel")).toBeLessThan(at("cement"));
    // never more than OPEN_AT_ONCE ahead of the first one not reached
    for (const [i, id] of ids.entries()) expect(MILESTONES.findIndex((m) => m.id === id)).toBeLessThan(i + OPEN_AT_ONCE + 1);
  }, 1_800_000);
});
