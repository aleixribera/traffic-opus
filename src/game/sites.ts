// Industry sites (docs/design.md, "Industry sites"): every extractor and plant is a big fenced complex. Level 1 is
// the kind's own plant by the gate with its truck yard; levels 2-4 fill the plot with more buildings along
// internal service roads. This module is pure: the plot's layout comes from its size, its kind and a seed (the
// building id), so a site always looks the same, and the level rules are plain numbers.
//
// Site space: x runs along the gate side (the gate is x = 0), y runs from the gate (y = 0, on the fence) into the
// plot (y = d at the back fence). `siteFrame` maps it to the world.

import { add, fromAngle, right, scale, type V2 } from "../core/math";
import { mulberry32 } from "../core/noise";
import type { PlantKind } from "./industry";

/** Levels a site grows through. */
export const SITE_LEVELS = 4;
/** Output, jobs and trucks at each level, against level 1. */
export const LEVEL_MULT = [1, 2, 3, 4.5];
/** Roughly how much of the plot's building space each level fills. */
export const LEVEL_FILL = [0.2, 0.45, 0.7, 1];
/** Width of the gap in the fence at the gate (m). */
export const GATE_GAP = 14;
/** How far in front of the gate a road may run (from its edge) and still connect the site (m). */
export const GATE_REACH = 12;
/** The drive from the road to the gate on a site placed beside a road (m). */
export const GATE_SETBACK = 2.2;

/** Footprints of the models a site is built from: frontage (w) and depth (d), metres, as built in Blender. */
export const SITE_MODEL_SIZE: Record<string, [number, number]> = {
  site_truckyard: [44, 30], site_hall_l: [60, 34], site_hall_m: [40, 26], site_silos: [24, 22], site_tanks: [36, 24],
  site_office: [26, 18], site_workshop: [30, 22], site_field_g: [64, 64], site_field_w: [64, 64], site_barn: [30, 24],
  site_logyard: [40, 30], site_heap_ore: [30, 24], site_heap_coal: [30, 24], site_heap_lime: [30, 24],
  site_heap_sand: [30, 24], site_heap_cu: [30, 24],
  farm: [40, 40], loggingcamp: [36, 32], foodplant: [32, 30], sawmill: [40, 34], coalplant: [64, 52],
  ironmine: [38, 36], coalmine: [38, 36], quarry: [42, 40], smelter: [52, 44], cementworks: [48, 42],
  oilwell: [30, 30], sandpit: [40, 38], refinery: [60, 50], glassworks: [46, 38], furniture: [40, 34],
  constructionplant: [50, 42], coppermine: [44, 40], coppersmelter: [50, 42], electronics: [44, 36], machineworks: [52, 44],
};
/** Every model a site can use (the renderer loads them all). */
export const SITE_MODELS = Object.keys(SITE_MODEL_SIZE).filter((k) => k.startsWith("site_"));

/** What a kind's site is built from: its own model at the gate, and the modules that fill the rest (with repeats). */
const PLAN: Record<PlantKind, { core: string; mods: string[] }> = {
  farm: { core: "farm", mods: ["site_field_w", "site_field_g", "site_field_w", "site_barn", "site_field_g", "site_silos", "site_field_w", "site_field_g"] },
  loggingcamp: { core: "loggingcamp", mods: ["site_logyard", "site_logyard", "site_workshop", "site_logyard", "loggingcamp", "site_barn", "site_logyard"] },
  foodplant: { core: "foodplant", mods: ["site_hall_l", "site_silos", "site_hall_m", "site_tanks", "foodplant", "site_office", "site_silos"] },
  sawmill: { core: "sawmill", mods: ["site_logyard", "site_hall_l", "sawmill", "site_logyard", "site_workshop", "site_hall_m", "site_office"] },
  ironmine: { core: "ironmine", mods: ["site_heap_ore", "site_heap_ore", "site_workshop", "ironmine", "site_heap_ore", "site_office"] },
  coalmine: { core: "coalmine", mods: ["site_heap_coal", "site_heap_coal", "site_workshop", "coalmine", "site_heap_coal", "site_office"] },
  quarry: { core: "quarry", mods: ["site_heap_lime", "site_heap_lime", "quarry", "site_workshop", "site_heap_lime", "site_office"] },
  smelter: { core: "smelter", mods: ["site_hall_l", "site_heap_ore", "site_heap_coal", "smelter", "site_tanks", "site_office", "site_hall_m"] },
  cementworks: { core: "cementworks", mods: ["site_silos", "site_heap_lime", "site_silos", "cementworks", "site_heap_coal", "site_hall_m", "site_office"] },
  coalplant: { core: "coalplant", mods: ["site_heap_coal", "site_heap_coal", "site_tanks", "site_workshop", "site_heap_coal", "site_hall_m", "site_office"] },
  // tier 3: a field of pumpjacks and tanks; sand heaps by the pit; a tank farm round the refinery
  oilwell: { core: "oilwell", mods: ["oilwell", "site_tanks", "oilwell", "oilwell", "site_workshop", "oilwell", "site_tanks", "site_office"] },
  sandpit: { core: "sandpit", mods: ["site_heap_sand", "site_heap_sand", "sandpit", "site_workshop", "site_heap_sand", "site_office"] },
  refinery: { core: "refinery", mods: ["site_tanks", "site_tanks", "refinery", "site_tanks", "site_hall_m", "site_tanks", "site_office", "site_silos"] },
  glassworks: { core: "glassworks", mods: ["site_heap_sand", "site_hall_l", "site_heap_coal", "glassworks", "site_hall_m", "site_silos", "site_office"] },
  furniture: { core: "furniture", mods: ["site_logyard", "site_hall_l", "furniture", "site_hall_m", "site_workshop", "site_hall_l", "site_office"] },
  constructionplant: { core: "constructionplant", mods: ["site_hall_l", "site_silos", "constructionplant", "site_hall_l", "site_workshop", "site_office", "site_hall_m"] },
};

/** The model a kind's site is centred on (its core, by the gate). */
export const coreModel = (k: PlantKind): string => PLAN[k].core;

export interface SiteRoad { a: V2; b: V2; w: number }
export interface SiteSlot {
  model: string;
  /** the level it is built at (1: from the start) */
  level: number;
  /** centre, site space */
  x: number;
  y: number;
  /** unit, site space: where its front (and its apron) faces, toward an internal road */
  fx: number;
  fy: number;
  /** its model's frontage and depth */
  w: number;
  d: number;
  /** the kind's own plant (1) or the truck yard (2) */
  role?: "core" | "yard";
}
export interface SiteLayout { w: number; d: number; roads: SiteRoad[]; slots: SiteSlot[] }

const MARGIN = 7; // from the fence to the nearest building
const SPINE = 7; // service road widths
const BRANCH = 6;
const GAP = 6; // between buildings along a road
const SET = 2; // from a service road's edge to a building's front

/** Axis-aligned half extents of a slot in site space. */
export function slotHalf(s: SiteSlot): { hx: number; hy: number } {
  return Math.abs(s.fy) > 0.5 ? { hx: s.w / 2, hy: s.d / 2 } : { hx: s.d / 2, hy: s.w / 2 };
}

/**
 * The plan of a site: service roads from the gate, the core plant and truck yard by the gate, and rows of modules
 * along the roads, each with the level it is built at. Deterministic in (kind, w, d, seed).
 */
export function siteLayout(kind: PlantKind, w: number, d: number, seed: number): SiteLayout {
  const P = PLAN[kind];
  const rng = mulberry32((seed * 2654435761) ^ 0x5f3759df);
  const [cw, cd] = SITE_MODEL_SIZE[P.core];
  const [yw, yd] = SITE_MODEL_SIZE.site_truckyard;
  const out: SiteLayout = { w, d, roads: [], slots: [] };
  const flip = rng() < 0.5 ? -1 : 1; // which side of the spine the plant stands on
  // the core and the yard face the spine on either side of it, just inside the gate
  const coreZone = Math.max(cw, yw) + 4;
  const sideNeed = SPINE / 2 + SET + Math.max(cd, yd) + MARGIN;
  if (w / 2 < sideNeed || d < coreZone + MARGIN * 2) {
    // a plot too small for a complex (an old lot): the plant alone, facing the gate
    out.slots.push({ model: P.core, level: 1, x: 0, y: d / 2, fx: 0, fy: -1, w: cw, d: cd, role: "core" });
    return out;
  }
  const cx = SPINE / 2 + SET + cd / 2, yx = SPINE / 2 + SET + yd / 2;
  out.slots.push({ model: P.core, level: 1, x: -flip * cx, y: MARGIN + cw / 2, fx: flip, fy: 0, w: cw, d: cd, role: "core" });
  out.slots.push({ model: "site_truckyard", level: 1, x: flip * yx, y: MARGIN + yw / 2, fx: -flip, fy: 0, w: yw, d: yd, role: "yard" });
  let spineEnd = MARGIN + coreZone;
  // rows of modules either side of branch roads across the plot; the first branch runs just past the core and the
  // yard, with modules beside them too
  const rowD = Math.max(...P.mods.map((m) => SITE_MODEL_SIZE[m][1]));
  const minD = Math.min(...P.mods.map((m) => SITE_MODEL_SIZE[m][1]));
  const xMax = w / 2 - MARGIN;
  const x0 = SPINE / 2 + SET;
  const xCore = SPINE / 2 + SET + Math.max(cd, yd) + GAP;
  // the modules in a fixed shuffled order, taken in turn
  const deck = P.mods.slice();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  let next = 0;
  const take = (room: number, depth: number): string | null => {
    for (let k = 0; k < deck.length; k++) {
      const m = deck[(next + k) % deck.length];
      const [mw, md] = SITE_MODEL_SIZE[m];
      if (mw <= room && md <= depth) { next = (next + k + 1) % deck.length; return m; }
    }
    return null;
  };
  /** Pack one strip of modules facing a branch road at yRoad, on side sx of the spine, above (+1) or below (-1) it. */
  const strip = (yRoad: number, sx: number, sy: number, from: number, depth: number): number => {
    let at = from, far = 0;
    for (;;) {
      const m = take(xMax - at, depth);
      if (!m) break;
      const [mw, md] = SITE_MODEL_SIZE[m];
      out.slots.push({ model: m, level: 0, x: sx * (at + mw / 2), y: yRoad + sy * (BRANCH / 2 + SET + md / 2), fx: 0, fy: -sy, w: mw, d: md });
      far = at + mw;
      at += mw + GAP;
    }
    return far;
  };
  let yRoad = MARGIN + coreZone + SET + BRANCH / 2;
  for (let first = true; yRoad + BRANCH / 2 <= d - MARGIN; first = false) {
    let far = 0;
    for (const sx of [-1, 1]) far = Math.max(far, strip(yRoad, sx, -1, first ? xCore : x0, first ? coreZone : rowD));
    const above = Math.min(rowD, d - MARGIN - (yRoad + BRANCH / 2 + SET));
    if (above >= minD) for (const sx of [-1, 1]) far = Math.max(far, strip(yRoad, sx, 1, x0, above));
    if (far <= 0) break;
    out.roads.push({ a: { x: -far - 2, y: yRoad }, b: { x: far + 2, y: yRoad }, w: BRANCH });
    spineEnd = yRoad;
    if (above < rowD) break;
    yRoad += BRANCH + 2 * SET + 2 * rowD + GAP;
  }
  out.roads.unshift({ a: { x: 0, y: 0 }, b: { x: 0, y: spineEnd }, w: SPINE });
  assignLevels(out.slots);
  return out;
}

/** Nearest the gate first: level 1 fills a fifth of the building space, then 45%, 70% and the rest. */
function assignLevels(slots: SiteSlot[]) {
  const area = (s: SiteSlot) => s.w * s.d;
  const total = slots.reduce((n, s) => n + area(s), 0);
  const mods = slots.filter((s) => !s.role).sort((a, b) => a.y + Math.abs(a.x) * 0.7 - (b.y + Math.abs(b.x) * 0.7));
  let cum = slots.filter((s) => s.role).reduce((n, s) => n + area(s), 0);
  for (const s of mods) {
    cum += area(s);
    const f = cum / total;
    s.level = f <= LEVEL_FILL[0] + 0.02 ? 1 : f <= LEVEL_FILL[1] + 0.02 ? 2 : f <= LEVEL_FILL[2] + 0.02 ? 3 : 4;
  }
  // every level adds something you can see (when there are enough modules for it)
  for (let L = 2; L <= SITE_LEVELS; L++) {
    if (mods.some((s) => s.level === L)) continue;
    const donor = [...mods].reverse().find((s) => s.level > L && mods.filter((o) => o.level === s.level).length > 1)
      ?? mods.find((s) => s.level < L && s.level > 1 && mods.filter((o) => o.level === s.level).length > 1);
    if (donor) donor.level = L;
  }
}

/** Where a site sits in the world: its gate (on the fence), the way into the plot, and along its gate side. */
export interface SiteFrame { gate: V2; into: V2; along: V2 }

/** The frame of a site with this pose (the gate is the middle of the side facing -right(rot) * side). */
export function siteFrame(c: V2, rot: number, side: 1 | -1, hd: number): SiteFrame {
  const u = fromAngle(rot);
  const out = scale(right(u), -side);
  // ((rot, side) and (rot + PI, -side) are the same plot: the same frame, so a site never flips its layout when the
  // road at its gate is rebuilt the other way round)
  return { gate: add(c, scale(out, hd)), into: scale(out, -1), along: scale(u, side) };
}

/** Site space to world. */
export function siteToWorld(f: SiteFrame, x: number, y: number): V2 {
  return { x: f.gate.x + f.along.x * x + f.into.x * y, y: f.gate.y + f.along.y * x + f.into.y * y };
}

/** A site-space direction to world. */
export function siteDir(f: SiteFrame, x: number, y: number): V2 {
  return { x: f.along.x * x + f.into.x * y, y: f.along.y * x + f.into.y * y };
}

// ------------------------------------------------------------------ growth

/** Working time (s) near capacity a site needs to grow one level ("most of ~3 in-game days"). */
export const GROW_NEED = 960 * 2.4;
/** Idle time counts against it at this share (a site that stops for a while loses some of its progress). */
export const GROW_DECAY = 0.5;
/** How long the new buildings take to go up after a site grows (s): the construction animation. */
export const GROW_ANIM = 40;

/** Multiplier of output, jobs and trucks at a level. */
export const levelMult = (level: number): number => LEVEL_MULT[Math.max(1, Math.min(SITE_LEVELS, level)) - 1];
