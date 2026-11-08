// Scenery clearing: the ground's trees and shrubs are drawn by the terrain shader from hashed cells, knowing nothing
// of what's built. This keeps them off the roads, their pavements and verges, junctions, company sites (their yard
// roads, buildings and pads, and the fence line) and buildings' plots: a mask texture round the view says how far
// each point is from built ground, and the shader drops any crown that would reach it. Being computed from what is
// built each time, it holds for roads built before or after the trees, and stays clear however the ground is redrawn.

import * as THREE from "three";
import { ROAD_TYPES, SIDEWALK, roadGroup } from "../config";
import { dist, pointSegDist2, polygonContains, rectCorners, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { siteFrame, siteLayout, siteToWorld, slotHalf, GATE_GAP } from "../game/sites";
import { GATE_LINK_OUT } from "../game/city";
import type { PlantKind } from "../game/industry";
import type { RoadNetwork } from "../roads/network";

/** Grass left between a pavement (or a road with none) and the nearest crown. */
export const VERGE = 1;
/** The widest crown the terrain draws (its radius, m): the mask grades distance out to this far past built ground. */
export const CLEAR_RANGE = 4;
const PX = 2048; // mask texels a side
const TEXEL = 2; // metres a texel: the mask covers ~4 km round the view (crowns only show nearer in than that)

/** Built ground to keep scenery off: a polyline (a road's centre) or a polygon, and how far round it to clear. */
export type ClearShape = { line: V2[]; hard: number } | { poly: V2[]; hard: number };

/** Everything that keeps trees off: roads with their pavements and verges, junctions, sites and buildings. */
export function clearShapes(net: RoadNetwork, buildings: readonly Building[]): ClearShape[] {
  const out: ClearShape[] = [];
  for (const [id, s] of net.segs) {
    const g = net.segGeom.get(id);
    if (!g) continue;
    const walk = s.ring ? 0 : SIDEWALK[roadGroup(ROAD_TYPES[s.type])] ?? 0;
    out.push({ line: g.center.pts, hard: g.width / 2 + walk + VERGE });
  }
  for (const [id, ng] of net.nodeGeom) {
    const at = net.segsAt(id);
    const walk = at.length && !at.some((x) => x.ring) ? Math.max(...at.map((x) => SIDEWALK[roadGroup(ROAD_TYPES[x.type])] ?? 0)) : 0;
    if (ng.poly && ng.poly.length >= 3) out.push({ poly: ng.poly, hard: walk + VERGE });
    if (ng.curve) out.push({ line: ng.curve.pts, hard: ng.curve.halfW + walk + VERGE });
  }
  for (const b of buildings) {
    if (b.placed && b.plant) {
      // a company site: its yard roads (and the apron out of its gate), its buildings and the pads of those to
      // come, and a strip along its fence so the fence reads as one
      const f = siteFrame(b.c, b.rot, b.side, b.hd);
      const W = (x: number, y: number) => siteToWorld(f, x, y);
      const L = siteLayout(b.kind as PlantKind, b.hw * 2, b.hd * 2, b.id);
      L.roads.forEach((r, i) => {
        const a = i === 0 ? { x: r.a.x, y: Math.min(r.a.y, -GATE_LINK_OUT) } : r.a;
        out.push({ line: [W(a.x, a.y), W(r.b.x, r.b.y)], hard: r.w / 2 + VERGE });
      });
      for (const s of L.slots) {
        const { hx, hy } = slotHalf(s);
        out.push({ poly: [W(s.x - hx, s.y - hy), W(s.x + hx, s.y - hy), W(s.x + hx, s.y + hy), W(s.x - hx, s.y + hy)], hard: VERGE + 0.5 });
      }
      const hw = b.hw, d = b.hd * 2, gg = GATE_GAP / 2;
      for (const [x0, y0, x1, y1] of [[-gg, 0, -hw, 0], [-hw, 0, -hw, d], [-hw, d, hw, d], [hw, d, hw, 0], [hw, 0, gg, 0]]) {
        out.push({ line: [W(x0, y0), W(x1, y1)], hard: 0.6 });
      }
      continue;
    }
    out.push({ poly: rectCorners(b.c, b.hw, b.hd, b.rot), hard: 0.5 });
  }
  return out;
}

/** How far past a shape's cleared ground a point is (negative inside it). */
export function clearDist(sh: ClearShape, p: V2): number {
  if ("line" in sh) {
    const pts = sh.line;
    let best = Infinity;
    if (pts.length === 1) best = dist(pts[0], p);
    for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, Math.sqrt(pointSegDist2(p, pts[i], pts[i + 1]).d2));
    return best - sh.hard;
  }
  const pts = sh.poly;
  if (polygonContains(pts, p)) return -sh.hard;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) best = Math.min(best, Math.sqrt(pointSegDist2(p, pts[i], pts[(i + 1) % pts.length]).d2));
  return best - sh.hard;
}

/** Would a crown of radius r centred at p be dropped (it reaches cleared ground)? What the shader decides, exactly. */
export function crownCleared(shapes: readonly ClearShape[], p: V2, r: number): boolean {
  return shapes.some((sh) => clearDist(sh, p) < r);
}

/**
 * The mask: a texture round the view holding, at each point, how far it is past built ground (1 on it, falling
 * linearly to 0 at CLEAR_K past it), drawn on the GPU from the shapes: each line piece a band across it with the
 * distance from its centre, each joint and end a disc, each polygon its inside plus its edges, all blended by
 * taking the largest value. The terrain samples it at each crown's centre.
 */
export class Clearing {
  /** world point at the mask's (0, 0) corner, and the world size it covers */
  readonly origin = new THREE.Vector2(0, 0);
  readonly size = PX * TEXEL;
  private target = new THREE.WebGLRenderTarget(PX, PX, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(); // (unused: the shader places everything itself)
  private mesh: THREE.Mesh | null = null;
  private mat = new THREE.ShaderMaterial({
    uniforms: { uO: { value: this.origin }, uS: { value: this.size } },
    vertexShader: /* glsl */ `
      attribute vec2 aU; attribute float aHard;
      uniform vec2 uO; uniform float uS;
      varying vec2 vU; varying float vHard;
      void main() {
        vU = aU; vHard = aHard;
        gl_Position = vec4((position.xy - uO) / uS * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vU; varying float vHard;
      void main() {
        float d = max(0.0, length(vU) - vHard);
        float v = clamp(1.0 - d / ${CLEAR_K.toFixed(4)}, 0.0, 1.0);
        gl_FragColor = vec4(v, v, v, 1.0);
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private dirty = true;
  private last = -1e9;
  private centre = { x: Infinity, y: Infinity };

  constructor(private shapes: () => ClearShape[]) {
    this.scene.matrixWorldAutoUpdate = false;
  }

  get tex(): THREE.Texture {
    return this.target.texture;
  }

  dispose() {
    this.target.dispose();
    this.mesh?.geometry.dispose();
    this.mat.dispose();
  }

  /** Something was built or removed: redraw soon. */
  invalidate() {
    this.dirty = true;
  }

  /** Call every frame: redraws when the view has moved far from the mask's centre, or (at most 4x a second) when dirty. */
  update(renderer: THREE.WebGLRenderer, cx: number, cy: number) {
    const far = Math.abs(cx - this.centre.x) > this.size / 6 || Math.abs(cy - this.centre.y) > this.size / 6;
    const now = performance.now();
    if (!far && !(this.dirty && now - this.last > 250)) return;
    this.centre = { x: Math.round(cx / 64) * 64, y: Math.round(cy / 64) * 64 };
    this.origin.set(this.centre.x - this.size / 2, this.centre.y - this.size / 2);
    this.build();
    const prev = renderer.getRenderTarget(), clear = new THREE.Color(), alpha = renderer.getClearAlpha();
    renderer.getClearColor(clear);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    if (this.mesh) renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(clear, alpha);
    this.dirty = false;
    this.last = now;
  }

  /** The shapes near the mask, as one mesh of bands, discs and insides. */
  private build() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const ox = this.origin.x, oy = this.origin.y, S = this.size;
    const pos: number[] = [], u: number[] = [], hd: number[] = [];
    const vert = (x: number, y: number, ux: number, uy: number, h: number) => { pos.push(x, y, 0); u.push(ux, uy); hd.push(h); };
    const R = CLEAR_K;
    // a band along a-b, out to hard + R either side (u: the signed distance across it)
    const band = (a: V2, b: V2, h: number) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 1e-6) return;
      const w = h + R, nx = (-dy / L) * w, ny = (dx / L) * w;
      const q = [[a.x + nx, a.y + ny, w], [a.x - nx, a.y - ny, -w], [b.x - nx, b.y - ny, -w], [b.x + nx, b.y + ny, w]] as const;
      for (const k of [0, 1, 2, 0, 2, 3]) vert(q[k][0], q[k][1], q[k][2], 0, h);
    };
    // a disc round a joint or an end (a square, u: the offset from its centre)
    const disc = (p: V2, h: number) => {
      const w = h + R;
      const q = [[-w, -w], [w, -w], [w, w], [-w, w]] as const;
      for (const k of [0, 1, 2, 0, 2, 3]) vert(p.x + q[k][0], p.y + q[k][1], q[k][0], q[k][1], h);
    };
    for (const sh of this.shapes()) {
      const pts = "line" in sh ? sh.line : sh.poly;
      const m = sh.hard + R;
      if (!pts.some((p) => p.x > ox - m && p.x < ox + S + m && p.y > oy - m && p.y < oy + S + m)) continue;
      const closed = "poly" in sh && pts.length >= 3;
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) band(pts[i], pts[(i + 1) % pts.length], sh.hard);
      for (const p of pts) disc(p, sh.hard);
      if (closed) {
        // its inside: on built ground everywhere
        // (a plot's rectangle is two triangles; anything else, cut up properly)
        const tris = pts.length === 4 ? [[0, 1, 2], [0, 2, 3]] : THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
        for (const t of tris) for (const k of t) vert(pts[k].x, pts[k].y, 0, 0, 1e4);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 2));
    g.setAttribute("aHard", new THREE.Float32BufferAttribute(hd, 1));
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
}

/** Mask value v -> distance past built ground: (1 - v) * CLEAR_K (0 beyond it: nothing near). */
export const CLEAR_K = CLEAR_RANGE + 0.5;
/** The distance past built ground a mask value says (what the terrain shader reads back). */
export const maskDist = (v: number): number => (1 - v) * CLEAR_K;
