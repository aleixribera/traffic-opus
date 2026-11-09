// The camera director: following a vehicle (from a convoy's tag, the camera menu or G; App.followVehicle is there for
// a vehicle inspector's Follow button), and
// the two cinematic modes in the style of Cities: Skylines: a Tour (T) that drifts over the busiest places and fades
// between them, and a Vehicle cam (Shift+T) that rides with one interesting vehicle after another. The pure parts
// (damping, spots, shots, fades) are in render/cinema.ts; this file feeds them the game and moves the view.
//
// The per-frame paths (follow, a shot in progress, the fade) don't allocate: the vehicle is found by id with a cached
// index, its position goes into fields, and the fade's opacity strings are made once.

import type { App, OverlayId, ToolId } from "../app";
import { BUILDING_TYPES } from "../config";
import { PRODUCTS, type Product } from "../game/industry";
import { BIG_NAME, type BigKind } from "../game/convoys";
import { TRUCK_CLASSES, type TruckClass } from "../game/trucks";
import type { Vehicle } from "../sim/traffic";
import {
  ActivityGrid, FADE, FollowCam, FollowSession, ShotHistory, chaseRot, cutShort, easeAngle, evalShot, fadeAt, gatherSpots,
  nearestRide, pickRide, pickSpot, planRide, planShot, successorOf,
  type HaulKey, type Pose, type RideCandidate, type Shot, type Spot, type SpotInputs,
} from "../render/cinema";

export type CamMode = "free" | "follow" | "tour" | "ride";

/** opacity strings 0.00 .. 1.00, made once (setting a style from a number would make a string every frame) */
const OPACITY: string[] = Array.from({ length: 101 }, (_, i) => String(i / 100));
/** How long the screen takes to come back from black when a cinematic mode ends (s). */
const OUTRO = 0.35;
/** A followed vehicle that arrives: seconds to wait on the spot for the same truck to set off again. */
const HOLD = 4.5;
/** Recent happenings kept for the tour (deliveries, towns growing, landmarks): a fixed ring, no allocation. */
const EVENTS = 24;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class CameraDirector {
  mode: CamMode = "free";
  // ---- follow
  private session: FollowSession | null = null;
  private cam = new FollowCam();
  private haul: HaulKey = { plant: -1, dest: -1, leg: "out", t: 0 };
  private hasHaul = false;
  /** the vehicle drawn now: its middle, heading and speed (m/s of sim time) */
  private vx = 0;
  private vy = 0;
  private vdx = 1;
  private vdy = 0;
  private vang = 0;
  private vspeed = 0;
  private vIdx = -1;
  /** easing in to a closer zoom as a follow starts; stops as soon as the player zooms */
  private zoomTo = 0;
  private setH = 0;
  private chipKey = "";
  // ---- cinematic
  private saved: { cx: number; cy: number; h: number; rot: number; overlay: OverlayId; tool: ToolId; paused: boolean } | null = null;
  private shot: Shot | null = null;
  private shotT = 0;
  private intro = 0;
  private outro = 0;
  private lost = false;
  private hist = new ShotHistory();
  private rideRecent: number[] = [];
  private pose: Pose = { x: 0, y: 0, h: 100, rot: 0 };
  private rideCam = new FollowCam();
  private grid = new ActivityGrid(100);
  private black = 0;
  /** seconds the "Esc to exit" hint has left on screen */
  private hintT = 0;
  private shownBlack = -1;
  private clock = 0;
  private ev = Array.from({ length: EVENTS }, () => ({ x: 0, y: 0, t: -1e9 }));
  private evN = 0;
  private layer = document.createElement("div");
  private fadeEl = document.createElement("div");
  private hintEl = document.createElement("div");
  rand: () => number = Math.random;

  constructor(private app: App) {
    this.layer.className = "cine";
    this.fadeEl.className = "cine-fade";
    this.fadeEl.hidden = true;
    this.fadeEl.setAttribute("aria-hidden", "true");
    this.hintEl.className = "cine-hint";
    this.hintEl.hidden = true;
    this.hintEl.setAttribute("aria-live", "polite");
    this.layer.append(this.fadeEl, this.hintEl);
    document.body.appendChild(this.layer);
  }

  get following(): number | null {
    return this.mode === "follow" && this.session ? this.session.id : null;
  }

  get cinematic(): boolean {
    return this.mode === "tour" || this.mode === "ride";
  }

  /** Something happened worth a look (a delivery, a town grown): the tour weighs places like it. */
  note(x: number, y: number) {
    const e = this.ev[this.evN++ % EVENTS];
    e.x = x;
    e.y = y;
    e.t = this.clock;
  }

  // ------------------------------------------------------------------------------------- vehicles

  private find(id: number): Vehicle | null {
    const vs = this.app.game.traffic.vehicles;
    const i = this.vIdx;
    if (i >= 0 && i < vs.length && vs[i].id === id) return vs[i];
    for (let k = 0; k < vs.length; k++) if (vs[k].id === id) { this.vIdx = k; return vs[k]; }
    this.vIdx = -1;
    return null;
  }

  /** Where a vehicle is drawn now (its middle, between its last two sim steps), its heading and speed: into fields. */
  private locate(v: Vehicle, alpha: number) {
    const U = v.uPose, P = v.puPose ?? U;
    if (U && P && U.length >= 4) {
      let x = 0, y = 0;
      const n = U.length >> 2;
      for (let i = 0; i < n; i++) {
        x += P[i * 4] + (U[i * 4] - P[i * 4]) * alpha;
        y += P[i * 4 + 1] + (U[i * 4 + 1] - P[i * 4 + 1]) * alpha;
      }
      this.vx = x / n;
      this.vy = y / n;
      this.vang = easeAngle(P[3], U[3], alpha);
    } else {
      this.vang = easeAngle(v.pang, v.ang, alpha);
      const half = v.len * 0.5;
      this.vx = v.px + (v.x - v.px) * alpha - Math.cos(this.vang) * half;
      this.vy = v.py + (v.y - v.py) * alpha - Math.sin(this.vang) * half;
    }
    this.vdx = Math.cos(this.vang);
    this.vdy = Math.sin(this.vang);
    this.vspeed = Math.max(0, v.v);
  }

  /** Real-time speed of the drawn vehicle: sim speed times the game speed (0 while paused). */
  private realSpeed(): number {
    const g = this.app.game;
    return g.paused ? 0 : this.vspeed * g.speed;
  }

  private present(v: Vehicle | null): v is Vehicle {
    return !!v && !v.arrived;
  }

  /** The vehicles worth riding with, as candidates (once per shot). */
  private candidates(): RideCandidate[] {
    const out: RideCandidate[] = [];
    const a = this.app.game.alpha;
    for (const v of this.app.game.traffic.vehicles) {
      if (v.arrived || v.lost || v.exit || v.fade < 1 || v.leaving > 0 || v.dwell) continue;
      this.locate(v, a);
      const r = v.trip.haul;
      out.push({ id: v.id, x: this.vx, y: this.vy, truck: v.truck, cls: r?.cls, big: !!r?.big && !r.done, speed: v.v, bus: !!v.trip.bus });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------- follow

  /** Follow a vehicle with the camera. False if it isn't on the road. */
  followVehicle(id: number): boolean {
    const v = this.find(id);
    if (!this.present(v)) return false;
    if (this.cinematic) this.exitCinema();
    const app = this.app, view = app.view;
    app.cancelGlide();
    this.mode = "follow";
    this.session = new FollowSession(id, HOLD);
    this.hasHaul = false;
    this.locate(v, app.game.alpha);
    this.cam.start(view.cx, view.cy, this.vx, this.vy);
    // close enough to see the truck, unless the player is already in close
    this.zoomTo = view.halfH > 220 ? 150 : 0;
    this.setH = view.halfH;
    this.chipKey = "";
    this.syncChip(v);
    app.convoyTags.mark(id);
    return true;
  }

  /** Let go of the followed vehicle (a pan, the chip's Stop, a build tool's click: cinema.followOn). */
  stopFollow() {
    if (this.mode !== "follow") return;
    this.mode = "free";
    this.session = null;
    this.zoomTo = 0;
    this.chipKey = "";
    this.app.hud?.followChip(null);
    this.app.convoyTags.mark(null);
  }

  /** G: follow the truck nearest the middle of the screen (or let go of the one followed). */
  toggleFollowNearest(): boolean {
    if (this.following !== null) { this.stopFollow(); return true; }
    const view = this.app.view;
    const cands = this.candidates();
    const c = nearestRide(cands, view.cx, view.cy, view.halfH * 2.5) ?? nearestRide(cands, view.cx, view.cy, Infinity);
    if (!c) { this.app.hud?.toast("No trucks on the road yet", true); return false; }
    return this.followVehicle(c.id);
  }

  private updateFollow(dt: number) {
    const app = this.app, g = app.game, view = app.view, s = this.session!;
    let v = this.find(s.id);
    const here = this.present(v);
    if (here) {
      const r = v!.trip.haul;
      if (r && !r.big) {
        this.hasHaul = true;
        this.haul.plant = r.plant; this.haul.dest = r.dest; this.haul.leg = r.leg; this.haul.cls = r.cls;
      } else this.hasHaul = false;
    }
    const was = s.phase;
    let phase = s.update(here, dt);
    if (phase === "hold") {
      if (was === "track") { this.haul.t = g.time; this.syncChip(null); }
      // the same truck pulling out on its next run: carry on with it, the camera gliding over from where it is
      const nx = this.hasHaul ? successorOf(this.haul, g.traffic.vehicles) : null;
      if (nx !== null) {
        s.retarget(nx);
        v = this.find(nx);
        if (this.present(v)) {
          this.locate(v, g.alpha);
          this.cam.start(view.cx, view.cy, this.vx, this.vy);
          app.convoyTags.mark(nx);
          this.syncChip(v);
          phase = "track";
        }
      }
    }
    if (phase === "done") { this.stopFollow(); return; }
    if (phase === "track" && this.present(v)) {
      this.locate(v, g.alpha);
      this.cam.step(this.vx, this.vy, this.vdx, this.vdy, this.realSpeed(), view.halfH, dt);
    } else {
      // holding where it went: the look-ahead settles back onto the spot
      this.cam.step(this.vx, this.vy, this.vdx, this.vdy, 0, view.halfH, dt);
    }
    view.cx = this.cam.x;
    view.cy = this.cam.y;
    if (this.zoomTo > 0) {
      // (the player zoomed: their zoom wins)
      if (Math.abs(view.halfH - this.setH) > 1e-6) this.zoomTo = 0;
      else {
        view.halfH += (this.zoomTo - view.halfH) * (1 - Math.exp(-dt * 2.4));
        if (Math.abs(view.halfH - this.zoomTo) < 1) { view.halfH = this.zoomTo; this.zoomTo = 0; }
        this.setH = view.halfH;
      }
    }
  }

  /** The chip at the foot of the screen: "Following · Heavy truck · Coal to the Smelter · Stop". */
  private syncChip(v: Vehicle | null) {
    const key = v ? `v${v.id}` : "hold";
    if (key === this.chipKey) return;
    this.chipKey = key;
    if (!v) { this.app.hud?.followChip({ what: "Arrived", sub: this.hasHaul ? "waiting for its next run" : "" }); return; }
    this.app.hud?.followChip(this.describe(v));
  }

  /** What a vehicle is, in words for the chip. */
  describe(v: Vehicle): { what: string; sub: string } {
    const g = this.app.game, r = v.trip.haul;
    const name = (id: number) => {
      const b = g.buildings.byId.get(id);
      if (!b) return "";
      const town = b.town !== undefined && !b.placed ? g.towns.byId.get(b.town)?.name : undefined;
      return town ?? `the ${BUILDING_TYPES[b.kind].name}`;
    };
    if (r?.big) return { what: "Oversize load", sub: `${BIG_NAME[r.big as BigKind]}${name(r.dest) ? ` to ${name(r.dest)}` : ""}` };
    if (r) {
      const cls = TRUCK_CLASSES[(r.cls ?? "light") as TruckClass].name;
      const cargo = PRODUCTS[r.product as Product]?.name ?? "";
      if (r.leg === "back") return { what: cls, sub: `empty, back to ${name(r.plant) || "its yard"}` };
      return { what: cls, sub: `${cargo}${name(r.dest) ? ` to ${name(r.dest)}` : ""}` };
    }
    if (v.trip.bus) return { what: "Bus", sub: "on its round" };
    return { what: v.truck ? "Truck" : "Car", sub: "" };
  }

  // ------------------------------------------------------------------------------------- cinematic

  /** T / Shift+T, or the camera menu: start a cinematic mode (any key or click ends it, in App.onKey / onDown). */
  startCinema(kind: "tour" | "ride") {
    const app = this.app, view = app.view;
    if (app.mode === "menu" || !app.game) return;
    if (this.mode === "follow") this.stopFollow();
    if (!this.saved) {
      this.saved = { cx: view.cx, cy: view.cy, h: view.halfH, rot: view.rot, overlay: app.overlay, tool: app.st.tool, paused: app.game.paused };
      app.enterCinema();
    }
    this.mode = kind;
    this.shot = null;
    this.shotT = 0;
    this.hist.clear();
    this.rideRecent.length = 0;
    // the live view fades out first, then the first shot fades in
    this.intro = FADE;
    this.outro = 0;
    // (shown before its words go in, so a screen reader hears them)
    this.hintEl.hidden = false;
    this.hintEl.innerHTML = `<b>${kind === "tour" ? "Tour" : "Vehicle cam"}</b><span><kbd>Esc</kbd> to exit</span>`;
    this.hintEl.classList.remove("go");
    void this.hintEl.offsetWidth; // (restart the fade-out)
    this.hintEl.classList.add("go");
    this.hintT = 2.6;
  }

  /**
   * Leave the cinematic mode: the HUD back, and (unless `restore` is false: a new game, the title menu) the camera,
   * info view, tool and pause as they were, back from black.
   */
  exitCinema(restore = true) {
    if (!this.cinematic) return;
    const s = this.saved, app = this.app, view = app.view;
    this.mode = "free";
    this.shot = null;
    this.hintEl.hidden = true;
    if (s && restore) {
      view.cx = s.cx; view.cy = s.cy; view.halfH = s.h; view.rot = s.rot;
      app.leaveCinema(s.overlay, s.tool, s.paused);
    } else app.leaveCinema("none", "inspect", false);
    this.saved = null;
    this.outro = OUTRO;
    this.black = 1;
  }

  /** Drop every mode at once, with nothing restored (a new game, the title menu). */
  reset() {
    if (this.cinematic) this.exitCinema(false);
    this.stopFollow();
    this.outro = 0;
    this.black = 0;
    this.hist.clear();
    this.evN = 0;
    for (const e of this.ev) e.t = -1e9;
  }

  private spotInputs(): SpotInputs {
    const g = this.app.game, a = g.alpha;
    const junctions: SpotInputs["junctions"] = [];
    for (const n of g.net.nodes.values()) {
      const ng = g.net.nodeGeom.get(n.id);
      if (ng && ng.kind === "junction" && ng.arms.length >= 3) junctions.push({ id: n.id, x: n.p.x, y: n.p.y, arms: ng.arms.length });
    }
    const bridges: SpotInputs["bridges"] = [];
    for (const [id, sg] of g.net.segGeom) {
      let hi = 0, at = -1;
      for (let i = 0; i < sg.hs.length; i++) if (sg.hs[i] > hi) { hi = sg.hs[i]; at = i; }
      if (hi >= 4 && at >= 0 && sg.center.pts[at]) bridges.push({ id, x: sg.center.pts[at].x, y: sg.center.pts[at].y, len: sg.center.length });
    }
    const convoys: SpotInputs["convoys"] = [];
    for (const v of g.traffic.vehicles) {
      if (!v.trip.haul?.big || v.trip.haul.done || v.arrived) continue;
      this.locate(v, a);
      convoys.push({ id: v.id, x: this.vx, y: this.vy });
    }
    const events: SpotInputs["events"] = [];
    for (const e of this.ev) if (e.t > -1e8) events.push({ x: e.x, y: e.y, age: this.clock - e.t });
    return {
      vehicles: g.traffic.vehicles,
      junctions,
      towns: g.towns.list.map((t) => ({ id: t.id, x: t.c.x, y: t.c.y, pop: t.pop })),
      sites: g.buildings.sites.filter((b) => b.plant).map((b) => ({ id: b.id, x: b.c.x, y: b.c.y, size: Math.max(b.hw, b.hd), level: b.level, running: !b.plant!.site && b.built >= 1 && !b.problem })),
      convoys,
      bridges,
      events,
    };
  }

  /** Cut to the next shot (under black). */
  private nextShot() {
    const app = this.app, view = app.view, g = app.game;
    const prevH = this.shot ? this.pose.h : 0;
    const baseRot = this.saved?.rot ?? view.rot;
    const still = reduced();
    let shot: Shot | null = null;
    let at: { x: number; y: number; key: string } | null = null;
    if (this.mode === "ride") {
      const cands = this.candidates();
      const last = this.hist.last;
      const c = pickRide(cands, this.rideRecent, last, this.rand);
      if (c) {
        shot = planRide(c.id, prevH, this.rand, still);
        at = { x: c.x, y: c.y, key: `v${c.id}` };
        this.rideRecent.push(c.id);
        if (this.rideRecent.length > 6) this.rideRecent.shift();
      }
    }
    if (!shot) {
      const spots = gatherSpots(this.spotInputs(), this.grid);
      let spot: Spot | null = pickSpot(spots, this.hist, this.rand);
      // (nowhere else to go, on an empty map: over the start, wider)
      if (!spot) spot = { kind: "town", x: this.saved?.cx ?? view.cx, y: this.saved?.cy ?? view.cy, h: 300, w: 1, key: "home" };
      shot = planShot(spot, baseRot, prevH, this.rand, view.w / view.h, still);
      at = spot;
    }
    this.shot = shot;
    this.shotT = 0;
    this.lost = false;
    if (shot.move === "track") {
      const v = this.find(shot.vehicle!);
      if (this.present(v)) {
        this.locate(v, g.alpha);
        this.rideCam.start(this.vx, this.vy, this.vx, this.vy);
      }
      view.rot = shot.chase ? chaseRot(this.vang) : baseRot;
      this.hist.push({ x: this.vx, y: this.vy, h: shot.from.h, key: at!.key });
    } else this.hist.push({ x: at!.x, y: at!.y, h: shot.from.h, key: at!.key });
    this.applyShot(0);
  }

  /** Put the view where the shot is `dt` s on (and the fade with it). */
  private applyShot(dt: number) {
    const s = this.shot!, app = this.app, view = app.view, g = app.game;
    evalShot(s, this.shotT, this.pose);
    if (s.move === "track") {
      const v = this.find(s.vehicle!);
      if (this.present(v)) this.locate(v, g.alpha);
      else if (!this.lost) {
        // it got there (or gave up): hold on the spot and fade to the next one now
        this.lost = true;
        s.dur = Math.min(s.dur, cutShort(this.shotT));
      }
      this.rideCam.step(this.vx, this.vy, this.vdx, this.vdy, this.lost ? 0 : this.realSpeed(), this.pose.h, dt);
      view.cx = this.rideCam.x;
      view.cy = this.rideCam.y;
      view.halfH = this.pose.h;
      if (s.chase && !this.lost) view.rot = easeAngle(view.rot, chaseRot(this.vang), 1 - Math.exp(-dt * 0.9));
    } else {
      view.cx = this.pose.x;
      view.cy = this.pose.y;
      view.halfH = this.pose.h;
      view.rot = this.pose.rot;
    }
    this.black = fadeAt(this.shotT, s.dur);
  }

  private updateCinema(dt: number) {
    if (this.intro > 0) {
      this.intro -= dt;
      this.black = Math.min(1, 1 - this.intro / FADE);
      if (this.intro <= 0) this.nextShot();
      return;
    }
    if (!this.shot) { this.nextShot(); return; }
    this.shotT += dt;
    if (this.shotT >= this.shot.dur) { this.nextShot(); return; }
    this.applyShot(dt);
  }

  // ------------------------------------------------------------------------------------- per frame

  /** Move the camera for this frame (after the game has stepped). */
  update(dt: number) {
    this.clock += dt;
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.hintEl.hidden = true;
    if (this.mode === "follow") this.updateFollow(dt);
    else if (this.cinematic) this.updateCinema(dt);
    else if (this.outro > 0) {
      this.outro = Math.max(0, this.outro - dt);
      this.black = this.outro / OUTRO;
    } else this.black = 0;
    // the fade: only touched when it changes, from the strings made once
    const b = Math.round(Math.max(0, Math.min(1, this.black)) * 100);
    if (b !== this.shownBlack) {
      this.shownBlack = b;
      this.fadeEl.hidden = b === 0;
      this.fadeEl.style.opacity = OPACITY[b];
    }
  }
}
