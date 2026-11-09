// The listener is the camera (docs/design.md, "Sound"): a few times a second, sum up what is on screen into the
// mixer's Scene (mixer.ts) and a little about where things are (for panning). Everything is weighted by how near the
// middle of the view it is; nothing here allocates once it has run.

import { BUILDING_TYPES } from "../config";
import type { Building } from "../game/buildings";
import type { Game } from "../game/city";
import { isHall } from "../game/towns";
import { F } from "../world/gen";
import { BED_OF, NW, WORKS, emptyScene, type Scene } from "./mixer";

/** The camera, as far as the ear cares. */
export interface Ear { cx: number; cy: number; halfH: number; w: number; h: number; rot?: number }

/** One of the few vehicles nearest the middle of the view, heard by itself at street level. */
export interface Near { id: number; cls: number; pan: number; v: number; w: number }

/** Where the things heard are, across the screen (-1 left .. 1 right). */
export interface Where {
  near: Near[];
  works: number[];
  jam: number;
  gate: number;
  site: number;
  hall: number;
  town: number;
}

const STOPPED = /^(Waiting for|Full of|No workers|No road|Idle|Building site|Out of fuel)/;

/** Whether a works is making anything now: built, on the road, staffed, fed and with room for its product. */
export function plantRunning(b: Pick<Building, "built" | "access" | "problem" | "plant">): boolean {
  return b.built >= 1 && !!b.plant && !b.plant.site && !!b.access && !STOPPED.test(b.problem ?? "");
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CLS: Record<string, number> = { light: 1, heavy: 2, roadtrain: 3 };
/** how long a vehicle has stood before it counts as jammed (s) */
const JAM_WAIT = 25;

export class SceneReader {
  readonly scene: Scene = emptyScene();
  readonly where: Where = {
    near: [0, 1, 2].map(() => ({ id: -1, cls: 0, pan: 0, v: 0, w: 0 })), works: new Array(NW).fill(0), jam: 0, gate: 0, site: 0, hall: 0, town: 0,
  };
  private worksW = new Array(NW).fill(0);
  private groundT = 0;
  private p = { x: 0, y: 0 };

  /** Read the game through the camera. `hour` and `season` are the ones shown (the day cycle's). */
  read(g: Game, ear: Ear, hour: number, season: number, dt: number): Scene {
    const s = this.scene, W = this.where;
    const cx = ear.cx, cy = ear.cy, halfH = ear.halfH, rot = ear.rot ?? 0;
    const cos = Math.cos(rot), sin = Math.sin(rot), halfW = halfH * (ear.w / Math.max(1, ear.h));
    // heard: inside a circle a little bigger than the screen is tall, fading to its edge
    const R = halfH * 1.3, R2 = R * R;
    const wOf = (d2: number) => 1 - smooth(0.4, 1, Math.sqrt(d2) / R);
    const panOf = (dx: number, dy: number) => Math.max(-1, Math.min(1, (dx * cos + dy * sin) / halfW));
    s.halfH = halfH; s.paused = g.paused; s.speed = g.speed; s.hour = hour; s.season = season;

    // ---- vehicles
    for (let c = 0; c < 4; c++) { s.n[c] = 0; s.v[c] = 0; }
    s.idle = 0; s.jam = 0; s.gate = 0;
    let jamX = 0, jamW = 0, gateX = 0, gateW = 0;
    const near = W.near;
    for (const n of near) { n.w = 0; n.id = -1; }
    // (far out no engine is heard: the vehicles are not looked at)
    if (halfH < 1900) {
      const street = halfH < 300;
      for (const v of g.traffic.vehicles) {
        const dx = v.x - cx, dy = v.y - cy, d2 = dx * dx + dy * dy;
        if (d2 > R2 || v.quit !== undefined) continue;
        const w = wOf(d2);
        const haul = v.trip.haul;
        const c = haul ? CLS[haul.cls ?? "light"] ?? 1 : v.trip.bus ? 1 : v.truck ? 1 : 0;
        s.n[c] += w; s.v[c] += w * v.v;
        if (v.v < 0.6) {
          s.idle += w;
          if (v.wait > JAM_WAIT) { s.jam += w; jamX += w * panOf(dx, dy); jamW += w; }
        }
        if (haul && v.v < 5 && w > 0.05) {
          // a truck turning in at the works it is bound for
          const b = g.buildings.byId.get(haul.dest);
          if (b && (b.front.x - v.x) ** 2 + (b.front.y - v.y) ** 2 < 45 * 45) { s.gate += w; gateX += w * panOf(dx, dy); gateW += w; }
        }
        if (street && v.v > 1.5) {
          // the three nearest the middle, each heard by itself
          const k = w > near[0].w ? 0 : w > near[1].w ? 1 : w > near[2].w ? 2 : -1;
          if (k >= 0) {
            const last = near[2];
            for (let j = 2; j > k; j--) near[j] = near[j - 1];
            near[k] = last;
            last.id = v.id; last.cls = c; last.pan = panOf(dx, dy); last.v = v.v; last.w = w;
          }
        }
      }
      for (let c = 0; c < 4; c++) if (s.n[c] > 0) s.v[c] /= s.n[c];
    }
    W.jam = jamW > 0 ? jamX / jamW : 0;
    W.gate = gateW > 0 ? gateX / gateW : 0;

    // ---- buildings: works, building sites, homes and shops, the town hall
    const works = s.works, wp = W.works, ww = this.worksW;
    for (let i = 0; i < NW; i++) { works[i] = 0; wp[i] = 0; ww[i] = 0; }
    s.logging = 0; s.dairy = 0; s.farm = 0; s.motor = 0; s.pit = 0; s.sites = 0; s.homes = 0; s.shops = 0; s.hall = 0;
    let siteX = 0, siteW = 0, townX = 0, townW = 0;
    W.hall = 0;
    if (halfH < 4200) {
      for (const b of g.buildings.list) {
        const dx = b.c.x - cx, dy = b.c.y - cy;
        // (a big yard is heard from its fence, not its middle)
        const reach = Math.max(b.hw, b.hd) * 0.7;
        const d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - reach);
        if (isHall(b.kind) && b.built >= 1) {
          const far = 1 - smooth(0.5, 1.6, d / (halfH * 1.3));
          if (far > s.hall) { s.hall = far; W.hall = panOf(dx, dy); }
        }
        if (d > R) continue;
        const w = wOf(d * d);
        if (w <= 0) continue;
        if (b.built < 1) {
          if (!b.abandoned) { s.sites += w; siteX += w * panOf(dx, dy); siteW += w; }
          continue;
        }
        if (b.plant) {
          if (b.plant.site) { s.sites += w; siteX += w * panOf(dx, dy); siteW += w; continue; }
          const bed = BED_OF[b.kind];
          if (!bed || !plantRunning(b)) continue;
          const i = WORKS.indexOf(bed), amt = w * (0.7 + 0.3 * b.plant.level);
          works[i] += amt; wp[i] += amt * panOf(dx, dy); ww[i] += amt;
          if (b.kind === "loggingcamp") s.logging += w;
          else if (b.kind === "dairyfarm") s.dairy += w;
          else if (b.kind === "farm") s.farm += w;
          else if (b.kind === "motorworks") s.motor += w;
          else if (b.kind === "quarry" || b.kind === "ironmine" || b.kind === "coalmine" || b.kind === "coppermine") s.pit += w;
          continue;
        }
        if (b.abandoned) continue;
        const zone = BUILDING_TYPES[b.kind]?.zone;
        if (zone === "res") { s.homes += w; townX += w * panOf(dx, dy); townW += w; }
        else if (zone === "com") { s.shops += w; townX += w * panOf(dx, dy); townW += w; }
      }
    }
    for (let i = 0; i < NW; i++) wp[i] = ww[i] > 0 ? wp[i] / ww[i] : 0;
    W.site = siteW > 0 ? siteX / siteW : 0;
    W.town = townW > 0 ? townX / townW : 0;

    // ---- the biggest town in earshot
    s.pop = 0;
    for (const t of g.towns.list) {
      const dx = t.c.x - cx, dy = t.c.y - cy;
      if (dx * dx + dy * dy < (R + t.reach) * (R + t.reach) && t.pop > s.pop) s.pop = t.pop;
    }

    // ---- the ground near the middle: forest and water (once a second; not looked at from far out)
    this.groundT -= dt;
    if (this.groundT <= 0) {
      this.groundT = 1;
      let forest = 0, water = 0;
      if (halfH < 2600) {
        const p = this.p, step = R * 0.36;
        for (let iy = -2; iy <= 2; iy++) {
          for (let ix = -2; ix <= 2; ix++) {
            p.x = cx + ix * step; p.y = cy + iy * step;
            if (g.terrain.sample(F.forest, p.x, p.y) >= 0.5) forest++;
            if (g.terrain.water(p) >= 0.5) water++;
          }
        }
        forest /= 25; water /= 25;
      }
      s.forest = forest; s.water = water;
    }
    return s;
  }
}
