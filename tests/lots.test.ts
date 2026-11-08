// A building's lot records the zone block and columns it stands on, and redevelopment works along a block by column.
// A town's own new junctions split its streets and lay their blocks out afresh, shifting the columns: every lot has to
// follow, or redevelopment reads past a block's end (it crashed a City this way).

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { DEPTH } from "../src/game/zones";

/** Buildings whose recorded lot is not where their cells say they stand. */
function stale(g: Game): number[] {
  const out: number[] = [];
  for (const b of g.buildings.list) {
    if (!b.lot) continue;
    const blk = g.zones.blocks.get(b.lot.block);
    const fits = !!blk && b.lot.col0 + b.lot.w <= blk.cols;
    const mine = fits && [b.lot.col0, b.lot.col0 + b.lot.w - 1].every((k) => blk!.cells[k * DEPTH].lot === b.id);
    if (!mine) out.push(b.id);
  }
  return out;
}

describe("lots follow their street when it is laid out again", () => {
  it("every lot matches the cells its building stands on as a town grows", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    let lots = 0;
    for (let d = 0; d < 10; d++) {
      g.fastForward(t.id, 24);
      expect(stale(g), `day ${d}`).toEqual([]);
      lots = g.buildings.list.filter((b) => b.lot).length;
    }
    expect(lots).toBeGreaterThan(100);
  }, 300_000);

  it("and after a save is loaded", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 5; d++) g.fastForward(t.id, 24);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(stale(h)).toEqual([]);
  }, 300_000);
});
