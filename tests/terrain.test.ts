// The terrain answers "water?" and "mountain?" from a cached bound on the field nodes round a point where it can
// (src/world/terrain.ts, hint). The answers must be exactly the spline's, shores and slopes included.

import { describe, expect, it } from "vitest";
import { F, MOUNTAIN_STEPS, Terrain } from "../src/world/terrain";
import { mulberry32 } from "../src/core/noise";

describe("terrain water and mountain tests", () => {
  it("give exactly the spline's answer everywhere, on open land, shores and mountainsides", () => {
    for (const seed of [7, 11]) {
      const t = new Terrain(seed);
      const raw = new Terrain(seed);
      const rnd = mulberry32(seed);
      let water = 0, mtn = 0, c = { x: 0, y: 0 };
      // clusters of points round places spread over 40 km (a chunk of field each)
      for (let k = 0; k < 60000; k++) {
        if (k % 1500 === 0) c = { x: (rnd() - 0.5) * 40000, y: (rnd() - 0.5) * 40000 };
        const p = { x: c.x + (rnd() - 0.5) * 1000, y: c.y + (rnd() - 0.5) * 1000 };
        const w = raw.water(p) >= 0.5, m = raw.sample(F.mtn, p.x, p.y) >= MOUNTAIN_STEPS[0];
        if (w) water++;
        if (m) mtn++;
        expect(t.isWater(p), `water at ${p.x},${p.y}`).toBe(w);
        expect(t.isMountain(p), `mountain at ${p.x},${p.y}`).toBe(m);
      }
      // (the sample reaches both kinds of ground, so the shores and slopes are in it)
      expect(water).toBeGreaterThan(50);
      expect(mtn).toBeGreaterThan(50);
    }
  });
});
