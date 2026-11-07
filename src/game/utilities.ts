// Electricity, water and sewage, the CS2 way. Cables and pipes run with the roads, so every building on a road
// that reaches a plant can draw from it. What the plants on a connected road network make is shared by every
// building on it; a town joined to the highway buys what it lacks from outside (at a premium, and only up to a
// point) and sells what it has spare. Short supply makes homes unhappy and slows businesses down.

import { dist } from "../core/math";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP } from "./growables";
import { EFFECT } from "./policies";
import { HOUR } from "./society";
import { SERVICES, type UtilityId } from "./services";

export const UTILITIES: UtilityId[] = ["power", "water", "sewage"];

/** What one resident or worker uses an hour (MW, m³). */
export const PER_PERSON: Record<UtilityId, number> = { power: 0.006, water: 0.4, sewage: 0.36 };
/** Bought in from outside, per unit an hour. */
export const IMPORT_PRICE: Record<UtilityId, number> = { power: 16, water: 0.24, sewage: 0.22 };
/** Sold to the outside, per unit an hour. */
export const EXPORT_PRICE: Record<UtilityId, number> = { power: 4, water: 0.03, sewage: 0 };
/** The most the outside will sell the town each hour (enough for a village, not a town). */
export const IMPORT_CAP: Record<UtilityId, number> = { power: 8, water: 500, sewage: 500 };
export const UNIT: Record<UtilityId, string> = { power: "MW", water: "m³", sewage: "m³" };
export const UTILITY_NAME: Record<UtilityId, string> = { power: "Electricity", water: "Water", sewage: "Sewage" };

/** How close to water (m from the lot's edge) a shore building has to be. */
export const SHORE_REACH = 24;

export interface UtilityStats {
  /** made by the town's own plants */
  made: number;
  /** used by its buildings */
  used: number;
  imported: number;
  exported: number;
  /** wanted but not had */
  short: number;
}

const empty = (): UtilityStats => ({ made: 0, used: 0, imported: 0, exported: 0, short: 0 });

export type Supply = Record<UtilityId, number>;
const FULL: Supply = { power: 1, water: 1, sewage: 1 };

export class Utilities {
  /** Building id -> share of what it needs that it gets (0..1). Missing: fully supplied. */
  supply = new Map<number, Supply>();
  stats: Record<UtilityId, UtilityStats> = { power: empty(), water: empty(), sewage: empty() };
  /** Road component -> what the plants on it make and its buildings use (for a plant's inspector). */
  nets = new Map<number, { made: Supply; used: Supply }>();
  /** Coal plants and sewage outlets (for land value), refreshed each tick. */
  private polluters: Building[] = [];
  /** Demand met on the highway-linked networks (what the outside's cap and the town's plants decide). */
  private linked: Record<UtilityId, { used: number; short: number }> = { power: { used: 0, short: 0 }, water: { used: 0, short: 0 }, sewage: { used: 0, short: 0 } };
  /** money spent on imports / earned from exports so far this hour */
  private importCost = 0;
  private exportIncome = 0;

  constructor(private g: Game) {}

  /** Whether short supply hurts yet (a brand-new town gets going first, like the other services). */
  get active() { return this.g.milestone >= 1; }

  /** What a plant makes now: its rated output, scaled by its staff (a skeleton crew keeps a quarter going). */
  outputOf(b: Building): number {
    const d = SERVICES[b.kind as keyof typeof SERVICES];
    if (!d?.out || !b.svc || b.built < 1 || b.abandoned || !b.access) return 0;
    const staff = b.cap ? this.g.people.workersAt(b.id) / b.cap : 1;
    return d.out * Math.max(0.25, Math.min(1, staff * 1.25));
  }

  /** People a building serves (its residents, or its workers). */
  private peopleIn(b: Building): number {
    if (b.svc) return b.svc && SERVICES[b.kind as keyof typeof SERVICES]?.out ? 0 : this.g.people.workersAt(b.id);
    if (!b.zone || b.built < 1 || b.abandoned) return 0;
    if (ZONE_GROUP[b.zone] === "res") {
      let n = 0;
      for (const hh of this.g.people.hhAt.get(b.id) ?? []) n += hh.members.length;
      return n;
    }
    return this.g.people.workersAt(b.id);
  }

  /** Every 1/8 game hour: share out what each road network makes. */
  tick(span: number) {
    const g = this.g;
    const h = span / HOUR;
    type Net = { made: Supply; used: Supply; users: Building[]; outside: boolean };
    const nets = new Map<number, Net>();
    // policies that cut what people use
    const water = g.policies.has("watersave") ? EFFECT.water : 1;
    const use: Supply = { power: g.policies.has("energysave") ? EFFECT.power : 1, water, sewage: water };
    const netOf = (b: Building): Net | null => {
      if (!b.access) return null;
      const c = g.compOf(b.access.seg);
      if (c === null) return null;
      let n = nets.get(c);
      if (!n) nets.set(c, (n = { made: { power: 0, water: 0, sewage: 0 }, used: { power: 0, water: 0, sewage: 0 }, users: [], outside: !!g.entryFor(b.access.seg) }));
      return n;
    };
    for (const b of g.buildings.list) {
      const n = netOf(b);
      if (!n) continue;
      const d = b.svc ? SERVICES[b.kind as keyof typeof SERVICES] : undefined;
      if (d?.out) {
        const u = d.svc as UtilityId;
        n.made[u] += this.outputOf(b);
        continue;
      }
      const p = this.peopleIn(b);
      if (p <= 0) continue;
      for (const u of UTILITIES) n.used[u] += p * PER_PERSON[u] * use[u];
      n.users.push(b);
    }
    const st: Record<UtilityId, UtilityStats> = { power: empty(), water: empty(), sewage: empty() };
    const linked: Record<UtilityId, { used: number; short: number }> = { power: { used: 0, short: 0 }, water: { used: 0, short: 0 }, sewage: { used: 0, short: 0 } };
    // what the outside-linked networks lack, together (the import cap is for the whole town)
    const lack: Supply = { power: 0, water: 0, sewage: 0 };
    for (const n of nets.values()) if (n.outside) for (const u of UTILITIES) lack[u] += Math.max(0, n.used[u] - n.made[u]);
    const share: Supply = { power: 1, water: 1, sewage: 1 };
    for (const u of UTILITIES) share[u] = lack[u] > 0 ? Math.min(1, IMPORT_CAP[u] / lack[u]) : 1;
    this.supply.clear();
    for (const n of nets.values()) {
      const s: Supply = { ...FULL };
      for (const u of UTILITIES) {
        const made = n.made[u], used = n.used[u];
        st[u].made += made;
        st[u].used += used;
        if (n.outside) linked[u].used += used;
        if (used <= made) {
          if (n.outside) st[u].exported += made - used;
          continue;
        }
        const imp = n.outside ? (used - made) * share[u] : 0;
        st[u].imported += imp;
        s[u] = used > 0 ? Math.min(1, (made + imp) / used) : 1;
        st[u].short += used - made - imp;
        if (n.outside) linked[u].short += used - made - imp;
      }
      if (s.power < 1 || s.water < 1 || s.sewage < 1) for (const b of n.users) this.supply.set(b.id, s);
    }
    this.stats = st;
    this.linked = linked;
    this.polluters = g.buildings.list.filter((b) => b.svc && (b.kind === "coalplant" || b.kind === "sewageoutlet"));
    this.nets = new Map([...nets].map(([c, n]) => [c, { made: n.made, used: n.used }]));
    // a brand-new town gets what it needs from outside for free until it is a Hamlet
    for (const u of UTILITIES) {
      if (this.active) this.importCost += st[u].imported * IMPORT_PRICE[u] * h;
      this.exportIncome += st[u].exported * EXPORT_PRICE[u] * h;
    }
  }

  /** What the plants on a building's road network make and its buildings use. */
  netOf(b: Building): { made: Supply; used: Supply } | null {
    const c = b.access ? this.g.compOf(b.access.seg) : null;
    return c === null ? null : this.nets.get(c) ?? null;
  }

  supplyOf(b: Building): Supply {
    return this.supply.get(b.id) ?? FULL;
  }

  /** The hour's import bill, export earnings and the plants' upkeep (for the budget). */
  hourly(): { imports: number; exports: number; upkeep: number } {
    let upkeep = 0;
    for (const b of this.g.buildings.list) {
      const d = b.svc ? SERVICES[b.kind as keyof typeof SERVICES] : undefined;
      if (d?.out) upkeep += d.upkeep;
    }
    const out = { imports: this.importCost, exports: this.exportIncome, upkeep };
    this.importCost = 0;
    this.exportIncome = 0;
    return out;
  }

  /** Residents' unhappiness from short supply (0 = none): no power is worst, then water, then sewage. */
  unhappiness(b: Building): number {
    const s = this.supplyOf(b);
    return (1 - s.power) * 0.4 + (1 - s.water) * 0.34 + (1 - s.sewage) * 0.22;
  }

  /** How much a business can work with what it gets (1 = fully). */
  workFactor(b: Building): number {
    const s = this.supplyOf(b);
    return (0.35 + 0.65 * Math.min(s.power, s.water)) * (0.85 + 0.15 * s.sewage);
  }

  /** The worst shortage at a building, for its icon and the inspector. */
  problemOf(b: Building): string | null {
    const s = this.supplyOf(b);
    if (s.power < 0.5) return "No electricity";
    if (s.water < 0.5) return "No water";
    if (s.sewage < 0.5) return "Sewage backing up";
    if (s.power < 0.95) return "Not enough electricity";
    if (s.water < 0.95) return "Not enough water";
    if (s.sewage < 0.95) return "Not enough sewage capacity";
    return null;
  }

  /** A plant's own trouble (the inspector). */
  plantProblem(b: Building): string | null {
    if (!b.access) return "No road access";
    if (!this.g.entryFor(b.access.seg) && !this.servesAnyone(b)) return "Not connected to anything";
    if (b.cap && this.g.people.workersAt(b.id) < b.cap * 0.5) return this.g.people.workersAt(b.id) > 0 ? "Short of staff" : "No staff yet";
    return null;
  }

  private servesAnyone(b: Building): boolean {
    const c = b.access ? this.g.compOf(b.access.seg) : null;
    if (c === null) return false;
    for (const o of this.g.buildings.list) if (o !== b && !o.svc && o.access && this.g.compOf(o.access.seg) === c) return true;
    return false;
  }

  /** Land value lost to smoke and smell from a coal plant or a sewage outlet nearby. */
  landValueOf(b: Building): number {
    let lv = 0;
    for (const o of this.polluters) {
      const r = o.kind === "coalplant" ? 320 : o.kind === "sewageoutlet" ? 140 : 0;
      if (!r) continue;
      const d = dist(o.c, b.c);
      if (d < r) lv -= (o.kind === "coalplant" ? 26 : 14) * (1 - d / r);
    }
    return lv;
  }

  /** Share of demand met (0..1) on the highway-linked roads, worst of the three: what the town's plants and the
   * outside's cap decide. (A cut-off neighbourhood shows its own icons; it isn't the town's supply.) */
  get worstShare(): { u: UtilityId; share: number } {
    let worst: { u: UtilityId; share: number } = { u: "power", share: 1 };
    for (const u of UTILITIES) {
      const s = this.linked[u];
      const share = s.used > 0 ? 1 - s.short / s.used : 1;
      if (share < worst.share) worst = { u, share };
    }
    return worst;
  }
}
