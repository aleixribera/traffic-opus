// The towns' civic buildings (docs/design.md, "Town orders"): a schoolhouse, a church, a picture house... A town gets
// one when the company fills one of its orders (orders.ts), each once per town. Pure catalogue: the buildings, the
// town size each opens at, the lot it takes, what its order asks for and the small, lasting perk it gives its town.

import type { Product } from "./industry";

export type CivicKind =
  | "schoolhouse" | "church" | "bandstand" | "postoffice"
  | "firehall" | "library" | "watertower"
  | "picturehouse" | "countyhospital" | "ballpark"
  | "clocktower" | "markethall";

/** What a finished civic building does for its town, for good (modest on purpose: a nudge, not a landmark). */
export interface Perk {
  /** the town grows this much faster */
  growth?: number;
  /** its shops and offices buy this much more */
  demand?: number;
  /** land value added to the homes and shops round it, fading to nothing at LV_REACH */
  lv?: number;
}

export interface CivicDef {
  kind: CivicKind;
  name: string;
  /** the smallest town size that asks for it (0 Hamlet, 1 Village, 2 Town, 3 City) */
  size: number;
  /** its lot in zone cells (8 m): along the street, and deep */
  w: number;
  d: number;
  /**
   * A delivery order: the products it may ask for, in order of preference (only what the town buys at its size and
   * the company can bring is asked for). A "fair" building instead asks the town to be kept in plenty for some days.
   */
  wants: Product[];
  /** a fair: what its crowds eat and drink, and the event's name */
  fair?: { products: Product[]; event: string };
  perk: Perk;
  /** the perk in words, for the panels */
  perkText: string;
  blurb: string;
}

/** How far a civic building's land value reaches (m). */
export const LV_REACH = 260;

export const CIVICS: Record<CivicKind, CivicDef> = {
  schoolhouse: {
    kind: "schoolhouse", name: "Schoolhouse", size: 0, w: 3, d: 4, wants: ["planks", "food"],
    perk: { growth: 1.05 }, perkText: "Grows 5% faster",
    blurb: "A red clapboard schoolhouse with a bell cupola and a schoolyard.",
  },
  church: {
    kind: "church", name: "Church", size: 0, w: 3, d: 5, wants: ["planks", "cement", "food"],
    perk: { lv: 6 }, perkText: "Land value +6 nearby",
    blurb: "A white clapboard church with a tall spire and a little graveyard.",
  },
  bandstand: {
    kind: "bandstand", name: "Bandstand Green", size: 0, w: 4, d: 4, wants: ["food"],
    fair: { products: ["food", "milk"], event: "Fair" },
    perk: { lv: 5, growth: 1.02 }, perkText: "Land value +5 nearby, grows 2% faster",
    blurb: "A bandstand on a lawn with paths, benches and shade trees.",
  },
  postoffice: {
    kind: "postoffice", name: "Post Office", size: 0, w: 3, d: 3, wants: ["planks", "food", "goods"],
    perk: { demand: 1.04 }, perkText: "Shops buy 4% more",
    blurb: "A brick post office with limestone steps and a flag out front.",
  },
  firehall: {
    kind: "firehall", name: "Fire Hall", size: 1, w: 3, d: 4, wants: ["cement", "planks", "fuel"],
    perk: { lv: 5, growth: 1.02 }, perkText: "Land value +5 nearby, grows 2% faster",
    blurb: "A brick fire hall with two engine doors and a hose tower.",
  },
  library: {
    kind: "library", name: "Library", size: 1, w: 4, d: 4, wants: ["planks", "cement", "goods"],
    perk: { growth: 1.05 }, perkText: "Grows 5% faster",
    blurb: "A limestone library on a plinth, with a columned portico.",
  },
  watertower: {
    kind: "watertower", name: "Water Tower", size: 1, w: 3, d: 3, wants: ["cement", "planks", "machinery"],
    perk: { growth: 1.06 }, perkText: "Grows 6% faster",
    blurb: "A steel water tower on braced legs, with its pump house.",
  },
  picturehouse: {
    kind: "picturehouse", name: "Picture House", size: 2, w: 4, d: 4, wants: ["goods", "cement", "electronics"],
    perk: { demand: 1.06 }, perkText: "Shops buy 6% more",
    blurb: "A streamline picture house with a marquee and a tall blade sign.",
  },
  countyhospital: {
    kind: "countyhospital", name: "County Hospital", size: 2, w: 5, d: 5, wants: ["cement", "goods", "food", "machinery"],
    perk: { growth: 1.08 }, perkText: "Grows 8% faster",
    blurb: "A three-storey brick hospital round a front lawn.",
  },
  ballpark: {
    kind: "ballpark", name: "Ballpark", size: 2, w: 6, d: 5, wants: ["planks", "food"],
    fair: { products: ["food", "cheese", "milk"], event: "Opening Day" },
    perk: { lv: 7, demand: 1.03 }, perkText: "Land value +7 nearby, shops buy 3% more",
    blurb: "A wooden grandstand behind home plate, an outfield fence and light towers.",
  },
  clocktower: {
    kind: "clocktower", name: "County Courthouse", size: 3, w: 5, d: 5, wants: ["cement", "machinery", "electronics"],
    perk: { demand: 1.06, lv: 4 }, perkText: "Shops and offices buy 6% more, land value +4 nearby",
    blurb: "A limestone courthouse under a tall clock tower, on a lawn square.",
  },
  markethall: {
    kind: "markethall", name: "Market Hall", size: 3, w: 6, d: 5, wants: ["food", "goods", "cheese"],
    fair: { products: ["food", "milk", "cheese", "goods"], event: "Market Week" },
    perk: { demand: 1.08 }, perkText: "Shops buy 8% more",
    blurb: "An iron-and-glass market hall under a great vaulted roof.",
  },
};

export const CIVIC_KINDS = Object.keys(CIVICS) as CivicKind[];
export const isCivic = (k: string): k is CivicKind => k in CIVICS;
