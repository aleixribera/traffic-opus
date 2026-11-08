// The player's company: its name and its herald (a Deco badge in two period colours). Generated at a new game from
// the world seed (on its own generator, so it never shifts the game's random draws), editable, and saved.

import { mulberry32 } from "../core/noise";
import { companyName } from "./names";

/** The period palette heralds are painted from. */
export const HERALD_COLORS = {
  navy: "#1f2d4a",
  ochre: "#c8952e",
  brick: "#9a3a2a",
  cream: "#efe5c9",
  forest: "#2d4c35",
} as const;
export type HeraldColor = keyof typeof HERALD_COLORS;
export const HERALD_SHAPES = ["shield", "roundel", "wings", "lozenge"] as const;
export type HeraldShape = (typeof HERALD_SHAPES)[number];

/** Field and ink pairs that read: a dark field with a light emblem, or the other way round. */
export const HERALD_PAIRS: readonly [HeraldColor, HeraldColor][] = [
  ["navy", "ochre"], ["navy", "cream"], ["brick", "cream"], ["forest", "ochre"],
  ["forest", "cream"], ["ochre", "navy"], ["cream", "brick"], ["brick", "ochre"],
];

export interface Herald { shape: HeraldShape; field: HeraldColor; ink: HeraldColor }
export interface Company { name: string; herald: Herald }

export const COMPANY_NAME_MAX = 32;

export function randomHerald(r: () => number): Herald {
  const shape = HERALD_SHAPES[Math.floor(r() * HERALD_SHAPES.length)];
  const [field, ink] = HERALD_PAIRS[Math.floor(r() * HERALD_PAIRS.length)];
  return { shape, field, ink };
}

/** A new game's company, from its seed. */
export function makeCompany(seed: number): Company {
  const r = mulberry32(seed * 2654435 + 977);
  return { name: companyName(r), herald: randomHerald(r) };
}

/** A company from a save (or none, in saves from before companies had names): always a valid one. */
export function loadCompany(data: unknown, seed: number): Company {
  const made = makeCompany(seed);
  const d = data as Partial<Company> | undefined;
  if (!d || typeof d !== "object") return made;
  const name = typeof d.name === "string" && d.name.trim() ? cleanName(d.name) : made.name;
  const h = d.herald as Partial<Herald> | undefined;
  const ok = (c: unknown): c is HeraldColor => typeof c === "string" && c in HERALD_COLORS;
  const herald: Herald = h && HERALD_SHAPES.includes(h.shape as HeraldShape) && ok(h.field) && ok(h.ink) && h.field !== h.ink
    ? { shape: h.shape as HeraldShape, field: h.field, ink: h.ink }
    : made.herald;
  return { name, herald };
}

/** A name as typed, tidied: trimmed, single spaces, not too long. */
export function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, COMPANY_NAME_MAX);
}

/** Words a monogram skips: the trade, not the name. */
const TRADE_WORDS = new Set([
  "and", "sons", "brothers", "co", "co.", "company", "freight", "haulage", "hauling", "motor", "transfer", "transport",
  "trucking", "truck", "lines", "express", "cartage", "iron", "rail", "steel", "coal", "coke", "works", "mining",
  "lumber", "oil", "the", "of", "inc", "inc.", "ltd", "corp", "corp.",
]);

/** The herald's monogram: one or two initials from the name's own words ("Great Western Freight Co." -> "GW"). */
export function monogram(name: string): string {
  const words = name.split(/[\s&\-,]+/).filter((w) => /[A-Za-z]/.test(w));
  const own = words.filter((w) => !TRADE_WORDS.has(w.toLowerCase()));
  const use = (own.length ? own : words).slice(0, 2);
  const s = use.map((w) => w.match(/[A-Za-z]/)![0].toUpperCase()).join("");
  return s || "K";
}
