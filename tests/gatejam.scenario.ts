// The play-test's company (docs/playtest-2026-11-09.md, A1 and E1), rebuilt headless: a village on a single road
// west, a sawmill beside that road with a logging camp or two further on, a second town on the same road, and the
// steel chain's four building sites (iron mine, coal mine, smelter, power plant) placed together on a spur. One sawmill
// is then the supplier of four sites and two towns. tests/gatejam.test.ts runs it and holds the game to what the
// report asked for: a slow road, never a dead one; tools/gatejam.build.ts runs the long version and prints the numbers.

import { Game } from "../src/game/city";
import { add, dist, norm, scale, sub, v2, type V2 } from "../src/core/math";
import { BLOCK } from "../src/game/towns";
import { DAY, HOUR } from "../src/game/society";
import { F } from "../src/world/gen";
import { Industry, type PlantKind } from "../src/game/industry";
import type { Building, PlaceOpts } from "../src/game/buildings";
import { BUILDING_TYPES } from "../src/config";
import type { Town } from "../src/game/settlements";
import type { RoadTypeId } from "../src/config";
import { planRoad, snap, type Snap } from "../src/roads/planner";

export interface GateJamOpts {
  seed?: number;
  /** building sites of each kind (1: the report's four; 2: the overload) */
  sites?: number;
  /** the road west of the sawmill's gate (the tester's was dirt) */
  west?: RoadTypeId;
  /** people in the first town when the sites go down (the tester's had just made Village) */
  pop?: number;
  /** the sawmill's level when the sites go down (the tester's was 3) */
  millLevel?: number;
  /** logging camps (the tester had two by the end) */
  camps?: number;
  /** where along the road west the sawmill's gate street meets it (m from the town's edge) */
  millAt?: number;
  /** length of the street the sawmill lays from its gate to the road (m; 0: it stands beside the road, no street) */
  gateStreet?: number;
  /** game days the timber chain runs before the sites go down */
  warm?: number;
  /** people in the second town */
  popB?: number;
  /** a game that is running already (the real game, for a look at it: tools/gatejam.build.ts says how) */
  game?: Game;
}

export interface GateJam {
  g: Game;
  A: Town;
  B: Town;
  mill: Building;
  camps: Building[];
  sites: Building[];
  /** unit vector along the road west, and its start at the town's edge */
  dir: V2;
  origin: V2;
  /** the sim time the sites went down */
  t0: number;
}

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

/** Lay a road as the road tool would, joining what is there at either end. Throws if the planner refuses. */
export function layStraight(g: Game, a: V2, b: V2, type: RoadTypeId = "street") {
  const sa = snap(g.net, a, { mpp: 0.5, level: 0, type });
  const sb = snap(g.net, b, { mpp: 0.5, level: 0, type });
  const plan = planRoad(g.net, g.world, {
    start: sa.node !== undefined || sa.seg !== undefined ? sa : free(a),
    end: sb.node !== undefined || sb.seg !== undefined ? sb : free(b), mode: "straight", type,
  });
  if (plan.errors.length) throw new Error(`road ${type}: ${plan.errors.map((e) => e.msg).join("; ")}`);
  if (!g.build(plan)) throw new Error("road: not built");
}

/** Is the straight line a-b dry, flat land with nothing built on it? */
function clearLine(g: Game, a: V2, b: V2, pad = 0): boolean {
  const L = dist(a, b), d = norm(sub(b, a)), n = v2(-d.y, d.x);
  for (let s = 0; s <= L; s += 20) for (const o of pad ? [-pad, 0, pad] : [0]) {
    const p = v2(a.x + d.x * s + n.x * o, a.y + d.y * s + n.y * o);
    if (!g.world.inBounds(p) || g.world.isWater(p) || g.world.isMountain(p)) return false;
  }
  return true;
}

/**
 * A company with money and a grown first town, on a seed with 3.6 km of dry, flat, empty land one way out of it:
 * `at(along, across)` is a point that far along the way out and to its right. Deposits are wherever a test needs them.
 */
export function openLand(o: { seed?: number; pop?: number; game?: Game } = {}): { g: Game; A: Town; dir: V2; origin: V2; at: (along: number, across?: number) => V2 } {
  const g = o.game ?? new Game(o.seed ?? 7);
  if (!o.game) g.start();
  const terr = g.terrain as unknown as { has(f: number, p: V2): boolean };
  const has0 = terr.has.bind(terr);
  terr.has = (f, p) => f === F.forest || f === F.ore || f === F.coal || has0(f, p);
  // (what the company had reached by then: the first hamlet goals, Village and Sawn timber; nothing springs up by itself)
  for (const id of ["food10", "hamlet150", "village", "planks10"]) g.progress.done.push(id);
  g.money = 2_000_000;
  const A = g.towns.list[0];
  // grown to a village off the clock
  for (let k = 0; k < 400 && A.pop < (o.pop ?? 320); k++) g.fastForward(A.id, 6, 1.6);

  // the road west: the first heading out of a town street end with 3.6 km of clear land either side of it
  let dir: V2 | null = null, origin: V2 | null = null;
  const ends = [...g.net.nodes.values()].filter((n) => g.net.segsAt(n.id).length === 1);
  for (let k = 0; k < 48 && !dir; k++) {
    // (away from the start road's farmland first)
    const a = A.ang + Math.PI + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 24;
    const d = v2(Math.cos(a), Math.sin(a));
    const e = ends.filter((n) => dist(n.p, A.c) > BLOCK * 0.9).sort((x, y) => (y.p.x * d.x + y.p.y * d.y) - (x.p.x * d.x + x.p.y * d.y))[0];
    if (!e) continue;
    const far = add(e.p, scale(d, 3600));
    const n = v2(-d.y, d.x);
    if (!clearLine(g, add(e.p, scale(d, 30)), far, 330)) continue;
    // (and room for the spur and its sites south of it)
    if (!clearLine(g, add(e.p, scale(d, 1700)), add(add(e.p, scale(d, 1700)), scale(n, 1350)), 330)) continue;
    if (!clearLine(g, add(e.p, scale(d, 310)), add(add(e.p, scale(d, 310)), scale(n, 950)), 250)) continue;
    if (g.buildings.hit([add(e.p, scale(d, 40)), add(e.p, scale(d, 200))], 12).length) continue;
    dir = d; origin = e.p;
  }
  if (!dir || !origin) throw new Error("gatejam: no clear way out of the start town on this seed");
  const n = v2(-dir.y, dir.x);
  const at = (along: number, across = 0) => v2(origin!.x + dir!.x * along + n.x * across, origin!.y + dir!.y * along + n.y * across);
  return { g, A, dir, origin, at };
}

/**
 * Build the company as it stood when the tester placed the steel chain: both towns grown (off the clock, every need
 * met), the timber chain running at its level, the sites just placed. Deposits are wherever the scenario needs them
 * (the world's fields are overridden for forest, ore and coal), so the layout is the same on any seed that has 3.5 km
 * of dry land one way out of the start town.
 */
export function buildGateJam(o: GateJamOpts = {}): GateJam {
  const { g, A, dir, origin, at } = openLand(o);
  const west = o.west ?? "dirt";
  const M = o.millAt ?? 560;
  // paved as far as the sawmill's gate, the first road (dirt) beyond, as the tester had it
  layStraight(g, origin, at(M), "street");
  layStraight(g, at(M), at(1700), west);
  layStraight(g, at(1700), at(2500), west);
  // the second town, on the same road
  const tb = g.towns.found(at(2500 + BLOCK * 1.5), { ang: Math.atan2(dir.y, dir.x), name: "Claybrook" });
  if (typeof tb === "string") throw new Error("gatejam: " + tb);
  const B = tb;
  for (let k = 0; k < 200 && B.pop < (o.popB ?? 220); k++) g.fastForward(B.id, 6, 1.6);
  // (joined to the nearest of its street ends)
  // (unless it has grown a street out to the road by itself)
  const roadEnd = snap(g.net, at(2500), { mpp: 0.5, level: 0, type: west }).node;
  const joined = () => g.shops.some((b) => b.town === B.id && b.access && roadEnd !== undefined && g.net.segsAt(roadEnd).some((x) => g.connected(x.id, b.access!.seg)));
  if (!joined()) {
    const bEnd = [...g.net.nodes.values()].filter((x) => x.id !== roadEnd && dist(x.p, B.c) < BLOCK * 3 && g.net.segsAt(x.id).length >= 1).sort((x, y) => dist(x.p, at(2500)) - dist(y.p, at(2500)))[0];
    layStraight(g, at(2500), bEnd.p, "street");
  }
  if (!joined()) throw new Error("gatejam: the second town is not on the road");

  const place = (kind: PlantKind, p: V2, opts?: PlaceOpts): Building => {
    const pl = g.placedPlan(kind, p, opts);
    if (!pl?.ok) throw new Error(`gatejam: ${kind}: ${pl?.reason ?? "no plan"}`);
    return g.place(kind, p, opts)!;
  };
  // the sawmill stands back from the road where the paving ends, turned by hand to face it: the game lays the short
  // street from its gate (the tester's was about 23 m), and that street's end on the road is the T-junction that seized
  const T = BUILDING_TYPES.sawmill;
  const gap = o.gateStreet ?? 23;
  const mill = gap > 0 ? place("sawmill", at(M, -(4 + gap + T.d / 2)), { turn: 0.002 }) : place("sawmill", at(M - 40, -(T.d / 2 + 30)));
  // the logging camps on a street of their own that leaves the road 250 m nearer the town
  const spurAt = M - 250;
  layStraight(g, at(spurAt), at(spurAt, 900), "street");
  const camps: Building[] = [place("loggingcamp", at(spurAt - 110, 260))];
  if ((o.camps ?? 2) > 1) camps.push(place("loggingcamp", at(spurAt + 110, 640)));
  for (const b of [mill, ...camps]) b.built = 1;
  const lv = o.millLevel ?? 3;
  while (mill.plant!.level < lv) g.industry.levelUp(mill);
  for (const c of camps) while (c.plant!.level < Math.min(2, lv)) g.industry.levelUp(c);

  // the timber chain runs for a day first: trucks out, yards stocked, the towns buying planks
  const t1 = g.time + (o.warm ?? 1) * DAY;
  while (g.time < t1) { feed(g); g.step(g.dt); }

  // the steel chain's sites, placed together on a street off the dirt road, 1.1 km on
  const S = 1700;
  layStraight(g, at(S), at(S, 1100), "street");
  const sites: Building[] = [];
  const k = o.sites ?? 1;
  const spots: [PlantKind, number, number][] = [["ironmine", 260, -1], ["coalmine", 560, 1], ["smelter", 560, -1], ["coalplant", 860, -1]];
  if (k > 1) spots.push(["ironmine", 860, 1], ["coalmine", 260, 1], ["smelter", 1160, -1], ["coalplant", 1160, 1]);
  for (const [kind, down, side] of spots) sites.push(place(kind, at(S + side * 150, down)));
  return { g, A, B, mill, camps, sites, dir, origin, t0: g.time };
}

/** The towns' food, landed by hand through the day (the scenario is about timber: no farms, no food trucks). */
export function feed(g: Game) {
  for (const t of g.towns.list) {
    const want = g.towns.short(t.id, "food");
    const due = (g.towns.short(t.id, "food") + (t.today.food ?? 0)) * (((g.time % DAY) / DAY) * 1.15 + 0.05);
    const n = Math.floor(Math.min(want, due - (t.today.food ?? 0)));
    if (n >= 1) g.towns.sold(t.id, "food", n);
  }
  for (const b of g.shops) if (b.stock < 2) b.stock = 4;
}

export interface JamStats {
  day: number;
  vehicles: number;
  /** vehicles on the road standing 5 game minutes and more (see STAND) */
  standing: number;
  /** the longest any vehicle on the road has stood, sim s */
  longest: number;
  /** the sawmill's trucks on a run (what its panel shows as "trucks out"), of its fleet */
  trucksOut: number;
  fleet: number;
  /** of those: loaded and on their way, on their way home, still in the yard waiting to pull out of the gate */
  out: number;
  back: number;
  atGate: number;
  /** of its trucks on the road, those standing in traffic (30 s and more) */
  held: number;
  /** planks the sawmill made an hour, over the last three */
  perHour: number;
  /** planks waiting in its yard */
  yard: number;
  /** the share of their plank needs the towns have landed, % (what their panels read) */
  planksA: number;
  planksB: number;
  /** each site: "got/need" loads, "up" (all in, going up) or "ok" (built) */
  sites: string;
  breaks: number;
  quits: number;
}

/** "Standing" in the report's terms: 5 game minutes on the clock the player sees is 5 * 60 sim seconds at 1x. */
export const STAND = 300;

export function jamStats(s: GateJam): JamStats {
  const { g, mill } = s;
  const vs = g.traffic.vehicles;
  const pend = new Set(g.traffic.pending.map((p) => p.trip));
  let out = 0, back = 0, atGate = 0, held = 0;
  for (const t of g.trips()) {
    const h = t.haul;
    if (!h || h.done || h.big || h.plant !== mill.id) continue;
    // (waiting in its own yard to pull out; one waiting at a customer's kerb for the way home is on its way back)
    if (pend.has(t) && h.leg === "out") atGate++;
    else if (h.leg === "out") out++;
    else back++;
  }
  for (const v of vs) if (v.trip.haul?.plant === mill.id && v.stuck > 30 + g.traffic.redTime(v)) held++;
  const share = (t: Town) => Math.round((t.supply.planks ?? 0) * 100);
  return {
    day: +(g.time / DAY).toFixed(2), vehicles: vs.length, standing: vs.filter((v) => v.stuck >= STAND).length,
    longest: Math.round(vs.reduce((m, v) => Math.max(m, v.stuck), 0)),
    trucksOut: out + back + atGate, fleet: g.industry.trucksOf(mill), out, back, atGate, held,
    perHour: +(Industry.madeLately(mill, "planks").byHour.slice(-3).reduce((a, v) => a + v, 0) / 3).toFixed(1),
    yard: Math.floor(mill.plant!.out.planks ?? 0),
    planksA: share(s.A), planksB: share(s.B),
    sites: s.sites.map((b) => (b.plant!.site ? `${b.plant!.site.got.planks ?? 0}/${b.plant!.site.need.planks}` : b.built < 1 ? "up" : "ok")).join(" "),
    breaks: g.traffic.jamBreaks, quits: g.traffic.jamQuits,
  };
}

export interface JamRun {
  /** one a game hour */
  samples: JamStats[];
  /** the worst of each over the run */
  standing: number;
  longest: number;
  held: number;
  trucksOut: number;
  /** the lowest the towns' plank supply read, % (from `settle` game hours in: the sites' first loads are on the road) */
  minA: number;
  minB: number;
  /** real minutes at 1x from the sites going down (60 sim s a minute): null if not in the run */
  firstMine: number | null;
  allSites: number | null;
  firstSteel: number | null;
  breaks: number;
  quits: number;
}

/** Run the company for `days` game days from where buildGateJam left it, measuring every game hour. */
export function runGateJam(s: GateJam, days: number, each?: (st: JamStats) => void, settle = 12): JamRun {
  const { g } = s;
  const r: JamRun = { samples: [], standing: 0, longest: 0, held: 0, trucksOut: 0, minA: 100, minB: 100, firstMine: null, allSites: null, firstSteel: null, breaks: 0, quits: 0 };
  const end = g.time + days * DAY;
  let next = g.time + HOUR;
  const mins = () => +((g.time - s.t0) / 60).toFixed(1);
  const done = (b: Building) => !b.plant!.site && b.built >= 1;
  while (g.time < end) {
    feed(g);
    g.step(g.dt);
    // (the longest stand is read every step: a vehicle that stood and has since moved on still counts)
    if (g.traffic.vehicles.length) for (const v of g.traffic.vehicles) if (v.stuck > r.longest) r.longest = Math.round(v.stuck);
    if (r.firstMine === null && s.sites.some((b) => (b.kind === "ironmine" || b.kind === "coalmine") && done(b))) r.firstMine = mins();
    if (r.allSites === null && s.sites.every(done)) r.allSites = mins();
    if (r.firstSteel === null && s.sites.some((b) => b.kind === "smelter" && ((b.plant!.now.by?.steel ?? 0) > 0 || (b.plant!.out.steel ?? 0) > 0))) r.firstSteel = mins();
    if (g.time < next) continue;
    next += HOUR;
    const st = jamStats(s);
    r.samples.push(st);
    r.standing = Math.max(r.standing, st.standing);
    r.held = Math.max(r.held, st.held);
    r.trucksOut = Math.max(r.trucksOut, st.trucksOut);
    if (r.samples.length > settle) { r.minA = Math.min(r.minA, st.planksA); r.minB = Math.min(r.minB, st.planksB); }
    each?.(st);
  }
  r.breaks = g.traffic.jamBreaks;
  r.quits = g.traffic.jamQuits;
  return r;
}

export const HOURS = HOUR;
