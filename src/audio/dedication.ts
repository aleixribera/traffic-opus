// The wireless's dedications (docs/design.md, "Sound"): when something big happens (a new town, a town grown a size,
// a goal reached, a convoy setting off, a long jam cleared, a landmark opened) the station dedicates its next number
// to it. The band stops, the station's ident chimes, the card goes up ("Tonight's number goes out to Poplar Creek,
// a Town now") and the next tune is one named for the town.
//
// Pure: what each one says, how often one may go out, and when a long jam has cleared itself. A dedication is a treat, not a ticker: never more than one
// every few minutes, and none in the first moments after a game is opened.

import type { V2 } from "../core/math";

/** What happened, as the announcer needs it. */
export type DedicationEvent =
  | { k: "newTown"; town: string }
  | { k: "townSize"; town: string; size: string }
  | { k: "goal"; name: string; company: string; town: string }
  | { k: "convoy"; load: string; to: string; town: string }
  | { k: "jam"; town: string }
  | { k: "landmark"; what: string; town: string };

/** One dedication: the line's parts (the name in it is set in bold) and the town the tune is named for. */
export interface Dedication {
  lead: string;
  to: string;
  sep: string;
  why: string;
  /** the town the next tune is named for */
  town: string;
}

/** Seconds (real time) between two dedications at least, and after a game is opened before the first. */
export const DEDICATION_GAP = 180, DEDICATION_SETTLE = 20;

/** The number's time of day, as the announcer says it. */
export function numberOf(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 4.5 && h < 12) return "This morning's number";
  if (h >= 12 && h < 17.5) return "This afternoon's number";
  if (h >= 17.5 && h < 20.5) return "This evening's number";
  return "Tonight's number";
}

const article = (s: string) => (/^[aeiou]/i.test(s) ? "an" : "a");

/** What the announcer says for an event at an hour. */
export function dedicationFor(ev: DedicationEvent, hour: number): Dedication {
  const lead = `${numberOf(hour)} goes out to`;
  switch (ev.k) {
    case "newTown": return { lead, to: `the first folks of ${ev.town}`, sep: ", ", why: "new on the map", town: ev.town };
    case "townSize": return { lead, to: ev.town, sep: ", ", why: `${article(ev.size)} ${ev.size} now`, town: ev.town };
    case "goal": return { lead, to: `everyone at ${ev.company || "the company"}`, sep: ": ", why: `${ev.name}, and well earned`, town: ev.town };
    case "convoy": return { lead, to: "the convoy crew", sep: " ", why: `hauling ${article(ev.load)} ${ev.load.toLowerCase()} to the ${ev.to}`, town: ev.town };
    case "jam": return { lead, to: `the drivers of ${ev.town}`, sep: ": ", why: "the road is moving again", town: ev.town };
    case "landmark": return { lead, to: ev.town, sep: " ", why: `and its new ${ev.what}`, town: ev.town };
  }
}

/**
 * Which of two things happening together gets the number (higher wins): a landmark over a goal over a town, a
 * convoy, then a jam cleared. A bigger town beats a smaller one.
 */
export function weightOf(ev: DedicationEvent): number {
  switch (ev.k) {
    case "landmark": return 60;
    case "goal": return 50;
    case "newTown": return 42;
    case "townSize": return 40 + Math.min(9, ["Village", "Town", "City", "Metropolis"].indexOf(ev.size) + 1);
    case "convoy": return 30;
    case "jam": return 20;
  }
}

/** The whole line, as plain text (the card sets the name in bold). */
export const lineOf = (d: Dedication) => `${d.lead} ${d.to}${d.sep}${d.why}.`;

/** How often one may go out: `offer` says yes at most once a DEDICATION_GAP, and not in the first moments of a game. */
export class DedicationDesk {
  private last = -Infinity;
  private opened = -Infinity;

  /** A game was opened (a load, a new game) at real time `now` (s). */
  open(now: number) { this.opened = now; }

  /** One may go out now (nothing is used up: `offer` takes the turn). */
  ready(now: number): boolean {
    return now - this.opened >= DEDICATION_SETTLE && now - this.last >= DEDICATION_GAP;
  }

  offer(now: number): boolean {
    if (!this.ready(now)) return false;
    this.last = now;
    return true;
  }
}

/** A jam counts once a car in it has waited this long (game seconds), and is cleared once nobody within JAM_NEAR (m)
 * of its spot has been stuck for CLEAR_FOR (game seconds). */
export const JAM_LONG = 240, JAM_NEAR = 140, CLEAR_FOR = 15;

/**
 * A long jam clearing: once a car somewhere has been stuck for minutes, the spot is remembered, and when nobody near
 * it has been stuck for a little while the road is moving again. Game time: a paused game clears nothing, and a clock
 * that jumps (a load, a game that went back) forgets the jam.
 */
export class JamWatch {
  private jam: { c: V2; town: string; clear: number } | null = null;
  private lastT = -1;

  reset() { this.jam = null; this.lastT = -1; }

  /** A look at game time `t` with the stuck spots now (each its middle and its longest wait): the town whose jam
   * has just cleared, or null. */
  step(t: number, spots: readonly { c: V2; worst: number }[], nearest: (p: V2) => string | undefined): string | null {
    if (t < this.lastT || t - this.lastT > 3600) this.jam = null;
    this.lastT = t;
    if (!this.jam) {
      let worst: { c: V2; worst: number } | null = null;
      for (const s of spots) if (s.worst >= JAM_LONG && (!worst || s.worst > worst.worst)) worst = s;
      const n = worst && nearest(worst.c);
      if (worst && n) this.jam = { c: { x: worst.c.x, y: worst.c.y }, town: n, clear: -1 };
      return null;
    }
    const j = this.jam;
    if (spots.some((s) => Math.hypot(s.c.x - j.c.x, s.c.y - j.c.y) < JAM_NEAR)) { j.clear = -1; return null; }
    if (j.clear < 0) { j.clear = t; return null; }
    if (t - j.clear < CLEAR_FOR) return null;
    this.jam = null;
    return j.town;
  }
}
