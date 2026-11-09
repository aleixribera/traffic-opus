// Laying a street in a big town re-tests only the zone cells the edit can reach, with what it knows about the rest
// cached (src/game/zones.ts). That must give exactly the zone map the full re-test gives: a shadow map in exact mode,
// fed the same road edits, has to agree cell for cell as a town grows from a hamlet into a town.

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { ZoneMap } from "../src/game/zones";
import { gridPt, sizeOf } from "../src/game/towns";
import { road } from "./helpers";

function attachShadow(g: Game) {
  const shadow = new ZoneMap(g.net, (g.zones as unknown as { world: ConstructorParameters<typeof ZoneMap>[1] }).world, true);
  shadow.rebuildAll();
  const z = g.zones;
  const on = z.onNetworkChange.bind(z), all = z.rebuildAll.bind(z);
  z.onNetworkChange = (cs) => { on(cs); shadow.onNetworkChange(cs); };
  z.rebuildAll = () => { all(); shadow.rebuildAll(); };
  return shadow;
}

/** Cells that differ between the two maps (where they stand, and whether they are usable). */
function diff(a: ZoneMap, b: ZoneMap): string[] {
  const out: string[] = [];
  for (const [k, x] of a.blocks) {
    const y = b.blocks.get(k);
    if (!y) { out.push(`block ${k} only in the cached map`); continue; }
    if (x.cols !== y.cols) { out.push(`block ${k}: ${x.cols} vs ${y.cols} columns`); continue; }
    x.cells.forEach((c, i) => {
      const d = y.cells[i];
      if (Math.abs(c.c.x - d.c.x) > 1e-6 || Math.abs(c.c.y - d.c.y) > 1e-6) out.push(`${k}#${i} moved`);
      else if (c.ok !== d.ok) out.push(`${k}#${i} ok ${c.ok} vs ${d.ok}`);
    });
  }
  for (const k of b.blocks.keys()) if (!a.blocks.has(k)) out.push(`block ${k} only in the exact map`);
  return out;
}

describe("zone cells re-tested only near a road edit", () => {
  it("agree with the full re-test, cell for cell, as a town grows into a town", () => {
    const g = new Game(7);
    const shadow = attachShadow(g);
    g.start();
    const t = g.towns.list[0];
    let checks = 0;
    for (let d = 0; d < 40 && sizeOf(t.pop) < 2; d++) {
      g.fastForward(t.id, 24);
      // (every cell usable or not alike too, whatever order the blocks were laid in: zones.ts revalidate)
      expect(diff(g.zones, shadow).slice(0, 8), `day ${d}`).toEqual([]);
      checks++;
    }
    expect(sizeOf(t.pop)).toBeGreaterThanOrEqual(2);
    expect(checks).toBeGreaterThan(5);
  }, 300_000);

  it("agree after the player's own edits: a road through the town, then taken away again", () => {
    const g = new Game(7);
    const shadow = attachShadow(g);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 8; d++) g.fastForward(t.id, 24);
    // an avenue straight across the town between its streets (away from its square), and a street across that
    const at = (i: number, j: number) => gridPt(t.c, t.ang, i, j);
    road(g, at(-3.5, -0.45 * t.sq[1]), at(3.5, -0.45 * t.sq[1]), "avenue");
    expect(diff(g.zones, shadow)).toEqual([]);
    road(g, at(2.5, -3), at(2.5, 3));
    expect(diff(g.zones, shadow)).toEqual([]);
    g.undo();
    expect(diff(g.zones, shadow)).toEqual([]);
    g.undo();
    expect(diff(g.zones, shadow)).toEqual([]);
    g.redo();
    expect(diff(g.zones, shadow)).toEqual([]);
    // a road alongside the town's outermost street, touching nothing: only that street's deepest cells change
    let jMin = 0, iLo = 0, iHi = 0;
    for (const k of t.built) for (const n of k.split("|")) { const [, j] = n.split(",").map(Number); jMin = Math.min(jMin, j); }
    for (const k of t.built) {
      const [p, q] = k.split("|").map((n) => n.split(",").map(Number));
      if (p[1] === jMin && q[1] === jMin) { iLo = Math.min(iLo, p[0], q[0]); iHi = Math.max(iHi, p[0], q[0]); }
    }
    const okBefore = [...g.zones.allCells()].filter((c) => c.ok).length;
    road(g, at(iLo + 0.2, jMin - 0.45), at(iHi - 0.2, jMin - 0.45));
    expect(diff(g.zones, shadow)).toEqual([]);
    g.undo();
    expect(diff(g.zones, shadow)).toEqual([]);
    expect([...g.zones.allCells()].filter((c) => c.ok).length).toBe(okBefore);
  }, 300_000);
});
