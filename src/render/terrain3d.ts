import * as THREE from "three";
import { MAP } from "../config";
import { polygonContains, type V2 } from "../core/math";
import { MOUNTAIN_STEPS, RES, type Terrain } from "../world/terrain";
import { PAL } from "./palette";

export const MOUNTAIN_STEP_H = 7;

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** Ground texture, terraced mountains, locked-tile shading and the tile grid. */
export class Terrain3D {
  readonly group = new THREE.Group();
  private lockGroup = new THREE.Group();
  private groundTex: THREE.CanvasTexture;

  constructor(private terrain: Terrain, small: boolean) {
    const S = MAP.size;
    // far background so the map edge reads as an edge
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(S * 6, S * 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.bg }));
    bg.position.set(S / 2, -0.5, S / 2);
    this.group.add(bg);

    this.groundTex = this.paintGround(small ? 2048 : 4096);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: this.groundTex }),
    );
    ground.position.set(S / 2, 0, S / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    this.buildMountains();
    this.group.add(this.lockGroup);
    this.buildGrid();
  }

  private paintGround(px: number): THREE.CanvasTexture {
    const t = this.terrain;
    const cv = document.createElement("canvas");
    cv.width = cv.height = px;
    const g = cv.getContext("2d")!;
    const k = px / MAP.size;
    g.fillStyle = hex(PAL.ground);
    g.fillRect(0, 0, px, px);
    const fill = (loops: V2[][], color: number, stroke?: number) => {
      g.beginPath();
      for (const l of loops) {
        g.moveTo(l[0].x * k, l[0].y * k);
        for (let i = 1; i < l.length; i++) g.lineTo(l[i].x * k, l[i].y * k);
        g.closePath();
      }
      g.fillStyle = hex(color);
      g.fill("evenodd");
      if (stroke !== undefined) {
        g.strokeStyle = hex(stroke);
        g.lineWidth = Math.max(1, 1.6 * k);
        g.stroke();
      }
    };
    fill(t.contours(t.sand, 0.5), PAL.sand);
    fill(t.contours(t.grass, 0.5), PAL.grass);
    fill(t.contours(t.water, 0.5), PAL.water, PAL.waterEdge);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  private buildMountains() {
    const t = this.terrain;
    for (let lvl = 1; lvl <= MOUNTAIN_STEPS.length; lvl++) {
      const level = MOUNTAIN_STEPS[lvl - 1];
      const loops = t.contours(t.mountain, level).filter((l) => Math.abs(area(l)) > 60);
      if (!loops.length) continue;
      // classify: a loop is an outline if the solid side of its first edge lies inside it
      const outers: V2[][] = [], holes: V2[][] = [];
      for (const l of loops) {
        const a = l[0], b = l[1 % l.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const probeL = { x: m.x + (dy / L) * RES * 0.6, y: m.y - (dx / L) * RES * 0.6 };
        const probeR = { x: m.x - (dy / L) * RES * 0.6, y: m.y + (dx / L) * RES * 0.6 };
        const solid = t.sample(t.mountain, probeL.x, probeL.y) >= level ? probeL : probeR;
        (polygonContains(l, solid) ? outers : holes).push(l);
      }
      const shapes: THREE.Shape[] = [];
      for (const o of outers) {
        const sh = new THREE.Shape(o.map((p) => new THREE.Vector2(p.x, p.y)));
        for (const h of holes) if (polygonContains(o, h[0])) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
        shapes.push(sh);
      }
      const H = lvl * MOUNTAIN_STEP_H;
      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: H - 1.2, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.6, bevelSegments: 2, curveSegments: 1,
      });
      // shape plane is (x, y=world y); extrude +z -> rotate so z becomes up
      geo.rotateX(Math.PI / 2);
      geo.translate(0, H, 0);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: PAL.mountain[lvl - 1] }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildGrid() {
    const n = MAP.size / MAP.tile;
    const pts: number[] = [];
    for (let i = 1; i < n; i++) {
      pts.push(i * MAP.tile, 0, 0, i * MAP.tile, 0, MAP.size);
      pts.push(0, 0, i * MAP.tile, MAP.size, 0, i * MAP.tile);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: 0x8a877e, dashSize: 9, gapSize: 7, transparent: true, opacity: 0.55 }));
    line.computeLineDistances();
    // Sits just above the ground and below road decks, so roads and mountains cover it.
    line.position.y = 0.035;
    this.group.add(line);
  }

  /** Darken tiles that aren't unlocked yet. */
  setTiles(unlocked: Set<string>) {
    for (const c of [...this.lockGroup.children]) {
      this.lockGroup.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const n = MAP.size / MAP.tile;
    const mat = new THREE.MeshBasicMaterial({ color: PAL.locked, transparent: true, opacity: 0.13, depthWrite: false });
    const geos: THREE.BufferGeometry[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (unlocked.has(`${i},${j}`)) continue;
        const g = new THREE.PlaneGeometry(MAP.tile, MAP.tile).rotateX(-Math.PI / 2);
        g.translate((i + 0.5) * MAP.tile, 0, (j + 0.5) * MAP.tile);
        geos.push(g);
      }
    }
    if (!geos.length) return;
    const merged = mergeSimple(geos);
    const m = new THREE.Mesh(merged, mat);
    m.position.y = 30;
    m.renderOrder = 4;
    this.lockGroup.add(m);
  }
}

function area(l: V2[]): number {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i], q = l[(i + 1) % l.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
