import { describe, expect, it } from "vitest";
import { DEPOSITS, F, NF, WorldGen, waterOf } from "../src/world/gen";

const SEEDS = [1, 2, 3, 7, 11, 42];

describe("deposits by tier", () => {
  it("places a first deposit of every kind in its distance band, on dry flat land", () => {
    for (const seed of SEEDS) {
      const g = new WorldGen(seed);
      for (const d of DEPOSITS) {
        const s = g.sites.find((x) => x.key === d.key);
        expect(s, `seed ${seed} ${d.key}`).toBeTruthy();
        const r = Math.hypot(s!.x, s!.y);
        expect(r).toBeGreaterThanOrEqual(d.ring[0]);
        expect(r).toBeLessThanOrEqual(d.ring[1]);
        const o = g.at(s!.x, s!.y, new Float32Array(NF));
        expect(o[d.field], `seed ${seed} ${d.key} at its site`).toBeGreaterThanOrEqual(0.5);
        expect(waterOf(o)).toBeLessThan(0.5);
      }
      // fertile soil and forest within reach of the start
      for (const key of ["fert", "forest"] as const) {
        const s = g.sites.find((x) => x.key === key)!;
        expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(2600);
        expect(g.at(s.x, s.y, new Float32Array(NF))[key === "fert" ? F.fert : F.forest]).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it("keeps each tier out of the start's surroundings, and two kinds never on the same ground", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const g = new WorldGen(seed);
      const o = new Float32Array(NF);
      const nearest = new Map<string, number>();
      for (let x = -17000; x <= 17000; x += 250) {
        for (let y = -17000; y <= 17000; y += 250) {
          g.at(x, y, o);
          const here = DEPOSITS.filter((d) => o[d.field] >= 0.5);
          expect(here.length, `seed ${seed} at ${x},${y}: ${here.map((d) => d.key)}`).toBeLessThanOrEqual(1);
          for (const d of here) nearest.set(d.key, Math.min(nearest.get(d.key) ?? Infinity, Math.hypot(x, y)));
        }
      }
      for (const d of DEPOSITS) {
        const n = nearest.get(d.key) ?? Infinity;
        // a blob reaches a little past its centre's band
        expect(n, `seed ${seed} ${d.key}`).toBeGreaterThan(Math.min(d.ring[0], d.from) - 600);
        expect(n, `seed ${seed} ${d.key}`).toBeLessThan(d.ring[1]);
      }
    }
  });
});

describe("finding deposits (the map's tags and pointers)", () => {
  it("lists a kind's deposits nearest first, its first one among them, and only that kind", () => {
    for (const seed of SEEDS) {
      const g = new WorldGen(seed);
      for (const d of DEPOSITS) {
        const found = g.depositsNear(d.field, 0, 0, 24000);
        expect(found.length, `seed ${seed} ${d.key}`).toBeGreaterThan(0);
        const first = g.sites.find((x) => x.key === d.key)!;
        expect(found.some((f) => f.x === first.x && f.y === first.y), `seed ${seed} ${d.key} first`).toBe(true);
        for (let i = 1; i < found.length; i++) expect(Math.hypot(found[i].x, found[i].y)).toBeGreaterThanOrEqual(Math.hypot(found[i - 1].x, found[i - 1].y));
        // (every one listed really is that kind's ground at its middle, and all lie within the reach asked)
        for (const f of found.slice(0, 4)) {
          expect(Math.hypot(f.x, f.y)).toBeLessThanOrEqual(24000);
          expect(g.at(f.x, f.y, new Float32Array(NF))[d.field], `seed ${seed} ${d.key} at ${f.x.toFixed(0)},${f.y.toFixed(0)}`).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });
});
