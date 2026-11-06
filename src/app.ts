import * as THREE from "three";
import { BUILDING_TYPES, LEVEL_H, MAP, MAX_LEVEL, ROAD_TYPES, type BuildingKind, type RoadTypeId } from "./config";
import { cubicTangent, dist, formatMoney, norm, rectCorners, v2, type V2 } from "./core/math";
import type { Building } from "./game/buildings";
import { Game } from "./game/city";
import {
  cubicClosest, planGrid, planRoad, planRoundabout, removalRefund, segAt, segsInRect, snap, upgradeCost,
  type CurveMode, type Plan, type Snap,
} from "./roads/planner";
import { Buildings3D, lotMatrix } from "./render/buildings3d";
import type { ModelSet } from "./render/models";
import { Preview3D } from "./render/preview3d";
import { Roads3D } from "./render/roads3d";
import { Terrain3D } from "./render/terrain3d";
import { Vehicles3D } from "./render/vehicles3d";
import { View } from "./render/view";
import { Saves } from "./game/saves";
import type { Hud, Chip } from "./ui/hud";

export type ToolId = "inspect" | "road" | "grid" | "roundabout" | "junction" | "upgrade" | "bulldoze" | "building" | "unlock";
export type OverlayId = "none" | "flow" | "sat" | "commercial" | "work" | "staff" | "input" | "pollution" | "noise";
export type FocusId = "trips" | "sat" | "flow" | null;

export interface ToolState {
  tool: ToolId;
  roadType: RoadTypeId;
  curve: CurveMode;
  level: number;
  rbLanes: 1 | 2;
  kind: BuildingKind | null;
  bdzLevel: number | null; // bulldozer elevation filter (null = all)
  reverse: boolean; // upgrade tool flips one-ways instead
}

interface PointerInfo { id: number; x: number; y: number; sx: number; sy: number; button: number; moved: boolean; t: number }

export class App {
  game!: Game;
  view: View;
  roads!: Roads3D;
  vehicles!: Vehicles3D;
  buildings3d!: Buildings3D;
  terrain3d!: Terrain3D;
  preview = new Preview3D();
  saves = new Saves();
  hud!: Hud;
  st: ToolState = { tool: "inspect", roadType: "street", curve: "straight", level: 0, rbLanes: 1, kind: null, bdzLevel: null, reverse: false };
  overlay: OverlayId = "none";
  focus: FocusId = null;
  selected: Building | null = null;
  private worldRoot = new THREE.Group();
  private cursor: V2 = v2(0, 0);
  private cursorPx: V2 = v2(0, 0);
  private hasCursor = false;
  // road tool state
  private anchor: Snap | null = null;
  private startTangent: V2 | undefined;
  private ctrl: V2 | null = null;
  private plan: Plan | null = null;
  // drag state
  private pointers = new Map<number, PointerInfo>();
  private dragRect: { a: V2; b: V2 } | null = null;
  private pinch: { d: number; mid: V2 } | null = null;
  private keys = new Set<string>();
  private last = performance.now();
  private hudT = 0;
  private flowT = 0;
  private saveT = 0;
  private dirtyPreview = true;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, private models: ModelSet) {
    this.view = new View(canvas);
    this.view.scene.add(this.worldRoot);
    this.view.scene.add(this.preview.group);
  }

  // ---------------------------------------------------------------- setup

  attachHud(h: Hud) {
    this.hud = h;
  }

  newGame(seed = 7) {
    this.setGame(new Game(seed));
    this.view.cx = MAP.size / 2;
    this.view.cy = MAP.size / 2;
    this.view.halfH = 170;
  }

  loadGame(data: ReturnType<Game["serialize"]>) {
    this.setGame(Game.load(data));
  }

  private setGame(g: Game) {
    this.game = g;
    for (const c of [...this.worldRoot.children]) this.worldRoot.remove(c);
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.terrain3d = new Terrain3D(g.terrain, small);
    this.roads = new Roads3D(g.net);
    this.vehicles = new Vehicles3D(this.models);
    this.buildings3d = new Buildings3D(this.models);
    this.worldRoot.add(this.terrain3d.group, this.roads.group, this.buildings3d.group, this.vehicles.group);
    this.roads.rebuildAll();
    this.buildings3d.rebuild(g.buildings.list);
    this.terrain3d.setTiles(g.tiles);
    g.on((e) => {
      if (e.t === "roads") { this.roads.apply(e.cs); this.buildings3d.rebuildDrives(g.buildings.list); this.dirtyPreview = true; }
      else if (e.t === "buildings") { this.buildings3d.rebuild(g.buildings.list); this.applyTint(); this.dirtyPreview = true; }
      else if (e.t === "tiles") this.terrain3d.setTiles(g.tiles);
      else if (e.t === "level") this.hud?.levelUp(e.level, e.note);
      else if (e.t === "toast") this.hud?.toast(e.msg);
      this.hud?.refresh();
    });
    this.cancelStroke();
    this.selected = null;
    this.hud?.refresh();
  }

  // ---------------------------------------------------------------- tools

  setTool(p: Partial<ToolState>) {
    const prev = this.st.tool;
    Object.assign(this.st, p);
    if (p.tool && p.tool !== prev) this.cancelStroke();
    if (this.st.tool === "building" && this.st.kind) {
      this.preview.setGhost(this.buildings3d.ghost(this.st.kind));
    } else this.preview.setGhost(null);
    if (this.st.tool !== "inspect") { this.selected = null; this.hud?.closePanels(); }
    this.dirtyPreview = true;
    this.hud?.refresh();
  }

  setLevel(l: number) {
    this.setTool({ level: Math.max(0, Math.min(MAX_LEVEL, l)) });
  }

  setOverlay(o: OverlayId) {
    this.overlay = this.overlay === o ? "none" : o;
    this.roads.flowMode = this.overlay === "flow" || this.focus === "flow";
    this.applyTint();
    this.hud?.refresh();
  }

  setFocus(f: FocusId) {
    this.focus = this.focus === f ? null : f;
    this.roads.flowMode = this.overlay === "flow" || this.focus === "flow";
    this.applyTint();
    this.hud?.refresh();
  }

  /** Building colours for overlays and magnifier highlights. */
  applyTint() {
    const g = this.game;
    const mode = this.focus ?? this.overlay;
    if (mode === "none" || mode === "flow" || mode === null) { this.buildings3d.tint(null); return; }
    if (mode === "trips") {
      const homes = new Set(g.residentsWithoutTrip().map((r) => r.home));
      this.buildings3d.tint((b) => (homes.has(b.id) ? 0xff9a3c : 0x9a9a9a));
      return;
    }
    const target = mode === "sat" && this.focus === "sat" ? g.levelSatTarget : null;
    this.buildings3d.tint((b) => {
      let v: number | undefined;
      if (mode === "sat") v = b.sat;
      else if (mode === "pollution" || mode === "noise") {
        const x = b.factors[mode];
        v = x === undefined ? undefined : 1 - x * 2;
      } else v = b.factors[mode];
      if (v === undefined) return 0xb5b5b5;
      if (target !== null) return v >= target ? 0xb5b5b5 : 0xff9a3c;
      return ramp(v);
    });
  }

  cancelStroke() {
    this.anchor = null;
    this.startTangent = undefined;
    this.ctrl = null;
    this.plan = null;
    this.dragRect = null;
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
    const p = this.local(e);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, button: e.button, moved: false, t: performance.now() });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: v2((a.x + b.x) / 2, (a.y + b.y) / 2) };
      this.dragRect = null;
      this.hud?.rect(null);
      return;
    }
    this.updateCursor(p);
    if (e.button === 0 && e.pointerType !== "touch") {
      const t = this.st.tool;
      if (t === "grid" || (t === "bulldoze")) this.dragRect = { a: this.cursor, b: this.cursor };
    }
  }

  private onMove(e: PointerEvent) {
    const p = this.local(e);
    const pi = this.pointers.get(e.pointerId);
    if (this.pinch && this.pointers.size === 2 && pi) {
      pi.x = p.x; pi.y = p.y;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
      const m = this.view.mpp;
      this.view.cx -= (mid.x - this.pinch.mid.x) * m;
      this.view.cy -= (mid.y - this.pinch.mid.y) * m;
      this.view.zoomAt(mid.x, mid.y, this.pinch.d / Math.max(d, 1));
      this.pinch = { d, mid };
      this.clampView();
      return;
    }
    if (pi) {
      const dx = p.x - pi.x, dy = p.y - pi.y;
      if (Math.hypot(p.x - pi.sx, p.y - pi.sy) > (e.pointerType === "touch" ? 10 : 5)) pi.moved = true;
      const panning = pi.button === 1 || pi.button === 2 || (pi.button === 0 && !this.dragRect && (this.st.tool === "inspect" || e.pointerType === "touch" || this.keys.has(" ")));
      if (panning && pi.moved) {
        this.view.cx -= dx * this.view.mpp;
        this.view.cy -= dy * this.view.mpp;
        this.clampView();
      }
      pi.x = p.x; pi.y = p.y;
      if (panning) return;
    }
    if (e.target !== this.view.canvas && !pi) { return; }
    this.updateCursor(p);
    if (this.dragRect) {
      this.dragRect.b = this.cursor;
      this.hud?.rect([this.view.toScreen(this.dragRect.a), this.view.toScreen(this.dragRect.b)]);
    }
  }

  private onUp(e: PointerEvent) {
    const pi = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    if (!pi) return;
    const p = this.local(e);
    if (this.dragRect && pi.moved && pi.button === 0) {
      this.finishRect();
      return;
    }
    this.dragRect = null;
    this.hud?.rect(null);
    if (pi.moved) return;
    this.updateCursor(p);
    if (pi.button === 2) { this.onRightClick(); return; }
    if (pi.button === 0) this.onClick(e.shiftKey);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); this.redo(); }
      else if (k === "s") { e.preventDefault(); this.hud?.openSaves(); }
      return;
    }
    if (k === "Escape") { if (this.anchor || this.dragRect) this.cancelStroke(); else if (this.hud?.closePanels()) {} else this.setTool({ tool: "inspect" }); }
    else if (k === " ") { e.preventDefault(); if (!e.repeat) this.togglePause(); }
    else if (k === "r" && !e.repeat) this.setLevel(this.st.level + 1);
    else if (k === "f" && !e.repeat) this.setLevel(this.st.level - 1);
    else if (k === "Tab") { e.preventDefault(); const order: CurveMode[] = ["straight", "arc", "smooth"]; this.setTool({ curve: order[(order.indexOf(this.st.curve) + 1) % 3] }); }
    else if (k === "b") this.setTool({ tool: "bulldoze" });
    else if (k === "u") this.setTool({ tool: "upgrade" });
    else if (k === "g") this.setTool({ tool: "grid" });
    else if (k === "j") this.setTool({ tool: "junction" });
    else if (k === "o") this.setTool({ tool: "roundabout" });
    else if (/^[1-7]$/.test(k)) {
      const order: RoadTypeId[] = ["one1", "street", "one2", "avenue", "one3", "boulevard", "one4"];
      this.setTool({ tool: this.st.tool === "upgrade" || this.st.tool === "grid" ? this.st.tool : "road", roadType: order[+k - 1] });
    } else if (k === "=" || k === "+") this.setSpeed(Math.min(4, this.game.speed * 2));
    else if (k === "-") this.setSpeed(Math.max(1, this.game.speed / 2));
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
    const m = 200;
    this.view.clampTo(-m, -m, MAP.size + m, MAP.size + m);
  }

  private updateCursor(px: V2) {
    this.cursorPx = px;
    this.cursor = this.view.toWorld(px.x, px.y);
    this.hasCursor = true;
    this.dirtyPreview = true;
  }

  private snapOpts(from?: Snap) {
    return {
      mpp: this.view.mpp, level: this.st.level, type: this.st.roadType,
      from: from ? { p: from.p, tangent: this.startTangent ?? from.tangent } : undefined,
      angleStep: this.keys.has("Shift"),
    };
  }

  // ---------------------------------------------------------------- clicks

  private onRightClick() {
    if (this.anchor || this.ctrl) this.cancelStroke();
    else if (this.st.tool !== "inspect") this.setTool({ tool: "inspect" });
  }

  private onClick(shift: boolean) {
    const g = this.game;
    const t = this.st.tool;
    const c = this.cursor;
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
    if (t === "road") {
      if (!this.anchor) {
        const s = snap(g.net, c, this.snapOpts());
        this.anchor = s;
        this.startTangent = undefined;
        this.dirtyPreview = true;
        return;
      }
      if (this.st.curve === "arc" && !this.ctrl && !(this.startTangent ?? this.anchor.tangent)) {
        this.ctrl = c;
        return;
      }
      const plan = this.computeRoadPlan();
      if (!plan) return;
      if (plan.errors.length) { this.reject(plan.errors[0].msg); return; }
      const endP = plan.strokes[0].chain.length ? plan.strokes[0].chain[plan.strokes[0].chain.length - 1].p3 : c;
      const endH = plan.strokes[0].h1;
      if (g.build(plan)) {
        this.hud?.sound("build");
        // keep drawing from where this road ended
        const s = snap(g.net, endP, { ...this.snapOpts(), mpp: 0.05 });
        this.anchor = s.node !== undefined ? s : { p: endP, h: endH, guides: [] };
        this.startTangent = plan.endTangent;
        this.ctrl = null;
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
    if (t === "grid") {
      this.reject("Drag to draw a grid");
      return;
    }
    if (t === "upgrade") {
      const id = segAt(g.net, c, 2, null);
      if (id === null) return;
      if (this.st.reverse || shift) {
        if (!g.flip(id)) this.reject("Only one-way roads can be reversed");
        else this.hud?.sound("build");
        return;
      }
      const s = g.net.segs.get(id)!;
      if (s.type === this.st.roadType) { this.reject("Already this road type"); return; }
      const u = upgradeCost(g.net, g.world, id, this.st.roadType);
      if (u.errors.length) { this.reject(u.errors[0].msg); return; }
      if (g.upgrade(id, this.st.roadType)) this.hud?.sound("build");
      return;
    }
    if (t === "bulldoze") {
      const b = g.buildings.at(c);
      if (b && b.placedLevel === g.level) { g.bulldoze([], [b.id]); this.hud?.sound("remove"); return; }
      if (b) { this.reject("Buildings from earlier levels can't be moved"); return; }
      const id = segAt(g.net, c, 2, this.st.bdzLevel);
      if (id !== null) {
        const refund = g.bulldoze([id], []);
        this.hud?.sound("remove");
        this.hud?.toast(`Removed road, refunded ${formatMoney(refund)}`);
      }
      return;
    }
    if (t === "building" && this.st.kind) {
      const pl = g.placement(this.st.kind, c);
      if (!pl) { this.reject("Place it next to a street or avenue"); return; }
      if (!pl.ok) { this.reject(pl.reason ?? "Can't place here"); return; }
      if (g.place(this.st.kind, pl)) {
        this.hud?.sound("place");
        if ((g.inventory[this.st.kind] ?? 0) <= 0) {
          const next = (Object.keys(g.inventory) as BuildingKind[]).find((k) => (g.inventory[k] ?? 0) > 0);
          this.setTool(next ? { kind: next } : { tool: "inspect", kind: null });
        }
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
      if (g.tileTokens <= 0) { this.reject("No area unlocks left. Complete levels to earn more"); return; }
      if (!g.canUnlock(i, j)) { this.reject("Unlock an area next to one you own"); return; }
      g.unlockTile(i, j);
      this.hud?.sound("place");
      if (g.tileTokens <= 0) this.setTool({ tool: "inspect" });
    }
  }

  private finishRect() {
    const r = this.dragRect!;
    this.dragRect = null;
    this.hud?.rect(null);
    const g = this.game;
    if (this.st.tool === "grid") {
      const plan = this.computeGrid(r.a, r.b);
      if (!plan) return;
      if (plan.errors.length) { this.reject(plan.errors[0].msg); return; }
      if (g.build(plan)) this.hud?.sound("build");
    } else if (this.st.tool === "bulldoze") {
      const segs = segsInRect(g.net, r.a, r.b, this.st.bdzLevel);
      const bs = this.buildingsInRect(r.a, r.b).filter((b) => b.placedLevel === g.level).map((b) => b.id);
      if (!segs.length && !bs.length) return;
      const refund = g.bulldoze(segs, bs);
      this.hud?.sound("remove");
      if (segs.length) this.hud?.toast(`Removed ${segs.length} road${segs.length > 1 ? "s" : ""}, refunded ${formatMoney(refund)}`);
    }
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

  private buildingsInRect(a: V2, b: V2): Building[] {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return this.game.buildings.list.filter((o) => o.c.x > x0 && o.c.x < x1 && o.c.y > y0 && o.c.y < y1);
  }

  // ---------------------------------------------------------------- plans

  private computeRoadPlan(): Plan | null {
    if (!this.anchor) return null;
    const g = this.game;
    const end = snap(g.net, this.cursor, this.snapOpts(this.anchor));
    if (end.node !== undefined && end.node === this.anchor.node) return null;
    const plan = planRoad(g.net, g.world, {
      start: this.anchor, end, mode: this.st.curve, type: this.st.roadType,
      startTangent: this.startTangent, ctrl: this.ctrl ?? undefined,
    });
    (plan as Plan & { snapEnd?: Snap }).snapEnd = end;
    return plan;
  }

  private computeRoundabout(): Plan | null {
    const g = this.game;
    const s = snap(g.net, this.cursor, { ...this.snapOpts(), from: undefined });
    const c = s.node !== undefined ? s.p : this.cursor;
    const h = s.node !== undefined ? g.net.nodes.get(s.node)!.h : this.st.level * LEVEL_H;
    return planRoundabout(g.net, g.world, c, this.st.rbLanes, Math.round(h / LEVEL_H));
  }

  private computeGrid(a: V2, b: V2): Plan | null {
    if (dist(a, b) < 20) return null;
    const g = this.game;
    // align with a road under the first corner, else the world axes
    let axis = v2(1, 0);
    const id = segAt(g.net, a, 6, null);
    if (id !== null) {
      const s = g.net.segs.get(id)!;
      const r = cubicClosest(s.c, a);
      axis = norm(cubicTangent(s.c, r.t));
    }
    return planGrid(g.net, g.world, a, b, axis, this.st.roadType, this.st.level);
  }

  // ---------------------------------------------------------------- per frame

  private refreshPreview() {
    this.dirtyPreview = false;
    const pv = this.preview;
    pv.clear();
    if (!this.hasCursor) { if (pv.ghost) pv.ghost.visible = false; this.hud?.chips(null); return; }
    const g = this.game;
    const c = this.cursor;
    const t = this.st.tool;
    const chips: Chip[] = [];
    if (pv.ghost) pv.ghost.visible = false;
    if (t === "road") {
      if (!this.anchor) {
        const s = snap(g.net, c, this.snapOpts());
        pv.marker(s.p, s.h);
        pv.guides(s.guides);
        chips.push({ text: `${ROAD_TYPES[this.st.roadType].name}`, kind: "info" });
        if (this.st.level > 0) chips.push({ text: `Elevation ${this.st.level}`, kind: "info" });
      } else if (this.st.curve === "arc" && !this.ctrl && !(this.startTangent ?? this.anchor.tangent)) {
        pv.marker(this.anchor.p, this.anchor.h);
        chips.push({ text: "Click to set the bend", kind: "info" });
        const plan = planRoad(g.net, g.world, { start: this.anchor, end: snap(g.net, c, this.snapOpts(this.anchor)), mode: "straight", type: this.st.roadType });
        pv.plan(plan, this.st.level);
      } else {
        const plan = this.computeRoadPlan();
        this.plan = plan;
        if (plan) {
          const end = (plan as Plan & { snapEnd?: Snap }).snapEnd!;
          pv.plan(plan, this.st.level);
          pv.guides(end.guides);
          pv.marker(this.anchor.p, this.anchor.h);
          pv.marker(end.p, end.h);
          if (plan.errors.length) {
            chips.push({ text: plan.errors[0].msg, kind: "error" });
            for (const e of plan.errors) for (const id of e.buildings ?? []) {
              const b = g.buildings.byId.get(id);
              if (b) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
            }
          }
          chips.push({ text: formatMoney(plan.cost), kind: plan.cost > g.money ? "error" : "cost" });
          if (plan.angleDeg !== undefined && plan.length > 3) chips.push({ text: `${plan.angleDeg.toFixed(1)}°`, kind: "info", icon: "angle" });
          chips.push({ text: `${(plan.length / 1000).toFixed(plan.length < 950 ? 2 : 1)} km`, kind: "info" });
          if (end.label) chips.push({ text: end.label, kind: "info" });
        }
      }
    } else if (t === "roundabout") {
      const plan = this.computeRoundabout();
      if (plan) {
        pv.plan(plan, this.st.level);
        if (plan.removeSegs?.length) pv.removal(g.net, plan.removeSegs);
        if (plan.errors.length) chips.push({ text: plan.errors[0].msg, kind: "error" });
        chips.push({ text: formatMoney(plan.cost), kind: plan.cost > g.money ? "error" : "cost" });
      }
    } else if (t === "grid") {
      if (this.dragRect) {
        const plan = this.computeGrid(this.dragRect.a, this.dragRect.b);
        if (plan) {
          pv.plan(plan, this.st.level);
          if (plan.errors.length) chips.push({ text: plan.errors[0].msg, kind: "error" });
          chips.push({ text: formatMoney(plan.cost), kind: plan.cost > g.money ? "error" : "cost" });
        }
      } else chips.push({ text: "Drag to lay out a street grid", kind: "info" });
    } else if (t === "upgrade") {
      const id = segAt(g.net, c, 2, null);
      if (id !== null) {
        const s = g.net.segs.get(id)!;
        if (this.st.reverse) {
          pv.highlight(g.net, [id]);
          chips.push({ text: ROAD_TYPES[s.type].bwd > 0 ? "Two-way road" : "Reverse direction", kind: ROAD_TYPES[s.type].bwd > 0 ? "error" : "info" });
        } else {
          const u = upgradeCost(g.net, g.world, id, this.st.roadType);
          pv.highlight(g.net, [id]);
          if (s.type === this.st.roadType) chips.push({ text: "Already this type", kind: "info" });
          else {
            if (u.errors.length) chips.push({ text: u.errors[0].msg, kind: "error" });
            chips.push({ text: `${ROAD_TYPES[s.type].name} → ${ROAD_TYPES[this.st.roadType].name}`, kind: "info" });
            chips.push({ text: formatMoney(u.cost), kind: u.cost > g.money ? "error" : "cost" });
          }
        }
      }
    } else if (t === "bulldoze") {
      if (this.dragRect) {
        const segs = segsInRect(g.net, this.dragRect.a, this.dragRect.b, this.st.bdzLevel);
        pv.removal(g.net, segs);
        const bs = this.buildingsInRect(this.dragRect.a, this.dragRect.b).filter((b) => b.placedLevel === g.level);
        for (const b of bs) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
        chips.push({ text: `${formatMoney(removalRefund(g.net, g.world, segs))} refund`, kind: "cost" });
      } else {
        const b = g.buildings.at(c);
        if (b) {
          pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), b.placedLevel === g.level ? 0xe5484d : 0x888888);
          chips.push({ text: b.placedLevel === g.level ? `Pick up ${BUILDING_TYPES[b.kind].name}` : "Placed in an earlier level", kind: b.placedLevel === g.level ? "info" : "error" });
        } else {
          const id = segAt(g.net, c, 2, this.st.bdzLevel);
          if (id !== null) {
            pv.removal(g.net, [id]);
            chips.push({ text: `${formatMoney(removalRefund(g.net, g.world, [id]))} refund`, kind: "cost" });
          }
        }
      }
    } else if (t === "building" && this.st.kind) {
      const pl = g.placement(this.st.kind, c);
      const gh = pv.ghost;
      if (gh) {
        if (pl) {
          gh.visible = true;
          lotMatrix(gh.matrix, pl.c, pl.rot, pl.side, 0.2);
          gh.matrixAutoUpdate = false;
          gh.matrixWorldNeedsUpdate = true;
          (gh.material as THREE.MeshLambertMaterial).color.setHex(pl.ok ? 0xffffff : 0xff6b6b);
          if (!pl.ok) {
            chips.push({ text: pl.reason ?? "Can't place here", kind: "error" });
            for (const id of pl.blockers) {
              const b = g.buildings.byId.get(id);
              if (b) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
            }
          }
        } else chips.push({ text: "Needs a street or avenue to face", kind: "error" });
      }
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
        const T = MAP.tile;
        pv.footprint([v2(i * T, j * T), v2((i + 1) * T, j * T), v2((i + 1) * T, (j + 1) * T), v2(i * T, (j + 1) * T)], g.canUnlock(i, j) ? 0x58c8e6 : 0x888888);
        chips.push({ text: g.canUnlock(i, j) ? `Unlock area (${g.tileTokens} left)` : g.tileTokens > 0 ? "Must border an owned area" : "No unlocks left", kind: g.canUnlock(i, j) ? "info" : "error" });
      }
    } else if (t === "inspect") {
      const b = g.buildings.at(c);
      if (b) chips.push({ text: BUILDING_TYPES[b.kind].name, kind: "info" });
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
    if (mx || my) {
      this.view.cx += mx * pan;
      this.view.cy += my * pan;
      this.clampView();
      if (this.hasCursor) this.updateCursor(this.cursorPx);
    }
    g.update(dt);
    this.vehicles.update(g.traffic, g.alpha);
    this.flowT += dt;
    const flowOn = this.overlay === "flow" || this.focus === "flow";
    this.roads.update(g.traffic, flowOn && this.flowT > 0.5);
    if (this.flowT > 0.5) this.flowT = 0;
    if (this.dirtyPreview) this.refreshPreview();
    this.hudT += dt;
    if (this.hudT > 0.25) {
      this.hudT = 0;
      this.hud?.tick();
      if (this.overlay !== "none" || this.focus) this.applyTint();
    }
    this.saveT += dt;
    if (this.saveT > 60) { this.saveT = 0; this.saves.autosave(g); }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 4);
      this.hud?.shake(this.shake);
    }
    this.view.render();
    requestAnimationFrame(this.frame);
  };

  start() {
    requestAnimationFrame(this.frame);
  }

  /** Last road plan (for tests / debugging). */
  get lastPlan() {
    return this.plan;
  }

  get mpp() {
    return this.view.mpp;
  }
}

/** red -> amber -> green ramp for 0..1 */
export function ramp(v: number): number {
  const c = new THREE.Color();
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.5) c.lerpColors(new THREE.Color(0xe5484d), new THREE.Color(0xf5b82e), t / 0.5);
  else c.lerpColors(new THREE.Color(0xf5b82e), new THREE.Color(0x4cc46a), (t - 0.5) / 0.5);
  return c.getHex();
}
