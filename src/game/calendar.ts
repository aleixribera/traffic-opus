// Seasons (docs/design.md, "Seasons"): a game year of four game days, one a season, so a play session sees the
// harvest come and go. The towns eat the same all year; the farms don't grow the same all year: crops come in as an
// autumn surge after a lean winter and spring, and the logging camps fell most in winter, when the ground is hard.
// The swing eases smoothly through the year and its year-round average is exactly 1, so a site's output over a whole year, and with
// it the money and the balance, is what it was before seasons: only its timing changes. Warehouses buffer the
// harvest for the lean months; a chain without one sees its plants run dry in spring and its yards fill in autumn.
// Pure functions of the sim clock: nothing to save.

import { DAY, START_HOUR } from "./society";

/** Game days in a year: one per season. */
export const YEAR_DAYS = 4;
/** Sim seconds in a year. */
export const YEAR = YEAR_DAYS * DAY;

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
export const SEASON_NAME: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

/**
 * How a kind's output swings through the year: its pace in the middle of each season (spring, summer, autumn,
 * winter) against its year-round average. Between the middles it eases from one to the next, so the four values
 * average to 1 and so does the year. Farms bring the harvest in in autumn and grow little in winter; logging
 * camps fell most in winter, on hard ground, and least in summer.
 */
export const SEASONAL: Record<string, [number, number, number, number]> = {
  farm: [0.85, 1.05, 1.6, 0.5],
  loggingcamp: [0.9, 0.75, 1.0, 1.35],
};

/** Where in the year a sim time falls, 0..1 (day 1 at dawn is the start of spring). */
export function yearPhase(t: number): number {
  // (the clock starts at START_HOUR on day 1: count the year from that day's midnight, so a season is a calendar day)
  const s = t + (START_HOUR / 24) * DAY;
  return (((s / YEAR) % 1) + 1) % 1;
}

/** The season at a sim time. */
export function seasonOf(t: number): Season {
  return SEASONS[Math.min(3, Math.floor(yearPhase(t) * 4))];
}

/** How far through its season a sim time is, 0..1. */
export function seasonPart(t: number): number {
  const q = yearPhase(t) * 4;
  return q - Math.floor(q);
}

/** A kind's pace at a sim time against its year-round average (1 for kinds without seasons). */
export function seasonMult(kind: string, t: number): number {
  const S = SEASONAL[kind];
  if (!S) return 1;
  // (eased between the seasons' middles: a cosine step from one to the next, whose mean is theirs)
  const q = yearPhase(t) * 4 - 0.5;
  const k = Math.floor(q), f = q - k;
  const a = S[((k % 4) + 4) % 4], b = S[(((k + 1) % 4) + 4) % 4];
  const w = (1 - Math.cos(Math.PI * f)) / 2;
  return a + (b - a) * w;
}

/** A kind's average pace over a season (for the panels: "autumn 150%"). */
export function seasonAvg(kind: string, s: Season): number {
  if (!SEASONAL[kind]) return 1;
  const i = SEASONS.indexOf(s), N = 48;
  let sum = 0;
  for (let k = 0; k < N; k++) sum += seasonMult(kind, ((i + (k + 0.5) / N) / 4) * YEAR - (START_HOUR / 24) * DAY);
  return sum / N;
}
