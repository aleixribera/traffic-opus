import * as THREE from "three";
import { BUILDING_TYPES, LEVEL_H, MAX_LEVEL, ROAD_TYPES, SIM, roadWidth, type RoadTypeId } from "./config";
import { cubicAt, cubicTangent, dist, dot, formatMoney, norm, rectCorners, right, sub, v2, wrapAngle, type V2 } from "./core/math";
import type { Building } from "./game/buildings";
import { Game } from "./game/city";
import {
  parallelSpacing, planAddLane, planRoad, planRoundabout, removalRefund, segAt, snap,
  type CurveMode, type Plan, type RoundaboutSize, type Snap, type SnapOpts,
} from "./roads/planner";
import { toolSnap, type ToolSnap } from "./roads/snapping";
import { armsAt, slipTangents } from "./roads/planner";
import { Buildings3D } from "./render/buildings3d";
import { Parks3D } from "./render/parks3d";
import { Fireworks } from "./render/fx3d";
import { ConvoyTags } from "./ui/convoyTags";
import { GATE_GAP, siteFrame, siteToWorld } from "./game/sites";

/** How far outside a waiting site's gate the road tool snaps a road's end (m): clear of the fence, well in reach. */
const GATE_SNAP = 7;
/** How far one pixel of scrolling turns the building being placed (a wheel notch of ~100 px: ~10°). */
const PLACE_TURN_PER_PX = (10 * Math.PI) / 180 / 100;
/** Shift + the wheel, or Shift + , and ., turns it in fine steps: a wheel notch (or a key press) turns it 1°. */
const FINE_TURN = Math.PI / 180;
import { ZONES } from "./game/zones";
import { MIN_DEPOSIT, PLANTS, PRODUCTS, UNPOWERED, isPlantKind, type Product } from "./game/industry";
import { labelNeeds, type LabelNeeds } from "./ui/needs";
import { productIcon } from "./ui/icons";
import { TownPings } from "./ui/townPings";
import { STUCK_KEEP, StuckAlerts } from "./ui/stuckAlerts";
import { DEPOSIT_KINDS, DepositMarks } from "./ui/depositMarks";
import { served } from "./game/settlements";
import type { ModelSet } from "./render/models";
import { Preview3D } from "./render/preview3d";
import { Highlight3D } from "./render/highlight3d";
import { junctionAt, pickAt, poseOf } from "./ui/pick";
import type { Sel } from "./ui/inspect";
import { Roads3D } from "./render/roads3d";
import { RoadsFar } from "./render/roadsFar";
import { MapLabels } from "./ui/labels";
import { MapIcons } from "./ui/mapIcons";
import { Pops } from "./ui/pops";
import { Terrain3D } from "./render/terrain3d";
import { Clearing, clearShapes } from "./render/clearing";
import { Vehicles3D } from "./render/vehicles3d";
import { Transit3D, legPoints } from "./render/transit3d";
import { STOP_COST } from "./game/transit";
import { View } from "./render/view";
import { Saves } from "./game/saves";
import { PLACED, type PlacedKind } from "./game/placed";
import type { Hud, Chip } from "./ui/hud";

export type ToolId = "inspect" | "road" | "roundabout" | "junction" | "lane" | "bulldoze" | "place" | "transit";
/** The bus tool: put stops on the kerb, or click stops in order to make a line. */
export type TransitMode = "stop" | "line";
/** Road tool modes, as in Transport Fever 2: the two drawing modes (curve, straight) and Upgrade (change type / reverse). */
export type RoadMode = CurveMode | "replace";
export const ROAD_MODES: RoadMode[] = ["curve", "straight", "replace"];
export type OverlayId = "none" | "flow" | "resources" | "landvalue" | "level" | "problems" | "power";

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
  /** Straight pieces turn in 15° steps (off the world grid or the road they start from); Shift flips it while drawing. */
  angleLock: boolean;
  bdzLevel: number | null; // bulldozer elevation filter (null = all)
  reverse: boolean; // upgrade tool flips one-ways instead
  placed: PlacedKind; // building being placed
  /** how the building being placed is turned (radians; 0: its gate toward the bottom of the screen): the scroll wheel turns it freely, , and . in 15° steps, Shift with either in 1° steps */
  placeTurn: number;
  transitMode: TransitMode;
}

interface PointerInfo { id: number; x: number; y: number; sx: number; sy: number; button: number; moved: boolean; t: number }

export class App {
  game!: Game;
  view: View;
  roads!: Roads3D;
  roadsFar!: RoadsFar;
  labels = new MapLabels();
  icons = new MapIcons();
  /** tags over the oversized-load convoys (click one to follow it) */
  convoyTags = new ConvoyTags((id) => { this.followT = id === null ? 0 : 1; });
  /** markers on towns that have just sprung up (click the edge pointer to fly there) */
  /** the deposits' tags and the "nearest coal" pointers (while an extractor is placed, and in the Resources view) */
  depositMarks = new DepositMarks(() => this.game.terrain.gen, (c) => this.flyTo(c));
  stuckAlerts = new StuckAlerts((c) => this.flyTo(c, 140));
  townPings = new TownPings({ fly: (id) => this.flyToTown(id), open: (id) => { this.setTool({ tool: "inspect" }); this.hud?.openTown(id); } });
  private followT = 0;
  /** the camera gliding to a place (a finished landmark): from, to, start and length (s) */
  /** a camera glide under way; `lift`: how much further out (m of half height) it pulls at the middle of the way */
  private glide: { from: { x: number; y: number; h: number }; to: { x: number; y: number; h: number }; t: number; dur: number; lift: number } | null = null;
  parks3d!: Parks3D;
  fireworks = new Fireworks();
  /** money and moments rising off the map, and the shelf-time rings over refrigerated trucks */
  pops = new Pops();
  /** Shift + wheel scrolling not yet turned into a whole degree (px) */
  private fineWheel = 0;
  private treesDue: ReturnType<typeof setTimeout> | 0 = 0;
  private iconT = 0;
  private labelKey = "";
  vehicles!: Vehicles3D;
  buildings3d!: Buildings3D;
  terrain3d!: Terrain3D;
  private clearing!: Clearing;
  preview = new Preview3D();
  saves = new Saves();
  hud!: Hud;
  st: ToolState = {
    tool: "inspect", roadType: "dirt", mode: "curve", level: 0, rbSize: 1, parallel: false, parOffset: null,
    snapOff: { geometry: false, guides: false, netSide: false }, snapLength: true, angleLock: false, bdzLevel: null, reverse: false,
    placed: "farm", placeTurn: 0, transitMode: "stop",
  };
  /** stops clicked so far for the bus line being drawn */
  lineDraft: number[] = [];
  transit3d!: Transit3D;
  uiHidden = false;
  /** menu: the showcase city playing behind the title menu (no input, no saving); explore: that city, free to look round, never saved. */
  mode: "menu" | "play" | "explore" = "play";
  /** Set at boot: back to the title menu. */
  openMenu?: () => void;
  private modeListeners: ((m: App["mode"]) => void)[] = [];
  overlay: OverlayId = "none";
  selected: Building | null = null;
  /** what the inspector has selected (the HUD sets it; one at a time) */
  sel: Sel | null = null;
  /** the map's lit-up view of the selection (docs/ui-style.md "Inspector") */
  readonly highlight = new Highlight3D();
  /** an ordinary vehicle the camera follows (convoys use their tags' follow) */
  private followV: number | null = null;
  private worldRoot = new THREE.Group();
  private cursor: V2 = v2(0, 0);
  private cursorPx: V2 = v2(0, 0);
  private hasCursor = false;
  // road tool state
  private anchor: Snap | null = null;
  private startTangent: V2 | undefined;
  /** A curve begun on open ground (or mid-road): the way the cursor first moved off the start. */
  private freeDir: V2 | undefined;
  /** Last frame's snap (the snapping keeps its target until the cursor moves clearly away). */
  private lastSnap: ToolSnap | null = null;
  /** A road through homes waits for a second click on the same plan: what it would demolish. */
  private confirmKey: string | null = null;
  /** Where the parallel road's last piece ended (to carry on from it). */
  private parFrom: Snap | undefined;
  private plan: Plan | null = null;
  // drag state
  private pointers = new Map<number, PointerInfo>();
  /** Bulldozer marquee, in screen pixels (the view may be turned). */
  private dragRect: { a: V2; b: V2 } | null = null;
  private pinch: { d: number; mid: V2; ang: number } | null = null;
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
    this.view.scene.add(this.highlight.group);
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
    const g = new Game(seed);
    g.start();
    this.setGame(g);
    // open on the starting hamlet
    const t = g.towns.list[0];
    this.view.cx = t?.c.x ?? 0;
    this.view.cy = t?.c.y ?? 0;
    this.view.halfH = 260;
  }

  loadGame(data: ReturnType<Game["serialize"]>) {
    this.setGame(Game.load(data));
  }

  /**
   * Glide the camera to a place over `dur` seconds (eased), ending zoomed to `halfH`, pulling out by up to `lift` on
   * the way (a jump, with reduced motion asked for).
   */
  glideTo(p: V2, halfH: number, dur = 1.6, lift = 0) {
    this.convoyTags.follow(null);
    this.followV = null;
    if (reducedMotion()) {
      this.glide = null;
      this.view.cx = p.x;
      this.view.cy = p.y;
      this.view.halfH = Math.min(this.view.maxHalfH, halfH);
      return;
    }
    this.glide = { from: { x: this.view.cx, y: this.view.cy, h: this.view.halfH }, to: { x: p.x, y: p.y, h: Math.min(this.view.maxHalfH, halfH) }, t: 0, dur, lift };
  }

  /**
   * Fly the camera to a town (a new one's marker or banner): a longer glide the further it is, pulling out over the
   * way there, and ending over the town with its panel open.
   */
  flyToTown(id: number) {
    const t = this.game.towns.byId.get(id);
    if (!t) return;
    this.townPings.seen(id);
    const d = Math.hypot(t.c.x - this.view.cx, t.c.y - this.view.cy);
    // (out far enough at the middle of the way to see both ends of it, so a far town reads as far)
    const lift = Math.max(0, Math.min(this.view.maxHalfH, d * 0.4) - Math.max(this.view.halfH, 420));
    this.glideTo(t.c, 420, Math.min(3.2, 1.4 + d / 4000), lift);
    this.setTool({ tool: "inspect" });
    this.hud?.openTown(id);
  }

  /** Fly the camera to a place on the map (a deposit's tag or pointer): longer the further, pulling out on the way. */
  flyTo(c: V2, halfH = 650) {
    const d = Math.hypot(c.x - this.view.cx, c.y - this.view.cy);
    const lift = Math.max(0, Math.min(this.view.maxHalfH, d * 0.4) - Math.max(this.view.halfH, halfH));
    this.glideTo(c, halfH, Math.min(3.2, 1.2 + d / 4000), lift);
  }

  /** The deposit kinds the map marks now: the one the extractor being placed works, or every kind in the Resources view. */
  private markedDeposits(): { kinds: typeof DEPOSIT_KINDS extends Map<number, infer K> ? K[] : never; focus: boolean } {
    if (this.uiHidden || this.mode === "menu") return { kinds: [], focus: false };
    const k = this.st.placed;
    if (this.st.tool === "place" && isPlantKind(k) && PLANTS[k].deposit) return { kinds: [DEPOSIT_KINDS.get(PLANTS[k].deposit!.field)!], focus: true };
    if (this.overlay === "resources") return { kinds: [...DEPOSIT_KINDS.values()], focus: false };
    return { kinds: [], focus: false };
  }

  /** Which way b lies from a on screen: radians clockwise from screen up (the camera may be turned). */
  screenBearing(a: V2, b: V2): number {
    const p = this.view.toScreen(a), q = this.view.toScreen(b);
    return Math.atan2(q.x - p.x, -(q.y - p.y));
  }

  /** A landmark is finished: the camera swings over to it and a fireworks show goes up over it. */
  private celebrate(id: number) {
    const b = this.game.buildings.byId.get(id);
    if (!b || this.mode !== "play") return;
    this.glideTo(b.c, Math.max(220, Math.hypot(b.hw, b.hd) * 1.6), 2.2);
    this.fireworks.launch(b.c, Math.max(70, Math.hypot(b.hw, b.hd) * 0.8), 18, performance.now() / 1000 + 1.4);
  }

  /** Have the camera follow a vehicle (null: let it go). A convoy uses its tag's follow, which zooms in to start. */
  followVehicle(id: number | null) {
    if (id === null) { this.followV = null; if (this.convoyTags.following !== null) this.convoyTags.follow(null); return; }
    this.glide = null;
    const v = this.game.traffic.vehicles.find((x) => x.id === id);
    if (!v) return;
    this.followV = id;
    if (this.view.halfH > 260) this.followT = 1;
  }

  /** The vehicle the camera is following, if any. */
  get following(): number | null { return this.followV ?? this.convoyTags.following; }

  /** Whether a place is well inside the screen (not under the panels at its edges). */
  onScreen(p: V2): boolean {
    const s = this.view.toScreen(p);
    return s.x > 80 && s.x < this.view.w - 360 && s.y > 80 && s.y < this.view.h - 80;
  }

  /** What the inspect tool would select at p (ui/pick.ts: vehicle, bus stop, building, junction, road). */
  pickAt(p: V2): Sel | null {
    return pickAt(this.game, p, this.view.mpp, this.view.halfH <= 1800);
  }

  /** Point the camera at a place, zoomed out to at least `halfH`. */
  lookAt(p: V2, halfH: number) {
    this.view.cx = p.x;
    this.view.cy = p.y;
    this.view.halfH = Math.min(this.view.maxHalfH, Math.max(this.view.halfH, halfH));
  }

  private setGame(g: Game) {
    this.game = g;
    this.view.rot = 0;
    this.hud?.compassAngle(0);
    this.hud?.clearBanners();
    for (const c of [...this.worldRoot.children]) this.worldRoot.remove(c);
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.terrain3d = new Terrain3D(g.terrain, small);
    // (no trees on roads, their verges, sites or plots: the ground's crowns give way round whatever is built)
    this.clearing?.dispose();
    this.clearing = new Clearing(() => clearShapes(g.net, g.buildings.list));
    const sh = this.terrain3d.shared;
    sh.uClear.value = this.clearing.tex; sh.uClearO.value = this.clearing.origin; sh.uClearS.value = this.clearing.size;
    this.roads = new Roads3D(g.net, {
      props: this.models.props, isWater: (p) => g.terrain.isWater(p),
      drives: () => g.buildings.list.filter((b) => b.access && !b.plant).map((b) => b.front),
      gates: () => g.buildings.list.filter((b) => b.placed && b.plant).map((b) => ({ ...siteFrame(b.c, b.rot, b.side, b.hd), front: b.front })),
    });
    this.roadsFar = new RoadsFar(g.net);
    this.labels.set([]);
    this.labelKey = "";
    this.vehicles = new Vehicles3D(this.models);
    this.buildings3d = new Buildings3D(this.models, () => this.game.time, g.net);
    this.vehicles.lotOf = (id) => { const b = g.buildings.byId.get(id); return b ? this.buildings3d.lotWay(b) : null; };
    this.transit3d = new Transit3D(this.models.props.get("busstop"));
    this.parks3d = new Parks3D(this.models);
    this.convoyTags.follow(null);
    this.followV = null;
    // (the old game's selection would name something else, or nothing, in this one)
    this.hud?.closePanels();
    this.sel = null;
    this.highlight.set(null);
    this.highlight.hoverV = null;
    this.glide = null;
    this.worldRoot.add(this.terrain3d.group, this.roads.group, this.roadsFar.group, this.buildings3d.group, this.vehicles.group, this.transit3d.group, this.parks3d.group, this.fireworks.group);
    this.roads.rebuildAll();
    this.buildings3d.rebuild(g.buildings.list);
    this.groundOverlay();
    this.pops.clear();
    this.icons.boostOf = (b) => g.industry.boosts(b);
    g.on((e) => {
      // (a delivery or a by-product leaving only pops over the map: nothing else on screen changes)
      if (e.t === "delivery") { if (this.mode !== "menu") this.pops.delivery(e.d, this.view); return; }
      if (e.t === "shipped") { if (this.mode !== "menu") this.pops.shipped(e.from, e.to, e.p, this.view); return; }
      if (e.t === "roads") { this.roads.apply(e.cs); this.clearing.invalidate(); this.roadsFar.invalidate(); this.buildings3d.rebuildDrives(g.buildings.list); this.dirtyPreview = true; }
      else if (e.t === "buildings") {
        this.buildings3d.rebuild(g.buildings.list); this.roads.refreshGates(); this.clearing.invalidate(); this.applyTint(); this.dirtyPreview = true;
        // (street trees make way for new driveways: at most twice a second while a town grows)
        if (!this.treesDue) this.treesDue = setTimeout(() => { this.treesDue = 0; this.roads.refreshTrees(); }, 500);
      }
      else if (e.t === "zones") this.dirtyPreview = true;
      else if (e.t === "milestone") { if (this.mode === "play") this.hud?.milestone(e.m, e.towns); }
      else if (e.t === "townSpawned") { if (this.mode === "play") this.hud?.townSpawned(e.town, e.from, e.dist, e.dir); }
      else if (e.t === "toast") { if (this.mode !== "menu") this.hud?.toast(e.msg); }
      else if (e.t === "townSize") { if (this.mode === "play") this.hud?.townGrew(e.town, e.size); }
      else if (e.t === "landmark") { if (this.mode === "play") { this.hud?.landmarkDone(e.b); this.celebrate(e.b); } }
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
    if ((p.tool && p.tool !== prev) || (p.mode && p.mode !== prevMode) || p.transitMode) this.cancelStroke();
    if (this.st.tool === "transit" && !this.game.featureUnlocked("transit")) this.st.tool = "inspect";
    // locked road types can't be picked (keyboard, saved state)
    if (!this.game.roadsUnlocked.has(this.st.roadType)) this.st.roadType = "street";
    // (a dirt road is drawn on the ground only)
    if (this.st.tool === "road" && ROAD_TYPES[this.st.roadType].unpaved) this.st.level = 0;
    if ((this.st.tool === "roundabout" && !this.game.featureUnlocked("roundabout"))) this.st.tool = "inspect";
    if (this.st.tool === "place" && !this.game.placedUnlocked(this.st.placed)) this.st.tool = "inspect";
    if (this.buildings3d) this.applyTint();
    this.groundOverlay();
    // town names are buttons only for looking round: with a tool in hand a click on the town centre goes to the map
    this.labels.passive(this.st.tool !== "inspect");
    if (this.st.tool !== "inspect") { this.selected = null; this.hud?.closePanels(); }
    this.dirtyPreview = true;
    this.hud?.refresh();
  }

  setLevel(l: number) {
    if (l > 0 && this.st.tool === "road" && this.st.mode !== "replace" && ROAD_TYPES[this.st.roadType].unpaved) { this.reject("Dirt roads stay on the ground: a bridge on one is built paved, on its own"); return; }
    this.setTool({ level: Math.max(0, Math.min(MAX_LEVEL, l)) });
  }

  setOverlay(o: OverlayId) {
    this.overlay = this.overlay === o ? "none" : o;
    this.roads.flowMode = this.overlay === "flow";
    this.groundOverlay();
    this.applyTint();
    this.hud?.refresh();
  }

  /** The ground shows where the deposits are in the Resources view, and while an extractor is being placed. */
  private groundOverlay() {
    const k = this.st.placed;
    const extractor = this.st.tool === "place" && isPlantKind(k) && !!PLANTS[k].deposit;
    this.terrain3d?.setOverlay(this.overlay === "resources" || extractor ? "resources" : "none", extractor && isPlantKind(k) ? PLANTS[k].deposit?.field ?? -1 : -1);
  }

  /** The utility on show: its info view, or the one whose plant is being placed. */
  utilityView(): "power" | null {
    if (this.overlay === "power") return "power";
    if (this.overlay === "none" && this.st.tool === "place" && (this.st.placed === "coalplant" || !!PLANTS[this.st.placed].power)) return "power";
    return null;
  }

  /** Building colours for overlays. */
  applyTint() {
    const g = this.game;
    const mode = this.overlay;
    const uv = this.utilityView();
    if (uv) {
      // supply: the company's buildings that get all the power they need go green, short ones orange to red; the
      // plants stand out in blue, everything that needs no power is grey
      this.buildings3d.tint((b) => {
        if (b.kind === "coalplant") return 0x2f86e0;
        if (g.utilities.demandOf(b) <= 0) return 0xc9c9c9;
        const v = g.utilities.supplyOf(b);
        return v >= 0.999 ? 0x3faa5a : v > 0.6 ? 0xf0a33a : 0xe5484d;
      });
      return;
    }
    if (mode === "none" || mode === "flow" || mode === "resources") { this.buildings3d.tint(null); return; }
    this.buildings3d.tint((b) => {
      if (mode === "problems" && b.plant) return b.problem ? 0xe5484d : 0x2f86e0;
      if (!b.zone) return 0xb5b5b5;
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
    this.freeDir = undefined;
    this.lastSnap = null;
    this.confirmKey = null;
    this.parFrom = undefined;
    this.plan = null;
    this.dragRect = null;
    this.lineDraft = [];
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
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.mode === "menu") return;
      // a building in hand turns with the wheel (Ctrl + wheel still zooms; so do R and F)
      if (this.st.tool === "place" && !e.ctrlKey) {
        // (with Shift held the browser may scroll sideways instead: either way it is the wheel turning)
        const d = e.deltaY || (e.shiftKey ? e.deltaX : 0);
        if (!d) return;
        const px = e.deltaMode === 1 ? d * 33 : d;
        if (e.shiftKey) {
          // (fine: a degree per wheel notch, ~100 px; a trackpad's many small steps add up to the same)
          this.fineWheel += Math.sign(px) * Math.min(Math.abs(px), 200);
          while (Math.abs(this.fineWheel) >= 100) {
            const dir = this.fineWheel > 0 ? 1 : -1;
            this.fineWheel -= dir * 100;
            this.turnPlaced(dir, true);
          }
          return;
        }
        this.st.placeTurn = wrapAngle(this.st.placeTurn + Math.sign(px) * Math.min(Math.abs(px), 200) * PLACE_TURN_PER_PX);
        this.dirtyPreview = true;
        return;
      }
      const r = el.getBoundingClientRect();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
      this.view.zoomAt(e.clientX - r.left, e.clientY - r.top, k);
      this.clampView();
      this.dirtyPreview = true;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    // (the place names sit over the map: the wheel over one zooms the map, as anywhere else)
    this.labels.el.addEventListener("wheel", wheel, { passive: false });
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
      return;
    }
    this.updateCursor(p);
    if (e.button === 0 && e.pointerType !== "touch" && this.st.tool === "bulldoze") this.dragRect = { a: p, b: p };
  }

  /** A plan through homes builds on a second click, and only when its cost and the compensation can be paid. */
  private confirmLots(plan: Plan): boolean {
    const g = this.game, lots = g.lotsUnder(plan), total = plan.cost + g.demolishCost(lots);
    if (total > g.money + 0.5) { this.reject(`Not enough money (${formatMoney(total)} with the compensation)`); return false; }
    if (!lots.length) return true;
    const key = this.planKey(plan, lots);
    if (this.confirmKey !== key) { this.confirmKey = key; this.hud?.sound("error"); this.dirtyPreview = true; return false; }
    this.confirmKey = null;
    return true;
  }

  private lotWarning(plan: Plan, chips: Chip[]) {
    if (plan.errors.length) return;
    const lots = this.game.lotsUnder(plan);
    for (const b of lots) this.preview.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
    if (!lots.length) return;
    const comp = this.game.demolishCost(lots), what = `${lots.length} building${lots.length === 1 ? "" : "s"}`;
    chips.push({ text: this.confirmKey === this.planKey(plan, lots) ? `Click again to demolish ${what} (${formatMoney(comp)})` : `Demolishes ${what}: ${formatMoney(comp)} compensation`, kind: "error" });
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
        // (taking the camera by hand lets a followed convoy go)
        if (this.convoyTags.following !== null) this.convoyTags.follow(null);
        this.followV = null;
        this.glide = null;
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
    if (this.dragRect && pi.moved && pi.button === 0) {
      this.finishRect();
      return;
    }
    this.dragRect = null;
    this.hud?.rect(null);
    if (pi.moved) return;
    this.updateCursor(p);
    if (pi.button === 2) {
      // add lane: right-click takes a turn lane away
      if (this.st.tool === "lane") {
        const lp = planAddLane(this.game.net, this.game.world, this.cursor, true);
        if (lp?.pocket && !lp.errors.length) { this.onClick(true); return; }
      }
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
    if (k === "Shift") this.dirtyPreview = true; // the lane tool previews removal while it is held
    if (k === "Alt") { e.preventDefault(); this.dirtyPreview = true; } // held: no snapping (and no browser menu bar)
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
    else if (k === "l") this.setTool({ tool: this.st.tool === "lane" ? "inspect" : "lane" });
    else if (k === "p") this.hud?.toggleWin("progression");
    else if (k === "z") this.hud?.toggleWin("economy");
    else if (k === "c") this.hud?.toggleWin("city");
    else if (k === "x") this.hud?.toggleWin("transport");
    else if (k === "[" || k === "]") this.nudgeParallel(k === "]" ? 1 : -1);
    else if ((e.code === "Comma" || e.code === "Period") && this.st.tool === "place") this.turnPlaced(e.code === "Period" ? 1 : -1, e.shiftKey);
    else if (k === "`" || e.code === "Backquote") this.toggleUi();
    else if (k === "F5") { e.preventDefault(); this.quickSave(); }
    else if (k === "F9") { e.preventDefault(); this.quickLoad(); }
  }

  /** Turn the building being placed by 15 degrees (, anticlockwise, . clockwise on screen), or by 1 degree (fine). */
  turnPlaced(dir: 1 | -1, fine = false) {
    const step = fine ? FINE_TURN : Math.PI / 12;
    let t = Math.round((this.st.placeTurn + dir * step) / step) * step;
    if (Math.abs(Math.abs(t) - 2 * Math.PI) < 1e-6) t = 0;
    this.st.placeTurn = wrapAngle(t);
    this.dirtyPreview = true;
  }

  /** How the building being placed is turned, and where the bottom of the screen points (a free site faces it). */
  private placeOpts() {
    // (turned from facing the bottom of the screen, so it turns as the player sees it, whichever way the map is turned)
    const down = { x: -Math.sin(this.view.rot), y: Math.cos(this.view.rot) };
    return { rot: wrapAngle(Math.atan2(down.x, -down.y) + this.st.placeTurn), down };
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
    void this.saves.saveSoon(this.game, "Quicksave", "quick").then((m) => {
      if (m) this.hud?.toast("Quicksaved (F9 to load)");
      else this.reject("Couldn't save: browser storage is full");
    });
  }

  quickLoad() {
    const d = this.saves.load("quick");
    if (!d) { this.reject("No quicksave yet (F5 saves)"); return; }
    try { this.loadGame(d); } catch (e) { this.reject(String(e).includes("older version") ? "That quicksave is from an older version" : "Couldn't load the quicksave"); return; }
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
      angleStep: this.st.angleLock !== this.keys.has("Shift"),
      off: this.st.snapOff,
      lengthStep: this.st.snapLength ? 8 : 0,
      gates: this.waitingGates(),
      sites: this.game.buildings.siteTargets(),
    };
  }

  /** Just outside the gates of the company's sites that have no road yet (a road ending there joins them). */
  private waitingGates(): V2[] {
    const out: V2[] = [];
    for (const b of this.game.buildings.sites) {
      if (b.access) continue;
      const f = siteFrame(b.c, b.rot, b.side, b.hd);
      out.push({ x: f.gate.x - f.into.x * GATE_SNAP, y: f.gate.y - f.into.y * GATE_SNAP });
    }
    return out;
  }

  /** The road tool's snap at the cursor (guides, hysteresis; Alt held: none). */
  private roadSnap(from?: Snap): ToolSnap {
    return toolSnap(this.game.net, this.cursor, {
      ...this.snapOpts(from), prev: this.lastSnap, free: this.keys.has("Alt"), curve: !!from && this.st.mode === "curve",
    });
  }

  /**
   * The direction a curve leaves its start in: along the road it carries on (a dead end, or the piece before), else the
   * way the cursor first moved off the start (square to the road it starts on when nearly so, or in 15° steps with
   * angle steps on). Bringing the cursor back to the start lets it be aimed again.
   */
  private curveStart(): V2 | undefined {
    const a = this.anchor;
    if (!a) return undefined;
    const fixed = this.startTangent ?? a.tangent;
    if (fixed) return fixed;
    const d = sub(this.cursor, a.p), L = Math.hypot(d.x, d.y);
    const unlock = Math.max(4, 14 * this.view.mpp);
    if (L < unlock) { this.freeDir = undefined; return undefined; }
    if (!this.freeDir) {
      let dir = norm(d);
      // off a road mid-way: square to it when nearly so
      const s = a.seg !== undefined ? this.game.net.segs.get(a.seg) : undefined;
      if (s) {
        const tr = right(norm(sub(s.c.p3, s.c.p0)));
        for (const n of [tr, { x: -tr.x, y: -tr.y }]) if (dot(n, dir) > Math.cos((14 * Math.PI) / 180)) dir = n;
      }
      if (this.st.angleLock !== this.keys.has("Shift")) {
        const step = Math.PI / 12, ang = Math.round(Math.atan2(dir.y, dir.x) / step) * step;
        dir = { x: Math.cos(ang), y: Math.sin(ang) };
      }
      this.freeDir = dir;
    }
    return this.freeDir;
  }

  // ---------------------------------------------------------------- clicks

  /** Right click (CS2): undo the last click of the road being drawn. */
  /** Undo the last click of a stroke. False when there was nothing to undo. */
  stepBack(): boolean {
    this.dirtyPreview = true;
    if (this.dragRect) { this.dragRect = null; this.hud?.rect(null); }
    else if (this.anchor) { this.anchor = null; this.startTangent = undefined; this.freeDir = undefined; this.parFrom = undefined; this.confirmKey = null; }
    else if (this.lineDraft.length) this.lineDraft.pop();
    else return false;
    return true;
  }

  /** The bus stop under (or right next to) a point. */
  stopAt(p: V2, r = 9): number | null {
    let best: number | null = null, bd = r;
    for (const st of this.game.transit.stops.values()) {
      const d = Math.hypot(st.p.x - p.x, st.p.y - p.y);
      if (d < bd) { bd = d; best = st.id; }
    }
    return best;
  }

  private transitClick() {
    const g = this.game, c = this.cursor, tr = g.transit;
    if (this.st.transitMode === "stop") {
      if (this.stopAt(c, 6) !== null) { this.reject("There's a stop here already"); return; }
      const pl = tr.stopPlan(c);
      if (!pl) { this.reject("Put stops beside a street"); return; }
      if (!pl.ok) { this.reject(pl.why ?? "Can't put a stop here"); return; }
      tr.addStop(c);
      this.hud?.sound("build");
      this.hud?.toast(`Bus stop built for ${formatMoney(STOP_COST)}`);
      this.dirtyPreview = true;
      return;
    }
    const id = this.stopAt(c);
    if (id === null) { this.reject(tr.stops.size < 2 ? "Put down two or more bus stops first" : "Click a bus stop"); return; }
    const d = this.lineDraft;
    if (d.length >= 2 && id === d[0]) {
      const l = tr.addLine(d);
      this.lineDraft = [];
      if (!l) { this.reject("That line needs two stops"); return; }
      const ok = isFinite(tr.loopTime(l));
      this.hud?.sound("build");
      this.hud?.toast(ok ? `${l.name} opened: ${l.stops.length} stops, ${l.want} bus${l.want === 1 ? "" : "es"}` : `${l.name} made, but its buses can't get round it: check the roads between its stops`);
      this.hud?.openLines(l.id);
    } else if (d.includes(id)) { this.reject(d.length >= 2 ? "Click the first stop to close the line" : "Already on this line"); return; }
    else {
      if (d.length && !tr.routeKeys(tr.stops.get(d[d.length - 1])!.access, tr.stops.get(id)!.access)) { this.reject("Buses can't drive there from the last stop"); return; }
      d.push(id);
      this.hud?.sound("place");
    }
    this.dirtyPreview = true;
  }

  private transitPreview(pv: Preview3D, chips: Chip[]) {
    const g = this.game, c = this.cursor, tr = g.transit;
    if (this.st.transitMode === "stop") {
      const here = this.stopAt(c, 6);
      chips.push({ text: "Bus stop", kind: "info" });
      if (here !== null) { pv.dot(tr.stops.get(here)!.p, 0x2f6fd0); chips.push({ text: "There's a stop here already", kind: "error" }); return; }
      const pl = tr.stopPlan(c);
      if (!pl) { chips.push({ text: "Put stops beside a street", kind: "info" }); return; }
      pv.dot(pl.p, pl.ok ? 0x34c25a : 0xe5484d, 2.4);
      if (!pl.ok) chips.push({ text: pl.why ?? "Can't put a stop here", kind: "error" });
      else chips.push({ text: formatMoney(STOP_COST), kind: STOP_COST > g.money ? "error" : "cost" });
      return;
    }
    const d = this.lineDraft;
    const col = tr.nextColor();
    const hover = this.stopAt(c);
    for (let i = 0; i + 1 < d.length; i++) pv.path(legPoints(tr, g.net, tr.stops.get(d[i])!.access, tr.stops.get(d[i + 1])!.access), col);
    if (d.length && hover !== null && hover !== d[d.length - 1] && (!d.includes(hover) || (hover === d[0] && d.length >= 2))) {
      const pts = legPoints(tr, g.net, tr.stops.get(d[d.length - 1])!.access, tr.stops.get(hover)!.access);
      if (pts.length) pv.path(pts, col, 1.8);
      else chips.push({ text: "Buses can't drive there from the last stop", kind: "error" });
    }
    for (const st of tr.stops.values()) pv.dot(st.p, d.includes(st.id) ? col : 0xffffff, st.id === hover ? 3.8 : 2.8);
    if (!d.length) chips.push({ text: hover !== null ? "Start the line here" : "Click the stops in order", kind: "info" });
    else if (hover === d[0] && d.length >= 2) chips.push({ text: `Finish the line: ${d.length} stops`, kind: "info" });
    else chips.push({ text: `${d.length} stop${d.length === 1 ? "" : "s"} · click the first stop to finish`, kind: "info" });
  }

  private onClick(shift: boolean) {
    const g = this.game;
    const t = this.st.tool;
    const c = this.cursor;
    if (t === "lane") {
      const lp = planAddLane(g.net, g.world, c, shift);
      if (!lp) { this.reject("Click a road just before a junction"); return; }
      if (lp.errors.length) { this.reject(lp.errors[0].msg); return; }
      if (lp.road && !this.confirmLots(lp.road)) return;
      if (!g.addLane(lp)) { this.reject("Nothing to change here"); return; }
      const removed = !!lp.pocket && lp.pocket.len === 0;
      this.hud?.sound(removed ? "remove" : "build");
      this.hud?.toast(removed ? lp.label : lp.cost ? `${lp.label} built for ${formatMoney(lp.cost)}` : lp.label);
      this.dirtyPreview = true;
      return;
    }
    if (t === "transit") { this.transitClick(); return; }
    if (t === "place") {
      const k = this.st.placed;
      const pl = g.placedPlan(k, c, this.placeOpts());
      if (!pl) { this.reject("Can't build here"); return; }
      if (!pl.ok) { this.reject(pl.reason ?? "Can't build here"); return; }
      const b = g.place(k, c, this.placeOpts());
      if (!b) { this.reject("Can't build here"); return; }
      this.hud?.sound("build");
      this.hud?.toast(`${BUILDING_TYPES[k].name} built for ${formatMoney(pl.cost)}`);
      this.dirtyPreview = true;
      return;
    }
    if (t === "inspect") {
      // anything on the map opens its panel; empty ground clears the selection
      const s = this.pickAt(c);
      if (!s) { this.hud?.closePanels(); return; }
      if (s.k === "node") this.hud?.openSignal(s.id);
      else this.hud?.openSel(s);
      this.dirtyPreview = true;
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
      if (!this.anchor) {
        this.anchor = this.roadSnap();
        this.lastSnap = null;
        this.startTangent = undefined;
        this.freeDir = undefined;
        this.parFrom = undefined;
        this.confirmKey = null;
        this.dirtyPreview = true;
        return;
      }
      const plan = this.computeRoadPlan();
      if (!plan) return;
      if (plan.errors.length) { this.reject(plan.errors[0].msg); return; }
      // through homes: say what goes and what it costs, and build on a second click
      const lots = g.lotsUnder(plan);
      if (plan.cost + g.demolishCost(lots) > g.money + 0.5) { this.reject(`Not enough money (${formatMoney(plan.cost + g.demolishCost(lots))} with the compensation)`); return; }
      if (lots.length) {
        const key = this.planKey(plan, lots);
        if (this.confirmKey !== key) {
          this.confirmKey = key;
          this.hud?.sound("error");
          this.dirtyPreview = true;
          return;
        }
      }
      this.confirmKey = null;
      const lead = plan.strokes[0] ?? plan.ghosts![0];
      const endP = plan.continueAt?.p ?? (lead.chain.length ? lead.chain[lead.chain.length - 1].p3 : c);
      const endH = plan.continueAt?.h ?? lead.h1;
      if (g.build(plan)) {
        this.hud?.sound("build");
        if (plan.bridges?.length) this.hud?.toast(plan.bridges.length === 1 ? `Bridge built: ${Math.round(plan.bridges[0].length)} m span` : `${plan.bridges.length} bridges built`);
        // keep drawing from where this road ended
        const s = snap(g.net, endP, { ...this.snapOpts(), mpp: 0.05, off: undefined, lengthStep: 0 });
        this.anchor = s.node !== undefined || (plan.continueAt && s.seg !== undefined) ? s : { p: endP, h: endH, guides: [] };
        this.startTangent = plan.endTangent;
        this.freeDir = undefined;
        this.lastSnap = null;
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
      if (!this.confirmLots(plan)) return;
      if (g.build(plan)) this.hud?.sound("build");
      return;
    }
    if (t === "bulldoze") {
      const sid = this.stopAt(c, 6);
      if (sid !== null) { g.transit.removeStop(sid); this.hud?.sound("remove"); this.hud?.toast(`Removed bus stop, refunded ${formatMoney(STOP_COST / 2)}`); return; }
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
    return junctionAt(this.game, p, this.view.mpp);
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
    const end = this.roadSnap(this.anchor);
    this.lastSnap = end;
    // started inside a roundabout: join the rim on the side the road actually leaves from
    const start = this.anchor.ringRaw
      ? snap(g.net, this.anchor.ringRaw, { ...this.snapOpts(), angleStep: false, lengthStep: 0, from: { p: end.p } })
      : this.anchor;
    if (end.node !== undefined && end.node === start.node) return null;
    const mode: CurveMode = this.st.mode === "straight" ? "straight" : "curve";
    const plan = planRoad(g.net, g.world, {
      start, end, mode, type: this.st.roadType, bridges: true,
      // (off a one-way carriageway in line with it, a one-way road is a slip road: the planner shapes that)
      startTangent: mode === "curve" ? (!this.startTangent && slipTangents(g.net, start, end, this.st.roadType).ta ? undefined : this.curveStart()) : this.startTangent,
      parallel: this.st.parallel ? { offset: this.parallelOffset(), from: this.parFrom } : undefined,
    });
    (plan as Plan & { snapEnd?: ToolSnap }).snapEnd = end;
    return plan;
  }

  /** What a plan through homes would demolish, as a key: a second click on the same plan confirms it. */
  private planKey(plan: Plan, lots: Building[]): string {
    const lead = plan.strokes[0];
    const e = lead?.chain.length ? lead.chain[lead.chain.length - 1].p3 : { x: 0, y: 0 };
    return lots.map((b) => b.id).sort((x, y) => x - y).join(",") + `@${Math.round(e.x / 3)},${Math.round(e.y / 3)}`;
  }

  private computeRoundabout(): Plan | null {
    const g = this.game;
    const s = snap(g.net, this.cursor, { ...this.snapOpts(), from: undefined, sites: undefined });
    const c = s.node !== undefined ? s.p : this.cursor;
    const h = s.node !== undefined ? g.net.nodes.get(s.node)!.h : this.st.level * LEVEL_H;
    return planRoundabout(g.net, g.world, c, this.st.rbSize, Math.round(h / LEVEL_H));
  }

  // ---------------------------------------------------------------- per frame

  /**
   * Power while placing: a power plant shows the reach it would have and what it would power; a building that needs
   * power shows the reach of the plants there are and whether it would be in one. In reach means near and on the same
   * roads, as for the power itself. Placing either shows the power view.
   */
  private powerPreview(pv: Preview3D, chips: Chip[], k: PlacedKind, c: V2, seg: number | undefined) {
    const g = this.game;
    const D = PLANTS[k];
    const plants = g.buildings.list.filter((b) => b.kind === "coalplant");
    const linked = (b: Building) => seg !== undefined && !!b.access && g.connected(seg, b.access.seg);
    const ring = (p: V2, r: number, color: number) => {
      const pts: V2[] = [];
      for (let i = 0; i <= 96; i++) pts.push(v2(p.x + Math.cos((i / 96) * Math.PI * 2) * r, p.y + Math.sin((i / 96) * Math.PI * 2) * r));
      pv.path(pts, color, Math.max(3, this.view.halfH / 90));
    };
    if (D.makes) {
      ring(c, D.reach!, 0x2f86e0);
      const near = g.buildings.list.filter((b) => g.utilities.demandOf(b) > 0 && dist(b.c, c) <= D.reach! && linked(b)).length;
      chips.push({ text: near ? `Powers ${near} building${near === 1 ? "" : "s"} within ${D.reach! / 1000} km` : `Nothing within ${D.reach! / 1000} km needs power yet`, kind: "info" });
    } else if (D.power) {
      for (const p of plants) ring(p.c, PLANTS.coalplant.reach!, 0x2f86e0);
      const inReach = plants.some((p) => dist(p.c, c) <= PLANTS.coalplant.reach! && linked(p));
      chips.push({ text: inReach ? `Needs ${D.power} MW: a power plant is in reach` : `Needs ${D.power} MW: no power plant in reach, works at ${Math.round(UNPOWERED * 100)}%`, kind: inReach ? "info" : "error" });
    }
  }

  /** The steepest grade along a plan's lead road (%). */
  private maxGrade(plan: Plan): number {
    // (each piece's average climb: the rule the planner holds roads to, not the steepest point of the eased profile)
    const st = plan.strokes[0];
    if (!st) return 0;
    const hs = st.hj ?? [st.h0, st.h1];
    const pieces = st.hj ? st.chain.map((c) => [c]) : [st.chain];
    let g = 0;
    pieces.forEach((cs, i) => {
      let L = 0;
      for (const c of cs) for (let k = 1, q = cubicAt(c, 0); k <= 16; k++) { const r = cubicAt(c, k / 16); L += dist(q, r); q = r; }
      if (hs[i + 1] !== undefined) g = Math.max(g, Math.abs(hs[i + 1] - hs[i]) / (L || 1));
    });
    return g * 100;
  }

  /** Right-angle marks where the planned road leaves or meets another road square. */
  private squareMarks(plan: Plan, end: Snap) {
    const g = this.game, st = plan.strokes[0];
    // (paving a dirt road builds no new road: nothing to square up)
    if (!st?.chain.length) return;
    const size = Math.max(3, this.view.mpp * 16);
    const mark = (sn: Snap, out: V2) => {
      for (const d of armsAt(g.net, sn)) {
        if (Math.abs(dot(d, out)) < Math.sin((0.6 * Math.PI) / 180)) { this.preview.rightAngle(sn.p, out, d, sn.h, size); return true; }
      }
      return false;
    };
    const t0 = norm(cubicTangent(st.chain[0], 0)), t1 = norm(cubicTangent(st.chain[st.chain.length - 1], 1));
    if (this.anchor) mark(this.anchor, t0);
    mark(end, { x: -t1.x, y: -t1.y });
  }

  private refreshPreview() {
    this.dirtyPreview = false;
    const pv = this.preview;
    pv.clear();
    const t0 = this.st.tool;
    if (t0 !== "inspect" || !this.hasCursor) { this.highlight.hoverV = null; this.view.canvas.style.cursor = ""; }
    if (!this.hasCursor) { if (pv.ghost) pv.ghost.visible = false; this.hud?.chips(null); return; }
    const g = this.game;
    const c = this.cursor;
    const t = this.st.tool;
    const chips: Chip[] = [];
    if (pv.ghost) pv.ghost.visible = false;
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
      const T = ROAD_TYPES[this.st.roadType];
      if (!this.anchor) {
        // the start: what it joins, and the same guides as the end (to begin square to a road, or level with one)
        const s = this.roadSnap();
        this.lastSnap = s;
        pv.marker(s.p, s.h);
        pv.refs(s.refs);
        pv.target(g.net, s);
        chips.push({ text: `${T.name}: ${this.st.mode === "straight" ? "straight" : "curve"}`, kind: "info" });
        const joins = s.site ? s.label : s.node !== undefined ? (g.net.segsAt(s.node).length === 1 ? "Carries on the road" : "From the junction") : s.seg !== undefined ? `From the ${ROAD_TYPES[g.net.segs.get(s.seg)!.type].name.toLowerCase()}` : s.label;
        if (joins) chips.push({ text: joins, kind: "info" });
        if (this.st.level > 0) chips.push({ text: `Elevation ${this.st.level * LEVEL_H} m`, kind: "info" });
        if (this.keys.has("Alt")) chips.push({ text: "No snapping (Alt)", kind: "info" });
      } else {
        const plan = this.computeRoadPlan();
        this.plan = plan;
        if (plan) {
          const end = (plan as Plan & { snapEnd?: ToolSnap }).snapEnd!;
          pv.plan(plan, this.st.level, g.net);
          pv.refs(end.refs);
          pv.marker(this.anchor!.p, this.anchor!.h);
          pv.marker(end.p, end.h);
          if (!plan.errors.length) pv.target(g.net, end);
          for (const sp of plan.bridges ?? []) pv.bridge(sp, roadWidth(T));
          const lots = plan.errors.length ? [] : g.lotsUnder(plan);
          if (plan.errors.length) {
            const e = plan.errors[0];
            chips.push({ text: e.msg, kind: "error" });
            // say it at the spot too
            pv.dot(e.p, 0xef8a6c, Math.max(2.5, this.view.mpp * 7));
            for (const er of plan.errors) for (const id of er.buildings ?? []) {
              const b = g.buildings.byId.get(id);
              if (b) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
            }
          }
          const comp = g.demolishCost(lots);
          const total = plan.cost + comp;
          const lead = plan.strokes[0] ?? plan.ghosts?.[0];
          const L = lead?.chain.length ? plan.length / Math.max(1, plan.strokes.length) : 0;
          if (lead) chips.push({ text: L < 950 ? `${Math.round(L)} m` : `${(L / 1000).toFixed(2)} km`, kind: "info" });
          chips.push({ text: formatMoney(total), kind: total > g.money ? "error" : "cost" });
          // the steepest it climbs (a bridge's ramps, or the whole road between levels)
          const grade = lead ? this.maxGrade(plan) : 0;
          if (grade > 0.5) chips.push({ text: `↗ ${grade.toFixed(1)}%`, kind: "info" });
          for (const sp of plan.bridges ?? []) chips.push({ text: `Bridge ${Math.round(sp.length)} m over ${sp.over === "water" ? "water" : sp.over === "road" ? "the road" : "water and road"} · ${formatMoney(sp.cost)}`, kind: "info", icon: "bridge" });
          // (to or from a company site: which one it connects; ending at its gate, that says it all)
          if (plan.connects) chips.push({ text: plan.connects, kind: "info" });
          if (plan.joins && !end.site) chips.push({ text: plan.endAngleDeg !== undefined && plan.joins.startsWith("Joins the") && !plan.joins.includes("junction") ? `${plan.joins} at ${Math.round(plan.endAngleDeg)}°` : plan.joins, kind: "info" });
          else if (end.label && !end.site) chips.push({ text: end.label, kind: "info" });
          if (plan.angleDeg !== undefined && L > 3 && !plan.joins) chips.push({ text: plan.angleToRoad ? `${plan.angleDeg.toFixed(1)}° to the road` : `${plan.angleDeg.toFixed(1)}°`, kind: "info", icon: "angle" });
          // right angles: where it leaves the road it starts on and where it meets the one it ends on
          if (lead?.chain.length && !plan.errors.length) this.squareMarks(plan, end);
          if (this.st.parallel) chips.push({ text: `Parallel ${Math.round(this.parallelOffset())} m`, kind: "info" });
          if (plan.note) chips.push({ text: plan.note, kind: "info" });
          if (plan.fixed?.length) chips.push({ text: plan.fixed[0], kind: "info" });
          if (lots.length) {
            for (const b of lots) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
            const key = this.planKey(plan, lots);
            const what = `${lots.length} building${lots.length === 1 ? "" : "s"}`;
            chips.push({ text: this.confirmKey === key ? `Click again to demolish ${what} (${formatMoney(comp)})` : `Demolishes ${what}: ${formatMoney(comp)} compensation`, kind: "error" });
          }
          if (this.keys.has("Alt")) chips.push({ text: "No snapping (Alt)", kind: "info" });
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
        const sid = this.stopAt(c, 6);
        if (sid !== null) {
          pv.dot(g.transit.stops.get(sid)!.p, 0xe5484d);
          chips.push({ text: "Remove bus stop", kind: "info" });
          chips.push({ text: `${formatMoney(STOP_COST / 2)} refund`, kind: "cost" });
        } else if (b) {
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
    } else if (t === "lane") {
      const lp = planAddLane(g.net, g.world, c, this.keys.has("Shift"));
      if (lp) {
        const removing = !!lp.pocket && lp.pocket.len === 0;
        if (lp.road) pv.plan(lp.road, 0);
        if (lp.outline.length > 2) pv.footprint(lp.outline, lp.errors.length || removing ? 0xe5484d : 0x58c8e6);
        for (const e of lp.errors) for (const id of e.buildings ?? []) {
          const b = g.buildings.byId.get(id);
          if (b) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
        }
        if (lp.errors.length) chips.push({ text: lp.errors[0].msg, kind: "error" });
        if (lp.label) chips.push({ text: lp.label, kind: "info" });
        if (lp.cost) chips.push({ text: formatMoney(lp.cost), kind: lp.cost > g.money ? "error" : "cost" });
        if (lp.road) this.lotWarning(lp.road, chips);
        else if (!lp.errors.length && !removing) {
          const lots = g.lotsUnderOutline(lp.widen ?? lp.outline);
          for (const b of lots) pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
          if (lots.length) chips.push({ text: `${lots.length} building${lots.length === 1 ? "" : "s"} demolished`, kind: "error" });
        }
      } else chips.push({ text: "Click a road just before a junction", kind: "info" });
    } else if (t === "junction") {
      const n = this.nodeAt(c);
      if (n !== null) {
        const node = g.net.nodes.get(n)!;
        pv.marker(node.p, node.h);
        chips.push({ text: node.signal ? "Edit traffic lights" : "Junction: lanes & lights", kind: "info" });
      }
    } else if (t === "transit") {
      this.transitPreview(pv, chips);
    } else if (t === "place") {
      const k = this.st.placed;
      const pl = g.placedPlan(k, c, this.placeOpts());
      const T = BUILDING_TYPES[k];
      chips.push({ text: T.name, kind: "info" });
      if (!pl) {
        chips.push({ text: "Can't build here", kind: "error" });
      } else {
        const corners = rectCorners(pl.c, T.w / 2, T.d / 2, pl.rot);
        const gh = this.buildings3d.ghost(k, pl.c, pl.rot, pl.side, g.buildings.nextId);
        for (const p of gh) pv.model(p.geo, p.m, pl.ok);
        pv.footprint(corners, pl.ok ? 0x34c25a : 0xe5484d, gh.length > 0);
        this.siteOutline(pv, pl.c, pl.rot, pl.side, T.w / 2, T.d / 2, pl.ok);
        for (const id of pl.clears ?? []) {
          const o = g.buildings.byId.get(id);
          if (o) pv.footprint(rectCorners(o.c, o.hw, o.hd, o.rot), 0xf2a33a, gh.length > 0);
        }
        // (how far it is turned from its gate facing the bottom of the screen, once the player has turned it)
        const deg = Math.round(((this.st.placeTurn * 180) / Math.PI + 360) % 360) % 360;
        if (deg) chips.push({ text: `Turned ${deg}°`, kind: "info" });
        if (pl.link) {
          pv.plan(pl.link, 0);
          chips.push({ text: `Street to its gate: ${Math.round(pl.link.length)} m`, kind: "info" });
        } else if (pl.free && pl.ok) chips.push({ text: "No road it can reach: turn its gate toward one, or draw one to it", kind: "info" });
        else if (pl.faces) chips.push({ text: `Gate on a ${pl.faces.toLowerCase()}`, kind: "info" });
        // (the deposit share; a lot refused for too little of it gives the share in its reason instead)
        this.powerPreview(pv, chips, k, pl.c, pl.access?.seg);
        if (pl.deposit && pl.deposit.share >= MIN_DEPOSIT) chips.push({ text: `${pl.deposit.name[0].toUpperCase()}${pl.deposit.name.slice(1)} ${Math.round(pl.deposit.share * 100)}%`, kind: "info" });
        if (!pl.ok) chips.push({ text: pl.reason ?? "Can't build here", kind: "error" });
        else {
          chips.push({ text: formatMoney(pl.cost), kind: pl.cost > g.money ? "error" : "cost" });
          chips.push({ text: `${formatMoney(PLACED[k].upkeep)}/h upkeep`, kind: "info" });
          const site = PLANTS[k].site;
          if (site) chips.push({ text: `Site: needs ${Object.entries(site).map(([p, q]) => `${q} load${q === 1 ? "" : "s"} of ${PRODUCTS[p as Product].name.toLowerCase()}`).join(", ")}`, kind: "info" });
          const n = pl.clears?.length ?? 0;
          if (n) chips.push({ text: `${n} building${n === 1 ? "" : "s"} replaced`, kind: "error" });
        }
      }
    } else if (t === "inspect") {
      // what a click would select: a thin cream outline and a pointer (the selection itself is lit by Highlight3D)
      const h = this.pickAt(c);
      this.highlight.hoverV = h?.k === "vehicle" ? h.id : null;
      this.view.canvas.style.cursor = h ? "pointer" : "";
      const w = Math.max(0.8, 1.6 * this.view.mpp), cream = 0xf3ead6;
      if (h && (h.k === "building" || h.k === "town") && !(this.sel && this.sel.k === h.k && this.sel.id === h.id)) {
        const b = h.k === "building" ? g.buildings.byId.get(h.id) : g.buildings.at(c);
        if (b) { const k = rectCorners(b.c, b.hw + 1, b.hd + 1, b.rot); pv.path([...k, k[0]], cream, w); }
      } else if (h?.k === "seg" && !(this.sel?.k === "seg" && this.sel.id === h.id)) pv.highlight(g.net, [h.id]);
      else if (h?.k === "node") {
        const n = g.net.nodes.get(h.id), r = (g.net.nodeGeom.get(h.id)?.radius ?? 8) + 2;
        if (n) pv.path(Array.from({ length: 33 }, (_, i) => ({ x: n.p.x + Math.cos(i / 16 * Math.PI) * r, y: n.p.y + Math.sin(i / 16 * Math.PI) * r })), cream, w);
      }
      const b = h?.k === "building" || h?.k === "town" ? g.buildings.at(c) : null;
      if (b) chips.push({ text: b.zone ? `${ZONES[b.zone].short} · ${b.town !== undefined ? g.towns.byId.get(b.town)?.name ?? "" : "level " + b.level}` : BUILDING_TYPES[b.kind].name, kind: "info" });
    }
    this.hud?.chips(chips.length ? this.cursorPx : null, chips);
  }

  /** A site's fence (open at the gate) and an arrow out of its gate, for the placement preview. */
  private siteOutline(pv: Preview3D, c: V2, rot: number, side: 1 | -1, hw: number, hd: number, ok: boolean) {
    const f = siteFrame(c, rot, side, hd);
    const W = (x: number, y: number) => siteToWorld(f, x, y);
    const g = GATE_GAP / 2, d = hd * 2;
    const line = ok ? 0xf4f4ee : 0xffb4b0;
    pv.path([W(-g, 0), W(-hw, 0), W(-hw, d), W(hw, d), W(hw, 0), W(g, 0)], line, 1.4);
    // the arrow: out through the gate, the way its road has to come
    const tip = W(0, -26), base = W(0, 10);
    pv.path([base, tip], 0xffd34a, 3.2);
    pv.path([W(-7, -17), tip, W(7, -17)], 0xffd34a, 3.2);
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
    if ((mx || my) && (this.convoyTags.following !== null || this.followV !== null || this.glide)) { this.convoyTags.follow(null); this.followV = null; this.glide = null; }
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
    this.parks3d.update(g.parks.links, g.time + g.alpha * SIM.dt);
    this.fireworks.update(this.view.camera);
    if (this.glide) {
      const G = this.glide;
      G.t += dt;
      const k = Math.min(1, G.t / G.dur), e = k * k * (3 - 2 * k);
      this.view.cx = G.from.x + (G.to.x - G.from.x) * e;
      this.view.cy = G.from.y + (G.to.y - G.from.y) * e;
      this.view.halfH = G.from.h + (G.to.h - G.from.h) * e + G.lift * Math.sin(Math.PI * e);
      if (k >= 1) this.glide = null;
    } else if (this.followV !== null) {
      // an ordinary vehicle followed from its panel: the same easing as a convoy's; gone (arrived) lets go
      const v = g.traffic.vehicles.find((x) => x.id === this.followV);
      if (!v) this.followV = null;
      else {
        const q = poseOf(v, g.alpha), k = 1 - Math.exp(-dt * 5);
        const px = q.x - Math.cos(q.ang) * v.len * 0.4, py = q.y - Math.sin(q.ang) * v.len * 0.4;
        this.view.cx += (px - this.view.cx) * k;
        this.view.cy += (py - this.view.cy) * k;
        if (this.followT > 0) { this.view.halfH += (Math.min(this.view.halfH, 160) - this.view.halfH) * k; this.followT = Math.max(0, this.followT - dt); }
      }
    } else if (this.convoyTags.following !== null) {
      // the camera keeps a followed convoy in the middle, easing after it (and zooms in a little to start with)
      const v = g.traffic.vehicles.find((x) => x.id === this.convoyTags.following);
      if (v) {
        const p = ConvoyTags.centre(v, g.alpha), k = 1 - Math.exp(-dt * 5);
        this.view.cx += (p.x - this.view.cx) * k;
        this.view.cy += (p.y - this.view.cy) * k;
        if (this.followT > 0) { this.view.halfH += (Math.min(this.view.halfH, 120) - this.view.halfH) * k; this.followT = Math.max(0, this.followT - dt); }
      }
    }
    this.transit3d.update(g.transit, g.net, this.st.tool === "transit" || !!this.hud?.linesShown, this.view.mpp, this.view.rot);
    this.flowT += dt;
    const flowOn = this.overlay === "flow";
    this.roads.update(g.traffic, flowOn && this.flowT > 0.5);
    if (this.flowT > 0.5) this.flowT = 0;
    if (this.dirtyPreview) {
      // (a preview that can't be drawn must never stop the game)
      try { this.refreshPreview(); } catch (e) { this.dirtyPreview = false; console.error(e); }
    }
    this.hudT += dt;
    if (this.hudT > 0.25) {
      this.hudT = 0;
      this.hud?.tick();
      if (this.buildings3d.updateConstruction()) { this.buildings3d.rebuild(this.game.buildings.list); this.applyTint(); }
      if ((this.overlay !== "none" && this.overlay !== "flow") || this.st.tool === "place") this.applyTint();
    }
    this.saveT += dt;
    if (this.saveT > 60) { this.saveT = 0; if (this.mode === "play") void this.saves.autosaveSoon(g); }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 4);
      this.hud?.shake(this.shake);
    }
    // far out: no cars, no shadow map (the ground draws its own hill shadows)
    const far = this.view.halfH > 1800;
    this.vehicles.group.visible = !far;
    this.view.sun.castShadow = this.view.halfH < 2400;
    this.clearing.update(this.view.renderer, this.view.cx, this.view.cy);
    this.terrain3d.update(this.view);
    this.roadsFar.update(this.view.mpp, this.view.w, this.view.h);
    this.labels.update(this.view);
    this.convoyTags.update(this.view, g.alpha);
    this.townPings.update(this.view);
    this.depositMarks.update(this.view);
    this.stuckAlerts.update(this.view);
    this.highlight.group.visible = this.mode !== "menu";
    this.highlight.update(g, g.alpha, this.view.mpp, dt);
    this.iconT += dt;
    if (this.iconT > 0.4) {
      this.iconT = 0;
      this.icons.set(this.uiHidden || this.mode === "menu" ? [] : g.buildings.list, this.view);
      this.townLabels();
      this.convoyTags.sync(g.traffic.vehicles, g.buildings.byId, this.uiHidden || this.mode === "menu");
      this.townPings.sync(g.towns.list, g.time, served, this.uiHidden || this.mode === "menu");
      this.stuckAlerts.sync(g.traffic.stuckCars(STUCK_KEEP), g.time, this.uiHidden || this.mode === "menu");
      const dm = this.markedDeposits();
      this.depositMarks.show(dm.kinds, dm.focus);
    }
    else this.icons.update(this.view);
    this.pops.update(this.view, this.uiHidden || this.mode === "menu" || far ? null : g.traffic, g.alpha);
    this.hud?.compassAngle(this.view.rot);
    this.view.render();
    requestAnimationFrame(this.frame);
  };

  /**
   * The towns' names on the map, with their size and, under them, the needs that want seeing to: each need's picture
   * on a disc tinted by how it is doing (fine, running low, none), nothing at all while every need is met, and a town
   * no road reaches yet says so. Click one to open its panel.
   */
  private townLabels() {
    const g = this.game;
    const hide = this.uiHidden || this.mode === "menu";
    const info = g.towns.list.map((t) => ({ t, ln: labelNeeds(t) }));
    const sig = (ln: LabelNeeds) => (ln.kind === "calm" ? "" : ln.kind === "noroad" ? `x${ln.needs.join(",")}` : ln.needs.map((n) => `${n.p}.${n.state}`).join(","));
    const key = hide ? "" : info.map(({ t, ln }) => `${t.id}:${t.name}:${g.towns.sizeName(t)}:${t.pop}:${sig(ln)}`).join("|");
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.labels.set(hide ? [] : info.map(({ t, ln }) => {
      const size = g.towns.sizeName(t);
      const pop = t.pop.toLocaleString("en-US");
      const words = (ps: Product[]) => ps.map((p) => PRODUCTS[p].name.toLowerCase()).join(" and ");
      let say = "";
      if (ln.kind === "noroad") say = ", no road reaches it yet";
      else if (ln.kind === "needs") {
        const none = ln.needs.filter((n) => n.state === "none").map((n) => n.p), low = ln.needs.filter((n) => n.state === "low").map((n) => n.p);
        say = `${none.length ? `, no ${words(none)} coming` : ""}${low.length ? `, running low on ${words(low)}` : ""}`;
      }
      return {
        p: t.c, name: t.name, sub: `${size} · ${pop}`, minHalfH: 160,
        title: `${t.name}, ${size} of ${pop} people${say}. Open the town`,
        icons: ln.kind === "calm" ? undefined
          : ln.kind === "noroad" ? ln.needs.map((p) => ({ svg: productIcon(p), cls: "noroad" }))
          : ln.needs.map((n) => ({ svg: productIcon(n.p), cls: n.state })),
        note: ln.kind === "noroad" ? "No road yet" : undefined,
        compactHalfH: 9000,
        onClick: () => { this.setTool({ tool: "inspect" }); this.hud?.openTown(t.id); },
      };
    }));
  }

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

/** red -> amber -> green ramp for 0..1 */
export function ramp(v: number): number {
  const c = new THREE.Color();
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.5) c.lerpColors(new THREE.Color(0xe5484d), new THREE.Color(0xf5b82e), t / 0.5);
  else c.lerpColors(new THREE.Color(0xf5b82e), new THREE.Color(0x4cc46a), (t - 0.5) / 0.5);
  return c.getHex();
}

/** The player asked their system for less motion: the camera jumps instead of gliding. */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
