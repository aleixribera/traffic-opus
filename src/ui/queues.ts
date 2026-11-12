// The worst queues on the map, in words: where each one is, how many stand in it and for how long, what holds it,
// and the fix that works in this game (src/sim/queues.ts finds and classes them; its header has the measurements
// behind each fix). The Traffic window lists up to three; the junction and road panels say the same for a queue
// held at them. A queue's cause and fix hold a few game hours while it lasts (review 2026-11-12, C6: advice that
// changes its mind), unless it clears or its junction or road is rebuilt.

import { BUILDING_TYPES, LEVEL_H, ROAD_TYPES, type RoadTypeId } from "../config";
import { dist, formatMoney, type V2 } from "../core/math";
import type { Game } from "../game/city";
import type { Feature } from "../game/progression";
import { HOUR } from "../game/society";
import type { RoadNetwork, SignalPlan } from "../roads/network";
import { ROUNDABOUTS, planRoundabout, type BuildWorld, type Plan, type RoundaboutSize } from "../roads/planner";
import { findQueues, lanesEachWay, type Queue, type QueueCause } from "../sim/queues";
import { ADVICE_HOLD } from "./bottleneck";

/** A queue as the Traffic window lists it. */
export interface QueueRow {
  key: string;
  cause: QueueCause;
  /** what holds it, a few words ("Junction full") */
  why: string;
  /** where ("by the Food Plant", "in Alder Run", "near Elton") */
  where: string;
  /** what to do, in the imperative; null where nothing the player builds is known to help */
  fix: string | null;
  /** what a click builds for that fix (fixOffer prices it as the map stands) */
  act?: FixAct;
  vehicles: number;
  trucks: number;
  /** the longest any has stood (s) */
  worst: number;
  at: V2;
  /** what a click selects: the junction holding it, or the road */
  node?: number;
  seg?: number;
  /** the roads it stands on, and the vehicles in it (for the map) */
  segs: number[];
  ids: number[];
}

/** Rows the Traffic window shows at most. */
export const QUEUE_ROWS = 3;
/** Fewer standing vehicles than this is not a queue worth a row (a car at a red). */
export const QUEUE_MIN = 3;
/** Game hours a queue may be gone before it counts as cleared (its advice no longer held). */
const CLEARED = 0.25;
/** A works this close (m) names the place ("by the Sawmill"). */
const NEAR_WORKS = 260;
/** A town this far off (m) or nearer still names it ("near Elton"). */
const NEAR_TOWN = 2500;

const WHY: Record<QueueCause, string> = {
  full: "Junction full",
  giveway: "Waiting for gaps in traffic",
  lights: "Lights can't clear it",
  ring: "Roundabout full",
  road: "Road full",
  gate: "Trucks waiting to turn in",
  turn: "Cars waiting to turn in",
  lane: "Can't change lanes",
  deadlock: "Deadlock",
  other: "Held up",
};

/** The one-lane road types and what each widens to (the same family, two lanes each way). */
const WIDER: Partial<Record<RoadTypeId, RoadTypeId>> = { dirt: "avenue", street: "avenue", streetM: "avenueM", one1: "one2" };

/** What the fixes read of the game (a Game is one; tests hand in a bare road network). */
export interface FixCtx {
  net: RoadNetwork;
  world: BuildWorld;
  roadsUnlocked: Set<RoadTypeId>;
  featureUnlocked(f: Feature): boolean;
  defaultSignal(node: number): SignalPlan | null;
  industry: { plants(): { access?: { seg: number } | null }[] };
  /** what upgrading a road would meet (a works in the way); none given: nothing is in the way */
  upgradePlan?(seg: number, to: RoadTypeId): { errors: { msg: string }[] };
}

// (per road network, whether each road could be widened as the roads stood: display only)
const widens = new WeakMap<RoadNetwork, Map<number, { ver: number; to: RoadTypeId | null }>>();

/** What widening this road means, if it is narrow, the wider road is unlocked and nothing is in its way: its new type. */
function widerOf(g: FixCtx, seg: number): RoadTypeId | null {
  const s = g.net.segs.get(seg);
  const to = s && WIDER[s.type];
  if (!to || !g.roadsUnlocked.has(to)) return null;
  let m = widens.get(g.net);
  if (!m) widens.set(g.net, (m = new Map()));
  const e = m.get(seg);
  if (e && e.ver === g.net.version) return e.to;
  // (the money on hand this minute is not what the fix is: only what stands in the way counts)
  const ok = !g.upgradePlan || !g.upgradePlan(seg, to).errors.some((e) => !e.msg.startsWith(NO_MONEY));
  m.set(seg, { ver: g.net.version, to: ok ? to : null });
  return ok ? to : null;
}

/** The planner's word for a plan the money on hand can't pay for (not a reason the fix can't be built). */
const NO_MONEY = "Not enough money";

/** "Avenue", "Divided avenue", or "Avenue or wider" when the roads differ. */
function widerName(types: RoadTypeId[]): string {
  const u = [...new Set(types)];
  return u.length === 1 ? ROAD_TYPES[u[0]].name : `${ROAD_TYPES.avenue.name} or wider`;
}

// (per road network, the roundabout that fits at a junction as the roads stood: display only)
const fits = new WeakMap<RoadNetwork, Map<number, { ver: number; size: RoundaboutSize | 0 }>>();

/** The roundabout that can be built at a junction now: Medium (the one measured best), else Small; 0 for none. */
export function ringFits(g: FixCtx, node: number): RoundaboutSize | 0 {
  let m = fits.get(g.net);
  if (!m) fits.set(g.net, (m = new Map()));
  const e = m.get(node);
  if (e && e.ver === g.net.version) return e.size;
  const n = g.net.nodes.get(node);
  let size: RoundaboutSize | 0 = 0;
  // (whether it fits, whatever the money on hand)
  const world: BuildWorld = { ...g.world, money: () => Infinity };
  if (n) for (const k of [2, 1] as const) {
    if (!planRoundabout(g.net, world, n.p, k, Math.round(n.h / LEVEL_H)).errors.some((e) => !e.msg.startsWith(NO_MONEY))) { size = k; break; }
  }
  m.set(node, { ver: g.net.version, size });
  return size;
}

/** The fix a queue's advice names, as something one click builds (the junction and road panels offer it). */
export type FixAct =
  /** these roads, each to its wider type (one undo step: Game.upgradeAll) */
  | { kind: "widen"; segs: { seg: number; to: RoadTypeId }[] }
  /** a roundabout of this size on the junction (the Roundabout tool's plan) */
  | { kind: "ring"; node: number; size: RoundaboutSize }
  /** lights on the junction and the rest of its cluster (Game.setSignal) */
  | { kind: "lights"; node: number };

/** A queue's fix: the words, and what a click builds for it (none where it is no one thing: a second road). */
export interface Fix { say: string; act?: FixAct }

/**
 * The fix that works for a queue, measured (src/sim/queues.ts): more lanes for a full junction or road; a roundabout
 * where one road waits for gaps (Medium measured best at a T and a four-way, Small cured a works' gate in
 * tests/gatecures.test.ts); where none fits, lights for a works' gate street (tests/gatecures.test.ts: the gate gets a
 * green of its own); a bigger roundabout for a small one that is full; lights to break a deadlock. Never lights at a
 * junction that is merely busy: there they moved less than giving way did.
 */
export function fixOf(g: FixCtx, q: Pick<Queue, "cause" | "node" | "seg" | "approaches" | "segs">): Fix | null {
  // (a junction's fix is for all its roads, as measured: the words don't follow which approach is queued this minute)
  const arms = q.node !== undefined ? g.net.nodeGeom.get(q.node)?.arms.map((a) => a.seg).filter((x) => !g.net.segs.get(x)?.ring) ?? [] : [];
  const roads = q.cause === "road" || q.cause === "lane" ? (q.seg !== undefined ? [q.seg] : []) : arms.length ? arms : q.segs.slice(0, 2);
  const wider = [...new Set(roads)].map((seg) => ({ seg, to: widerOf(g, seg) })).filter((w): w is { seg: number; to: RoadTypeId } => !!w.to);
  // (the click takes in the narrow roads something stands in the way of too, so its button can say which stay and why)
  const narrow = [...new Set(roads)].map((seg) => ({ seg, to: WIDER[g.net.segs.get(seg)?.type as RoadTypeId] })).filter((w): w is { seg: number; to: RoadTypeId } => !!w.to && g.roadsUnlocked.has(w.to));
  const widen = (it: string): Fix | null =>
    wider.length ? { say: `Widen ${it} to ${widerName(wider.map((w) => w.to))}`, act: { kind: "widen", segs: narrow } }
    : roads.some((s) => lanesEachWay(g.net, s) >= 2) ? { say: `Build a second road to share ${q.cause === "road" ? "its" : "the"} traffic` } : null;
  const many = wider.length > 1;
  const lights = (node: number): Fix => ({ say: "Add traffic lights here", act: { kind: "lights", node } });
  switch (q.cause) {
    case "full":
    case "lights":
      return widen(many ? "its roads" : "the road in");
    case "giveway": {
      const size = q.node !== undefined && g.featureUnlocked("roundabout") ? ringFits(g, q.node) : 0;
      if (size && q.node !== undefined) return { say: `Build a ${ROUNDABOUTS[size].name} roundabout here`, act: { kind: "ring", node: q.node, size } };
      const gates = new Set(g.industry.plants().map((b) => b.access?.seg));
      if (q.node !== undefined && g.featureUnlocked("signals") && !g.net.nodes.get(q.node)?.signal && q.approaches.some((s) => gates.has(s)) && g.defaultSignal(q.node)) return lights(q.node);
      return widen("the road in");
    }
    case "ring": {
      const ring = q.node !== undefined ? g.net.nodeGeom.get(q.node)?.arms.map((a) => g.net.segs.get(a.seg)).find((s) => s?.ring) : undefined;
      // (a Small or Medium ring: the next size up; a big one, more roads)
      return ring && (ring.type === "one1" || ring.type === "one2") ? { say: "Build a bigger roundabout here" } : widen("the roads in");
    }
    case "road":
      return widen("it");
    case "deadlock": {
      const n = q.node;
      // (never at a roundabout: its entries give way to the ring, lights there only stop it)
      const ringed = n !== undefined && g.net.nodeGeom.get(n)?.arms.some((a) => g.net.segs.get(a.seg)?.ring);
      if (n !== undefined && !ringed && g.featureUnlocked("signals") && !g.net.nodes.get(n)?.signal && g.defaultSignal(n)) return lights(n);
      return { say: "Build a second way round" };
    }
    default:
      return null;
  }
}

/** The fix for a queue in words (fixOf without the click). */
export const queueFix = (g: FixCtx, q: Pick<Queue, "cause" | "node" | "seg" | "approaches" | "segs">): string | null => fixOf(g, q)?.say ?? null;

/** Where a place is, in a few words: by a works of the company's, in a town, near one, or out on the road. */
export function placeWords(g: Game, p: V2): string {
  let works: { name: string; d: number } | null = null;
  for (const b of g.industry.plants()) {
    const d = dist(b.c, p) - Math.max(b.hw, b.hd);
    if (d < NEAR_WORKS && (!works || d < works.d)) works = { name: BUILDING_TYPES[b.kind].name, d };
  }
  if (works) return `by the ${works.name}`;
  const t = g.towns.townAt(p);
  if (t) return `in ${t.name}`;
  let near: { name: string; d: number } | null = null;
  for (const x of g.towns.list) {
    const d = dist(x.c, p);
    if (d < NEAR_TOWN && (!near || d < near.d)) near = { name: x.name, d };
  }
  return near ? `near ${near.name}` : "on the open road";
}

// (per game, the cause last given per queue: display only, not in the save)
const held = new WeakMap<object, Map<string, { cause: QueueCause; fix: string | null; act?: FixAct; at: number; seen: number; place: string }>>();

/** What a queue's junction or road is built as now: rebuilding it (lights, a wider road) is a real change. */
function placeKey(g: FixCtx, q: Queue): string {
  if (q.node !== undefined) {
    const n = g.net.nodes.get(q.node), ng = g.net.nodeGeom.get(q.node);
    return `${n?.signal ? "L" : ""}${ng?.arms.map((a) => g.net.segs.get(a.seg)?.type ?? "").join(",") ?? ""}`;
  }
  return q.seg !== undefined ? g.net.segs.get(q.seg)?.type ?? "" : "";
}

/**
 * A queue's cause and fix, held (see holdAdvice in bottleneck.ts): once a queue has been given them, different ones
 * wait ADVICE_HOLD game hours, unless the queue cleared meanwhile or its junction or road was rebuilt. A queue whose
 * front shuffles between two classes as its approaches fill and empty keeps the first.
 */
export function holdAdvice(g: FixCtx & { time: number }, q: Queue): { cause: QueueCause; fix: string | null; act?: FixAct } {
  let m = held.get(g);
  if (!m) held.set(g, (m = new Map()));
  const f = fixOf(g, q), fix = f?.say ?? null, act = f?.act;
  const now = g.time / HOUR, place = placeKey(g, q), e = m.get(q.key);
  const live = e && now >= e.seen && now - e.seen <= CLEARED && e.place === place;
  const same = live && e.cause === q.cause && e.fix === fix;
  if (live && !same && now - e.at < ADVICE_HOLD) { e.seen = now; return { cause: e.cause, fix: e.fix, act: e.act }; }
  m.set(q.key, { cause: q.cause, fix, act, at: same ? e.at : now, seen: now, place });
  // (queues long cleared are forgotten, so a long game doesn't pile them up)
  if (m.size > 64) for (const [k, x] of m) if (now - x.seen > CLEARED || now < x.seen) m.delete(k);
  return { cause: q.cause, fix, act };
}

/** Forget the causes given so far (a test that changes the map with the clock stopped). */
export const forgetQueues = (g: object): void => void held.delete(g);

/** A queue as a row: its held cause, the words for it, and its fix. */
export function queueRow(g: Game, q: Queue): QueueRow {
  const { cause, fix, act } = holdAdvice(g, q);
  return {
    key: q.key, cause, why: WHY[cause], where: placeWords(g, q.at), fix, act,
    vehicles: q.vehicles.length, trucks: q.trucks, worst: q.worst, at: q.at,
    node: q.node, seg: q.node === undefined ? q.seg ?? q.segs[0] : undefined,
    segs: q.segs, ids: q.vehicles.map((v) => v.id),
  };
}

/** The worst queues now (most vehicles first), as rows: up to QUEUE_ROWS, each of QUEUE_MIN vehicles or more. */
export function worstQueues(g: Game, max = QUEUE_ROWS): QueueRow[] {
  return findQueues(g.traffic.vehicles, g.net).filter((q) => q.vehicles.length >= QUEUE_MIN).slice(0, max).map((q) => queueRow(g, q));
}

/**
 * The queue held at a junction, or on a road: one held by that road itself, or one standing on it that a junction
 * holds (for the junction and road panels; the most vehicles first).
 */
export function queueAt(g: Game, at: { node?: number; seg?: number }): QueueRow | null {
  const q = findQueues(g.traffic.vehicles, g.net).find((x) => x.vehicles.length >= QUEUE_MIN && (at.node !== undefined ? x.node === at.node : x.seg === at.seg || (x.node !== undefined && x.segs.includes(at.seg!))));
  return q ? queueRow(g, q) : null;
}

const AT_JUNCTION: Partial<Record<QueueCause, string>> = {
  full: "Queued into a full junction",
  giveway: "Waiting for gaps at a junction",
  lights: "Queued at lights that can't clear it",
  ring: "Queued into a full roundabout",
  deadlock: "Deadlock at a junction",
};

/** What a road's panel says of a queue on it: what holds it (a junction it queues into, or this road) and the fix. */
export function roadQueueSay(q: QueueRow): string {
  const there = q.node !== undefined;
  const why = there ? AT_JUNCTION[q.cause] ?? q.why : q.why;
  const fix = q.fix && there ? q.fix.replace(/ here$/, " there") : q.fix;
  return fix ? `${why}. ${fix}` : why;
}

// ------------------------------------------------------------------------------------------- the fix, one click

/** A queue's fix as a button: its words and price as the map stands now, and why it can't be built, if it can't. */
export interface FixOffer {
  act: FixAct;
  /** "Widen to Avenue · $12,400" */
  label: string;
  /** what the click costs, all in (a roundabout's homes paid for too) */
  cost: number;
  /** why the click can't build it now, in the game's words (the button is off) */
  blocked?: string;
  /** what the click leaves out, said beside the button ("1 road stays: Sawmill in the way") */
  note?: string;
  /** for the hover preview: the roads it widens, or the roundabout's plan */
  segs: number[];
  plan?: Plan;
}

/** A queue's fix priced and checked as the map stands now; null where there is nothing left to build (done already). */
export function fixOffer(g: Game, act: FixAct): FixOffer | null {
  if (act.kind === "widen") {
    const ok: { seg: number; to: RoadTypeId }[] = [];
    let cost = 0, stays = 0, why = "";
    for (const w of act.segs) {
      const s = g.net.segs.get(w.seg);
      // (gone, or widened already: nothing to do there)
      if (!s || s.type === w.to || !WIDER[s.type]) continue;
      const u = g.upgradePlan(w.seg, w.to);
      const err = u.errors.find((e) => !e.msg.startsWith(NO_MONEY));
      if (err) { stays++; why ||= err.msg; continue; }
      ok.push(w);
      cost += u.cost;
    }
    if (!ok.length && !stays) return null;
    const label = `Widen to ${widerName((ok.length ? ok : act.segs).map((w) => w.to))}${ok.length ? ` · ${formatMoney(cost)}` : ""}`;
    const done: FixAct = { kind: "widen", segs: ok };
    if (!ok.length) return { act: done, label, cost: 0, blocked: why, segs: [] };
    return {
      act: done, label, cost, segs: ok.map((w) => w.seg),
      blocked: cost > g.money + 0.5 ? NO_MONEY : undefined,
      note: stays ? `${stays === 1 ? "1 road stays" : `${stays} roads stay`}: ${why}` : undefined,
    };
  }
  if (act.kind === "ring") {
    const n = g.net.nodes.get(act.node);
    if (!n || g.net.nodeGeom.get(act.node)?.arms.some((a) => g.net.segs.get(a.seg)?.ring)) return null;
    // (planned whatever the money: the price below is checked against it with the homes it clears)
    const plan = planRoundabout(g.net, { ...g.world, money: () => Infinity }, n.p, act.size, Math.round(n.h / LEVEL_H));
    const lots = plan.errors.length ? [] : g.lotsUnder(plan);
    const cost = plan.cost + g.demolishCost(lots);
    const label = `Build a ${ROUNDABOUTS[act.size].name} roundabout${plan.errors.length ? "" : ` · ${formatMoney(cost)}`}`;
    return {
      act, label, cost, segs: [], plan,
      blocked: plan.errors[0]?.msg ?? (cost > g.money + 0.5 ? NO_MONEY : undefined),
      note: lots.length && !plan.errors.length ? `Clears ${lots.length === 1 ? "1 building" : `${lots.length} buildings`}` : undefined,
    };
  }
  const n = g.net.nodes.get(act.node);
  if (!n || n.signal || !g.featureUnlocked("signals") || !g.defaultSignal(act.node)) return null;
  const cost = g.lightsCost(act.node);
  return { act, label: `Add traffic lights · ${formatMoney(cost)}`, cost, segs: [], blocked: cost > g.money + 0.5 ? NO_MONEY : undefined };
}

/** Build a queue's fix (one undo step), as the offer priced it. Null: built; otherwise why not, in the game's words. */
export function applyFix(g: Game, act: FixAct): string | null {
  const o = fixOffer(g, act);
  if (!o) return "Already built";
  if (o.blocked) return o.blocked;
  const a = o.act;
  if (a.kind === "widen") return g.upgradeAll(a.segs) ? null : "Not built";
  if (a.kind === "ring") return o.plan && g.build(o.plan) ? null : "Not built";
  const plan = g.defaultSignal(a.node);
  return plan && g.setSignal(a.node, plan) ? null : NO_MONEY;
}
