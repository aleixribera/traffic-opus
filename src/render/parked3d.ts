// The cars standing in the lots' bays: the same cars as the traffic's (render/carlook.ts), instanced, drawn only
// where the camera looks, as few-triangle models once they are a handful of pixels long. They are dressing: the sim
// counts none of them, and its own trips come and go through the bays left free (Buildings3D.lotWay). Which bays keep
// a car is fixed (Buildings3D bayTaken); whether it is in at this hour is carlook.parkedAt: homes fill at night,
// shops, offices and works by day.

import * as THREE from "three";
import { CAR_KINDS, carLook, parkedAt, type CarKind } from "./carlook";
import type { ModelSet } from "./models";
import { Painted, type PaintMaterials } from "./vehiclepaint";
import type { View } from "./view";

/** A bay that keeps a car: its pose (the car model's own matrix), the car's number, and whether it is a home's bay. */
export interface ParkSlot { m: THREE.Matrix4; look: number; home: boolean }

/**
 * The bays that keep a car, drawn by Vehicles3D: the lots' (Buildings3D, whenever the buildings change), the pads
 * beside the homes' driveways (with the driveways) and the lay-bys along the greens (Greens3D).
 */
export const PARKED: { slots: ParkSlot[]; version: number; hour: () => number } = { slots: [], version: 0, hour: () => 12 };
const SOURCES = new Map<string, ParkSlot[]>();
export function setParked(slots: ParkSlot[], source = "lots") {
  if (!slots.length && !SOURCES.get(source)?.length) return;
  SOURCES.set(source, slots);
  PARKED.slots = [...SOURCES.values()].flat();
  PARKED.version++;
}

/** Past this many metres a pixel a car is its far model (about 6 px long); past HIDE it is not drawn. */
export const FAR_MPP = 0.72, HIDE_MPP = 4.2;
const CELL = 96;
/** A car that comes or goes while on screen grows in or shrinks away (ms), as the traffic's cars do in a lot. */
const IN_MS = 380, OUT_MS = 420, SMALL = 0.55;

interface Car { m: THREE.Matrix4; x: number; z: number; kind: number; body: number; second: number; look: number; home: boolean; on: boolean; t: number; at: number }

export class ParkedCars {
  private batches: Painted[];
  private cells = new Map<number, Car[]>();
  private version = -1;
  private tick = -1;
  private far = false;
  private box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private moving = false;
  private hidden = true;
  /** The refreshes so far (a car knows the last one it was part of). */
  private round = 0;
  private tmp = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private lists: Car[][];
  /** How many are drawn (for the tests and the debug overlay). */
  shown = 0;

  constructor(models: ModelSet, mats: PaintMaterials, parent: THREE.Object3D) {
    this.batches = CAR_KINDS.map((k) => new Painted(models.vehicles.get(k)!, 256, mats, parent));
    this.lists = CAR_KINDS.map(() => []);
  }

  private bucket() {
    this.cells.clear();
    const kinds = new Map<CarKind, number>(CAR_KINDS.map((k, i) => [k, i]));
    for (const s of PARKED.slots) {
      const e = s.m.elements, L = carLook(s.look);
      const c: Car = { m: s.m, x: e[12], z: e[14], kind: kinds.get(L.kind)!, body: L.body, second: L.second, look: s.look, home: s.home, on: false, t: 0, at: -1 };
      const key = Math.floor(c.x / CELL) * 65536 + Math.floor(c.z / CELL);
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = []);
      cell.push(c);
    }
  }

  /** Call every frame: does nothing unless the view, the hour or the bays moved on. */
  update(view: View, hour: number) {
    const mpp = view.mpp;
    if (mpp > HIDE_MPP) {
      if (!this.hidden) { for (const b of this.batches) b.commit(0); this.hidden = true; this.shown = 0; }
      return;
    }
    const fresh = this.version !== PARKED.version;
    const far = mpp > FAR_MPP, tick = Math.floor(hour * 12);
    const v = view.bounds(3, 4);
    const B = this.box;
    if (!fresh && !this.hidden && !this.moving && far === this.far && tick === this.tick &&
      v.x0 >= B.x0 && v.y0 >= B.y0 && v.x1 <= B.x1 && v.y1 <= B.y1) return;
    if (fresh) { this.bucket(); this.version = PARKED.version; }
    // (a box wider than the view, so a pan doesn't mean a refresh every frame)
    const pad = Math.max(30, view.halfH * 0.4);
    B.x0 = v.x0 - pad; B.y0 = v.y0 - pad; B.x1 = v.x1 + pad; B.y1 = v.y1 + pad;
    const first = fresh || this.hidden || far !== this.far;
    this.hidden = false;
    this.far = far;
    this.tick = tick;
    const now = performance.now(), last = this.round++;
    for (const l of this.lists) l.length = 0;
    let moving = false;
    for (let cx = Math.floor(B.x0 / CELL); cx <= Math.floor(B.x1 / CELL); cx++) {
      for (let cz = Math.floor(B.y0 / CELL); cz <= Math.floor(B.y1 / CELL); cz++) {
        const cell = this.cells.get(cx * 65536 + cz);
        if (!cell) continue;
        for (const c of cell) {
          const want = parkedAt(c.look, c.home, hour);
          if (want !== c.on) {
            c.on = want;
            // (seen to change: it grows in or shrinks away; unseen, or as the lot is first drawn, it just is)
            const seen = !first && !far && c.at === last && c.x >= v.x0 && c.x <= v.x1 && c.z >= v.y0 && c.z <= v.y1;
            c.t = seen ? now : 0;
          }
          c.at = this.round;
          if (c.t && now - c.t > (c.on ? IN_MS : OUT_MS)) c.t = 0;
          if (c.t) moving = true;
          if (c.on || c.t) this.lists[c.kind].push(c);
        }
      }
    }
    this.moving = moving;
    let shown = 0;
    this.batches.forEach((b, k) => {
      const l = this.lists[k];
      b.ensure(l.length);
      b.far(far);
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        let m = c.m;
        if (c.t) {
          const f = (now - c.t) / (c.on ? IN_MS : OUT_MS);
          const s = c.on ? SMALL + (1 - SMALL) * f : 1 - (1 - SMALL) * f;
          m = this.tmp.copy(c.m).scale(this.s.set(s, s, s));
        }
        b.set(i, m, c.body, c.second, null);
      }
      b.commit(l.length);
      shown += l.length;
    });
    this.shown = shown;
  }

  dispose() {
    for (const b of this.batches) b.dispose();
  }
}
