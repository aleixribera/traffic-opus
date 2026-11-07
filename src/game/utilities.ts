// Electricity, the CS2 way. Cables run with the roads, so every building on a road that reaches a power plant can
// draw from it. What the plants on a connected road network make is shared by every building on it. There is no
// outside grid to buy from or sell to. Shortage doesn't hurt homes or shops (the company's plants will need power).

import { dist } from "../core/math";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP } from "./growables";
import { PLACED, type UtilityId } from "./placed";

export const UTILITIES: UtilityId[] = ["power"];

/** What one resident or worker uses an hour (MW). */
export const PER_PERSON: Record<UtilityId, number> = { power: 0.006 };
export const UNIT: Record<UtilityId, string> = { power: "MW" };
export const UTILITY_NAME: Record<UtilityId, string> = { power: "Electricity" };

export interface UtilityStats {
  /** made by the town's own plants */
  made: number;
  /** used by its buildings */
  used: number;
  /** wanted but not had */
  short: number;
}

const empty = (): UtilityStats => ({ made: 0, used: 0, short: 0 });

export type Supply = Record<UtilityId, number>;
const FULL: Supply = { power: 1 };

const defOf = (b: Building) => (b.placed ? PLACED[b.kind as keyof typeof PLACED] : undefined);

export class Utilities {
  /** Building id -> share of what it needs that it gets (0..1). Missing: fully supplied. */
  supply = new Map<number, Supply>();
  stats: Record<UtilityId, UtilityStats> = { power: empty() };
  /** Road component -> what the plants on it make and its buildings use (for a plant's inspector). */
  nets = new Map<number, { made: Supply; used: Supply }>();
  /** Coal plants (for land value), refreshed each tick. */
  private polluters: Building[] = [];

  constructor(private g: Game) {}

  /** What a plant makes now: its rated output, scaled by its staff (a skeleton crew keeps a quarter going). */
  outputOf(b: Building): number {
    const d = defOf(b);
    if (!d?.out || b.built < 1 || b.abandoned || !b.access) return 0;
    const staff = b.cap ? this.g.people.workersAt(b.id) / b.cap : 1;
    return d.out * Math.max(0.25, Math.min(1, staff * 1.25));
  }

  /** People a building serves (its residents, or its workers). */
  private peopleIn(b: Building): number {
    if (b.placed) return defOf(b)?.out ? 0 : this.g.people.workersAt(b.id);
    if (!b.zone || b.built < 1 || b.abandoned) return 0;
    if (ZONE_GROUP[b.zone] === "res") {
      let n = 0;
      for (const hh of this.g.people.hhAt.get(b.id) ?? []) n += hh.members.length;
      return n;
    }
    return this.g.people.workersAt(b.id);
  }

  /** Every 1/8 game hour: share out what each road network makes. */
  tick(_span: number) {
    const g = this.g;
    type Net = { made: Supply; used: Supply; users: Building[] };
    const nets = new Map<number, Net>();
    const netOf = (b: Building): Net | null => {
      if (!b.access) return null;
      const c = g.compOf(b.access.seg);
      if (c === null) return null;
      let n = nets.get(c);
      if (!n) nets.set(c, (n = { made: { power: 0 }, used: { power: 0 }, users: [] }));
      return n;
    };
    for (const b of g.buildings.list) {
      const n = netOf(b);
      if (!n) continue;
      const d = defOf(b);
      if (d?.out && d.utility) {
        n.made[d.utility] += this.outputOf(b);
        continue;
      }
      const p = this.peopleIn(b);
      if (p <= 0) continue;
      for (const u of UTILITIES) n.used[u] += p * PER_PERSON[u];
      n.users.push(b);
    }
    const st: Record<UtilityId, UtilityStats> = { power: empty() };
    this.supply.clear();
    for (const n of nets.values()) {
      const s: Supply = { ...FULL };
      for (const u of UTILITIES) {
        const made = n.made[u], used = n.used[u];
        st[u].made += made;
        st[u].used += used;
        if (used <= made) continue;
        s[u] = used > 0 ? Math.min(1, made / used) : 1;
        st[u].short += used - made;
      }
      if (s.power < 1) for (const b of n.users) this.supply.set(b.id, s);
    }
    this.stats = st;
    this.polluters = g.buildings.list.filter((b) => b.placed && b.kind === "coalplant");
    this.nets = new Map([...nets].map(([c, n]) => [c, { made: n.made, used: n.used }]));
  }

  /** What the plants on a building's road network make and its buildings use. */
  netOf(b: Building): { made: Supply; used: Supply } | null {
    const c = b.access ? this.g.compOf(b.access.seg) : null;
    return c === null ? null : this.nets.get(c) ?? null;
  }

  supplyOf(b: Building): Supply {
    return this.supply.get(b.id) ?? FULL;
  }

  /** The plants' upkeep this hour (for the budget). */
  upkeep(): number {
    let upkeep = 0;
    for (const b of this.g.buildings.list) {
      const d = defOf(b);
      if (d?.out) upkeep += d.upkeep;
    }
    return upkeep;
  }

  /** A plant's own trouble (the inspector). */
  plantProblem(b: Building): string | null {
    if (!b.access) return "No road access";
    if (!this.servesAnyone(b)) return "Not connected to anything";
    if (b.cap && this.g.people.workersAt(b.id) < b.cap * 0.5) return this.g.people.workersAt(b.id) > 0 ? "Short of staff" : "No staff yet";
    return null;
  }

  private servesAnyone(b: Building): boolean {
    const c = b.access ? this.g.compOf(b.access.seg) : null;
    if (c === null) return false;
    for (const o of this.g.buildings.list) if (o !== b && !o.placed && o.access && this.g.compOf(o.access.seg) === c) return true;
    return false;
  }

  /** Land value lost to smoke from a coal plant nearby. */
  landValueOf(b: Building): number {
    let lv = 0;
    for (const o of this.polluters) {
      const d = dist(o.c, b.c);
      if (d < 320) lv -= 26 * (1 - d / 320);
    }
    return lv;
  }
}
