// Industrial parks (docs/design.md, "Industrial parks"): two of the company's plants built fence to fence, where
// one makes what the other uses, are linked by a conveyor (or a pipe, for crude and fuel) without the player doing
// anything. Loads cross the link straight from one yard to the other, up to its capacity; the trucks carry the rest
// as before. Nothing to build or set: put the plants close and the link appears; pull one down and it goes.
//
// It is a trade-off, not a free win:
//   - a link carries only a few loads an hour (LINK_CAP), so a busy chain still needs its trucks and roads;
//   - it costs upkeep every hour, like a small building (LINK_UPKEEP);
//   - plants packed together pollute together: each linked plant's smoke reaches PARK_SMOKE further into the towns'
//     land value (Game.landValue), and the park's other freight funnels through gates a stone's throw apart.
// The links are worked out again from where the plants stand (refresh), so they need no saving; only the loads
// they moved this hour are lost on a load, which the panels show again within the hour.

import { dist, pointSegDist2, rectCorners, sub, add, scale, norm, type V2 } from "../core/math";
import { BUILDING_TYPES } from "../config";
import type { Building } from "./buildings";
import { Industry, PLANTS, PRODUCTS, type PlantKind, type Product } from "./industry";

const HOUR = 40;

/** Most fence-to-fence distance (m) at which two plants are linked. */
export const LINK_REACH = 60;
/** Loads an hour a link carries at most. */
export const LINK_CAP = 3;
/** Upkeep of a link, per game hour. */
export const LINK_UPKEEP = 60;
/** How much further a linked plant's pollution reaches into the towns' land value. */
export const PARK_SMOKE = 1.3;
/** How far inside each fence a link's ends stand (m): at the yards, not on the fence. */
const INSET = 14;

/** Products that go by pipe rather than by belt. */
const PIPED = new Set<Product>(["crude", "fuel"]);

export interface ParkLink {
  /** from the plant that makes it to the plant that uses it */
  from: number;
  to: number;
  product: Product;
  pipe: boolean;
  /** loads it may move now (refills at LINK_CAP an hour; an idle link banks no more than one) */
  budget: number;
  /** loads moved this hour and over the last full hour */
  now: number;
  last: number;
  /** its two ends, world space (for the renderer) */
  a: V2;
  b: V2;
  /**
   * The plant at one end with no road to its gate, while there is one: the link stands still (review 2026-11-10: a
   * belt to a works with no road looked busy while nothing moved; that works can't run, so its belt doesn't either)
   */
  stopped?: number;
}

/** A link a plant would make if it stood here (the placement ghost shows them): the other plant, what, which way. */
export interface LinkPreview { other: Building; product: Product; out: boolean; a: V2; b: V2 }

/**
 * The links a plant of this kind would make standing at c (turned rot): to every running plant of the company's
 * fence to fence with it that makes what it uses or uses what it makes.
 */
export function wouldLink(kind: PlantKind, c: V2, rot: number, plants: readonly Building[]): LinkPreview[] {
  const d = PLANTS[kind];
  if (!d || d.mega || d.logistics) return [];
  const T = BUILDING_TYPES[kind], me = { c, rot, hw: T.w / 2, hd: T.d / 2 } as Building;
  const out: LinkPreview[] = [];
  for (const o of plants) {
    if (!parkable(o)) continue;
    if (dist(c, o.c) > Math.hypot(me.hw, me.hd) + Math.hypot(o.hw, o.hd) + LINK_REACH) continue;
    const od = PLANTS[o.kind as PlantKind];
    const give = (Object.keys(d.outputs) as Product[]).filter((p) => od.inputs[p]);
    const take = (Object.keys(od.outputs) as Product[]).filter((p) => d.inputs[p]);
    if (!give.length && !take.length) continue;
    const g = fenceGap(me, o);
    if (g.d > LINK_REACH) continue;
    for (const product of give) out.push({ other: o, product, out: true, a: g.pa, b: g.pb });
    for (const product of take) out.push({ other: o, product, out: false, a: g.pa, b: g.pb });
  }
  return out;
}

export interface ParkHost {
  readonly buildings: { list: Building[]; byId: Map<number, Building> };
  /** charge the links' upkeep */
  pay?(amount: number): void;
}

const key = (l: { from: number; to: number; product: Product }) => `${l.from}>${l.to}:${l.product}`;

/** Can this building take part in a park (a running plant that makes or uses something, not a landmark or store)? */
function parkable(b: Building): boolean {
  const d = PLANTS[b.kind as PlantKind];
  return !!d && !d.mega && !d.logistics && Industry.running(b);
}

/** The nearest points of two buildings' fences, and how far apart they are (0 when they touch). */
export function fenceGap(a: Building, b: Building): { d: number; pa: V2; pb: V2 } {
  const A = rectCorners(a.c, a.hw, a.hd, a.rot), B = rectCorners(b.c, b.hw, b.hd, b.rot);
  let best = { d: Infinity, pa: a.c, pb: b.c };
  const edges = (P: V2[], Q: V2[], flip: boolean) => {
    for (const p of P) for (let i = 0; i < 4; i++) {
      const q0 = Q[i], q1 = Q[(i + 1) % 4];
      const { d2, t } = pointSegDist2(p, q0, q1);
      const d = Math.sqrt(d2);
      if (d < best.d) {
        const q = add(q0, scale(sub(q1, q0), t));
        best = flip ? { d, pa: q, pb: p } : { d, pa: p, pb: q };
      }
    }
  };
  edges(A, B, false);
  edges(B, A, true);
  return best;
}

export class Parks {
  links: ParkLink[] = [];
  /** the plants with a link, and how many (for the pollution and the panels) */
  private linked = new Map<number, number>();
  private sig = "";

  constructor(private h: ParkHost) {}

  /** Work the links out again from where the plants stand (cheap; done every tick, rebuilt only on a change). */
  refresh() {
    const plants = this.h.buildings.list.filter(parkable);
    const sig = plants.map((b) => b.id).join(",");
    if (sig === this.sig) return;
    this.sig = sig;
    const old = new Map(this.links.map((l) => [key(l), l]));
    this.links = [];
    this.linked.clear();
    for (let i = 0; i < plants.length; i++) for (let j = 0; j < plants.length; j++) {
      if (i === j) continue;
      const A = plants[i], B = plants[j];
      // (only plants near enough to touch: skip the fence test for any whose middles are far apart)
      if (dist(A.c, B.c) > Math.hypot(A.hw, A.hd) + Math.hypot(B.hw, B.hd) + LINK_REACH) continue;
      const da = PLANTS[A.kind as PlantKind], db = PLANTS[B.kind as PlantKind];
      const products = (Object.keys(da.outputs) as Product[]).filter((p) => db.inputs[p]);
      if (!products.length) continue;
      const g = fenceGap(A, B);
      if (g.d > LINK_REACH) continue;
      for (const product of products) {
        const k = `${A.id}>${B.id}:${product}`;
        const was = old.get(k);
        // the ends stand a little inside each fence, on the line between the nearest points (pushed toward the middles)
        const inA = norm(sub(A.c, g.pa)), inB = norm(sub(B.c, g.pb));
        const a = add(g.pa, scale(inA, Math.min(INSET, Math.min(A.hw, A.hd) * 0.5)));
        const b = add(g.pb, scale(inB, Math.min(INSET, Math.min(B.hw, B.hd) * 0.5)));
        this.links.push({ from: A.id, to: B.id, product, pipe: PIPED.has(product), budget: was?.budget ?? 0, now: was?.now ?? 0, last: was?.last ?? 0, a, b });
        this.linked.set(A.id, (this.linked.get(A.id) ?? 0) + 1);
        this.linked.set(B.id, (this.linked.get(B.id) ?? 0) + 1);
      }
    }
  }

  /** Force the links to be worked out again on the next tick (a plant moved, or a game loaded). */
  invalidate() { this.sig = ""; }

  /**
   * Move loads across each link: from the maker's yard into the user's store, while the user has room, up to the
   * link's capacity. Runs before the trucks are sent, so they carry only what the links can't.
   */
  tick(span: number) {
    this.refresh();
    const by = this.h.buildings.byId;
    for (const l of this.links) {
      l.budget += (LINK_CAP * span) / HOUR;
      const A = by.get(l.from), B = by.get(l.to);
      if (!A?.plant || !B?.plant) continue;
      // (a plant with no road can't run: the belt to or from it waits with it, and banks nothing meanwhile)
      l.stopped = !A.access ? A.id : !B.access ? B.id : undefined;
      if (l.stopped !== undefined) { l.budget = 0; continue; }
      while (l.budget >= 1) {
        const have = A.plant.out[l.product] ?? 0;
        const room = Industry.storeOf(B) - (B.plant.stock[l.product] ?? 0);
        if (have < 1 || room < 1) break;
        A.plant.out[l.product] = have - 1;
        B.plant.stock[l.product] = (B.plant.stock[l.product] ?? 0) + 1;
        A.plant.now.sent += 1;
        l.budget -= 1;
        l.now += 1;
      }
      // (an idle link banks no more than one load: capacity unused is lost, not saved up for a burst)
      l.budget = Math.min(l.budget, 1);
    }
  }

  /** Every game hour: roll the links' counts over and charge their upkeep. */
  hourly() {
    for (const l of this.links) { l.last = l.now; l.now = 0; }
    if (this.links.length) this.h.pay?.(this.links.length * LINK_UPKEEP);
  }

  /** Is this plant linked to another (its pollution reaches further)? */
  isLinked(id: number): boolean {
    return (this.linked.get(id) ?? 0) > 0;
  }

  /** A plant's links, for its panel: "Conveyor to Smelter: 2 loads/h". */
  linesFor(id: number): { text: string; out: boolean; stopped?: number }[] {
    const out: { text: string; out: boolean; stopped?: number }[] = [];
    const by = this.h.buildings.byId;
    for (const l of this.links) {
      if (l.from !== id && l.to !== id) continue;
      const mine = l.from === id;
      const other = by.get(mine ? l.to : l.from);
      if (!other) continue;
      const what = l.pipe ? "Pipe" : "Conveyor";
      const name = BUILDING_TYPES[other.kind].name;
      const rate = Math.max(l.last, l.now);
      const lost = l.stopped !== undefined ? by.get(l.stopped) : undefined;
      if (lost) {
        const who = lost.id === id ? "this works" : `the ${name}`;
        out.push({ text: `${what} ${mine ? "to" : "from"} ${name}: stopped. ${who[0].toUpperCase()}${who.slice(1)} has no road to its gate; join it to a road and the ${l.pipe ? "pipe" : "belt"} runs`, out: mine, stopped: lost.id });
        continue;
      }
      out.push({ text: `${what} ${mine ? "to" : "from"} ${name}: ${rate} of ${LINK_CAP} loads/h of ${PRODUCTS[l.product].name.toLowerCase()}`, out: mine });
    }
    return out;
  }
}
