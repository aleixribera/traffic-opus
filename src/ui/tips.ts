// The next-step tip under the goals (docs/design.md "Tips", owner 2026-11-08: "they are annoying, and sometimes
// wrong for the current state of the map"). Only a few, each teaching something the game doesn't show by itself,
// and each checks the live map before it shows: it stays away once its step is done or no longer applies, and it
// names a town only when that town is the one that needs it. The player can dismiss each one, or turn them all off
// (kept per browser, see TipPrefs).

import { BUILDING_TYPES } from "../config";
import type { Building } from "../game/buildings";
import { GATE_LINK_REACH, type Game } from "../game/city";
import { PLANTS, PRODUCTS, SHELF, UNPOWERED, type PlantKind, type Product } from "../game/industry";
import { compassWords, type Town } from "../game/settlements";
import { needFrom, needsOf } from "../game/towns";
import { ENOUGH } from "../game/supply";
import { F } from "../world/gen";
import { MILESTONES } from "../game/progression";
import { buildOrder, needHelp, shortfalls, worstCeiling } from "./bottleneck";
import { STUCK_RAISE, stuckSpots } from "./stuckAlerts";
import { distText, planLength } from "./distance";

export interface Tip {
  /** which tip it is (what a dismissal remembers) */
  id: TipId;
  html: string;
  /** the bottom bar's category it leads to (its button gets a marker) */
  cat?: "roads" | "industry";
  /** a works whose offered road the tip's own button lays (Game.roadTo), and what that costs */
  road?: { works: number; cost: number };
  /** the product whose chain it is about: a goal's line on the same chain says it already, and the tip stands down */
  p?: Product;
}

export type TipId = "farm" | "noroad" | "foodplant" | "connect" | "jam" | "ceiling" | "planks" | "newtown" | "sitewait" | "deposits" | "power" | "parts" | "milk" | "supplies";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const lower = (k: PlantKind) => BUILDING_TYPES[k].name.toLowerCase();

/** A town wants this product and isn't getting most of it (or hasn't had any yet). */
export const wants = (t: Town, p: Product): boolean => needsOf(t.pop).includes(p) && (t.supply[p] ?? 0) < ENOUGH;

/** Cached per road network version and building count: these walk the roads (a new site can join others by its gate alone). */
const memo = new WeakMap<Game, { v: string; soil?: boolean; joined: Map<number, boolean>; cut: Map<number, boolean> }>();
const cacheOf = (g: Game) => {
  let c = memo.get(g);
  const v = `${g.net.version}|${g.buildings.list.length}`;
  if (!c || c.v !== v) memo.set(g, (c = { v, joined: new Map(), cut: new Map() }));
  return c;
};

/** How far from a road a new site's gate street reaches (city.ts GATE_LINK_REACH), less a little for its plot. */
const SOIL_REACH = 340;

/** Is there fertile soil within reach of a road (where a farm placed lays its own street to the road)? */
export function soilInReach(g: Game): boolean {
  const c = cacheOf(g);
  if (c.soil !== undefined) return c.soil;
  c.soil = false;
  for (const n of g.net.nodes.values()) {
    if (!g.net.segsAt(n.id).length) continue;
    for (const r of [50, 150, 250, SOIL_REACH]) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = { x: n.p.x + Math.cos(a) * r, y: n.p.y + Math.sin(a) * r };
      if (g.world.inBounds(p) && !g.world.isWater(p) && g.terrain.has(F.fert, p)) return (c.soil = true);
    }
  }
  return c.soil;
}

/**
 * Is a town joined by road to somewhere a load can come from: another town's streets, or the gate of a works that
 * makes something it buys? A stub of road out of it, or a logging camp at its edge, is not that: its label said
 * "First load due" with nothing that makes food on its roads.
 */
export function joinedUp(g: Game, t: Town): boolean {
  const c = cacheOf(g);
  const k = c.joined.get(t.id);
  if (k !== undefined) return k;
  let start: number | undefined;
  for (const s of g.net.segs.values()) if (s.town === t.id) { start = s.a; break; }
  let out = false;
  if (start !== undefined) {
    const needs = needsOf(t.pop);
    const gates = new Set<number>();
    for (const b of g.buildings.list) if (b.plant && b.access && needs.some((p) => PLANTS[b.kind as PlantKind]?.outputs[p])) gates.add(b.access.seg);
    const seen = new Set([start]), q = [start];
    walk: while (q.length) {
      for (const s of g.net.segsAt(q.pop()!)) {
        if (gates.has(s.id) || (s.town !== undefined && s.town !== t.id)) { out = true; break walk; }
        for (const m of [s.a, s.b]) if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
  }
  c.joined.set(t.id, out);
  return out;
}

/**
 * Is a site cut off: no road to its gate, or its roads reach no town and no other site (a farm placed out past
 * where its gate street reaches, waiting for a road)?
 */
export function cutOff(g: Game, b: Building): boolean {
  const c = cacheOf(g);
  const k = c.cut.get(b.id);
  if (k !== undefined) return k;
  const out = !g.roadsLeadOut(b);
  c.cut.set(b.id, out);
  return out;
}

/** How many of the goals reached last still point at their new mines' deposits: older ones are old news. */
export const DEPOSIT_GOALS = 2;

/** Vehicles standing together before the tip calls it a jam (one truck waiting out a long turn is not one). */
export const JAM_CARS = 4;

/** The plants that make a product (a sawmill for planks). */
const makersOf = (p: Product) => (Object.keys(PLANTS) as PlantKind[]).filter((k) => PLANTS[k].outputs[p]);

/**
 * The tip for the map as it is now, or null. `skip`: tips the player has dismissed. `signed`: the places the
 * Traffic stuck sign counts now (the jam tip says that number). The first that applies wins, in the order a company
 * meets them.
 */
export function tipFor(g: Game, skip: (id: TipId) => boolean = () => false, signed?: number): Tip | null {
  const plants = g.buildings.list.filter((b) => b.plant);
  const has = (k: PlantKind) => plants.some((b) => b.kind === k);
  const built = (b: Building) => b.built >= 1 && !b.plant!.site;
  const biggest = (ts: Town[]) => ts.reduce<Town | null>((a, t) => (!a || t.pop > a.pop ? t : a), null);
  const show = (t: Tip | null): Tip | null => (t && !skip(t.id) ? t : null);
  // the towns a first chain can sell to (not one that just sprang up with no road to it)
  const reached = g.towns.list.filter((x) => !x.spawned || joinedUp(g, x));
  // the works the goals reached last opened, newest goal first and in the order to build them; none once every goal
  // is reached (owner, 2026-11-10: the oil well tip at 20 of 20)
  const lately = (): PlantKind[] => (g.progress.done.length >= MILESTONES.length ? [] : g.progress.done.slice(-DEPOSIT_GOALS).reverse()
    .flatMap((id) => buildOrder((MILESTONES.find((m) => m.id === id)?.unlocks.buildings ?? []).filter((x): x is PlantKind => x in PLANTS))));
  const tips:(() => Tip | null)[] = [
    // a food chain: a farm on fertile soil (it lays its own street to a road within reach), then a food plant
    () => {
      if (has("farm")) return null;
      const t = biggest(reached.filter((x) => wants(x, "food")));
      const who = t ? `${esc(t.name)} needs food.` : "Start a food chain.";
      return soilInReach(g)
        ? { id: "farm", cat: "industry", p: "food", html: `<b>${who}</b> Place a <b>Farm</b> on fertile soil within ${GATE_LINK_REACH} m of a road. It lays its own street to it.` }
        : { id: "farm", cat: "roads", p: "food", html: `<b>${who}</b> No fertile soil lies near your roads. Lay a road out to some, then place a <b>Farm</b> on it.` };
    },
    // a site placed out past its gate street's reach, with no road to anything yet
    () => {
      const b = plants.find((x) => cutOff(g, x));
      if (!b) return null;
      // (with no road at its gate at all, the game offers the dirt road to it: dashed on the map, one click here)
      const plan = b.access ? null : g.roadTo(b);
      if (plan) return { id: "noroad", cat: "roads", road: { works: b.id, cost: plan.cost }, html: `<b>No road reaches your ${lower(b.kind as PlantKind)}.</b> A dirt road from its gate to yours is ${distText(planLength(plan))}.` };
      return { id: "noroad", cat: "roads", html: `<b>No road reaches your ${lower(b.kind as PlantKind)}.</b> Lay one from its gate to your roads.` };
    },
    () => {
      if (!has("farm") || has("foodplant")) return null;
      const t = biggest(reached.filter((x) => wants(x, "food")));
      return { id: "foodplant", cat: "industry", p: "food", html: `<b>Build a Food Plant</b> on a road your farm reaches. It turns crops into food for ${t ? esc(t.name) : "your towns"}.` };
    },
    // a plant whose roads lead nowhere it can sell
    () => {
      const b = plants.find((x) => built(x) && x.problem?.startsWith("Nobody your roads reach"));
      return b ? { id: "connect", cat: "roads", html: `<b>Your ${lower(b.kind as PlantKind)} has nobody to sell to.</b> Join it by road to a works or town that takes its goods.` } : null;
    },
    // traffic standing still: while it does, that is the one job (play-test 2026-11-09, D3: the tip talked about
    // limestone 5.5 km north through an hour of gridlock)
    () => {
      const spots = stuckSpots(g.traffic.stuckCars(STUCK_RAISE)).filter((s) => s.cars >= JAM_CARS);
      if (!spots.length) return null;
      // (the count is the sign's, which it points at: "stuck in 5 places" stood beside a sign reading 14, counted
      // another way. Review 2026-11-10, B8. With no sign up yet, there is nothing to point at)
      if (signed !== undefined && signed < 1) return null;
      const n = signed ?? spots.length;
      return { id: "jam", cat: "roads", html: `<b>Traffic is stuck in ${n === 1 ? "one place" : `${n} places`}.</b> The <b>Traffic stuck</b> sign flies you there. Give the junction a turn lane or lights, or a second road.` };
    },
    // a works flat out with a town still asking for more (B1: "nothing said build a second Food Plant")
    () => {
      const w = worstCeiling(g);
      if (w?.c.town) return { id: "ceiling", cat: "industry", html: `<b>Your ${esc(BUILDING_TYPES[w.b.kind].name)} is at full output.</b> ${esc(w.c.fix)}` };
      // (or a step up the chain: the food plant waits for crops with the one farm flat out)
      const s = shortfalls(g, 1)[0];
      const h = s ? needHelp(g, s.worst, s.p) : null;
      return s && h?.kind === "full" ? { id: "ceiling", cat: "industry", p: s.p, html: `<b>${esc(s.worst.name)} needs more ${PRODUCTS[s.p].name.toLowerCase()}.</b> ${esc(h.say)}` } : null;
    },
    // timber, before the hamlet wants planks. Not before the first food has landed: one chain at a time (owner,
    // 2026-11-10: the tip jumped to planks while the first goal still stood at 0 of 1)
    () => {
      if (has("sawmill") || (g.progress.sold.food ?? 0) < 1) return null;
      const at = needFrom("planks");
      const t = biggest(reached.filter((x) => x.pop >= at * 0.6 || wants(x, "planks")));
      if (!t) return null;
      const now = t.pop >= at ? `wants planks now` : `will want planks at ${at} people`;
      const what = has("loggingcamp") ? `Build a <b>Sawmill</b> on your logging camp's road.` : `Place a <b>Logging camp</b> in the forest and a <b>Sawmill</b> beside its road.`;
      return { id: "planks", cat: "industry", p: "planks", html: `<b>${esc(t.name)} ${now}.</b> ${what}` };
    },
    // a town that sprang up and has no road to anything yet
    () => {
      const t = g.towns.list.find((x) => x.spawned && !joinedUp(g, x));
      if (!t) return null;
      let from: Town | null = null;
      const d = (a: Town) => Math.hypot(a.c.x - t.c.x, a.c.y - t.c.y);
      for (const o of g.towns.list) if (o !== t && (!from || d(o) < d(from))) from = o;
      const where = from ? `It lies ${km(d(from))} ${compassWords(from.c, t.c)} of ${esc(from.name)}. ` : "";
      return { id: "newtown", cat: "roads", html: `<b>No road reaches ${esc(t.name)} yet.</b> ${where}Lay one out to sell it food.` };
    },
    // a building site waiting for something none of the company's plants makes
    () => {
      for (const b of plants) {
        const s = b.plant!.site;
        if (!s) continue;
        const p = (Object.keys(s.need) as Product[]).find((q) => (s.got[q] ?? 0) < s.need[q]! && !makersOf(q).some(has));
        if (!p) continue;
        const k = makersOf(p)[0];
        return { id: "sitewait", cat: "industry", p, html: `<b>Your ${lower(b.kind as PlantKind)} site waits for ${PRODUCTS[p].name.toLowerCase()}.</b> Build ${k ? `a <b>${BUILDING_TYPES[k].name}</b>` : "a works that makes it"} on its roads.` };
      }
      return null;
    },
    // plants that draw power and get none: the power plant is the first thing to build
    () => {
      if (!g.placedUnlocked("coalplant") || has("coalplant")) return null;
      const b = plants.find((x) => built(x) && PLANTS[x.kind as PlantKind].power);
      // (none of them built yet, and the goal that opened the power plant only just reached: say it before the mines
      // go down, as the goal's banner does)
      if (!b) return lately().includes("coalplant") ? { id: "power", cat: "industry", html: `<b>Build a Power plant first.</b> Mines and the smelter run at ${Math.round(UNPOWERED * 100)}% without power. It burns coal or wood chips.` } : null;
      return { id: "power", cat: "industry", html: `<b>Your ${lower(b.kind as PlantKind)} runs at ${Math.round(UNPOWERED * 100)}% without power.</b> Build a <b>Power plant</b> within ${PLANTS.coalplant.reach! / 1000} km of it, on the same roads.` };
    },
    // a mined deposit just opened: where to find it. Only for the works a goal reached lately opened, in the order
    // to build them
    () => {
      const k = lately().find((x) => {
        const f = PLANTS[x].deposit?.field;
        return f !== undefined && f !== F.fert && f !== F.forest && g.placedUnlocked(x) && !has(x);
      });
      if (!k) return null;
      const dep = PLANTS[k].deposit!, home = g.towns.list[0];
      const near = home ? g.terrain.gen.depositsNear(dep.field, home.c.x, home.c.y, 24000)[0] : undefined;
      const where = near && home ? ` The nearest lies ${km(Math.hypot(near.x - home.c.x, near.y - home.c.y))} ${compassWords(home.c, near)} of ${esc(home.name)}.` : "";
      return { id: "deposits", cat: "industry", html: `<b>The ${lower(k)} goes on ${dep.name.toLowerCase()}.</b>${where} <b>Views › Resources</b> shows every deposit.` };
    },
    // towns' new blocks waiting for construction parts
    () => {
      if (!g.placedUnlocked("constructionplant") || has("constructionplant")) return null;
      const n = new Map<number, number>();
      for (const b of g.buildings.list) if (b.site && b.town !== undefined) n.set(b.town, (n.get(b.town) ?? 0) + 1);
      const best = [...n].sort((a, b) => b[1] - a[1])[0];
      const t = best && g.towns.byId.get(best[0]);
      if (!t) return null;
      return { id: "parts", cat: "industry", html: `<b>${esc(t.name)}'s new blocks wait for construction parts.</b> Build a <b>Construction plant</b> your smelter and cement works reach.` };
    },
    // milk, which spoils on the way
    () => {
      if (!g.placedUnlocked("dairyfarm") || has("dairyfarm")) return null;
      return { id: "milk", cat: "industry", html: `<b>Villages buy fresh milk and grow faster for it.</b> Place a <b>Dairy farm</b> a short drive away. Milk spoils after about ${Math.round((SHELF.milk! * 12) / 1000)} km.` };
    },
    // farms and mines held at level 2 for want of supplies
    () => {
      if (!g.placedUnlocked("chemworks") || has("chemworks")) return null;
      const b = plants.find((x) => built(x) && PLANTS[x.kind as PlantKind].supplies && x.plant!.level >= 2);
      if (!b) return null;
      return { id: "supplies", cat: "industry", html: `<b>Farms and mines need supplies past level 2.</b> Build a <b>Chemical works</b> your quarry and a coal mine reach.` };
    },
  ];
  for (const f of tips) {
    const t = show(f());
    if (t) return t;
  }
  return null;
}

/** The player's tip settings, kept per browser: tips off altogether, and the ones dismissed. */
export class TipPrefs {
  static readonly OFF = "flowtown.tips.off";
  static readonly DISMISSED = "flowtown.tips.dismissed";
  off = false;
  dismissed = new Set<string>();

  constructor(private store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = TipPrefs.storage()) {
    try {
      this.off = store?.getItem(TipPrefs.OFF) === "1";
      const d = JSON.parse(store?.getItem(TipPrefs.DISMISSED) ?? "[]");
      if (Array.isArray(d)) this.dismissed = new Set(d.filter((x) => typeof x === "string"));
    } catch { /* unreadable: the defaults */ }
  }

  private static storage() {
    try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
  }

  setOff(off: boolean) {
    this.off = off;
    try { if (off) this.store?.setItem(TipPrefs.OFF, "1"); else this.store?.removeItem(TipPrefs.OFF); } catch { /* storage blocked */ }
  }

  dismiss(id: string) {
    this.dismissed.add(id);
    try { this.store?.setItem(TipPrefs.DISMISSED, JSON.stringify([...this.dismissed])); } catch { /* storage blocked */ }
  }

  /** Every tip back (turning them on again from the menu). */
  reset() {
    this.dismissed.clear();
    try { this.store?.removeItem(TipPrefs.DISMISSED); } catch { /* storage blocked */ }
  }
}
