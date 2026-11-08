// The special industries in the HUD (docs/design.md, "Freight: oversized loads", "Landmarks", "Industrial parks",
// "Seasons"): the season in the clock, a landmark's site with its progress ring and stage, a finished landmark's
// reward, and the rows a plant's panel gains: turbines on a power plant, the next oversized piece at a machine works
// and its convoys out, the harvest's pace on a farm or a logging camp, and its conveyors and pipes. HTML only; the
// HUD lays it out and refreshes it.

import { BUILDING_TYPES } from "../config";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { BIG_NAME, LOADS_PER_PIECE, MAX_TURBINES, PIECE_YARD, TURBINE_BOOST, convoysOut } from "../game/convoys";
import { MEGAS, isMega, megaProgress, megaStage } from "../game/megaprojects";
import { PLANTS, PRODUCTS, isPlantKind, type Product } from "../game/industry";
import { SEASONAL, SEASONS, SEASON_DAYS, SEASON_NAME, seasonAvg, seasonDay, seasonMult, seasonOf, yearOf, type Season } from "../game/calendar";

type Bar = (n: number, max: number, color?: number) => string;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A small glyph for each season, drawn in the clock: a sprout, the sun, a wheat ear, a snowflake. */
const SEASON_GLYPH: Record<Season, string> = {
  spring: `<path d="M8 14V7"/><path d="M8 9c0-3 2-5 5-5 0 3-2 5-5 5Z"/><path d="M8 11c0-2.4-1.6-4-4-4 0 2.4 1.6 4 4 4Z"/>`,
  summer: `<circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>`,
  autumn: `<path d="M8 15V3"/><path d="M8 5c-2-.4-3-1.6-3-3 2 .4 3 1.6 3 3ZM8 5c2-.4 3-1.6 3-3-2 .4-3 1.6-3 3Z"/><path d="M8 9c-2-.4-3-1.6-3-3 2 .4 3 1.6 3 3ZM8 9c2-.4 3-1.6 3-3-2 .4-3 1.6-3 3Z"/><path d="M8 13c-2-.4-3-1.6-3-3 2 .4 3 1.6 3 3ZM8 13c2-.4 3-1.6 3-3-2 .4-3 1.6-3 3Z"/>`,
  winter: `<path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5"/><path d="M6.3 2.8 8 4.3l1.7-1.5M6.3 13.2 8 11.7l1.7 1.5"/>`,
};

export function seasonGlyph(s: Season): string {
  return `<svg class="season-glyph s-${s}" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${SEASON_GLYPH[s]}</svg>`;
}

/** The clock's second line: the season with its glyph and the day within it ("Autumn · Day 7"); the year in its tooltip. */
export function seasonLine(t: number): string {
  const s = seasonOf(t), d = seasonDay(t), wait = SEASON_DAYS - d + 1;
  const next = SEASON_NAME[SEASONS[(SEASONS.indexOf(s) + 1) % 4]];
  const title = `Day ${d} of ${SEASON_DAYS} of ${SEASON_NAME[s].toLowerCase()}, year ${yearOf(t)}; ${next} ${wait === 1 ? "tomorrow" : `in ${wait} days`}. Farms bring in the harvest in autumn; logging camps fell most in winter`;
  return `<span class="cb-day cb-season s-${s}" title="${title}">${seasonGlyph(s)}${SEASON_NAME[s]} · Day ${d}</span>`;
}

/** What each season means for the harvest, in a word or two, for the panels. */
const SEASON_WORD: Record<string, Record<Season, string>> = {
  farm: { spring: "sowing", summer: "growing", autumn: "harvest", winter: "fallow" },
  loggingcamp: { spring: "thaw", summer: "soft ground", autumn: "felling", winter: "peak felling" },
};

/** A farm's or logging camp's season row: its pace now against the year's average, and the next season's. */
function seasonRows(b: Building, t: number): string {
  if (!SEASONAL[b.kind]) return "";
  const s = seasonOf(t), m = seasonMult(b.kind, t);
  const order: Season[] = ["spring", "summer", "autumn", "winter"];
  const next = order[(order.indexOf(s) + 1) % 4];
  const cls = m >= 1.15 ? "good" : m <= 0.85 ? "bad" : "";
  const word = SEASON_WORD[b.kind]?.[s] ?? "";
  return `<dt>Season</dt><dd class="${cls}">${seasonGlyph(s)}${SEASON_NAME[s]} ${word} · ×${m.toFixed(2)}</dd>
    <dt>Next</dt><dd class="muted">${SEASON_NAME[next]} · ×${seasonAvg(b.kind, next).toFixed(2)} on average</dd>`;
}

/** A power plant's turbine hall: turbines brought by convoy, and what they add. */
function turbineRows(b: Building): string {
  if (!isPlantKind(b.kind) || !PLANTS[b.kind].makes || PLANTS[b.kind].mega) return "";
  const n = b.plant?.turbines ?? 0;
  return `<dt title="Machine works ship turbines here by oversized-load convoy, ${MAX_TURBINES} at most, each +${Math.round(TURBINE_BOOST * 100)}% output for good">Turbines</dt>
    <dd><span class="slots">${Array.from({ length: MAX_TURBINES }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>${n ? `+${Math.round(n * TURBINE_BOOST * 100)}% output` : "none yet"}</dd>`;
}

/** A machine works' oversized pieces: the next one taking shape, those waiting in the yard, the convoys out. */
function worksRows(g: Game, b: Building, bar: Bar): string {
  if (b.kind !== "machineworks" || !b.plant) return "";
  const B = b.plant.big ?? { prog: 0, n: 0 };
  const out = convoysOut(g.trips(), b.id);
  const road = out.map((r) => {
    const to = g.buildings.byId.get(r.dest);
    return `${BIG_NAME[r.big!]} to the ${to ? BUILDING_TYPES[to.kind].name : "site"}`;
  });
  const full = B.n >= PIECE_YARD;
  return `<dt title="Every ${LOADS_PER_PIECE} loads of machinery it makes, it builds one oversized piece besides, shipped by escorted convoy">Next big piece</dt>
    <dd>${full ? `<span class="muted">yard full</span>` : `${bar(B.prog * 12, 12, 0xd9a52c)}<span class="num">${Math.floor(B.prog * 100)}%</span>`}</dd>
    <dt>Pieces waiting</dt><dd>${B.n} of ${PIECE_YARD}${B.n && !out.length ? ` · <span class="muted">nowhere to go</span>` : ""}</dd>
    <dt>On the road</dt><dd class="${out.length ? "good" : "muted"}">${out.length ? esc(road.join(", ")) : "no convoy out"}</dd>
    ${B.shipped ? `<dt>Delivered</dt><dd>${B.shipped}</dd>` : ""}`;
}

/** Extra facts rows for any plant's panel (empty for most). */
export function specialRows(g: Game, b: Building, bar: Bar): string {
  return turbineRows(b) + worksRows(g, b, bar) + seasonRows(b, g.time);
}

/** A plant's conveyors and pipes, as a section of its panel. */
export function parkSection(g: Game, b: Building): string {
  const lines = g.parks.linesFor(b.id);
  if (!lines.length) return "";
  return `<h3 class="sub-h">Industrial park</h3><ul class="park-lines">${lines.map((l) => `<li class="${l.out ? "out" : "in"}">${esc(l.text)}</li>`).join("")}</ul>
    <p class="small muted">The belt carries a few loads an hour on its own; trucks take the rest. Linked plants pollute further.</p>`;
}

const STAGE_NAME = ["Foundations", "Frame rising", "Finishing"];

/** A progress ring: k of the way round, a number in the middle. */
function ring(k: number, label: string): string {
  const R = 26, C = 2 * Math.PI * R;
  return `<svg class="lm-ring" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${label}">
    <circle cx="32" cy="32" r="${R}" class="lm-ring-bg"/>
    <circle cx="32" cy="32" r="${R}" class="lm-ring-fg" stroke-dasharray="${(C * k).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle">${Math.floor(k * 100)}%</text></svg>`;
}

/** A landmark's building site in its panel: the ring, the stage, the materials and pieces, and what it will do. */
export function landmarkSite(g: Game, b: Building): string | null {
  if (!isMega(b.kind) || !b.plant || (!b.plant.site && b.built >= 1)) return null;
  const D = PLANTS[b.kind], P = b.plant, M = MEGAS[b.kind];
  const site = P.site;
  const k = site ? megaProgress(b, D) : 1;
  const stage = site ? megaStage(b, D) : 3;
  const mats = site ? (Object.keys(site.need) as Product[]).map((p) => {
    const need = site.need[p]!, got = Math.min(need, site.got[p] ?? 0);
    // (a slim bar, not pips: a landmark wants a hundred loads of some things)
    const pc = `#${PRODUCTS[p].color.toString(16).padStart(6, "0")}`;
    return `<dt>${PRODUCTS[p].name}</dt><dd><span class="lm-bar" role="img" aria-label="${Math.floor(got)} of ${need}" style="--pc:${pc}"><i style="width:${((got / need) * 100).toFixed(1)}%"></i></span><span class="num">${Math.floor(got)} / ${need}</span></dd>`;
  }).join("") : "";
  let loads = 0, pieces = 0;
  for (const tr of g.trips()) {
    const r = tr.haul;
    if (!r || r.done || r.dest !== b.id) continue;
    if (r.big) pieces++;
    else if (r.leg === "out") loads += r.n;
  }
  const pc = D.pieces;
  const got = P.landmark?.pieces ?? 0;
  const pieceRow = pc ? `<dt>${BIG_NAME[pc.kind]}s <span class="muted">by convoy</span></dt>
    <dd><span class="slots big">${Array.from({ length: pc.n }, (_, i) => `<i class="${i < got ? "on" : i < got + pieces ? "way" : ""}"></i>`).join("")}</span><span class="num">${got} / ${pc.n}</span></dd>` : "";
  const status = site ? `Stage ${stage} of 3 · ${STAGE_NAME[stage - 1]}` : `Finishing · ${Math.round(b.built * 100)}%`;
  return `<div class="lm-head">${ring(k, `${Math.floor(k * 100)}% built`)}<div>
      <p class="lm-stage">${status}</p>
      <p class="small muted">${loads ? `${loads} load${loads === 1 ? "" : "s"}` : "No loads"} on the way${pieces ? ` · ${pieces} convoy${pieces === 1 ? "" : "s"} coming` : ""}</p>
    </div></div>
    ${site ? `<h3 class="sub-h">Materials delivered</h3><dl class="facts">${mats}${pieceRow}</dl>` : ""}
    <h3 class="sub-h">When it opens</h3><p class="small lm-reward">${esc(M.reward)}</p>
    <p class="small muted">Your plants truck the materials here on their own, and machine works send the ${pc ? BIG_NAME[pc.kind].toLowerCase() + "s" : "pieces"} by escorted convoy. Deliveries earn nothing: it is the company's own project.</p>`;
}

/** A finished landmark: when it opened, the town it serves, what it does. */
export function landmarkDone(g: Game, b: Building): string {
  const L = b.plant?.landmark;
  if (!isMega(b.kind) || L?.done === undefined) return "";
  const town = L.town !== undefined ? g.towns.byId.get(L.town) : undefined;
  const day = g.people.dayOf(L.done);
  return `<h3 class="sub-h">Landmark</h3><p class="small lm-reward">${esc(MEGAS[b.kind].reward)}</p>
    <dl class="facts"><dt>Opened</dt><dd>Day ${day}</dd>${town ? `<dt>Serves</dt><dd>${esc(town.name)}</dd>` : ""}</dl>`;
}
