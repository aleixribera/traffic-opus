// The "Industry Booming America" names: American town names (deterministic per seed, unique in a world, short
// enough for a map label) and the player's company, its name and herald, saved and loaded.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mulberry32 } from "../src/core/noise";
import { Game } from "../src/game/city";
import { HERALD_COLORS, HERALD_SHAPES, loadCompany, makeCompany, monogram } from "../src/game/company";
import { companyName, townName, TOWN_NAME_MAX } from "../src/game/names";
import { Saves } from "../src/game/saves";

const names = (seed: number, n: number) => {
  const r = mulberry32(seed), taken = new Set<string>(), out: string[] = [];
  for (let i = 0; i < n; i++) { const t = townName(r, taken); taken.add(t); out.push(t); }
  return out;
};

describe("town names", () => {
  it("are the same for the same seed, and differ between seeds", () => {
    expect(names(11, 30)).toEqual(names(11, 30));
    expect(names(11, 30)).not.toEqual(names(12, 30));
  });

  it("never repeat in a world, and fit a map label", () => {
    for (const seed of [1, 7, 42, 999]) {
      const l = names(seed, 400);
      expect(new Set(l).size).toBe(l.length);
      for (const n of l) {
        expect(n.length).toBeLessThanOrEqual(TOWN_NAME_MAX);
        expect(n).toMatch(/^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)*$/);
      }
    }
  });

  it("borrow no famous city whole", () => {
    const l = new Set(names(5, 2000));
    for (const n of ["Springfield", "Fort Worth", "Jacksonville", "Pittsburgh", "Chicago", "Detroit", "New York", "Rockford"]) expect(l.has(n)).toBe(false);
  });

  it("take exactly two draws from the game's generator (the rest of a seeded game runs as before)", () => {
    let n = 0;
    const base = mulberry32(3);
    townName(() => { n++; return base(); });
    expect(n).toBe(2);
  });

  it("a game names its towns the same way every time from its seed, all different", () => {
    const found = (seed: number) => {
      const g = new Game(seed);
      g.start();
      const c = g.towns.list[0].c;
      for (const [dx, dy] of [[-2600, 0], [2600, -1500], [0, 2800], [-2400, -2600], [2800, 1800]]) {
        for (let k = 0; k < 6; k++) if (typeof g.towns.found({ x: c.x + dx + k * 220, y: c.y + dy + k * 150 }) !== "string") break;
      }
      return g.towns.list.map((t) => t.name);
    };
    const a = found(7);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(found(7)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("the company", () => {
  it("gets a period name and a herald from the seed", () => {
    expect(makeCompany(7)).toEqual(makeCompany(7));
    const seen = new Set<string>();
    for (let s = 1; s < 200; s++) {
      const c = makeCompany(s);
      seen.add(c.name);
      expect(c.name.length).toBeLessThanOrEqual(30);
      expect(HERALD_SHAPES).toContain(c.herald.shape);
      expect(c.herald.field in HERALD_COLORS && c.herald.ink in HERALD_COLORS).toBe(true);
      expect(c.herald.field).not.toBe(c.herald.ink);
    }
    expect(seen.size).toBeGreaterThan(120);
    expect(companyName(mulberry32(1))).toMatch(/\S/);
  });

  it("monograms take the name's own words, not the trade", () => {
    expect(monogram("Great Western Freight Co.")).toBe("GW");
    expect(monogram("Carver & Sons Haulage")).toBe("C");
    expect(monogram("Halston Iron & Rail")).toBe("H");
    expect(monogram("Tri-State Motor Freight")).toBe("TS");
    expect(monogram("Freight")).toBe("F");
    expect(monogram("  ")).toBe("K");
  });

  it("an edited name and herald save and load back", () => {
    const g = new Game(7);
    g.start();
    g.company = { name: "Carver & Sons Haulage", herald: { shape: "wings", field: "forest", ink: "cream" } };
    const back = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(back.company).toEqual(g.company);
  });

  it("saves from before companies had names get one from their seed; broken ones are repaired", () => {
    const g = new Game(9);
    g.start();
    const data = JSON.parse(JSON.stringify(g.serialize()));
    delete data.company;
    expect(Game.load(data).company).toEqual(makeCompany(9));
    expect(loadCompany({ name: "  Ox  Hauling ", herald: { shape: "blob", field: "navy", ink: "navy" } }, 9))
      .toEqual({ name: "Ox Hauling", herald: makeCompany(9).herald });
    expect(loadCompany({ name: "", herald: { shape: "roundel", field: "brick", ink: "cream" } }, 9))
      .toEqual({ name: makeCompany(9).name, herald: { shape: "roundel", field: "brick", ink: "cream" } });
  });
});

describe("the saves list", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

  it("shows whose company each save is", () => {
    const g = new Game(7);
    g.start();
    g.company = { name: "Halston Iron & Rail", herald: { shape: "lozenge", field: "brick", ink: "ochre" } };
    const m = new Saves().save(g, "Mine");
    expect(m?.company).toEqual(g.company);
    expect(new Saves().list()[0].company?.name).toBe("Halston Iron & Rail");
  });
});
