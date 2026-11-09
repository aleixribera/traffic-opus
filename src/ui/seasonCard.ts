// The season's title card (owner, 2026-11-09: "a cool visual text when changing seasons, and show a bit which building
// bonuses/debuffs that means"): the moment the calendar crosses into a new season, a newsreel title card drops in at
// the top of the screen (the season's name set big, a line under it, what the season does to the player's own sites,
// one practical hint), holds about four and a half seconds and fades. It never takes a click, waits behind a
// milestone banner and gives way to one, and never shows for a new game or a loaded save. The same lines stay one
// hover away on the clock's season line.
//
// The effects are derived from calendar.SEASONAL (its mid-season value, where the season settles, against the
// year-round average), so a new seasonal kind shows up here by itself.
//
// Dev hook (for screenshots and tests):
//   __season.show("autumn")   the card for a season now, sim untouched (default: the next one)
//   __season.advance()        jump the sim clock to two seconds before the next season, so the real crossing fires

import "./season.css";
import { BUILDING_TYPES, type BuildingKind } from "../config";
import { SEASONAL, SEASONS, SEASON_DAYS, SEASON_NAME, YEAR, seasonDay, seasonOf, yearOf, yearPhase, type Season } from "../game/calendar";
import { seasonGlyph } from "./specials";

/** A line under the season's name, as a newsreel would put it. */
export const SEASON_MOTTO: Record<Season, string> = {
  spring: "The thaw is in and the fields are sown",
  summer: "Long days on the open road",
  autumn: "The harvest rush is on",
  winter: "Hard ground and short days",
};

/**
 * One practical hint per season, the first whose kind the player runs (in this order). Where nothing they run swings
 * much, no hint.
 */
const SEASON_HINTS: Record<Season, [string, string][]> = {
  spring: [["farm", "Crops stay short until summer: draw on stores"]],
  summer: [["loggingcamp", "Soft ground slows the felling until autumn"]],
  autumn: [["farm", "Warehouses bank the surplus for winter"]],
  winter: [["farm", "Farms are lean: draw on stored crops"], ["loggingcamp", "Frozen ground: the logging camps fell at their best"]],
};

/** A mid-season pace within this of the year's average reads as steady (in whole percent). */
const STEADY_PCT = 2;

export type EffectDir = "up" | "down" | "steady";
export interface EffectLine {
  kind: string;
  /** the kind, plural ("Farms", "Logging camps") */
  label: string;
  dir: EffectDir;
  /** the mid-season pace against the year-round average, in whole percent (+60, −25, 0) */
  pct: number;
  /** "▲ +60%", "▼ −25%", "≈ steady" */
  value: string;
  /** the whole line in words: "Farms ▲ +60%" */
  text: string;
}
export interface SeasonEffects {
  season: Season;
  /** one per seasonal kind listed: the player's own, or every seasonal kind when they run none */
  lines: EffectLine[];
  /** the player runs none of the seasonal kinds: the lines are the general effect, shown as one line */
  general: boolean;
  /** one practical hint, or null */
  hint: string | null;
}

/** A kind's name as a plural, sentence case: "Logging Camp" -> "Logging camps". */
export function kindPlural(kind: string): string {
  const name = BUILDING_TYPES[kind as BuildingKind]?.name ?? kind;
  const s = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return /(s|x|ch|sh)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`;
}

/** One kind's line for a season, from its mid-season value in SEASONAL. */
export function effectLine(kind: string, s: Season): EffectLine {
  const v = SEASONAL[kind]?.[SEASONS.indexOf(s)] ?? 1;
  const pct = Math.round((v - 1) * 100);
  const dir: EffectDir = Math.abs(pct) <= STEADY_PCT ? "steady" : pct > 0 ? "up" : "down";
  const value = dir === "steady" ? "≈ steady" : dir === "up" ? `▲ +${pct}%` : `▼ −${-pct}%`;
  const label = kindPlural(kind);
  return { kind, label, dir, pct, value, text: `${label} ${value}` };
}

/** The seasonal kinds among a list of the player's sites, in SEASONAL's order. */
export function ownedSeasonal(sites: Iterable<{ kind: string }>): string[] {
  const have = new Set<string>();
  for (const b of sites) if (SEASONAL[b.kind]) have.add(b.kind);
  return Object.keys(SEASONAL).filter((k) => have.has(k));
}

/** What a season means for the player's sites: a line per seasonal kind they run (or all, when none), and a hint. */
export function seasonEffects(s: Season, owned: string[]): SeasonEffects {
  const general = owned.length === 0;
  const kinds = general ? Object.keys(SEASONAL) : owned;
  const lines = kinds.map((k) => effectLine(k, s));
  const hint = general ? null : SEASON_HINTS[s].find(([k]) => owned.includes(k))?.[1] ?? null;
  return { season: s, lines, general, hint };
}

/**
 * Watches the sim clock for a season crossing. The first look at a game (a new one or a loaded save) and a clock that
 * went backwards only take note; a crossing after that is returned once.
 */
export class SeasonWatch {
  private game: unknown = null;
  private season: Season | null = null;
  private t = 0;

  /** The season just entered, if the clock crossed into one since the last look at this same game; else null. */
  see(game: unknown, t: number): Season | null {
    const s = seasonOf(t);
    if (game !== this.game || this.season === null || t < this.t) {
      this.game = game; this.season = s; this.t = t;
      return null;
    }
    this.t = t;
    if (s === this.season) return null;
    this.season = s;
    return s;
  }

  /** Forget the game (a load or a new game: its first look only takes note). */
  reset() { this.game = null; this.season = null; }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The effect rows, a ledger with dotted leaders; the general effect as one line. */
function fxHtml(fx: SeasonEffects): string {
  if (fx.general) {
    const all = fx.lines.map((l, i) => `<span>${i ? l.label.toLowerCase() : l.label} <b class="${l.dir}">${l.value}</b></span>`).join(" · ");
    return `<p class="sc-general">${all}<span class="sc-once">, once you run them</span></p>`;
  }
  const rows = fx.lines.map((l) => {
    const [arrow, ...rest] = l.value.split(" ");
    const word = l.dir === "up" ? "up" : l.dir === "down" ? "down" : "";
    return `<li class="${l.dir}"><span class="sc-k">${esc(l.label)}</span><i aria-hidden="true"></i><span class="sc-v"><b aria-hidden="true">${arrow}</b>${word ? `<span class="vh">${word} </span>` : ""}${rest.join(" ")}</span></li>`;
  }).join("");
  return `<ul class="sc-fx">${rows}</ul>`;
}

function hintHtml(fx: SeasonEffects): string {
  return fx.hint ? `<p class="sc-hint">${esc(fx.hint)}</p>` : "";
}

/** A Deco sunburst: rays fanning up from a hub that carries the season's glyph. */
function sunburst(s: Season): string {
  const rays: string[] = [];
  const N = 17, cx = 90, cy = 62;
  for (let i = 0; i < N; i++) {
    const a = Math.PI * (i / (N - 1));
    const long = i % 2 === 0, r0 = 26, r1 = long ? 58 : 44;
    const x0 = cx - Math.cos(a) * r0, y0 = cy - Math.sin(a) * r0, x1 = cx - Math.cos(a) * r1, y1 = cy - Math.sin(a) * r1;
    rays.push(`<line class="${long ? "lg" : "sh"}" style="--i:${Math.abs(i - (N - 1) / 2)}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`);
  }
  return `<svg class="sc-sun" viewBox="0 0 180 64" width="180" height="64" aria-hidden="true">
    <g class="sc-rays">${rays.join("")}</g>
    <path class="sc-arc" d="M${cx - 21} ${cy} A21 21 0 0 1 ${cx + 21} ${cy}"/>
    <line class="sc-base" x1="20" y1="${cy + 1}" x2="160" y2="${cy + 1}"/>
    <g transform="translate(${cx - 10} ${cy - 20}) scale(1.25)">${seasonGlyph(s).replace(/ width="13" height="13"/, ' width="16" height="16"')}</g>
  </svg>`;
}

/** The title card's inside. */
export function seasonCardHtml(s: Season, year: number, fx: SeasonEffects): string {
  return `<div class="sc-in">
    ${sunburst(s)}
    <p class="sc-kicker"><span>Year ${year}</span></p>
    <h2 class="sc-title">${SEASON_NAME[s]}</h2>
    <p class="sc-motto">${SEASON_MOTTO[s]}</p>
    <div class="sc-body">${fxHtml(fx)}${hintHtml(fx)}</div>
  </div>`;
}

/** The clock's popover: the season now, how far in, and the same lines as the card. */
export function seasonPopHtml(t: number, fx: SeasonEffects): string {
  const s = fx.season, d = seasonDay(t), wait = SEASON_DAYS - d + 1;
  const next = SEASON_NAME[SEASONS[(SEASONS.indexOf(s) + 1) % 4]];
  return `<header>${seasonGlyph(s)}<span>${SEASON_NAME[s]}</span></header>
    <p class="sp-motto">${SEASON_MOTTO[s]}</p>
    <p class="sp-when">Day ${d} of ${SEASON_DAYS} · year ${yearOf(t)} · ${next} ${wait === 1 ? "tomorrow" : `in ${wait} days`}</p>
    ${fxHtml(fx)}${hintHtml(fx)}`;
}

/** How long the card holds and fades, ms (the CSS animation runs the same 5.4 s). */
const CARD_MS = 5400;

type Host = {
  game: { time: number; buildings: { sites: { kind: string }[] } } | null | undefined;
  mode: string;
};

/**
 * The card and the clock's popover in the HUD. The HUD calls `tick` a few times a second, `yieldTo` when a banner
 * comes up, `clear` on a load or a new game, and `wireClock` once with the clock element.
 */
export class SeasonCard {
  readonly el: HTMLElement;
  readonly pop: HTMLElement;
  private watch = new SeasonWatch();
  /** a season entered while a banner was up, shown once it clears */
  private pend: Season | null = null;
  private timer = 0;
  private clockEl: HTMLElement | null = null;
  private popPinned = false;
  private popHover = false;
  private popT = 0;

  constructor(private host: () => Host) {
    this.el = document.createElement("section");
    this.el.className = "season-card";
    this.el.hidden = true;
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    this.pop = document.createElement("div");
    this.pop.className = "card season-pop";
    this.pop.id = "season-pop";
    this.pop.hidden = true;
    this.pop.setAttribute("role", "tooltip");
    this.pop.onpointerenter = () => { this.popHover = true; clearTimeout(this.popT); };
    this.pop.onpointerleave = () => { this.popHover = false; this.popLater(); };
    (window as unknown as { __season: unknown }).__season = {
      show: (s?: Season) => this.show(s ?? this.nextSeason()),
      advance: () => this.advance(),
    };
  }

  get showing() { return !this.el.hidden; }

  private nextSeason(): Season {
    const g = this.host().game;
    return SEASONS[(SEASONS.indexOf(seasonOf(g?.time ?? 0)) + 1) % 4];
  }

  /** Dev: move the sim clock to two seconds before the next season starts. */
  private advance() {
    const g = this.host().game;
    if (!g) return;
    const ph = yearPhase(g.time), edge = (Math.floor(ph * 4 + 1e-9) + 1) / 4;
    g.time += (edge - ph) * YEAR - 2;
  }

  /** A look at the clock: a crossing in play queues the card; it shows as soon as no banner is up. */
  tick(bannerUp: boolean) {
    const H = this.host(), g = H.game;
    if (!g) return;
    const s = this.watch.see(g, g.time);
    if (s && H.mode === "play") this.pend = s;
    if (this.pend && !bannerUp && !this.showing) {
      this.show(this.pend);
      this.pend = null;
    }
    if (!this.pop.hidden) this.fillPop();
  }

  /** Put the card up for a season now. */
  show(s: Season) {
    const g = this.host().game;
    if (!g) return;
    const fx = seasonEffects(s, ownedSeasonal(g.buildings.sites));
    clearTimeout(this.timer);
    this.el.className = `season-card s-${s}`;
    this.el.innerHTML = seasonCardHtml(s, yearOf(g.time), fx);
    this.el.hidden = false;
    void this.el.offsetWidth;
    this.el.classList.add("in");
    this.timer = window.setTimeout(() => this.hide(), CARD_MS);
  }

  private hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
    this.el.classList.remove("in", "away");
  }

  /** A banner comes up: the card steps aside at once (a quick fade). */
  yieldTo() {
    if (!this.showing || this.el.classList.contains("away")) return;
    clearTimeout(this.timer);
    this.el.classList.add("away");
    this.timer = window.setTimeout(() => this.hide(), 260);
  }

  /** A load or a new game: nothing showing or waiting, and the next look at the clock only takes note. */
  clear() {
    this.pend = null;
    this.hide();
    this.watch.reset();
    this.closePop();
  }

  // ---- the clock's season popover: hover shows it, a click (or Enter) pins it, Esc or a click elsewhere closes it

  wireClock(clock: HTMLElement) {
    this.clockEl = clock;
    clock.setAttribute("aria-controls", this.pop.id);
    clock.setAttribute("aria-expanded", "false");
    clock.onpointerenter = () => { this.popHover = true; clearTimeout(this.popT); this.openPop(); };
    clock.onpointerleave = () => { this.popHover = false; this.popLater(); };
    clock.onclick = () => { this.popPinned = !this.popPinned; this.popPinned ? this.openPop() : this.closePop(); };
    clock.onfocus = () => this.openPop();
    clock.onblur = () => { if (!this.popPinned) this.popLater(); };
    document.addEventListener("pointerdown", (e) => {
      if (!this.popPinned) return;
      const n = e.target as Node | null;
      if (n && (clock.contains(n) || this.pop.contains(n))) return;
      this.closePop();
    });
  }

  private popLater() {
    clearTimeout(this.popT);
    this.popT = window.setTimeout(() => { if (!this.popPinned && !this.popHover) this.closePop(); }, 180);
  }

  private openPop() {
    this.fillPop();
    this.pop.hidden = false;
    this.clockEl?.setAttribute("aria-expanded", "true");
  }

  /** Close the pinned popover (Esc). True if it was open. */
  closePop(): boolean {
    const was = !this.pop.hidden;
    clearTimeout(this.popT);
    this.popPinned = false;
    this.pop.hidden = true;
    this.clockEl?.setAttribute("aria-expanded", "false");
    return was;
  }

  get popOpen() { return !this.pop.hidden && this.popPinned; }

  private popKey = "";
  private fillPop() {
    const g = this.host().game;
    if (!g) return;
    const s = seasonOf(g.time);
    const fx = seasonEffects(s, ownedSeasonal(g.buildings.sites));
    const html = seasonPopHtml(g.time, fx);
    if (html === this.popKey) return;
    this.popKey = html;
    this.pop.className = `card season-pop s-${s}`;
    this.pop.innerHTML = html;
  }
}
