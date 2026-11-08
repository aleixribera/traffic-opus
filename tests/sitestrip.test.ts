// Company sites stand behind the same front strip as a town's homes and shops (config ZONE_SETBACK), so the road at
// their gate can be widened without moving them: the wider road takes the strip, and the drive to the gate shortens
// (or stretches again on a downgrade). A site put down before its road is set back when a road arrives alongside its
// gate, and an old save's site hugging its road is pushed back on an upgrade when there is room (else the upgrade
// names it).

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES, ROAD_TYPES, ZONE_SETBACK, roadWidth, type RoadTypeId } from "../src/config";
import { add, dist, rectDistance, scale, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { siteFrame } from "../src/game/sites";
import { road } from "./helpers";

/** How close road `seg`'s centreline comes to a building's fence (m), every metre or so along it. */
function fenceGap(g: Game, b: Building, seg: number): number {
  const pts = g.net.segGeom.get(seg)!.center.pts;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1])));
    for (let k = 0; k <= n; k++) {
      const p = v2(pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / n, pts[i].y + ((pts[i + 1].y - pts[i].y) * k) / n);
      best = Math.min(best, rectDistance(p, b.c, b.hw, b.hd, b.rot));
    }
  }
  return best;
}

/** How far a site's drive starts from its road's centreline (its kerb point: half the road's width). */
const kerbGap = (g: Game, b: Building) => {
  const g0 = g.net.segGeom.get(b.access!.seg)!;
  let best = Infinity;
  for (const p of g0.center.pts) best = Math.min(best, dist(p, b.front));
  // (the centreline's points are metres apart: measure across to the nearest piece of it)
  const pts = g0.center.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], e = pts[i + 1], L2 = (e.x - a.x) ** 2 + (e.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((b.front.x - a.x) * (e.x - a.x) + (b.front.y - a.y) * (e.y - a.y)) / L2));
    best = Math.min(best, dist(b.front, v2(a.x + (e.x - a.x) * t, a.y + (e.y - a.y) * t)));
  }
  return best;
};

/** Open, dry, flat ground with room for a food plant and a 500 m street past it. */
function openGround(g: Game): V2 {
  for (let r = 500; r < 5000; r += 150) for (let k = 0; k < 24; k++) {
    const p = v2(Math.cos((k / 24) * 6.283) * r, Math.sin((k / 24) * 6.283) * r);
    let ok = true;
    for (let x = -260; x <= 260 && ok; x += 20) for (let y = -200; y <= 200 && ok; y += 20) {
      const q = v2(p.x + x, p.y + y);
      ok = g.world.inBounds(q) && !g.world.isWater(q) && !g.world.isMountain(q);
    }
    if (ok && g.buildings.list.every((b) => dist(b.c, p) > 400) && [...g.net.nodes.values()].every((n) => dist(n.p, p) > 400)) return p;
  }
  throw new Error("no open ground");
}

/** The one road segment that runs past p (the street the test laid). */
const segPast = (g: Game, p: V2) => [...g.net.segs.keys()].sort((a, b) => fenceGapPt(g, a, p) - fenceGapPt(g, b, p))[0];
const fenceGapPt = (g: Game, id: number, p: V2) => Math.min(...g.net.segGeom.get(id)!.center.pts.map((q) => dist(q, p)));

function upgradeTo(g: Game, seg: number, to: RoadTypeId) {
  const u = g.upgradePlan(seg, to);
  expect(u.errors.map((e) => e.msg), `to ${to}`).toEqual([]);
  expect(u.moves, `to ${to}: no site has to move`).toEqual([]);
  expect(g.upgrade(seg, to)).toBe(true);
}

describe("company sites stand behind the front strip", () => {
  it("placed beside a street: the street becomes an avenue, a divided avenue, back to a street and a boulevard, with the site where it was", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e8;
    const p = openGround(g);
    road(g, v2(p.x - 250, p.y), v2(p.x + 250, p.y));
    const seg = segPast(g, p);
    const b = g.place("foodplant", v2(p.x, p.y + 45))!;
    expect(b, "placed beside the street").toBeTruthy();
    expect(b.access?.seg).toBe(seg);
    // its fence stands behind the strip, its drive running from the kerb to the gate
    expect(fenceGap(g, b, seg)).toBeGreaterThan(ZONE_SETBACK - 0.05);
    expect(kerbGap(g, b)).toBeCloseTo(roadWidth(ROAD_TYPES.street) / 2, 0);
    const c = { ...b.c }, rot = b.rot;
    for (const to of ["avenue", "avenueM", "street", "boulevard"] as const) {
      upgradeTo(g, seg, to);
      expect(dist(b.c, c), `to ${to}: the site stays put`).toBeLessThan(0.01);
      expect(b.rot).toBe(rot);
      // the road's surface never reaches the fence
      expect(fenceGap(g, b, seg)).toBeGreaterThan(roadWidth(ROAD_TYPES[to]) / 2);
      if (!ROAD_TYPES[to].allowsAccess) continue;
      // the drive starts at the new kerb: shorter on the wider road, longer again on the street
      expect(b.access?.seg, `to ${to}`).toBe(seg);
      expect(kerbGap(g, b), `to ${to}`).toBeCloseTo(roadWidth(ROAD_TYPES[to]) / 2, 0);
    }
  });

  it("put down before its road: a street drawn close past its gate sets it back behind the strip, and that street then widens freely", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e8;
    const p = openGround(g);
    const b = g.place("foodplant", p, { down: { x: 0, y: -1 } })!;
    expect(b).toBeTruthy();
    expect(b.access).toBeNull();
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const out = scale(f.into, -1);
    // a street 6.5 m out from the fence, along it: closer than the strip
    const at = (o: number, k: number) => add(add(f.gate, scale(out, o)), scale(f.along, k));
    road(g, at(6.5, -250), at(6.5, 250));
    expect(b.access).not.toBeNull();
    const seg = b.access!.seg;
    expect(fenceGap(g, b, seg)).toBeGreaterThan(ZONE_SETBACK - 0.05);
    for (const to of ["avenue", "avenueM"] as const) upgradeTo(g, seg, to);
    expect(fenceGap(g, b, seg)).toBeGreaterThan(ZONE_SETBACK - 0.05);
  });

  it("turned by the player with its gate on a street close by: it stands back behind the strip, connected", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e8;
    const p = openGround(g);
    road(g, v2(p.x - 250, p.y), v2(p.x + 250, p.y));
    const seg = segPast(g, p);
    const hd = BUILDING_TYPES.foodplant.d / 2;
    // the gate toward the street (at lower y), the fence 7 m from its centreline
    const rot = [0, Math.PI].find((r) => siteFrame(p, r, 1, hd).into.y > 0)!;
    const b = g.place("foodplant", v2(p.x, p.y + 7 + hd), { rot })!;
    expect(b).toBeTruthy();
    expect(b.access?.seg).toBe(seg);
    expect(fenceGap(g, b, seg)).toBeGreaterThan(ZONE_SETBACK - 0.05);
    upgradeTo(g, seg, "avenueM");
  });

  it("undoing the street that set a site back puts the site back where it was put down", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e8;
    const p = openGround(g);
    const b = g.place("foodplant", p, { down: { x: 0, y: -1 } })!;
    const c0 = { ...b.c };
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const at = (o: number, k: number) => add(add(f.gate, scale(f.into, -o)), scale(f.along, k));
    road(g, at(6.5, -250), at(6.5, 250));
    expect(dist(b.c, c0)).toBeGreaterThan(4);
    g.undo();
    expect(dist(b.c, c0)).toBeLessThan(0.01);
    expect(b.access).toBeNull();
  });

  it("an old save's site hugging its street: an upgrade pushes it back behind the strip, or names it when it can't move", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e8;
    const p = openGround(g);
    road(g, v2(p.x - 250, p.y), v2(p.x + 250, p.y));
    const seg = segPast(g, p);
    const b = g.place("foodplant", v2(p.x, p.y + 45))!;
    // as an old save had it: the fence 2.2 m off the kerb
    const pull = fenceGap(g, b, seg) - (roadWidth(ROAD_TYPES.street) / 2 + 2.2);
    const toward = scale(siteFrame(b.c, b.rot, b.side, b.hd).into, -1);
    b.c = add(b.c, scale(toward, pull));
    g.buildings.version++;
    expect(fenceGap(g, b, seg)).toBeCloseTo(roadWidth(ROAD_TYPES.street) / 2 + 2.2, 1);
    // room behind it: the upgrade moves it back, to the strip
    const u = g.upgradePlan(seg, "avenueM");
    expect(u.errors.map((e) => e.msg)).toEqual([]);
    expect(u.moves.map((m) => m.id)).toEqual([b.id]);
    expect(g.upgrade(seg, "avenueM")).toBe(true);
    expect(fenceGap(g, b, seg)).toBeGreaterThan(ZONE_SETBACK - 0.05);
    // no room behind it (another site right at its back fence): the upgrade is refused, and says which site
    const h = new Game(7);
    (h as { money: number }).money = 1e8;
    road(h, v2(p.x - 250, p.y), v2(p.x + 250, p.y));
    const s2 = segPast(h, p);
    const a = h.place("foodplant", v2(p.x, p.y + 45))!;
    a.c = add(a.c, scale(scale(siteFrame(a.c, a.rot, a.side, a.hd).into, -1), fenceGap(h, a, s2) - (roadWidth(ROAD_TYPES.street) / 2 + 2.2)));
    h.buildings.version++;
    const into = siteFrame(a.c, a.rot, a.side, a.hd).into;
    const back = h.place("foodplant", add(a.c, scale(into, a.hd * 2 + 1.5)), { rot: a.rot + Math.PI })!;
    expect(back, "a second site right behind it").toBeTruthy();
    const v = h.upgradePlan(s2, "avenueM");
    expect(v.errors.map((e) => e.msg)).toContain("Food Plant in the way");
  });
});
