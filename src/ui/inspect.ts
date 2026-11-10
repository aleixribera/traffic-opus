// What the inspector says about the thing the player clicked, as data: one status line, three key numbers, the flow
// in and out, the level, and what to light up on the map. The HUD draws every kind on this one anatomy
// (docs/ui-style.md "Inspector"), so a farm, a town, a truck and a road all read the same way at a glance.
// Pure over the game state, so tests can check the numbers each kind picks.

import { BUILDING_TYPES, ROAD_TYPES, SIGNAL_COST } from "../config";
import { formatMoney, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { SEASONAL, SEASON_NAME, seasonMult, seasonOf } from "../game/calendar";
import { SEASON_WORD } from "./specials";
import { ZONE_GROUP } from "../game/growables";
import { DEPOT_REACH, Industry, MIN_DEPOSIT, PLANTS, PLANT_KINDS, PRODUCTS, isPlantKind, type PlantKind, type Product } from "../game/industry";
import { unlockedBy } from "../game/progression";
import { DEPOSITS, F } from "../world/gen";
import { STUCK_KEEP } from "./stuckAlerts";
import { LEVEL_MULT, SITE_LEVELS, growNeed } from "../game/sites";
import { HOUR } from "../game/society";
import { TOWN_SIZES, needFrom, sizeOf } from "../game/towns";
import { TRUCK_CLASSES } from "../game/trucks";
import { served, type Town } from "../game/settlements";
import { growthOf, townNeeds } from "./needs";
import { joinedUp } from "./tips";
import { aboutHours, afterOpening, blockFix, blockWords, ceilingOf, jobsFilled, makersFlatOut, needHelpSay, nextLoad, powerFix, shortOf, shownRate, siteStatus, staffPace, staffSay, staffing, startUp, townAdvice, understaffed, waitsForSite } from "./bottleneck";
import { buildTime } from "../game/construction";
import type { Lane } from "../roads/network";
import { dkDir, dkSeg } from "../sim/router";
import { poseOf } from "./pick";
import { stuckNow, type Vehicle } from "../sim/traffic";

/** The one thing selected on the map. */
export type Sel =
  | { k: "building"; id: number }
  | { k: "town"; id: number }
  | { k: "vehicle"; id: number }
  | { k: "seg"; id: number }
  | { k: "node"; id: number }
  | { k: "stop"; id: number }
  /** open ground where you clicked: a deposit, fertile soil, forest, water or hills (id: the field, GROUND_*) */
  | { k: "ground"; id: number; x: number; y: number }
  /** a stuck-traffic diamond: the vehicles standing round (x, y) */
  | { k: "stuck"; id: number; x: number; y: number };

export const sameSel = (a: Sel | null, b: Sel | null) =>
  !!a && !!b && a.k === b.k && a.id === b.id && (!("x" in a) || !("x" in b) || (a.x === b.x && a.y === b.y));

/** Good or bad (never colour alone: the words say it too); "" is neutral. */
export type Tone = "good" | "bad" | "";

export interface KeyNum {
  /** the big figure */
  value: string;
  /** a small unit after it ("/h", "/25") */
  unit?: string;
  /** the caption under it */
  label: string;
  tone?: Tone;
  /** a longer explanation (tooltip) */
  title?: string;
}

/** A chip in the flow strip: a product or a place; a place with `ref` can be clicked (it selects it). */
export interface FlowChip {
  /** product (icon) or building kind (icon) */
  product?: Product;
  kind?: string;
  /** a town (the town icon) */
  town?: boolean;
  text: string;
  /** small grey note after it: a distance, a share */
  note?: string;
  tone?: Tone;
  ref?: Sel;
}

export interface FlowRow { label: string; chips: FlowChip[] }

/** The one-click fix beside the advice: lights on junction `node` (and the rest of its cluster), at `cost`. */
export interface StatusAct { kind: "lights"; node: number; label: string; cost: number }

export interface PanelModel {
  /** the header's name and its small grey sub-name */
  title: string;
  sub?: string;
  /** a building kind or "town" / "truck" / "car" / "bus" / "road" / "junction" / "stop" (the icon) */
  icon: string;
  /** "Lv 1/4" */
  badge?: string;
  /**
   * The one voice of the thing: what state it is in, and under it the one piece of advice (`fix`), with the works
   * to look at for it (`show`: a "Show it" button that flies there)
   */
  status: { text: string; tone: Tone; fix?: string; tag?: string; show?: { id: number; kind: string }; act?: StatusAct };
  keys: KeyNum[];
  flow: FlowRow[];
  /** the level bar: from this level toward `to` (none: the top level) */
  level?: { from: string; to?: string; pct: number; line: string; tone?: Tone };
  /** what the map lights up */
  related: Related;
}

export interface Related {
  /** the selected building(s) themselves */
  self: number[];
  /** suppliers / origins (cream) and buyers / destinations (ochre) */
  from: number[];
  to: number[];
  /** vehicles to ring (a site's trucks on the road) */
  vehicles: number[];
  /** road pieces to wash */
  segs: number[];
  /** a vehicle whose remaining route is drawn */
  route?: number;
  /** goods (product-coloured, arrowed) and people (thin cream) moving between places, a to b */
  flows?: FlowLine[];
  /** rings on the ground: a plant's reach, a deposit's extent, a spot */
  rings?: Ring[];
  /** vehicles whose whole routes are drawn together, thicker where more of them share a road (a road's routes) */
  routes?: number[];
  /** road pieces drawn by their state instead of plain ochre: green now, red now, held up */
  segTone?: Record<number, "go" | "stop" | "bad">;
}

/** A line of goods or people from a to b; `ra` / `rb` how far short of each end to stop (a plot's half-size). */
export interface FlowLine { a: V2; b: V2; color: number; n: number; kind: "goods" | "people"; ra?: number; rb?: number }
export interface Ring { c: V2; r: number; tone: "reach" | "deposit" | "spot" | "here" }

const emptyRel = (): Related => ({ self: [], from: [], to: [], vehicles: [], segs: [] });

// ------------------------------------------------------------------------------------------- the trade ledger

/**
 * Who trades with whom lately: every company truck seen on an outbound run, by origin, destination and product.
 * Fed from the trips on the road a few times a second (cheap: one pass), forgotten after a few game hours, so a
 * site's panel can say where its loads go and come from even when no truck is out this minute.
 */
export class TradeLedger {
  /** "from>to>product" -> when last seen (sim time) */
  private seen = new Map<string, number>();
  private pruneT = 0;
  static KEEP = HOUR * 4;

  private game: Game | null = null;

  observe(g: Game) {
    // (a game loaded or started: what the last one traded means nothing here)
    if (g !== this.game) { this.game = g; this.clear(); }
    const now = g.time;
    for (const tr of g.trips()) {
      const h = tr.haul;
      if (!h || h.leg !== "out" || h.big) continue;
      this.seen.set(`${h.plant}>${h.dest}>${h.product}`, now);
    }
    if (now - this.pruneT > HOUR) {
      this.pruneT = now;
      for (const [k, t] of this.seen) if (now - t > TradeLedger.KEEP) this.seen.delete(k);
    }
  }

  /** Every remembered run: origin, destination, product, last seen. */
  *runs(): Iterable<{ from: number; to: number; p: Product; t: number }> {
    for (const [k, t] of this.seen) {
      const [a, b, p] = k.split(">");
      yield { from: +a, to: +b, p: p as Product, t };
    }
  }

  clear() { this.seen.clear(); this.pruneT = 0; }
}

// ------------------------------------------------------------------------------------------- formatting

export const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : Math.round(n).toLocaleString("en-US"));
/** A rate: one decimal under 10 ("0.7"), whole above. */
export const fmtRate = (n: number) => (n < 9.95 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));
/** Money with its sign; nothing at all is "$0", never "+$0" (a plus on nothing read as income: owner, 2026-11-10). */
export const signedMoney = (n: number) => (Math.round(n) === 0 ? formatMoney(0) : `${n > 0 ? "+" : "−"}${formatMoney(Math.abs(Math.round(n)))}`);
const km = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const lower = (p: Product) => PRODUCTS[p].name.toLowerCase();
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const toneOf = (share: number, good = 0.8, bad = 0.5): Tone => (share >= good ? "good" : share < bad ? "bad" : "");

/** A problem line "Headline: the cause" split in two, with what to do about it when the line doesn't say. */
export function splitProblem(p: string): { text: string; fix?: string } {
  const i = p.indexOf(": ");
  const text = i > 0 ? p.slice(0, i) : p;
  const rest = i > 0 ? p.slice(i + 2) : "";
  const fix = FIXES.find(([re]) => re.test(p))?.[1];
  const cause = rest ? rest[0].toUpperCase() + rest.slice(1) : "";
  return { text, fix: [cause, fix].filter(Boolean).join(". ") || undefined };
}

/** "No power: working at 40%" → "Working at 40%. ", the cause before the advice. */
const powerCause = (p: string): string => {
  const i = p.indexOf(": ");
  return i > 0 ? `${p[i + 2].toUpperCase()}${p.slice(i + 3)}. ` : "";
};

/** What to do for the problems whose line says only what is wrong. */
const FIXES: [RegExp, string][] = [
  [/^No road to the gate/, "Draw a road to its gate (the marker on the map)"],
  [/^No road access/, "Connect it to a road"],
  [/^No workers|^Not enough workers/, "Its staff come from the towns on its roads: link it to one by road, or let them grow"],
  [/^No power|^Short of power/, "Build a power plant within reach, and keep its coal coming"],
  [/^Idle: /, "Build plants within its reach"],
  [/^Out of food$/, "Your food plant's trucks stock the shops"],
];

// ------------------------------------------------------------------------------------------- names

/** The chip for a building: a town's building stands for its town; a site for itself, with its distance. */
function placeChip(g: Game, b: Building, from?: Building): FlowChip {
  if (!b.plant && b.town !== undefined) {
    const t = g.towns.byId.get(b.town);
    if (t) return { town: true, text: t.name, ref: { k: "town", id: t.id }, note: from ? km(Math.hypot(t.c.x - from.c.x, t.c.y - from.c.y)) : undefined };
  }
  return { kind: b.kind, text: BUILDING_TYPES[b.kind].name, ref: { k: "building", id: b.id }, note: from ? km(Math.hypot(b.c.x - from.c.x, b.c.y - from.c.y)) : undefined };
}

/** Merge chips that stand for the same place (two shops in one town are one town chip). */
function dedupe(chips: FlowChip[]): FlowChip[] {
  const seen = new Set<string>(), out: FlowChip[] = [];
  for (const c of chips) {
    const k = c.ref ? `${c.ref.k}:${c.ref.id}` : `${c.product}:${c.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- company sites

/** How many of a site's trucks are on a run now, and which vehicles they are. */
export function trucksOut(g: Game, b: Building): { busy: number; ids: number[] } {
  let busy = 0;
  for (const tr of g.trips()) if (tr.haul && !tr.haul.done && !tr.haul.big && tr.haul.plant === b.id) busy++;
  const ids: number[] = [];
  for (const v of g.traffic.vehicles) {
    const h = v.trip.haul;
    if (h && !h.done && (h.plant === b.id || (h.leg === "out" && h.dest === b.id))) ids.push(v.id);
  }
  return { busy, ids };
}

/** Who would take a product, short enough for a chip: "a power plant takes it" (play-test 2026-11-09, D7). */
export function takenBy(p: Product): string {
  const them = /[^s]s$/i.test(PRODUCTS[p].name) ? "them" : "it";
  // (what towns buy: from how many people, the fact a player can act on)
  if (PRODUCTS[p].price > 0 && Number.isFinite(needFrom(p))) return `towns buy ${them} from ${needFrom(p).toLocaleString("en-US")} people`;
  const ks = Industry.takers(p).split(/, | or /);
  const a = /^[aeiou]/i.test(ks[0]) ? "an" : "a";
  return `${a} ${ks[0]}${ks.length > 1 ? " or another works" : ""} takes ${them}`;
}

/**
 * A works nobody buys from: which town will, and from how many people. The sim's line alone ("Nobody your roads
 * reach buys planks") left a new sawmill beside a hamlet of 77 looking broken, when planks sell from 100.
 */
export function noBuyer(g: Game, b: Building): PanelModel["status"] | null {
  const m = /^Nobody your roads reach buys (.+)$/.exec(b.problem ?? "");
  if (!m || !isPlantKind(b.kind)) return null;
  const p = (Object.keys(PLANTS[b.kind].outputs) as Product[]).find((q) => lower(q) === m[1]);
  const at = p ? needFrom(p) : Infinity;
  if (!p || !Number.isFinite(at)) return null;
  const ts = [...g.towns.list].sort((a, c) => c.pop - a.pop);
  if (!ts.length) return null;
  const fix = ts[0].pop >= at
    ? `${ts[0].name} buys ${m[1]}. Join this works to it by road`
    : `Towns buy ${m[1]} from ${at.toLocaleString("en-US")} people. ${ts[0].name} has ${Math.round(ts[0].pop).toLocaleString("en-US")}. Until then it fills its yard`;
  return { text: `No buyer for ${m[1]} yet`, tone: ts[0].pop >= at ? "bad" : "", fix };
}

/**
 * A works waiting for an input says where its next load is, and what would end the wait (play-test 2026-11-09, A13,
 * D3): with its loads stuck in traffic the answer is the jam, never another plant; and when the works that feeds it
 * is at full output, that is the thing to build. (One that has never made anything is starting up: worksStatus.)
 */
function waitingFor(g: Game, b: Building): PanelModel["status"] | null {
  const D = PLANTS[b.kind as keyof typeof PLANTS];
  // (its problem line names the input; with the line quiet between two loads, the input it is steadily short of)
  const p = b.problem ? (Object.keys(D.inputs) as Product[]).find((q) => b.problem!.startsWith(`Waiting for ${lower(q)}`)) : shortOf(g, b);
  if (!p) return null;
  const text = b.problem?.split(": ")[0] ?? `Waiting for ${lower(p)}`;
  if (b.problem?.includes("stuck in traffic")) return { text, tone: "bad", fix: "The loads on their way are stuck in traffic. Clear that jam: the Traffic stuck sign on the map shows where. Another plant would only add trucks to it" };
  const next = nextLoad(g, b, p);
  // (the works that feeds it, flat out: more of them is the way on)
  const full = makersFlatOut(g, p, b);
  if (full) return { text, tone: "bad", fix: `${needHelpSay({ kind: "full", works: BUILDING_TYPES[full.works[0].kind].name, have: full.works.length, n: 1 })}${full.nextLevel ? ` Or wait: it grows to level ${full.nextLevel}.` : ""}` };
  // (a works short of power still works, slowly: it is not stopped, so it is not "held up")
  const pr = next.from?.problem ?? "", slow = /^(No power|Short of power): working at (\d+%)/.exec(pr);
  // (a power plant whose coal mine waits on this very plant's power: the two hold each other up, so name the way out)
  const loop = slow && D.makes && next.from && g.utilities.reaches(b, next.from);
  const chips = loop && D.alt?.coal === "chips" ? nextLoad(g, b, "chips") : null;
  // (its maker short of workers with nobody left to hire: no problem line of its own, but that is what holds it)
  const lean = !pr && next.from && !next.building && understaffed(g, next.from) ? staffing(g, next.from) : null;
  const held = lean ? ` It is short of workers: ${jobsFilled(lean)}.` : !pr || next.building ? "" : loop ? ` It works at ${slow![2]}: it waits for this plant's own power. ${chips?.from ? `${chips.say}, and that gets both going.` : "Wood chips from a Sawmill on its roads would get both going."}`
    : slow ? ` It works at ${slow[2]} without full power, so its loads come slowly.` : ` It is held up: ${pr.split(": ")[0].toLowerCase()}.`;
  return { text, tone: "bad", fix: `${next.say}.${held}` };
}

/**
 * A works short of workers: how many of its jobs are filled, what that costs it, and where more would come from
 * (bottleneck.ts staffing). The sim's own line keeps its red; one only slowed by it is not in the red.
 */
function staffStatus(g: Game, b: Building, text: string, tone: Tone): PanelModel["status"] {
  const s = staffing(g, b);
  const say = staffSay({ towns: s.towns.map((t) => t.name), spare: s.spare });
  return { text, tone, fix: s.have > 0 ? `${jobsFilled(s)}, so it works at ${Math.floor(staffPace(g, b) * 100)}%. ${say}` : say };
}

/**
 * The state of one of the company's works, in one voice: the line its panel leads with, the advice under it, and
 * the works to look at. Its panel, its mark on the map, the Economy window's row and the goal line all read this
 * one function, so they cannot say different things about the same works (owner, 2026-11-10).
 */
export function worksStatus(g: Game, b: Building): PanelModel["status"] {
  const D = PLANTS[b.kind as keyof typeof PLANTS], P = b.plant!;
  const ref = (id: number | undefined) => {
    const o = id === undefined ? undefined : g.buildings.byId.get(id);
    return o ? { id: o.id, kind: o.kind } : undefined;
  };
  let status: PanelModel["status"];
  if (P.site) {
    // how far along, how long to go at the pace the loads have been coming, and where the next ones come from
    const left = (Object.keys(P.site.need) as Product[]).filter((p) => (P.site!.got[p] ?? 0) < P.site!.need[p]!);
    const s = siteStatus(b);
    const next = left.length ? nextLoad(g, b, left[0]) : null;
    const slow = s.slow && next?.from ? ` At this pace that is days: another ${BUILDING_TYPES[next.from.kind].name} would bring ${lower(left[0])} faster.` : "";
    // (a site with no road gets nothing: that comes first, the rest after)
    status = !b.access
      ? { text: "Building site", tone: "bad", fix: `No road reaches its gate, so no loads can come. Draw a road to the gate marker. ${s.line}.` }
      : { text: "Building site", tone: "", fix: `${s.line}.${next ? ` ${next.say}.` : ""}${slow}`, show: ref(next?.from?.id) };
  } else if (b.built < 1) status = { text: `Under construction · ${Math.round(b.built * 100)}%`, tone: "", fix: `Opens in ${aboutHours(((1 - b.built) * buildTime(b.kind)) / HOUR)}.${b.access ? afterOpening(g, b) : " It has no road to its gate yet: draw one to the gate marker before it opens."}` };
  else {
    // (open and nothing made yet: starting up, with when its first truck leaves; its yard filling for a works that is
    // not open yet: waiting for that one)
    const su = D.logistics ? null : startUp(g, b);
    const ws = su ? null : waitsForSite(g, b);
    if (su) status = { text: "Starting up", tone: "", fix: su.fix };
    else if (ws) status = { text: ws.text, tone: ws.tone, fix: ws.fix, show: ref(ws.show) };
    else if (b.problem) {
      const pf = powerFix(g, b);
      status = pf?.back ? { text: "Power back on", tone: "", fix: pf.fix, show: ref(pf.show) }
        : pf ? { text: splitProblem(b.problem).text, tone: "bad", fix: `${powerCause(b.problem)}${pf.fix}`, show: ref(pf.show) }
        : /^(No workers|Not enough workers)/.test(b.problem) ? staffStatus(g, b, splitProblem(b.problem).text, "bad")
        : waitingFor(g, b) ?? noBuyer(g, b) ?? { ...splitProblem(b.problem), tone: "bad" };
    }
    else {
      // (at the top of what it can make while somebody would take more: the one state "Working normally" hid)
      // (short of workers it is never at full output: owner, 2026-11-10, a Sawmill with half its jobs filled said so)
      const thin = !D.logistics && staffPace(g, b) < 1;
      const c = D.logistics || thin ? null : powerCeiling(g, b) ?? ceilingOf(g, b);
      status = c ? { text: "At full output", tone: "", fix: c.fix }
        : (D.logistics ? null : waitingFor(g, b)) ?? (thin ? staffStatus(g, b, staffing(g, b).spare > 0 ? "Taking on workers" : "Short of workers", "") : null) ?? { text: D.logistics === "depot" ? "Filling your trucks" : D.logistics === "warehouse" ? "Storing and shipping" : "Working normally", tone: "good" };
    }
  }
  if (SEASONAL[b.kind] && !P.site && b.built >= 1) {
    const m = seasonMult(b.kind, g.time);
    // the season is one small tag ("Autumn harvest ×1.6"), never rows of its own
    const se = seasonOf(g.time), word = SEASON_WORD[b.kind]?.[se];
    status.tag = `${SEASON_NAME[se]}${word ? ` ${word}` : ""} ×${m.toFixed(1)}`;
  }
  return status;
}

/**
 * A power plant making all it can while the works in its reach want more: its own "At full output" (the late save
 * read "Working normally" here beside three works short of its power).
 */
export function powerCeiling(g: Game, b: Building): { fix: string } | null {
  const pl = g.utilities.plants.get(b.id);
  if (!pl || pl.made <= 0 || pl.used <= pl.made * 1.02) return null;
  const short = g.buildings.list.filter((o) => g.utilities.supplyOf(o) < 0.999 && g.utilities.reaches(b, o)).length, L = b.plant!.level ?? 1;
  return { fix: `The ${short === 1 ? "works" : `${short} works`} in its reach want ${Math.round(pl.used)} MW. It makes ${Math.round(pl.made)}. Build another Power Plant nearby${L < SITE_LEVELS && !b.plant!.why ? `, or wait for level ${L + 1}` : ""}.` };
}

/** Is a works fine to leave alone (no mark on the map, no red in a list)? Anything its status does not call bad. */
export const worksCalm = (g: Game, b: Building): boolean => !!b.plant && isPlantKind(b.kind) && worksStatus(g, b).tone !== "bad";

export function siteModel(g: Game, b: Building, led?: TradeLedger): PanelModel {
  const D = PLANTS[b.kind as keyof typeof PLANTS], P = b.plant!;
  const T = BUILDING_TYPES[b.kind];
  const L = P.level ?? 1;
  const rel = emptyRel();
  rel.self.push(b.id);
  const out = trucksOut(g, b);
  rel.vehicles = out.ids;
  const fleet = D.trucks ? g.industry.trucksOf(b) : 0;

  const status = worksStatus(g, b);

  // ---- key numbers
  const keys: KeyNum[] = [];
  const outs = Object.keys(D.outputs) as Product[];
  const trucksKey = (): KeyNum => ({ value: String(out.busy), unit: `/${fleet}`, label: "trucks out", tone: fleet && out.busy >= fleet ? "bad" : "", title: out.busy >= fleet && fleet ? "Every truck is out: a long or jammed haul keeps them away" : "Trucks on a run now, of its fleet" });
  if (P.site) {
    let need = 0, got = 0, coming = 0;
    for (const p of Object.keys(P.site.need) as Product[]) { need += P.site.need[p]!; got += Math.min(P.site.need[p]!, P.site.got[p] ?? 0); }
    for (const tr of g.trips()) if (tr.haul && !tr.haul.done && tr.haul.leg === "out" && tr.haul.dest === b.id) coming += tr.haul.n;
    keys.push({ value: String(Math.floor(got)), unit: `/${need}`, label: "loads delivered", tone: got >= need ? "good" : "" });
    keys.push({ value: String(coming), label: coming === 1 ? "load on the way" : "loads on the way" });
  } else if (D.logistics === "warehouse") {
    const held = Industry.stored(b), store = Industry.storeOf(b);
    const kinds = (Object.keys(P.stock) as Product[]).filter((p) => (P.stock[p] ?? 0) >= 1).length;
    keys.push({ value: String(Math.floor(held)), unit: `/${store}`, label: "loads in store", tone: held >= store - 0.5 ? "bad" : "" });
    keys.push(trucksKey());
    keys.push({ value: String(kinds), label: kinds === 1 ? "product held" : "products held" });
  } else if (D.logistics === "depot") {
    const fuel = P.stock.fuel ?? 0;
    keys.push({ value: fuel.toFixed(1), unit: `/${Industry.storeOf(b)}`, label: "fuel in store", tone: fuel < 0.05 ? "bad" : "" });
    keys.push({ value: String(P.last.served ?? 0), label: "trucks filled, last hour" });
    keys.push({ value: formatMoney(Math.round(P.last.saved ?? 0)), label: "saved, last hour", tone: (P.last.saved ?? 0) > 0 ? "good" : "" });
  } else if (D.makes && b.built >= 1) {
    const pl = g.utilities.plants.get(b.id);
    const made = pl?.made ?? 0;
    const fuel = (Object.keys(D.inputs) as Product[])[0];
    keys.push({ value: String(Math.round(made)), unit: ` MW`, label: `made, of ${D.makes}`, tone: toneOf(made / Math.max(1, D.makes), 0.8, 0.3) });
    // (with nothing made, the buildings in its reach are not powered: "4 buildings powered" beside "0 MW" disagreed)
    const users = pl?.users ?? 0, things = users === 1 ? "building" : "buildings";
    const over = made > 0 && (pl?.used ?? 0) > made * 1.02;
    keys.push({ value: String(users), label: made <= 0 ? `${things} in reach, unpowered` : over ? `${things} in reach, short` : `${things} powered`, tone: (made > 0 && !over) || !users ? "" : "bad", title: `${Math.round(pl?.used ?? 0)} MW wanted in reach` });
    if (fuel) keys.push({ value: String(Math.floor(P.stock[fuel] ?? 0)), unit: `/${Industry.storeOf(b)}`, label: `${lower(fuel)} in the yard`, tone: (P.stock[fuel] ?? 0) < 1 ? "bad" : "" });
  } else if (b.built >= 1 && outs.length) {
    const p0 = outs[0];
    // (one pace for the figure, the status and the town's advice: never above what it can make. "can" is its pace
    // now, the season's harvest swing included)
    const { rate: r, can } = shownRate(g, b, p0);
    keys.push(r === null
      ? { value: "–", label: "no output yet", title: `Can make ${fmtRate(can * 24)} loads of ${lower(p0)} a day` }
      // (never the good green under a red status: a mine with no power read a green "0.4/h". In loads a day, the one
      // unit goods are counted in wherever a player sees them: design audit 2026-11-10, F05)
      : { value: fmtRate(r * 24), unit: " loads", label: `${lower(p0)} a day, can ${fmtRate(can * 24)}`, tone: can > 0 ? (status.tone === "bad" && toneOf(r / can, 0.75, 0.35) === "good" ? "" : toneOf(r / can, 0.75, 0.35)) : "", title: `Loads of ${lower(p0)} made a day lately, against ${fmtRate(can * 24)} a day fully staffed and supplied` });
    // a product the towns pay for: what it earns; one that only feeds your plants: what it ships
    if (outs.some((p) => PRODUCTS[p].price > 0)) {
      const net = P.last.earned - P.last.spent;
      keys.push({ value: signedMoney(net), label: "profit, last hour", tone: net > 0 ? "good" : net < 0 ? "bad" : "", title: `Earned ${formatMoney(Math.round(P.last.earned))}, spent ${formatMoney(Math.round(P.last.spent))} on wages, upkeep and fuel` });
    } else keys.push({ value: String(P.last.sent), label: P.last.sent === 1 ? "load shipped, last hour" : "loads shipped, last hour", title: `It feeds your own plants (nobody pays for ${lower(p0)}); it spent ${formatMoney(Math.round(P.last.spent))} last hour` });
    if (fleet) keys.push(trucksKey());
    else keys.push({ value: String(g.people.workersAt(b.id)), unit: `/${b.cap}`, label: "staff" });
  } else if (b.built >= 1) {
    // a landmark open, or anything that makes nothing to ship
    keys.push({ value: String(g.people.workersAt(b.id)), unit: `/${b.cap}`, label: "staff" });
  }

  // ---- flow: inputs, outputs, with the places they come from and go to
  const flow: FlowRow[] = [];
  const runs = led ? [...led.runs()] : [];
  const byId = (id: number) => g.buildings.byId.get(id);
  if (!D.logistics && !D.mega) {
    const from: FlowChip[] = [];
    if (D.deposit) from.push({ product: outs[0], text: D.deposit.name[0].toUpperCase() + D.deposit.name.slice(1), note: `${Math.round(P.yld * 100)}%`, tone: P.yld < 0.6 ? "bad" : "" });
    const ins = Object.keys(P.site ? P.site.need : D.inputs) as Product[];
    for (const p of ins) {
      const alt = !P.site ? D.alt?.[p] : undefined;
      const srcs = runs.filter((r) => r.to === b.id && (r.p === p || r.p === alt)).map((r) => byId(r.from)).filter((x): x is Building => !!x);
      for (const o of srcs.slice(0, 3)) from.push({ ...placeChip(g, o, b), product: p });
      if (!srcs.length) {
        // nobody has brought it lately: the nearest of the company's plants that makes it
        const maker = nearest(g.industry.plants().filter((o) => o.id !== b.id && !o.plant?.site && (PLANTS[o.kind as keyof typeof PLANTS].outputs[p] ?? 0) > 0), b);
        if (maker) from.push({ ...placeChip(g, maker, b), product: p });
        else from.push({ product: p, text: PRODUCTS[p].name, note: "no plant makes it yet", tone: "bad" });
      }
    }
    if (from.length) flow.push({ label: "From", chips: dedupe(from) });
    rel.from = from.filter((c) => c.ref?.k === "building").map((c) => c.ref!.id);
  }
  if (outs.length && !P.site && b.built >= 1 && !D.logistics) {
    const to: FlowChip[] = [];
    for (const p of outs) {
      const dests = runs.filter((r) => r.from === b.id && r.p === p).map((r) => byId(r.to)).filter((x): x is Building => !!x);
      for (const o of dests) to.push({ ...placeChip(g, o, b), product: p });
      if (!dests.length && b.access && Industry.useful(p)) {
        const cs = g.industry.customers(b, p).sort((x, y) => y.value - x.value).slice(0, 2);
        for (const c of cs) to.push({ ...placeChip(g, c.b, b), product: p });
      }
      if (!to.some((c) => c.product === p)) to.push({ product: p, text: PRODUCTS[p].name, note: Industry.useful(p) ? `no buyer yet: ${takenBy(p)}` : `used from tier ${Industry.laterTier(p)}`, tone: Industry.useful(p) ? "bad" : "" });
    }
    const chips = dedupe(to).slice(0, 5);
    flow.push({ label: "To", chips });
    rel.to = chips.filter((c) => c.ref).map((c) => (c.ref!.k === "town" ? g.towns.byId.get(c.ref!.id)?.hall ?? -1 : c.ref!.id)).filter((id) => id > 0);
  }
  if (D.logistics === "warehouse") {
    const ins = runs.filter((r) => r.to === b.id).map((r) => byId(r.from)).filter((x): x is Building => !!x);
    const outsTo = runs.filter((r) => r.from === b.id).map((r) => byId(r.to)).filter((x): x is Building => !!x);
    if (ins.length) flow.push({ label: "From", chips: dedupe(ins.map((o) => placeChip(g, o, b))).slice(0, 4) });
    if (outsTo.length) flow.push({ label: "To", chips: dedupe(outsTo.map((o) => placeChip(g, o, b))).slice(0, 4) });
    rel.from = ins.map((o) => o.id);
    rel.to = outsTo.map((o) => (o.plant ? o.id : g.towns.byId.get(o.town ?? -1)?.hall ?? o.id));
  }
  if (D.makes && b.built >= 1) {
    const fuel = (Object.keys(D.inputs) as Product[]);
    if (!flow.length && fuel.length) flow.push({ label: "From", chips: fuel.map((p) => ({ product: p, text: PRODUCTS[p].name })) });
  }

  // ---- level
  let level: PanelModel["level"];
  // (warehouses and depots don't grow: no level bar, as no badge)
  if (b.placed && b.built >= 1 && !P.site && !D.mega && !D.logistics) {
    if (L >= SITE_LEVELS) level = { from: `Level ${L}`, pct: 1, line: `fully grown · ×${LEVEL_MULT[L - 1]} output` };
    else {
      const k = Math.max(0, Math.min(1, (P.grow ?? 0) / growNeed(L)));
      // (a kind of site cleared only so far waits for a goal: that is the plan, not trouble)
      const goal = P.why?.match(/^Level \d+ opens with the goal "(.+)"$/)?.[1];
      const held = !goal && P.why && P.why !== b.problem;
      // (in the status's own words: "No power" above, not "Short of power" here)
      const why = P.why === "Short of power" && b.problem?.startsWith("No power") ? "No power" : P.why;
      level = goal
        ? { from: `Level ${L}`, to: `Level ${L + 1}`, pct: 0, line: `opens with the goal “${goal}”` }
        : { from: `Level ${L}`, to: `Level ${L + 1}`, pct: k, line: held ? `held back: ${why}` : `${Math.round(k * 100)}% · then ×${LEVEL_MULT[L]} output`, tone: held ? "bad" : "" };
    }
  }
  siteViz(g, b, flow, rel);
  return {
    title: T.name, icon: b.kind, badge: b.placed && !D.mega && !D.logistics ? `Lv ${L}/${SITE_LEVELS}` : undefined,
    status, keys, flow, level, related: rel,
  };
}

/** Where a chip's place stands on the map, and about how far its plot reaches from there. */
function chipAt(g: Game, c: FlowChip): { p: V2; r: number } | null {
  if (c.ref?.k === "building") {
    const o = g.buildings.byId.get(c.ref.id);
    return o ? { p: o.c, r: Math.min(o.hw, o.hd) } : null;
  }
  if (c.ref?.k === "town") {
    const t = g.towns.byId.get(c.ref.id);
    const h = t ? g.buildings.byId.get(t.hall) : undefined;
    return t ? { p: h?.c ?? t.c, r: h ? Math.min(h.hw, h.hd) : 20 } : null;
  }
  return null;
}

/** Loads on the road now, by run ("plant>dest"): the company's outbound trucks. */
function loadsOnRuns(g: Game): Map<string, number> {
  const on = new Map<string, number>();
  for (const tr of g.trips()) {
    const h = tr.haul;
    if (!h || h.done || h.big || h.leg !== "out") continue;
    const k = `${h.plant}>${h.dest}`;
    on.set(k, (on.get(k) ?? 0) + h.n);
  }
  return on;
}

/**
 * A site's goods on the map: a product-coloured line from each supplier in its From row to it, and from it to each
 * buyer in its To row, thicker for more loads on that run now; and its reach as a ring (a power plant's power, a
 * depot's detour).
 */
function siteViz(g: Game, b: Building, flow: FlowRow[], rel: Related) {
  const on = loadsOnRuns(g);
  // (a town's shops all count as the town)
  const runs = (from: number, to: number, town?: number) => {
    if (town === undefined) return on.get(`${from}>${to}`) ?? 0;
    let n = 0;
    for (const [k, x] of on) {
      const [a, d] = k.split(">").map(Number);
      if (a === from && g.buildings.byId.get(d)?.town === town) n += x;
    }
    return n;
  };
  const self = Math.min(b.hw, b.hd);
  const flows: FlowLine[] = [];
  for (const row of flow) {
    const into = row.label === "From";
    if (!into && row.label !== "To") continue;
    for (const c of row.chips) {
      const at = chipAt(g, c);
      if (!at) continue;
      const color = c.product ? PRODUCTS[c.product].color : 0xcfc4ab;
      const town = c.ref?.k === "town" ? c.ref.id : undefined;
      flows.push(into
        ? { a: at.p, b: b.c, color, n: runs(c.ref!.id, b.id), kind: "goods", ra: at.r, rb: self }
        : { a: b.c, b: at.p, color, n: runs(b.id, c.ref!.id, town), kind: "goods", ra: self, rb: at.r });
    }
  }
  rel.flows = flows;
  const D = PLANTS[b.kind as keyof typeof PLANTS];
  if (D.reach && b.built >= 1) rel.rings = [{ c: b.c, r: D.reach, tone: "reach" }];
  else if (D.logistics === "depot" && b.built >= 1) rel.rings = [{ c: b.c, r: DEPOT_REACH, tone: "reach" }];
}

function nearest(list: Building[], to: Building): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const o of list) {
    const d = Math.hypot(o.c.x - to.c.x, o.c.y - to.c.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// ------------------------------------------------------------------------------------------- towns

export function townStatus(t: Town, joined = false): PanelModel["status"] {
  // (a town that sprang up stands cut off till the company's trucks first reach it; once a road joins it, it is
  // waiting for that first load, and says so: play-test 2026-11-09, A10)
  if (t.spawned && !served(t)) return joined
    ? { text: "Joined by road", tone: "", fix: "It waits for its first load of food. Your food plants send to it as soon as they have some to spare" }
    : { text: "No road yet", tone: "", fix: "Lay a road out to it and send it food: a new market, and a longer drive for your trucks" };
  if (t.pop < 60) return { text: "Settling in", tone: "", fix: "Its first homes go up on their own" };
  // (the sim's own band and line, the need that holds it named: settlements.ts townGrowth via needs.ts growthOf)
  const gr = growthOf(t);
  return { text: gr.line, tone: gr.tone };
}

export function townModel(g: Game, t: Town, led?: TradeLedger): PanelModel {
  const si = sizeOf(t.pop), next = TOWN_SIZES[si + 1];
  // (each need read out once, in the panel's "What it needs" rows: the keys only count them, no percentages; how fast
  // it grows is the status line's word, its figure under Details)
  const joined = t.spawned && !served(t) && joinedUp(g, t);
  const views = townNeeds(t, joined);
  const met = views.filter((v) => v.state === "plenty" || v.state === "enough").length;
  const keys: KeyNum[] = [
    { value: fmtNum(t.pop), label: "people", title: `${fmtNum(t.households)} households` },
    { value: String(met), unit: `/${views.length}`, label: "needs met", tone: met === views.length ? "good" : "bad", title: "Needs with enough coming for the town to grow" },
  ];
  const rel = emptyRel();
  if (t.hall) rel.self.push(t.hall);
  // its suppliers: the company's sites whose trucks came to its shops lately
  const mine = new Set(g.towns.buildingsOf(t).map((b) => b.id));
  const sup = new Map<number, Product>();
  if (led) for (const r of led.runs()) if (mine.has(r.to) && !sup.has(r.from)) sup.set(r.from, r.p);
  for (const tr of g.trips()) if (tr.haul && tr.haul.leg === "out" && !tr.haul.done && mine.has(tr.haul.dest) && !sup.has(tr.haul.plant)) sup.set(tr.haul.plant, tr.haul.product);
  const from: FlowChip[] = [];
  for (const [id, p] of sup) {
    const b = g.buildings.byId.get(id);
    // (the cargo shows as its picture; the distance tells two plants of one kind apart)
    if (b) from.push({ ...placeChip(g, b), product: p, note: km(Math.hypot(b.c.x - t.c.x, b.c.y - t.c.y)) });
  }
  rel.from = [...sup.keys()];
  for (const v of g.traffic.vehicles) if (v.trip.haul && v.trip.haul.leg === "out" && !v.trip.haul.done && mine.has(v.trip.haul.dest)) rel.vehicles.push(v.id);
  // (its needs are the panel's own "What it needs" rows, so the strip only shows where they come from)
  const flow: FlowRow[] = [];
  if (from.length) flow.push({ label: "From", chips: from.slice(0, 5) });
  const level = next ? { from: TOWN_SIZES[si].name, to: next.name, pct: Math.min(1, t.pop / next.pop), line: `${Math.min(99, Math.floor((t.pop / next.pop) * 100))}% · at ${fmtNum(next.pop)} people` } : undefined;
  // one voice (owner, 2026-11-10: "a joined town says the same thing three times"): the status line, then the one
  // piece of advice for the need that matters most, with the works to look at; the rows under it are figures only
  const status = townStatus(t, joined);
  const adv = status.fix ? null : townAdvice(g, t, !t.spawned || joinedUp(g, t));
  if (adv) {
    status.fix = adv.say;
    const o = adv.works === undefined ? undefined : g.buildings.byId.get(adv.works);
    if (o) status.show = { id: o.id, kind: o.kind };
  }
  return { title: t.name, sub: TOWN_SIZES[si].name, icon: "town", status, keys, flow, level, related: rel };
}

// ------------------------------------------------------------------------------------------- town buildings

export function homeModel(g: Game, b: Building): PanelModel {
  const T = BUILDING_TYPES[b.kind];
  const grp = b.zone ? ZONE_GROUP[b.zone] : undefined;
  const town = b.town !== undefined ? g.towns.byId.get(b.town) : undefined;
  let status: PanelModel["status"];
  if (b.abandoned) status = { text: "Abandoned", tone: "bad", fix: "It will be cleared and something new can grow" };
  else if (b.site) status = { text: "Building site", tone: "", fix: "Waiting for its construction parts, trucked in from your construction plant" };
  else if (b.built < 1) status = { text: `Under construction · ${Math.round(b.built * 100)}%`, tone: "" };
  else if (b.problem) status = { ...splitProblem(b.problem), tone: "bad" };
  // (a shop with bare shelves is the one thing here the company can do something about)
  else if (grp === "com" && T.shelves && b.stock < 1) status = { text: "Shelves empty", tone: "bad", fix: `It sells the food your trucks bring${town ? ` to ${town.name}` : ""}` };
  else status = { text: grp === "res" ? "Residents are happy here" : "Business is doing well", tone: "good" };
  const keys: KeyNum[] = [];
  if (grp === "res") {
    const hhs = g.people.hhAt.get(b.id) ?? [];
    let res = 0, adults = 0, emp = 0;
    for (const hh of hhs) for (const c of hh.members) { res++; if (c.age === 1) { adults++; if (c.job >= 0) emp++; } }
    keys.push({ value: String(hhs.length), unit: `/${b.cap}`, label: "households" });
    keys.push({ value: String(res), label: "residents" });
    keys.push({ value: String(emp), unit: `/${adults}`, label: "adults working", tone: adults ? toneOf(emp / adults, 0.7, 0.4) : "" });
  } else if (b.zone) {
    const w = g.people.workersAt(b.id);
    keys.push({ value: String(w), unit: `/${b.cap}`, label: "workers", tone: b.cap ? toneOf(w / b.cap, 0.7, 0.4) : "" });
    if (grp === "com" && !T.fuel) keys.push({ value: fmtNum(b.custDay ?? b.custToday ?? 0), label: b.custDay !== undefined ? "customers yesterday" : "customers so far" });
  }
  const rel = emptyRel();
  rel.self.push(b.id);
  if (town?.hall) rel.from.push(town.hall);
  const flow: FlowRow[] = town ? [{ label: "Town", chips: [{ town: true, text: town.name, note: TOWN_SIZES[sizeOf(town.pop)].name.toLowerCase(), ref: { k: "town", id: town.id } }] }] : [];
  if (town && grp === "res") flow.push({ label: "Needs", chips: townNeeds(town).map((v) => ({ product: v.p, text: PRODUCTS[v.p].name, note: v.word.toLowerCase(), tone: v.state === "plenty" || v.state === "enough" ? "good" : "bad" })) });
  if (grp === "com" && T.shelves && b.built >= 1 && !b.abandoned) flow.push({ label: "Shelves", chips: [{ product: "food", text: "Food", note: b.stock >= 1 ? `${Math.floor(b.stock)} in stock` : "empty", tone: b.stock >= 1 ? "" : "bad" }] });
  if (b.zone) peopleOf(g, b, grp === "res", flow, rel);
  const name = T.fuel || !b.zone ? T.name : grp === "res" ? "Home" : grp === "com" ? "Shop" : T.name;
  // (no level badge: a town's buildings grow by themselves, the company's sites are the ones with levels to earn.
  // Play-test 2026-11-09, D8: "the shop panel is from another game")
  return { title: name, sub: town?.name, icon: b.kind, status, keys, flow, related: rel };
}

/** A workplace's short name for a chip: the site's kind, or "Shop" / "Offices" for a town's. */
function workName(b: Building): string {
  if (b.plant || !b.zone) return BUILDING_TYPES[b.kind].name;
  const grp = ZONE_GROUP[b.zone];
  return grp === "res" ? "Home" : grp === "com" ? (BUILDING_TYPES[b.kind].fuel ? BUILDING_TYPES[b.kind].name : b.kind === "office" || b.kind === "tower" ? "Offices" : "Shop") : BUILDING_TYPES[b.kind].name;
}

// (Citizen.st: travelling to, or at, the building in `at`)
const ST_TRAVEL = 1, ST_AWAY = 2;
/** Colours of people's lines: to work (ochre) and out now (cream). */
export const WORK_LINE = 0xe0a833, OUT_LINE = 0xf3ead6;

/**
 * Who lives or works in a town building and where they go: a home's people to their jobs and wherever they are out
 * at now; a workplace's staff from their homes and its customers in now. The rows name the places, the map draws a
 * line to each (thicker for more people).
 */
function peopleOf(g: Game, b: Building, home: boolean, flow: FlowRow[], rel: Related) {
  const work = new Map<number, number>(), out = new Map<number, number>();
  for (const c of g.people.citizens.values()) {
    if (home) {
      if (c.home !== b.id) continue;
      if (c.job >= 0) work.set(c.job, (work.get(c.job) ?? 0) + 1);
      if ((c.st === ST_TRAVEL || c.st === ST_AWAY) && c.at >= 0 && c.at !== b.id && c.at !== c.job) out.set(c.at, (out.get(c.at) ?? 0) + 1);
    } else {
      if (c.job === b.id) work.set(c.home, (work.get(c.home) ?? 0) + 1);
      else if ((c.st === ST_TRAVEL || c.st === ST_AWAY) && c.at === b.id) out.set(c.home, (out.get(c.home) ?? 0) + 1);
    }
  }
  const flows: FlowLine[] = [];
  const me = Math.min(b.hw, b.hd);
  const line = (id: number, n: number, color: number) => {
    const o = g.buildings.byId.get(id);
    if (!o) return;
    const r = Math.min(o.hw, o.hd);
    flows.push(home ? { a: b.c, b: o.c, color, n, kind: "people", ra: me, rb: r } : { a: o.c, b: b.c, color, n, kind: "people", ra: r, rb: me });
  };
  // (the busiest few lines: a big store's dozens of staff would be a hairball)
  const top = (m: Map<number, number>, k: number) => [...m].sort((x, y) => y[1] - x[1]).slice(0, k);
  for (const [id, n] of top(work, 24)) line(id, n, WORK_LINE);
  for (const [id, n] of top(out, 24)) line(id, n, OUT_LINE);
  rel.flows = flows;
  if (home) {
    const chips = top(work, 4).map(([id, n]): FlowChip | null => {
      const o = g.buildings.byId.get(id);
      return o ? { kind: o.kind, text: workName(o), note: plural(n, "person", "people"), ref: { k: "building", id } } : null;
    }).filter((c): c is FlowChip => !!c);
    if (chips.length) flow.push({ label: "Work at", chips });
    const away = [...out.values()].reduce((a, n) => a + n, 0);
    if (away) flow.push({ label: "Out now", chips: top(out, 3).map(([id, n]) => { const o = g.buildings.byId.get(id); return { kind: o?.kind, text: o ? workName(o) : "Out", note: String(n), ref: o ? { k: "building", id } as Sel : undefined }; }) });
  } else {
    // its staff by the town they come from (a site's crew often drives in from two)
    const towns = new Map<number, number>();
    for (const [id, n] of work) { const t = g.buildings.byId.get(id)?.town; if (t !== undefined) towns.set(t, (towns.get(t) ?? 0) + n); }
    const chips: FlowChip[] = [...towns].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id, n]) => ({ town: true, text: g.towns.byId.get(id)?.name ?? "Town", note: plural(n, "worker"), ref: { k: "town", id } }));
    if (chips.length) flow.push({ label: "Staff from", chips });
  }
}

// ------------------------------------------------------------------------------------------- vehicles

/** Metres left: the rest of the lane it is on, then the road pieces ahead (centreline lengths). */
export function metresLeft(g: Game, v: Vehicle): number {
  let m = Math.max(0, v.edge.pl.length - v.s);
  for (let i = v.ri + 1; i < v.route.length; i++) m += g.net.segGeom.get(dkSeg(v.route[i]))?.center.length ?? 0;
  return m;
}

export function vehicleKind(v: Vehicle): "convoy" | "truck" | "bus" | "car" {
  if (v.trip.haul?.big) return "convoy";
  if (v.trip.bus) return "bus";
  if (v.truck) return "truck";
  return "car";
}

/** What it is doing now, in a few words, and whether that is trouble. */
export function vehicleState(v: Vehicle): { text: string; tone: Tone; fix?: string } {
  if (v.dwell !== undefined && v.dwell > 0) return { text: "At a stop", tone: "" };
  if (v.leaving > 0) return { text: "Turning in at its destination", tone: "good" };
  if (v.stuck >= 30) return { text: `Stuck for ${dur(v.stuck)}`, tone: "bad", fix: v.block ? `Held at the junction ahead: ${blockWords(v.block)}` : "Its road is jammed ahead" };
  if (v.v < 0.5) {
    const t = v.wait >= 3 ? ` · ${dur(v.wait)}` : "";
    if (v.edge.kind === "conn") return { text: `Waiting in a junction${t}`, tone: "" };
    const atEnd = v.edge.pl.length - v.s < 30;
    // (why, in words: never the sim's own name for it, "yield" or "box")
    const why = v.block ? blockWords(v.block) : "";
    return atEnd ? { text: `Waiting at a junction${t}`, tone: "", fix: why ? why[0].toUpperCase() + why.slice(1) : undefined } : { text: `Queueing${t}`, tone: "" };
  }
  return { text: "Driving", tone: "good" };
}

/** Seconds as "45 s" or "3 min". */
const dur = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** What a resident's trip is for, as its panel's sub-title. */
const PURPOSE: Partial<Record<string, string>> = { work: "Going to work", home: "Heading home", shop: "Going shopping", leisure: "Out for the evening" };

/** The clock time it should arrive, at the speeds of the roads ahead (about 80% of their limits). */
function eta(g: Game, v: Vehicle, left: number): string {
  let lim = 0, n = 0;
  for (let i = v.ri + 1; i < v.route.length && n < 30; i++, n++) lim += ROAD_TYPES[g.net.segs.get(dkSeg(v.route[i]))?.type ?? "street"].speed;
  const vEst = Math.max(4, (n ? lim / n : v.edge.speed) * 0.8);
  const secs = left / vEst + (v.stuck > 5 ? v.stuck : 0);
  const at = (g.hour + secs / HOUR) % 24;
  const m = Math.floor(at * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function vehicleModel(g: Game, v: Vehicle): PanelModel {
  const kind = vehicleKind(v), tr = v.trip, h = tr.haul;
  const rel = emptyRel();
  rel.route = v.id;
  const fromB = g.buildings.byId.get(h ? (h.leg === "out" ? h.plant : h.dest) : tr.from);
  const toB = g.buildings.byId.get(h ? (h.leg === "out" ? h.dest : h.plant) : tr.to);
  if (fromB) rel.from.push(fromB.id);
  if (toB) rel.to.push(toB.id);
  const loaded = !!h && h.leg === "out" && !h.big;
  let title = "Car", sub: string | undefined;
  if (kind === "convoy") { title = "Oversize load"; sub = h!.big === "turbine" ? "Turbine" : "Girders"; }
  else if (kind === "bus") { const l = g.transit.lines.get(tr.bus!.line); title = "Bus"; sub = l?.name; }
  else if (kind === "truck") {
    title = TRUCK_CLASSES[h?.cls ?? "light"].name;
    sub = h ? (loaded ? `${plural(h.n, "load")} of ${lower(h.product)}` : "Returning empty") : tr.cargo ?? undefined;
  } else {
    title = tr.motor ? "Motor Works sedan" : "Car";
    sub = PURPOSE[tr.kind] ?? "A resident's car";
  }
  const left = metresLeft(g, v);
  const togo = km(left);
  const speed: KeyNum = { value: String(Math.round(v.v * 3.6)), unit: " km/h", label: `speed, limit ${Math.round(v.edge.speed * 3.6)}` };
  const arrives: KeyNum = { value: eta(g, v, left), label: `arrives · ${togo} to go`, title: "At the speeds of the roads ahead" };
  let keys: KeyNum[];
  if (loaded) {
    // a loaded truck: what it carries and what that is worth where it is going
    const worth = PRODUCTS[h!.product].price * h!.n;
    keys = [
      { value: String(h!.n), unit: h!.n === 1 ? " load" : " loads", label: lower(h!.product) },
      worth > 0
        ? { value: formatMoney(Math.round(worth)), label: "cargo value", title: "What its buyer pays on delivery (less if a perishable load goes off on the way)" }
        : { value: "–", label: "for your own plant", title: `Nobody pays for ${lower(h!.product)}: it feeds the company's plant at the other end` },
      arrives,
    ];
  } else if (kind === "bus") keys = [{ value: String(tr.bus!.pax.length), label: tr.bus!.pax.length === 1 ? "rider aboard" : "riders aboard" }, speed, arrives];
  else keys = [speed, { value: togo.replace(/ (k?m)$/, ""), unit: ` ${togo.split(" ")[1]}`, label: "to go" }, { ...arrives, label: "arrives" }];
  // its places: a site by name; a town building as what it is, with its town ("Shop · Elton")
  const what = (b: Building | undefined, role: "from" | "to"): FlowChip[] => {
    if (!b) return [{ text: role === "from" ? "Out of town" : "Leaving", note: "" }];
    if (b.plant || b.town === undefined || h) return [placeChip(g, b)];
    return [{ kind: b.kind, text: workName(b), note: g.towns.byId.get(b.town)?.name, ref: { k: "building", id: b.id } }];
  };
  const flow: FlowRow[] = [];
  if (loaded) flow.push({ label: "Cargo", chips: [{ product: h!.product, text: PRODUCTS[h!.product].name, note: plural(h!.n, "load") }] });
  flow.push({ label: "From", chips: what(fromB, "from") }, { label: "To", chips: what(toB, "to") });
  const status: PanelModel["status"] = vehicleState(v);
  if (h && !h.big) status.tag = h.leg === "out" ? "Outbound" : "Heading back";
  return { title, sub, icon: kind, status, keys, flow, related: rel };
}

/**
 * A vehicle's route as a line to draw, from where it started (`driven`: the directed road pieces behind it, by
 * default those still in its plan) through where it is now to its destination: x, y pairs, `cut`, the pair it
 * is at (the line before it is the leg it drove), and `hs`, how high the road stands at each pair (over a bridge).
 */
export function routeLine(g: Game, v: Vehicle, driven: readonly number[] = v.route.slice(0, Math.max(0, v.ri))): { pts: number[]; cut: number; hs: number[] } {
  const pts: number[] = [], hs: number[] = [];
  const piece = (k: number) => {
    const geo = g.net.segGeom.get(dkSeg(k)), P = geo?.center.pts;
    if (!geo || !P) return;
    if (dkDir(k) === 1) for (let j = 0; j < P.length; j++) { pts.push(P[j].x, P[j].y); hs.push(geo.hs[j] ?? 0); }
    else for (let j = P.length - 1; j >= 0; j--) { pts.push(P[j].x, P[j].y); hs.push(geo.hs[j] ?? 0); }
  };
  for (const k of driven) piece(k);
  const pl = v.edge.pl;
  // in a junction, the piece it came off is behind it; on a lane, the part of it up to here
  if (v.edge.kind === "conn") { if (v.ri >= 0 && driven[driven.length - 1] !== v.route[v.ri]) piece(v.route[v.ri]); }
  else for (let i = 0; i < pl.pts.length && pl.cum[i] < v.s; i++) { pts.push(pl.pts[i].x, pl.pts[i].y); hs.push(v.edge.hs[i] ?? v.h); }
  const q = poseOf(v, 1);
  const cut = pts.length / 2;
  pts.push(q.x, q.y);
  hs.push(v.h);
  for (let i = 0; i < pl.pts.length; i++) if (pl.cum[i] > v.s) { pts.push(pl.pts[i].x, pl.pts[i].y); hs.push(v.edge.hs[i] ?? v.h); }
  for (let i = v.ri + 1; i < v.route.length; i++) piece(v.route[i]);
  return { pts, cut, hs };
}

// ------------------------------------------------------------------------------------------- roads and junctions

/** Vehicles on a road piece now (both ways), and those stopped. */
export function vehiclesOnSeg(g: Game, seg: number): { all: Vehicle[]; stopped: number } {
  const geo = g.net.segGeom.get(seg);
  const all: Vehicle[] = [];
  let stopped = 0;
  for (const l of geo?.lanes ?? []) for (const o of l.occ as Vehicle[]) { all.push(o); if (o.v < 0.5) stopped++; }
  return { all, stopped };
}

/** A congestion word for a share of free-flow speed (and the tone). */
export function congestion(ratio: number, n: number): { word: string; tone: Tone } {
  if (n === 0) return { word: "Empty", tone: "good" };
  if (ratio >= 0.85) return { word: "Free-flowing", tone: "good" };
  if (ratio >= 0.6) return { word: "Busy", tone: "" };
  if (ratio >= 0.35) return { word: "Slow", tone: "bad" };
  return { word: "Jammed", tone: "bad" };
}

/**
 * The trips through a road piece (CS's route view): every vehicle on it now, where it set out from and where it is
 * going, and whether it hauls freight. Its whole planned route is what the map draws.
 */
export function routesThrough(g: Game, seg: number): { id: number; from: number; to: number; freight: boolean }[] {
  return vehiclesOnSeg(g, seg).all.map((v) => {
    const h = v.trip.haul;
    return {
      id: v.id,
      from: h ? (h.leg === "out" ? h.plant : h.dest) : v.trip.from,
      to: h ? (h.leg === "out" ? h.dest : h.plant) : v.trip.to,
      freight: !!h,
    };
  });
}

export function roadModel(g: Game, seg: number): PanelModel | null {
  const s = g.net.segs.get(seg), geo = g.net.segGeom.get(seg);
  if (!s || !geo) return null;
  const T = ROAD_TYPES[s.type];
  const { all, stopped } = vehiclesOnSeg(g, seg);
  const f1 = g.traffic.flow.get(seg * 2), f2 = g.traffic.flow.get(seg * 2 + 1);
  const fs = [f1, f2].filter((f): f is NonNullable<typeof f> => !!f);
  const ratio = fs.length ? Math.min(...fs.map((f) => f.ratio)) : 1;
  const speed = fs.length ? fs.reduce((a, f) => a + f.speed, 0) / fs.length : 1;
  const lanes = T.fwd + T.bwd;
  // how full it is: the road length its vehicles and their gaps take, of the lanes' length
  const used = all.reduce((a, v) => a + v.len + 3, 0);
  const full = Math.min(1, used / Math.max(1, geo.center.length * lanes));
  const c = congestion(ratio, all.length);
  const rel = emptyRel();
  rel.segs.push(seg);
  rel.vehicles = all.map((v) => v.id);
  const trips = routesThrough(g, seg);
  rel.routes = trips.map((t) => t.id);
  // what mostly uses it: where its vehicles come from and are going, and the trucks' loads
  const tally = (end: "from" | "to") => {
    const m = new Map<string, { chip: FlowChip; n: number }>();
    for (const t of trips) {
      const b = g.buildings.byId.get(t[end]);
      if (!b) continue;
      const chip = placeChip(g, b);
      const h = all.find((v) => v.id === t.id)?.trip.haul;
      if (h && h.leg === "out" && !h.big) chip.product = h.product;
      const k = chip.ref ? `${chip.ref.k}:${chip.ref.id}` : chip.text;
      const e = m.get(k);
      if (e) e.n++; else m.set(k, { chip, n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((e) => ({ ...e.chip, note: `${e.n}` }));
  };
  const from = tally("from"), to = tally("to");
  for (const t of to) if (t.ref?.k === "building") rel.to.push(t.ref.id);
  for (const t of from) if (t.ref?.k === "building") rel.from.push(t.ref.id);
  const ring = s.ring ? "Roundabout" : "";
  const flow: FlowRow[] = [];
  if (from.length) flow.push({ label: "Coming from", chips: from });
  if (to.length) flow.push({ label: "Heading to", chips: to });
  return {
    title: ring || T.name, sub: ring ? T.name : `${lanes} ${lanes === 1 ? "lane" : "lanes"} · ${Math.round(T.speed * 3.6)} km/h`, icon: ring ? "roundabout" : `road:${s.type}`,
    status: { text: c.word, tone: c.tone, fix: c.tone === "bad" ? "A junction ahead may be holding it up: click it, or try lights, a roundabout or more lanes" : undefined },
    keys: [
      { value: String(all.length), label: all.length === 1 ? "vehicle on it" : "vehicles on it", title: `${stopped} stopped` },
      { value: `${Math.round(speed * 100)}%`, label: "of the speed limit", tone: toneOf(speed, 0.8, 0.45) },
      { value: `${Math.round(full * 100)}%`, label: "full", tone: full > 0.6 ? "bad" : "", title: "How much of its lanes its vehicles and their gaps take up" },
    ],
    flow,
    related: rel,
  };
}

/** An approach to a junction: its road, the way it comes in, the vehicles queued and on it, and the longest wait (s). */
export interface Approach { seg: number; dir: { x: number; y: number }; queue: number; cars: number; wait: number }

/** The approaches of a junction: arriving lanes per road, the vehicles queued on each, and how long the first has stood. */
export function approaches(g: Game, node: number): Approach[] {
  const ng = g.net.nodeGeom.get(node);
  if (!ng) return [];
  const out: Approach[] = [];
  for (const a of ng.arms) {
    const geo = g.net.segGeom.get(a.seg);
    let queue = 0, cars = 0, wait = 0;
    for (const l of (geo?.lanes ?? []) as Lane[]) {
      if (l.to !== node) continue;
      for (const v of l.occ as Vehicle[]) {
        cars++;
        if (v.v < 0.5 && l.pl.length - v.s < 120) { queue++; wait = Math.max(wait, v.wait); }
      }
    }
    if (geo?.lanes.some((l) => l.to === node)) out.push({ seg: a.seg, dir: a.dir, queue, cars, wait });
  }
  return out;
}

/** An approach's wait as trouble: a minute and more on red is a long wait. */
export const waitTone = (s: number): Tone => (s >= 60 ? "bad" : s < 20 ? "good" : "");

export function junctionModel(g: Game, node: number, compass: (d: { x: number; y: number }) => string): PanelModel | null {
  const n = g.net.nodes.get(node), ng = g.net.nodeGeom.get(node);
  if (!n || !ng) return null;
  const ap = approaches(g, node);
  const queued = ap.reduce((a, x) => a + x.queue, 0);
  const worst = ap.reduce<Approach | null>((a, x) => (!a || x.wait > a.wait || (x.wait === a.wait && x.queue > a.queue) ? x : a), null);
  let inBox = 0;
  for (const c of ng.conns) inBox += c.occ.length;
  const ring = ng.arms.some((a) => g.net.segs.get(a.seg)?.ring);
  const control = n.signal ? "Traffic lights" : ring ? "Roundabout entry" : n.stops?.length ? "Stop signs" : "Give way";
  const jam = g.traffic.jams.get(node) ?? 0;
  const tone: Tone = queued >= 8 || jam > 6 || (worst?.wait ?? 0) >= 90 ? "bad" : queued <= 2 ? "good" : "";
  const rel = emptyRel();
  rel.segs = ap.map((a) => a.seg);
  // on the map: lights show which approaches have green now; otherwise an approach held a long time shows red
  const tones: Record<number, "go" | "stop" | "bad"> = {};
  const now = n.signal ? g.traffic.signalNow(node) : null;
  let tag: string | undefined;
  if (n.signal && now) {
    const ph = n.signal.phases[Math.min(now.i, n.signal.phases.length - 1)];
    for (const a of ap) tones[a.seg] = now.st === 0 && ph.arms.includes(a.seg) ? "go" : "stop";
    tag = now.st === 0 ? `Phase ${now.i + 1} green` : now.st === 1 ? `Phase ${now.i + 1} amber` : "All red";
  } else for (const a of ap) if (a.wait >= 60) tones[a.seg] = "bad";
  rel.segTone = tones;
  rel.vehicles = [];
  for (const a of ap) if (a.queue) {
    for (const l of (g.net.segGeom.get(a.seg)?.lanes ?? []) as Lane[]) if (l.to === node) for (const v of l.occ as Vehicle[]) if (v.v < 0.5 && v.wait >= 20) rel.vehicles.push(v.id);
  }
  return {
    title: "Junction", sub: control, icon: "junction",
    status: { text: queued === 0 ? "Clear" : tone === "bad" ? "Backing up" : "Busy", tone, tag, fix: tone === "bad" ? (n.signal ? "Give the worst approach a longer green, or add turn pockets" : "Try lights, stop signs on the quiet roads, or a roundabout") : undefined },
    keys: [
      { value: String(queued), label: queued === 1 ? "vehicle queued" : "vehicles queued", tone },
      worst && worst.queue
        ? { value: compass(worst.dir), unit: ` ${dur(worst.wait)}`, label: "longest wait", tone: waitTone(worst.wait), title: `${plural(worst.queue, "vehicle")} queued from the ${compass(worst.dir)}` }
        : { value: "–", label: "longest wait" },
      { value: String(inBox), label: "crossing now" },
    ],
    flow: [],
    related: rel,
  };
}

export function stopModel(g: Game, id: number): PanelModel | null {
  const tr = g.transit, st = tr.stops.get(id);
  if (!st) return null;
  const lines = [...tr.lines.values()].filter((l) => l.stops.includes(st.id));
  const buses = lines.reduce((a, l) => a + tr.busesOn(l.id), 0);
  const rel = emptyRel();
  for (const v of g.traffic.vehicles) if (v.trip.bus && lines.some((l) => l.id === v.trip.bus!.line)) rel.vehicles.push(v.id);
  return {
    title: "Bus stop", icon: "stop",
    status: lines.length ? { text: `${plural(lines.length, "line")} stop here`, tone: "good" } : { text: "No line stops here", tone: "bad", fix: "Draw one with Transport › Bus line" },
    keys: [
      { value: String(st.wait.length), label: "waiting", tone: st.wait.length > 30 ? "bad" : "" },
      { value: String(lines.length), label: lines.length === 1 ? "line" : "lines" },
      { value: String(buses), label: buses === 1 ? "bus on them" : "buses on them" },
    ],
    flow: [], related: rel,
  };
}

// ------------------------------------------------------------------------------------------- open ground

/** Ground selections that aren't a resource field: water, and hills too steep to build on. */
export const GROUND_WATER = -1, GROUND_HILLS = -2;

/** The extractors that work each resource field (a farm and a dairy farm both want fertile soil). */
export const WORKED_BY = new Map<number, PlantKind[]>();
for (const k of PLANT_KINDS) {
  const d = PLANTS[k].deposit;
  if (d) WORKED_BY.set(d.field, [...(WORKED_BY.get(d.field) ?? []), k]);
}

/**
 * What open ground at p is, for the inspector: water, a mined deposit, hills, forest or fertile soil (in that order:
 * what the eye sees there first); null for plain land, which has nothing to say.
 */
export function groundAt(g: Game, p: V2): Sel | null {
  const t = g.terrain, at = (id: number): Sel => ({ k: "ground", id, x: Math.round(p.x), y: Math.round(p.y) });
  if (t.isWater(p)) return at(GROUND_WATER);
  for (const d of DEPOSITS) if (t.has(d.field, p)) return at(d.field);
  if (t.isMountain(p)) return at(GROUND_HILLS);
  if (t.has(F.forest, p)) return at(F.forest);
  if (t.has(F.fert, p)) return at(F.fert);
  return null;
}

/** Whether a field is one of the mined deposits (kilometres apart, each a blob), not soil or forest (everywhere). */
export const isMined = (field: number) => DEPOSITS.some((d) => d.field === field);

/**
 * The patch of a field round p: a mined deposit's blob (centre and radius), or for soil and forest the land of it
 * joined to p, flooded over a 40 m grid out to 1.2 km (area in hectares; `capped` when it runs on past that).
 */
export function patchAt(g: Game, field: number, p: V2): { c: V2; r: number; ha: number; capped: boolean } {
  if (isMined(field)) {
    const d = g.terrain.gen.depositsNear(field, p.x, p.y, 1600).find((o) => Math.hypot(o.x - p.x, o.y - p.y) <= o.r * 1.4);
    if (d) return { c: { x: d.x, y: d.y }, r: d.r, ha: (Math.PI * d.r * d.r) / 1e4, capped: false };
  }
  const S = 40, N = 30;
  const key = (i: number, j: number) => (i + N) * 1000 + (j + N);
  const seen = new Set<number>([key(0, 0)]), q: number[] = [key(0, 0)];
  let n = 0, capped = false, sx = 0, sy = 0;
  while (q.length) {
    const k = q.pop()!, i = Math.floor(k / 1000) - N, j = (k % 1000) - N;
    n++; sx += i; sy += j;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (Math.abs(a) > N || Math.abs(b) > N) { capped = true; continue; }
      const kk = key(a, b);
      if (seen.has(kk)) continue;
      seen.add(kk);
      if (g.terrain.has(field, { x: p.x + a * S, y: p.y + b * S })) q.push(kk);
    }
  }
  const ha = (n * S * S) / 1e4;
  return { c: { x: p.x + (sx / n) * S, y: p.y + (sy / n) * S }, r: Math.sqrt((n * S * S) / Math.PI), ha, capped };
}

/** The last patch worked out (a panel refreshes four times a second; the flood fill needn't). */
let patchMemo: { k: string; v: ReturnType<typeof patchAt> } | null = null;

/** How much of an extractor's lot would sit on its field with its middle at p, and the yield that gives it. */
export function yieldHere(g: Game, kind: PlantKind, p: V2): { share: number; yld: number } {
  const T = BUILDING_TYPES[kind], f = PLANTS[kind].deposit!.field;
  const share = g.industry.depositShare(f, p, 0, T.w / 2, T.d / 2);
  return { share, yld: Math.min(1, share / 0.8) };
}

export function groundModel(g: Game, sel: Extract<Sel, { k: "ground" }>): PanelModel {
  const p = { x: sel.x, y: sel.y };
  const rel = emptyRel();
  if (sel.id === GROUND_WATER) {
    const lake = g.terrain.sample(F.lake, p.x, p.y) >= 0.5;
    rel.rings = [{ c: p, r: 0, tone: "here" }];
    return { title: lake ? "Lake" : "River", icon: "water", status: { text: "Your roads cross it on bridges", tone: "", fix: "The road tool raises a bridge on its own wherever a road you draw meets water" }, keys: [], flow: [], related: rel };
  }
  if (sel.id === GROUND_HILLS) {
    rel.rings = [{ c: p, r: 0, tone: "here" }];
    return { title: "Hills", icon: "hills", status: { text: "Too steep to build on", tone: "", fix: "Roads go round them, and towns grow on the flat land below" }, keys: [], flow: [], related: rel };
  }
  const field = sel.id, kinds = WORKED_BY.get(field) ?? [];
  const D0 = PLANTS[kinds[0]].deposit!;
  const mined = isMined(field);
  const name = D0.name[0].toUpperCase() + D0.name.slice(1);
  const mk = `${field}:${sel.x}:${sel.y}`;
  const patch = patchMemo?.k === mk ? patchMemo.v : (patchMemo = { k: mk, v: patchAt(g, field, p) }).v;
  // the company's extractors on this patch
  // (a deposit: those on its blob; soil or forest, which runs on for miles: those with part of their lot on it
  // within a little over a kilometre of the click)
  const sites = g.industry.plants().filter((b) => PLANTS[b.kind as PlantKind].deposit?.field === field && (mined
    ? Math.hypot(b.c.x - patch.c.x, b.c.y - patch.c.y) <= patch.r + 120 + Math.max(b.hw, b.hd)
    : Math.hypot(b.c.x - p.x, b.c.y - p.y) <= 1300 && g.industry.depositShare(field, b.c, b.rot, b.hw, b.hd) > 0));
  rel.to = sites.map((b) => b.id);
  for (const b of sites) rel.vehicles.push(...trucksOut(g, b).ids);
  rel.rings = mined ? [{ c: patch.c, r: patch.r, tone: "deposit" }, { c: p, r: 0, tone: "here" }] : [{ c: p, r: 0, tone: "here" }];
  const open = kinds.filter((k) => g.placedUnlocked(k));
  const first = open[0] ?? kinds[0];
  const here = yieldHere(g, first, p);
  const what = BUILDING_TYPES[first].name;
  let status: PanelModel["status"];
  if (sites.length) status = { text: `Worked by ${sites.length === 1 ? `your ${BUILDING_TYPES[sites[0].kind].name.toLowerCase()}` : `${sites.length} of your sites`}`, tone: "good" };
  else if (open.length) status = { text: "Unworked", tone: "", fix: `A ${what.toLowerCase()} placed here would work at ${Math.round(here.yld * 100)}%: the more of its lot on ${D0.name}, the faster` };
  else {
    const m = unlockedBy((u) => u.buildings?.includes(first));
    status = { text: "Not open yet", tone: "", fix: `${what}s open with the goal “${m?.name ?? "a later tier"}”` };
  }
  const keys: KeyNum[] = [
    here.share < MIN_DEPOSIT
      ? { value: `${Math.round(here.share * 100)}%`, label: "too thin here to work", tone: "bad", title: `An extractor needs at least ${Math.round(MIN_DEPOSIT * 100)}% of its lot on ${D0.name}: try nearer the middle` }
      : { value: `${Math.round(here.yld * 100)}%`, label: `yield, ${what.toLowerCase()} here`, tone: toneOf(here.yld, 0.9, 0.6), title: `${Math.round(here.share * 100)}% of a ${what.toLowerCase()}'s lot would sit on it here` },
    { value: patch.capped ? `${fmtNum(Math.round(patch.ha))}+` : fmtNum(Math.round(patch.ha)), unit: " ha", label: mined ? "deposit" : patch.capped ? "of it, and on past 1 km" : "in this patch" },
    { value: String(sites.length), label: sites.length === 1 ? "site working it" : "sites working it" },
  ];
  const flow: FlowRow[] = [];
  if (sites.length) flow.push({ label: "Worked by", chips: sites.slice(0, 4).map((b) => ({ ...placeChip(g, b), note: `Lv ${b.plant?.level ?? 1}` })) });
  flow.push({ label: "Extractor", chips: kinds.map((k): FlowChip => ({ kind: k, text: BUILDING_TYPES[k].name, note: g.placedUnlocked(k) ? undefined : `tier ${PLANTS[k].tier}` })) });
  const prod = Object.keys(PLANTS[first].outputs)[0];
  return { title: mined ? `${name} deposit` : name, sub: `${PRODUCTS[prod as Product].name} for your ${BUILDING_TYPES[first].name.toLowerCase()}s`, icon: `product:${prod}`, status, keys, flow, related: rel };
}

/** The extractor a "Place … here" shortcut offers on a ground selection (the first unlocked one), if any. */
export function extractorFor(g: Game, field: number): PlantKind | null {
  return (WORKED_BY.get(field) ?? []).find((k) => g.placedUnlocked(k)) ?? null;
}

// ------------------------------------------------------------------------------------------- stuck traffic

/** How far from a stuck-traffic diamond (m) a standing vehicle counts as stuck there. */
export const STUCK_NEAR = 130;

/** The vehicles stuck round a diamond (standing a while), the longest first. */
export function stuckAt(g: Game, c: V2): Vehicle[] {
  return g.traffic.vehicles.filter((v) => stuckNow(v, STUCK_KEEP) && Math.hypot(v.x - c.x, v.y - c.y) <= STUCK_NEAR).sort((a, b) => b.stuck - a.stuck);
}

/**
 * A deadlock among these standing vehicles: some of them wait on each other in a ring (Traffic.waitCycles), so none
 * can move until one leaves. In plain words, and the one-click fix where there is one: lights on the junction most
 * of the ring waits at, where it has none (they take turns, so the ring can't form). Null: no ring here.
 */
export function deadlockAt(g: Game, vs: Vehicle[]): Pick<PanelModel["status"], "text" | "fix" | "act"> | null {
  const here = new Set(vs);
  const ring = g.traffic.waitCycles(STUCK_KEEP).find((r) => r.some((v) => here.has(v)));
  if (!ring) return null;
  const at = new Map<number, number>();
  for (const v of ring) {
    const node = v.edge.kind === "conn" ? (v.edge as unknown as { node: number }).node : v.next?.node;
    if (node !== undefined) at.set(node, (at.get(node) ?? 0) + 1);
  }
  const text = `Deadlock: ${ring.length} vehicles each waiting for another to move`;
  const node = [...at].filter(([id]) => !g.net.nodes.get(id)?.signal && g.defaultSignal(id)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const later = "Left alone, one of them turns off another way, or gives up, within a minute or two.";
  if (node === undefined) return { text, fix: `${later} A second way round, or a roundabout, stops it happening again.` };
  if (!g.featureUnlocked("signals")) return { text, fix: `${later} Traffic lights here, once you have them, stop it happening again: they take turns.` };
  const n = g.net.clusterOf(node).filter((m) => m === node || (!g.net.nodes.get(m)?.signal && g.defaultSignal(m))).length;
  const cost = n * SIGNAL_COST;
  return {
    text,
    fix: `Traffic lights here make them take turns, so it clears and doesn't come back.${n > 1 ? ` (These ${n} junctions are so close they work as one: they all get lights.)` : ""}`,
    act: { kind: "lights", node, cost, label: `Add traffic lights · ${formatMoney(cost)}` },
  };
}

export function stuckModel(g: Game, sel: Extract<Sel, { k: "stuck" }>): PanelModel {
  const c = { x: sel.x, y: sel.y };
  const vs = stuckAt(g, c);
  const rel = emptyRel();
  rel.vehicles = vs.map((v) => v.id);
  rel.rings = [{ c, r: STUCK_NEAR, tone: "spot" }];
  // where they stand: the roads they are on, and the junctions they wait at
  const segs = new Set<number>(), nodes = new Map<number, number>();
  for (const v of vs) {
    if (v.edge.kind === "lane") segs.add((v.edge as Lane).seg);
    const node = v.edge.kind === "conn" ? (v.edge as unknown as { node: number }).node : v.next?.node;
    if (node !== undefined) nodes.set(node, (nodes.get(node) ?? 0) + 1);
  }
  rel.segs = [...segs];
  const worst = vs[0]?.stuck ?? 0;
  const why = vs.find((v) => v.block)?.block;
  const status: PanelModel["status"] = vs.length
    ? { text: `${plural(vs.length, "vehicle")} standing still`, tone: "bad", fix: why ? `The first is held at the junction ahead: ${blockWords(why)}. ${blockFix(why)}` : "Open the junction they wait at to see its queues" }
    : { text: "Moving again", tone: "good" };
  const dl = deadlockAt(g, vs);
  if (dl) Object.assign(status, dl);
  const flow: FlowRow[] = [];
  const held = [...nodes].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (held.length) flow.push({ label: "Held at", chips: held.map(([id, n]) => ({ kind: "junction", text: g.net.nodes.get(id)?.signal ? "Lights" : "Junction", note: plural(n, "vehicle"), ref: { k: "node", id } as Sel })) });
  if (vs.length) flow.push({ label: "Vehicles", chips: vs.slice(0, 4).map((v) => ({ kind: vehicleKind(v), text: vehicleModel(g, v).title, note: dur(v.stuck), tone: "bad" as Tone, ref: { k: "vehicle", id: v.id } as Sel })) });
  return {
    title: "Traffic stuck", icon: "stuck", status,
    keys: [
      { value: String(vs.length), label: vs.length === 1 ? "vehicle standing" : "vehicles standing", tone: vs.length ? "bad" : "good" },
      { value: vs.length ? dur(worst) : "–", label: "longest stood", tone: worst >= 90 ? "bad" : "" },
      { value: String(segs.size), label: segs.size === 1 ? "road held up" : "roads held up" },
    ],
    flow, related: rel,
  };
}

// ------------------------------------------------------------------------------------------- towns, on the map

/** A town's supply lines: from each site in its From row to the town hall, in its product's colour. */
function townFlows(g: Game, t: Town, m: PanelModel) {
  const on = loadsOnRuns(g);
  const hall = g.buildings.byId.get(t.hall);
  const to = hall?.c ?? t.c, rb = hall ? Math.min(hall.hw, hall.hd) : 20;
  const flows: FlowLine[] = [];
  for (const c of m.flow.find((r) => r.label === "From")?.chips ?? []) {
    const at = chipAt(g, c);
    if (!at || c.ref?.k !== "building") continue;
    let n = 0;
    for (const [k, x] of on) {
      const [a, d] = k.split(">").map(Number);
      if (a === c.ref.id && g.buildings.byId.get(d)?.town === t.id) n += x;
    }
    flows.push({ a: at.p, b: to, color: c.product ? PRODUCTS[c.product].color : 0xcfc4ab, n, kind: "goods", ra: at.r, rb });
  }
  m.related.flows = flows;
}
/** The panel model of whatever is selected (null: it is gone). */
export function modelOf(g: Game, sel: Sel, led: TradeLedger | undefined, compass: (d: { x: number; y: number }) => string): PanelModel | null {
  switch (sel.k) {
    case "building": {
      const b = g.buildings.byId.get(sel.id);
      if (!b) return null;
      return b.plant && isPlantKind(b.kind) ? siteModel(g, b, led) : homeModel(g, b);
    }
    case "town": {
      const t = g.towns.byId.get(sel.id);
      if (!t) return null;
      const m = townModel(g, t, led);
      townFlows(g, t, m);
      return m;
    }
    case "vehicle": { const v = g.traffic.vehicles.find((x) => x.id === sel.id); return v ? vehicleModel(g, v) : null; }
    case "seg": return roadModel(g, sel.id);
    case "node": return junctionModel(g, sel.id, compass);
    case "stop": return stopModel(g, sel.id);
    case "ground": return groundModel(g, sel);
    case "stuck": return stuckModel(g, sel);
  }
}
