// Drawing a road to or from a company site connects it at its gate: a point picked anywhere over the site snaps to its
// way in (never a road through its yard), the chip names the site, and a gate facing away says where the gate is
// instead of refusing with "Building in the way".

import { describe, expect, it } from "vitest";
import { add, dist, rectDistance, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import { chainPoints, planRoad, snap, type SnapOpts } from "../src/roads/planner";
import { toolSnap } from "../src/roads/snapping";
import { siteFrame } from "../src/game/sites";
import { road } from "./helpers";

function openSpot(g: Game): V2 {
  for (let r = 400; r < 4000; r += 150) for (let k = 0; k < 24; k++) {
    const p = v2(Math.cos((k / 24) * 6.283) * r, Math.sin((k / 24) * 6.283) * r);
    if (g.placedPlan("foodplant", p, { down: { x: 0, y: 1 } })?.ok) return p;
  }
  throw new Error("no open ground");
}

const opts = (g: Game, from?: V2): SnapOpts => ({ mpp: 0.5, level: 0, type: "street", sites: g.buildings.siteTargets(), from: from ? { p: from } : undefined });

describe("roads to and from a company site", () => {
  it("connects at the gate wherever over the site it is picked, and names the site", () => {
    const g = new Game(7);
    const b = g.place("foodplant", openSpot(g), { down: { x: 0, y: 1 } })!;
    expect(b.access).toBeNull();
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    expect(f.into.y).toBeCloseTo(-1); // gate on the +y side
    const c = b.c, hw = b.hw, hd = b.hd;
    // a junction just off the site's back corner (the gate faces away from it), as in the owner's report...
    const J = v2(c.x - hw - 40, c.y - hd - 30);
    road(g, add(J, v2(-200, 0)), add(J, v2(200, 0)));
    road(g, J, add(J, v2(0, -200)));
    // ...and one out in front of the gate
    const K = v2(c.x + 100, c.y + hd + 60);
    road(g, v2(c.x - 300, K.y), v2(c.x + 300, K.y));
    road(g, K, add(K, v2(0, 200)));
    const jn = snap(g.net, J, opts(g)), kn = snap(g.net, K, opts(g));
    expect(g.net.segsAt(jn.node!).length).toBe(3);
    expect(g.net.segsAt(kn.node!).length).toBe(3);

    // picked inside the yard, by its back corner: the start is the ground just outside its gate
    const raw = v2(c.x - hw + 20, c.y - hd + 20);
    const s = snap(g.net, raw, opts(g));
    expect(s.site?.id).toBe(b.id);
    expect(dist(s.p, add(f.gate, v2(0, 7)))).toBeLessThan(0.01);
    expect(s.label).toBe("Connects to Food Plant");
    // the road tool's snap (with its hysteresis) agrees
    expect(toolSnap(g.net, raw, { ...opts(g), prev: null }).site?.id).toBe(b.id);

    // to the junction behind it: not "Building in the way" over the whole site, but where its gate is
    const back = planRoad(g.net, g.world, { start: s, end: snap(g.net, J, opts(g, s.p)), mode: "straight", type: "street" });
    expect(back.errors.length).toBeGreaterThan(0);
    expect(back.errors[0].msg).toMatch(/Food Plant's gate faces the other way/);
    expect(dist(back.errors[0].p, f.gate)).toBeLessThan(0.01);
    expect(back.errors.some((e) => e.buildings?.includes(b.id))).toBe(false);
    expect(back.connects).toBe("Connects to Food Plant");

    // to the junction in front: fine, never through its yard, and it connects
    const end = snap(g.net, K, opts(g, s.p));
    const front = planRoad(g.net, g.world, { start: s, end, mode: "straight", type: "street" });
    expect(front.errors).toEqual([]);
    expect(front.connects).toBe("Connects to Food Plant");
    for (const st of front.strokes) for (const q of chainPoints(st.chain, 1)) expect(rectDistance(q, c, hw, hd, b.rot)).toBeGreaterThan(5);
    expect(g.build(front)).toBe(true);
    expect(b.access).not.toBeNull();

    // the other way round (drawn to the site), and now it has its street: onto that street's end, still named
    const again = snap(g.net, v2(c.x, c.y), opts(g, K));
    expect(again.site?.id).toBe(b.id);
    expect(again.node).toBeDefined();
    expect(g.net.segsAt(again.node!).length).toBe(1);
    expect(dist(again.p, f.gate)).toBeLessThan(16);
    const P = v2(c.x - 200, c.y + hd + 140);
    const to = planRoad(g.net, g.world, { start: { p: P, h: 0, guides: [] }, end: again, mode: "straight", type: "street" });
    expect(to.errors).toEqual([]);
    expect(to.connects).toBe("Connects to Food Plant");
  });

  it("still refuses a road through another site", () => {
    const g = new Game(7);
    const b = g.place("foodplant", openSpot(g), { down: { x: 0, y: 1 } })!;
    const c = b.c;
    const cut = planRoad(g.net, g.world, { start: { p: v2(c.x - b.hw - 100, c.y), h: 0, guides: [] }, end: { p: v2(c.x + b.hw + 100, c.y), h: 0, guides: [] }, mode: "straight", type: "street" });
    expect(cut.errors.some((e) => e.msg === "Building in the way" && e.buildings?.includes(b.id))).toBe(true);
  });
});
