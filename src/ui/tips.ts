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
import { F } from "../world/gen";

export interface Tip {
  /** which tip it is (what a dismissal remembers) */
  id: TipId;
  html: string;
  /** the bottom bar's category it leads to (its button gets a marker) */
  cat?: "roads" | "industry";
}

export type TipId = "farm" | "noroad" | "foodplant" | "connect" | "planks" | "newtown" | "sitewait" | "deposits" | "power" | "parts" | "milk" | "supplies";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const lower = (k: PlantKind) => BUILDING_TYPES[k].name.toLowerCase();

/** A town wants this product and isn't getting most of it (or hasn't had any yet). */
export const wants = (t: Town, p: Product): boolean => needsOf(t.pop).includes(p) && (t.supply[p] ?? 0) < 0.8;

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

/** Is a town's street network joined by road to anything beyond its own streets (the company's roads, another town)? */
export function joinedUp(g: Game, t: Town): boolean {
  const c = cacheOf(g);
  const k = c.joined.get(t.id);
  if (k !== undefined) return k;
  let start: number | undefined;
  for (const s of g.net.segs.values()) if (s.town === t.id) { start = s.a; break; }
  let out = false;
  if (start !== undefined) {
    const seen = new Set([start]), q = [start];
    walk: while (q.length) {
      for (const s of g.net.segsAt(q.pop()!)) {
        if (s.town !== t.id) { out = true; break walk; }
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
  let out = true;
  const s0 = b.access ? g.net.segs.get(b.access.seg) : undefined;
  if (s0) {
    const gates = new Set<number>();
    for (const o of g.buildings.list) if (o.plant && o !== b && o.access) gates.add(o.access.seg);
    const seen = new Set([s0.a, s0.b]), q = [s0.a, s0.b];
    walk: while (q.length) {
      for (const s of g.net.segsAt(q.pop()!)) {
        if (s.town !== undefined || gates.has(s.id)) { out = false; break walk; }
        for (const m of [s.a, s.b]) if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
  }
  c.cut.set(b.id, out);
  return out;
}

/** The plants that make a product (a sawmill for planks). */
const makersOf = (p: Product) => (Object.keys(PLANTS) as PlantKind[]).filter((k) => PLANTS[k].outputs[p]);

/**
 * The tip for the map as it is now, or null. `skip`: tips the player has dismissed. The first that applies wins,
 * in the order a company meets them.
 */
export function tipFor(g: Game, skip: (id: TipId) => boolean = () => false): Tip | null {
  const plants = g.buildings.list.filter((b) => b.plant);
  const has = (k: PlantKind) => plants.some((b) => b.kind === k);
  const built = (b: Building) => b.built >= 1 && !b.plant!.site;
  const biggest = (ts: Town[]) => ts.reduce<Town | null>((a, t) => (!a || t.pop > a.pop ? t : a), null);
  const show = (t: Tip | null): Tip | null => (t && !skip(t.id) ? t : null);
  // the towns a first chain can sell to (not one that just sprang up with no road to it)
  const reached = g.towns.list.filter((x) => !x.spawned || joinedUp(g, x));
  const tips: (() => Tip | null)[] = [
    // a food chain: a farm on fertile soil (it lays its own street to a road within reach), then a food plant
    () => {
      if (has("farm")) return null;
      const t = biggest(reached.filter((x) => wants(x, "food")));
      const who = t ? ` ${esc(t.name)} needs food.` : "";
      return soilInReach(g)
        ? { id: "farm", cat: "industry", html: `<b>Start a food chain.</b>${who} Open <b>Industry</b> and place a <b>Farm</b> on fertile soil within ${GATE_LINK_REACH} m of a road: the ground shows the soil while you place, and the farm lays its own street to the road.` }
        : { id: "farm", cat: "roads", html: `<b>Start a food chain.</b>${who} No fertile soil lies near your roads yet: lay a road out to some (the <b>Resources</b> view shows it), then place a <b>Farm</b> on it from <b>Industry</b>.` };
    },
    // a site placed out past its gate street's reach, with no road to anything yet
    () => {
      const b = plants.find((x) => cutOff(g, x));
      return b ? { id: "noroad", cat: "roads", html: `<b>No road reaches your ${lower(b.kind as PlantKind)} yet.</b> Lay one from its gate to your roads: its trucks can't go anywhere till then. (A site placed within ${GATE_LINK_REACH} m of a road lays its own street to it.)` } : null;
    },
    () => {
      if (!has("farm") || has("foodplant")) return null;
      const t = biggest(reached.filter((x) => wants(x, "food")));
      return { id: "foodplant", cat: "industry", html: `<b>Build a Food plant</b> (Industry › Processing) on a road your farm reaches. The farm's trucks bring it crops; its own trucks sell the food to ${t ? `${esc(t.name)}'s` : "your towns'"} shops.` };
    },
    // a plant whose roads lead nowhere it can sell
    () => {
      const b = plants.find((x) => built(x) && x.problem?.startsWith("Nobody your roads reach"));
      return b ? { id: "connect", cat: "roads", html: `<b>Your ${lower(b.kind as PlantKind)} has nobody to sell to.</b> Join it by road to a plant or a town that takes what it makes.` } : null;
    },
    // timber, before the hamlet wants planks
    () => {
      if (has("sawmill")) return null;
      const at = needFrom("planks");
      const t = biggest(reached.filter((x) => x.pop >= at * 0.6 || wants(x, "planks")));
      if (!t) return null;
      const now = t.pop >= at ? `wants planks now` : `will want planks at ${at} people`;
      const what = has("loggingcamp") ? `Build a <b>Sawmill</b> on your logging camp's road` : `Place a <b>Logging camp</b> in the forest and a <b>Sawmill</b> beside its road`;
      return { id: "planks", cat: "industry", html: `<b>${esc(t.name)} ${now}.</b> ${what}, and join the sawmill by road to ${esc(t.name)}.` };
    },
    // a town that sprang up and has no road to anything yet
    () => {
      const t = g.towns.list.find((x) => x.spawned && !joinedUp(g, x));
      if (!t) return null;
      let from: Town | null = null;
      const d = (a: Town) => Math.hypot(a.c.x - t.c.x, a.c.y - t.c.y);
      for (const o of g.towns.list) if (o !== t && (!from || d(o) < d(from))) from = o;
      const where = from ? `, ${km(d(from))} ${compassWords(from.c, t.c)} of ${esc(from.name)}` : "";
      return { id: "newtown", cat: "roads", html: `<b>${esc(t.name)} has no road to it yet${where}.</b> Lay one out and send it food: a new market for the company. <b>Towns</b> in the bar flies you there.` };
    },
    // a building site waiting for something none of the company's plants makes
    () => {
      for (const b of plants) {
        const s = b.plant!.site;
        if (!s) continue;
        const p = (Object.keys(s.need) as Product[]).find((q) => (s.got[q] ?? 0) < s.need[q]! && !makersOf(q).some(has));
        if (!p) continue;
        const k = makersOf(p)[0];
        return { id: "sitewait", cat: "industry", html: `<b>Your ${lower(b.kind as PlantKind)} is a building site waiting for ${PRODUCTS[p].name.toLowerCase()}.</b> None of your plants make it yet: a ${k ? `<b>${BUILDING_TYPES[k].name}</b>` : "plant"} joined to it by road sends it.` };
      }
      return null;
    },
    // a mined deposit just opened: where to find it
    () => {
      const k = (Object.keys(PLANTS) as PlantKind[]).find((x) => {
        const f = PLANTS[x].deposit?.field;
        return f !== undefined && f !== F.fert && f !== F.forest && g.placedUnlocked(x) && !has(x);
      });
      if (!k) return null;
      const dep = PLANTS[k].deposit!, home = g.towns.list[0];
      const near = home ? g.terrain.gen.depositsNear(dep.field, home.c.x, home.c.y, 24000)[0] : undefined;
      const where = near && home ? `: the nearest lies ${km(Math.hypot(near.x - home.c.x, near.y - home.c.y))} ${compassWords(home.c, near)} of ${esc(home.name)}` : "";
      return { id: "deposits", cat: "industry", html: `<b>The ${lower(k)} goes on ${dep.name.toLowerCase()}${where}.</b> The <b>Resources</b> view (top left) shows every deposit, and its legend flies you to the nearest.` };
    },
    // plants that draw power and get none
    () => {
      if (!g.placedUnlocked("coalplant") || has("coalplant")) return null;
      const b = plants.find((x) => built(x) && PLANTS[x.kind as PlantKind].power);
      if (!b) return null;
      return { id: "power", cat: "industry", html: `<b>Your ${lower(b.kind as PlantKind)} works at ${Math.round(UNPOWERED * 100)}% without power.</b> Build a <b>Power plant</b> within ${PLANTS.coalplant.reach! / 1000} km of it on the same roads; it burns coal from a coal mine.` };
    },
    // towns' new blocks waiting for construction parts
    () => {
      if (!g.placedUnlocked("constructionplant") || has("constructionplant")) return null;
      const n = new Map<number, number>();
      for (const b of g.buildings.list) if (b.site && b.town !== undefined) n.set(b.town, (n.get(b.town) ?? 0) + 1);
      const best = [...n].sort((a, b) => b[1] - a[1])[0];
      const t = best && g.towns.byId.get(best[0]);
      if (!t) return null;
      return { id: "parts", cat: "industry", html: `<b>${esc(t.name)}'s new blocks wait for construction parts.</b> Build a <b>Construction plant</b> your smelter and cement works reach: it makes parts from steel and cement.` };
    },
    // milk, which spoils on the way
    () => {
      if (!g.placedUnlocked("dairyfarm") || has("dairyfarm")) return null;
      return { id: "milk", cat: "industry", html: `<b>Villages buy fresh milk, and grow faster for it.</b> Place a <b>Dairy farm</b> on fertile soil a short, clear drive from them: milk keeps for a run of about ${Math.round((SHELF.milk! * 12) / 1000)} km, and a jam on the way costs it value.` };
    },
    // farms and mines held at level 2 for want of supplies
    () => {
      if (!g.placedUnlocked("chemworks") || has("chemworks")) return null;
      const b = plants.find((x) => built(x) && PLANTS[x.kind as PlantKind].supplies && x.plant!.level >= 2);
      if (!b) return null;
      return { id: "supplies", cat: "industry", html: `<b>Farms and mines need supplies past level 2.</b> Build a <b>Chemical works</b> your quarry and a coal mine reach: its fertilizer and explosives let your ${lower(b.kind as PlantKind)} and the others grow on.` };
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
