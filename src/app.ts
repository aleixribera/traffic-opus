import * as THREE from "three";
import { BUILDING_TYPES, LEVEL_H, TILE, MAX_LEVEL, ROAD_TYPES, SIM, roadWidth, type RoadTypeId } from "./config";
import { cubicAt, dist, dot, formatMoney, norm, rectCorners, right, sub, v2, type V2 } from "./core/math";
import type { Building } from "./game/buildings";
import { Game } from "./game/city";
import {
  parallelSpacing, planGrid, planRoad, planRoundabout, removalRefund, segAt, snap,
  type CurveMode, type Plan, type RoundaboutSize, type Snap, type SnapOpts,
} from "./roads/planner";
import { Buildings3D } from "./render/buildings3d";
import { Zones3D } from "./render/zones3d";
import { ZONES, type Cell, type ZoneId } from "./game/zones";
import type { ModelSet } from "./render/models";
import { Preview3D } from "./render/preview3d";
import { Roads3D } from "./render/roads3d";
import { RoadsFar } from "./render/roadsFar";
import { MapLabels } from "./ui/labels";
import { MapIcons } from "./ui/mapIcons";
import { Terrain3D } from "./render/terrain3d";
import { Vehicles3D } from "./render/vehicles3d";
import { View } from "./render/view";
import { Saves } from "./game/saves";
import { SERVICES, type ServiceId, type ServiceKind } from "./game/services";
import type { Hud, Chip } from "./ui/hud";

export type ToolId = "inspect" | "road" | "roundabout" | "junction" | "bulldoze" | "zone" | "unlock" | "service";
/** Zoning tool modes (CS2): fill one side of a street, paint with a brush, or drag a rectangle. */
export type ZoneMode = "fill" | "brush" | "marquee";
/** Road tool modes, as in CS2: the four drawing modes, a 3-click grid, and Replace (change type / reverse). */
export type RoadMode = CurveMode | "grid" | "replace";
export const ROAD_MODES: RoadMode[] = ["straight", "curve", "complex", "continuous", "grid", "replace"];
export type OverlayId = "none" | "flow" | "zones" | "landvalue" | "level" | "problems" | ServiceId;
const SERVICE_VIEWS: OverlayId[] = ["garbage", "fire", "police", "health", "school", "parks"];

export interface ToolState {
  tool: ToolId;
  roadType: RoadTypeId;
  mode: RoadMode;
  level: number;
  rbSize: RoundaboutSize;
  /** Also build a parallel road; offset in metres (null = side by side with a 4 m median). */
  parallel: boolean;
  parOffset: number | null;
  /** Snapping menu: which kinds are switched off, and 8 m length steps. */
  snapOff: { geometry: boolean; guides: boolean; netSide: boolean };
  snapLength: boolean;
  zone: ZoneId;
  zoneMode: ZoneMode;
  brush: number; // brush radius, m
  erase: boolean; // zoning tool removes zoning
  bdzLevel: number | null; // bulldozer elevation filter (null = all)
  reverse: boolean; // upgrade tool flips one-ways instead
  service: ServiceKind; // service building being placed
}

interface PointerInfo { id: number; x: number; y: number; sx: number; sy: number; button: number; moved: boolean; t: number }

export class App {
  game!: Game;
  view: View;
  roads!: Roads3D;
  roadsFar!: RoadsFar;
  labels = new MapLabels();
  icons = new MapIcons();
  private iconT = 0;
  vehicles!: Vehicles3D;
  buildings3d!: Buildings3D;
  terrain3d!: Terrain3D;
  preview = new Preview3D();
  saves = new Saves();
  hud!: Hud;
  st: ToolState = {
    tool: "inspect", roadType: "street", mode: "straight", level: 0, rbSize: 1, parallel: false, parOffset: null,
    snapOff: { geometry: false, guides: false, netSide: false }, snapLength: false, zone: "resLow", zoneMode: "fill", brush: 22, erase: false, bdzLevel: null, reverse: false,
    service: "garbage",
  };
  uiHidden = false;
  /** menu: the showcase city playing behind the title menu (no input, no saving); explore: that city, free to look round, never saved. */
  mode: "menu" | "play" | "explore" = "play";
  /** Set at boot: back to the title menu. */
  openMenu?: () => void;
  private modeListeners: ((m: App["mode"]) => void)[] = [];
  overlay: OverlayId = "none";
  zones3d!: Zones3D;
  selected: Building | null = null;
  private worldRoot = new THREE.Group();
  private cursor: V2 = v2(0, 0);
  private cursorPx: V2 = v2(0, 0);
  private hasCursor = false;
  // road tool state
  private anchor: Snap | null = null;
  private startTangent: V2 | undefined;
  private ctrl: V2 | null = null;
  private ctrl2: V2 | null = null;
  /** Where the parallel road's last piece ended (to carry on from it). */
  private parFrom: Snap | undefined;
  private plan: Plan | null = null;
  // drag state
  private pointers = new Map<number, PointerInfo>();
  /** Bulldozer marquee, in screen pixels (the view may be turned). */
  private dragRect: { a: V2; b: V2 } | null = null;
  /** A zoning brush or marquee stroke in progress. */
  private zoneStroke: { erase: boolean; cells: Set<Cell>; last: V2; a: V2; b: V2; pointer: number } | null = null;
  private pinch: { d: number; mid: V2; ang: number } | null = null;
  private keys = new Set<string>();
  private last = performance.now();
  private hudT = 0;
  private flowT = 0;
  private saveT = 0;
  private dirtyPreview = true;
  private shake = 0;
  /** What a service building placed at the cursor would cover (seg -> level), keyed by where it would stand. */
  private svcReach: { key: string; cov: Map<number, number> } | null = null;
  private covShown = false;
  private covT = 0;

  constructor(canvas: HTMLCanvasElement, private models: ModelSet) {
    this.view = new View(canvas);
    this.view.scene.add(this.worldRoot);
    this.view.scene.add(this.preview.group);
  }

  // ---------------------------------------------------------------- setup

  attachHud(h: Hud) {
    this.hud = h;
  }

  setMode(m: App["mode"]) {
    this.mode = m;
    document.body.classList.toggle("in-menu", m === "menu");
    document.body.classList.toggle("exploring", m === "explore");
    if (m === "menu") { this.cancelStroke(); this.selected = null; this.setTool({ tool: "inspect" }); this.hasCursor = false; this.hud?.chips(null); }
    this.saveT = 0;
    for (const f of this.modeListeners) f(m);
    this.hud?.refresh();
  }

  onMode(f: (m: App["mode"]) => void) {
    this.modeListeners.push(f);
  }

  /** Run the simulation ahead by `seconds` of game time (a few frames' work at a time), so traffic is already flowing. */
  async prewarm(seconds: number, progress?: (k: number) => void) {
    const g = this.game, n = Math.round(seconds / SIM.dt);
    for (let i = 0; i < n;) {
      const t0 = performance.now();
      while (i < n && performance.now() - t0 < 40) { g.step(SIM.dt); i++; }
      progress?.(i / n);
      if (g !== this.game) return;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  newGame(seed = 7) {
    this.setGame(new Game(seed));
    // open on the town site with the motorway you connect to in view
    let best = v2(0, 0), bd = Infinity;
    for (const s of this.game.net.segs.values()) {
      for (let i = 0; i <= 16; i++) {
        const p = cubicAt(s.c, i / 16), d = Math.hypot(p.x, p.y);
        if (d < bd) { bd = d; best = p; }
      }
    }
    const far = bd < 900;
    this.view.cx = far ? best.x * 0.5 : 0;
    this.view.cy = far ? best.y * 0.5 : 0;
    this.view.halfH = far ? Math.max(170, bd * 0.62) : 170;
  }

  loadGame(data: ReturnType<Game["serialize"]>) {
    this.setGame(Game.load(data));
  }

  private setGame(g: Game) {
    this.game = g;
    this.view.rot = 0;
    this.hud?.compassAngle(0);
    for (const c of [...this.worldRoot.children]) this.worldRoot.remove(c);
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.terrain3d = new Terrain3D(g.terrain, small);
    this.roads = new Roads3D(g.net);
    this.roadsFar = new RoadsFar(g.net);
    this.terrain3d.setGateways(g.gateways);
    this.labels.set(g.gateways.map((gw) => ({ p: gw.p, name: gw.name, sub: GATEWAY_LABEL[gw.kind], minHalfH: 900 })));
    this.vehicles = new Vehicles3D(this.models);
    this.buildings3d = new Buildings3D(this.models);
    this.zones3d = new Zones3D(g.zones);
    this.zones3d.setGrid(this.st.tool === "zone" || this.overlay === "zones");
    this.worldRoot.add(this.terrain3d.group, this.zones3d.group, this.roads.group, this.roadsFar.group, this.buildings3d.group, this.vehicles.group);
    this.roads.rebuildAll();
    this.buildings3d.rebuild(g.buildings.list);
    this.terrain3d.setTiles(g.tiles);
    g.on((e) => {
      if (e.t === "roads") { this.roads.apply(e.cs); this.roadsFar.invalidate(); this.buildings3d.rebuildDrives(g.buildings.list); this.dirtyPreview = true; }
      else if (e.t === "buildings") { this.buildings3d.rebuild(g.buildings.list); this.applyTint(); this.dirtyPreview = true; }
      else if (e.t === "tiles") this.terrain3d.setTiles(g.tiles);
      else if (e.t === "zones") this.dirtyPreview = true;
      else if (e.t === "milestone") { if (this.mode === "play") this.hud?.milestone(e.index); }
      else if (e.t === "toast") { if (this.mode !== "menu") this.hud?.toast(e.msg); }
      this.hud?.refresh();
    });
    this.cancelStroke();
    this.selected = null;
    this.hud?.refresh();
  }

  // ---------------------------------------------------------------- tools

  setTool(p: Partial<ToolState>) {
    const prev = this.st.tool, prevMode = this.st.mode;
    Object.assign(this.st, p);
    if ((p.tool && p.tool !== prev) || (p.mode && p.mode !== prevMode)) this.cancelStroke();
    // locked road types can't be picked (keyboard, saved state)
    if (!this.game.roadsUnlocked.has(this.st.roadType)) this.st.roadType = "street";
    if ((this.st.tool === "roundabout" && !this.game.featureUnlocked("roundabout"))) this.st.tool = "inspect";
    if (!this.game.zonesUnlocked.has(this.st.zone)) this.st.zone = "resLow";
    if (this.st.tool === "service" && !this.game.serviceUnlocked(this.st.service)) this.st.tool = "inspect";
    if (this.st.tool !== "service") this.svcReach = null;
    this.covT = 1; // refresh the coverage view now
    if (this.buildings3d) this.applyTint();
    this.zones3d?.setGrid(this.st.tool === "zone" || this.overlay === "zones");
    if (this.st.tool !== "zone") { this.zoneStroke = null; this.zones3d?.highlight([], null); }
    if (this.st.tool !== "inspect") { this.selected = null; this.hud?.closePanels(); }
    this.dirtyPreview = true;
    this.hud?.refresh();
  }

  setLevel(l: number) {
    this.setTool({ level: Math.max(0, Math.min(MAX_LEVEL, l)) });
  }

  setOverlay(o: OverlayId) {
    this.overlay = this.overlay === o ? "none" : o;
    this.roads.flowMode = this.overlay === "flow";
    this.covShown = false;
    this.covT = 1;
    this.zones3d?.setGrid(this.st.tool === "zone" || this.overlay === "zones");
    this.applyTint();
    this.hud?.refresh();
  }

  /** The service whose coverage is on show: its info view, or the one being placed (CS2 shows it while placing). */
  coverageView(): ServiceId | null {
    if (SERVICE_VIEWS.includes(this.overlay)) return this.overlay as ServiceId;
    if (this.overlay === "none" && this.st.tool === "service") return SERVICES[this.st.service].svc;
    return null;
  }

  /** Roads tinted by coverage (plus what the building at the cursor would add). */
  private updateCoverage() {
    const svc = this.coverageView();
    if (!svc || svc === "parks") {
      if (this.covShown) { this.roads.coverage(null); this.roads.flowMode = this.overlay === "flow"; this.covShown = false; }
      return;
    }
    const cov = this.game.services.segCoverage(svc);
    if (this.svcReach) for (const [s, l] of this.svcReach.cov) if (l > (cov.get(s) ?? 0)) cov.set(s, l);
    this.roads.coverage(cov);
    this.covShown = true;
  }

  /** Building colours for overlays. */
  applyTint() {
    const g = this.game;
    const mode = this.overlay;
    const cv = this.coverageView();
    if (cv) {
      // coverage: buildings in reach go green (darker = better served), the rest grey; the service's own buildings stand out
      this.buildings3d.tint((b) => {
        if (b.svc) return SERVICES[b.kind as ServiceKind]?.svc === cv ? 0x2f86e0 : 0xc9c9c9;
        const c = g.services.cov.get(b.id)?.[cv] ?? 0;
        return c <= 0 ? 0xc4c4c4 : covRamp(c);
      });
      return;
    }
    if (mode === "none" || mode === "flow") { this.buildings3d.tint(null); return; }
    this.buildings3d.tint((b) => {
      if (!b.zone) return 0xb5b5b5;
      if (mode === "zones") return ZONES[b.zone].color;
      if (mode === "landvalue") return ramp(b.lv / 80);
      if (mode === "level") return ramp((b.level - 1) / 4);
      // problems
      return b.abandoned || b.problem ? 0xe5484d : b.built < 1 ? 0xd8c9a0 : 0xb5c9b8;
    });
    void g;
  }

  cancelStroke() {
    this.anchor = null;
    this.startTangent = undefined;
    this.ctrl = null;
    this.ctrl2 = null;
    this.parFrom = undefined;
    this.plan = null;
    this.dragRect = null;
    this.zoneStroke = null;
    this.zones3d?.highlight([], null);
    this.dirtyPreview = true;
    this.hud?.rect(null);
  }

  // ---------------------------------------------------------------- input

  bindInput(el: HTMLElement) {
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => { this.pointers.delete(e.pointerId); this.pinch = null; });
    el.addEventListener("pointerleave", () => { this.hasCursor = false; this.dirtyPreview = true; this.hud?.chips(null); });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.mode === "menu") return;
      const r = el.getBoundingClientRect();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
      this.view.zoomAt(e.clientX - r.left, e.clientY - r.top, k);
      this.clampView();
      this.dirtyPreview = true;
    }, { passive: false });
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("resize", () => this.view.resize());
    window.addEventListener("blur", () => this.keys.clear());
  }

  private local(e: PointerEvent): V2 {
    const r = this.view.canvas.getBoundingClientRect();
    return v2(e.clientX - r.left, e.clientY - r.top);
  }

  private onDown(e: PointerEvent) {
    if (this.mode === "menu") return;
    const p = this.local(e);
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    this.pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, button: e.button, moved: false, t: performance.now() });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: v2((a.x + b.x) / 2, (a.y + b.y) / 2), ang: Math.atan2(b.y - a.y, b.x - a.x) };
      this.dragRect = null;
      this.hud?.rect(null);
      if (this.zoneStroke) { this.zoneStroke = null; this.zones3d.highlight([], null); this.hud?.rect(null); }
      return;
    }
    this.updateCursor(p);
    if (this.st.tool === "zone" && this.st.zoneMode !== "fill" && (e.button === 0 || e.button === 2)) {
      this.zoneStroke = { erase: e.button === 2 || this.st.erase, cells: new Set(), last: this.cursor, a: p, b: p, pointer: e.pointerId };
      if (this.st.zoneMode === "brush") this.brushTo(this.cursor);
      this.dirtyPreview = true;
      return;
    }
    if (e.button === 0 && e.pointerType !== "touch" && this.st.tool === "bulldoze") this.dragRect = { a: p, b: p };
  }

  /** Grown buildings a road plan would clear: outlined red, with a count. */
  private lotWarning(plan: Plan, chips: Chip[]) {
    if (plan.errors.length) return;
    const lots = this.game.lotsUnder(plan);
    for (const b of lots) this.preview.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
    if (lots.length) chips.push({ text: `${lots.length} building${lots.length === 1 ? "" : "s"} demolished`, kind: "error" });
  }

  /** Brush stroke: add the cells swept from the last point to p. */
  private brushTo(p: V2) {
    const zs = this.zoneStroke!;
    const r = this.st.brush;
    const d = dist(zs.last, p);
    const n = Math.max(1, Math.ceil(d / (r * 0.5)));
    for (let k = d < 0.01 ? n : 1; k <= n; k++) {
      const q = v2(zs.last.x + ((p.x - zs.last.x) * k) / n, zs.last.y + ((p.y - zs.last.y) * k) / n);
      for (const c of this.game.zones.near(q, r)) if (c.ok) zs.cells.add(c);
    }
    zs.last = p;
  }

  /** Cells inside a screen rectangle (marquee zoning; the view may be turned). */
  private cellsInScreenRect(a: V2, b: V2): Cell[] {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const poly = [this.view.toWorld(x0, y0), this.view.toWorld(x1, y0), this.view.toWorld(x1, y1), this.view.toWorld(x0, y1)];
    return this.game.zones.inPoly(poly).filter((c) => c.ok);
  }

  /** The cells a fill click at p would change: the run of same-zoned cells on that side of the street. */
  private fillCells(p: V2, erase: boolean): Cell[] {
    const c = this.game.zones.cellAt(p);
    if (!c || !c.ok) return [];
    const want = c.zone;
    if (erase && !want) return [];
    return c.block.cells.filter((x) => x.ok && x.zone === want);
  }

  private finishZoneStroke() {
    const zs = this.zoneStroke!;
    this.zoneStroke = null;
    this.hud?.rect(null);
    this.zones3d.highlight([], null);
    const cells = this.st.zoneMode === "marquee" ? this.cellsInScreenRect(zs.a, zs.b) : [...zs.cells];
    this.paintZone(cells, zs.erase);
  }

  private paintZone(cells: Cell[], erase: boolean) {
    if (!cells.length) return;
    const n = this.game.zonePaint(cells, erase ? null : this.st.zone);
    if (n) this.hud?.sound(erase ? "remove" : "place");
    this.dirtyPreview = true;
  }

  private onMove(e: PointerEvent) {
    if (this.mode === "menu") return;
    const p = this.local(e);
    const pi = this.pointers.get(e.pointerId);
    if (this.pinch && this.pointers.size === 2 && pi) {
      pi.x = p.x; pi.y = p.y;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.view.pan(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      this.view.zoomAt(mid.x, mid.y, this.pinch.d / Math.max(d, 1));
      // two-finger twist turns the map with the fingers
      const da = Math.atan2(Math.sin(ang - this.pinch.ang), Math.cos(ang - this.pinch.ang));
      if (Math.abs(da) < 0.5) this.view.rotateAt(mid.x, mid.y, -da);
      this.pinch = { d, mid, ang };
      this.clampView();
      return;
    }
    if (pi && this.zoneStroke && this.zoneStroke.pointer === pi.id) {
      if (Math.hypot(p.x - pi.sx, p.y - pi.sy) > 4) pi.moved = true;
      pi.x = p.x; pi.y = p.y;
      this.updateCursor(p);
      const zs = this.zoneStroke;
      zs.b = p;
      if (this.st.zoneMode === "brush") this.brushTo(this.cursor);
      else if (pi.moved) this.hud?.rect([zs.a, zs.b]);
      return;
    }
    if (pi) {
      const dx = p.x - pi.x, dy = p.y - pi.y;
      if (Math.hypot(p.x - pi.sx, p.y - pi.sy) > (e.pointerType === "touch" ? 10 : 5)) pi.moved = true;
      // CS2 mouse: right-drag moves the map, middle-drag turns it; left-drag also moves it outside of drawing
      if (pi.button === 1) {
        if (pi.moved) this.view.rotateAt(this.view.w / 2, this.view.h / 2, -dx * 0.006);
        pi.x = p.x; pi.y = p.y;
        this.updateCursor(p);
        return;
      }
      const panning = pi.button === 2 || (pi.button === 0 && !this.dragRect && (this.st.tool === "inspect" || e.pointerType === "touch" || this.keys.has(" ")));
      if (panning && pi.moved) {
        this.view.pan(dx, dy);
        this.clampView();
      }
      pi.x = p.x; pi.y = p.y;
      if (panning) { this.updateCursor(p); return; }
    }
    if (e.target !== this.view.canvas && !pi) { return; }
    this.updateCursor(p);
    if (this.dragRect) {
      this.dragRect.b = p;
      if (pi?.moved) this.hud?.rect([this.dragRect.a, this.dragRect.b]);
    }
  }

  private onUp(e: PointerEvent) {
    const pi = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    if (!pi) return;
    const p = this.local(e);
    if (this.zoneStroke && this.zoneStroke.pointer === pi.id) {
      this.zoneStroke.b = p;
      this.finishZoneStroke();
      return;
    }
    if (this.dragRect && pi.moved && pi.button === 0) {
      this.finishRect();
      return;
    }
    this.dragRect = null;
    this.hud?.rect(null);
    if (pi.moved) return;
    this.updateCursor(p);
    if (pi.button === 2) {
      // zoning: right-click unzones that side of the street (CS2)
      if (this.st.tool === "zone") { this.paintZone(this.fillCells(this.cursor, true), true); return; }
      // right click undoes the last click; with nothing to undo it puts the tool down (CS2)
      if (!this.stepBack() && this.st.tool !== "inspect") this.setTool({ tool: "inspect" });
      return;
    }
    if (pi.button === 0) this.onClick(e.shiftKey);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // the title menu: only Esc, to close a dialog opened from it
    if (this.mode === "menu") { if (down && k === "Escape") this.hud?.back(); return; }
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    // AltGr arrives as Ctrl+Alt: leave it to the plain keys ([ and ] need it on many layouts)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); this.redo(); }
      else if (k === "s") { e.preventDefault(); this.hud?.openSaves(true); }
      return;
    }
    // Esc steps back like CS2: popups, dialogs, panels, the tool, the asset menu, then the pause menu
    if (k === "Escape") { if (!this.hud?.back()) this.hud?.openPause(); }
    else if (k === " ") { e.preventDefault(); if (!e.repeat) this.togglePause(); }
    else if (k === "1") this.setSpeed(1);
    else if (k === "2") this.setSpeed(2);
    else if (k === "3") this.setSpeed(4);
    else if (k === "PageUp") { e.preventDefault(); this.setLevel(this.st.level + 1); }
    else if (k === "PageDown") { e.preventDefault(); this.setLevel(this.st.level - 1); }
    else if (k === "Tab") {
      e.preventDefault();
      const order = ROAD_MODES;
      const i = order.indexOf(this.st.mode);
      this.setTool({ tool: "road", mode: order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length] });
    }
    else if (k === "b") this.setTool({ tool: "bulldoze" });
    else if (k === "m") this.setTool({ tool: this.st.tool === "unlock" ? "inspect" : "unlock" });
    else if (k === "p") this.hud?.toggleWin("progression");
    else if (k === "z") this.hud?.toggleWin("economy");
    else if (k === "c") this.hud?.toggleWin("city");
    else if (k === "x") this.hud?.toggleWin("transport");
    else if (k === "[" || k === "]") this.nudgeParallel(k === "]" ? 1 : -1);
    else if (k === "`" || e.code === "Backquote") this.toggleUi();
    else if (k === "F5") { e.preventDefault(); this.quickSave(); }
    else if (k === "F9") { e.preventDefault(); this.quickLoad(); }
  }

  /** Parallel road spacing for the current type. */
  parallelOffset(): number {
    // a spacing set for a narrower road never lets a wider one overlap its twin
    const min = roadWidth(ROAD_TYPES[this.st.roadType]) + 0.5;
    return Math.max(min, this.st.parOffset ?? parallelSpacing(this.st.roadType));
  }

  /** Turn the map back north-up (the north arrow). */
  resetNorth() {
    this.view.rot = 0;
    if (this.hasCursor) this.updateCursor(this.cursorPx);
    this.dirtyPreview = true;
  }

  nudgeParallel(dir: number) {
    const min = roadWidth(ROAD_TYPES[this.st.roadType]) + 0.5;
    this.setTool({ parallel: true, parOffset: Math.max(min, Math.min(200, Math.round(this.parallelOffset()) + dir)) });
  }

  toggleUi() {
    this.uiHidden = !this.uiHidden;
    document.body.classList.toggle("ui-hidden", this.uiHidden);
  }

  quickSave() {
    if (this.saves.save(this.game, "Quicksave", "quick")) this.hud?.toast("Quicksaved (F9 to load)");
    else this.reject("Couldn't save: browser storage is full");
  }

  quickLoad() {
    const d = this.saves.load("quick");
    if (!d) { this.reject("No quicksave yet (F5 saves)"); return; }
    this.loadGame(d);
    this.hud?.toast("Quickload");
  }

  togglePause() {
    this.game.paused = !this.game.paused;
    this.hud?.refresh();
  }

  setSpeed(s: number) {
    this.game.speed = s;
    this.game.paused = false;
    this.hud?.refresh();
  }

  undo() { this.game.undo(); this.cancelStroke(); }
  redo() { this.game.redo(); this.cancelStroke(); }

  private clampView() {
    const m = 120000;
    this.view.clampTo(-m, -m, m, m);
  }

  private updateCursor(px: V2) {
    this.cursorPx = px;
    this.cursor = this.view.toWorld(px.x, px.y);
    this.hasCursor = true;
    this.dirtyPreview = true;
  }

  private snapOpts(from?: Snap): SnapOpts {
    return {
      mpp: this.view.mpp, level: this.st.level, type: this.st.roadType,
      from: from ? { p: from.p, tangent: this.startTangent ?? from.tangent, on: from } : undefined,
      angleStep: this.keys.has("Shift"),
      off: this.st.snapOff,
      lengthStep: this.st.snapLength ? 8 : 0,
    };
  }

  /** A free point (bend handle, grid side) with guides and angle snapping but never stuck onto a road. */
  private snapFree(from: Snap | null): Snap {
    const o = this.snapOpts(from ?? undefined);
    return snap(this.game.net, this.cursor, { ...o, off: { ...this.st.snapOff, geometry: true }, lengthStep: 0 });
  }

  /** How many clicks the current road mode still needs before it builds. */
  private roadStep(): "start" | "ctrl" | "ctrl2" | "end" {
    if (!this.anchor) return "start";
    const m = this.st.mode;
    if ((m === "curve" || m === "complex" || m === "grid") && !this.ctrl) return "ctrl";
    if (m === "complex" && !this.ctrl2) return "ctrl2";
    return "end";
  }

  // ---------------------------------------------------------------- clicks

  /** Right click (CS2): undo the last click of the road being drawn. */
  /** Undo the last click of a stroke. False when there was nothing to undo. */
  stepBack(): boolean {
    this.dirtyPreview = true;
    if (this.dragRect) { this.dragRect = null; this.hud?.rect(null); }
    else if (this.ctrl2) this.ctrl2 = null;
    else if (this.ctrl) this.ctrl = null;
    else if (this.anchor) { this.anchor = null; this.startTangent = undefined; this.parFrom = undefined; }
    else return false;
    return true;
  }

  private onClick(shift: boolean) {
    const g = this.game;
    const t = this.st.tool;
    const c = this.cursor;
    if (t === "service") {
      const k = this.st.service;
      const pl = g.servicePlan(k, c);
      if (!pl) { this.reject("Place it beside a street"); return; }
      if (!pl.ok) { this.reject(pl.reason ?? "Can't build here"); return; }
      const b = g.placeService(k, c);
      if (!b) { this.reject("Can't build here"); return; }
      this.hud?.sound("build");
      this.hud?.toast(`${BUILDING_TYPES[k].name} built for ${formatMoney(pl.cost)}`);
      this.covT = 1;
      this.dirtyPreview = true;
      return;
    }
    if (t === "zone") {
      if (this.st.zoneMode !== "fill") return;
      const cells = this.fillCells(c, this.st.erase);
      if (!cells.length) { if (!g.zones.cellAt(c)) this.reject("Zone beside a street, avenue or one-way road"); return; }
      this.paintZone(cells, this.st.erase);
      return;
    }
    if (t === "inspect") {
      const b = g.buildings.at(c);
      this.selected = b;
      if (b) this.hud?.openBuilding(b);
      else {
        // clicking a signalised junction opens its editor
        const n = this.nodeAt(c);
        if (n !== null && g.net.nodes.get(n)?.signal) this.hud?.openSignal(n);
        else this.hud?.closePanels();
      }
      return;
    }
    if (t === "road" && this.st.mode === "replace") {
      const id = segAt(g.net, c, 2, null);
      if (id === null) return;
      if (this.st.reverse || shift) {
        if (!g.flip(id)) this.reject("Only one-way roads can be reversed");
        else this.hud?.sound("build");
        return;
      }
      const s = g.net.segs.get(id)!;
      if (s.type === this.st.roadType) { this.reject("Already this road type"); return; }
      const u = g.upgradePlan(id, this.st.roadType);
      if (u.errors.length) { this.reject(u.errors[0].msg); return; }
      if (g.upgrade(id, this.st.roadType)) this.hud?.sound("build");
      return;
    }
    if (t === "road") {
      const step = this.roadStep();
      if (step === "start") {
        this.anchor = snap(g.net, c, this.snapOpts());
        this.startTangent = undefined;
        this.parFrom = undefined;
        this.dirtyPreview = true;
        return;
      }
      if (step === "ctrl") {
        const s = this.snapFree(this.anchor);
        if (dist(s.p, this.anchor!.p) < (this.st.mode === "grid" ? 30 : 4)) { this.reject(this.st.mode === "grid" ? "Make the grid wider" : "Click further away"); return; }
        this.ctrl = s.p;
        this.dirtyPreview = true;
        return;
      }
      if (step === "ctrl2") {
        this.ctrl2 = this.snapFree(this.anchor).p;
        this.dirtyPreview = true;
        return;
      }
      if (this.st.mode === "grid") {
        const plan = this.computeGrid();
        if (!plan) return;
        if (plan.errors.length) { this.reject(plan.errors[0].msg); return; }
        if (g.build(plan)) { this.hud?.sound("build"); this.cancelStroke(); }
        return;
      }
      const plan = this.computeRoadPlan();
      if (!plan) return;
      if (plan.errors.length) { this.reject(plan.errors[0].msg); return; }
      const lead = plan.strokes[0] ?? plan.ghosts![0];
      const endP = plan.continueAt?.p ?? (lead.chain.length ? lead.chain[lead.chain.length - 1].p3 : c);
      const endH = plan.continueAt?.h ?? lead.h1;
      if (g.build(plan)) {
        this.hud?.sound("build");
        // keep drawing from where this road ended
        const s = snap(g.net, endP, { ...this.snapOpts(), mpp: 0.05, off: undefined, lengthStep: 0 });
        this.anchor = s.node !== undefined || (plan.continueAt && s.seg !== undefined) ? s : { p: endP, h: endH, guides: [] };
        this.startTangent = plan.endTangent;
        this.ctrl = null;
        this.ctrl2 = null;
        const pe = plan.parallelEnds?.b;
        if (pe) {
          const ps = snap(g.net, pe, { ...this.snapOpts(), mpp: 0.05, off: undefined, lengthStep: 0 });
          this.parFrom = ps.node !== undefined ? ps : { p: pe, h: endH, guides: [] };
        } else this.parFrom = undefined;
      }
      return;
    }
    if (t === "roundabout") {
      const plan = this.computeRoundabout();
      if (!plan) return;
      if (plan.errors.length) { this.reject(plan.errors[0].msg); return; }
      if (g.build(plan)) this.hud?.sound("build");
      return;
    }
    if (t === "bulldoze") {
      const b = g.buildings.at(c);
      if (b) { g.bulldoze([], [b.id]); this.hud?.sound("remove"); return; }
      const id = segAt(g.net, c, 2, this.st.bdzLevel);
      if (id !== null) {
        const refund = g.bulldoze([id], []);
        this.hud?.sound("remove");
        this.hud?.toast(`Removed road, refunded ${formatMoney(refund)}`);
      }
      return;
    }
    if (t === "junction") {
      const n = this.nodeAt(c);
      if (n === null) { this.reject("Click a junction"); return; }
      this.hud?.openSignal(n);
      return;
    }
    if (t === "unlock") {
      const [i, j] = g.tileOf(c);
      if (g.tiles.has(`${i},${j}`)) return;
      const why = g.tileBlock(i, j);
      if (why) { this.reject(why); return; }
      const price = g.nextTilePrice;
      g.unlockTile(i, j);
      this.hud?.sound("place");
      this.hud?.toast(`Bought land for ${formatMoney(price)}`);
      if (g.tileSlotsLeft <= 0) this.setTool({ tool: "inspect" });
      else this.hud?.refresh();
    }
  }

  private finishRect() {
    const r = this.dragRect!;
    this.dragRect = null;
    this.hud?.rect(null);
    const g = this.game;
    if (this.st.tool !== "bulldoze") return;
    const segs = this.segsInScreenRect(r.a, r.b);
    const bs = this.buildingsInRect(r.a, r.b).map((b) => b.id);
    if (!segs.length && !bs.length) return;
    const refund = g.bulldoze(segs, bs);
    this.hud?.sound("remove");
    if (segs.length) this.hud?.toast(`Removed ${segs.length} road${segs.length > 1 ? "s" : ""}, refunded ${formatMoney(refund)}`);
  }

  /** World box around a screen rectangle (for spatial queries), and a test for "on screen inside it". */
  private screenRect(a: V2, b: V2) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const cs = [this.view.toWorld(x0, y0), this.view.toWorld(x1, y0), this.view.toWorld(x1, y1), this.view.toWorld(x0, y1)];
    const box = { x0: Math.min(...cs.map((q) => q.x)), y0: Math.min(...cs.map((q) => q.y)), x1: Math.max(...cs.map((q) => q.x)), y1: Math.max(...cs.map((q) => q.y)) };
    const inside = (p: V2) => { const s = this.view.toScreen(p); return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1; };
    return { box, inside };
  }

  private segsInScreenRect(a: V2, b: V2): number[] {
    const g = this.game, { box, inside } = this.screenRect(a, b);
    const lvl = this.st.bdzLevel;
    const out: number[] = [];
    for (const id of g.net.segsNear(box.x0, box.y0, box.x1, box.y1)) {
      const sg = g.net.segGeom.get(id)!;
      if (sg.center.pts.some((p, i) => inside(p) && (lvl === null || Math.abs(sg.hs[i] - lvl * LEVEL_H) < 1))) out.push(id);
    }
    return out;
  }

  private reject(msg: string) {
    this.hud?.toast(msg, true);
    this.hud?.sound("error");
    this.shake = 1;
  }

  private nodeAt(p: V2): number | null {
    const g = this.game;
    let best: number | null = null, bd = 14 * Math.max(1, this.view.mpp * 0.8);
    for (const n of g.net.nodesNear(p, 30)) {
      const ng = g.net.nodeGeom.get(n.id);
      if (!ng || ng.kind !== "junction" || ng.arms.length < 3) continue;
      const d = dist(n.p, p);
      if (d < Math.max(bd, ng.radius)) { bd = d; best = n.id; }
    }
    return best;
  }

  /** Buildings whose centre is inside a screen rectangle. */
  private buildingsInRect(a: V2, b: V2): Building[] {
    const { inside } = this.screenRect(a, b);
    return this.game.buildings.list.filter((o) => inside(o.c));
  }

  // ---------------------------------------------------------------- plans

  private computeRoadPlan(): Plan | null {
    if (!this.anchor) return null;
    const g = this.game;
    const end = snap(g.net, this.cursor, this.snapOpts(this.anchor));
    // started inside a roundabout: join the rim on the side the road actually leaves from
    const start = this.anchor.ringRaw
      ? snap(g.net, this.anchor.ringRaw, { ...this.snapOpts(), from: { p: end.p } })
      : this.anchor;
    if (end.node !== undefined && end.node === start.node) return null;
    const mode = this.st.mode === "grid" || this.st.mode === "replace" ? "straight" : this.st.mode;
    const plan = planRoad(g.net, g.world, {
      start, end, mode, type: this.st.roadType,
      startTangent: this.startTangent, ctrl: this.ctrl ?? undefined, ctrl2: this.ctrl2 ?? undefined,
      parallel: this.st.parallel ? { offset: this.parallelOffset(), from: this.parFrom } : undefined,
    });
    (plan as Plan & { snapEnd?: Snap }).snapEnd = end;
    return plan;
  }

  private computeRoundabout(): Plan | null {
    const g = this.game;
    const s = snap(g.net, this.cursor, { ...this.snapOpts(), from: undefined });
    const c = s.node !== undefined ? s.p : this.cursor;
    const h = s.node !== undefined ? g.net.nodes.get(s.node)!.h : this.st.level * LEVEL_H;
    return planRoundabout(g.net, g.world, c, this.st.rbSize, Math.round(h / LEVEL_H));
  }

  /** CS2 grid: first corner, a click along one side (sets the direction and width), then the depth. */
  private computeGrid(): Plan | null {
    if (!this.anchor || !this.ctrl) return null;
    const g = this.game;
    const a = this.anchor.p, b = this.ctrl;
    if (dist(a, b) < 20) return null;
    const ux = norm(sub(b, a)), uy = right(ux);
    const depth = dot(sub(this.snapFree(this.anchor).p, b), uy);
    const far = v2(b.x + uy.x * depth, b.y + uy.y * depth);
    return planGrid(g.net, g.world, a, far, ux, this.st.roadType, this.st.level);
  }

  // ---------------------------------------------------------------- per frame

  private refreshPreview() {
    this.dirtyPreview = false;
    const pv = this.preview;
    pv.clear();
    if (!this.hasCursor) { if (pv.ghost) pv.ghost.visible = false; this.zones3d.highlight(this.zoneStroke ? [...this.zoneStroke.cells] : [], this.zoneStroke?.erase ? null : this.st.zone); this.hud?.chips(null); return; }
    const g = this.game;
    const c = this.cursor;
    const t = this.st.tool;
    const chips: Chip[] = [];
    if (pv.ghost) pv.ghost.visible = false;
    if (t !== "zone") this.zones3d.highlight([], null);
    if (t === "road" && this.st.mode === "replace") {
      const id = segAt(g.net, c, 2, null);
      if (id !== null) {
        const s = g.net.segs.get(id)!;
        if (this.st.reverse) {
          pv.highlight(g.net, [id]);
          chips.push({ text: ROAD_TYPES[s.type].bwd > 0 ? "Two-way road" : "Reverse direction", kind: ROAD_TYPES[s.type].bwd > 0 ? "error" : "info" });
        } else {
          const u = g.upgradePlan(id, this.st.roadType);
          pv.highlight(g.net, [id]);
          if (s.type === this.st.roadType) chips.push({ text: "Already this type", kind: "info" });
          else {
            if (u.errors.length) chips.push({ text: u.errors[0].msg, kind: "error" });
            for (const e of u.errors) for (const bid of e.buildings ?? []) {
              const b = g.buildings.byId.get(bid);
              if (b) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
            }
            // lots that will be pushed back to make room
            for (const m of u.moves) {
              const b = g.buildings.byId.get(m.id);
              if (b) pv.footprint(rectCorners(m.c1, b.hw, b.hd, b.rot), 0x58c8e6);
            }
            if (u.moves.length) chips.push({ text: u.moves.length === 1 ? "1 building moves back" : `${u.moves.length} buildings move back`, kind: "info" });
            chips.push({ text: `${ROAD_TYPES[s.type].name} → ${ROAD_TYPES[this.st.roadType].name}`, kind: "info" });
            chips.push({ text: formatMoney(u.cost), kind: u.cost > g.money ? "error" : "cost" });
          }
        }
      }
    } else if (t === "road") {
      const step = this.roadStep();
      const mode = this.st.mode;
      if (step === "start") {
        const s = snap(g.net, c, this.snapOpts());
        pv.marker(s.p, s.h);
        pv.guides(s.guides);
        chips.push({ text: mode === "grid" ? `${ROAD_TYPES[this.st.roadType].name} grid: click a corner` : `${ROAD_TYPES[this.st.roadType].name}`, kind: "info" });
        if (this.st.level > 0) chips.push({ text: `Elevation ${this.st.level}`, kind: "info" });
      } else if (mode === "grid") {
        pv.marker(this.anchor!.p, this.anchor!.h);
        if (step === "ctrl") {
          const s = this.snapFree(this.anchor);
          pv.guides(s.guides);
          pv.plan(planRoad(g.net, g.world, { start: this.anchor!, end: { ...s, h: this.anchor!.h }, mode: "straight", type: this.st.roadType }), this.st.level);
          chips.push({ text: "Click to set the grid's width", kind: "info" }, { text: `${Math.round(dist(s.p, this.anchor!.p))} m`, kind: "info" });
        } else {
          const plan = this.computeGrid();
          if (plan) {
            pv.plan(plan, this.st.level);
            if (plan.errors.length) chips.push({ text: plan.errors[0].msg, kind: "error" });
            chips.push({ text: formatMoney(plan.cost), kind: plan.cost > g.money ? "error" : "cost" });
            this.lotWarning(plan, chips);
          }
        }
      } else if (step === "ctrl" || step === "ctrl2") {
        // placing a bend handle: show the handle lines and the road so far
        const s = this.snapFree(this.anchor);
        pv.marker(this.anchor!.p, this.anchor!.h);
        pv.guides(s.guides);
        const a = this.anchor!.p;
        const lines = step === "ctrl" ? [{ a, b: s.p }] : [{ a, b: this.ctrl! }, { a: this.ctrl!, b: s.p }];
        pv.guides(lines);
        if (step === "ctrl2") pv.marker(this.ctrl!, this.anchor!.h);
        chips.push({ text: step === "ctrl" ? "Click to set the bend" : "Click to set the second handle", kind: "info" });
      } else {
        const plan = this.computeRoadPlan();
        this.plan = plan;
        if (plan) {
          const end = (plan as Plan & { snapEnd?: Snap }).snapEnd!;
          pv.plan(plan, this.st.level);
          pv.guides(end.guides);
          pv.marker(this.anchor!.p, this.anchor!.h);
          pv.marker(end.p, end.h);
          if (this.ctrl) pv.guides(this.ctrl2 ? [{ a: this.anchor!.p, b: this.ctrl }, { a: this.ctrl2, b: end.p }] : [{ a: this.anchor!.p, b: this.ctrl }, { a: this.ctrl, b: end.p }]);
          if (plan.errors.length) {
            chips.push({ text: plan.errors[0].msg, kind: "error" });
            for (const e of plan.errors) for (const id of e.buildings ?? []) {
              const b = g.buildings.byId.get(id);
              if (b) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
            }
          }
          chips.push({ text: formatMoney(plan.cost), kind: plan.cost > g.money ? "error" : "cost" });
          this.lotWarning(plan, chips);
          const lead = plan.strokes[0] ?? plan.ghosts![0];
          const L = lead.chain.length ? plan.length / Math.max(1, plan.strokes.length) : 0;
          chips.push({ text: L < 950 ? `${Math.round(L)} m` : `${(L / 1000).toFixed(2)} km`, kind: "info" });
          const dh = lead.h1 - lead.h0;
          if (Math.abs(dh) > 0.1 && L > 1) chips.push({ text: `${dh > 0 ? "↗" : "↘"} ${(Math.abs(dh) / L * 100).toFixed(1)}%`, kind: "info" });
          if (plan.angleDeg !== undefined && L > 3) chips.push({ text: `${plan.angleDeg.toFixed(1)}°`, kind: "info", icon: "angle" });
          if (this.st.parallel) chips.push({ text: `Parallel ${Math.round(this.parallelOffset())} m`, kind: "info" });
          if (end.label) chips.push({ text: end.label, kind: "info" });
          if (plan.note) chips.push({ text: plan.note, kind: "info" });
        }
      }
    } else if (t === "roundabout") {
      const plan = this.computeRoundabout();
      if (plan) {
        pv.plan(plan, this.st.level);
        if (plan.removeSegs?.length) pv.removal(g.net, plan.removeSegs);
        if (plan.errors.length) chips.push({ text: plan.errors[0].msg, kind: "error" });
        chips.push({ text: formatMoney(plan.cost), kind: plan.cost > g.money ? "error" : "cost" });
        this.lotWarning(plan, chips);
      }
    } else if (t === "bulldoze") {
      if (this.dragRect && this.pointers.size && [...this.pointers.values()][0].moved) {
        const segs = this.segsInScreenRect(this.dragRect.a, this.dragRect.b);
        pv.removal(g.net, segs);
        const bs = this.buildingsInRect(this.dragRect.a, this.dragRect.b);
        for (const b of bs) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
        chips.push({ text: `${formatMoney(removalRefund(g.net, g.world, segs))} refund`, kind: "cost" });
      } else {
        const b = g.buildings.at(c);
        if (b) {
          pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
          chips.push({ text: `Demolish ${b.zone ? ZONES[b.zone].short.toLowerCase() : BUILDING_TYPES[b.kind].name}`, kind: "info" });
        } else {
          const id = segAt(g.net, c, 2, this.st.bdzLevel);
          if (id !== null) {
            pv.removal(g.net, [id]);
            chips.push({ text: `${formatMoney(removalRefund(g.net, g.world, [id]))} refund`, kind: "cost" });
          }
        }
      }
    } else if (t === "zone") {
      const zs = this.zoneStroke;
      const erase = zs ? zs.erase : this.st.erase;
      let cells: Cell[];
      if (zs) cells = this.st.zoneMode === "marquee" ? (this.pointers.get(zs.pointer)?.moved ? this.cellsInScreenRect(zs.a, zs.b) : []) : [...zs.cells];
      else if (this.st.zoneMode === "brush") cells = g.zones.near(c, this.st.brush).filter((x) => x.ok);
      else if (this.st.zoneMode === "fill") cells = this.fillCells(c, erase);
      else cells = [];
      const Z = ZONES[this.st.zone];
      const to = erase ? null : this.st.zone;
      this.zones3d.highlight(cells, to);
      chips.push({ text: erase ? "Unzone" : Z.short, kind: "info" });
      if (cells.length) {
        const change = cells.filter((x) => x.zone !== to).length;
        chips.push({ text: `${change} cell${change === 1 ? "" : "s"}`, kind: "info" });
        const built = new Set(cells.filter((x) => x.lot && x.zone !== to).map((x) => x.lot)).size;
        if (built) chips.push({ text: `${built} building${built === 1 ? "" : "s"} demolished`, kind: "error" });
      } else if (!zs && !g.zones.cellAt(c)) chips.push({ text: "Zone beside a street", kind: "info" });
    } else if (t === "junction") {
      const n = this.nodeAt(c);
      if (n !== null) {
        const node = g.net.nodes.get(n)!;
        pv.marker(node.p, node.h);
        chips.push({ text: node.signal ? "Edit traffic lights" : "Junction: lanes & lights", kind: "info" });
      }
    } else if (t === "unlock") {
      const [i, j] = g.tileOf(c);
      if (!g.tiles.has(`${i},${j}`)) {
        const T = TILE, a = (i - 0.5) * T, b = (j - 0.5) * T;
        const why = g.tileBlock(i, j);
        pv.footprint([v2(a, b), v2(a + T, b), v2(a + T, b + T), v2(a, b + T)], why ? 0x888888 : 0x58c8e6);
        chips.push(why ? { text: why, kind: "error" } : { text: "Buy this tile", kind: "info" });
        chips.push({ text: formatMoney(g.nextTilePrice), kind: g.nextTilePrice > g.money ? "error" : "cost" });
      }
    } else if (t === "service") {
      const k = this.st.service;
      const pl = g.servicePlan(k, c);
      const T = BUILDING_TYPES[k];
      chips.push({ text: T.name, kind: "info" });
      if (!pl) {
        chips.push({ text: "Place it beside a street", kind: "info" });
        if (this.svcReach) { this.svcReach = null; this.covT = 1; }
      } else {
        const corners = rectCorners(pl.c, T.w / 2, T.d / 2, pl.rot);
        const gh = this.buildings3d.ghost(k, pl.c, pl.rot, pl.side);
        if (gh) pv.model(gh.geo, gh.m, pl.ok);
        pv.footprint(corners, pl.ok ? 0x34c25a : 0xe5484d, !!gh);
        for (const id of pl.clears ?? []) {
          const o = g.buildings.byId.get(id);
          if (o) pv.footprint(rectCorners(o.c, o.hw, o.hd, o.rot), 0xf2a33a, !!gh);
        }
        if (!pl.ok) chips.push({ text: pl.reason ?? "Can't build here", kind: "error" });
        else {
          chips.push({ text: formatMoney(pl.cost), kind: pl.cost > g.money ? "error" : "cost" });
          chips.push({ text: `${formatMoney(SERVICES[k].upkeep)}/h upkeep`, kind: "info" });
          const n = pl.clears?.length ?? 0;
          if (n) chips.push({ text: `${n} building${n === 1 ? "" : "s"} replaced`, kind: "error" });
        }
        const key = pl.access ? `${pl.access.seg}:${Math.round(pl.access.s / 8)}:${g.net.version}` : "";
        if (!this.svcReach || this.svcReach.key !== key) {
          this.svcReach = { key, cov: pl.access ? g.services.previewReach(k, pl.access) : new Map() };
          this.covT = 1;
        }
      }
    } else if (t === "inspect") {
      const b = g.buildings.at(c);
      if (b) chips.push({ text: b.zone ? `${ZONES[b.zone].short} · level ${b.level}` : BUILDING_TYPES[b.kind].name, kind: "info" });
    }
    this.hud?.chips(chips.length ? this.cursorPx : null, chips);
  }

  frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    // keyboard panning
    const pan = 520 * dt * (this.view.halfH / 170) ** 0.85;
    let mx = 0, my = 0;
    if (this.keys.has("w") || this.keys.has("ArrowUp")) my -= 1;
    if (this.keys.has("s") || this.keys.has("ArrowDown")) my += 1;
    if (this.keys.has("a") || this.keys.has("ArrowLeft")) mx -= 1;
    if (this.keys.has("d") || this.keys.has("ArrowRight")) mx += 1;
    // Q/E turn the view, R/F zoom (CS2)
    const turn = (this.keys.has("e") ? 1 : 0) - (this.keys.has("q") ? 1 : 0);
    const zoom = (this.keys.has("f") ? 1 : 0) - (this.keys.has("r") ? 1 : 0);
    if (mx || my) {
      const c = Math.cos(this.view.rot), s = Math.sin(this.view.rot);
      this.view.cx += (mx * c - my * s) * pan;
      this.view.cy += (mx * s + my * c) * pan;
    }
    if (turn) this.view.rotateAt(this.view.w / 2, this.view.h / 2, turn * 1.5 * dt);
    if (zoom) this.view.zoomAt(this.view.w / 2, this.view.h / 2, Math.exp(zoom * 2.2 * dt));
    if (mx || my || turn || zoom) {
      this.clampView();
      if (this.hasCursor) this.updateCursor(this.cursorPx);
    }
    g.update(dt);
    this.vehicles.update(g.traffic, g.alpha);
    this.flowT += dt;
    const flowOn = this.overlay === "flow";
    this.zones3d.update();
    this.roads.update(g.traffic, flowOn && this.flowT > 0.5);
    if (this.flowT > 0.5) this.flowT = 0;
    if (this.dirtyPreview) this.refreshPreview();
    this.hudT += dt;
    if (this.hudT > 0.25) {
      this.hudT = 0;
      this.hud?.tick();
      this.buildings3d.updateConstruction();
      if ((this.overlay !== "none" && this.overlay !== "flow") || this.st.tool === "service") this.applyTint();
      else if (this.covShown) this.applyTint();
    }
    this.covT += dt;
    if (this.covT > 0.5) { this.covT = 0; this.updateCoverage(); }
    this.saveT += dt;
    if (this.saveT > 60) { this.saveT = 0; if (this.mode === "play") this.saves.autosave(g); }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 4);
      this.hud?.shake(this.shake);
    }
    // far out: no cars, no shadow map (the ground draws its own hill shadows)
    const far = this.view.halfH > 1800;
    this.vehicles.group.visible = !far;
    this.view.sun.castShadow = this.view.halfH < 2400;
    this.terrain3d.update(this.view);
    this.roadsFar.update(this.view.mpp, this.view.w, this.view.h);
    this.labels.update(this.view);
    this.iconT += dt;
    if (this.iconT > 0.4) { this.iconT = 0; this.icons.set(this.uiHidden || this.mode === "menu" ? [] : g.buildings.list, this.view); }
    else this.icons.update(this.view);
    this.hud?.compassAngle(this.view.rot);
    this.view.render();
    requestAnimationFrame(this.frame);
  };

  start() {
    requestAnimationFrame(this.frame);
    // closing or hiding the tab saves straight away, so at most a few seconds of work is ever lost
    const flush = () => { if (this.game && this.mode === "play" && this.game.playtime > 1) { this.saveT = 0; this.saves.autosave(this.game); } };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener("pagehide", flush);
  }

  /** Last road plan (for tests / debugging). */
  get lastPlan() {
    return this.plan;
  }

  get mpp() {
    return this.view.mpp;
  }
}

const GATEWAY_LABEL: Record<string, string> = {
  port: "Port city", capital: "Capital", industry: "Industrial city", farm: "Farm town", mining: "Mining town", tech: "Tech city",
};

/** red -> amber -> green ramp for 0..1 */
/** Coverage colour: pale to deep green. */
function covRamp(v: number): number {
  const t = Math.max(0, Math.min(1, (v - 0.4) / 0.6));
  const r = Math.round(0xb4 + (0x2e - 0xb4) * t), gg = Math.round(0xe0 + (0xa6 - 0xe0) * t), b = Math.round(0x9c + (0x4c - 0x9c) * t);
  return (r << 16) | (gg << 8) | b;
}

export function ramp(v: number): number {
  const c = new THREE.Color();
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.5) c.lerpColors(new THREE.Color(0xe5484d), new THREE.Color(0xf5b82e), t / 0.5);
  else c.lerpColors(new THREE.Color(0xf5b82e), new THREE.Color(0x4cc46a), (t - 0.5) / 0.5);
  return c.getHex();
}
