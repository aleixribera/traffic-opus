// Roads join without cracks: where a road meets a junction its surface and pavement end exactly on the junction's
// mouth (straight or curving road), the junction's kerbs start and end there too, pieces of one road carrying on
// share their end, a shallow fork's gore is paved in one piece, a street ending at a site's gate runs into the yard
// (no turning bulb), and no tree stands on a road, its pavement or verge.

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { armMouth, type Arm } from "../src/roads/network";
import { Roads3D } from "../src/render/roads3d";
import { goreIslands } from "../src/render/gore";
import { CLEAR_RANGE, VERGE, clearShapes, crownCleared } from "../src/render/clearing";
import { ROAD_TYPES, SIDEWALK, roadGroup, roadWidth } from "../src/config";
import { add, dist, polyAt, polyClosest, polyDirSmooth, polygonContains, right, scale, type V2 } from "../src/core/math";

const game = () => {
  const g = new Game(7);
  g.unlockAll();
  g.money = 1e8;
  return g;
};
function lay(g: Game, a: V2, b: V2, mode: "straight" | "curve" = "straight", extra: object = {}) {
  const at = (p: V2): Snap => {
    const s = snap(g.net, p, { mpp: 0.4, level: 0, type: "street" });
    return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
  };
  const plan = planRoad(g.net, g.world, { start: at(a), end: at(b), mode, type: "street", ...extra });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}
const nodeNear = (g: Game, p: V2) => [...g.net.nodes.values()].sort((x, y) => dist(x.p, p) - dist(y.p, p))[0];

/** The road meshes as built (private to the renderer). */
type Built = { segs: Map<number, { surface: THREE.Mesh; extra: THREE.Mesh[] }>; nodes: Map<number, THREE.Mesh[]> };
function render(g: Game, gates?: () => { gate: V2; into: V2; front?: V2 }[]) {
  const r = new Roads3D(g.net, { props: new Map(), gates });
  r.rebuildAll();
  return { r, built: r as unknown as Built };
}
const xz = (pos: THREE.BufferAttribute, i: number): V2 => ({ x: pos.getX(i), y: pos.getZ(i) });

/** A road's surface at the end that meets this arm's node: its two corner vertices. */
function surfaceEnd(built: Built, arm: Arm): V2[] {
  const pos = built.segs.get(arm.seg)!.surface.geometry.getAttribute("position") as THREE.BufferAttribute;
  const n = pos.count / 2, i = arm.end === "a" ? 0 : n - 1;
  return [xz(pos, i * 2), xz(pos, i * 2 + 1)];
}

/** Every junction's mouths: the road's surface ends on them, and the kerbs either side start and end there. */
function expectSeamless(g: Game, built: Built, nid: number) {
  const ng = g.net.nodeGeom.get(nid)!, c = g.net.nodes.get(nid)!.p;
  expect(ng.kind).toBe("junction");
  ng.arms.forEach((A, i) => {
    const m = armMouth(c, A);
    const ends = surfaceEnd(built, A);
    // (the surface's left and right ends, in either order)
    const gap = Math.min(dist(ends[0], m.l) + dist(ends[1], m.r), dist(ends[0], m.r) + dist(ends[1], m.l));
    expect(gap).toBeLessThan(0.01);
    const B = ng.arms[(i + 1) % ng.arms.length], k = ng.kerbs[i];
    expect(dist(k[0], m.r)).toBeLessThan(1e-6);
    expect(dist(k[k.length - 1], armMouth(c, B).l)).toBeLessThan(1e-6);
    // the mouth is on the road's own centre line, square across it
    const sg = g.net.segGeom.get(A.seg)!, mid = add(scale(m.l, 0.5), scale(m.r, 0.5));
    expect(polyClosest(sg.center, mid).d).toBeLessThan(0.05);
  });
  // the pavement round each corner ends square across the mouths, on the line the road's own pavement ends on
  // (the first meshes after the junction surface: one per kerb, in kerb order)
  const walks = built.nodes.get(nid)!.filter((o) => o.geometry.getAttribute("color")).slice(0, ng.kerbs.length);
  expect(walks.length).toBe(ng.kerbs.length);
  walks.forEach((w, i) => {
    const pos = w.geometry.getAttribute("position") as THREE.BufferAttribute;
    const A = ng.arms[i], B = ng.arms[(i + 1) % ng.arms.length];
    const across = (arm: Arm, at: V2, v: V2) => {
      const d = arm.mouth?.dir ?? arm.dir;
      return Math.abs((v.x - at.x) * d.x + (v.y - at.y) * d.y);
    };
    for (let j = 0; j < 4; j++) expect(across(A, armMouth(c, A).r, xz(pos, j))).toBeLessThan(0.01);
    for (let j = pos.count - 4; j < pos.count; j++) expect(across(B, armMouth(c, B).l, xz(pos, j))).toBeLessThan(0.01);
  });
}

describe("Roads meet junctions without seams", () => {
  it("a T of two streets: the side road and the main road end exactly on the junction's mouths", () => {
    const g = game();
    lay(g, { x: -515, y: -90 }, { x: -485, y: 90 });
    lay(g, { x: -500, y: 0 }, { x: -420, y: 8 });
    const { built } = render(g);
    expectSeamless(g, built, nodeNear(g, { x: -500, y: 0 }).id);
  });

  it("a T on a curving road: the mouths sit on the curve, square across it, not on its tangent at the node", () => {
    const g = game();
    lay(g, { x: -420, y: 300 }, { x: -300, y: 430 }, "curve", { startTangent: { x: 1, y: 0 } });
    lay(g, { x: -340, y: 330 }, { x: -270, y: 270 });
    const n = nodeNear(g, { x: -340, y: 330 });
    const ng = g.net.nodeGeom.get(n.id)!;
    // (it really curves: the mouths are off the straight tangent line)
    expect(ng.arms.some((a) => a.mouth && dist(a.mouth.p, add(n.p, scale(a.dir, a.trim))) > 0.05)).toBe(true);
    const { built } = render(g);
    expectSeamless(g, built, n.id);
  });

  it("where a curving road carries on into its next piece, both pieces end on the same two points", () => {
    const g = game();
    lay(g, { x: -420, y: 300 }, { x: -300, y: 430 }, "curve", { startTangent: { x: 1, y: 0 } });
    lay(g, { x: -340, y: 330 }, { x: -270, y: 270 });
    const { built } = render(g);
    let checked = 0;
    for (const [id, ng] of g.net.nodeGeom) {
      if (ng.kind !== "cont" || ng.arms.length !== 2) continue;
      const [A, B] = ng.arms, ea = surfaceEnd(built, A), eb = surfaceEnd(built, B);
      expect(Math.min(dist(ea[0], eb[0]) + dist(ea[1], eb[1]), dist(ea[0], eb[1]) + dist(ea[1], eb[0]))).toBeLessThan(1e-3);
      checked++;
      void id;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a shallow Y fork: seamless mouths, and the gore between the branches paved in one piece out to where their pavements part", () => {
    const g = game();
    lay(g, { x: 560, y: -90 }, { x: 500, y: 0 });
    lay(g, { x: 500, y: 0 }, { x: 445, y: 83 });
    lay(g, { x: 500, y: 0 }, { x: 405, y: 56 });
    const n = nodeNear(g, { x: 500, y: 0 });
    const { built } = render(g);
    expectSeamless(g, built, n.id);
    const isl = goreIslands(g.net, n.id);
    expect(isl.length).toBe(1);
    // the island covers the ground between the two branches' edges until the gap is two pavements wide
    const ng = g.net.nodeGeom.get(n.id)!;
    const branches = ng.arms.filter((a) => a.trim > 10);
    expect(branches.length).toBe(2);
    const walk = SIDEWALK[roadGroup(ROAD_TYPES.street)], halfW = roadWidth(ROAD_TYPES.street) / 2;
    const [P, Q] = branches.map((a) => {
      const sg = g.net.segGeom.get(a.seg)!;
      return (t: number) => polyAt(sg.center, a.end === "a" ? sg.trimA + t : sg.center.length - sg.trimB - t);
    });
    let inside = 0;
    for (let t = 0; t < 40; t += 0.25) {
      const p = P(t), q = Q(t), gap = dist(p, q) - 2 * halfW;
      if (gap <= 0.5 || gap >= 2 * walk - 0.5) continue;
      expect(polygonContains(isl[0], add(scale(p, 0.5), scale(q, 0.5)))).toBe(true);
      inside++;
    }
    expect(inside).toBeGreaterThan(3);
    // and a plain T has none (its pavements part at the corners)
    const t = game();
    lay(t, { x: -515, y: -90 }, { x: -485, y: 90 });
    lay(t, { x: -500, y: 0 }, { x: -420, y: 8 });
    expect(goreIslands(t.net, nodeNear(t, { x: -500, y: 0 }).id)).toEqual([]);
  });

  it("only a road's real end gets a turning bulb", () => {
    const g = game();
    lay(g, { x: -515, y: -90 }, { x: -485, y: 90 });
    lay(g, { x: -500, y: 0 }, { x: -420, y: 8 });
    for (const [id, ng] of g.net.nodeGeom) {
      if (g.net.segsAt(id).length >= 2) expect(ng.kind).not.toBe("end");
    }
  });
});

describe("A street ending at a site's gate runs into the yard", () => {
  it("no turning bulb: the yard's concrete carries out of the gate to the street, and a bulb again once the site goes", () => {
    const g = game();
    lay(g, { x: 1000, y: 250 }, { x: 1120, y: 300 });
    const end = nodeNear(g, { x: 1120, y: 300 });
    const ng = g.net.nodeGeom.get(end.id)!;
    expect(ng.kind).toBe("end");
    const out = scale(ng.arms[0].dir, -1); // from the street's end on toward the gate
    let gates: { gate: V2; into: V2 }[] = [{ gate: add(end.p, scale(out, 7)), into: out }];
    const { r, built } = render(g, () => gates);
    const drawn = built.nodes.get(end.id)!;
    expect(drawn.length).toBe(1);
    const geo = drawn[0].geometry;
    geo.computeBoundingBox();
    // it reaches from the street's end to inside the gate, and it isn't the bulb (round, centred behind the end)
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const pts = Array.from({ length: pos.count }, (_, i) => xz(pos, i));
    expect(Math.max(...pts.map((p) => (p.x - end.p.x) * out.x + (p.y - end.p.y) * out.y))).toBeGreaterThan(7.4);
    // a site somewhere else: the street's end keeps its bulb
    gates = [{ gate: add(end.p, scale(right(out), 40)), into: out }];
    r.refreshGates();
    const bulb = built.nodes.get(end.id)!;
    expect(bulb.length).toBeGreaterThan(1);
  });
});

describe("No trees on roads", () => {
  it("no crown reaches a street, its pavements or its verge, whichever way it runs; past that, trees may stand", () => {
    const g = game();
    lay(g, { x: -515, y: -90 }, { x: -485, y: 90 });
    lay(g, { x: -500, y: 0 }, { x: -420, y: 8 });
    lay(g, { x: -420, y: 300 }, { x: -300, y: 430 }, "curve", { startTangent: { x: 1, y: 0 } });
    const shapes = clearShapes(g.net, g.buildings.list);
    const halfW = roadWidth(ROAD_TYPES.street) / 2, walk = SIDEWALK[roadGroup(ROAD_TYPES.street)];
    for (const [, sg] of g.net.segGeom) {
      for (let s = 0; s <= sg.center.length; s += 3) {
        const p = polyAt(sg.center, s), lat = right(polyDirSmooth(sg.center, s, 0.5));
        for (const side of [-1, 1]) {
          for (const r of [1.1, 2.4, CLEAR_RANGE - 0.2]) {
            // a crown whose edge would touch the verge's outer edge or anything nearer is gone
            const at = add(p, scale(lat, side * (halfW + walk + VERGE + r - 0.05)));
            expect(crownCleared(shapes, at, r)).toBe(true);
          }
        }
      }
    }
    // far from any road, a tree stands
    expect(crownCleared(shapes, { x: -700, y: -300 }, CLEAR_RANGE)).toBe(false);
  });

  it("a road built through an existing forest clears it too, and the clearing goes when the road does", () => {
    const g = game();
    lay(g, { x: 1000, y: 250 }, { x: 1120, y: 300 });
    const mid = { x: 1060, y: 275 };
    expect(crownCleared(clearShapes(g.net, g.buildings.list), mid, 1.1)).toBe(true);
    g.undo();
    expect(crownCleared(clearShapes(g.net, g.buildings.list), mid, 1.1)).toBe(false);
  });
});
