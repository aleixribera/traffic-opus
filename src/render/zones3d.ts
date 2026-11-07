import * as THREE from "three";
import { CELL, ZONES, type Cell, type ZoneId, type ZoneMap } from "../game/zones";

const Y = 0.07;

/** One cell quad matrix: the cell's x axis runs along the road. */
function cellMatrix(out: THREE.Matrix4, c: Cell, s = 1) {
  const cs = Math.cos(c.rot) * s, sn = Math.sin(c.rot) * s;
  // basis: x = along the road, z = across (three z is world y)
  out.set(
    cs, 0, -sn, c.c.x,
    0, 1, 0, Y,
    sn, 0, cs, c.c.y,
    0, 0, 0, 1,
  );
  return out;
}

/**
 * Zone cells on the ground. Like CS2 they only show while zoning (or in the Zoning info view):
 * the zoned cells in their colours, the empty grid, and the cells under buildings.
 */
export class Zones3D {
  readonly group = new THREE.Group();
  private geo = new THREE.PlaneGeometry(CELL - 0.9, CELL - 0.9).rotateX(-Math.PI / 2);
  private zoned: THREE.InstancedMesh;
  private grid: THREE.InstancedMesh;
  private hi: THREE.InstancedMesh;
  private cap = 0;
  private hiCap = 0;
  private version = -1;
  private showGrid = false;
  private tmp = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(private zones: ZoneMap) {
    this.zoned = this.make(1, 0.5);
    this.grid = this.make(1, 0.32);
    this.hi = this.make(1, 0.8);
    this.hi.renderOrder = 3;
  }

  private make(n: number, opacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }), n);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.setColorAt(0, this.col.set(1, 1, 1));
    this.group.add(m);
    return m;
  }

  private grow(which: "main" | "hi", n: number) {
    if (which === "main") {
      if (n <= this.cap) return;
      this.cap = Math.max(1024, Math.ceil(n * 1.4));
      for (const k of ["zoned", "grid"] as const) {
        const old = this[k];
        const m = this.make(this.cap, (old.material as THREE.MeshBasicMaterial).opacity);
        this.group.remove(old);
        old.dispose();
        this[k] = m;
      }
    } else {
      if (n <= this.hiCap) return;
      this.hiCap = Math.max(256, Math.ceil(n * 1.4));
      const old = this.hi;
      this.hi = this.make(this.hiCap, 0.8);
      this.hi.renderOrder = 3;
      this.group.remove(old);
      old.dispose();
    }
  }

  setGrid(on: boolean) {
    if (on === this.showGrid) return;
    this.showGrid = on;
    this.version = -1;
  }

  /** Rebuild the instances when the zone map changed. */
  update() {
    if (this.version === this.zones.version) return;
    this.version = this.zones.version;
    let n = 0;
    for (const _ of this.zones.allCells()) n++;
    this.grow("main", n);
    let a = 0, b = 0;
    for (const c of this.zones.allCells()) {
      if (!c.ok) continue;
      if (!this.showGrid) break;
      if (c.zone) {
        this.zoned.setMatrixAt(a, cellMatrix(this.tmp, c));
        this.zoned.setColorAt(a, this.col.setHex(ZONES[c.zone].color));
        a++;
      } else if (!c.zone && this.showGrid) {
        this.grid.setMatrixAt(b, cellMatrix(this.tmp, c));
        this.grid.setColorAt(b, this.col.setHex(0xffffff));
        b++;
      }
    }
    this.zoned.count = a;
    this.grid.count = b;
    for (const m of [this.zoned, this.grid]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Cells the zoning tool is about to change. zone null = unzone (red). */
  highlight(cells: Cell[], zone: ZoneId | null) {
    this.grow("hi", cells.length);
    const color = zone ? ZONES[zone].color : 0xe5484d;
    let k = 0;
    for (const c of cells) {
      if (!c.ok) continue;
      this.hi.setMatrixAt(k, cellMatrix(this.tmp, c, 0.92));
      this.hi.setColorAt(k, this.col.setHex(color));
      k++;
    }
    this.hi.count = k;
    this.hi.instanceMatrix.needsUpdate = true;
    if (this.hi.instanceColor) this.hi.instanceColor.needsUpdate = true;
  }

  forceRefresh() {
    this.version = -1;
  }
}
