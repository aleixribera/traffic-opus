// The long project (review 2026-11-10, Progression: "after goal 20 there is nothing to aim at but a list of
// shortfalls"). Once every goal is reached the Goals card names one long project and shows how far along it is, and
// the towns' shortfalls become the means to it, not the aim. A landmark on its building site comes first: it is the
// company's own project, weeks of freight. With none being built, the aim is the biggest town's next size: Long Lake
// to a City, 4,120 of 6,000 people, with what holds it back under the bar. Pure over the game.

import type { Game } from "../game/city";
import { BIG_NAME } from "../game/convoys";
import { PLANTS, PRODUCTS, type PlantKind, type Product } from "../game/industry";
import { isMega, megaProgress, piecesLeft } from "../game/megaprojects";
import { townGrowth, type Town } from "../game/settlements";
import { HOLD_FROM, TOWN_SIZES, needFrom, needsOf, nextNeed, sizeOf } from "../game/towns";
import { BUILDING_TYPES } from "../config";
import { makerKind, needHelp, townWants } from "./bottleneck";

/** One step toward the project: "Cement", "180 more loads. Your 2 Cement Works are at full output. Build another." */
export interface Means { head: string; say: string; p?: Product }

export interface LongProject {
  /** "Grow Long Lake into a City", "Hydro Dam" */
  name: string;
  /** what the bar measures, in words: "4,120 of 6,000 people", "64% built" */
  measure: string;
  /** how far along, 0..1 */
  p: number;
  /** how it is going, in a line: "Growing slowly: 92% supplied, full pace from 100%" */
  state: string;
  /** the state is bad news: the town short of supplies or shrinking */
  bad?: boolean;
  /** what to do about it, the biggest first (empty: nothing holds it back) */
  means: Means[];
  /** said under the means: what the next size will ask for, so the chain is ready before it does */
  ahead?: string;
  /** where it is: the town or the site (the card flies there) */
  town?: number;
  works?: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const name = (p: Product) => PRODUCTS[p].name;
const lower = (p: Product) => PRODUCTS[p].name.toLowerCase();
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

/** The long project at hand, or null when there is none left (every town a Metropolis, no landmark being built). */
export function longProject(g: Game, max = 3): LongProject | null {
  return landmark(g, max) ?? sizeBand(g, max);
}

/** The landmark furthest along on its building site. */
function landmark(g: Game, max: number): LongProject | null {
  let best: { b: ReturnType<Game["industry"]["plants"]>[number]; p: number } | null = null;
  for (const b of g.industry.plants()) {
    if (!isMega(b.kind) || !b.plant?.site) continue;
    const p = megaProgress(b, PLANTS[b.kind as PlantKind]);
    if (!best || p > best.p) best = { b, p };
  }
  if (!best) return null;
  const { b, p } = best, def = PLANTS[b.kind as PlantKind], site = b.plant!.site!;
  const means: Means[] = [];
  const left = (Object.entries(site.need) as [Product, number][])
    .map(([q, n]) => ({ q, n: Math.max(0, Math.ceil(n - (site.got[q] ?? 0))) }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n);
  for (const { q, n } of left) {
    const makes = g.industry.plants().some((o) => (PLANTS[o.kind as PlantKind].outputs[q] ?? 0) > 0);
    const k = makerKind(q);
    const w = k ? BUILDING_TYPES[k].name : "";
    means.push({ p: q, head: name(q), say: `${fmt(n)} more ${n === 1 ? "load" : "loads"}.${makes || !k ? "" : ` Nothing of yours makes ${lower(q)} yet: build ${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}.`}` });
  }
  const pc = piecesLeft(b, def);
  if (pc) means.push({ head: `${BIG_NAME[pc.kind]}s`, say: `${pc.n} more, each by convoy.` });
  return {
    name: BUILDING_TYPES[b.kind].name,
    measure: `${Math.floor(p * 100)}% built`,
    p,
    state: left.length || pc ? "On its building site: your trucks bring the materials" : "Finishing off",
    means: means.slice(0, max),
    works: b.id,
  };
}

/** The biggest town that has a size still to reach, and what holds it back from it. */
function sizeBand(g: Game, max: number): LongProject | null {
  const top = TOWN_SIZES.length - 1;
  let t: Town | null = null;
  for (const x of g.towns.list) if (sizeOf(x.pop) < top && (!t || x.pop > t.pop)) t = x;
  if (!t) return null;
  const next = TOWN_SIZES[sizeOf(t.pop) + 1], gr = townGrowth(t);
  const means: Means[] = needsOf(t.pop)
    .map((q) => ({ q, more: townWants(t!, q) }))
    .filter((x) => x.more > 0)
    .sort((x, y) => y.more - x.more)
    .slice(0, max)
    .map(({ q, more }) => ({ p: q, head: name(q), say: `${fmt(more)} more ${more === 1 ? "load" : "loads"} a day. ${needHelp(g, t!, q)?.say ?? "Your works are still getting up to pace."}` }));
  // (what the next size asks for, while there is still time to get its chain going)
  const nn = nextNeed(t.pop);
  const soon = nn ? TOWN_SIZES.flatMap((s) => s.adds).filter((q) => needFrom(q) === nn.pop) : [];
  return {
    name: `Grow ${t.name} into a ${next.name}`,
    measure: `${fmt(t.pop)} of ${fmt(next.pop)} people`,
    p: Math.max(0, Math.min(1, t.pop / next.pop)),
    state: gr.line,
    bad: gr.level < HOLD_FROM,
    means,
    ahead: soon.length ? `From ${fmt(nn!.pop)} people it will want ${list(soon.map(lower))} too.` : undefined,
    town: t.id,
  };
}
