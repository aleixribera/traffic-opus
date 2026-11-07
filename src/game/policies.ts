// City policies, the CS2 way: city-wide rules the player switches on for a running cost that grows with the town.
// Each trades money (and sometimes a little happiness) for less garbage, crime or fire, lower utility use, busier
// buses, cleaner industry or more visitors. Milestones unlock them over the game.

import type { Game } from "./city";

export type PolicyId = "recycling" | "watch" | "smoke" | "watersave" | "freebus" | "energysave" | "filters" | "tourism";

export interface PolicyDef {
  id: PolicyId;
  name: string;
  /** what it does, for its card */
  blurb: string;
  /** milestone index that unlocks it */
  unlock: number;
  /** cost an hour: a fixed part, and so much per 1000 residents */
  base: number;
  perK: number;
}

export const POLICIES: Record<PolicyId, PolicyDef> = {
  recycling: { id: "recycling", name: "Recycling", blurb: "Households sort their waste: 35% less garbage for the trucks.", unlock: 2, base: 20, perK: 30 },
  watch: { id: "watch", name: "Neighbourhood watch", blurb: "Residents keep an eye out: crime builds up 30% slower.", unlock: 3, base: 15, perK: 25 },
  smoke: { id: "smoke", name: "Smoke detectors", blurb: "Free detectors for every building: half as many fires.", unlock: 3, base: 10, perK: 20 },
  watersave: { id: "watersave", name: "Water saving", blurb: "Low-flow taps and shorter showers: 20% less water and sewage. Residents grumble a little.", unlock: 4, base: 10, perK: 15 },
  freebus: { id: "freebus", name: "Free buses", blurb: "No fares: more people leave the car at home. You lose the fare money.", unlock: 4, base: 0, perK: 0 },
  energysave: { id: "energysave", name: "Energy saving", blurb: "LED street lights and insulation grants: 15% less electricity.", unlock: 5, base: 40, perK: 35 },
  filters: { id: "filters", name: "Industrial filters", blurb: "Factories fit filters: their smoke and noise lower land value half as much.", unlock: 6, base: 60, perK: 40 },
  tourism: { id: "tourism", name: "Tourism campaign", blurb: "Advertise the city: more visitors for its shops.", unlock: 7, base: 250, perK: 20 },
};

export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];

/** What a policy changes, read by the systems it touches. */
export const EFFECT = {
  garbage: 0.65,
  crime: 0.7,
  fire: 0.5,
  water: 0.8,
  power: 0.85,
  /** residents' happiness lost to water saving */
  waterMood: 0.02,
  /** chance of taking a suitable bus, times */
  freeBus: 1.35,
  /** industry's land-value penalty on homes, times */
  filters: 0.5,
  /** commercial demand */
  tourism: 15,
} as const;

export class Policies {
  on = new Set<PolicyId>();

  constructor(private g: Game) {}

  has(id: PolicyId): boolean {
    return this.on.has(id);
  }

  unlocked(id: PolicyId): boolean {
    return this.g.milestone >= POLICIES[id].unlock;
  }

  /** Switch a policy on or off; false if it isn't unlocked yet. */
  set(id: PolicyId, on: boolean): boolean {
    if (on && !this.unlocked(id)) return false;
    if (on) this.on.add(id);
    else this.on.delete(id);
    return true;
  }

  /** What one policy costs an hour at the current population. */
  costOf(id: PolicyId): number {
    const d = POLICIES[id];
    return Math.round(d.base + (d.perK * this.g.people.stats.population) / 1000);
  }

  /** The hour's bill for every policy in force. */
  hourly(): number {
    let c = 0;
    for (const id of this.on) c += this.costOf(id);
    return c;
  }

  toJSON(): PolicyId[] {
    return [...this.on];
  }

  load(ids: PolicyId[] | undefined) {
    this.on = new Set((ids ?? []).filter((id) => id in POLICIES));
  }
}
