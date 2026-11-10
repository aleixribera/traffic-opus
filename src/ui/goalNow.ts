// The wait under a goal, made legible (owner, 2026-11-10: "the first ten game hours are quiet"). A goal that stands
// at nothing while the works that will meet it go up or start up says what the chain is doing now and when its
// first truck leaves: the very words of that works' own panel (inspect.ts worksStatus), so the goal line and the
// panel are one voice and count down together. Pure over the game, so tests can read every stage.

import { BUILDING_TYPES } from "../config";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { PLANTS, PRODUCTS, takesIn, type PlantKind, type Product } from "../game/industry";
import { unlockedBy, type Milestone } from "../game/progression";
import type { V2 } from "../core/math";
import { compassWords, townGrowth, type Town } from "../game/settlements";
import { needsOf, nextNeed } from "../game/towns";
import { makerKind, needHelp } from "./bottleneck";
import { farmSpot, groundSpot } from "./goalPointer";
import { worksStatus } from "./inspect";
import { distText } from "./distance";

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

/** (the same words as the pointer on the map that points there: distance.ts) */
const far = distText;

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
    // (a feeder stands with nowhere to send its goods: build the works in the middle. Not a feeder whose goods another
    // of the company's works already takes: the Coal Mine feeding a Smelter and a Power Plant was told "no Cement
    // Works to take its coal", a works not even open yet. Review 2026-11-10, B4)
    const taken = (q: Product) => g.industry.plants().some((o) => o.kind !== k && takesIn(o.kind as PlantKind, q));
    for (const q of ins) {
      const f = maker(g, q);
      if (f && !taken(q)) return { who: `Your ${BUILDING_TYPES[f.kind].name}`, text: `No ${BUILDING_TYPES[k].name} to take its ${lower(q)}`, fix: `${buildSay(g, [k])}: ${chain}.`, tone: "", works: f.id, link: true };
    }
    // (part of the chain stands, its goods going elsewhere: the works in the middle is the gap, said as itself)
    if (ins.some((q) => maker(g, q))) return { text: `No ${BUILDING_TYPES[k].name} yet`, fix: `${buildSay(g, [k])}: ${chain}.`, tone: "", link: true };
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
  const size = POP_GOAL[m.id];
  if (size) {
    // (under the first open one only: the goals after it would say the same, and not about a need whose first load an
    // open goal before it already follows, the first food under "First customers")
    const open = g.progress.open(), at = open.indexOf(m);
    if (have >= size || open.findIndex((x) => POP_GOAL[x.id]) !== at) return null;
    const n = townNow(g, size);
    return n?.need && open.slice(0, Math.max(0, at)).some((x) => FIRST_LOAD[x.id]?.p === n.need) ? null : n;
  }
  const f = FIRST_LOAD[m.id];
  if (!f || have > 0) return null;
  const c = chainNow(g, f.p, f.sold);
  if (c) return c;
  // nothing of the chain placed: the first goal says where its ground is (the pointer on the map flies there too)
  if (m.id === "food10") {
    const at = farmSpot(g), home = g.towns.list[0];
    if (at && home) return { key: "Where", text: `Fertile soil for your farm lies ${far(Math.hypot(at.x - home.c.x, at.y - home.c.y))} ${compassWords(home.c, at)} of ${home.name}`, tone: "", spot: at };
  }
  // and the timber's forest, once the first food is sold (one chain at a time, as the tip): the nearest wood a
  // logging camp fits with a road in reach, not the big patch kilometres over the river (play-test 2026-11-10)
  if (m.id === "planks10" && (g.progress.sold.food ?? 0) >= 1 && !g.buildings.list.some((b) => b.kind === "loggingcamp")) {
    const at = groundSpot(g, "loggingcamp"), home = g.towns.list[0];
    if (at && home) return { key: "Where", text: `Forest for a logging camp lies ${far(Math.hypot(at.x - home.c.x, at.y - home.c.y))} ${compassWords(home.c, at)} of ${home.name}`, tone: "", spot: at };
  }
  return null;
}

/**
 * What the chain toward a product's first load is doing now, or null with nothing of it placed: a load on the road
 * to a town (when it is sold there), a missing link of the chain, or the status of the works furthest along.
 */
function chainNow(g: Game, p: Product, sold: boolean): GoalNow | null {
  const name = lower(p);
  // a load of it on the road to a town: the last stage
  if (sold) for (const tr of g.trips()) {
    const h = tr.haul;
    if (!h || h.done || h.leg !== "out" || h.product !== p) continue;
    const t = g.towns.byId.get(g.buildings.byId.get(h.dest)?.town ?? -1);
    if (t) return { text: `The first load of ${name} is on the road to ${t.name}`, tone: "good", works: h.plant };
  }
  // a link of the chain missing: say which, by the recipe
  const gap = missingLink(g, p);
  if (gap) return gap;
  // the works that makes it, or failing that the works that feeds that one (further up the chain)
  let k = makerKind(p);
  for (let step = 0; k && step < 3; step++) {
    const b = furthest(g, k);
    if (b) {
      const P = b.plant!, who = `Your ${BUILDING_TYPES[b.kind].name}`;
      // (made and waiting at the dock: its truck sets off with a full load, or within the hour)
      if (sold && !P.site && b.built >= 1 && (P.out[p] ?? 0) >= 1) return { who, text: `Its first load of ${name} is at the dock`, fix: "Its truck sets off within the hour.", tone: "good", works: b.id };
      const st = worksStatus(g, b);
      return { who, text: st.text, fix: st.fix, tone: st.tone, works: b.id };
    }
    const q: Product | undefined = (Object.keys(PLANTS[k].inputs) as Product[])[0];
    k = q ? makerKind(q) : undefined;
  }
  return null;
}

/** The goals that grow a town to a size, and the size. */
const POP_GOAL: Record<string, number> = { hamlet150: 150, village: 300, pop1000: 1000, town: 1500, pop4000: 4000, city: 6000 };

/** The works a product's chain still needs, the makers of its inputs first: "Build a Logging Camp and a Sawmill: logs → Sawmill → planks." */
function chainToBuild(g: Game, p: Product): string {
  return chainKinds(g, p).say;
}

function chainKinds(g: Game, p: Product): { say: string; kinds: PlantKind[] } {
  const k = makerKind(p);
  if (!k) return { say: "", kinds: [] };
  const ins = Object.keys(PLANTS[k].inputs) as Product[];
  const kinds = [...new Set([...ins.filter((q) => !maker(g, q)).map((q) => makerKind(q)).filter((x): x is PlantKind => !!x), k])];
  const chain = ins.length ? `: ${andList(ins.map(lower))} → ${BUILDING_TYPES[k].name.replace(/ /g, " ")} → ${lower(p)}` : "";
  return { say: `${buildSay(g, kinds)}${chain}.`, kinds };
}

/**
 * Under a goal to grow a town (measured on the biggest): what holds it, and the way out (review 2026-11-10, First
 * hour: the hamlet stood at 127 people for twelve minutes waiting for planks while its goal, "Grow a town to 150
 * people", said nothing). Held or shrinking for want of a need: the need, and the chain toward its first load, or the
 * town's own advice for it. Growing, with a need coming before the goal's size that nothing of the company makes yet:
 * that need, before it opens, once the town has had a first load of everything it needs now (one chain at a time).
 */
function townNow(g: Game, size: number): (GoalNow & { need?: Product }) | null {
  const t = g.towns.list.reduce<Town | null>((a, x) => (!a || x.pop > a.pop ? x : a), null);
  if (!t) return null;
  const gr = townGrowth(t);
  if ((gr.band === "hold" || gr.band === "shrink") && gr.by) {
    const p = gr.by;
    const text = gr.band === "shrink" ? `${t.name} is shrinking, short of ${lower(p)}` : `${t.name} holds at ${t.pop.toLocaleString("en-US")} people, short of ${lower(p)}`;
    // (none of it sold yet: the chain toward its first load, as the first-load goals say it)
    if ((g.progress.sold[p] ?? 0) < 1) {
      const c = chainNow(g, p, true);
      if (c) return { text, fix: goalNowSay(c), tone: c.tone === "bad" ? "bad" : "", works: c.works, link: c.link, need: p };
      // (nothing of it placed: the line flies to the ground for the first of it, the forest for a logging camp)
      const { say, kinds } = chainKinds(g, p);
      const k = kinds.find((x): x is "farm" | "loggingcamp" => x === "farm" || x === "loggingcamp");
      const spot = (k && groundSpot(g, k)) || undefined;
      return { text, fix: say, tone: "bad", link: true, need: p, ...(spot ? { spot } : {}) };
    }
    const h = needHelp(g, t, p);
    return { text, fix: h?.say ?? "Your works are still getting up to pace.", tone: h?.kind === "none" ? "bad" : "", need: p };
  }
  const nn = nextNeed(t.pop);
  if (!nn || nn.pop > size || t.pop < nn.pop * 0.7 || maker(g, nn.p)) return null;
  if (needsOf(t.pop).some((q) => (g.progress.sold[q] ?? 0) < 1)) return null;
  return { text: `${t.name} will want ${lower(nn.p)} from ${nn.pop.toLocaleString("en-US")} people`, fix: `Without a supply it stops growing there. ${chainToBuild(g, nn.p)}`, tone: "", link: true };
}

/** The goal line as one sentence (for the screen reader, and the tests): "Your Farm: starting up. Its first ...". */
export function goalNowSay(n: GoalNow): string {
  const fix = n.fix ? ` ${n.fix}${/[.!?]$/.test(n.fix) ? "" : "."}` : "";
  return `${n.who ? `${n.who}: ${n.text[0].toLowerCase()}${n.text.slice(1)}` : n.text}.${fix}`;
}
