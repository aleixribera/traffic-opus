// The wait under a goal, made legible (owner, 2026-11-10: "the first ten game hours are quiet"). A goal that stands
// at nothing while the works that will meet it go up or start up says what the chain is doing now and when its
// first truck leaves: the very words of that works' own panel (inspect.ts worksStatus), so the goal line and the
// panel are one voice and count down together. Pure over the game, so tests can read every stage.

import { BUILDING_TYPES } from "../config";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { PLANTS, PRODUCTS, type PlantKind, type Product } from "../game/industry";
import type { Milestone } from "../game/progression";
import type { V2 } from "../core/math";
import { compassWords } from "../game/settlements";
import { makerKind } from "./bottleneck";
import { farmSpot } from "./goalPointer";
import { worksStatus } from "./inspect";

/** The goals that wait on a first load, and the product each waits for (sold to a town, or just made). */
export const FIRST_LOAD: Record<string, { p: Product; sold: boolean }> = {
  food10: { p: "food", sold: true },
  planks10: { p: "planks", sold: false },
  steel: { p: "steel", sold: false },
};

export interface GoalNow {
  /** what it is about: "Your Farm", or nothing for a load on the road */
  who?: string;
  /** its state, the works' own status line: "Starting up" */
  text: string;
  /** and what comes next, the works' own advice: "Its first load of crops is ready in about 2 hours. ..." */
  fix?: string;
  tone: "good" | "bad" | "";
  /** the works to show */
  works?: number;
  /** or the place on the map to fly to (the soil for the first farm) */
  spot?: V2;
  /** the word before it when it is not about now: "Where" */
  key?: string;
}

const far = (m: number) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);

/** The works of a kind furthest along: open before going up before a bare site, the most built first. */
function furthest(g: Game, k: PlantKind): Building | undefined {
  const rank = (b: Building) => (b.plant!.site ? 0 : b.built < 1 ? 1 + b.built : 3);
  return g.industry.plants().filter((b) => b.kind === k).sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * What the chain toward a goal is doing now, or null: the goal is not one that waits on a first load, it has its
 * first load already, or nothing of the chain is placed yet (then the tip under the goals says what to build; the
 * first goal says where the soil for its farm lies).
 */
export function goalNow(g: Game, m: Milestone, have: number): GoalNow | null {
  const f = FIRST_LOAD[m.id];
  if (!f || have > 0) return null;
  const name = PRODUCTS[f.p].name.toLowerCase();
  // a load of it on the road to a town: the last stage
  if (f.sold) for (const tr of g.trips()) {
    const h = tr.haul;
    if (!h || h.done || h.leg !== "out" || h.product !== f.p) continue;
    const t = g.towns.byId.get(g.buildings.byId.get(h.dest)?.town ?? -1);
    if (t) return { text: `The first ${name} is on the road to ${t.name}`, tone: "good", works: h.plant };
  }
  // the works that makes it, or failing that the works that feeds that one (a farm with no food plant yet)
  let k = makerKind(f.p);
  for (let step = 0; k && step < 3; step++) {
    const b = furthest(g, k);
    if (b) {
      const P = b.plant!, who = `Your ${BUILDING_TYPES[b.kind].name}`;
      // (made and waiting at the dock: its truck sets off with a full load, or within the hour)
      if (f.sold && !P.site && b.built >= 1 && (P.out[f.p] ?? 0) >= 1) return { who, text: `Its first ${name} is at the dock`, fix: "Its truck sets off within the hour.", tone: "good", works: b.id };
      const st = worksStatus(g, b);
      return { who, text: st.text, fix: st.fix, tone: st.tone, works: b.id };
    }
    const q: Product | undefined = (Object.keys(PLANTS[k].inputs) as Product[])[0];
    k = q ? makerKind(q) : undefined;
  }
  // nothing of the chain placed: the first goal says where its ground is (the pointer on the map flies there too)
  if (m.id === "food10") {
    const at = farmSpot(g), home = g.towns.list[0];
    if (at && home) return { key: "Where", text: `Fertile soil for your farm lies ${far(Math.hypot(at.x - home.c.x, at.y - home.c.y))} ${compassWords(home.c, at)} of ${home.name}`, tone: "", spot: at };
  }
  return null;
}

/** The goal line as one sentence (for the screen reader, and the tests): "Your Farm: starting up. Its first ...". */
export function goalNowSay(n: GoalNow): string {
  const fix = n.fix ? ` ${n.fix}${/[.!?]$/.test(n.fix) ? "" : "."}` : "";
  return `${n.who ? `${n.who}: ${n.text[0].toLowerCase()}${n.text.slice(1)}` : n.text}.${fix}`;
}
