import * as THREE from "three";
import { LANE_W, ROAD_TYPES, SHOULDER, SIDEWALK, STREET_TREES, isHighway, roadGroup, roadWidth } from "../config";
import { clamp, dist, dot, norm, polyAt, polyClosest, polyDir, right, smoothstep, sub, type Polyline, type V2 } from "../core/math";
import type { ChangeSet, RoadNetwork } from "../roads/network";
import { ringsNear } from "../roads/planner";
import { dkey } from "../sim/router";
import type { Traffic } from "../sim/traffic";
import { PAL } from "./palette";

const LIFT = 0.06;
const DECK = 0.9;

/** Shared road surface material: Lambert (so it takes shadows) with markings drawn in the fragment shader. */
export function makeRoadMaterial(opts: { color?: number; opacity?: number; markings?: boolean; arrows?: boolean; highway?: boolean } = {}) {
  const hw = !!opts.highway;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 });
  const uniforms = {
    uRoad: { value: new THREE.Color(opts.color ?? (hw ? PAL.hwRoad : PAL.road)) },
    uEdge: { value: new THREE.Color(hw ? PAL.hwEdge : PAL.roadEdge) },
    uLane: { value: new THREE.Color(hw ? PAL.hwLane : PAL.lane) },
    uHw: { value: hw ? 1 : 0 },
    uCentre: { value: new THREE.Color(PAL.centre) },
    uGrass: { value: new THREE.Color(PAL.grass) },
    uTree: { value: new THREE.Color(PAL.tree) },
    uTreeLight: { value: new THREE.Color(PAL.treeLight) },
    uFlowMode: { value: 0 },
    uMarkings: { value: opts.markings === false ? 0 : 1 },
    uArrows: { value: opts.arrows === false ? 0 : 1 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aRoad;\nattribute vec2 aFlow;\nattribute vec3 aMed;\nattribute vec2 aClip;\nvarying vec4 vRoad;\nvarying vec2 vFlow;\nvarying vec3 vMed;\nvarying vec2 vClip;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoad = aRoad;\nvFlow = aFlow;\nvMed = aMed;\nvClip = aClip;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uRoad; uniform vec3 uEdge; uniform vec3 uLane; uniform vec3 uCentre;
uniform vec3 uGrass; uniform vec3 uTree; uniform vec3 uTreeLight;
uniform float uFlowMode; uniform float uMarkings; uniform float uArrows; uniform float uHw;
varying vec4 vRoad; varying vec2 vFlow; varying vec3 vMed; varying vec2 vClip;
float band(float x, float w) { float f = fwidth(x) * 0.8 + 1e-4; return 1.0 - smoothstep(w - f, w + f, abs(x)); }
vec3 flowTint(float r) {
  float k = clamp((0.92 - r) / 0.6, 0.0, 1.0);
  return mix(vec3(1.0), mix(vec3(1.0, 0.62, 0.28), vec3(0.86, 0.13, 0.16), smoothstep(0.35, 1.0, k)), smoothstep(0.0, 0.25, k));
}
vec3 covTint(float r) {
  // service coverage: uncovered roads go grey, covered ones green, deeper the better served
  return r <= 0.01 ? vec3(0.78, 0.78, 0.8) : mix(vec3(0.72, 0.95, 0.62), vec3(0.22, 0.72, 0.36), clamp((r - 0.4) / 0.6, 0.0, 1.0));
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float u = vRoad.x, v = vRoad.y, f = vRoad.z, b = vRoad.w;
  vec3 c = uRoad;
  if (f >= 0.0 && uMarkings > 0.5) {
    float LW = ${LANE_W.toFixed(2)};
    float med = vMed.x * 0.5; // half the median: both directions start this far out
    float halfW = (f + b) * LW * 0.5 + ${SHOULDER.toFixed(2)} + med;
    // where a taper pulls the surface in on this side, the edge band and line follow it in
    // (by the distance in from each side's own edge: a deep taper pulls one edge right past the centreline)
    float de = min(halfW - vClip.y - u, u + halfW - vClip.x);
    float edge = smoothstep(0.42, 0.42 + fwidth(u), de);
    float dash = step(fract(v / 9.0), 0.5);
    float lanes = 0.0;
    if (b > 0.0) {
      // centre line: a dashed single line on small streets, a solid double line on bigger roads
      if (med <= 0.0) {
        if (max(f, b) < 1.5) c = mix(c, uCentre, band(u, 0.12) * step(fract(v / 6.0), 0.6));
        else c = mix(c, uCentre, band(abs(u) - 0.2, 0.09));
      }
      for (int k = 1; k < 4; k++) {
        float fk = float(k);
        if (fk < f) lanes = max(lanes, band(u - med - fk * LW, 0.08) * dash);
        if (fk < b) lanes = max(lanes, band(u + med + fk * LW, 0.08) * dash);
      }
    } else {
      for (int k = 1; k < 4; k++) {
        float fk = float(k);
        if (fk < f) lanes = max(lanes, band(u - (-f * 0.5 * LW + fk * LW), 0.08) * dash);
      }
      // one-way: chevrons down each lane, pointing the way traffic goes
      float y = mod(v, 22.0) - 11.0;
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        if (fk >= f || uArrows < 0.5) break;
        float x = u - (-f * 0.5 * LW + (fk + 0.5) * LW);
        float ax = abs(x);
        float m = (1.0 - smoothstep(0.95, 1.05, ax));
        lanes = max(lanes, band(y + ax * 0.9 - 0.6, 0.22) * m);
        lanes = max(lanes, band(y + ax * 0.9 + 0.5, 0.22) * m);
      }
    }
    // highways: a solid white line along each edge, just inside the shoulder
    if (uHw > 0.5) lanes = max(lanes, band(de - ${SHOULDER.toFixed(2)} - 0.05, 0.11));
    c = mix(c, uLane, lanes);
    if (uFlowMode > 0.5) {
      float r = (b > 0.0 && u < 0.0) ? vFlow.y : vFlow.x;
      c *= uFlowMode > 1.5 ? covTint(r) : flowTint(r);
    }
    if (med > 0.0) {
      // planted median: a kerb either side, grass between, and a row of trees when it is wide enough
      // it stops short of a junction in a rounded nose (vMed.y: distance to the nearer junction end)
      float dn = vMed.y - 2.2;
      float mh = dn >= med ? med : (dn <= 0.0 ? 0.0 : sqrt(med * med - (med - dn) * (med - dn)));
      float au = abs(u), fw = fwidth(u) + 1e-4;
      float inMed = 1.0 - smoothstep(mh - fw, mh, au);
      vec3 mc = mix(uEdge, uGrass, 1.0 - smoothstep(mh - 0.32 - fw, mh - 0.32, au));
      // trees keep clear of the piece ends (vMed.z) so a crown is never cut in half at a join
      if (med > 1.4 && dn > med + 2.0 && vMed.z > 2.6) {
        float y = mod(v, 12.0) - 6.0;
        float rr = min(med - 0.25, 2.4);
        float d = length(vec2(u, y));
        float crown = 1.0 - smoothstep(rr - fwidth(d) - 0.04, rr, d);
        float lit = 1.0 - smoothstep(0.0, rr * 1.3, length(vec2(u + rr * 0.35, y + rr * 0.35)));
        mc = mix(mc, mix(uTree, uTreeLight, lit), crown);
      }
      c = mix(c, mc, inMed);
    }
    c = mix(uEdge, c, edge);
  }
  diffuseColor.rgb *= c;
}`,
      );
  };
  return { mat, uniforms };
}

interface SegMeshes {
  surface: THREE.Mesh;
  extra: THREE.Object3D[];
  flow: THREE.BufferAttribute;
}

export class Roads3D {
  readonly group = new THREE.Group();
  private segs = new Map<number, SegMeshes>();
  private nodes = new Map<number, THREE.Object3D[]>();
  private bendFlow = new Map<number, { flow: THREE.BufferAttribute; k1: number; k2: number }>(); // bend node -> overlay tint source
  readonly surface = makeRoadMaterial();
  private ringSurface = makeRoadMaterial({ arrows: false }); // roundabout arcs and bends: direction is obvious, chevrons only clip at the joins
  private plain = makeRoadMaterial({ markings: false });
  private hwSurface = makeRoadMaterial({ highway: true });
  private hwRing = makeRoadMaterial({ highway: true, arrows: false });
  private hwPlain = makeRoadMaterial({ highway: true, markings: false });
  private edgeMat = new THREE.MeshLambertMaterial({ color: PAL.roadEdge });
  private walkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private seamHw = seamMaterial(PAL.hwRoad, PAL.hwLane);
  private seamTown = seamMaterial(PAL.road, PAL.lane);
  // street trees: flat round crowns, darker rim and a lit side, one instanced mesh for the whole map
  private trees: THREE.InstancedMesh;
  private treeSpots = new Map<number, { x: number; y: number; h: number; r: number }[]>();
  private hwEdgeMat = new THREE.MeshLambertMaterial({ color: PAL.hwEdge });
  /** Every marked surface material, so overlay modes reach all of them. */
  private get marked() { return [this.surface, this.ringSurface, this.hwSurface, this.hwRing]; }
  /** Pavement width round a junction or bend: the narrowest of its roads', none if any road there has none. */
  private nodeWalk(id: number): number {
    const at = this.net.segsAt(id);
    if (!at.length || at.some((sg) => sg.ring)) return 0;
    return Math.min(...at.map((sg) => SIDEWALK[roadGroup(ROAD_TYPES[sg.type])]));
  }
  /** Is every road meeting this node a highway (so its junction or bend is drawn in highway asphalt)? */
  private hwNode(id: number): boolean {
    const at = this.net.segsAt(id);
    return at.length > 0 && at.every((sg) => isHighway(ROAD_TYPES[sg.type]));
  }
  // the deck body casts the bridge's shadow from both faces (three's default only draws back faces into the shadow map)
  private deckMat = new THREE.MeshLambertMaterial({ color: PAL.deckSide, shadowSide: THREE.DoubleSide });
  private pillarMat = new THREE.MeshLambertMaterial({ color: PAL.pillar });
  private pillarGeo = new THREE.CylinderGeometry(0.9, 1.1, 1, 10).translate(0, 0.5, 0);
  // signal heads drawn as coloured dots at the stop line
  private lights: THREE.InstancedMesh;
  private lightRefs: { node: number; arm: number; x: number; y: number; h: number }[] = [];
  // grass islands inside roundabouts
  private islands = new THREE.Group();
  private islandMat = new THREE.MeshLambertMaterial({ color: PAL.grass });

  constructor(private net: RoadNetwork) {
    this.lights = new THREE.InstancedMesh(new THREE.CircleGeometry(0.85, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), 256);
    this.lights.count = 0;
    this.lights.renderOrder = 3;
    this.lights.frustumCulled = false; // instances move around the whole map; bounds would go stale
    this.trees = this.makeTrees(0);
    this.group.add(this.lights, this.islands, this.trees);
  }

  private makeTrees(n: number): THREE.InstancedMesh {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const uni = { uTree: { value: new THREE.Color(PAL.tree) }, uTreeLight: { value: new THREE.Color(PAL.treeLight) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vTq;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTq = position.xz * 2.0;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uTree; uniform vec3 uTreeLight;\nvarying vec2 vTq;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  float d = length(vTq);
  if (d > 1.0) discard;
  float lit = 1.0 - smoothstep(0.0, 1.3, length(vTq + vec2(0.35, 0.35)));
  vec3 c = mix(uTree, uTreeLight, lit);
  c *= mix(1.0, 0.86, smoothstep(0.82, 0.98, d));
  diffuseColor.rgb *= c;
}`,
        );
    };
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, Math.max(1, n));
    m.count = 0;
    m.frustumCulled = false; // spread over the whole map; bounds would go stale
    m.receiveShadow = true;
    return m;
  }

  /** A street tree stands only where its crown keeps off every other road (a road drawn alongside, a crossing street). */
  private treeClear(own: number, t: { x: number; y: number; r: number }): boolean {
    const reach = t.r + 12;
    for (const id of this.net.segsNear(t.x - reach, t.y - reach, t.x + reach, t.y + reach)) {
      if (id === own) continue;
      const s = this.net.segs.get(id), g = this.net.segGeom.get(id);
      if (!s || !g) continue;
      if (polyClosest(g.center, t).d < roadWidth(ROAD_TYPES[s.type]) / 2 + t.r * 0.8) return false;
    }
    return true;
  }

  /** Gather every seg's street trees into the one instanced mesh. */
  private collectTrees() {
    let n = 0;
    for (const t of this.treeSpots.values()) n += t.length;
    if (n > this.trees.instanceMatrix.count) {
      this.group.remove(this.trees);
      this.trees.geometry.dispose();
      (this.trees.material as THREE.Material).dispose();
      this.trees.dispose();
      this.trees = this.makeTrees(Math.ceil(n * 1.5) + 64);
      this.group.add(this.trees);
    }
    let i = 0;
    for (const [sid, spots] of this.treeSpots) {
      for (const t of spots) {
        if (!this.treeClear(sid, t)) continue;
        // (a hair apart in height so crowns that touch never flicker)
        this.tmpM.makeScale(t.r * 2, 1, t.r * 2).setPosition(t.x, t.h + LIFT + 0.03 + (i % 8) * 0.0005, t.y);
        this.trees.setMatrixAt(i++, this.tmpM);
      }
    }
    this.trees.count = i;
    this.trees.instanceMatrix.needsUpdate = true;
  }

  set flowMode(on: boolean) {
    for (const m of this.marked) m.uniforms.uFlowMode.value = on ? 1 : 0;
  }

  /** Tint roads by a per-seg value 0..1 (service coverage); null switches it off. */
  coverage(cov: Map<number, number> | null) {
    const mode = cov ? 2 : this.surface.uniforms.uFlowMode.value > 1.5 ? 0 : this.surface.uniforms.uFlowMode.value;
    for (const m of this.marked) m.uniforms.uFlowMode.value = mode;
    if (!cov) return;
    for (const [id, m] of this.segs) {
      const f = cov.get(id) ?? 0;
      const a = m.flow.array as Float32Array;
      if (a[0] === f && a[a.length - 1] === f) continue;
      a.fill(f);
      m.flow.needsUpdate = true;
    }
    for (const [id, b] of this.bendFlow) {
      // a bend node joins two halves of one road: take the seg it belongs to
      void id;
      const f = cov.get(b.k1 >> 1) ?? 0;
      const a = b.flow.array as Float32Array;
      if (a[0] === f) continue;
      a.fill(f);
      b.flow.needsUpdate = true;
    }
  }

  rebuildAll() {
    for (const id of [...this.segs.keys()]) this.dropSeg(id);
    for (const id of [...this.nodes.keys()]) this.dropNode(id);
    for (const id of this.net.segs.keys()) this.buildSeg(id);
    for (const id of this.net.nodes.keys()) this.buildNode(id);
    this.collectLights();
    this.collectTrees();
    this.buildIslands();
  }

  apply(cs: ChangeSet) {
    for (const id of cs.removedSegs) this.dropSeg(id);
    for (const id of cs.removedNodes) this.dropNode(id);
    for (const id of cs.dirtySegs) { this.dropSeg(id); if (this.net.segs.has(id)) this.buildSeg(id); }
    for (const id of cs.dirtyNodes) { this.dropNode(id); if (this.net.nodes.has(id)) this.buildNode(id); }
    this.collectLights();
    this.collectTrees();
    this.buildIslands();
  }

  private dropSeg(id: number) {
    const m = this.segs.get(id);
    if (!m) return;
    this.group.remove(m.surface);
    m.surface.geometry.dispose();
    for (const o of m.extra) { this.group.remove(o); if ((o as THREE.Mesh).geometry && (o as THREE.Mesh).geometry !== this.pillarGeo) (o as THREE.Mesh).geometry.dispose(); }
    this.segs.delete(id);
    this.treeSpots.delete(id);
  }

  private dropNode(id: number) {
    const os = this.nodes.get(id);
    if (!os) return;
    for (const o of os) { this.group.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    this.nodes.delete(id);
    this.bendFlow.delete(id);
  }

  private buildSeg(id: number) {
    const s = this.net.segs.get(id)!;
    const g = this.net.segGeom.get(id)!;
    const T = ROAD_TYPES[s.type];
    const s0 = g.trimA, s1 = Math.max(g.trimA + 0.3, g.center.length - g.trimB);
    const { pts, hs, ss } = sampleRange(g.center.pts, g.center.cum, g.hs, s0, s1);
    const halfW = g.width / 2;
    // tapers: where a slip road or an extra lane opens out of (or closes into) the road it runs beside, the
    // surface starts narrow on that side and widens to full
    const L = g.center.length;
    const clipAt = (sc: number, side: 1 | -1) => {
      let c = 0;
      for (const [e, d] of [[g.ends.a, sc], [g.ends.b, L - sc]] as const) {
        if (!e.clip || e.clipSide !== side) continue;
        const len = Math.max(1, Math.min(e.clipLen, L * 0.45));
        c = Math.max(c, e.clip * (1 - smoothstep(clamp(d / len, 0, 1))));
      }
      return c;
    };
    const clipped = !!(g.ends.a.clip || g.ends.b.clip);
    const edges = clipped ? { l: ss.map((sc) => -halfW + clipAt(sc, -1)), r: ss.map((sc) => halfW - clipAt(sc, 1)) } : undefined;
    // a median ends in a nose at a junction or dead end, but runs straight on into more of the same road
    let medEnd: number[] | undefined;
    if (T.median) {
      const nose = (nid: number) => {
        const ng = this.net.nodeGeom.get(nid);
        if (!ng || (ng.kind !== "cont" && ng.kind !== "bend")) return true;
        const o = ng.arms.find((a) => a.seg !== id) ?? ng.arms.find((a) => a.seg === id && a.end !== (s.a === nid ? "a" : "b"));
        const os = o && this.net.segs.get(o.seg);
        return !os || ROAD_TYPES[os.type].median !== T.median;
      };
      const na = nose(s.a), nb = nose(s.b);
      medEnd = ss.map((sc) => Math.min(na ? sc - s0 : 1e4, nb ? s1 - sc : 1e4));
    }
    const geo = ribbon(pts, hs, ss, halfW, LIFT, [T.fwd, T.bwd], edges, T.median ?? 0, medEnd, ss.map((sc) => Math.min(sc - s0, s1 - sc)));
    const flow = geo.getAttribute("aFlow") as THREE.BufferAttribute;
    const hw = isHighway(T);
    const surface = new THREE.Mesh(geo, s.ring ? this.ringSurface.mat : hw ? this.hwSurface.mat : this.surface.mat);
    surface.receiveShadow = true;
    const extra: THREE.Object3D[] = [];
    // town roads: pavements both sides on the ground (not on bridges or round roundabouts), trees on bigger roads
    const grp = roadGroup(T);
    const walk = s.ring ? 0 : SIDEWALK[grp];
    if (walk > 0) {
      const inner = { l: edges ? edges.l : pts.map(() => -halfW), r: edges ? edges.r : pts.map(() => halfW) };
      const ok = (i: number, side: 1 | -1) => hs[i] < 0.3 && Math.abs(side > 0 ? inner.r[i] : inner.l[i]) > halfW - 0.02;
      // (each road's pavement a hair apart in height, so two that meet or overlap never flicker)
      const wg = sidewalkGeo(pts, hs, inner, walk, ok, (id % 4) * 0.0004);
      if (wg) { const wm = new THREE.Mesh(wg, this.walkMat); wm.receiveShadow = true; extra.push(wm); }
      const tr = STREET_TREES[grp];
      if (tr) {
        const spots: { x: number; y: number; h: number; r: number }[] = [];
        // on a fixed rhythm along the road (so pieces of one road line up), clear of junction mouths
        for (let sc = Math.ceil((s0 + 6) / tr.every) * tr.every; sc < s1 - 6; sc += tr.every) {
          let i = 0;
          while (i < ss.length - 2 && ss[i + 1] < sc) i++;
          for (const side of [-1, 1] as const) {
            if (!ok(i, side) || !ok(Math.min(i + 1, pts.length - 1), side)) continue;
            const r = lateralAt(pts, i), off = side * (halfW + walk * 0.55);
            spots.push({ x: pts[i].x + r.x * off, y: pts[i].y + r.y * off, h: hs[i], r: tr.r });
          }
        }
        if (spots.length) this.treeSpots.set(id, spots);
      }
    }
    // gores: where a slip road runs flush beside the carriageway it leaves (or joins), the two kerbs between them give
    // way to a broad dashed lane line, so its lane reads as carrying straight on from the carriageway's slip lane;
    // where they part, the line turns solid and follows the gap open to the gore
    for (const gl of [g.ends.a.glue, g.ends.b.glue]) {
      const ms = gl && this.net.segs.get(gl.seg), mg = gl && this.net.segGeom.get(gl.seg);
      if (!gl || !ms || !mg) continue;
      const geo = seamGeo(g.center.pts, Array.from(g.hs), gl.line ?? mg.center, Math.abs(gl.d), roadWidth(ROAD_TYPES[ms.type]) / 2, g.width / 2, isHighway(T) ? 0.56 : 0.2);
      if (geo) { const sm = new THREE.Mesh(geo, isHighway(T) ? this.seamHw : this.seamTown); sm.receiveShadow = true; extra.push(sm); }
    }
    const maxH = Math.max(...hs);
    if (maxH > 0.3) {
      const deck = deckSides(pts, hs, halfW, LIFT, edges);
      const dm = new THREE.Mesh(deck, this.deckMat);
      dm.castShadow = true;
      extra.push(dm);
      // pillars where the deck is high enough to need them
      const total = ss[ss.length - 1] - ss[0];
      const n = Math.max(1, Math.round(total / 30));
      for (let k = 0; k <= n; k++) {
        const target = ss[0] + (total * (k + 0.5)) / (n + 1);
        let i = 0;
        while (i < ss.length - 2 && ss[i + 1] < target) i++;
        const h = hs[i];
        if (h < 2.5) continue;
        const p = pts[i];
        const pm = new THREE.Mesh(this.pillarGeo, this.pillarMat);
        pm.position.set(p.x, 0, p.y);
        pm.scale.set(Math.min(1.6, halfW / 3), h - DECK + 0.05, Math.min(1.6, halfW / 3));
        pm.castShadow = true;
        pm.receiveShadow = true;
        extra.push(pm);
      }
    }
    this.group.add(surface, ...extra);
    this.segs.set(id, { surface, extra, flow });
  }

  private buildNode(id: number) {
    const n = this.net.nodes.get(id)!;
    const ng = this.net.nodeGeom.get(id);
    if (!ng || !ng.poly) return;
    // roundabout nodes are drawn with their ring (continuous surface + flared mouths)
    if (this.net.segsAt(id).some((sg) => sg.ring)) return;
    const out: THREE.Object3D[] = [];
    if (ng.curve) {
      // a bend is just more road: same markings, kerbs and deck as the segments either side
      const { lanes, halfW } = ng.curve;
      // run 0.4 m into each straight piece, a hair higher, so the joins never show a seam
      const c0 = ng.curve.pts, n0 = c0.length;
      const ext = (p: V2, q: V2) => { const d = norm(sub(p, q)); return { x: p.x + d.x * 0.4, y: p.y + d.y * 0.4 }; };
      const pts = [ext(c0[0], c0[1]), ...c0, ext(c0[n0 - 1], c0[n0 - 2])];
      const hs = [ng.curve.hs[0], ...ng.curve.hs, ng.curve.hs[n0 - 1]].map((h) => h + 0.004);
      const ss: number[] = [0];
      for (let i = 1; i < pts.length; i++) ss.push(ss[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const geo = ribbon(pts, hs, ss, halfW, LIFT, lanes, undefined, ng.curve.median);
      // no one-way chevrons on the curve: the straights either side already point the way, and they'd clip at the joins
      const surface = new THREE.Mesh(geo, this.hwNode(id) ? this.hwRing.mat : this.ringSurface.mat);
      surface.receiveShadow = true;
      out.push(surface);
      const walk = this.nodeWalk(id);
      if (walk > 0) {
        const wg = sidewalkGeo(pts, hs, { l: pts.map(() => -halfW), r: pts.map(() => halfW) }, walk, (i) => hs[i] < 0.3);
        if (wg) { const wm = new THREE.Mesh(wg, this.walkMat); wm.receiveShadow = true; out.push(wm); }
      }
      // the curve runs from the arm whose lanes come in: tint each half like that arm's two directions
      const X = ng.arms.find((a) => { const g = this.net.segGeom.get(a.seg); return g?.lanes.some((l) => l.to === id); }) ?? ng.arms[0];
      const inDir = X.end === "b" ? 1 : -1;
      this.bendFlow.set(id, { flow: geo.getAttribute("aFlow") as THREE.BufferAttribute, k1: dkey(X.seg, inDir), k2: dkey(X.seg, -inDir as 1 | -1) });
      if (Math.max(...hs) > 0.3) {
        const dm = new THREE.Mesh(deckSides(pts, hs, halfW, LIFT), this.deckMat);
        dm.castShadow = true;
        out.push(dm);
      }
      this.group.add(...out);
      this.nodes.set(id, out);
      return;
    }
    const y = n.h + LIFT + 0.012;
    const m = new THREE.Mesh(plainPoly(ng.poly, y), this.hwNode(id) ? this.hwPlain.mat : this.plain.mat);
    m.receiveShadow = true;
    if (n.h > 0.3) {
      const deck = new THREE.Mesh(polyDeck(ng.poly, y), this.deckMat);
      deck.castShadow = true;
      const under = new THREE.Mesh(plainPoly(ng.poly, Math.max(0.02, y - DECK)), this.deckMat);
      under.castShadow = true;
      out.push(deck, under);
    }
    out.push(m);
    const walk = n.h < 0.3 ? this.nodeWalk(id) : 0;
    for (const k of ng.kerbs) {
      if (k.length < 2 || walk <= 0) continue;
      // the pavement carries on round the corner, outside the kerb line
      const mi = k.length >> 1, lat = lateralAt(k, mi);
      const out_ = lat.x * (n.p.x - k[mi].x) + lat.y * (n.p.y - k[mi].y) > 0 ? -1 : 1;
      const z = k.map(() => 0);
      // (just above the roads' own pavements, so round the corner it wins cleanly)
      const wg = sidewalkGeo(k, k.map(() => n.h), { l: z, r: z }, walk, (_, side) => side === out_, 0.002);
      if (wg) { const wm = new THREE.Mesh(wg, this.walkMat); wm.receiveShadow = true; out.push(wm); }
    }
    for (const k of ng.kerbs) {
      if (k.length < 2) continue;
      // the line is the road's outer edge; draw the band just inside it, like the segment shader does
      const km = new THREE.Mesh(kerbStrip(k, y + 0.01, n.p), this.hwNode(id) ? this.hwEdgeMat : this.edgeMat);
      km.receiveShadow = true;
      out.push(km);
    }
    this.group.add(...out);
    this.nodes.set(id, out);
  }

  /** Roundabouts: one continuous ring surface, a grass island, and flared mouths where roads join. */
  private buildIslands() {
    for (const c of [...this.islands.children]) {
      this.islands.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const seen = new Set<number>();
    for (const sg of this.net.segs.values()) {
      if (!sg.ring || seen.has(sg.ring)) continue;
      seen.add(sg.ring);
      const n0 = this.net.nodes.get(sg.a)!;
      const R = ringsNear(this.net, n0.p, 4).find((r) => r.id === sg.ring);
      const g = this.net.segGeom.get(sg.id);
      if (!R || !g) continue;
      const C = R.c, hw = g.width / 2;
      const Ro = R.r + hw, Ri = R.r - hw;
      if (Ri < 2) continue;
      const y = R.h + LIFT;
      const put = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
        const m = new THREE.Mesh(geo, mat);
        m.receiveShadow = true;
        this.islands.add(m);
      };
      // surface under the (trimmed) ring ribbons so the circle never shows notches at its nodes
      put(plainGeo(new THREE.RingGeometry(Ri, Ro, 96, 1).rotateX(-Math.PI / 2).translate(C.x, y - 0.004, C.y)), this.plain.mat);
      put(new THREE.CircleGeometry(Ri, 64).rotateX(-Math.PI / 2).translate(C.x, y + 0.015, C.y), this.islandMat);
      put(strip(circlePts(C, Ri + 0.21, 64), y + 0.02, 0.42), this.edgeMat);
      // mouths: each road joining the ring flares into it with kerb fillets
      const gaps: [number, number][] = [];
      const ringNodes = new Set<number>();
      for (const s2 of this.net.segs.values()) if (s2.ring === sg.ring) { ringNodes.add(s2.a); ringNodes.add(s2.b); }
      for (const nid of ringNodes) {
        const ng = this.net.nodeGeom.get(nid);
        const nn = this.net.nodes.get(nid);
        if (!ng || !nn) continue;
        for (const a of ng.arms) {
          if (this.net.segs.get(a.seg)?.ring) continue;
          const rt = right(a.dir);
          const base = { x: nn.p.x + a.dir.x * a.trim, y: nn.p.y + a.dir.y * a.trim };
          const thC = Math.atan2(base.y - C.y, base.x - C.x);
          const flare = (side: number) => {
            const e = { x: base.x + rt.x * a.halfW * side, y: base.y + rt.y * a.halfW * side };
            // where this edge, carried on towards the centre, meets the ring's outer kerb
            const m = { x: e.x - C.x, y: e.y - C.y };
            const b = m.x * a.dir.x + m.y * a.dir.y;
            const disc = b * b - (m.x * m.x + m.y * m.y - Ro * Ro);
            let P: V2;
            if (disc >= 0 && b - Math.sqrt(disc) > 0) {
              const t = b - Math.sqrt(disc);
              P = { x: e.x - a.dir.x * t, y: e.y - a.dir.y * t };
            } else {
              const l = Math.hypot(m.x, m.y) || 1;
              P = { x: C.x + (m.x / l) * Ro, y: C.y + (m.y / l) * Ro };
            }
            const thP = Math.atan2(P.y - C.y, P.x - C.x);
            const away = Math.sign(Math.atan2(Math.sin(thP - thC), Math.cos(thP - thC))) || side;
            const thE = thP + away * (3.2 / Ro);
            const E = { x: C.x + Math.cos(thE) * Ro, y: C.y + Math.sin(thE) * Ro };
            const pts: V2[] = [];
            for (let k = 0; k <= 8; k++) {
              const t = k / 8, u = 1 - t;
              pts.push({ x: u * u * e.x + 2 * u * t * P.x + t * t * E.x, y: u * u * e.y + 2 * u * t * P.y + t * t * E.y });
            }
            return { pts, thE };
          };
          const L = flare(-1), Rr = flare(1);
          put(plainPoly([...Rr.pts, ...L.pts.slice().reverse()], y + 0.012), this.plain.mat);
          const inside = { x: base.x - a.dir.x * 2, y: base.y - a.dir.y * 2 };
          put(kerbStrip(Rr.pts, y + 0.022, inside), this.edgeMat);
          put(kerbStrip(L.pts, y + 0.022, inside), this.edgeMat);
          let a0 = L.thE, a1 = Rr.thE;
          if (Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) < 0) [a0, a1] = [a1, a0];
          const span = (((a1 - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          gaps.push([a0, span]);
        }
      }
      // outer kerb, broken at the mouths
      for (const arc of arcsBetween(gaps)) {
        const pts: V2[] = [];
        const n = Math.max(2, Math.ceil((arc[1] / (Math.PI * 2)) * 96));
        for (let k = 0; k <= n; k++) {
          const t = arc[0] + (arc[1] * k) / n;
          pts.push({ x: C.x + Math.cos(t) * (Ro - 0.21), y: C.y + Math.sin(t) * (Ro - 0.21) });
        }
        put(strip(pts, y + 0.02, 0.42), this.edgeMat);
      }
    }
  }

  private collectLights() {
    this.lightRefs = [];
    for (const [id, n] of this.net.nodes) {
      if (!n.signal) continue;
      const ng = this.net.nodeGeom.get(id);
      if (!ng || ng.kind !== "junction") continue; // a plan left on a node that's now a plain bend does nothing
      for (const a of ng.arms) {
        // one dot per incoming lane, at the stop line
        const g = this.net.segGeom.get(a.seg);
        if (!g) continue;
        for (const l of g.lanes) {
          if (l.to !== id) continue;
          const p = l.pl.pts[l.pl.pts.length - 1];
          const q = l.pl.pts[Math.max(0, l.pl.pts.length - 3)];
          const d = norm(sub(p, q));
          this.lightRefs.push({ node: id, arm: a.seg, x: p.x - d.x * 1.2, y: p.y - d.y * 1.2, h: n.h });
        }
      }
    }
  }

  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();

  /** Per-frame: signal dots. Per-second: flow tint attributes. */
  update(traffic: Traffic, flowOverlay: boolean) {
    const L = this.lights;
    if (this.lightRefs.length > L.instanceMatrix.count) {
      this.group.remove(L);
      this.lights = new THREE.InstancedMesh(L.geometry, L.material, this.lightRefs.length * 2);
      this.lights.renderOrder = 3;
      this.lights.frustumCulled = false;
      this.group.add(this.lights);
    }
    const li = this.lights;
    li.count = this.lightRefs.length;
    for (let i = 0; i < this.lightRefs.length; i++) {
      const r = this.lightRefs[i];
      this.tmpM.makeTranslation(r.x, r.h + LIFT + 0.05, r.y);
      li.setMatrixAt(i, this.tmpM);
      const st = traffic.signalState(r.node, r.arm);
      li.setColorAt(i, this.tmpC.set(st === "green" ? 0x34c25a : st === "yellow" ? 0xf5b82e : 0xe5484d));
    }
    li.instanceMatrix.needsUpdate = true;
    if (li.instanceColor) li.instanceColor.needsUpdate = true;
    if (flowOverlay) {
      for (const [id, m] of this.segs) {
        const f1 = traffic.flow.get(dkey(id, 1))?.ratio ?? 1;
        const f2 = traffic.flow.get(dkey(id, -1))?.ratio ?? 1;
        const a = m.flow.array as Float32Array;
        let changed = false;
        for (let i = 0; i < a.length; i += 2) {
          if (a[i] !== f1 || a[i + 1] !== f2) { a[i] = f1; a[i + 1] = f2; changed = true; }
        }
        if (changed) m.flow.needsUpdate = true;
      }
      for (const b of this.bendFlow.values()) {
        const f1 = traffic.flow.get(b.k1)?.ratio ?? 1, f2 = traffic.flow.get(b.k2)?.ratio ?? 1;
        const a = b.flow.array as Float32Array;
        if (a[0] === f1 && a[1] === f2) continue;
        for (let i = 0; i < a.length; i += 2) { a[i] = f1; a[i + 1] = f2; }
        b.flow.needsUpdate = true;
      }
    }
  }
}


// ------------------------------------------------------------------------------------------------

function sampleRange(pts: V2[], cum: number[], hs: Float32Array, s0: number, s1: number) {
  const outP: V2[] = [], outH: number[] = [], outS: number[] = [];
  const at = (s: number) => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, h: hs[i] + (hs[Math.min(i + 1, hs.length - 1)] - hs[i]) * t };
  };
  const first = at(s0);
  outP.push(first.p); outH.push(first.h); outS.push(s0);
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > s0 + 0.2 && cum[i] < s1 - 0.2) { outP.push(pts[i]); outH.push(hs[i]); outS.push(cum[i]); }
  }
  const last = at(s1);
  outP.push(last.p); outH.push(last.h); outS.push(s1);
  return { pts: outP, hs: outH, ss: outS };
}

function lateralAt(pts: V2[], i: number): V2 {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  return right(norm(sub(b, a)));
}

/** Road ribbon with aRoad = (lateral u, arc length v, fwd lanes, bwd lanes). */
export function ribbon(pts: V2[], hs: number[], ss: number[], halfW: number, lift: number, lanes: [number, number], edges?: { l: number[]; r: number[] }, median = 0, medEnd?: number[], treeEnd?: number[]): THREE.BufferGeometry {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const road = new Float32Array(n * 2 * 4);
  const flow = new Float32Array(n * 2 * 2).fill(1);
  for (let i = 0; i < n; i++) {
    const r = lateralAt(pts, i);
    const p = pts[i], y = hs[i] + lift;
    // left (u = -halfW) and right (u = +halfW), or the tapered edges
    const ul = edges ? edges.l[i] : -halfW, ur = edges ? edges.r[i] : halfW;
    pos.set([p.x + r.x * ul, y, p.y + r.y * ul, p.x + r.x * ur, y, p.y + r.y * ur], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    road.set([ul, ss[i], lanes[0], lanes[1], ur, ss[i], lanes[0], lanes[1]], i * 8);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    // three's y-up with z = world y: (left, right, nextLeft) is counter-clockwise seen from above
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("aRoad", new THREE.BufferAttribute(road, 4));
  g.setAttribute("aFlow", new THREE.BufferAttribute(flow, 2));
  const med = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = medEnd?.[i] ?? 1e4, t = treeEnd ? treeEnd[i] : 0;
    med.set([median, a, t, median, a, t], i * 6);
  }
  g.setAttribute("aMed", new THREE.BufferAttribute(med, 3));
  // how far each side is pulled in by a taper (the shader draws the edge band and line there)
  const clip = new Float32Array(n * 4);
  if (edges) for (let i = 0; i < n; i++) { const cl = halfW + edges.l[i], cr = halfW - edges.r[i]; clip.set([cl, cr, cl, cr], i * 4); }
  g.setAttribute("aClip", new THREE.BufferAttribute(clip, 2));
  g.setIndex(idx);
  fixUpWinding(g);
  g.computeBoundingSphere();
  return g;
}

/** Vertical deck faces under an elevated ribbon, plus the underside. */
function deckSides(pts: V2[], hs: number[], halfW: number, lift: number, edges?: { l: number[]; r: number[] }): THREE.BufferGeometry {
  // (a tapered road's deck follows its tapered edges, or the underside shows through where the surface is pulled in)
  const at = (i: number, side: number) => (edges ? (side > 0 ? edges.r[i] : edges.l[i]) : halfW * side);
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const r = lateralAt(pts, i);
      const p = pts[i], y = hs[i] + lift;
      const u = at(i, side);
      const x = p.x + r.x * u, z = p.y + r.y * u;
      pos.push(x, y, z, x, Math.max(0.02, y - DECK), z);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side > 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  // underside
  const base = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const r = lateralAt(pts, i);
    const p = pts[i], y = Math.max(0.02, hs[i] + lift - DECK);
    const ul = at(i, -1), ur = at(i, 1);
    pos.push(p.x + r.x * ul, y, p.y + r.y * ul, p.x + r.x * ur, y, p.y + r.y * ur);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function polyDeck(poly: V2[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    pos.push(p.x, y, p.y, p.x, Math.max(0.02, y - DECK), p.y);
  }
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
    idx.push(a, b, c, b, d, c, a, c, b, b, c, d); // both windings: cheap double-sided
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Pavement bands either side of a road: from the road edge (`edge.l` / `edge.r`, lateral offsets) out by `walk`, with
 * a darker rim on the outside. Only where `ok(i, side)` holds for both ends of a step. Sits just under the road
 * surface, so where it runs into another road that road covers it. null if there's nothing to draw.
 */
/** A road-coloured band with a broad dashed line down its middle (see seamGeo). */
function seamMaterial(road: number, line: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: road });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLine = { value: new THREE.Color(line) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aSeam;\nvarying vec3 vSeam;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSeam = aSeam;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLine;\nvarying vec3 vSeam;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float f = fwidth(vSeam.x) * 0.8 + 1e-4;
  float l = 1.0 - smoothstep(0.15 - f, 0.15 + f, abs(vSeam.x));
  float dash = mix(step(fract(vSeam.y / 6.0), 0.55), 1.0, step(0.5, vSeam.z));
  diffuseColor.rgb = mix(diffuseColor.rgb, uLine, l * dash);
}`,
      );
  };
  return m;
}

/**
 * The seam between a slip road and the carriageway it runs flush beside (its centre `d` from the carriageway's, the
 * carriageway `mainHalf` wide each side, the slip road `rampHalf`): a road-coloured band over both kerbs with a broad
 * dashed line down it. Where the two part, the band widens to fill the gap and the line turns solid, up to where the
 * kerbs are clear of each other (the gore). `pad`: how far past the kerbs the band reaches. null where they never meet.
 */
function seamGeo(pts: V2[], hs: number[], main: Polyline, d: number, mainHalf: number, rampHalf: number, pad: number): THREE.BufferGeometry | null {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let run = 0, v = 0, prev: V2 | null = null;
  for (let i = 0; i < pts.length; i++) {
    const c = polyClosest(main, pts[i]);
    const dir = polyDir(main, c.s), foot = polyAt(main, c.s), nrm = right(dir);
    const lat = dot(sub(pts[i], foot), nrm), gap = Math.abs(lat) - d;
    // (once the kerbs are clear of each other, they and the grass between them make the gore; and only beside the
    // carriageway, right up to the node where it starts or ends, not out past it)
    const on = gap > -0.3 && gap < 0.5 && Math.abs(dot(sub(pts[i], foot), dir)) < 0.6;
    if (!on) { run = 0; prev = null; continue; }
    const sg = Math.sign(lat), y = hs[i] + LIFT + 0.004;
    // between the carriageway's outer edge and the slip road's inner edge (they overlap 0.42 m when flush)
    const e0 = mainHalf - 0.42, e1 = Math.abs(lat) - rampHalf + 0.42;
    const mid = (e0 + e1) / 2, cover = (e1 - e0) / 2 + pad;
    const m = { x: foot.x + nrm.x * sg * mid, y: foot.y + nrm.y * sg * mid };
    if (prev) v += dist(prev, m);
    prev = m;
    const base = pos.length / 3;
    const solid = smoothstep(clamp((gap - 0.1) / 0.3, 0, 1));
    pos.push(m.x - nrm.x * cover, y, m.y - nrm.y * cover, m.x + nrm.x * cover, y, m.y + nrm.y * cover);
    uv.push(-cover, v, solid, cover, v, solid);
    if (run > 0) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
    run++;
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSeam", new THREE.Float32BufferAttribute(uv, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function sidewalkGeo(pts: V2[], hs: number[], edge: { l: number[]; r: number[] }, walk: number, ok: (i: number, side: 1 | -1) => boolean, lift = 0): THREE.BufferGeometry | null {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cw = new THREE.Color(PAL.sidewalk), ce = new THREE.Color(PAL.sidewalkEdge);
  const rim = Math.min(0.22, walk * 0.15);
  for (const side of [-1, 1] as const) {
    let prev = -1;
    for (let i = 0; i < pts.length; i++) {
      if (!ok(i, side)) { prev = -1; continue; }
      const r = lateralAt(pts, i), y = hs[i] + LIFT - 0.005 + lift;
      const e = side > 0 ? edge.r[i] : edge.l[i];
      const base = pos.length / 3;
      // four across: road edge, rim start (twice, for a hard colour change), outer edge
      for (const [d, c] of [[0, cw], [walk - rim, cw], [walk - rim, ce], [walk, ce]] as const) {
        const u = e + side * d;
        pos.push(pts[i].x + r.x * u, y, pts[i].y + r.y * u);
        col.push(c.r, c.g, c.b);
      }
      if (prev >= 0 && dist(pts[i], pts[i - 1]) > 1e-4) {
        for (const [a, b] of [[0, 1], [2, 3]]) idx.push(prev + a, base + a, prev + b, prev + b, base + a, base + b);
      }
      prev = base;
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  fixUpWinding(g);
  g.computeBoundingSphere();
  return g;
}

/** Flat strip of width w along a polyline (kerbs, guides). */
export function strip(pts: V2[], y: number, w: number, off = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const r = lateralAt(pts, i);
    const p = { x: pts[i].x + r.x * off, y: pts[i].y + r.y * off };
    pos.push(p.x - r.x * w / 2, y, p.y - r.y * w / 2, p.x + r.x * w / 2, y, p.y + r.y * w / 2);
  }
  for (let i = 0; i < n - 1; i++) {
    if (dist(pts[i], pts[i + 1]) < 1e-4) continue;
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(n * 2).fill(0).flatMap(() => [0, 1, 0]), 3));
  g.setIndex(idx);
  fixUpWinding(g);
  return g;
}

/** Make every triangle face +y (seen from the top-down camera). */
export function fixUpWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position");
  const ix = g.getIndex();
  if (!ix) return;
  const a = ix.array as Uint16Array | Uint32Array | number[];
  for (let t = 0; t < ix.count; t += 3) {
    const i0 = a[t], i1 = a[t + 1], i2 = a[t + 2];
    const ux = p.getX(i1) - p.getX(i0), uz = p.getZ(i1) - p.getZ(i0);
    const vx = p.getX(i2) - p.getX(i0), vz = p.getZ(i2) - p.getZ(i0);
    // y component of (u x v) = uz*vx - ux*vz
    if (uz * vx - ux * vz < 0) { a[t + 1] = i2; a[t + 2] = i1; }
  }
  ix.needsUpdate = true;
}

function flipWinding(g: THREE.BufferGeometry) {
  fixUpWinding(g);
  const nr = g.getAttribute("normal");
  if (nr) for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
}

/** Flat road-surface polygon (plain material: no lane markings). */
function plainPoly(poly: V2[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(Math.PI / 2); // shape (x, y) -> (x, 0, y)
  flipWinding(geo); // faces +y with upward normals
  geo.translate(0, y, 0);
  return plainGeo(geo);
}

/** Give any surface geometry the attributes the road shader expects, as a plain (unmarked) surface. */
function plainGeo(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const cnt = geo.getAttribute("position").count;
  geo.setAttribute("aRoad", new THREE.Float32BufferAttribute(new Array(cnt * 4).fill(0).map((_, i) => (i % 4 === 2 ? -1 : 0)), 4));
  geo.setAttribute("aFlow", new THREE.Float32BufferAttribute(new Array(cnt * 2).fill(1), 2));
  return geo;
}

/** Kerb band along an outer road edge, drawn on the side facing `inside` (like the segment shader's edge). */
function kerbStrip(k: V2[], y: number, inside: V2): THREE.BufferGeometry {
  const mi = k.length >> 1;
  const lat = lateralAt(k, mi);
  const s = lat.x * (inside.x - k[mi].x) + lat.y * (inside.y - k[mi].y) > 0 ? 1 : -1;
  return strip(k, y, 0.42, s * 0.21);
}

function circlePts(c: V2, r: number, n: number): V2[] {
  const pts: V2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return pts;
}

/** Complement of angular gaps [start, span] on a circle, as [start, span] arcs. */
export function arcsBetween(gaps: [number, number][]): [number, number][] {
  const TAU = Math.PI * 2;
  if (!gaps.length) return [[0, TAU]];
  const g = gaps.map(([a, sp]) => [((a % TAU) + TAU) % TAU, sp] as [number, number]).sort((x, y) => x[0] - y[0]);
  const m: [number, number][] = [];
  for (const [a, sp] of g) {
    const last = m[m.length - 1];
    if (last && a <= last[0] + last[1]) last[1] = Math.max(last[1], a + sp - last[0]);
    else m.push([a, sp]);
  }
  const out: [number, number][] = [];
  for (let i = 0; i < m.length; i++) {
    const end = m[i][0] + m[i][1];
    const next = i + 1 < m.length ? m[i + 1][0] : m[0][0] + TAU;
    if (next - end > 1e-3) out.push([end, next - end]);
  }
  return out;
}
