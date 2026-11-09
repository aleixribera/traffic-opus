// The company's power (docs/design.md, "Chains"): power plants burn coal trucked to them and power the company's
// tier 2 buildings, along the roads: a building draws from the plants on its road network within their reach.
// What those plants make is shared among the buildings that draw on them; a building short of power works slower
// (industry.ts, powerPace). Homes and shops don't use the company's power (no city services).

import { dist, dist2, rectDistance } from "../core/math";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { TURBINE_BOOST } from "./convoys";
import { Industry, PLANTS, type PlantKind } from "./industry";
import { levelMult } from "./sites";

export type UtilityId = "power";

export interface UtilityStats {
  /** made by the company's power plants */
  made: number;
  /** wanted by the buildings that draw power */
  used: number;
  /** wanted but not had */
  short: number;
}

const defOf = (b: Building) => (b.plant ? PLANTS[b.kind as PlantKind] : undefined);

export class Utilities {
  /** Building id -> share of the power it needs that it gets (0..1). Missing: needs none, or fully supplied. */
  supply = new Map<number, number>();
  stats: UtilityStats = { made: 0, used: 0, short: 0 };
  /** Power plant id -> what it makes now, and what the buildings it reaches want. */
  plants = new Map<number, { made: number; used: number; users: number }>();
  /** Coal plants (for land value), refreshed each tick. */
  private polluters: Building[] = [];

  constructor(private g: Game) {}

  /** What a power plant makes now: its rating (grown with its level), scaled by its staff, while it has coal to burn. */
  outputOf(b: Building): number {
    const d = defOf(b);
    if (!d?.makes || !Industry.running(b) || !b.access) return 0;
    // (a landmark's dam burns nothing; turbines brought by convoy add to a plant's output for good: convoys.ts)
    if (!d.mega && (b.plant!.stock.coal ?? 0) < 1) return 0;
    const staff = b.cap ? this.g.people.workersAt(b.id) / b.cap : 1;
    if (staff <= 0) return 0;
    const turbines = 1 + (b.plant!.turbines ?? 0) * TURBINE_BOOST;
    return d.makes * levelMult(b.plant!.level ?? 1) * turbines * Math.max(0.25, Math.min(1, staff * 1.25));
  }

  /** Power a building draws at full work, grown with its level (0: it needs none). Building sites draw nothing. */
  demandOf(b: Building): number {
    const d = defOf(b);
    return d?.power && Industry.running(b) && b.access ? d.power * levelMult(b.plant!.level ?? 1) : 0;
  }

  /** Is building b within reach of power plant p, on the same roads? */
  reaches(p: Building, b: Building): boolean {
    const d = defOf(p);
    if (!d?.makes || !p.access || !b.access) return false;
    return dist(p.c, b.c) <= d.reach! && this.g.connected(p.access.seg, b.access.seg);
  }

  /**
   * Every 1/8 game hour: each power plant shares what it makes among the buildings within its reach, in proportion
   * to what they draw; a building in reach of two plants gets its share from both. A plant far off on the same roads
   * gives nothing: power reaches only as far as the plant's reach.
   */
  tick(_span: number) {
    const g = this.g;
    const plants = g.buildings.list.filter((b) => defOf(b)?.makes && b.access);
    const users = g.buildings.list.filter((b) => this.demandOf(b) > 0);
    this.plants.clear();
    for (const p of plants) this.plants.set(p.id, { made: this.outputOf(p), used: 0, users: 0 });
    const near = new Map<number, Building[]>();
    for (const b of users) {
      const ps = plants.filter((p) => this.reaches(p, b));
      near.set(b.id, ps);
      for (const p of ps) { const e = this.plants.get(p.id)!; e.used += this.demandOf(b); e.users++; }
    }
    this.supply.clear();
    const st: UtilityStats = { made: 0, used: 0, short: 0 };
    for (const e of this.plants.values()) st.made += e.made;
    for (const b of users) {
      const want = this.demandOf(b);
      let share = 0;
      for (const p of near.get(b.id)!) { const e = this.plants.get(p.id)!; share += e.made / e.used; }
      share = Math.min(1, share);
      this.supply.set(b.id, share);
      st.used += want;
      st.short += want * (1 - share);
    }
    this.stats = st;
    this.polluters = g.buildings.list.filter((b) => b.kind === "coalplant" && !b.plant?.site);
  }

  /** Share of the power a building needs that it gets (1 when it needs none). */
  supplyOf(b: Building): number {
    return this.supply.get(b.id) ?? 1;
  }

  /** Buildings within a power plant's reach want its power (it burns coal only then). */
  wanted(p: Building): boolean {
    return (this.plants.get(p.id)?.users ?? 0) > 0;
  }

  /** Buildings that need power and get all of it. */
  get powered(): number {
    let n = 0;
    for (const b of this.g.buildings.list) if (this.demandOf(b) > 0 && this.supplyOf(b) >= 0.999) n++;
    return n;
  }

  /** Land value lost to smoke from a power plant nearby. */
  landValueOf(b: Building): number {
    let lv = 0;
    for (const o of this.polluters) {
      const R = 220 + o.hw + o.hd; // (beyond its reach from anywhere on the site: no need to measure)
      if (dist2(b.c, o.c) >= R * R) continue;
      // (from the plant's fence: its site is a couple of hundred metres across)
      const d = rectDistance(b.c, o.c, o.hw, o.hd, o.rot);
      if (d < 220) lv -= 26 * (1 - d / 220);
    }
    return lv;
  }
}
