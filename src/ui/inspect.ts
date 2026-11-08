// What the inspector says about the thing the player clicked, as data: one status line, three key numbers, the flow
// in and out, the level, and what to light up on the map. The HUD draws every kind on this one anatomy
// (docs/ui-style.md "Inspector"), so a farm, a town, a truck and a road all read the same way at a glance.
// Pure over the game state, so tests can check the numbers each kind picks.

import { BUILDING_TYPES, ROAD_TYPES } from "../config";
import { formatMoney } from "../core/math";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { SEASONAL, SEASON_NAME, seasonMult, seasonOf } from "../game/calendar";
import { ZONE_GROUP } from "../game/growables";
import { Industry, PLANTS, PRODUCTS, isPlantKind, type Product } from "../game/industry";
import { GROW_NEED, LEVEL_MULT, SITE_LEVELS } from "../game/sites";
import { HOUR } from "../game/society";
import { TOWN_SIZES, demandPerDay, needsOf, sizeOf } from "../game/towns";
import { TRUCK_CLASSES } from "../game/trucks";
import type { Town } from "../game/settlements";
import type { Lane } from "../roads/network";
import { dkSeg } from "../sim/router";
import type { Vehicle } from "../sim/traffic";

/** The one thing selected on the map. */
export type Sel =
  | { k: "building"; id: number }
  | { k: "town"; id: number }
  | { k: "vehicle"; id: number }
  | { k: "seg"; id: number }
  | { k: "node"; id: number }
  | { k: "stop"; id: number };

export const sameSel = (a: Sel | null, b: Sel | null) => !!a && !!b && a.k === b.k && a.id === b.id;

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

export interface PanelModel {
  /** the header's name and its small grey sub-name */
  title: string;
  sub?: string;
  /** a building kind or "town" / "truck" / "car" / "bus" / "road" / "junction" / "stop" (the icon) */
  icon: string;
  /** "Lv 1/4" */
  badge?: string;
  status: { text: string; tone: Tone; fix?: string; tag?: string };
  keys: KeyNum[];
  flow: FlowRow[];
  level?: { label: string; pct: number; line: string; tone?: Tone };
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
}

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

  observe(g: Game) {
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

  clear() { this.seen.clear(); }
}

// ------------------------------------------------------------------------------------------- formatting

export const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : Math.round(n).toLocaleString("en-US"));
/** A rate: one decimal under 10 ("0.7"), whole above. */
export const fmtRate = (n: number) => (n < 9.95 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));
export const signedMoney = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(Math.round(n)))}`;
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

/** What to do for the problems whose line says only what is wrong. */
const FIXES: [RegExp, string][] = [
  [/^No road to the gate/, "Draw a road to its gate (the marker on the map)"],
  [/^No road access/, "Connect it to a road"],
  [/^No workers|^Not enough workers/, "Its staff commute from your towns: link it to one by road, or let a town grow nearer"],
  [/^Waiting for /, "Build or connect a plant that makes it; a quicker road brings it sooner"],
  [/^No power|^Short of power/, "Build a power plant within reach, and keep its coal coming"],
  [/^Idle: /, "Build plants within its reach"],
  [/^Out of food$/, "Your food plant's trucks stock the shops"],
];

// ------------------------------------------------------------------------------------------- names

/** A building's name for a chip: its kind, or its town for a town building ("Shop, Elton"). */
export function placeName(g: Game, b: Building): string {
  const T = BUILDING_TYPES[b.kind];
  if (!b.plant && b.town !== undefined) {
    const t = g.towns.byId.get(b.town);
    if (t) return t.name;
  }
  return T.name;
}

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

/** Loads of p made an hour, over the last few hours it remembers (null: no full hour yet). */
export function rateLately(b: Building, p: Product, hours = 3): number | null {
  const m = Industry.madeLately(b, p);
  if (!m.hours) return null;
  const last = m.byHour.slice(-hours);
  return last.reduce((a, v) => a + v, 0) / last.length;
}

export function siteModel(g: Game, b: Building, led?: TradeLedger): PanelModel {
  const D = PLANTS[b.kind as keyof typeof PLANTS], P = b.plant!;
  const T = BUILDING_TYPES[b.kind];
  const L = P.level ?? 1;
  const rel = emptyRel();
  rel.self.push(b.id);
  const out = trucksOut(g, b);
  rel.vehicles = out.ids;
  const fleet = D.trucks ? g.industry.trucksOf(b) : 0;

  // ---- status
  let status: PanelModel["status"];
  if (P.site) {
    const left = (Object.keys(P.site.need) as Product[]).filter((p) => (P.site!.got[p] ?? 0) < P.site!.need[p]!);
    status = { text: "Building site", tone: "", fix: left.length ? `Waiting for ${left.map(lower).join(" and ")}: your plants that make ${left.length > 1 ? "them" : "it"} truck ${left.length > 1 ? "them" : "it"} here` : "All in: going up" };
  } else if (b.built < 1) status = { text: `Under construction · ${Math.round(b.built * 100)}%`, tone: "" };
  else if (b.problem) status = { ...splitProblem(b.problem), tone: "bad" };
  else status = { text: D.logistics === "depot" ? "Filling your trucks" : D.logistics === "warehouse" ? "Storing and shipping" : "Working normally", tone: "good" };
  if (SEASONAL[b.kind] && !P.site && b.built >= 1) {
    const m = seasonMult(b.kind, g.time);
    status.tag = `${SEASON_NAME[seasonOf(g.time)]} ×${m.toFixed(1)}`;
  }

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
    keys.push({ value: String(pl?.users ?? 0), label: `${(pl?.users ?? 0) === 1 ? "building" : "buildings"} powered`, title: `${Math.round(pl?.used ?? 0)} MW wanted in reach` });
    if (fuel) keys.push({ value: String(Math.floor(P.stock[fuel] ?? 0)), unit: `/${Industry.storeOf(b)}`, label: `${lower(fuel)} in the yard`, tone: (P.stock[fuel] ?? 0) < 1 ? "bad" : "" });
  } else if (b.built >= 1 && outs.length) {
    const p0 = outs[0];
    const r = rateLately(b, p0), can = Industry.perDay(b, p0) / 24;
    keys.push(r === null
      ? { value: "–", label: "no output yet", title: `Can make ${fmtRate(can)} ${lower(p0)} an hour` }
      : { value: fmtRate(r), unit: "/h", label: `${lower(p0)}, can ${fmtRate(can)}`, tone: can > 0 ? toneOf(r / can, 0.75, 0.35) : "", title: `${PRODUCTS[p0].name} made an hour lately, against ${fmtRate(can)} an hour fully staffed and supplied` });
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
      if (!to.some((c) => c.product === p)) to.push({ product: p, text: PRODUCTS[p].name, note: Industry.useful(p) ? "no buyer yet" : `used from tier ${Industry.laterTier(p)}`, tone: Industry.useful(p) ? "bad" : "" });
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
  if (b.placed && b.built >= 1 && !P.site && !D.mega) {
    if (L >= SITE_LEVELS) level = { label: "Top level", pct: 1, line: `fully grown · ×${LEVEL_MULT[L - 1]} output` };
    else {
      const k = Math.max(0, Math.min(1, (P.grow ?? 0) / GROW_NEED));
      const held = P.why && P.why !== b.problem;
      level = { label: `Lv ${L + 1}`, pct: k, line: held ? `held back: ${P.why}` : `${Math.round(k * 100)}% · then ×${LEVEL_MULT[L]} output`, tone: held ? "bad" : "" };
    }
  }
  return {
    title: T.name, icon: b.kind, badge: b.placed && !D.mega && !D.logistics ? `Lv ${L}/${SITE_LEVELS}` : undefined,
    status, keys, flow, level, related: rel,
  };
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

export function townStatus(t: Town): { text: string; tone: Tone; fix?: string } {
  if (t.pop < 60) return { text: "Settling in", tone: "", fix: "Its first homes go up on their own" };
  const short = needsOf(t.pop).filter((p) => (t.supply[p] ?? 1) < 0.5).map(lower);
  if (t.trend >= 0.5) return { text: `Growing, +${Math.round(t.trend)} households a day`, tone: "good" };
  if (t.trend <= -0.5) return { text: "Shrinking", tone: "bad", fix: `Short of ${short.join(" and ") || "supplies"}: bring more by road` };
  return short.length ? { text: "Not growing", tone: "bad", fix: `Short of ${short.join(" and ")}: bring more by road` } : { text: "Holding steady", tone: "" };
}

export function townModel(g: Game, t: Town, led?: TradeLedger): PanelModel {
  const si = sizeOf(t.pop), next = TOWN_SIZES[si + 1];
  const needs = needsOf(t.pop);
  const known = needs.filter((p) => t.supply[p] !== undefined);
  const avg = known.length ? known.reduce((a, p) => a + t.supply[p]!, 0) / known.length : null;
  const worst = known.length ? known.reduce((a, p) => (t.supply[p]! < t.supply[a]! ? p : a), known[0]) : null;
  const keys: KeyNum[] = [
    { value: fmtNum(t.pop), label: t.pop >= 60 && Math.abs(t.trend) >= 0.5 ? `people · ${t.trend > 0 ? "+" : "−"}${Math.abs(Math.round(t.trend))} homes/day` : "people", title: `${fmtNum(t.households)} households` },
    avg === null
      ? { value: "–", label: "supplied", title: "No full day of deliveries yet" }
      : { value: `${Math.round(avg * 100)}%`, label: "needs supplied", tone: toneOf(avg), title: "The average share of its needs delivered yesterday" },
  ];
  if (worst && t.supply[worst]! < 0.8) {
    const more = Math.max(1, demandPerDay(worst, t.pop) - (t.yesterday[worst] ?? 0));
    keys.push({ value: PRODUCTS[worst].name, label: `most missing · ${fmtRate(more)} more/day`, tone: "bad", title: `${Math.round(t.supply[worst]! * 100)}% of its ${lower(worst)} came yesterday` });
  } else keys.push({ value: worst ? "None" : "–", label: worst ? "needs all met" : "most missing", tone: worst ? "good" : "" });
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
    if (b) from.push({ ...placeChip(g, b), product: p, note: PRODUCTS[p].name.toLowerCase() });
  }
  rel.from = [...sup.keys()];
  for (const v of g.traffic.vehicles) if (v.trip.haul && v.trip.haul.leg === "out" && !v.trip.haul.done && mine.has(v.trip.haul.dest)) rel.vehicles.push(v.id);
  const flow: FlowRow[] = [
    { label: "Needs", chips: needs.map((p) => ({ product: p, text: PRODUCTS[p].name, note: t.supply[p] === undefined ? "new" : `${Math.round(t.supply[p]! * 100)}%`, tone: t.supply[p] === undefined ? "" : toneOf(t.supply[p]!) })) },
  ];
  if (from.length) flow.push({ label: "From", chips: from.slice(0, 5) });
  const level = next ? { label: next.name, pct: Math.min(1, t.pop / next.pop), line: `${Math.min(99, Math.floor((t.pop / next.pop) * 100))}% · at ${fmtNum(next.pop)} people` } : undefined;
  return { title: t.name, sub: TOWN_SIZES[si].name, icon: "town", status: townStatus(t), keys, flow, level, related: rel };
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
    keys.push({ value: `${Math.round(((b as Building & { health?: number }).health ?? 1) * 100)}%`, label: "efficiency" });
  }
  const rel = emptyRel();
  rel.self.push(b.id);
  if (town?.hall) rel.from.push(town.hall);
  const flow: FlowRow[] = town ? [{ label: "Town", chips: [{ town: true, text: town.name, note: TOWN_SIZES[sizeOf(town.pop)].name.toLowerCase(), ref: { k: "town", id: town.id } }] }] : [];
  if (town && grp === "res") flow.push({ label: "Needs", chips: needsOf(town.pop).map((p) => ({ product: p, text: PRODUCTS[p].name, note: town.supply[p] === undefined ? "new" : `${Math.round(town.supply[p]! * 100)}%`, tone: town.supply[p] === undefined ? "" : toneOf(town.supply[p]!) })) });
  const name = T.fuel || !b.zone ? T.name : grp === "res" ? "Home" : grp === "com" ? "Shop" : T.name;
  return { title: name, sub: town?.name, icon: b.kind, badge: b.zone ? `Lv ${b.level}/5` : undefined, status, keys, flow, related: rel };
}

// ------------------------------------------------------------------------------------------- vehicles

/** Where a vehicle's remaining route runs: the directed road pieces still ahead, after the one it is on. */
export function routeAhead(v: Vehicle): number[] {
  return v.route.slice(v.ri + 1).map(dkSeg);
}

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
  if (v.stuck >= 30) return { text: `Stuck for ${Math.round(v.stuck)} s`, tone: "bad", fix: v.block ? `Held at the junction ahead: ${v.block}` : "Its road is jammed ahead" };
  if (v.v < 0.5) {
    if (v.edge.kind === "conn") return { text: "Waiting in a junction", tone: "" };
    const atEnd = v.edge.pl.length - v.s < 30;
    return atEnd ? { text: "Waiting at a junction", tone: "", fix: v.block } : { text: "Queueing", tone: "" };
  }
  return { text: "Driving", tone: "good" };
}

export function vehicleModel(g: Game, v: Vehicle): PanelModel {
  const kind = vehicleKind(v), tr = v.trip, h = tr.haul;
  const rel = emptyRel();
  rel.route = v.id;
  const fromB = g.buildings.byId.get(h ? (h.leg === "out" ? h.plant : h.dest) : tr.from);
  const toB = g.buildings.byId.get(h ? (h.leg === "out" ? h.dest : h.plant) : tr.to);
  if (fromB) rel.from.push(fromB.id);
  if (toB) rel.to.push(toB.id);
  let title = "Car", sub: string | undefined;
  if (kind === "convoy") { title = "Oversize load"; sub = h!.big === "turbine" ? "Turbine" : "Girders"; }
  else if (kind === "bus") { const l = g.transit.lines.get(tr.bus!.line); title = "Bus"; sub = l?.name; }
  else if (kind === "truck") {
    title = TRUCK_CLASSES[h?.cls ?? "light"].name;
    sub = h ? (h.leg === "out" ? `${h.n} ${h.n === 1 ? "load" : "loads"} of ${lower(h.product)}` : "returning empty") : tr.cargo ?? undefined;
  } else if (tr.motor) { title = "Motor Works sedan"; sub = "A resident's car"; }
  else sub = "A resident's car";
  const left = metresLeft(g, v);
  // (an estimate at the speeds of the roads ahead, about 80% of their limits)
  let lim = 0, n = 0;
  for (let i = v.ri + 1; i < v.route.length && n < 30; i++, n++) lim += ROAD_TYPES[g.net.segs.get(dkSeg(v.route[i]))?.type ?? "street"].speed;
  const vEst = Math.max(4, (n ? lim / n : v.edge.speed) * 0.8);
  const secs = left / vEst + (v.stuck > 5 ? v.stuck : 0);
  const at = (g.hour + secs / HOUR) % 24;
  const clock = `${String(Math.floor(at)).padStart(2, "0")}:${String(Math.floor((at % 1) * 6) * 10).padStart(2, "0")}`;
  const keys: KeyNum[] = [
    { value: String(Math.round(v.v * 3.6)), unit: " km/h", label: `speed, limit ${Math.round(v.edge.speed * 3.6)}` },
    { value: km(left).replace(/ (k?m)$/, ""), unit: ` ${km(left).split(" ")[1]}`, label: "to go" },
    { value: clock, label: "arrives about", title: "At the speeds of the roads ahead" },
  ];
  const what = (b: Building | undefined, role: "from" | "to"): FlowChip[] => {
    if (!b) return [{ text: role === "from" ? "Out of town" : "Leaving", note: "" }];
    return [placeChip(g, b)];
  };
  const flow: FlowRow[] = [{ label: "From", chips: what(fromB, "from") }, { label: "To", chips: what(toB, "to") }];
  if (kind === "car" && tr.kind) flow[1].chips[0].note = ({ work: "to work", home: "home", shop: "shopping", leisure: "out", cargo: "", empty: "", bus: "" } as Record<string, string>)[tr.kind] || undefined;
  const status = vehicleState(v);
  return { title, sub, icon: kind, status, keys, flow, related: rel };
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
  // what mostly uses it: where its vehicles are going, and the trucks' loads
  const dest = new Map<string, { chip: FlowChip; n: number }>();
  for (const v of all) {
    const h = v.trip.haul;
    const b = g.buildings.byId.get(h ? (h.leg === "out" ? h.dest : h.plant) : v.trip.to);
    if (!b) continue;
    const chip = placeChip(g, b);
    if (h && h.leg === "out") chip.product = h.product;
    const k = chip.ref ? `${chip.ref.k}:${chip.ref.id}` : chip.text;
    const e = dest.get(k);
    if (e) e.n++; else dest.set(k, { chip, n: 1 });
  }
  const top = [...dest.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((e) => ({ ...e.chip, note: `${e.n}` }));
  for (const t of top) if (t.ref?.k === "building") rel.to.push(t.ref.id);
  const ring = s.ring ? "Roundabout" : "";
  return {
    title: ring || T.name, sub: ring ? T.name : `${lanes} ${lanes === 1 ? "lane" : "lanes"} · ${Math.round(T.speed * 3.6)} km/h`, icon: ring ? "roundabout" : `road:${s.type}`,
    status: { text: c.word, tone: c.tone, fix: c.tone === "bad" ? "A junction ahead may be holding it up: click it, or try lights, a roundabout or more lanes" : undefined },
    keys: [
      { value: String(all.length), label: all.length === 1 ? "vehicle on it" : "vehicles on it", title: `${stopped} stopped` },
      { value: `${Math.round(speed * 100)}%`, label: "of the speed limit", tone: toneOf(speed, 0.8, 0.45) },
      { value: `${Math.round(full * 100)}%`, label: "full", tone: full > 0.6 ? "bad" : "", title: "How much of its lanes its vehicles and their gaps take up" },
    ],
    flow: top.length ? [{ label: "Heading to", chips: top }] : [],
    related: rel,
  };
}

/** The approaches of a junction: arriving lanes per road, and the vehicles queued on each. */
export function approaches(g: Game, node: number): { seg: number; dir: { x: number; y: number }; queue: number; cars: number }[] {
  const ng = g.net.nodeGeom.get(node);
  if (!ng) return [];
  const out: { seg: number; dir: { x: number; y: number }; queue: number; cars: number }[] = [];
  for (const a of ng.arms) {
    const geo = g.net.segGeom.get(a.seg);
    let queue = 0, cars = 0;
    for (const l of (geo?.lanes ?? []) as Lane[]) {
      if (l.to !== node) continue;
      for (const v of l.occ as Vehicle[]) { cars++; if (v.v < 0.5 && l.pl.length - v.s < 120) queue++; }
    }
    if (geo?.lanes.some((l) => l.to === node)) out.push({ seg: a.seg, dir: a.dir, queue, cars });
  }
  return out;
}

export function junctionModel(g: Game, node: number, compass: (d: { x: number; y: number }) => string): PanelModel | null {
  const n = g.net.nodes.get(node), ng = g.net.nodeGeom.get(node);
  if (!n || !ng) return null;
  const ap = approaches(g, node);
  const queued = ap.reduce((a, x) => a + x.queue, 0);
  const worst = ap.reduce<(typeof ap)[number] | null>((a, x) => (!a || x.queue > a.queue ? x : a), null);
  let inBox = 0;
  for (const c of ng.conns) inBox += c.occ.length;
  const control = n.signal ? "Traffic lights" : n.stops?.length ? "Stop signs" : "Give way";
  const jam = g.traffic.jams.get(node) ?? 0;
  const tone: Tone = queued >= 8 || jam > 6 ? "bad" : queued <= 2 ? "good" : "";
  const rel = emptyRel();
  rel.segs = ap.map((a) => a.seg);
  return {
    title: "Junction", sub: control, icon: "junction",
    status: { text: queued === 0 ? "Clear" : tone === "bad" ? "Backing up" : "Busy", tone, fix: tone === "bad" ? (n.signal ? "Give the worst approach a longer green, or add turn pockets" : "Try lights, stop signs on the quiet roads, or a roundabout") : undefined },
    keys: [
      { value: String(queued), label: queued === 1 ? "vehicle queued" : "vehicles queued", tone },
      { value: worst && worst.queue ? `${compass(worst.dir)}` : "–", unit: worst && worst.queue ? ` ${worst.queue}` : "", label: "worst approach", tone: worst && worst.queue >= 6 ? "bad" : "" },
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

/** The panel model of whatever is selected (null: it is gone). */
export function modelOf(g: Game, sel: Sel, led: TradeLedger | undefined, compass: (d: { x: number; y: number }) => string): PanelModel | null {
  switch (sel.k) {
    case "building": {
      const b = g.buildings.byId.get(sel.id);
      if (!b) return null;
      return b.plant && isPlantKind(b.kind) ? siteModel(g, b, led) : homeModel(g, b);
    }
    case "town": { const t = g.towns.byId.get(sel.id); return t ? townModel(g, t, led) : null; }
    case "vehicle": { const v = g.traffic.vehicles.find((x) => x.id === sel.id); return v ? vehicleModel(g, v) : null; }
    case "seg": return roadModel(g, sel.id);
    case "node": return junctionModel(g, sel.id, compass);
    case "stop": return stopModel(g, sel.id);
  }
}
