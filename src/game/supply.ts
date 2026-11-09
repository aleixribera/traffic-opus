// A town's supply of each need as its people see it (only what has landed: a load on the road is not in the town yet),
// and the two things that keep a regular delivery run from reading as a shortfall (owner, 2026-11-09: "deliveries to
// towns seem to always be late"):
// - the send-ahead line (dipIn): the company's plants see a town's supply about to fall below "Enough" before its
//   people do, early enough for a truck sent now to land first (industry.ts customers: the hidden margin is what the
//   town uses up over the trip, the loading and a small spare);
// - the grace (GRACE): a town whose supply has just fallen below "Enough" still reads as it did, and its growth goes
//   on as if the need were met at the line, for a couple of real minutes; a load landing in that time and nothing
//   was ever shown or counted.

import type { Product } from "./industry";
import type { Town } from "./settlements";
import { HOUR } from "./society";
import { SUPPLY_HOURS, demandPerDay, needsOf } from "./towns";

/** A need supplied this well lets the town grow (towns.ts growthPerDay: 80% of a day's needs and up): "Enough". */
export const ENOUGH = 0.8;
/** Hours of its own deliveries a town needs before its supply rolls on them, and the hours that stand for a full day. */
export const ROLL_MIN = 4, ROLL_FULL = 8;
/**
 * How long a town's supply may sit below "Enough" before its people notice (sim s: 3 game hours, two real minutes at
 * 1x): until then it shows as it did, and its growth, shrinking and the goals go on as if the need were met at the line.
 */
export const GRACE = 3 * HOUR;

/** A need of a town in its grace: since when, and the loads a day it read and its averages stood at just before. */
export interface Grace {
  at: number;
  /** loads a day it showed (what it still shows) */
  got: number;
  /** the two-day and last-day averages it is held at, at most the line: met at the line, no better than it was */
  rate: number;
  day: number;
}

type Hour = Partial<Record<Product, number>>;

/** Loads a day of a product the hours given stand for, with `now` landed in the hour under way (see deliveredLately). */
function shown(hours: readonly Hour[], now: number, yesterday: number, today: number, p: Product): number {
  if (hours.length < ROLL_MIN) return yesterday + today;
  // (fewer than a day of hours: they stand for the day, as in the sim)
  const day = (hs: readonly Hour[], extra: number) => {
    let n = extra;
    for (const h of hs) n += h[p] ?? 0;
    return n * (24 / Math.max(hs.length + (extra ? 1 : 0), ROLL_FULL));
  };
  return Math.max(day(hours, 0), now ? day(hours.slice(-23), now) : 0);
}

/**
 * Loads of a product a town has been getting a day, as landed: the hours its supply rolls on (settlements.ts hourly),
 * or, when it is more, the last day with the hour under way in place of its oldest hour, so a load shows the moment it
 * lands. A town with fewer than a few hours behind it goes on yesterday and today. (What the town shows is this, or
 * in its grace what it showed before: needs.ts loadsLately.)
 */
export function deliveredLately(t: Town, p: Product): number {
  return shown(t.hours ?? [], t.hourNow?.[p] ?? 0, t.yesterday[p] ?? 0, t.today[p] ?? 0, p);
}

/** The loads a day of a need at the "Enough" line. */
export const lineOf = (t: Town, p: Product): number => ENOUGH * demandPerDay(p, t.pop);

/**
 * Sim seconds until what a town has landed of a need would read below "Enough", with nothing more coming but the
 * loads `arriving` (sim time each lands, loads): 0 when it reads below already, Infinity when not within two days or
 * the town doesn't need it. The reading only falls as an hour rolls over and an old load leaves the window, so each
 * coming hour's roll is checked in turn. `frac` is the share of the hour under way already gone.
 */
export function dipIn(t: Town, p: Product, now: number, frac: number, arriving: readonly { at: number; n: number }[]): number {
  if (!needsOf(t.pop).includes(p)) return Infinity;
  const line = lineOf(t, p), hours = t.hours ?? [];
  if (line <= 0) return Infinity;
  if (deliveredLately(t, p) < line - 1e-9) return 0;
  // (a town with only a few hours behind it reads on yesterday and today: no rolling window to fall out of yet)
  if (hours.length < ROLL_MIN) return Infinity;
  // loads landing in each hour from the one under way (0) on
  const H = SUPPLY_HOURS, coming: number[] = [];
  const start = now - frac * HOUR;
  for (const a of arriving) {
    const k = Math.max(0, Math.floor((a.at - start) / HOUR));
    if (k < H) coming[k] = (coming[k] ?? 0) + a.n;
  }
  // the hours as they will be after each roll: the ones behind it, then the hour under way, then the hours to come
  const seq = hours.map((h) => h[p] ?? 0);
  seq.push((t.hourNow?.[p] ?? 0) + (coming[0] ?? 0));
  let sum = 0;
  for (const n of seq.slice(-H)) sum += n;
  for (let k = 1; k <= H; k++) {
    // just after the k-th roll, before anything lands in the new hour: its last SUPPLY_HOURS hours over the day
    const len = Math.min(H, seq.length);
    if ((sum * 24) / Math.max(len, ROLL_FULL) < line - 1e-9) return Math.max(0, (k - frac) * HOUR);
    seq.push(coming[k] ?? 0);
    sum += coming[k] ?? 0;
    if (seq.length > H) sum -= seq[seq.length - 1 - H];
  }
  return Infinity;
}

/**
 * The hour rolls over (settlements.ts hourly, after the town's hours have moved on): a need whose landed supply has
 * just gone from "Enough" or better to below it starts its grace, reading as it did; one whose grace has run out shows
 * the drop from now on; one back at the line is clear. `before` is what each need read, and `rate`/`day` what its
 * averages stood at, just before the roll. Then, for a need in its grace, the averages its growth, shrinking and the
 * goals go on (`rate`, the two-day one, and `lastDay`) are held at the line, never better than they were before it.
 */
export function rollGrace(
  t: Town, now: number, before: Partial<Record<Product, number>>, was: { rate: Hour; day: Hour }, rate: Hour, lastDay: Hour,
) {
  const g = (t.grace ??= {});
  for (const p of Object.keys(g) as Product[]) {
    // (out of time: the drop shows, and counts, from this hour on; never before it)
    if (now - g[p]!.at >= GRACE - 1e-6 || deliveredLately(t, p) >= lineOf(t, p) - 1e-9 || !needsOf(t.pop).includes(p)) delete g[p];
  }
  for (const p of needsOf(t.pop)) {
    if (g[p]) continue;
    const line = lineOf(t, p), b = before[p] ?? 0;
    if (b >= line - 1e-9 && deliveredLately(t, p) < line - 1e-9) {
      g[p] = { at: now, got: b, rate: Math.min(was.rate[p] ?? 0, line), day: Math.min(was.day[p] ?? 0, line) };
    }
  }
  for (const [p, x] of Object.entries(g) as [Product, Grace][]) {
    rate[p] = Math.max(rate[p] ?? 0, x.rate);
    lastDay[p] = Math.max(lastDay[p] ?? 0, x.day);
  }
  if (!Object.keys(g).length) delete t.grace;
}

/** A load landed: a need in its grace that is back at the line is clear, as if it had never dipped. */
export function landedGrace(t: Town, p: Product) {
  const g = t.grace;
  if (!g?.[p]) return;
  if (deliveredLately(t, p) >= lineOf(t, p) - 1e-9) delete g[p];
  if (!Object.keys(g).length) delete t.grace;
}
