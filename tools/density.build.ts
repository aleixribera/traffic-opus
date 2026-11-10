import { it } from "vitest";
import { Game } from "../src/game/city";
import { ZONE_GROUP } from "../src/game/growables";

it("measures", () => {
  const g = new Game(7);
  g.start();
  const t = g.towns.list[0];
  const out: string[] = [];
  for (const goal of [500, 2000, 6500, 10000]) {
    for (let d = 0; d < 200 && t.pop < goal; d++) g.fastForward(t.id, 24, 2);
    const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone);
    const homes = mine.filter((b) => ZONE_GROUP[b.zone!] === "res");
    const ds = homes.map((b) => Math.hypot(b.c.x - t.c.x, b.c.y - t.c.y)).sort((a, b) => a - b);
    const r90 = ds[Math.floor(ds.length * 0.9)] ?? 0, rmax = ds[ds.length - 1] ?? 0;
    const area = Math.PI * r90 * r90 / 1e6;
    const tiles = new Set(homes.map((b) => `${Math.floor(b.c.x / 200)},${Math.floor(b.c.y / 200)}`)).size * 0.04;
    const lots = mine.reduce((a, b) => a + 4 * b.hw * b.hd, 0);
    const kinds: Record<string, number> = {};
    for (const b of mine) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    const walls = mine.filter((b) => (b as { wall?: boolean }).wall).length;
    out.push(`goal ${goal} pop ${t.pop} size ${t.size} hh ${t.households} homes ${homes.length} shops ${mine.length - homes.length} walls ${walls} r90 ${r90.toFixed(0)} rmax ${rmax.toFixed(0)} reach ${t.reach.toFixed(0)} homes/km2 ${(homes.length / area).toFixed(0)} hh/km2 ${(t.households / area).toFixed(0)} m2/person ${(area * 1e6 / t.pop).toFixed(0)} lotcover ${(lots / (area * 1e6)).toFixed(2)} TILE homes/km2 ${(homes.length / tiles).toFixed(0)} m2/person ${(tiles * 1e6 / t.pop).toFixed(0)} day ${(g.time / 86400 * 1).toFixed(1)}`);
    out.push("  " + JSON.stringify(kinds));
  }
  process.stdout.write(out.join("\n") + "\n");
}, 3600000);
