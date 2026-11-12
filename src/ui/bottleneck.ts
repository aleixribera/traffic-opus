// The game names the bottleneck (play-test 2026-11-09: B1 "Village took 83 minutes because nothing said build a
// second Food Plant", D2, D4, A13, E2). A works at the top of what it can make, with a town still asking for more,
// used to read "Working normally"; the town read "Enough". Both were true and neither was any help. Here are the
// plain-word lines the panels, the tip and the Towns list say instead, and the arithmetic under them. The wording
// and the sums are pure (tests/bottleneck.test.ts); the functions that read the game only gather their figures.

import { BUILDING_TYPES, ROAD_TYPES } from "../config";
import type { Building } from "../game/buildings";
import { SEASONAL, seasonMult } from "../game/calendar";
import type { Game } from "../game/city";
import { buildTime } from "../game/construction";
import { HIST_HOURS, Industry, PLANTS, SITE_SHARE, aboutHours, PRODUCTS, powerPace, type PlantKind, type Product } from "../game/industry";
import { unlockedBy } from "../game/progression";
import { served, type Town } from "../game/settlements";
import { SITE_LEVELS } from "../game/sites";
import { Age, HOUR } from "../game/society";
import { SETTLING, demandPerDay, needsOf } from "../game/towns";
import { loadsLately, townNeeds, warmingUp } from "./needs";

// ------------------------------------------------------------------------------------------- the sums (pure)

/** From this share of what it can make, a works is at full output: the last tenth is the hour it happened to be read. */
export const FULL_OUTPUT = 0.9;
/** Hours of output a works must remember before its pace is called: a new one is still filling its first trucks. */
export const PACE_HOURS = 3;

export const atFullOutput = (madePerDay: number, canPerDay: number): boolean => canPerDay > 0 && madePerDay >= canPerDay * FULL_OUTPUT;

/** How many more works of a kind cover a shortfall (loads a day), each making `each` a day: at least one. */
export const worksFor = (more: number, each: number): number => (each > 0 && more > 0 ? Math.max(1, Math.ceil(more / each - 0.15)) : 0);

/** A wait in words (industry.ts: the works' own lines say waits too). */
export { aboutHours };

/**
 * Hours till a building site opens: the loads still to come at the pace they have been coming, then the build
 * itself. Null when nothing has come yet to judge a pace by.
 */
export function siteHours(left: number, perHour: number, buildHours: number): number | null {
  if (left <= 0) return buildHours;
  return perHour > 0 ? left / perHour + buildHours : null;
}

/**
 * The waits a building site's forecast is said in, each up to its top in game hours (review 2026-11-12, C2: the
 * Smelter site read 2, 3, 4, then 11 days, then 13 hours, and opened a day after "11 days"). A band, not a count:
 * deliveries come in truckloads, so an hour-exact figure only ever swings.
 */
export const SITE_BANDS: readonly { top: number; say: string }[] = [
  { top: 1, say: "under an hour" },
  { top: 8, say: "a few hours" },
  { top: 16, say: "about half a day" },
  { top: 36, say: "about a day" },
  { top: 84, say: "2 to 3 days" },
  { top: Infinity, say: "more than 3 days" },
];
/** The band a wait of `h` game hours falls in. */
export const bandOf = (h: number): number => SITE_BANDS.findIndex((b) => h < b.top);
/** Game hours a forecast must read a new band before the line moves to it (one band at a time). */
export const BAND_HOLD = 3;

/** A site's band as its line says it: the band, what supplies it, when last read, and a move it is waiting out. */
export interface BandState { i: number; key: string; at: number; pend?: number; since?: number }

/**
 * The band a site's line says next, given the wait forecast now (`hours`), the works that supply it (`key`) and the
 * game hour (`now`). It moves one band at a time, and only once the forecast has read that way for BAND_HOLD hours
 * on end; a works built or lost (a new `key`) says the new forecast at once, and so does a line nobody has read for
 * a while. Mutates and returns `st` (kept on the site, so it saves).
 */
export function nextBand(st: BandState | undefined, hours: number, key: string, now: number): BandState {
  const raw = bandOf(hours);
  if (!st || st.key !== key || now < st.at || now - st.at > BAND_HOLD) return { i: raw, key, at: now };
  st.at = now;
  if (raw === st.i) { delete st.pend; delete st.since; return st; }
  const step = st.i + Math.sign(raw - st.i);
  if (st.pend !== step || st.since === undefined) { st.pend = step; st.since = now; return st; }
  if (now - st.since >= BAND_HOLD) { st.i = step; delete st.pend; delete st.since; }
  return st;
}

/** A building site's line: "13 of 50 loads delivered, a few hours to go" (`band`: the band to say, else `hours`'s). */
export function siteLine(got: number, need: number, hours: number | null, band?: number): string {
  const n = `${Math.floor(got)} of ${need} loads delivered`;
  if (got >= need) return `All ${need} loads delivered, going up: ${aboutHours(hours ?? 0)} to go`;
  return hours === null ? n : `${n}, ${SITE_BANDS[band ?? bandOf(hours)].say} to go`;
}

const an = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");
const many = (n: number, name: string) => (n === 1 ? name : /(works|s)$/i.test(name) ? name : /[^aeiou]y$/i.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`);
/** A list of works by name, the same ones counted: "2 Coal Mines, Smelter", and past `max` kinds "and 3 more". */
export function tally(names: readonly string[], max = 3): string {
  const n = new Map<string, number>();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  const all = [...n].map(([name, k]) => (k > 1 ? `${k} ${many(k, name)}` : name));
  const rest = [...n].slice(max).reduce((a, [, k]) => a + k, 0);
  return all.slice(0, max).join(", ") + (rest ? ` and ${rest} more` : "");
}

const loads = (n: number) => `${n.toLocaleString("en-US")} more load${n === 1 ? "" : "s"}`;

/**
 * What a works at full output says under its status (B1): who would take more and how much, and the two ways out.
 * `taker`: the town or works that wants more; `more`: loads a day it would take (left out for one of the company's
 * own works, which just waits); `others`: more towns that want it too; `nextLevel`: the level it is growing to, if
 * it still grows.
 */
export function ceilingFix(o: { works: string; product: string; taker: string; more?: number; others?: number; nextLevel?: number | null }): string {
  const who = o.others ? `${o.taker} and ${o.others} more town${o.others === 1 ? "" : "s"}` : o.taker;
  const want = o.more ? `${who} would take ${loads(o.more)} of ${o.product} a day` : `${who} is waiting for ${o.product}`;
  return `${want}. Build another ${o.works}${o.nextLevel ? `, or wait for level ${o.nextLevel}` : ""}.`;
}

/** What to do about a town's short need (the town panel's row, the Towns list, the tip). */
export type NeedHelp =
  /** nothing the company owns makes it */
  | { kind: "none"; say: string; build: PlantKind }
  /** its makers are all at full output: more of them */
  | { kind: "full"; say: string; build: PlantKind; n: number; works: number }
  /** one of its makers is held up: that is the thing to look at */
  | { kind: "held"; say: string; works: number };

/** The sentence for each case, from plain figures. */
export function needHelpSay(o: { kind: "none"; works: string; product: string } | { kind: "full"; works: string; have: number; n: number } | { kind: "held"; works: string; problem: string }): string {
  if (o.kind === "none") return `Nothing of yours makes ${o.product} yet. Build ${an(o.works)} ${o.works}.`;
  if (o.kind === "full") return `Your ${o.have > 1 ? `${o.have} ${many(o.have, o.works)} are` : `${o.works} is`} at full output. Build ${o.n === 1 ? "another" : `about ${o.n} more`}.`;
  return `Your ${o.works} is held up: ${o.problem[0].toLowerCase()}${o.problem.slice(1)}.`;
}

/** Towns by name, two at most: "Alder Run", "Alder Run and Elton", "Alder Run, Elton and 1 more". */
const townList = (ns: readonly string[]): string => (ns.length <= 2 ? ns.join(" and ") : `${ns[0]}, ${ns[1]} and ${ns.length - 2} more`);

/**
 * What holds a works short of workers, and the way out the sim offers (staffing): a town on its roads, the people
 * there still free taking its jobs, or the towns there growing. Short: it sits under a town's status in four lines
 * at most (owner, 2026-11-10).
 */
export function staffSay(o: { towns: readonly string[]; spare: number }): string {
  if (!o.towns.length) return "No town is on its roads, so nobody can get to work there. Link it to a town by road.";
  const who = townList(o.towns);
  if (o.spare > 0) return `People from ${who} are taking its jobs.`;
  // (nobody left: every adult there works for the company, and the hiring never takes from one works for another)
  return `${who} ${o.towns.length === 1 ? "needs" : "need"} to grow to fill it, or link another town.`;
}

/** "6 of 12 jobs filled". */
export const jobsFilled = (s: Staffing): string => `${s.have} of ${s.jobs} jobs filled`;

/** A works short of workers, for the town's advice: "Your Sawmill has 6 of 12 workers. Alder Run needs to grow ...". */
export function workersSay(g: Game, b: Building): string {
  const s = staffing(g, b);
  return `Your ${nameOf(b.kind)} has ${s.have} of ${s.jobs} workers. ${staffSay({ towns: s.towns.map((t) => t.name), spare: s.spare })}`;
}

// ------------------------------------------------------------------------------------------- reading the game

const nameOf = (k: string) => BUILDING_TYPES[k as PlantKind].name;
const lower = (p: Product) => PRODUCTS[p].name.toLowerCase();
const working = (b: Building) => !!b.plant && !b.plant.site && b.built >= 1;

/** Hours of output a pace is read over: long enough that a farm's one load every three hours still counts as a pace. */
export const PACE_WINDOW = 12;

/**
 * What a works made over the hours its pace is read from: since its first load, the last PACE_WINDOW of them. Null
 * while it has no pace yet. `lump`: the most it made in one of those hours (output comes in whole batches, so a
 * count over a few hours is off by up to one of them).
 */
export function paceOf(b: Building, p: Product): { made: number; hours: number; lump: number } | null {
  const by = Industry.madeLately(b, p).byHour;
  const first = by.findIndex((v) => v > 0);
  if (first < 0) return null;
  const w = by.slice(Math.max(first, by.length - PACE_WINDOW));
  if (w.length < PACE_HOURS) return null;
  return { made: w.reduce((a, v) => a + v, 0), hours: w.length, lump: Math.max(...w) };
}

/** Loads of p a works made a day lately, or null while it has no pace yet. */
export function madePerDay(b: Building, p: Product): number | null {
  const x = paceOf(b, p);
  return x ? (x.made / x.hours) * 24 : null;
}

/** Under this share of what it can make, no batch that fell outside the hours read makes a works flat out. */
export const FLAT_FLOOR = 0.6;

/**
 * Is a works making all it can (give or take the batch that happened to fall outside the hours read)? Never on
 * that one batch alone: a Sawmill at a third of its pace, read over its first few hours, is not at full output.
 */
export function flatOut(g: Game, b: Building, p: Product): boolean {
  // (short of workers it is not making all it can, whatever its hours say: owner, 2026-11-10, a Sawmill with half its
  // jobs filled read "At full output")
  return staffPace(g, b) >= 1 && fullPace(g, b, p, 1);
}

/** Is a works making all that `share` of its pace allows (give or take the batch that fell outside the hours read)? */
function fullPace(g: Game, b: Building, p: Product, share: number): boolean {
  const x = paceOf(b, p);
  if (!x) return false;
  const can = canPerDay(g, b, p) * share;
  return (x.made / x.hours) * 24 >= can * FLAT_FLOOR && atFullOutput(((x.made + x.lump) / x.hours) * 24, can);
}

/** What it can make a day now: its level, its ground, the season. */
export function canPerDay(g: Game, b: Building, p: Product): number {
  return Industry.perDay(b, p) * (SEASONAL[b.kind] ? seasonMult(b.kind, g.time) : 1);
}

/**
 * The share of its pace a works' staff allow, as the sim reckons it: its share of jobs filled (industry.ts produce);
 * a power plant runs full from four fifths of them (utilities.ts output).
 */
export function staffPace(g: Game, b: Building): number {
  if (!b.cap) return 1;
  const s = g.people.workersAt(b.id) / b.cap;
  return PLANTS[b.kind as PlantKind]?.makes ? (s <= 0 ? 0 : Math.max(0.25, Math.min(1, s * 1.25))) : Math.min(1, s);
}

/** Who a works' staff are: how many of its jobs are filled, the towns on its roads and the adults there still free. */
export interface Staffing {
  have: number; jobs: number;
  /** the towns on its roads: the ones its staff live in first, most of them first */
  towns: Town[];
  /** adults on its roads with no job, or a town job: the next hiring brings them to it */
  spare: number;
}

// (read once a quarter hour, the sim's hiring pace, or when its staff or the roads change: a census of every adult is
// not per frame, and a town just linked by road must count at once, not a quarter hour on)
const staffSeen = new WeakMap<Building, { t: number; have: number; v: number; s: Staffing }>();

/**
 * Where a works' staff come from, as the sim hires them (society.ts matchJobs, every quarter hour): any adult whose
 * home is on its roads, however far, for the company's works before any town job, and a town job is given up for one.
 * So a works stays short only once every adult on its roads works for the company: then nothing but more people on
 * those roads fills it, and another works there would stand empty.
 */
export function staffing(g: Game, b: Building): Staffing {
  const have = g.people.workersAt(b.id), jobs = b.cap ?? 0;
  const seen = staffSeen.get(b);
  const q = Math.floor(g.time / (HOUR / 4));
  if (seen && seen.t === q && seen.have === have && seen.v === g.net.version && seen.s.jobs === jobs) return seen.s;
  const sends = new Map<Town, number>(), reach = new Set<Town>(), seg = b.access?.seg;
  let spare = 0;
  for (const c of g.people.citizens.values()) {
    if (c.age !== Age.Adult) continue;
    const home = g.buildings.byId.get(c.home);
    const t = home?.town === undefined ? undefined : g.towns.byId.get(home.town);
    if (c.job === b.id) { if (t) sends.set(t, (sends.get(t) ?? 0) + 1); continue; }
    if (seg === undefined || !home?.access || !g.connected(home.access.seg, seg)) continue;
    if (t) reach.add(t);
    if (c.job < 0 || !g.buildings.byId.get(c.job)?.placed) spare++;
  }
  const towns = [...sends].sort((x, y) => y[1] - x[1]).map(([t]) => t);
  for (const t of reach) if (!towns.includes(t)) towns.push(t);
  const s = { have, jobs, towns, spare };
  staffSeen.set(b, { t: q, have, v: g.net.version, s });
  return s;
}

/** Is a works short of workers with nobody left on its roads to hire: the thing holding it back. */
export const understaffed = (g: Game, b: Building): boolean => staffPace(g, b) < 1 && staffing(g, b).spare === 0;

/**
 * Loads an hour a works reads as making, beside what it can make: the one pace its panel, its status and the town's
 * advice all go by (paceOf). Never above what it can make: its output comes in whole batches, so the hours read can
 * hold one more than its pace allows (a camp read "0.7/h, can 0.6": owner, 2026-11-10), and a works the status
 * calls "At full output" shows exactly what it can make. Null: nothing made yet.
 */
export function shownRate(g: Game, b: Building, p: Product): { rate: number | null; can: number } {
  const can = canPerDay(g, b, p) / 24;
  // (short of power or of workers the sim works it at powerPace of its pace times its share of staff (industry.ts
  // produce), so it shows no more than that: the late save's Iron Mine read "No power, working at 40%" over "10 loads
  // a day, can 10", one early load over one hour. `can` stays the full figure, so the gap shows)
  const top = can * staffPace(g, b) * (PLANTS[b.kind as PlantKind]?.power ? powerPace(g.utilities.supplyOf(b)) : 1);
  const x = paceOf(b, p);
  // (short of power it is not making all it can, whatever a lumpy few hours say)
  if (x) return { rate: flatOut(g, b, p) && top >= can && !/^(No power|Short of power)/.test(b.problem ?? "") ? can : Math.min(top, x.made / x.hours), can };
  // (no pace yet: over the hours since its first load, fewer than PACE_HOURS of them)
  const by = Industry.madeLately(b, p).byHour, first = by.findIndex((v) => v > 0);
  if (first < 0) return { rate: null, can };
  const w = by.slice(first);
  return { rate: Math.min(top, w.reduce((a, v) => a + v, 0) / w.length), can };
}

/** The main product of a works (not its side product). */
export function mainOf(k: PlantKind): Product | undefined {
  const D = PLANTS[k];
  return (Object.keys(D.outputs) as Product[]).find((p) => p !== D.byproduct);
}

/** The kind of works that makes a product as its main line (a Food Plant for food). */
export function makerKind(p: Product): PlantKind | undefined {
  const ks = Object.keys(PLANTS) as PlantKind[];
  return ks.find((k) => mainOf(k) === p) ?? ks.find((k) => (PLANTS[k].outputs[p] ?? 0) > 0);
}

/**
 * Loads of p a day a town would still take to have plenty (0: it has plenty, or does not buy it yet, or its first
 * loads have only just started coming: needs.ts warmingUp. No advice to build more on a rate one load can't tell).
 */
export function townWants(t: Town, p: Product): number {
  if (!needsOf(t.pop).includes(p) || warmingUp(t, p)) return 0;
  const want = demandPerDay(p, t.pop), got = loadsLately(t, p);
  return got >= want - 1e-9 ? 0 : Math.max(1, Math.ceil(want - got - 1e-6));
}

/** Has none of a product the towns buy landed in a town yet (needHelp: no "build more" on a chain still starting)? */
const firstToLand = (g: Game, p: Product): boolean => (g.progress.sold[p] ?? 0) < 1;

/** The towns the company's trucks can sell to: all but one that sprang up and has had nothing yet. */
const markets = (g: Game) => g.towns.list.filter((t) => !t.spawned || served(t));

/**
 * Is a works of the company's short of an input: running under what it could make, with next to none of it in its
 * yard? Steadier than its problem line, which comes and goes with every load that lands.
 */
export function hungryFor(g: Game, o: Building, p: Product): boolean {
  if (!working(o)) return false;
  const D = PLANTS[o.kind as PlantKind], need = D.inputs[p] ?? 0;
  if (!need || o.problem?.includes("stuck in traffic")) return false;
  if ((o.plant!.stock[p] ?? 0) >= need * 2) return false;
  // (held up by something else: that is its own story)
  if (o.problem && !o.problem.startsWith(`Waiting for ${lower(p)}`)) return false;
  // (making all its staff allow, it is short of workers, not of this: its yard runs low because it uses all that comes)
  // (and with nobody at work, that is what holds it)
  const q = mainOf(o.kind as PlantKind), sp = staffPace(g, o);
  return !q || (sp > 0 && !fullPace(g, o, q, sp));
}

/**
 * The input a working works is short of, if any, once it has made something: what its panel and its mark on the map
 * go by, so they do not flick between "Waiting for logs" and "Working normally" with every load that lands.
 */
export function shortOf(g: Game, b: Building): Product | null {
  if (!working(b) || !hasMade(b)) return null;
  return (Object.keys(PLANTS[b.kind as PlantKind].inputs) as Product[]).find((p) => hungryFor(g, b, p)) ?? null;
}

/** The trouble line of a works for the map's marks: its own, or the steady "Waiting for logs" while it is short. */
export function steadyProblem(g: Game, b: Building): string | null {
  if (b.problem || !b.plant) return b.problem;
  const p = shortOf(g, b);
  return p ? `Waiting for ${lower(p)}` : null;
}

/**
 * The company's works that make p, when every one of them is open and flat out (so more of them is the way on):
 * nearest to `near` first, with the level the nearest is growing to. Null when one is held up, still being built or
 * under its pace, or when there are none.
 */
export function makersFlatOut(g: Game, p: Product, near: Building): { works: Building[]; nextLevel: number | null } | null {
  const d = (o: Building) => Math.hypot(o.c.x - near.c.x, o.c.y - near.c.y);
  const mine = g.industry.plants().filter((o) => o.id !== near.id && mainOf(o.kind as PlantKind) === p).sort((a, c) => d(a) - d(c));
  if (!mine.length || !mine.every((o) => working(o) && !o.problem && flatOut(g, o, p))) return null;
  const L = mine[0].plant!.level ?? 1;
  return { works: mine, nextLevel: L < SITE_LEVELS && !mine[0].plant!.why ? L + 1 : null };
}

export interface Ceiling {
  p: Product;
  /** loads a day: made lately, and the most it can make */
  made: number; can: number;
  /** the town that would take the most more, with how much; and how many other towns want more too */
  town?: { t: Town; more: number; others: number; total: number };
  /** one of the company's works waiting for it */
  works?: Building;
  /** the level it is growing to (null: fully grown, or held at its level) */
  nextLevel: number | null;
  /** the line under "At full output" */
  fix: string;
}

/**
 * A works at the top of what it can make while somebody would take more: null when it is held up (its problem line
 * says by what), still finding its pace, or when nobody is short of what it makes.
 */
export function ceilingOf(g: Game, b: Building): Ceiling | null {
  if (!working(b) || b.problem || !b.placed) return null;
  const k = b.kind as PlantKind, D = PLANTS[k];
  if (D.logistics || D.mega || D.makes) return null;
  const p = mainOf(k);
  if (!p) return null;
  const made = madePerDay(b, p), can = canPerDay(g, b, p);
  if (made === null || !flatOut(g, b, p)) return null;
  const L = b.plant!.level ?? 1;
  // (held at its level by a goal, or fully grown: there is no next level to wait for)
  const nextLevel = L < SITE_LEVELS && !b.plant!.why ? L + 1 : null;
  if (PRODUCTS[p].price > 0 && !firstToLand(g, p)) {
    const short = markets(g).map((t) => ({ t, more: townWants(t, p) })).filter((x) => x.more > 0).sort((a, c) => c.more - a.more);
    if (short.length) {
      const total = short.reduce((a, x) => a + x.more, 0);
      const town = { t: short[0].t, more: short[0].more, others: short.length - 1, total };
      return { p, made, can, town, nextLevel, fix: ceilingFix({ works: nameOf(k), product: lower(p), taker: town.t.name, more: total, others: town.others, nextLevel }) };
    }
  }
  // one of the company's own works standing idle for it
  const waiting = g.industry.plants().find((o) => o.id !== b.id && hungryFor(g, o, p));
  if (waiting) return { p, made, can, works: waiting, nextLevel, fix: ceilingFix({ works: nameOf(k), product: lower(p), taker: `Your ${startUp(g, waiting) ? "new " : ""}${nameOf(waiting.kind)}`, nextLevel }) };
  return null;
}

/** The first works at its ceiling, for the tip: the one whose customers are shortest. */
export function worstCeiling(g: Game): { b: Building; c: Ceiling } | null {
  let best: { b: Building; c: Ceiling } | null = null;
  for (const b of g.industry.plants()) {
    const c = ceilingOf(g, b);
    if (c && (!best || (c.town?.total ?? 0) > (best.c.town?.total ?? 0))) best = { b, c };
  }
  return best;
}

/**
 * What to do about a town's short need: build the works that makes it, build more of them (how many), or look at
 * the one that is held up. Null when the need is met, or when its makers are simply still getting going.
 */
export function needHelp(g: Game, t: Town, p: Product): NeedHelp | null {
  // (what is wrong with one works is said as it is now, never held past its mending: only what to build holds)
  return holdAdvice(g, `${t.id}:${p}`, needHelpNow(g, t, p), (h) => `${h.kind}:${"build" in h ? h.build : ""}:${"works" in h ? h.works : ""}`, (h) => h.kind !== "held");
}

/** Game hours a piece of advice holds before it may name another works to build or look at (review 2026-11-12, C6). */
export const ADVICE_HOLD = 3;

/**
 * The company's works as they stand: which there are, open or not, at what level. Advice may change at once when
 * this does (a works built, lost or grown is a real change); otherwise it holds (holdAdvice).
 */
export function worksKey(g: Game): string {
  return g.industry.plants().map((b) => `${b.id}${b.plant!.site ? "s" : b.built < 1 ? "u" : ""}${b.access ? "" : "x"}${b.plant!.level}`).join(",");
}

// (per game, the advice last given under each key: display only, not in the save)
const advised = new WeakMap<Game, Map<string, { sig: string; at: number; works: string; v: unknown }>>();

/**
 * Advice that holds (review 2026-11-12, C6: the food advice went from "build another Farm" to "build another Food
 * Plant" within a game day, as loads landed). Once a piece of advice is given under `key`, a different one (another
 * `sig`) waits ADVICE_HOLD game hours, unless the company's works changed (worksKey); the same advice comes through
 * at once with its figures fresh. No advice (null) passes through and keeps the last one's clock. `holds` says which
 * advice may be held at all (a works' own trouble is said as it stands: once mended, the line goes at once).
 */
export function holdAdvice<T>(g: Game, key: string, v: T | null, sig: (v: T) => string, holds: (v: T) => boolean = () => true): T | null {
  if (v === null) return v;
  let m = advised.get(g);
  if (!m) advised.set(g, (m = new Map()));
  const s = sig(v), now = g.time / HOUR, works = worksKey(g), e = m.get(key);
  if (e && e.sig !== s && e.works === works && now >= e.at && now - e.at < ADVICE_HOLD && holds(e.v as T)) return e.v as T;
  m.set(key, { sig: s, at: e && e.sig === s && e.works === works && now >= e.at ? e.at : now, works, v });
  return v;
}

/** Forget the advice given so far (a test that changes the map with the clock stopped). */
export const forgetAdvice = (g: Game): void => void advised.delete(g);

/** What to do about a town's short need now, with no hold (needHelp holds it). */
export function needHelpNow(g: Game, t: Town, p: Product): NeedHelp | null {
  const more = townWants(t, p);
  if (!more) return null;
  const kind = makerKind(p);
  if (!kind) return null;
  const mine = g.industry.plants().filter((b) => (PLANTS[b.kind as PlantKind].outputs[p] ?? 0) > 0 && mainOf(b.kind as PlantKind) === p);
  if (!mine.length) return { kind: "none", build: kind, say: needHelpSay({ kind: "none", works: nameOf(kind), product: lower(p) }) };
  // (none of it has landed in any town yet: its works are new, and how many more it takes is not known till their
  // loads come in, so no "at full output, build more" till then; a works held up still says so. Play-test 2026-11-10:
  // "Your Farm is at full output. Build another" while the first food was on the road, the one farm three times enough)
  const early = firstToLand(g, p);
  const near = (a: Building, c: Building) => Math.hypot(a.c.x - t.c.x, a.c.y - t.c.y) - Math.hypot(c.c.x - t.c.x, c.c.y - t.c.y);
  const up = mine.filter(working).sort(near);
  // (every town's shortfall of it: new works feed them all)
  const total = Math.max(more, markets(g).reduce((a, x) => a + townWants(x, p), 0));
  // (a jam or a missing input: that works is the thing to look at, not another one)
  // (one in real trouble before one only starting up, so the advice does not flick between the two as loads land)
  const helds = up.filter((b) => steadyProblem(g, b));
  const held = helds.find((b) => !startUp(g, b));
  const starting = helds.filter((b) => startUp(g, b));
  // (one new works starting up beside others flat out: the advice is still how many more, the new one counted in.
  // The late save's Food row talked about the new Food Plant's first load with 1,055 loads a day still short)
  const rest = up.filter((b) => !starting.includes(b));
  // (one short of workers with nobody left to hire: another works on those roads would stand empty, so the advice is
  // the towns, never to build more; only one on this town's roads: one short elsewhere says nothing of these)
  const thin = held ? undefined : rest.find((b) => understaffed(g, b) && staffing(g, b).towns.includes(t));
  if (thin) return { kind: "held", works: thin.id, say: workersSay(g, thin) };
  if (!early && !held && starting.length && rest.length && up.length === mine.length && rest.every((b) => flatOut(g, b, p))) {
    const each = rest.reduce((a, b) => a + canPerDay(g, b, p), 0) / rest.length;
    const n = worksFor(Math.max(0, total - starting.reduce((a, b) => a + canPerDay(g, b, p), 0)), each);
    const also = `Your new ${nameOf(starting[0].kind)} is starting up${starting.length > 1 ? `, and ${starting.length - 1} more` : ""}.`;
    if (n > 0) return { kind: "full", build: kind, n, works: rest[0].id, say: `${needHelpSay({ kind: "full", works: nameOf(rest[0].kind), have: rest.length, n })} ${also}` };
  }
  if (!held && starting.length) {
    // (a works that has made nothing yet is starting up: it says when its first load comes, not that it is held up)
    const su = startUp(g, starting[0])!;
    return { kind: "held", works: starting[0].id, say: `Your ${nameOf(starting[0].kind)} is starting up. ${su.fix}` };
  }
  if (held) {
    const problem = steadyProblem(g, held)!;
    if (/^(No workers|Not enough workers)/.test(problem)) return { kind: "held", works: held.id, say: workersSay(g, held) };
    // (short of an input whose makers are all flat out: the works to build is one of those, a step up the chain)
    const q = problem.includes("stuck in traffic") ? undefined : (Object.keys(PLANTS[held.kind as PlantKind].inputs) as Product[]).find((x) => problem.startsWith(`Waiting for ${lower(x)}`));
    const full = q ? makersFlatOut(g, q, held) : null;
    if (q && full) {
      if (early) return null;
      const k = full.works[0].kind as PlantKind, D = PLANTS[held.kind as PlantKind];
      // how many: enough of the input for what the works that take it could still make (no more than the towns want)
      const spare = up.reduce((a, b) => a + Math.max(0, canPerDay(g, b, p) - (madePerDay(b, p) ?? 0)), 0);
      const each = full.works.reduce((a, b) => a + canPerDay(g, b, q), 0) / full.works.length;
      const n = Math.max(1, worksFor((Math.min(total, spare) * (D.inputs[q] ?? 1)) / (D.outputs[p] ?? 1), each));
      return { kind: "full", build: k, n, works: full.works[0].id, say: `Your ${nameOf(held.kind)} is short of ${lower(q)}. ${needHelpSay({ kind: "full", works: nameOf(k), have: full.works.length, n })}` };
    }
    // (short of an input whose maker is short of workers: that maker's staff are the way on, not another of either)
    const lean = q ? g.industry.plants().find((o) => working(o) && mainOf(o.kind as PlantKind) === q && understaffed(g, o)) : undefined;
    if (q && lean) return { kind: "held", works: lean.id, say: `Your ${nameOf(held.kind)} is short of ${lower(q)}. ${workersSay(g, lean)}` };
    return { kind: "held", works: held.id, say: needHelpSay({ kind: "held", works: nameOf(held.kind), problem: problem.split(": ")[0] }) };
  }
  if (!early && up.length && up.length === mine.length && up.every((b) => flatOut(g, b, p))) {
    const each = up.reduce((a, b) => a + canPerDay(g, b, p), 0) / up.length;
    const n = worksFor(total, each);
    return { kind: "full", build: kind, n, works: up[0].id, say: needHelpSay({ kind: "full", works: nameOf(up[0].kind), have: up.length, n }) };
  }
  return null;
}

/**
 * The one piece of advice a town's panel gives (owner, 2026-11-10: a joined town said the same thing three times,
 * once on its status line, once per need as a sentence and once per need as advice). About one need only: the first
 * that has none coming, else the first running low, else the one its growth stands on. It says what to do (the works
 * to build or to look at: needHelp), or failing that how much to bring. `works`: the one to show. Null when the town
 * has what it needs, or is still settling in.
 */
export function townAdvice(g: Game, t: Town, joined: boolean): { p: Product; say: string; works?: number } | null {
  if (t.pop < SETTLING || (t.spawned && !served(t))) return null;
  const views = townNeeds(t);
  const short = views.filter((v) => v.state === "none" || v.state === "low");
  const worst = views.find((v) => v.state === "none") ?? short[0] ?? (t.trend < 0.5 && t.limit ? views.find((v) => v.p === t.limit && v.state !== "plenty") : undefined);
  if (!worst) return null;
  const nh = joined ? needHelp(g, t, worst.p) : null;
  // (several short: which to see to first, so the line under the status is still one piece of advice)
  const lead = short.length > 1 ? `Start with ${lower(worst.p)}. ` : "";
  return { p: worst.p, say: lead + (nh ? nh.say : worst.say), works: nh && "works" in nh ? nh.works : undefined };
}

/**
 * The order to build a set of newly unlocked works in. A works that powers the others comes first, when it can burn
 * something the company already has (the Power Plant runs on the sawmills' wood chips): every works that draws
 * power stands at 40% without it, so it is needed before any of them, not third (owner, 2026-11-10). After that, one
 * that feeds another comes before it, and what feeds the power plant before the rest (the coal mine, then the iron
 * mine, then the smelter). Play-test 2026-11-09, B5: "which first? what feeds what?"
 */
export function buildOrder(ks: readonly PlantKind[]): PlantKind[] {
  const makes = (k: PlantKind, p: string) => (PLANTS[k].outputs[p as Product] ?? 0) > 0;
  const draws = ks.some((k) => PLANTS[k].power);
  // (its other fuel is made by a works from an earlier goal: nothing in this set has to come before it)
  const power = draws ? ks.filter((k) => PLANTS[k].makes && Object.keys(PLANTS[k].inputs).every((p) => !!PLANTS[k].alt?.[p as Product] && !ks.some((o) => makes(o, PLANTS[k].alt![p as Product]!)))) : [];
  const left = ks.filter((k) => !power.includes(k)), out: PlantKind[] = [...power];
  const feedsPower = (k: PlantKind) => power.some((w) => Object.keys(PLANTS[w].inputs).some((p) => makes(k, p)));
  while (left.length) {
    const free = left.filter((k) => !Object.keys(PLANTS[k].inputs).some((p) => left.some((o) => o !== k && makes(o, p))));
    const next = free.find(feedsPower) ?? free[0] ?? left[0];
    out.push(...left.splice(left.indexOf(next), 1));
  }
  return out;
}

/** One thing the towns are short of, across the map: the job the Goals card names once every goal is reached (E2). */
export interface Shortfall { p: Product; more: number; towns: number; worst: Town; say: string }

/**
 * What the towns are short of, the biggest first, each with what to do about it ("Your 5 Food Plants are at full
 * output. Build about 3 more."). The figures the town panels already show, added up into works to build.
 */
export function shortfalls(g: Game, max = 3): Shortfall[] {
  const by = new Map<Product, { more: number; towns: number; worst: Town; top: number }>();
  for (const t of markets(g)) for (const p of needsOf(t.pop)) {
    const more = townWants(t, p);
    if (!more) continue;
    const e = by.get(p);
    if (!e) by.set(p, { more, towns: 1, worst: t, top: more });
    else { e.more += more; e.towns++; if (more > e.top) { e.top = more; e.worst = t; } }
  }
  return [...by].sort((a, b) => b[1].more - a[1].more).slice(0, max).map(([p, e]) => {
    const who = e.towns > 1 ? `${e.worst.name} and ${e.towns - 1} more town${e.towns === 2 ? "" : "s"}` : e.worst.name;
    const help = needHelp(g, e.worst, p);
    return { p, more: e.more, towns: e.towns, worst: e.worst, say: help ? `${who}. ${help.say}` : `${who}. Your works are still getting up to pace.` };
  });
}

// ------------------------------------------------------------------------------------------- held in traffic

/** Why a junction holds a vehicle, in plain words (the sim's own names were shown raw: "Held at the junction ahead: box"). */
const BLOCK_WORDS: Record<string, string> = {
  box: "the road past the junction is full, so it waits for room",
  red: "the light is red",
  yield: "it gives way to traffic that has priority",
  stop: "it is at a stop sign, waiting for a gap",
  courtesy: "it is letting another vehicle out",
  crossing: "traffic is crossing ahead of it",
  reserved: "another vehicle has the junction, and it waits its turn",
};
export const blockWords = (why: string | undefined): string => (why && BLOCK_WORDS[why]) || "it waits for the junction ahead to clear";
/** What to do about each, where there is something to do. */
const BLOCK_FIX: Record<string, string> = {
  box: "The jam starts further on: follow the queue to its head",
  yield: "A roundabout here gives it its turn",
  stop: "A roundabout here gives it its turn",
  crossing: "A roundabout here gives it its turn",
};
export const blockFix = (why: string | undefined): string => (why && BLOCK_FIX[why]) || "Open the junction to see its queues";

// ------------------------------------------------------------------------------------------- building sites

/**
 * A works held up for an input says where its next load is (A13: a new Food Plant read "Waiting for crops: build or
 * connect a plant that makes it" for nine hours with two farms full): the nearest of the company's works that
 * makes it, and about how long till a load is here. `first`: it has never had any, so this is it starting up.
 */
export function nextLoad(g: Game, b: Building, p: Product): { from: Building | null; hours: number | null; building: boolean; say: string } {
  const makes = (o: Building) => o.id !== b.id && !!o.plant && (PLANTS[o.kind as PlantKind].outputs[p] ?? 0) > 0;
  const d = (o: Building) => Math.hypot(o.c.x - b.c.x, o.c.y - b.c.y);
  const mine = g.industry.plants().filter(makes).sort((x, y) => d(x) - d(y));
  const name = lower(p);
  if (!mine.length) {
    const k = makerKind(p);
    return { from: null, hours: null, building: false, say: `Nothing of yours makes ${name} yet${k ? `. Build ${an(nameOf(k))} ${nameOf(k)}` : ""}` };
  }
  const where = (o: Building) => `${nameOf(o.kind)} ${d(o) < 950 ? `${Math.round(d(o) / 10) * 10} m` : `${(d(o) / 1000).toFixed(1)} km`} away`;
  // a load already on the road to it
  let best: { o: Building; s: number } | null = null;
  const drive = (m: number) => (m * 1.35) / (ROAD_TYPES.street.speed * 0.8) + 30;
  for (const tr of g.trips()) {
    const h = tr.haul;
    if (!h || h.done || h.leg !== "out" || h.dest !== b.id || h.product !== p) continue;
    const o = g.buildings.byId.get(h.plant);
    if (!o) continue;
    // (how long it has left: the whole drive, less the time it has been out)
    const s = Math.max(60, drive(d(o)) - Math.max(0, g.time - tr.startT));
    if (!best || s < best.s) best = { o, s };
  }
  if (best) return { from: best.o, hours: best.s / HOUR, building: false, say: `A load of ${name} is on the way from your ${where(best.o)}: ${aboutHours(best.s / HOUR)}` };
  const up = mine.filter(working);
  if (!up.length) return { from: mine[0], hours: null, building: true, say: `Your ${where(mine[0])} is still being built. It sends ${name} once it opens` };
  // none on the road: the nearest works that makes it, its next batch and the drive
  const o = up[0], P = o.plant!, D = PLANTS[o.kind as PlantKind];
  const perDay = canPerDay(g, o, p);
  const batch = perDay > 0 ? ((D.outputs[p] ?? 1) * 24 * HOUR) / perDay : D.cycle;
  const wait = (P.out[p] ?? 0) >= 1 ? 0 : (1 - Math.min(1, P.prog)) * batch;
  const hours = (wait + drive(d(o))) / HOUR;
  return { from: o, hours, building: false, say: `Your ${where(o)} sends the next ${name}: ${aboutHours(hours)}` };
}

// ------------------------------------------------------------------------------------------- starting up, and waiting

const where = (o: Building, from: Building) => {
  const d = Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y);
  return `${nameOf(o.kind)} ${d < 950 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`} away`;
};

/** Does a kind of works take a product in (as an input, or in place of one)? */
const takes = (k: PlantKind, p: Product) => (PLANTS[k].inputs[p] ?? 0) > 0 || Object.values(PLANTS[k].alt ?? {}).includes(p);

/**
 * Hours a works takes over one batch of p: `whole` fully staffed and powered, and `left` for the batch in hand at
 * the staff and power it has now (null: nobody at work). The sim's own sum (industry.ts produce), read out.
 */
export function batchHours(g: Game, b: Building, p: Product): { whole: number; left: number | null } {
  const D = PLANTS[b.kind as PlantKind], P = b.plant!;
  const can = canPerDay(g, b, p);
  const whole = can > 0 ? ((D.outputs[p] ?? 1) * 24) / can : D.cycle / HOUR;
  const staff = b.cap ? Math.min(1, g.people.workersAt(b.id) / b.cap) : 1;
  const pw = D.power ? powerPace(g.utilities.supplyOf(b)) : 1;
  return { whole, left: staff * pw > 0 ? ((1 - Math.min(1, P.prog)) * whole) / (staff * pw) : null };
}

/** Game hours a new works may stand without staff before that is trouble: its first workers are on their way. */
export const START_HOURS = 6;
// when each works was first seen open with nothing made yet (display only: not in the save)
const openedAt = new WeakMap<Building, number>();

/** Where the first load of a works will go, as the end of its starting-up line. */
function firstTruck(g: Game, b: Building, p: Product): string {
  if (PRODUCTS[p].price > 0) return " Then its first truck leaves for the shops.";
  const mine = g.industry.plants().filter((o) => o.id !== b.id && takes(o.kind as PlantKind, p));
  const near = (a: Building, c: Building) => Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) - Math.hypot(c.c.x - b.c.x, c.c.y - b.c.y);
  const up = mine.filter(working).sort(near)[0];
  if (up) return ` Then its first truck leaves for your ${where(up, b)}.`;
  const going = [...mine].sort(near)[0];
  if (going) return ` Your ${where(going, b)} takes it once it opens.`;
  const k = (Object.keys(PLANTS) as PlantKind[]).find((x) => takes(x, p) && g.placedUnlocked(x));
  return k ? ` Nothing of yours takes ${lower(p)} yet: build ${an(nameOf(k))} ${nameOf(k)} on its roads.` : "";
}

/**
 * A works that is open and has made nothing yet is starting up, not in trouble (owner, 2026-11-10: "the first ten
 * game hours are quiet": a new Farm read "No workers" in red, then "Working normally, 0.0/h"). It says what it is
 * doing and when its first truck leaves: its workers on their way, the load of an input it waits for, or the batch in
 * hand and how long that has to go. Null once it has made something, and for anything that is real trouble (no
 * road, no works that makes its input, loads stuck in traffic, no staff after START_HOURS).
 */
export function startUp(g: Game, b: Building): { fix: string; hours: number | null } | null {
  if (!working(b) || !b.placed || !b.access || hasMade(b)) return null;
  // (a day on and still nothing made is no start-up any more, whatever holds it: its problem line says what)
  if ((b.plant!.hist?.length ?? 0) >= HIST_HOURS) return null;
  const k = b.kind as PlantKind, D = PLANTS[k];
  if (D.logistics || D.mega || D.makes) return null;
  const p = mainOf(k);
  if (!p) return null;
  if (!openedAt.has(b)) openedAt.set(b, g.time);
  const pr = b.problem ?? "", bh = batchHours(g, b, p);
  // (nobody at work yet, whether or not the sim has said so this hour)
  if (pr.startsWith("No workers") || (!pr && bh.left === null)) {
    if (pr && g.time - openedAt.get(b)! > START_HOURS * HOUR) return null;
    return { hours: null, fix: `Its first workers are on their way from town. Once they start, its first load of ${lower(p)} takes ${aboutHours(bh.whole)}.` };
  }
  if (pr.startsWith("Waiting for")) {
    if (pr.includes("stuck in traffic")) return null;
    const q = (Object.keys(D.inputs) as Product[]).find((x) => pr.startsWith(`Waiting for ${lower(x)}`));
    const next = q ? nextLoad(g, b, q) : null;
    // (nothing of the company's makes it: that is the thing to build, not a wait)
    if (!next?.from) return null;
    return { hours: next.hours === null ? null : next.hours + bh.whole, fix: `${next.say}. Its first load of ${lower(p)} follows ${aboutHours(bh.whole)} after that.` };
  }
  if ((pr && !pr.startsWith("Not enough workers")) || bh.left === null) return null;
  return { hours: bh.left, fix: `Its first load of ${lower(p)} is ready in ${aboutHours(bh.left)}.${firstTruck(g, b, p)}` };
}

/** What a works going up says about after it opens: when its first load follows, or what it will wait for. */
export function afterOpening(g: Game, b: Building): string {
  const k = b.kind as PlantKind, D = PLANTS[k];
  const p = mainOf(k);
  if (!p || D.logistics || D.mega || D.makes) return "";
  const q = (Object.keys(D.inputs) as Product[])[0];
  if (!q) return ` Its first load of ${lower(p)} follows ${aboutHours(batchHours(g, b, p).whole)} later.`;
  const next = nextLoad(g, b, q);
  return next.from && !next.building ? ` Then it takes ${lower(q)} from your ${where(next.from, b)}.` : ` ${next.say}.`;
}

/**
 * A works whose yard fills because the works that will take its product is not open yet: it is waiting for that one,
 * and says how far along it is (owner, 2026-11-10: an Iron Mine read "no smelter on its roads" with the Smelter a
 * building site two fields away). `show`: the works it waits for. Null when one of the company's works that takes
 * it is open (then the haul is the story), or the product is one the towns buy.
 */
export function waitsForSite(g: Game, b: Building): { text: string; tone: "bad" | ""; fix: string; show?: number } | null {
  if (!working(b) || !b.problem) return null;
  // (the sim's lines for it, full or not: "Full of iron ore: the plants that will use iron ore are still building
  // sites", "Full of steel: no construction plant … on your roads takes steel", and the older full line)
  const m = /^Full of (.+?): (?:its trucks can't keep up .*or no .+ on its roads|no .+ on your roads (?:takes|needs) .+|the plants that will use .+ are still building sites)$/.exec(b.problem)
    ?? /^The plants that will use (.+) are still building sites$/.exec(b.problem);
  if (!m) return null;
  const p = (Object.keys(PLANTS[b.kind as PlantKind].outputs) as Product[]).find((q) => lower(q) === m[1]);
  if (!p || PRODUCTS[p].price > 0) return null;
  const mine = g.industry.plants().filter((o) => o.id !== b.id && takes(o.kind as PlantKind, p));
  if (mine.some(working)) return null;
  const d = (o: Building) => Math.hypot(o.c.x - b.c.x, o.c.y - b.c.y);
  const o = [...mine].sort((x, y) => d(x) - d(y))[0];
  if (o) {
    const how = o.plant!.site ? `is a building site: ${siteStatus(g, o).line}` : `is going up: it opens in ${aboutHours(((1 - o.built) * buildTime(o.kind)) / HOUR)}`;
    return { text: `Waiting for your ${nameOf(o.kind)} to open`, tone: "", fix: `Your ${where(o, b)} ${how}. It takes ${lower(p)} once it opens. Until then this yard fills.`, show: o.id };
  }
  const ks = (Object.keys(PLANTS) as PlantKind[]).filter((x) => takes(x, p));
  const k = ks.find((x) => g.placedUnlocked(x));
  if (k) return { text: `Nothing of yours takes ${lower(p)} yet`, tone: "bad", fix: `Build ${an(nameOf(k))} ${nameOf(k)} on its roads: it takes ${lower(p)}. Until then this yard fills.` };
  const goal = ks.length ? unlockedBy((u) => u.buildings?.includes(ks[0])) : undefined;
  const a = ks.length ? an(nameOf(ks[0])) : "";
  return ks.length ? { text: `Nothing takes ${lower(p)} yet`, tone: "", fix: `${a[0].toUpperCase()}${a.slice(1)} ${nameOf(ks[0])} takes it${goal ? `: that opens with the goal “${goal.name}”` : ""}. Until then this yard fills.` } : null;
}

/**
 * What to do about a works short of power, said for the map as it is (owner, 2026-11-10: a Coal Mine read "Build a
 * power plant within reach" with one 290 m away, standing dark for want of coal). The power plant that reaches it
 * and why it gives too little; else the one going up; else the one too far off; else build one. `show`: the power
 * plant to look at; `back`: its power came back since the sim's hourly line was written. Null when it is not short of
 * power.
 */
export function powerFix(g: Game, b: Building): { fix: string; show?: number; back?: boolean } | null {
  if (!b.problem || !/^(No power|Short of power)/.test(b.problem)) return null;
  const d = (o: Building) => Math.hypot(o.c.x - b.c.x, o.c.y - b.c.y);
  const makers = g.buildings.list.filter((o) => o.plant && (PLANTS[o.kind as PlantKind]?.makes ?? 0) > 0).sort((x, y) => d(x) - d(y));
  const reach = (o: Building) => PLANTS[o.kind as PlantKind].reach ?? 0;
  const near = makers.filter((o) => working(o) && g.utilities.reaches(o, b));
  if (near.length) {
    // (its problem line is the sim's hourly one; power is shared out eight times an hour: it can be back already)
    if (g.utilities.supplyOf(b) >= 0.999) return { fix: "It is up to pace again within the hour.", show: near[0].id, back: true };
    // (out of fuel: the trouble is its coal, so say where the next load is; making some but not enough: another)
    const dark = near.find((o) => g.utilities.outputOf(o) <= 0);
    if (dark) {
      const P = dark.plant!, D = PLANTS[dark.kind as PlantKind];
      if (!D.mega && (P.stock.coal ?? 0) < 1) {
        const next = nextLoad(g, dark, "coal");
        // (the coal it waits for is this very mine's, coming slowly for want of the power it would give back)
        const then = !next.from ? "It burns coal, or your sawmills' wood chips: join one to it by road."
          : next.from.id === b.id ? `This mine sends it coal${next.hours !== null ? `: the next load in ${aboutHours(next.hours)}` : ""}. Without power that comes slowly; wood chips from a sawmill would start it sooner.`
          : `Its next coal comes from your ${nameOf(next.from.kind)}${next.hours !== null ? `: ${aboutHours(next.hours)}` : ""}.`;
        return { fix: `Your ${where(dark, b)} has nothing to burn. ${then}`, show: dark.id };
      }
      return { fix: `Your ${where(dark, b)} makes no power: ${dark.problem ? dark.problem.split(": ")[0].toLowerCase() : "it has nobody at work"}.`, show: dark.id };
    }
    return { fix: `Your ${where(near[0], b)} cannot power everything in its reach. Build another Power Plant nearby.`, show: near[0].id };
  }
  const going = makers.find((o) => !working(o) && d(o) <= reach(o));
  if (going) {
    const how = going.plant!.site ? `is a building site: ${siteStatus(g, going).line}` : `is going up: it opens in ${aboutHours(((1 - going.built) * buildTime(going.kind)) / HOUR)}`;
    return { fix: `Your ${where(going, b)} ${how}. It powers this works once it opens.`, show: going.id };
  }
  const far = makers.find(working);
  if (far) {
    const r = reach(far);
    const why = d(far) > r ? `is too far: power reaches ${r / 1000} km` : "is not on the same roads";
    return { fix: `Your ${where(far, b)} ${why}. Build a Power Plant within ${PLANTS.coalplant.reach! / 1000} km of this works, on its roads.`, show: far.id };
  }
  return { fix: `Build a Power Plant within ${PLANTS.coalplant.reach! / 1000} km of it, on its roads. It burns coal, or your sawmills' wood chips.` };
}

/** Has a works made anything yet (false: it is starting up, not in trouble)? */
export function hasMade(b: Building): boolean {
  const k = b.kind as PlantKind;
  return (Object.keys(PLANTS[k].outputs) as Product[]).some((p) => Industry.madeLately(b, p).made > 0) || (b.plant?.last.made ?? 0) > 0 || (b.plant?.now.made ?? 0) > 0;
}

/** One material a building site still waits for, and the supply the forecast reads for it (siteForecast). */
export interface SiteSupply {
  p: Product;
  /** loads still to land, and of those the ones on the road or waiting at a gate for it now */
  left: number; onWay: number;
  /** loads other sites on its roads wait for first: the dispatcher sends to the site nearest done first */
  ahead: number;
  /** loads an hour its makers on its roads make, the towns there buy, and this site can count on of that */
  out: number; towns: number; rate: number;
  /** game hours from a maker's gate to the site's */
  drive: number;
  makers: Building[];
  /** game hours till its last load lands (null: nothing that makes it reaches the site) */
  hours: number | null;
}

/** What a site's forecast is read from, and the wait it comes to. */
export interface SiteForecast {
  /** game hours till the last load lands (null: a material nothing on its roads makes) */
  hours: number | null;
  /** the works that supply it, as a key: a change here is a real change in supply */
  key: string;
  by: SiteSupply[];
}

/** The loads a works is reckoned to make an hour now: its pace lately, or before it has one, what its staff allow. */
function makesPerHour(g: Game, o: Building, p: Product): number {
  const r = shownRate(g, o, p);
  return r.rate ?? r.can * staffPace(g, o);
}

/**
 * How long a works' building site waits for the rest of its materials, from what supplies it (review 2026-11-12,
 * C2): per material, the output of the company's works on its roads that make it, less what the towns there buy
 * (towns come first; a site always gets SITE_SHARE of it: industry.ts customers), the loads other sites nearer done
 * wait for first, and the loads already on the road to it. Its own deliveries only cap the wait once it has had six
 * hours of them: they come in truckloads, so on their own they cannot say a pace.
 */
export function siteForecast(g: Game, b: Building): SiteForecast {
  const s = b.plant?.site, seg = b.access?.seg;
  const by: SiteSupply[] = [];
  if (!s) return { hours: 0, key: "", by };
  // (the loads on their way to each site, by material: on the road, or waiting in a yard to pull out)
  const onWay = new Map<string, number>();
  for (const tr of g.trips()) {
    const h = tr.haul;
    if (!h || h.done || h.leg !== "out") continue;
    const k = `${h.dest}:${h.product}`;
    onWay.set(k, (onWay.get(k) ?? 0) + h.n);
  }
  const on = (o: Building, p: Product) => onWay.get(`${o.id}:${p}`) ?? 0;
  const reach = (o: Building) => seg !== undefined && !!o.access && g.connected(seg, o.access.seg);
  const keys: string[] = [];
  for (const p of Object.keys(s.need) as Product[]) {
    const left = (s.need[p] ?? 0) - (s.got[p] ?? 0);
    if (left <= 0) continue;
    const makers = g.industry.plants().filter((o) => o.id !== b.id && working(o) && (PLANTS[o.kind as PlantKind].outputs[p] ?? 0) > 0 && reach(o));
    for (const o of makers) keys.push(`${o.id}.${o.plant!.level}`);
    const out = makers.reduce((a, o) => a + makesPerHour(g, o, p), 0);
    // (what the towns on its roads buy of it in an hour, a day's use spread over the day)
    let towns = 0;
    if (PRODUCTS[p].price > 0) for (const o of g.industry.buyersOf(b, p)) {
      const t = o.town === undefined ? undefined : g.towns.byId.get(o.town);
      if (t && needsOf(t.pop).includes(p)) towns += demandPerDay(p, t.pop) / 24;
    }
    const rate = Math.max(out * SITE_SHARE, out - towns);
    const mine = left - on(b, p);
    // (the other works' sites on its roads nearer done than this one: their loads go first)
    let ahead = 0;
    for (const o of g.industry.plants()) {
      const os = o.plant!.site;
      if (o.id === b.id || !os || PLANTS[o.kind as PlantKind].mega || !reach(o)) continue;
      const theirs = (os.need[p] ?? 0) - (os.got[p] ?? 0) - on(o, p);
      // (which sites compete is part of the supply: one finishing is a real change, said at once. Not which of them
      // is ahead, which swings as loads land)
      if ((os.need[p] ?? 0) > (os.got[p] ?? 0)) keys.push(`site${o.id}`);
      if (theirs > 0 && (theirs < mine || (theirs === mine && o.id < b.id))) ahead += theirs;
    }
    const near = makers.reduce((a, o) => Math.min(a, g.industry.tripTo(o, b)), Infinity);
    const drive = near < Infinity ? near / HOUR : 0;
    const hours = rate > 0 ? Math.max(0, ahead + mine) / rate + drive : null;
    by.push({ p, left, onWay: on(b, p), ahead, out, towns, rate, drive, makers, hours });
  }
  let hours: number | null = 0;
  for (const x of by) hours = hours === null || x.hours === null ? null : Math.max(hours, x.hours);
  // (six hours and more of its own deliveries: never a longer wait than they say)
  const e = Industry.siteEta(b);
  if (hours !== null && e?.hours && (s.hours?.length ?? 0) >= 6) hours = Math.min(hours, e.hours);
  return { hours, key: `${b.access ? "road" : "none"}|${keys.sort().join(",")}`, by };
}

/**
 * The whole line for a company building site: loads in, and about how long till it opens. The count is the sim's
 * own (Industry.siteEta); the wait is forecast from what supplies it (siteForecast) and said as a band that moves one
 * step at a time (nextBand), so the panel and the goal line, which both read this, say the same steady thing.
 */
export function siteStatus(g: Game, b: Building): { line: string; got: number; need: number; hours: number | null; slow: boolean; f: SiteForecast } {
  const e = Industry.siteEta(b) ?? { got: 0, need: 0, perHour: 0, hours: 0 };
  const s = b.plant?.site, build = buildTime(b.kind) / HOUR;
  const f = siteForecast(g, b);
  const hours = e.got >= e.need ? build : f.hours === null || !b.access ? null : f.hours + build;
  if (!s || hours === null || e.got >= e.need) return { line: siteLine(e.got, e.need, hours), got: e.got, need: e.need, hours, slow: false, f };
  s.band = nextBand(s.band, hours, f.key, g.time / HOUR);
  return { line: siteLine(e.got, e.need, hours, s.band.i), got: e.got, need: e.need, hours, slow: s.band.i >= bandOf(36), f };
}

/**
 * The material a site waits for that the towns on its roads take most of: they buy over half of what its makers
 * make, and the site gets under half ("Towns are buying most of your planks"). Null when the site gets most of it.
 */
export function townsFirst(f: SiteForecast): Product | null {
  return f.by.find((y) => y.out > 0 && y.towns >= y.out * 0.5 && y.rate < y.out * 0.5)?.p ?? null;
}

/**
 * Whether another of the works that makes a site's slowest material would open the site sooner by enough to say so,
 * counting the time that works takes to go up and make its first load (review 2026-11-12: "another Sawmill" was
 * advised, $16,160, for a site that filled before it could have opened). Only for a site days off whose makers are all
 * at full output, and only with the input the new one would run on to spare. The kind to build, or null.
 */
export function siteMoreHelp(g: Game, f: SiteForecast, waitHours: number | null): PlantKind | null {
  if (waitHours === null || waitHours < 36) return null;
  const x = f.by.filter((y) => y.hours !== null).sort((a, c) => c.hours! - a.hours!)[0];
  if (!x || !x.makers.length || x.rate <= 0) return null;
  const k = makerKind(x.p);
  if (!k || !g.placedUnlocked(k)) return null;
  if (!x.makers.every((o) => !o.problem && flatOut(g, o, x.p))) return null;
  const D = PLANTS[k], add = ((D.outputs[x.p] ?? 0) * HOUR) / D.cycle;
  // (the input the new one would run on: what its makers make beyond what the works that take it use)
  for (const q of Object.keys(D.inputs) as Product[]) {
    const made = g.industry.plants().filter((o) => working(o) && (PLANTS[o.kind as PlantKind].outputs[q] ?? 0) > 0).reduce((a, o) => a + makesPerHour(g, o, q), 0);
    const used = g.industry.plants().filter((o) => working(o) && takes(o.kind as PlantKind, q)).reduce((a, o) => {
      const m = mainOf(o.kind as PlantKind), Do = PLANTS[o.kind as PlantKind];
      return a + (m ? (canPerDay(g, o, m) / 24) * ((Do.inputs[q] ?? 0) / (Do.outputs[m] ?? 1)) : 0);
    }, 0);
    if (made - used < add * (D.inputs[q] ?? 0) * 0.5) return null;
  }
  const t0 = buildTime(k) / HOUR + D.cycle / HOUR + x.drive;
  return moreSaves({ loads: Math.max(0, x.ahead + x.left - x.onWay), out: x.out, towns: x.towns, add, opens: t0 }) ? k : null;
}

/**
 * Would one more works open a site sooner by enough to be worth saying (at least 6 game hours, and a quarter of the
 * wait)? `loads`: the site's loads still to come (with those of sites ahead of it); `out`, `towns`: loads an hour its
 * makers make and the towns buy; `add`: loads an hour the new one makes; `opens`: game hours till its first load is
 * at the site. Till then the site gets what it gets now; it fills before then, and the new works is no help at all.
 */
export function moreSaves(o: { loads: number; out: number; towns: number; add: number; opens: number }): boolean {
  const rate = Math.max(o.out * SITE_SHARE, o.out - o.towns);
  if (rate <= 0) return false;
  const now = o.loads / rate;
  if (o.loads <= rate * o.opens) return false;
  const rate2 = Math.max((o.out + o.add) * SITE_SHARE, o.out + o.add - o.towns);
  const later = o.opens + (o.loads - rate * o.opens) / rate2;
  return now - later >= Math.max(6, now * 0.25);
}
