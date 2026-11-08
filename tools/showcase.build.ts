/**
 * Builds the showcase company that plays behind the main menu with the game's own tools: the starting hamlet grown
 * into a village, a second town founded down the road, farms and food plants feeding both, a logging camp and
 * sawmill selling planks to the village, and out past the river tier 2: a coal mine, a power plant and a smelter fed
 * by an iron mine. It runs for a few game days and is written as a save to tools/out/showcase.json (copy it to
 * public/).
 *
 *   npx vitest run --config tools/vitest.config.ts tools/showcase.build.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { Game, START_MONEY } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { BLOCK, gridPt } from "../src/game/towns";
import { TOWN_SPACING, type Town } from "../src/game/settlements";
import { F } from "../src/world/gen";
import type { PlacedKind } from "../src/game/placed";
import type { Building } from "../src/game/buildings";
import { dist, v2, type V2 } from "../src/core/math";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { layRoad } from "../tests/helpers";

const log: string[] = [];
const say = (s: string) => { log.push(s); console.log(s); };

function mk(g: Game) {
  const sn = (p: V2): Snap => {
    const s = snap(g.net, p, { mpp: 0.4, level: 0, type: "street" });
    return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
  };
  return {
    /** A street from a to b, joining whatever is there. */
    road(name: string, a: V2, b: V2) {
      const plan = planRoad(g.net, g.world, { start: sn(a), end: sn(b), mode: "straight", type: "street" });
      if (plan.errors.length) { say(`FAIL road ${name}: ${plan.errors.map((e) => e.msg).join("; ")}`); return false; }
      if (!g.build(plan)) { say(`FAIL build ${name}`); return false; }
      say(`road ${name} ${dist(a, b).toFixed(0)} m`);
      return true;
    },
    /** A plant beside the street a-b, as near fraction t0 of the way along as fits. */
    placeFrom(kind: PlacedKind, a: V2, b: V2, t0: number): Building | null {
      const L = dist(a, b), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
      for (let t = t0; t < 0.95; t += 12 / L) {
        const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        for (const side of [1, -1]) for (const o of [35, 50]) {
          const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
          if (g.placedPlan(kind, p)?.ok) { const x = g.place(kind, p)!; say(`place ${kind} at ${p.x.toFixed(0)},${p.y.toFixed(0)}`); return x; }
        }
      }
      say(`FAIL place ${kind} along ${a.x.toFixed(0)},${a.y.toFixed(0)} - ${b.x.toFixed(0)},${b.y.toFixed(0)}`);
      return null;
    },
    /** A plant beside the street a-b, as near its middle as fits. */
    place(kind: PlacedKind, a: V2, b: V2): Building | null {
      const L = dist(a, b), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
      for (let k = 0; k <= 40; k++) {
        const t = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.022;
        if (t < 0.05 || t > 0.95) continue;
        const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        for (const side of [1, -1]) for (const o of [35, 50]) {
          const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
          if (g.placedPlan(kind, p)?.ok) { const x = g.place(kind, p)!; say(`place ${kind} at ${p.x.toFixed(0)},${p.y.toFixed(0)}`); return x; }
        }
      }
      say(`FAIL place ${kind} along ${a.x.toFixed(0)},${a.y.toFixed(0)} - ${b.x.toFixed(0)},${b.y.toFixed(0)}`);
      return null;
    },
  };
}

/** Spots on a deposit field from `from` to `to` m out from p, nearest first (one per patch or so). */
function deposits(g: Game, field: number, p: V2, from: number, to: number): V2[] {
  const out: V2[] = [];
  for (let r = from; r < to && out.length < 8; r += 100) for (let k = 0; k < 96; k++) {
    const q = v2(p.x + Math.cos((k / 96) * Math.PI * 2) * r, p.y + Math.sin((k / 96) * Math.PI * 2) * r);
    if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q) || out.some((o) => dist(o, q) < 450)) continue;
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
    if (ok >= 23) out.push(q);
  }
  return out;
}

/** The nearest spot to p (from `from` m out, to `to`) whose 75 m square is mostly on a deposit field. */
function nearestDeposit(g: Game, field: number, p: V2, from = 150, to = 2500): V2 | null {
  for (let r = from; r < to; r += 25) for (let k = 0; k < 64; k++) {
    const q = v2(p.x + Math.cos((k / 64) * Math.PI * 2) * r, p.y + Math.sin((k / 64) * Math.PI * 2) * r);
    if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q)) continue;
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
    if (ok >= 22) return q;
  }
  return null;
}

it("builds the showcase company", () => {
  const g = new Game(7);
  g.start();
  g.unlockAll(); // everything unlocked while it is built (the milestones it really reached are set at the end)
  g.money = 1e9;
  const B = mk(g);
  const A = g.towns.list[0];
  say(`hamlet ${A.name} at ${A.c.x.toFixed(0)},${A.c.y.toFixed(0)} pop ${A.pop}`);

  // ---------------------------------------------------------------- the food chain, at the end of the starting road
  const end = gridPt(A.c, A.ang, 1 + 320 / BLOCK, 0);
  const soil = nearestDeposit(g, F.fert, end, 80)!;
  const farmRoadEnd = v2(soil.x + (soil.x - end.x) / dist(soil, end) * 70, soil.y + (soil.y - end.y) / dist(soil, end) * 70);
  B.road("farm road", end, farmRoadEnd);
  const farm = B.place("farm", soil, farmRoadEnd) ?? B.place("farm", end, farmRoadEnd);
  const farm2 = B.place("farm", end, farmRoadEnd);
  // along the farmland: two more farms (a village eats what four of them grow)
  const dir = v2((farmRoadEnd.x - end.x) / dist(farmRoadEnd, end), (farmRoadEnd.y - end.y) / dist(farmRoadEnd, end));
  // (along the farmland, across the end of the farm road)
  const east = v2(farmRoadEnd.x - dir.y * 300, farmRoadEnd.y + dir.x * 300), west = v2(farmRoadEnd.x + dir.y * 300, farmRoadEnd.y - dir.x * 300);
  B.road("farm lane east", farmRoadEnd, east);
  B.road("farm lane west", farmRoadEnd, west);
  const farm3 = B.place("farm", farmRoadEnd, east), farm4 = B.place("farm", farmRoadEnd, west);
  for (const f of [farm, farm2, farm3, farm4]) if (f) say(`  farm yield ${Math.round(f.plant!.yld * 100)}%`);
  const food = B.place("foodplant", gridPt(A.c, A.ang, 1.2, 0), end);

  // ---------------------------------------------------------------- a second town down the road
  let siteB: V2 | null = null;
  for (let r = TOWN_SPACING + 100; r < 2600 && !siteB; r += 100) for (let k = 0; k < 24 && !siteB; k++) {
    const a = A.ang + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
    const q = v2(A.c.x + Math.cos(a) * r, A.c.y + Math.sin(a) * r);
    if (!g.towns.foundBlock(q) && !g.terrain.has(F.fert, q)) siteB = q;
  }
  const T = g.towns.found(siteB!);
  if (typeof T === "string") throw new Error(T);
  say(`founded ${T.name} at ${T.c.x.toFixed(0)},${T.c.y.toFixed(0)}, ${(dist(A.c, T.c) / 1000).toFixed(1)} km from ${A.name}`);
  // a road between the two towns, main street to main street
  const edgeTo = (t: Town, toward: V2) => {
    let best = gridPt(t.c, t.ang, 1, 0), bd = Infinity;
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const q = gridPt(t.c, t.ang, i, j); if (dist(q, toward) < bd) { bd = dist(q, toward); best = q; } }
    return best;
  };
  const ea = edgeTo(A, T.c), eb = edgeTo(T, A.c);
  const mid = v2((ea.x + eb.x) / 2, (ea.y + eb.y) / 2);
  B.road("between the towns 1", ea, mid);
  B.road("between the towns 2", mid, eb);
  // a village eats more than one food plant makes: a second one on the way out to the new town
  const food2 = B.place("foodplant", ea, mid);

  // ---------------------------------------------------------------- timber for the village
  const wood = nearestDeposit(g, F.forest, A.c, 300)!;
  // the road to the forest starts on the nearest of the town's ends
  const ew = edgeTo(A, wood);
  const woodEnd = v2(wood.x + (wood.x - ew.x) / dist(wood, ew) * 70, wood.y + (wood.y - ew.y) / dist(wood, ew) * 70);
  B.road("forest road", ew, woodEnd);
  const camp = B.place("loggingcamp", wood, woodEnd) ?? B.place("loggingcamp", ew, woodEnd);
  const mill = B.place("sawmill", ew, woodEnd);
  say(`plants: farm ${!!farm} farm2 ${!!farm2} food ${!!food} food2 ${!!food2} camp ${!!camp} mill ${!!mill}`);

  // ---------------------------------------------------------------- tier 2: coal over the river, iron ore to the west
  // (their building sites are taken as built: planks would take days to truck out this far)
  const built = (b: Building | null) => { if (b) { b.plant!.site = undefined; b.built = 1; } return b; };
  /** A road out to the nearest spot on a deposit a street gets to (round a river, or over it): its last leg. */
  const out = (name: string, field: number): [V2, V2] | null => {
    for (const d of deposits(g, field, A.c, 2500, 7000)) for (const t of [A, T]) {
      const a = edgeTo(t, d), e = v2(d.x + (d.x - a.x) / dist(d, a) * 90, d.y + (d.y - a.y) / dist(d, a) * 90);
      const r = layRoad(g, a, e);
      if (typeof r === "string") continue;
      say(`road to the ${name} ${(dist(a, e) / 1000).toFixed(1)} km${r.bridge ? `, ${Math.round(r.bridge)} m bridge` : ""}`);
      return r.legs[r.legs.length - 1];
    }
    say(`FAIL no way through to the ${name}`);
    return null;
  };
  const coalRoad = out("coal", F.coal);
  const coal = coalRoad && built(B.placeFrom("coalmine", coalRoad[1], coalRoad[0], 0));
  const power = coalRoad && built(B.placeFrom("coalplant", coalRoad[0], coalRoad[1], 0.3));
  const smelter = coalRoad && built(B.placeFrom("smelter", coalRoad[0], coalRoad[1], 0.45));
  const oreRoad = out("iron ore", F.ore);
  const ore = oreRoad && built(B.placeFrom("ironmine", oreRoad[1], oreRoad[0], 0));
  say(`tier 2: coal ${!!coal} power ${!!power} smelter ${!!smelter} ore ${!!ore}`);

  // ---------------------------------------------------------------- grow: the hamlet into a village, the new town into a hamlet
  A.target = 130;
  T.target = 30;
  const HOURS = Number(process.env.SHOWCASE_HOURS ?? 144);
  const t0 = Date.now();
  for (let h = 1; h <= HOURS; h++) {
    for (let i = 0; i < HOUR * 30; i++) g.step(1 / 30);
    g.money = 1e9;
    if (h % 6 === 0) {
      const tw = g.towns.list.map((t) => `${t.name} ${g.towns.sizeName(t)} pop ${t.pop} target ${t.target.toFixed(0)} supply ${JSON.stringify(t.supply)}`).join(" | ");
      say(`h${h} ${tw} cars ${g.traffic.vehicles.length} trucks ${g.traffic.vehicles.filter((v) => v.trip.haul).length} failed ${g.failedTrips} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      for (const b of g.buildings.list) if (b.plant && b.problem) say(`  ${b.kind}: ${b.problem}`);
    }
  }
  // the milestones the showcase company has really reached, on what it has made and sold
  g.progress.load({ ...g.progress.toJSON(), done: [] });
  g.progress.check(g.progressView());
  g.money = START_MONEY;
  say(`segs ${g.net.segs.size} buildings ${g.buildings.list.length} made ${JSON.stringify(g.progress.made)} milestones ${g.progress.done.join(" ")}`);
  mkdirSync("tools/out", { recursive: true });
  writeFileSync("tools/out/showcase.log", log.join("\n"));
  writeFileSync("tools/out/showcase.json", JSON.stringify(g.serialize()));
}, 1800000);
