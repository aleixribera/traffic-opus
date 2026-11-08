// A site's fleet comes with its level, with nothing to buy (owner, 2026-11-08: "I should not be micromanaging").
// At every level it must carry the site's whole output over a reasonable haul (FLEET_HAUL), on the real traffic sim.

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { FLEET_HAUL, Industry, PLANTS, PLANT_KINDS } from "../src/game/industry";
import { levelMult, SITE_LEVELS } from "../src/game/sites";
import { v2, type V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import { layRoad, placeAlong } from "./helpers";

describe("fleets sized by site level", () => {
  it("every site kind runs at least its kind's least, more at every level, and a power plant none", () => {
    for (const k of PLANT_KINDS) {
      const d = PLANTS[k];
      if (d.trucks <= 0) { expect(Industry.fleetAt(k, 1)).toBe(0); continue; }
      // (a warehouse runs a fixed fleet: it is one building and doesn't grow)
      if (d.logistics) { expect(Industry.fleetAt(k, 1)).toBe(d.trucks); continue; }
      let last = 0;
      for (let L = 1; L <= SITE_LEVELS; L++) {
        const n = Industry.fleetAt(k, L);
        expect(n).toBeGreaterThanOrEqual(d.trucks);
        expect(n).toBeGreaterThanOrEqual(last);
        last = n;
      }
      expect(Industry.fleetAt(k, SITE_LEVELS)).toBeGreaterThan(Industry.fleetAt(k, 1));
      // a poorer deposit makes less, so it needs no more trucks than a full one
      expect(Industry.fleetAt(k, 1, 0.5)).toBeLessThanOrEqual(Industry.fleetAt(k, 1));
    }
  });

  it(`carries a farm's whole output ${FLEET_HAUL / 1000} km down a street, at level 1 and at level 4`, () => {
    for (const level of [1, SITE_LEVELS]) {
      const g = new Game(7);
      // a straight street FLEET_HAUL long with a farm on fertile soil at one end and a food plant at the other
      let farm: Building | null = null, fp: Building | null = null;
      for (let k = 0; k < 24 && !farm; k++) {
        const a0 = (k / 24) * 6.283;
        for (let r = 300; r < 2500 && !farm; r += 200) {
          const a = v2(Math.cos(a0) * r, Math.sin(a0) * r);
          if (!g.placedPlan("farm", a)?.ok) continue;
          const dir = v2(Math.cos(a0 + 1.2), Math.sin(a0 + 1.2));
          const b: V2 = v2(a.x + dir.x * (FLEET_HAUL + 150), a.y + dir.y * (FLEET_HAUL + 150));
          const s = v2(a.x - dir.x * 60, a.y - dir.y * 60);
          if (typeof layRoad(g, s, b) === "string") continue;
          try {
            farm = placeAlong(g, "farm", s, b, 35);
            fp = placeAlong(g, "foodplant", b, s, 35);
          } catch { farm = fp = null; g.undo(); }
        }
      }
      expect(farm && fp).toBeTruthy();
      expect(!!farm!.access && !!fp!.access).toBe(true);
      const P = farm!.plant!;
      P.level = level;
      P.yld = 1;
      farm!.built = fp!.built = 1;
      // (a food plant big enough to take it all in: one that small would turn trucks away with its yard spoken for)
      fp!.plant!.level = level;
      const fleet = g.industry.trucksOf(farm!);
      expect(fleet).toBe(Industry.fleetAt("farm", level));
      // its output at this level, fully staffed (loads a second), and the loads the food plant takes in
      const rate = levelMult(level) / PLANTS.farm.cycle;
      let got = 0, counting = false;
      const ind = g.industry as unknown as { deliver: (to: Building, p: string, n: number, from?: Building) => void };
      const deliver = ind.deliver.bind(ind);
      ind.deliver = (to, p, n, from) => { if (counting && to === fp && from === farm) got += n; deliver(to, p, n, from); };
      // the yard always full and the food plant always taking (the farm making more than its fleet carries would
      // pile up; here everything it could make is waiting), and nothing else on the farm's mind
      const keep = () => { P.out.crops = Industry.storeOf(farm!); fp!.plant!.stock = {}; P.prog = 0; };
      const step = (s: number) => { for (let i = 0; i < s * 30; i++) { if (i % 15 === 0) keep(); g.step(1 / 30); } };
      // once the first trucks are back the fleet is in its stride; then count a long stretch
      const trip = (2 * FLEET_HAUL) / 11.8;
      step(trip + 60);
      counting = true;
      const window = 900;
      step(window);
      // (at least what the site makes: a light truck with the base load, on the real roads and junctions)
      expect(got).toBeGreaterThanOrEqual(Math.floor(rate * window * 0.95));
    }
  }, 600000);
});
