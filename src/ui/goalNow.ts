// The wait under a goal, made legible (owner, 2026-11-10: "the first ten game hours are quiet"). A goal that stands
// at nothing while the works that will meet it go up or start up says what the chain is doing now and when its
// first truck leaves: the very words of that works' own panel (inspect.ts worksStatus), so the goal line and the
// panel are one voice and count down together. Pure over the game, so tests can read every stage.

import { BUILDING_TYPES } from "../config";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { PLANTS, PRODUCTS, type PlantKind, type Product } from "../game/industry";
import { unlockedBy, type Milestone } from "../game/progression";
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
  cement: { p: "cement", sold: false },
  fuel1: { p: "fuel", sold: false },
  goods1: { p: "goods", sold: false },
  machinery1: { p: "machinery", sold: false },
  cars1: { p: "cars", sold: true },
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
  /** a missing link of the chain: the advice (which names the chain) belongs on the line even where space is short */
  link?: boolean;
}

const far = (m: number) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);

const rank = (b: Building) => (b.plant!.site ? 0 : b.built < 1 ? 1 + b.built : 3);

/** The works of a kind furthest along: open before going up before a bare site, the most built first. */
function furthest(g: Game, k: PlantKind): Building | undefined {
  return g.industry.plants().filter((b) => b.kind === k).sort((a, b) => rank(b) - rank(a))[0];
}

/** The company's works furthest along that makes p, of any kind (a Sawmill's wood chips count as wood chips). */
function maker(g: Game, p: Product): Building | undefined {
  return g.industry.plants().filter((b) => (PLANTS[b.kind as PlantKind].outputs[p] ?? 0) > 0).sort((a, b) => rank(b) - rank(a))[0];
}

const lower = (p: Product) => PRODUCTS[p].name.toLowerCase();
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const aName = (k: PlantKind) => { const n = BUILDING_TYPES[k].name; return `${/^[AEIOU]/.test(n) ? "an" : "a"} ${n}`; };

/** "Build a Farm", or for works not open to build yet the goal that opens them (up to three goals are open at once). */
function buildSay(g: Game, ks: PlantKind[]): string {
  const can = ks.filter((k) => g.placedUnlocked(k)), not = ks.filter((k) => !g.placedUnlocked(k));
  const later = not.map((k) => { const m = unlockedBy((u) => u.buildings?.includes(k)); return `${aName(k)}${m ? ` opens with the goal “${m.name}”` : " is not open yet"}`; });
  const say = [can.length ? `Build ${andList(can.map(aName))}` : "", ...later].filter(Boolean).join("; ");
  return say[0].toUpperCase() + say.slice(1);
}

/**
 * The missing link in a two-step chain, read off the recipes (owner, 2026-11-10: "name the missing link, crops ->
 * Food Plant -> food"): a works that makes an input stands but nothing turns it into p, or the works that makes p
 * stands but nothing of the company makes one of its inputs. The chain itself is said as the recipe goes:
 * "iron ore and coal → Smelter → steel".
 */
export function missingLink(g: Game, p: Product): GoalNow | null {
  const k = makerKind(p);
  if (!k) return null;
  const ins = Object.keys(PLANTS[k].inputs) as Product[];
  if (!ins.length) return null;
  // (no break inside the works' name or before the product, so the chain wraps whole: "crops →" / "Food Plant → food")
  const chain = `${andList(ins.map(lower))} → ${BUILDING_TYPES[k].name.replace(/ /g, " ")} → ${lower(p)}`;
  const mk = furthest(g, k);
  if (!mk) {
    // (a feeder stands with nowhere to send its goods: build the works in the middle)
    for (const q of ins) {
      const f = maker(g, q);
      if (f) return { who: `Your ${BUILDING_TYPES[f.kind].name}`, text: `No ${BUILDING_TYPES[k].name} to take its ${lower(q)}`, fix: `${buildSay(g, [k])}: ${chain}.`, tone: "", works: f.id, link: true };
    }
    return null;
  }
  const missing = ins.filter((q) => !maker(g, q));
  if (!missing.length) return null;
  const kinds = [...new Set(missing.map((q) => makerKind(q)).filter((x): x is PlantKind => !!x))];
  return {
    who: `Your ${BUILDING_TYPES[k].name}`,
    text: `Waiting for ${andList(missing.map(lower))}, which nothing of yours makes`,
    fix: `${buildSay(g, kinds)}: ${chain}.`,
    tone: "",
    works: mk.id,
    link: true,
  };
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
  // a link of the chain missing: say which, by the recipe
  const gap = missingLink(g, f.p);
  if (gap) return gap;
  // the works that makes it, or failing that the works that feeds that one (further up the chain)
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
