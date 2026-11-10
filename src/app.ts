import * as THREE from "three";
import { BUILDING_TYPES, LEVEL_H, MAX_LEVEL, ROAD_TYPES, SIM, roadWidth, type RoadTypeId } from "./config";
import { clamp, cubicAt, cubicTangent, dist, dot, formatMoney, norm, rectCorners, right, sub, v2, wrapAngle, type V2 } from "./core/math";
import { townStreets } from "./game/rural";
import type { Building } from "./game/buildings";
import { Game } from "./game/city";
import {
  parallelSpacing, planAddLane, planRoad, planRoundabout, removalRefund, snap,
  type CurveMode, type Plan, type RoundaboutSize, type Snap, type SnapOpts,
} from "./roads/planner";
import { toolSnap, type ToolSnap } from "./roads/snapping";
import { armsAt, slipTangents } from "./roads/planner";
import { Buildings3D } from "./render/buildings3d";
import { Parks3D } from "./render/parks3d";
import { Greens3D } from "./render/greens3d";
import { Fireworks } from "./render/fx3d";
import { GameAudio } from "./audio";
import { ConvoyTags } from "./ui/convoyTags";
import { GATE_GAP, siteFrame, siteToWorld } from "./game/sites";

/** The title menu's backdrop: its tilt, and how far (radians) and how slowly (s a sweep and back) it sways. */
const MENU_TILT = (50 * Math.PI) / 180;
const MENU_SWAY = (16 * Math.PI) / 180;
const MENU_SWAY_S = 110;
/**
 * A drag that turns and tilts the camera, in radians a pixel: the tilt is the slower of the two, so a sideways drag
 * that wanders a little up or down turns the map without throwing the pitch about (its whole range is under a radian).
 */
const ORBIT_TURN = 0.005;
const ORBIT_TILT = 0.003;
/** The tilt keys: radians a second (the whole range in a second and a bit). */
const KEY_TILT = 0.8;
/** How quickly the keys' pull on the camera comes on and lets go (1/s: most of it within a tenth of a second). */
const KEY_EASE = 16;

/**
 * How a new company opens (App.frameStart): the half height it may open at (m: close enough for the hamlet's houses
 * to read as models, never so close that a part of it is cut off for nothing), and the screen kept clear at each
 * edge (CSS px: the top bar, the goals panel on the right, the bottom bar, and a little air).
 */
const START_HALF_H: [number, number] = [110, 175];
const START_INSET = { l: 40, t: 84, r: 330, b: 96 };

/** How far outside a waiting site's gate the road tool snaps a road's end (m): clear of the fence, well in reach. */
const GATE_SNAP = 7;
/** Shift + , and . turn the building being placed in fine steps: 1° a press (plain, and Shift + wheel: 15°). */
const FINE_TURN = Math.PI / 180;
import { ZONES } from "./game/zones";
import { MIN_DEPOSIT, PLANTS, PRODUCTS, UNPOWERED, isPlantKind, type Product } from "./game/industry";
import { CIVICS } from "./game/civics";
import { labelNeeds, labelSummary, type LabelNeeds } from "./ui/needs";
import { steadyProblem, tally } from "./ui/bottleneck";
import { dearShare } from "./ui/cost";
import { productIcon } from "./ui/icons";
import { TownPings } from "./ui/townPings";
import { STUCK_KEEP, StuckAlerts } from "./ui/stuckAlerts";
import { DEPOSIT_KINDS, DepositMarks } from "./ui/depositMarks";
import { GoalPointer, farmSpot } from "./ui/goalPointer";
import { GateMark, type GateAsk } from "./ui/gateMark";
import { served } from "./game/settlements";
import { joinedUp } from "./ui/tips";
import type { ModelSet } from "./render/models";
import { Preview3D } from "./render/preview3d";
import { Highlight3D } from "./render/highlight3d";
import { buildingOn, deckOn, heightsOn, junctionOn, pickOn, straightDown } from "./ui/pick";
import { frameFit, rayAt, riseShare, TILT_MAP, TILT_MAX, type GroundRay } from "./render/viewmath";
import { newOrbit, orbitStep, type OrbitDrag } from "./ui/orbit";
import { TILT_MIN, loadCameraView, loadTilt, loadTurn, saveCameraView, saveTilt, saveTurn, type CameraView } from "./ui/cameraSetting";
import { groundAt, isMined, modelOf, worksCalm } from "./ui/inspect";
import type { Sel } from "./ui/inspect";
import { Roads3D } from "./render/roads3d";
import { RoadsFar } from "./render/roadsFar";
import { MapLabels } from "./ui/labels";
import { MapIcons } from "./ui/mapIcons";
import { Pops } from "./ui/pops";
import { Terrain3D } from "./render/terrain3d";
import { LandMask } from "./render/landmask";
import { clearShapes } from "./render/clearing";
import { Forest } from "./render/forest";
import { Trees3D } from "./render/trees3d";
import { holdWind, setWind } from "./render/wind";
import { Smoke } from "./render/smoke";
import { Birds } from "./render/birds";
import { Vehicles3D } from "./render/vehicles3d";
import { Lamps3D } from "./render/lamps3d";
import { Signals3D } from "./render/signals3d";
import { DayCycle, farLift } from "./render/daycycle";
import { fieldLook } from "./game/calendar";
import { Transit3D, legPoints } from "./render/transit3d";
import { STOP_COST } from "./game/transit";
import { View } from "./render/view";
import { Saves, type SavedView } from "./game/saves";
import { PLACED, type PlacedKind } from "./game/placed";
import type { Hud, Chip } from "./ui/hud";
import { CameraDirector } from "./ui/camera";
import { followOn } from "./render/cinema";
import { setYearStart } from "./game/calendar";
import { WheelReader, dragStarted, loadWheelMode, wheelPan, wheelZoomFactor } from "./ui/wheel";

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

/**
 * A press on the map: where it is and began, which button, whether it became a drag, and what the drag did (moved
 * the map; began a road where it went down).
 */
interface PointerInfo { id: number; x: number; y: number; sx: number; sy: number; button: number; moved: boolean; t: number; panned: boolean; drew: boolean; hand: boolean }

export class App {
  game!: Game;
  view: View;
  roads!: Roads3D;
  roadsFar!: RoadsFar;
  labels = new MapLabels();
  icons = new MapIcons();
  /** tags over the oversized-load convoys (click one to follow it) */
  convoyTags = new ConvoyTags((id) => { if (id === null) this.stopFollow(); else this.followVehicle(id); });
  /** markers on towns that have just sprung up (click the edge pointer to fly there) */
  /** the deposits' tags and the "nearest coal" pointers (while an extractor is placed, and in the Resources view) */
  // (a deposit's tag, clicked while looking round, opens the deposit too; a stuck diamond opens what is stuck there)
  depositMarks = new DepositMarks(() => this.game.terrain.gen, (c, field) => {
    this.flyTo(c);
    if (field !== undefined && this.st.tool === "inspect") this.hud?.openSel({ k: "ground", id: field, x: Math.round(c.x), y: Math.round(c.y) });
  });
  stuckAlerts = new StuckAlerts((c, id) => {
    this.flyTo(c, 140);
    if (id !== undefined && this.st.tool === "inspect") this.hud?.openSel({ k: "stuck", id, x: Math.round(c.x), y: Math.round(c.y) });
  });
  /** the first goal's ground: a pointer at the screen's edge to where the first farm can go, a pin once it is in view */
  goalPtr = new GoalPointer({
    fly: (c) => { this.audio.play("click"); this.flyTo(c, Math.max(this.view.halfH, 420)); },
    pick: () => { this.audio.play("click"); this.setTool({ tool: "place", placed: "farm", placeTurn: 0 }); },
  });
  /** the gate of the works in hand, or of the works selected, marked plainly */
  gateMark = new GateMark();
  private gateGhost: GateAsk | null = null;
  townPings = new TownPings({ fly: (id) => this.flyToTown(id), open: (id) => { this.setTool({ tool: "inspect" }); this.hud?.openTown(id); } });
  /** the camera gliding to a place (a finished landmark): from, to, start and length (s) */
  /** a camera glide under way; `lift`: how much further out (m of half height) it pulls at the middle of the way */
  private glide: { from: { x: number; y: number; h: number }; to: { x: number; y: number; h: number }; t: number; dur: number; lift: number } | null = null;
  parks3d!: Parks3D;
  greens3d!: Greens3D;
  fireworks = new Fireworks();
  /** everything heard (audio/index.ts): the world through the camera, the interface, the moments, the wireless */
  readonly audio = new GameAudio();
  /** smoke, steam and dust: every works that is running, the homes' chimneys in the cold, the dirt roads */
  smoke = new Smoke();
  /** which layout of the buildings the smoke's emitters were last taken from */
  private smokeSig = -1;
  /** a few birds wheeling over the woods and the fields by day */
  birds = new Birds();
  /** money and moments rising off the map, and the shelf-time rings over refrigerated trucks */
  pops = new Pops();
  /** Shift + wheel scrolling not yet turned into a whole degree (px) */
  private turnWheel = 0;
  private treesDue: ReturnType<typeof setTimeout> | 0 = 0;
  private iconT = 0;
  private labelKey = "";
  vehicles!: Vehicles3D;
  buildings3d!: Buildings3D;
  terrain3d!: Terrain3D;
  landMask!: LandMask;
  /** where the wild trees stand (one list for the 3D trees and the ground's painted crowns) */
  private forest!: Forest;
  private trees3d!: Trees3D;
  /** something was built or removed: the trees round it are due a look (at most a few times a second) */
  private forestDue = false;
  private forestAt = 0;
  /** the wind's clock: real seconds while the game runs (it stands still on pause, like everything else) */
  private windClock = 0;
  /** which lists of planted trees the 3D trees were last given */
  private treeSig = "";
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
  /** The day and the seasons on the map (and the Nights setting). */
  readonly dayCycle = new DayCycle();
  /** The lamps, floodlights, lit windows and vehicle lights. */
  lamps!: Lamps3D;
  private lampSig = "";
  signals!: Signals3D;
  private signalsWere = -1;
  private fieldsWere = "";
  selected: Building | null = null;
  /** what the inspector has selected (the HUD sets it; one at a time) */
  sel: Sel | null = null;
  /** the ground field the terrain overlay was last focused on for a selection (null: none) */
  private groundKey: number | null = null;
  /** the map's lit-up view of the selection (docs/ui-style.md "Inspector") */
  readonly highlight = new Highlight3D();
  /** an ordinary vehicle the camera follows (convoys use their tags' follow) */
  private worldRoot = new THREE.Group();
  /**
   * The cursor: its pixel, the line of sight through it (the view is tilted: render/viewmath.ts), and where that
   * meets the world for the tool in hand (cursorAt).
   */
  private cursor: V2 = v2(0, 0);
  private cursorPx: V2 = v2(0, 0);
  private cursorRay: GroundRay = { x: 0, y: 0, kx: 0, ky: 0 };
  private hasCursor = false;
  /** The Camera setting (ui/cameraSetting.ts): the view a game opens in and the camera comes back to. M flips it. */
  camView: CameraView = loadCameraView();
  /** The Diorama's pitch as the player left it (what M and the setting come back to). */
  private dioTilt = loadTilt();
  /** The view easing between the Diorama and the Map view. */
  private tiltAnim: { from: number; to: number; t: number } | null = null;
  /** The keys' pull on the camera, eased: across and down the screen, the turn, the zoom (each -1 to 1). */
  private keyCam = { x: 0, y: 0, turn: 0, zoom: 0 };
  /** A tilt key is held (the view settles when it is let go). */
  private pitching = false;
  /** A wheel zoom easing in: the pixel whose ground it holds still, and the zoom it is going to. */
  private zoomEase: { px: number; py: number; to: number } | null = null;
  /** A drag that turns and tilts the camera, under way: how far it has gone and which of the two it has started. */
  private orbit: OrbitDrag | null = null;
  /** Camera hints lately shown, and when each may be shown again (ms). */
  private hinted = new Map<string, number>();
  /** The view last frame (anything that moves it moves what is under the cursor) and as last saved. */
  private viewKey = "";
  private viewSaved = "";
  /** The title menu's backdrop: the place its camera sways round, and for how long it has (ui/menu.ts). */
  menuCam: { c: V2; rot: number; halfH: number; t: number } | null = null;
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
  /** (the rest of a wheel flick that ended a cinematic camera doesn't zoom the view it gave back, until then: ms) */
  private wheelQuiet = 0;
  /** reads the wheel: a mouse notch zooms, two fingers on a touchpad move the map, a pinch zooms (ui/wheel.ts) */
  readonly wheel = new WheelReader(loadWheelMode());
  /** Safari's pinch (gesture events) under way: its ctrl-wheel twin, if any, is ignored */
  private gesturing = false;
  /** Space held (the hand: a drag moves the map with any tool); a tap of it pauses, on release, if nothing moved */
  private spaceHeld = false;
  private spacePanned = false;
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

  /** following a vehicle, and the cinematic Tour and Vehicle cam */
  camera: CameraDirector;

  constructor(canvas: HTMLCanvasElement, private models: ModelSet) {
    this.view = new View(canvas);
    this.camera = new CameraDirector(this);
    this.view.scene.add(this.worldRoot);
    this.view.scene.add(this.highlight.group);
    this.audio.bind(this);
    // (a firework's crack comes from where its sparks open on screen)
    this.fireworks.onBurst = (x, y) => {
      const v = this.view, dx = x - v.cx, dy = y - v.cy;
      this.audio.pop((dx * Math.cos(v.rot) + dy * Math.sin(v.rot)) / (v.halfH * (v.w / Math.max(1, v.h))));
    };
    // the dev hook for the day and the seasons (render/daycycle.ts says how to use it)
    const dc = this.dayCycle;
    (window as unknown as { __env: unknown }).__env = {
      set: (o: Parameters<DayCycle["set"]>[0]) => dc.set(o),
      clear: () => dc.clear(),
      get: () => ({ hour: dc.hour, yday: dc.yday, mode: dc.mode, light: dc.light, look: dc.look }),
      // (hold the wind: the bearing it blows toward in degrees, 0 east and 90 south, and its strength 0..1; no arguments lets it go)
      wind: (deg?: number, strength?: number) => holdWind(deg, strength),
    };
    this.view.scene.add(this.preview.group);
  }

  // ---------------------------------------------------------------- setup

  attachHud(h: Hud) {
    this.hud = h;
  }

  setMode(m: App["mode"]) {
    // out of the title menu (whose backdrop is always the Diorama): the player's own view
    if (this.mode === "menu" && m !== "menu") {
      this.menuCam = null;
      this.tiltAnim = null;
      this.view.pitch = this.camView === "map" ? 0 : this.dioTilt;
      if (m === "play") this.view.rot = loadTurn();
    }
    this.mode = m;
    this.syncRise();
    document.body.classList.toggle("in-menu", m === "menu");
    document.body.classList.toggle("exploring", m === "explore");
    if (m === "menu") { this.camera.reset(); this.cancelStroke(); this.selected = null; this.setTool({ tool: "inspect" }); this.hasCursor = false; this.hud?.chips(null); }
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
    this.zoomEase = null;
    this.frameStart();
  }

  /**
   * A new company opens on its hamlet, close enough that its houses stand up as models: every building of it inside
   * the part of the screen the bars and the goals panel leave clear, at the player's own turn and pitch.
   */
  private frameStart() {
    const g = this.game, v = this.view, t = g.towns.list[0];
    v.resize();
    const pts: { x: number; y: number; h: number }[] = [];
    for (const b of g.buildings.list) {
      if (t && b.town !== t.id && Math.hypot(b.c.x - t.c.x, b.c.y - t.c.y) > t.reach * 2) continue;
      const top = this.buildings3d.topOf(b);
      for (const c of rectCorners(b.c, b.hw, b.hd, b.rot)) pts.push({ x: c.x, y: c.y, h: 0 }, { x: c.x, y: c.y, h: top });
    }
    if (!pts.length) pts.push({ x: t?.c.x ?? 0, y: t?.c.y ?? 0, h: 0 });
    const f = frameFit(pts, v.rot, clamp(v.pitch, 0, TILT_MAX), v.w, v.h, START_INSET, START_HALF_H[0], START_HALF_H[1]);
    v.cx = f.cx;
    v.cy = f.cy;
    v.halfH = f.halfH;
  }

  /**
   * Open a saved game, with the camera where it was when it was saved (`at`: Saves.viewOf). A save that does not
   * say (an older one, the showcase) opens on its biggest town, never on wherever the last game's camera was.
   */
  loadGame(data: ReturnType<Game["serialize"]>, at?: SavedView | null) {
    this.setGame(Game.load(data));
    // the clock is the save's (its speed, stopped or not): a menu the load came from under goes, and the pause it
    // had put on with it, and so do the old game's stuck-traffic alerts (playtest 2026-11-09, A4)
    this.hud?.dropModal();
    this.stuckAlerts.sync([], this.game.time, true);
    this.hud?.refresh();
    const v = this.view;
    this.zoomEase = null;
    if (at) { v.cx = at.cx; v.cy = at.cy; v.halfH = clamp(at.halfH, v.minHalfH, v.maxHalfH); this.clampView(); return; }
    let big = this.game.towns.list[0];
    for (const t of this.game.towns.list) if (t.pop > big.pop) big = t;
    if (!big) return;
    v.cx = big.c.x;
    v.cy = big.c.y;
    v.halfH = clamp(Math.max(220, big.reach * 1.1), v.minHalfH, 420);
  }

  /** Where the player's own camera is (what a save opens on): not a cinematic shot, nor the title menu's backdrop. */
  savedView(): SavedView | undefined {
    if (this.mode !== "play") return undefined;
    const p = this.camera.playerView();
    return { cx: Math.round(p.cx * 10) / 10, cy: Math.round(p.cy * 10) / 10, halfH: Math.round(p.halfH * 10) / 10 };
  }

  /**
   * Glide the camera to a place over `dur` seconds (eased), ending zoomed to `halfH`, pulling out by up to `lift` on
   * the way (a jump, with reduced motion asked for).
   */
  glideTo(p: V2, halfH: number, dur = 1.6, lift = 0) {
    this.camera.stopFollow();
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

  /** Whether a patch of a ground field is on screen now (a coarse grid of the view, clear of the HUD's edges). */
  private fieldInView(field: number): boolean {
    const t = this.game.terrain, W = this.view.w, H = this.view.h;
    let n = 0;
    for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) {
      if (t.has(field, this.view.screenToGround(W * (0.08 + (i / 9) * 0.84), H * (0.14 + (j / 5) * 0.68))) && ++n >= 3) return true;
    }
    return false;
  }

  /** The deposit kinds the map marks now: the one the extractor being placed works, or every kind in the Resources view. */
  private markedDeposits(): { kinds: typeof DEPOSIT_KINDS extends Map<number, infer K> ? K[] : never; focus: boolean } {
    if (this.bare) return { kinds: [], focus: false };
    const k = this.st.placed;
    if (this.st.tool === "place" && isPlantKind(k) && PLANTS[k].deposit) return { kinds: [DEPOSIT_KINDS.get(PLANTS[k].deposit!.field)!], focus: true };
    const gf = this.groundField();
    if (gf !== null && DEPOSIT_KINDS.has(gf)) return { kinds: [DEPOSIT_KINDS.get(gf)!], focus: false };
    if (this.overlay === "resources") return { kinds: [...DEPOSIT_KINDS.values()], focus: false };
    return { kinds: [], focus: false };
  }

  /** Which way b lies from a on screen: radians clockwise from screen up (the camera may be turned). */
  screenBearing(a: V2, b: V2): number {
    const p = this.view.worldToScreen(a.x, a.y), q = this.view.worldToScreen(b.x, b.y);
    return Math.atan2(q.x - p.x, -(q.y - p.y));
  }

  /** A landmark is finished: the camera swings over to it and a fireworks show goes up over it. */
  private celebrate(id: number, shots = 18) {
    const b = this.game.buildings.byId.get(id);
    if (!b || this.mode !== "play") return;
    this.camera.note(b.c.x, b.c.y);
    // (a cinematic camera keeps its shot, and a followed vehicle stays followed; the fireworks still go up. A town's
    // building is smaller than a landmark: the camera comes in closer, and a smaller show goes up)
    const near = shots < 18;
    if (this.camera.mode === "free") this.glideTo(b.c, near ? Math.max(150, Math.hypot(b.hw, b.hd) * 2.8) : Math.max(220, Math.hypot(b.hw, b.hd) * 1.6), 2.2);
    this.fireworks.launch(b.c, Math.max(near ? 40 : 70, Math.hypot(b.hw, b.hd) * 0.8), shots, performance.now() / 1000 + 1.4);
  }

  /** Whether a place is well inside the screen (not under the panels at its edges). */
  onScreen(p: V2): boolean {
    const s = this.view.worldToScreen(p.x, p.y);
    return s.x > 80 && s.x < this.view.w - 360 && s.y > 80 && s.y < this.view.h - 80;
  }

  /** What the inspect tool would select along a line of sight (ui/pick.ts: vehicle, bus stop, building, junction, road). */
  private pickOn(ray: GroundRay): Sel | null {
    return pickOn(this.game, ray, this.view.pickMpp, this.view.halfH <= 1800, this.buildings3d.solidsOf);
  }

  /** What the inspect tool would select at the ground point p, as the camera sees it now. */
  pickAt(p: V2): Sel | null {
    const s = this.view.worldToScreen(p.x, p.y);
    return this.pickOn(this.view.ray(s.x, s.y));
  }

  // ---------------------------------------------------------------- the Diorama and the Map view

  /**
   * Choose the view (the Camera setting, M): the Diorama's tilt or the Map view's straight down. It is saved, and the
   * camera eases over to it (a jump with reduced motion asked for, or with `ease` off).
   */
  setCameraView(v: CameraView, ease = true) {
    this.camView = v;
    saveCameraView(v);
    const to = v === "map" ? 0 : this.dioTilt;
    // (a cinematic camera, and the title menu's, keep their own tilt: they come back to this one)
    if (this.mode === "menu") this.tiltAnim = null;
    else if (this.camera.cinematic) this.camera.returnTilt(to);
    else if (!ease || reducedMotion() || Math.abs(this.view.pitch - to) < 1e-4) { this.tiltAnim = null; this.view.pitch = to; }
    else this.tiltAnim = { from: this.view.pitch, to, t: 0 };
    this.dirtyPreview = true;
    this.hud?.refresh();
  }

  /** End the easing between the two views at once, where it was going. */
  finishTilt() {
    if (this.tiltAnim) { this.view.pitch = this.tiltAnim.to; this.tiltAnim = null; }
  }

  /** M: the Map view, or back to the Diorama. */
  toggleMapView() {
    this.setCameraView(this.camView === "map" ? "diorama" : "map");
    // (far out both views look straight down: say so, or M seems to do nothing)
    if (this.camView === "diorama" && this.risen) this.cameraHint("far", "Diorama. Zoom in and the camera tilts");
  }

  /** The Diorama's own pitch, as the player left it (radians from straight down). */
  get dioPitch(): number {
    return this.dioTilt;
  }

  /** The player's view is so far out that the camera has risen to straight down (render/viewmath.ts riseShare). */
  private get risen(): boolean {
    return this.view.rise && riseShare(this.view.halfH) < 0.04;
  }

  /**
   * The cinematic cameras and the title menu's backdrop film at the pitch they ask for; the player's own view rises
   * to straight down as it pulls far back. The one place that says which (View.rise).
   */
  private syncRise() {
    this.view.rise = this.mode !== "menu" && !this.camera?.cinematic;
  }

  /** One calm line about the camera, and not again for a while (a held key or a long drag asks every frame). */
  private cameraHint(id: string, msg: string) {
    const now = performance.now();
    if (now < (this.hinted.get(id) ?? 0)) return;
    this.hinted.set(id, now + 20000);
    this.hud?.toast(msg);
  }

  /**
   * Pitch the camera by hand, by `d` radians (down toward the horizon when positive): the tilt keys, a middle-drag,
   * the camera block. It is the player's own pitch that changes (View.pitch); what is drawn follows it, eased out
   * with the zoom. So far out that the camera has risen to straight down there is nothing to see change: the pitch
   * is left alone and one line says why. settleView ends it (a key let go, the button up).
   */
  pitchBy(d: number) {
    if (this.camera.cinematic || this.mode === "menu" || !d) return;
    if (this.risen) { this.cameraHint("far", "Zoom in to tilt the camera. This far out it looks straight down"); return; }
    this.tiltAnim = null;
    // (asked down out of the Map view: past its catch at once, or a slow key would never get out of it)
    const from = d > 0 && this.view.pitch + d <= TILT_MAP ? TILT_MAP : this.view.pitch;
    this.view.pitch = clamp(from + d, 0, TILT_MAX);
    this.dirtyPreview = true;
  }

  /**
   * A pitch by hand is over (the key let go, the button up): the setting follows the pitch the player chose, so it
   * always tells the truth. Straight down is the Map view, anything else the Diorama, whose pitch is remembered.
   * Tilting all the way up to the Map view leaves the Diorama's pitch as it was before, so M brings that back and
   * not a view a hair off straight down. It goes by the player's own pitch, never by what is drawn: zooming far out,
   * where the camera rises to straight down by itself, changes nothing here.
   */
  settleView() {
    this.orbit = null;
    const flat = this.view.pitch <= TILT_MAP;
    if (flat) this.view.pitch = 0;
    else this.dioTilt = Math.max(this.view.pitch, TILT_MIN);
    const v: CameraView = flat ? "map" : "diorama";
    if (v === this.camView) return;
    this.camView = v;
    saveCameraView(v);
    this.hud?.refresh();
  }

  /**
   * Turn and tilt the camera by a drag of (dx, dy) pixels: sideways turns it about the middle of the screen, up and
   * down tilts it (the middle button, and the camera control for a touchpad with none). The drag takes hold of the
   * near side of the map, as on a turntable: drag right and the ground in front comes round to the right (the same
   * way E turns it), drag up and the camera drops toward the horizon, drag down and it climbs toward straight down.
   *
   * Each of the two starts only once the drag has clearly gone its way (orbitStep), so a sideways drag that wanders
   * a little never moves the pitch and a drag up or down never turns the map; a diagonal drag does both. settleView
   * ends the drag.
   */
  orbitBy(dx: number, dy: number) {
    if (this.camera.cinematic || this.mode === "menu") return;
    const o = this.orbit ??= newOrbit();
    // (the Map view is harder to tip: a map stays a map unless the drag plainly goes up the screen)
    const step = orbitStep(o, dx, dy, this.camView === "map" && this.view.pitch <= TILT_MAP);
    if (step.turn) this.view.rotateAt(this.view.w / 2, this.view.h / 2, step.turn * ORBIT_TURN);
    if (step.tilt) this.pitchBy(-step.tilt * ORBIT_TILT);
    // (dragged down in the Map view: it is as high as it goes, and the way to tilt is the other way)
    else if (o.ay > 40 && o.ay > Math.abs(o.ax) && this.view.pitch <= TILT_MAP && !this.risen) this.cameraHint("up", "Drag up to tilt the camera, or press H");
    this.dirtyPreview = true;
  }

  // ---------------------------------------------------------------- camera modes (ui/camera.ts)

  /** Follow a vehicle with the camera (a convoy's tag, G, the camera menu; for a vehicle inspector's Follow button too). False if it isn't on the road. */
  followVehicle(id: number | null): boolean {
    if (id === null) { this.camera.stopFollow(); return true; }
    return this.camera.followVehicle(id);
  }

  /** The vehicle the camera is following, if any. */
  get following(): number | null { return this.camera.following; }

  /** Let go of the vehicle the camera follows. */
  stopFollow() {
    this.camera.stopFollow();
  }

  /** The cinematic Tour of the busiest places (T). */
  startTour() {
    this.camera.startCinema("tour");
  }

  /** The cinematic Vehicle cam, riding with one vehicle after another (Shift+T). */
  startVehicleCam() {
    this.camera.startCinema("ride");
  }

  /** Nothing over the map: the interface hidden, the title menu, or a cinematic camera. */
  get bare(): boolean {
    return this.uiHidden || this.mode === "menu" || this.camera.cinematic;
  }

  cancelGlide() {
    this.glide = null;
  }

  /** A cinematic camera starts: no tool, no info view, the game running, every bit of interface hidden. */
  enterCinema() {
    this.glide = null;
    this.cancelStroke();
    // (a drag or click under way doesn't carry on behind the hidden interface; held keys start over)
    this.pointers.clear();
    this.pinch = null;
    this.dragRect = null;
    this.keys.clear();
    if (this.st.tool !== "inspect") this.setTool({ tool: "inspect" });
    if (this.overlay !== "none") this.setOverlay(this.overlay);
    this.hasCursor = false;
    this.preview.group.visible = false;
    this.hud?.chips(null);
    if (this.game.paused) this.togglePause();
    document.body.classList.add("cinema");
    this.labelKey = "";
    this.iconT = 1;
  }

  /** It ends: the tool, info view and pause as they were. */
  leaveCinema(overlay: OverlayId, tool: ToolId, paused: boolean) {
    document.body.classList.remove("cinema");
    this.syncRise();
    this.keys.clear();
    this.preview.group.visible = true;
    if (overlay !== "none") this.setOverlay(overlay);
    if (tool !== "inspect") this.setTool({ tool });
    if (paused && !this.game.paused) this.togglePause();
    this.labelKey = "";
    this.iconT = 1;
    this.dirtyPreview = true;
    this.hud?.refresh();
  }

  /** Point the camera at a place, zoomed out to at least `halfH`. */
  lookAt(p: V2, halfH: number) {
    this.camera.stopFollow();
    this.view.cx = p.x;
    this.view.cy = p.y;
    this.view.halfH = Math.min(this.view.maxHalfH, Math.max(this.view.halfH, halfH));
  }

  private setGame(g: Game) {
    this.game = g;
    setYearStart(g.calStart);
    // the view as the player left it: the turn, and the Diorama or the Map view (the Camera setting)
    this.view.rot = loadTurn();
    this.tiltAnim = null;
    this.view.pitch = this.camView === "map" ? 0 : this.dioTilt;
    this.syncRise();
    this.hud?.cameraPose(this.view.rot, this.view.tilt);
    this.hud?.clearBanners();
    for (const c of [...this.worldRoot.children]) this.worldRoot.remove(c);
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    // (no trees on roads, their verges, sites or plots: they give way round whatever is built)
    this.forest = new Forest(g.terrain);
    this.forest.setShapes(clearShapes(g.net, g.buildings.list));
    this.forestDue = false;
    // (the old game's ground and trees hand back what they hold on the GPU: a chunk's textures are freed by nothing else)
    this.terrain3d?.dispose();
    this.landMask?.dispose();
    this.landMask = new LandMask();
    this.terrain3d = new Terrain3D(g.terrain, this.forest, small, this.landMask, this.models.props);
    this.trees3d?.dispose();
    this.trees3d = new Trees3D(this.models.trees, this.forest);
    this.treeSig = "";
    this.smoke.reset();
    this.smokeSig = -1;
    this.birds.setWorld((x, y) => g.terrain.gen.at(x, y));
    this.roads = new Roads3D(g.net, {
      props: this.models.props, isWater: (p) => g.terrain.isWater(p),
      // each driveway as a line from where it leaves the road to the lot (a home's middle, a site's gate): no street
      // tree or lamp stands on it, however wide the road it comes off (a boulevard's verge is far from its centreline);
      // a home's runs down the side of its lot, to its garage
      drives: () => g.buildings.list.filter((b) => b.access).map((b): [V2, V2] => {
        if (b.plant && b.placed) return [b.front, siteFrame(b.c, b.rot, b.side, b.hd).gate];
        const f = this.buildings3d?.driveFront(b) ?? b.front;
        return [f, { x: b.c.x + f.x - b.front.x, y: b.c.y + f.y - b.front.y }];
      }),
      gates: () => g.buildings.list.filter((b) => b.placed && b.plant).map((b) => ({ ...siteFrame(b.c, b.rot, b.side, b.hd), front: b.front })),
      // town streets keep their kerbs, pavements, lamps and trees; the roads out in the country don't
      townStreets: () => townStreets(g.net, g.towns.list, g.buildings.list),
      // each town's Main Street through its old town, laid in brick
      mainStreets: () => g.towns.mainStreets(),
    });
    this.roadsFar = new RoadsFar(g.net);
    this.labels.set([]);
    this.labelKey = "";
    this.vehicles = new Vehicles3D(this.models);
    this.vehicles.attach(this.view, () => this.game.company?.herald);
    this.buildings3d?.disposeExtras();
    this.buildings3d = new Buildings3D(this.models, () => this.game.time, g.net);
    this.vehicles.lotOf = (id) => { const b = g.buildings.byId.get(id); return b ? this.buildings3d.lotWay(b) : null; };
    this.transit3d = new Transit3D(this.models.props.get("busstop"));
    this.parks3d = new Parks3D(this.models);
    this.greens3d = new Greens3D();
    this.lamps = new Lamps3D(this.models.props.get("streetlamp"), this.models.props.get("floodmast"));
    this.vehicles.lamps = this.lamps;
    this.buildings3d.seasonClock = () => this.dayCycle.lookTime(this.game.time);
    this.lampSig = "";
    this.signals = new Signals3D(this.models.props.get("signal"));
    this.signalsWere = -1;
    this.camera?.reset();
    // (the old game's selection would name something else, or nothing, in this one)
    this.hud?.closePanels();
    this.sel = null;
    this.highlight.set(null);
    this.highlight.hoverV = null;
    this.glide = null;
    this.worldRoot.add(this.terrain3d.group, this.terrain3d.land.group, this.trees3d.group, this.roads.group, this.roadsFar.group, this.buildings3d.group, this.vehicles.group, this.transit3d.group, this.parks3d.group, this.greens3d.group, this.lamps.group, this.signals.group, this.fireworks.group, this.birds.mesh, this.smoke.mesh);
    this.roads.rebuildAll();
    this.buildings3d.rebuild(g.buildings.list);
    { const gr = g.towns.greens(); this.greens3d.update(gr.key, gr.list); }
    this.groundOverlay();
    this.pops.clear();
    this.icons.boostOf = (b) => g.industry.boosts(b);
    // (a new works waiting for its first loads is starting up, not in trouble: no roundel yet)
    this.icons.troubleOf = (b) => steadyProblem(g, b);
    // (nor is one whose goods no town is big enough to buy yet, or whose buyer is still being built: nothing to
    // fix. The same reading as its panel's status line, so the map and the panel cannot disagree)
    this.icons.quiet = (b) => worksCalm(g, b);
    this.icons.avoid = () => this.labels.rects();
    // what is pinned over a building stands over its roof; a jam's pin on its road's deck
    this.icons.topOf = this.pops.topOf = (b) => this.buildings3d.topOf(b);
    this.stuckAlerts.heightAt = (p) => deckOn(g.net, straightDown(p), 8)?.h ?? 0;
    g.on((e) => {
      // (a delivery or a by-product leaving only pops over the map: nothing else on screen changes)
      if (e.t === "delivery") { this.camera.note(e.d.to.c.x, e.d.to.c.y); if (this.mode !== "menu") this.pops.delivery(e.d, this.view); if (e.d.lost > 0 && this.mode === "play") this.audio.sting("spoil"); return; }
      if (e.t === "shipped") { if (this.mode !== "menu") this.pops.shipped(e.from, e.to, e.p, this.view); return; }
      if (e.t === "roads") { this.roads.apply(e.cs); this.forestDue = true; this.roadsFar.invalidate(); this.buildings3d.rebuildDrives(g.buildings.list); this.dirtyPreview = true; }
      else if (e.t === "buildings") {
        this.buildings3d.rebuild(g.buildings.list); this.roads.refreshGates(); this.roads.refreshLook(); this.forestDue = true; this.applyTint(); this.dirtyPreview = true;
        { const gr = g.towns.greens(); this.greens3d.update(gr.key, gr.list); }
        // (street trees make way for new driveways: at most twice a second while a town grows)
        if (!this.treesDue) this.treesDue = setTimeout(() => { this.treesDue = 0; this.roads.refreshTrees(); }, 500);
      }
      else if (e.t === "zones") this.dirtyPreview = true;
      else if (e.t === "milestone") { if (this.mode === "play") this.hud?.milestone(e.m, e.towns); }
      else if (e.t === "townSpawned") { if (this.mode === "play") this.hud?.townSpawned(e.town, e.from, e.dist, e.dir); }
      else if (e.t === "toast") { if (this.mode !== "menu") this.hud?.toast(e.msg); }
      else if (e.t === "townSize") {
        const t = g.towns.byId.get(e.town);
        if (t) this.camera.note(t.c.x, t.c.y);
        if (this.mode === "play") this.hud?.townGrew(e.town, e.size);
      }
      else if (e.t === "convoy") { if (this.mode === "play") this.audio.sting(e.phase === "out" ? "convoyOut" : "convoyIn"); }
      else if (e.t === "landmark") { if (this.mode === "play") { this.hud?.landmarkDone(e.b); this.celebrate(e.b); } }
      else if (e.t === "order") {
        // a town's order (game/orders.ts): a note when one opens, its building's moment when one is filled
        const t = g.towns.byId.get(e.town);
        if (t) this.camera.note(t.c.x, t.c.y);
        if (this.mode === "play") {
          if (e.phase === "open") this.hud?.orderOpened(e.town, e.kind);
          else if (e.phase === "lapsed") this.hud?.orderLapsed(e.town, e.kind);
          else { this.hud?.orderFilled(e.town, e.kind, e.b, e.grant ?? 0); if (e.b !== undefined) this.celebrate(e.b, 8); }
        }
        this.labelKey = "";
      }
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
    if (p.tool && p.tool !== prev && this.mode === "play") this.audio.play("tool");
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
    // a resource ground selected: the Resources view, focused on its kind, for as long as it stays selected
    const gf = extractor ? null : this.groundField();
    this.terrain3d?.setOverlay(this.overlay === "resources" || extractor || gf !== null ? "resources" : "none", extractor && isPlantKind(k) ? PLANTS[k].deposit?.field ?? -1 : gf ?? -1);
    this.groundKey = gf;
  }

  /** The resource field of the selected ground (a deposit, soil or forest), or null. */
  private groundField(): number | null {
    return this.sel?.k === "ground" && this.sel.id >= 0 ? this.sel.id : null;
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
    // (right click and a touchpad's two-finger click are the game's: no browser menu anywhere but in a text box)
    document.addEventListener("contextmenu", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("input, textarea, [contenteditable='true']")) e.preventDefault();
    });
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => { this.pointers.delete(e.pointerId); this.pinch = null; });
    el.addEventListener("pointerleave", () => { this.hasCursor = false; this.dirtyPreview = true; this.hud?.chips(null); });
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.mode === "menu") return;
      if (this.camera.cinematic) { this.camera.exitCinema(); this.wheelQuiet = performance.now() + 300; this.wheel.reset(); return; }
      // (read even while quiet, so the rest of a gesture keeps what it was)
      const act = this.wheel.read(e);
      if (performance.now() < this.wheelQuiet) return;
      if (act === "pinch" && this.gesturing) return;
      // The wheel always zooms, with a building in hand too: the first thing a player does with a farm in hand is
      // zoom out to look for soil, and the wheel span the farm instead (play-test 2026-11-09, C4). Shift + wheel
      // turns the building, 15° a notch (, and . do the same; with Shift they turn it by 1°).
      if (this.st.tool === "place" && e.shiftKey && !e.ctrlKey && act !== "pinch") {
        // (with Shift held the browser may scroll sideways instead: either way it is the wheel turning)
        const d = e.deltaY || e.deltaX;
        if (!d) return;
        const px = e.deltaMode === 1 ? d * 33 : d;
        // (a notch is ~100 px; a trackpad's many small steps add up to the same)
        this.turnWheel += Math.sign(px) * Math.min(Math.abs(px), 200);
        while (Math.abs(this.turnWheel) >= 100) {
          const dir = this.turnWheel > 0 ? 1 : -1;
          this.turnWheel -= dir * 100;
          this.turnPlaced(dir);
        }
        return;
      }
      const r = el.getBoundingClientRect();
      const at = v2(e.clientX - r.left, e.clientY - r.top);
      if (act === "pan") {
        // two fingers on a touchpad: the map moves with them, 1:1 (the system's inertia arrives as more of these)
        const d = wheelPan(e, this.view.h);
        if (!d.dx && !d.dy) return;
        // (moving the camera by hand lets a followed vehicle go; a zoom doesn't)
        if (followOn("pan") === "end") this.camera.stopFollow();
        this.glide = null;
        this.view.pan(d.dx, d.dy);
      } else {
        const f = wheelZoomFactor(e, act, this.view.h);
        // a wheel notch eases in over a few frames, about the ground under the cursor (the pitch drawn changes with
        // the zoom, and a whole notch at once would jolt it); a pinch follows the fingers as they move
        if (act === "zoom" && !reducedMotion() && !this.glide) {
          const from = this.zoomEase?.to ?? this.view.halfH;
          this.zoomEase = { px: at.x, py: at.y, to: clamp(from * f, this.view.minHalfH, this.view.maxHalfH) };
        } else { this.zoomEase = null; this.view.zoomAt(at.x, at.y, f); }
      }
      this.clampView();
      this.updateCursor(at);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    // (the place names sit over the map: the wheel over one zooms the map, as anywhere else)
    this.labels.el.addEventListener("wheel", wheel, { passive: false });
    // Safari's pinch comes as gesture events (its scale since the gesture began): zoom on the cursor with the fingers
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
    let gScale = 1;
    for (const t of [el, this.labels.el]) {
      t.addEventListener("gesturestart", (e) => { e.preventDefault(); this.gesturing = true; gScale = 1; });
      t.addEventListener("gesturechange", (ev) => {
        const e = ev as Gesture;
        e.preventDefault();
        if (this.mode === "menu" || this.camera.cinematic || !(e.scale > 0)) return;
        const r = el.getBoundingClientRect();
        this.view.zoomAt(e.clientX - r.left, e.clientY - r.top, gScale / e.scale);
        gScale = e.scale;
        this.clampView();
        this.dirtyPreview = true;
      });
      t.addEventListener("gestureend", (e) => { e.preventDefault(); this.gesturing = false; });
    }
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("resize", () => this.view.resize());
    // (the canvas can change size with no resize event: the page laid out after the first frame, a window resized
    // while loading. Then the picture was drawn for the old size and stood off from the pointer)
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - this.view.w) > 0.5 || Math.abs(r.height - this.view.h) > 0.5) { this.view.resize(); this.dirtyPreview = true; }
    }).observe(el);
    window.addEventListener("blur", () => { this.keys.clear(); this.setSpace(false); });
  }

  private local(e: PointerEvent): V2 {
    const r = this.view.canvas.getBoundingClientRect();
    return v2(e.clientX - r.left, e.clientY - r.top);
  }

  private onDown(e: PointerEvent) {
    if (this.mode === "menu") return;
    // a click ends the cinematic camera (and does nothing else)
    if (this.camera.cinematic) { this.camera.exitCinema(); return; }
    const p = this.local(e);
    // (a press while Space is held makes it the hand, not a tap that pauses)
    if (this.spaceHeld) this.spacePanned = true;
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    this.pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, button: e.button, moved: false, t: performance.now(), panned: false, drew: false, hand: this.spaceHeld });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: v2((a.x + b.x) / 2, (a.y + b.y) / 2), ang: Math.atan2(b.y - a.y, b.x - a.x) };
      // (both are drags now: the finger left down after the pinch carries on moving the map from where it is, no click)
      a.moved = b.moved = true;
      this.dragRect = null;
      this.hud?.rect(null);
      return;
    }
    this.updateCursor(p);
    if (e.button === 0 && e.pointerType !== "touch" && this.st.tool === "bulldoze" && !this.spaceHeld) {
      // (a bulldoze rectangle is drawn on still ground: it lets a followed vehicle go)
      if (followOn("build") === "end") this.camera.stopFollow();
      this.dragRect = { a: p, b: p };
    }
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
    chips.push({ text: this.confirmKey === this.planKey(plan, lots) ? `Click again to demolish ${what} (${formatMoney(comp)})` : `Demolishes ${what}: ${formatMoney(comp)} compensation`, kind: "error", warn: true });
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
      this.camera.stopFollow();
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
      let dx = p.x - pi.x, dy = p.y - pi.y;
      // (a tap on a touchpad that wanders a few pixels as the finger lifts is still a click: ui/wheel.dragStarted)
      if (!pi.moved && dragStarted(Math.hypot(p.x - pi.sx, p.y - pi.sy), performance.now() - pi.t, e.pointerType)) {
        pi.moved = true;
        // (the map catches up with the pointer: a pan stays 1:1 from where the press began)
        dx = p.x - pi.sx; dy = p.y - pi.sy;
        // a left drag with the road tool draws a road: from where the button went down to where it comes up
        if (pi.button === 0 && this.pointers.size === 1 && !this.spaceHeld && e.pointerType !== "touch" && this.st.tool === "road" && this.st.mode !== "replace" && !this.anchor) {
          if (followOn("build") === "end") this.camera.stopFollow();
          this.updateCursor(v2(pi.sx, pi.sy));
          this.onClick(false);
          pi.drew = true;
        }
      }
      // CS2 mouse: right-drag moves the map, middle-drag turns it (sideways) and tilts it (up and down); left-drag
      // also moves it outside of drawing
      if (pi.button === 1) {
        if (pi.moved) {
          this.orbitBy(dx, dy);
        }
        pi.x = p.x; pi.y = p.y;
        this.updateCursor(p);
        return;
      }
      const panning = pi.button === 2 || (pi.button === 0 && !this.dragRect && !pi.drew && (this.st.tool === "inspect" || e.pointerType === "touch" || this.spaceHeld));
      if (panning && pi.moved) {
        pi.panned = true;
        if (this.spaceHeld) { this.spacePanned = true; this.view.canvas.classList.add("grabbing"); }
        // (taking the camera by hand lets a followed vehicle go)
        this.camera.stopFollow();
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
    this.view.canvas.classList.remove("grabbing");
    // (a middle-drag that tilted the view all the way up to straight down has made it the Map view)
    if (pi.button === 1 && pi.moved) { this.settleView(); return; }
    // (a press with Space held is the hand: it moves the map and never clicks)
    if (pi.hand) return;
    if (pi.moved) {
      // a road dragged out (or dragged on from the point clicked before) ends where the button comes up
      if (pi.button === 0 && !pi.panned && this.st.tool === "road" && this.st.mode !== "replace" && this.anchor) {
        this.updateCursor(p);
        if (followOn("build") === "end") this.camera.stopFollow();
        this.onClick(e.shiftKey);
      }
      return;
    }
    // (a click lands where the button went down: a touchpad tap that wanders as the finger lifts clicks where it was put)
    this.updateCursor(v2(pi.sx, pi.sy));
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
    if (pi.button === 0) {
      // (a click with a build tool lets a followed vehicle go; in inspect, onClick keeps it or switches to a vehicle)
      if (followOn(this.st.tool === "inspect" ? "select" : "build") === "end") this.camera.stopFollow();
      this.onClick(e.shiftKey);
    }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    // (Space let go in a text box, the title menu or a cinematic camera: the hand is put down, without a pause)
    if (!down && e.key === " " && this.spaceHeld && (tag === "INPUT" || tag === "TEXTAREA" || this.mode === "menu" || this.camera.cinematic)) this.setSpace(false);
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // the title menu: only Esc, to close a dialog opened from it
    if (this.mode === "menu") { if (down && k === "Escape") this.hud?.back(); return; }
    // the cinematic camera: any key leaves it, and does nothing else (a modifier on its own doesn't count)
    // (a key let go meanwhile is let go: Shift from Shift+T, or a pan key held when it started)
    if (this.camera.cinematic) {
      if (!down) this.keys.delete(k);
      else if (!e.repeat && k !== "Shift" && k !== "Control" && k !== "Alt" && k !== "Meta") { e.preventDefault(); this.camera.exitCinema(); }
      return;
    }
    if (k === "Shift") this.dirtyPreview = true; // the lane tool previews removal while it is held
    if (k === "Alt") { e.preventDefault(); this.dirtyPreview = true; } // held: no snapping (and no browser menu bar)
    if (down) this.keys.add(k);
    else {
      this.keys.delete(k);
      // Space let go: a tap pauses (or unpauses); held to move the map with a drag, it doesn't
      if (k === " ") { e.preventDefault(); if (this.spaceHeld && !this.spacePanned) this.togglePause(); this.setSpace(false); }
      return;
    }
    // AltGr arrives as Ctrl+Alt: leave it to the plain keys ([ and ] need it on many layouts)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); this.redo(); }
      else if (k === "s") { e.preventDefault(); this.hud?.openSaves(true); }
      return;
    }
    // Esc steps back like CS2: popups, dialogs, panels, the tool, the asset menu, then the pause menu
    // (a followed vehicle stays followed: Esc clears the screen, only taking the camera lets it go, cinema.followOn)
    if (k === "Escape") { if (!this.hud?.back()) this.hud?.openPause(); }
    else if (k === " ") { e.preventDefault(); if (!e.repeat) this.setSpace(true); }
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
    // R and I: the two catalogs a company lives in (zoom is on the wheel and on + and -)
    else if (k === "r" && !e.repeat) { this.hud?.catKey("roads"); this.hud?.sound("click"); }
    else if (k === "i" && !e.repeat) { this.hud?.catKey("industry"); this.hud?.sound("click"); }
    else if (k === "b") this.setTool({ tool: "bulldoze" });
    else if (k === "l") this.setTool({ tool: this.st.tool === "lane" ? "inspect" : "lane" });
    else if (k === "p") this.hud?.toggleWin("progression");
    else if (k === "z") this.hud?.toggleWin("economy");
    else if (k === "c") this.hud?.toggleWin("city");
    else if (k === "x") this.hud?.toggleWin("transport");
    // the camera: T a tour, Shift+T the vehicle cam, G follow the truck nearest the middle (so the tilt, CS2's T / G,
    // is on the keys beside them: Y and H, read every frame), M the Map view and back
    else if (k === "t" && !e.repeat) this.camera.startCinema(e.shiftKey ? "ride" : "tour");
    else if (k === "m" && !e.repeat) { this.toggleMapView(); this.hud?.sound("click"); }
    else if (k === "g" && !e.repeat) this.camera.toggleFollowNearest();
    else if (k === "n" && !e.repeat) this.hud?.toast(this.audio.toggleMute() ? "Sound off" : "Sound on");
    else if (k === "[" || k === "]") this.nudgeParallel(k === "]" ? 1 : -1);
    else if ((e.code === "Comma" || e.code === "Period") && this.st.tool === "place") this.turnPlaced(e.code === "Period" ? 1 : -1, e.shiftKey);
    else if (k === "`" || e.code === "Backquote") this.toggleUi();
    else if (k === "F5") { e.preventDefault(); this.quickSave(); }
    else if (k === "F9") { e.preventDefault(); this.quickLoad(); }
  }

  /** Space down (the hand: a drag moves the map with any tool) or up. */
  private setSpace(on: boolean) {
    this.spaceHeld = on;
    this.spacePanned = false;
    this.view.canvas.classList.toggle("hand", on);
    if (!on) this.view.canvas.classList.remove("grabbing");
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

  /** Turn the map back north-up (the north arrow), about the middle of the screen. */
  resetNorth() {
    this.view.rotateAt(this.view.w / 2, this.view.h / 2, -this.view.rot);
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
    try { this.loadGame(d, this.saves.viewOf("quick")); } catch (e) { this.reject(String(e).includes("older version") ? "That quicksave is from an older version" : "Couldn't load the quicksave"); return; }
    this.hud?.toast("Quickload");
  }

  togglePause() {
    this.game.paused = !this.game.paused;
    this.audio.play(this.game.paused ? "pause" : "resume");
    this.hud?.refresh();
  }

  setSpeed(s: number) {
    this.audio.play(this.game.paused ? "resume" : "speed");
    this.game.speed = s;
    this.game.paused = false;
    this.hud?.refresh();
  }

  undo() { this.game.undo(); this.cancelStroke(); this.audio.play("undo"); }
  redo() { this.game.redo(); this.cancelStroke(); this.audio.play("redo"); }

  private clampView() {
    const m = 120000;
    this.view.clampTo(-m, -m, m, m);
  }

  private updateCursor(px: V2) {
    this.cursorPx = px;
    this.hasCursor = true;
    this.dirtyPreview = true;
    this.aimCursor();
  }

  /**
   * Where the cursor's line of sight meets the world for the tool in hand. Drawing a road (or a roundabout), on the
   * plane of the level being drawn: a bridge's deck is drawn where it will stand, under the cursor. With the tools
   * that work on a road (lanes, junctions, bus stops, replace), on the deck of the road under the cursor. Else on the
   * ground.
   */
  private aimCursor() {
    const ray = this.cursorRay = this.view.ray(this.cursorPx.x, this.cursorPx.y);
    const t = this.st.tool;
    if ((t === "road" && this.st.mode !== "replace") || t === "roundabout") this.cursor = rayAt(ray, this.st.level * LEVEL_H);
    else if (t === "lane" || t === "junction" || t === "transit" || t === "road") this.cursor = deckOn(this.game.net, ray, this.pickPad())?.p ?? rayAt(ray, 0);
    else this.cursor = rayAt(ray, 0);
  }

  /** How near a road's edge the cursor counts as on it (m: a few pixels). */
  private pickPad(): number {
    return Math.max(2, 6 * this.view.pickMpp);
  }

  private snapOpts(from?: Snap): SnapOpts {
    return {
      mpp: this.view.pickMpp, level: this.st.level, type: this.st.roadType,
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
    const o = { ...this.snapOpts(from), prev: this.lastSnap, free: this.keys.has("Alt"), curve: !!from && this.st.mode === "curve" };
    if (o.free) return toolSnap(this.game.net, this.cursor, o);
    return this.snapPlanes((p) => toolSnap(this.game.net, p, o));
  }

  /**
   * Snap along the cursor's line of sight. Seen at a tilt, a junction on a bridge is not over the ground it is drawn
   * on: so the snap is tried on each height the line passes a road or a junction at, from the top down (what is in
   * front first), and the first that catches something standing at that height wins. The plane of the level being
   * drawn takes its turn among them, and is what is left when nothing is caught. Seen from straight above every
   * plane is the same point, and this is one snap.
   */
  private snapPlanes<T extends Snap>(snapAt: (p: V2) => T): T {
    const ray = this.cursorRay, base = this.st.level * LEVEL_H;
    const caught = (s: Snap) => s.node !== undefined || s.seg !== undefined;
    let free: T | null = null;
    if (ray.kx || ray.ky) {
      const hs = heightsOn(this.game.net, ray, clamp(14 * this.view.pickMpp, 3, 40) + 6).filter((h) => Math.abs(h - base) > 0.4);
      hs.push(base);
      hs.sort((a, b) => b - a);
      for (const h of hs) {
        const s = snapAt(rayAt(ray, h));
        if (h === base) { if (caught(s)) return s; free = s; }
        else if (caught(s) && Math.abs(s.h - h) < 0.75) return s;
      }
    }
    return free ?? snapAt(rayAt(ray, base));
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
      this.hud?.sound("place");
      this.hud?.toast(`${BUILDING_TYPES[k].name} built for ${formatMoney(pl.cost)}`);
      this.dirtyPreview = true;
      return;
    }
    if (t === "inspect") {
      // anything on the map opens its panel; empty ground clears the selection
      // (a works' plate on the far map flies down to the works as it opens it)
      const ic = this.icons.hit(this.cursorPx.x, this.cursorPx.y);
      if (ic?.far) this.glideTo(ic.b.c, Math.max(260, Math.hypot(ic.b.hw, ic.b.hd) * 1.6), 1.1);
      let s: Sel | null = ic ? { k: "building", id: ic.b.id } : this.pickOn(this.cursorRay);
      // open ground: a mined deposit always opens; soil, forest, water and hills (which are most of the map) only
      // when nothing else is selected, ground is, or the Resources view is on; otherwise a click there clears
      if (!s) {
        const gr = groundAt(g, c);
        if (gr && (isMined(gr.id) || !this.sel || this.sel.k === "ground" || this.overlay === "resources")) s = gr;
      }
      if (!s) { this.hud?.closePanels(); return; }
      if (s.k === "node") this.hud?.openSignal(s.id);
      else this.hud?.openSel(s);
      // (following one vehicle, a click on another rides with that one instead)
      if (this.camera.following !== null && this.camera.following !== s.id && followOn("select", s.k === "vehicle" ? "vehicle" : "other") === "switch") this.camera.followVehicle(s.id);
      this.dirtyPreview = true;
      return;
    }
    if (t === "road" && this.st.mode === "replace") {
      const id = this.roadUnder(null);
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
      if (g.upgrade(id, this.st.roadType)) this.hud?.sound("upgrade");
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
        this.audio.road(Math.hypot(endP.x - this.anchor.p.x, endP.y - this.anchor.p.y));
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
      const hit = this.bulldozeAt();
      if (hit.stop !== undefined) { g.transit.removeStop(hit.stop); this.hud?.sound("remove"); this.hud?.toast(`Removed bus stop, refunded ${formatMoney(STOP_COST / 2)}`); return; }
      if (hit.b) { g.bulldoze([], [hit.b.id]); this.hud?.sound("remove"); return; }
      const id = hit.seg ?? null;
      if (id !== null) {
        const refund = g.bulldoze([id], []);
        this.hud?.sound("remove");
        this.hud?.toast(`Removed road, refunded ${formatMoney(refund)}`);
      }
      return;
    }
    if (t === "junction") {
      const n = this.nodeUnder();
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

  /**
   * World box around a screen rectangle (for spatial queries: what its corners see on the ground and on the highest
   * road deck), and a test for "drawn inside it" for a point at a height.
   */
  private screenRect(a: V2, b: V2) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const v = this.view, top = (MAX_LEVEL + 1) * LEVEL_H;
    const cs = [0, top].flatMap((h) => [v.screenToGround(x0, y0, h), v.screenToGround(x1, y0, h), v.screenToGround(x1, y1, h), v.screenToGround(x0, y1, h)]);
    const box = { x0: Math.min(...cs.map((q) => q.x)), y0: Math.min(...cs.map((q) => q.y)), x1: Math.max(...cs.map((q) => q.x)), y1: Math.max(...cs.map((q) => q.y)) };
    const inside = (p: V2, h = 0) => { const s = v.worldToScreen(p.x, p.y, h); return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1; };
    return { box, inside };
  }

  /** The road under the cursor (the deck its line of sight lands on); `level`: only roads on that level. */
  private roadUnder(level: number | null): number | null {
    return deckOn(this.game.net, this.cursorRay, 2, level)?.id ?? null;
  }

  /** What the bulldozer's click would take: a bus stop, else the building or the road the cursor is on, whichever is in front. */
  private bulldozeAt(): { stop?: number; b?: Building; seg?: number } {
    const g = this.game, ray = this.cursorRay;
    const hit = buildingOn(g, ray, this.buildings3d.solidsOf);
    const deck = deckOn(g.net, ray, 2, this.st.bdzLevel);
    const front = Math.max(hit?.h ?? 0, deck?.h ?? 0);
    const sid = front < 4 ? this.stopAt(this.cursor, 6) : null;
    if (sid !== null) return { stop: sid };
    if (hit && !(deck && deck.h > 1.5 && deck.h - 0.5 > hit.h)) return { b: hit.b };
    return deck ? { seg: deck.id } : {};
  }

  private segsInScreenRect(a: V2, b: V2): number[] {
    const g = this.game, { box, inside } = this.screenRect(a, b);
    const lvl = this.st.bdzLevel;
    const out: number[] = [];
    for (const id of g.net.segsNear(box.x0, box.y0, box.x1, box.y1)) {
      const sg = g.net.segGeom.get(id)!;
      if (sg.center.pts.some((p, i) => inside(p, sg.hs[i]) && (lvl === null || Math.abs(sg.hs[i] - lvl * LEVEL_H) < 1))) out.push(id);
    }
    return out;
  }

  private reject(msg: string) {
    this.hud?.toast(msg, true);
    this.hud?.sound("error");
    this.shake = 1;
  }

  /** The junction under the cursor. */
  private nodeUnder(): number | null {
    return junctionOn(this.game, this.cursorRay, this.view.pickMpp);
  }

  /** Buildings whose centre is inside a screen rectangle. */
  private buildingsInRect(a: V2, b: V2): Building[] {
    const { inside } = this.screenRect(a, b);
    return this.game.buildings.list.filter((o) => inside(o.c, 0));
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
    const s = this.snapPlanes((p) => snap(g.net, p, { ...this.snapOpts(), from: undefined, sites: undefined }));
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
    // (with no road at its gate yet, it is judged by distance: the road that joins it is still to come)
    const linked = (b: Building) => seg === undefined || (!!b.access && g.connected(seg, b.access.seg));
    const ring = (p: V2, r: number, color: number) => {
      const pts: V2[] = [];
      for (let i = 0; i <= 96; i++) pts.push(v2(p.x + Math.cos((i / 96) * Math.PI * 2) * r, p.y + Math.sin((i / 96) * Math.PI * 2) * r));
      pv.path(pts, color, Math.max(3, this.view.halfH / 90));
    };
    if (D.makes) {
      ring(c, D.reach!, 0x2f86e0);
      // every works in reach that draws power, building sites and ones still going up too: they are what a power
      // plant is built for (play-test 2026-11-09, A12: it said "nothing needs power" beside a coal mine's site)
      const users = g.buildings.list.filter((b) => isPlantKind(b.kind) && !!PLANTS[b.kind].power && dist(b.c, c) <= D.reach! && linked(b));
      chips.push({ text: users.length ? `Will power: ${tally(users.map((b) => BUILDING_TYPES[b.kind].name))}` : `Nothing within ${D.reach! / 1000} km draws power yet`, kind: "info" });
    } else if (D.power) {
      for (const p of plants) ring(p.c, PLANTS.coalplant.reach!, 0x2f86e0);
      const near = plants.filter((p) => dist(p.c, c) <= PLANTS.coalplant.reach! && linked(p));
      const open = near.some((p) => p.built >= 1 && !p.plant?.site);
      chips.push({
        text: open ? `Needs ${D.power} MW: a power plant is in reach` : near.length ? `Needs ${D.power} MW: the power plant in reach is still being built` : `Needs ${D.power} MW: no power plant in reach, works at ${Math.round(UNPOWERED * 100)}%`,
        kind: near.length ? "info" : "error",
      });
    }
  }

  /**
   * What a click will cost, by the pointer: in brick with its share of the company's cash once that share is large
   * (one click on a long road was a third of the bank with nothing to say so: play-test 2026-11-09, C5), and as
   * an error when there isn't the money.
   */
  private costChip(total: number): Chip {
    const money = this.game.money;
    if (total > money) return { text: `${formatMoney(total)} · not enough money`, kind: "error" };
    const share = dearShare(total, money);
    return share ? { text: `${formatMoney(total)} · ${share}% of your cash`, kind: "dear" } : { text: formatMoney(total), kind: "cost" };
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
    this.gateGhost = null;
    if (this.hasCursor) this.aimCursor();
    const t0 = this.st.tool;
    if (t0 !== "inspect" || !this.hasCursor) { this.highlight.hoverV = null; this.view.canvas.style.cursor = ""; }
    if (!this.hasCursor) { if (pv.ghost) pv.ghost.visible = false; this.hud?.chips(null); return; }
    const g = this.game;
    const c = this.cursor;
    const t = this.st.tool;
    const chips: Chip[] = [];
    if (pv.ghost) pv.ghost.visible = false;
    if (t === "road" && this.st.mode === "replace") {
      const id = this.roadUnder(null);
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
            chips.push({ text: `${ROAD_TYPES[s.type].name} → ${ROAD_TYPES[this.st.roadType].name}`, kind: "info", lead: 1 });
            chips.push(this.costChip(u.cost));
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
        pv.refs(s.refs, s.h);
        pv.target(g.net, s);
        chips.push({ text: `${T.name}: ${this.st.mode === "straight" ? "straight" : "curve"}`, kind: "info" });
        const joins = s.site ? s.label : s.node !== undefined ? (g.net.segsAt(s.node).length === 1 ? "Carries on the road" : "From the junction") : s.seg !== undefined ? `From the ${ROAD_TYPES[g.net.segs.get(s.seg)!.type].name.toLowerCase()}` : s.label;
        if (joins) chips.push({ text: joins, kind: "info", lead: 2 });
        if (this.st.level > 0) chips.push({ text: `Elevation ${this.st.level * LEVEL_H} m`, kind: "info" });
        if (this.keys.has("Alt")) chips.push({ text: "No snapping (Alt)", kind: "info" });
      } else {
        const plan = this.computeRoadPlan();
        this.plan = plan;
        if (plan) {
          const end = (plan as Plan & { snapEnd?: ToolSnap }).snapEnd!;
          pv.plan(plan, this.st.level, g.net);
          pv.refs(end.refs, end.h);
          pv.marker(this.anchor!.p, this.anchor!.h);
          pv.marker(end.p, end.h);
          if (!plan.errors.length) pv.target(g.net, end);
          for (const sp of plan.bridges ?? []) pv.bridge(sp, roadWidth(T));
          const lots = plan.errors.length ? [] : g.lotsUnder(plan);
          if (plan.errors.length) {
            const e = plan.errors[0];
            chips.push({ text: e.msg, kind: "error" });
            // say it at the spot too
            pv.dot(e.p, 0xef8a6c, Math.max(2.5, this.view.mpp * 7), this.st.level * LEVEL_H);
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
          chips.push(this.costChip(total));
          // the steepest it climbs (a bridge's ramps, or the whole road between levels), in words: the bare
          // "↗ 11.0%" was never explained (play-test 2026-11-09, C6)
          const grade = lead ? this.maxGrade(plan) : 0;
          if (grade > 0.5) chips.push({ text: `Steepest climb ${grade.toFixed(1)}%`, kind: "info" });
          // (the bridge by name at the pointer, beside the whole price; what the bridge alone costs in the notes, so the
          // pointer never shows two prices side by side)
          for (const sp of plan.bridges ?? []) {
            chips.push({ text: `Bridge ${Math.round(sp.length)} m over ${sp.over === "water" ? "water" : sp.over === "road" ? "the road" : "water and road"}`, kind: "info", icon: "bridge", lead: 1 });
            chips.push({ text: `The bridge costs ${formatMoney(sp.cost)} of it`, kind: "info" });
          }
          // (to or from a company site: which one it connects; ending at its gate, that says it all)
          if (plan.connects) chips.push({ text: plan.connects, kind: "info", lead: 3 });
          if (plan.joins && !end.site) chips.push({ text: plan.endAngleDeg !== undefined && plan.joins.startsWith("Joins the") && !plan.joins.includes("junction") ? `${plan.joins} at ${Math.round(plan.endAngleDeg)}°` : plan.joins, kind: "info", lead: 2 });
          else if (end.label && !end.site) chips.push({ text: end.label, kind: "info", lead: 2 });
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
            chips.push({ text: this.confirmKey === key ? `Click again to demolish ${what} (${formatMoney(comp)})` : `Demolishes ${what}: ${formatMoney(comp)} compensation`, kind: "error", warn: true });
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
        const hit = this.bulldozeAt(), b = hit.b;
        if (hit.stop !== undefined) {
          pv.dot(g.transit.stops.get(hit.stop)!.p, 0xe5484d);
          chips.push({ text: "Remove bus stop", kind: "info" });
          chips.push({ text: `${formatMoney(STOP_COST / 2)} refund`, kind: "cost" });
        } else if (b) {
          pv.footprint(rectCorners(b.c, b.hw, b.hd, b.rot), 0xe5484d);
          chips.push({ text: `Demolish ${b.zone ? ZONES[b.zone].short.toLowerCase() : BUILDING_TYPES[b.kind].name}`, kind: "info" });
        } else if (hit.seg !== undefined) {
          pv.removal(g.net, [hit.seg]);
          chips.push({ text: `${formatMoney(removalRefund(g.net, g.world, [hit.seg]))} refund`, kind: "cost" });
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
          if (lots.length) chips.push({ text: `${lots.length} building${lots.length === 1 ? "" : "s"} demolished`, kind: "error", warn: true });
        }
      } else chips.push({ text: "Click a road just before a junction", kind: "info" });
    } else if (t === "junction") {
      const n = this.nodeUnder();
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
        // (and its gate by name: out past the arrow, saying so when no road can reach it from here)
        this.gateGhost = { f: siteFrame(pl.c, pl.rot, pl.side, T.d / 2), hw: T.w / 2, lead: 26, ...(pl.ok && pl.free && !pl.link ? { note: "no road in reach", bad: true } : {}) };
        for (const id of pl.clears ?? []) {
          const o = g.buildings.byId.get(id);
          if (o) pv.footprint(rectCorners(o.c, o.hw, o.hd, o.rot), 0xf2a33a, gh.length > 0);
        }
        // (how far it is turned from its gate facing the bottom of the screen, once the player has turned it)
        const deg = Math.round(((this.st.placeTurn * 180) / Math.PI + 360) % 360) % 360;
        if (deg) chips.push({ text: `Turned ${deg}°`, kind: "info" });
        if (pl.link) {
          pv.plan(pl.link, 0);
          chips.push({ text: `Street to its gate: ${Math.round(pl.link.length)} m`, kind: "info", lead: 2 });
        } else if (pl.free && pl.ok) chips.push({ text: "No road it can reach: turn its gate toward one, or draw one to it", kind: "info", lead: 3 });
        else if (pl.faces) chips.push({ text: `Gate on a ${pl.faces.toLowerCase()}`, kind: "info", lead: 2 });
        // (the deposit share; a lot refused for too little of it gives the share in its reason instead)
        this.powerPreview(pv, chips, k, pl.c, pl.access?.seg);
        this.depositMarks.here = !!pl.deposit && pl.deposit.share >= MIN_DEPOSIT;
        if (pl.deposit && pl.deposit.share >= MIN_DEPOSIT) chips.push({ text: `${pl.deposit.name[0].toUpperCase()}${pl.deposit.name.slice(1)} ${Math.round(pl.deposit.share * 100)}%`, kind: "info" });
        if (!pl.ok) chips.push({ text: pl.reason ?? "Can't build here", kind: "error" });
        else {
          chips.push(this.costChip(pl.cost));
          chips.push({ text: `${formatMoney(PLACED[k].upkeep)}/h upkeep`, kind: "info" });
          const site = PLANTS[k].site;
          if (site) chips.push({ text: `Site: needs ${Object.entries(site).map(([p, q]) => `${q} load${q === 1 ? "" : "s"} of ${PRODUCTS[p as Product].name.toLowerCase()}`).join(", ")}`, kind: "info" });
          const n = pl.clears?.length ?? 0;
          if (n) chips.push({ text: `${n} building${n === 1 ? "" : "s"} replaced`, kind: "error", warn: true });
        }
      }
    } else if (t === "inspect") {
      // what a click would select: a thin cream outline and a pointer (the selection itself is lit by Highlight3D)
      // (a trouble roundel or a works' far plate under the pointer stands for its building, and says what is wrong)
      const ic = this.icons.hit(this.cursorPx.x, this.cursorPx.y);
      const h: Sel | null = ic ? { k: "building", id: ic.b.id } : this.pickOn(this.cursorRay);
      this.highlight.hoverV = h?.k === "vehicle" ? h.id : null;
      // (the building it is: a town's hall or civic building selects the town)
      const hb = h?.k === "building" ? g.buildings.byId.get(h.id) ?? null : h?.k === "town" ? buildingOn(g, this.cursorRay, this.buildings3d.solidsOf)?.b ?? null : null;
      const gr = h ? null : groundAt(g, c);
      this.view.canvas.style.cursor = h || (gr && isMined(gr.id)) ? "pointer" : "";
      const w = Math.max(0.8, 1.6 * this.view.mpp), cream = 0xf3ead6;
      if (h && (h.k === "building" || h.k === "town") && !(this.sel && this.sel.k === h.k && this.sel.id === h.id)) {
        if (hb) { const k = rectCorners(hb.c, hb.hw + 1, hb.hd + 1, hb.rot); pv.path([...k, k[0]], cream, w); }
      } else if (h?.k === "seg" && !(this.sel?.k === "seg" && this.sel.id === h.id)) pv.highlight(g.net, [h.id]);
      else if (h?.k === "node") {
        const n = g.net.nodes.get(h.id), r = (g.net.nodeGeom.get(h.id)?.radius ?? 8) + 2;
        if (n) pv.path(Array.from({ length: 33 }, (_, i) => ({ x: n.p.x + Math.cos(i / 16 * Math.PI) * r, y: n.p.y + Math.sin(i / 16 * Math.PI) * r })), cream, w, n.h);
      }
      const b = hb;
      if (ic) {
        const m = modelOf(g, { k: "building", id: ic.b.id }, undefined, () => "");
        if (m) {
          chips.push({ text: `${m.title}: ${m.status.text}`, kind: m.status.tone === "bad" ? "error" : "info" });
          if (m.status.fix) chips.push({ text: m.status.fix, kind: "info" });
        }
      } else if (b) chips.push({ text: b.zone ? `${ZONES[b.zone].short} · ${b.town !== undefined ? g.towns.byId.get(b.town)?.name ?? "" : "level " + b.level}` : BUILDING_TYPES[b.kind].name, kind: "info" });
    }
    this.hud?.chips(chips.length ? this.cursorPx : null, chips);
  }

  /** The gate to mark now: the works in hand's, else the selected works' (saying so when no road is at it yet). */
  private gateAsk(): GateAsk | null {
    if (this.bare || this.mode !== "play") return null;
    if (this.st.tool === "place") return this.hasCursor ? this.gateGhost : null;
    const b = this.sel?.k === "building" ? this.game.buildings.byId.get(this.sel.id) : undefined;
    if (!b || !b.placed || !b.plant) return null;
    return { f: siteFrame(b.c, b.rot, b.side, b.hd), hw: b.hw, ...(b.access ? {} : { note: "no road yet", bad: true }) };
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

  /** The light and the season for this frame, and the lamps that go with them. */
  private dayFrame(dt: number, far: boolean) {
    const g = this.game;
    const L = this.dayCycle.update(g.time + g.alpha * SIM.dt, dt, this.mode === "menu", this.overlay !== "none", this.mode === "menu" ? 0 : farLift(this.view.halfH));
    this.view.setLight(L.amb, L.sun, L.dir);
    this.smoke.setLight(L.amb, L.sun, L.dir);
    this.birds.setLight(L.amb, L.sun, L.dir);
    // (no shadow map once the direct light is too faint to cast one)
    if (L.shade < 0.04) this.view.sun.castShadow = false;
    // the fields follow the season shown (the menu's and the dev hook's too)
    const look = fieldLook(this.dayCycle.lookTime(g.time));
    if (look !== this.fieldsWere) {
      if (this.fieldsWere) { this.buildings3d.rebuild(g.buildings.list); this.applyTint(); }
      this.fieldsWere = look;
    }
    const sig = `${this.roads.lampVersion}:${this.buildings3d.version}`;
    if (sig !== this.lampSig) {
      this.lampSig = sig;
      this.lamps.setStatic([...this.roads.lamps, ...this.buildings3d.floods], this.buildings3d.windows);
    }
    if (this.roads.signalVersion !== this.signalsWere) {
      this.signalsWere = this.roads.signalVersion;
      this.signals.setSpots(this.roads.signalSpots);
    }
    this.signals.update(g.traffic, this.view.mpp);
    this.lamps.showCars(!far);
    const lum = (c: readonly number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    this.lamps.update(L.lamps, this.dayCycle.hour, this.view.mpp, this.roads.signalHeads, lum(L.amb) + lum(L.sun));
  }

  frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    this.syncRise();
    // The camera from the keys: W A S D or the arrows move it along the screen's own axes, Q/E turn it, + and - zoom
    // (R and I open the catalogs), Y/H tilt it. Not with Ctrl held (Ctrl+S saves, Ctrl+Y is redo), nor while a cinematic camera films.
    const held = (...ks: string[]) => ks.some((k) => this.keys.has(k));
    const free = !this.camera.cinematic && !held("Control", "Meta");
    let mx = free ? (held("d", "ArrowRight") ? 1 : 0) - (held("a", "ArrowLeft") ? 1 : 0) : 0;
    let my = free ? (held("s", "ArrowDown") ? 1 : 0) - (held("w", "ArrowUp") ? 1 : 0) : 0;
    const turn = free ? (held("e") ? 1 : 0) - (held("q") ? 1 : 0) : 0;
    const zoom = free ? (held("-", "_") ? 1 : 0) - (held("+", "=") ? 1 : 0) : 0;
    // Y up toward the Map view, H down toward the horizon
    const pitch = free ? (held("h") ? 1 : 0) - (held("y") ? 1 : 0) : 0;
    if ((mx || my) && (this.camera.following !== null || this.glide)) { this.camera.stopFollow(); this.glide = null; }
    // (a diagonal is no faster than a straight run)
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    // each eases in and out over a few frames, so the camera starts and stops softly instead of at full speed
    const K = this.keyCam, ease = reducedMotion() ? 1 : 1 - Math.exp(-dt * KEY_EASE);
    const toward = (v: number, to: number) => { const n = v + (to - v) * ease; return Math.abs(n - to) < 0.01 ? to : n; };
    K.x = toward(K.x, mx); K.y = toward(K.y, my); K.turn = toward(K.turn, turn); K.zoom = toward(K.zoom, zoom);
    if (this.camera.cinematic || this.mode === "menu") K.x = K.y = K.turn = K.zoom = 0;
    if (K.x || K.y) {
      // (at the same speed on screen whichever way: at a tilt the ground up the screen is foreshortened, so the
      // camera covers more of it going up or down than going across)
      const px = (520 * dt * (this.view.halfH / 170) ** 0.85) / this.view.mpp;
      const v = this.view.screenVec(K.x * px, K.y * px);
      this.view.cx += v.x;
      this.view.cy += v.y;
    }
    if (K.turn) this.view.rotateAt(this.view.w / 2, this.view.h / 2, K.turn * 1.5 * dt);
    if (K.zoom) { this.zoomEase = null; this.view.zoomAt(this.view.w / 2, this.view.h / 2, Math.exp(K.zoom * 2.2 * dt)); }
    // a wheel notch easing in (most of it within a tenth of a second)
    if (this.zoomEase) {
      const Z = this.zoomEase, v = this.view;
      if (this.camera.cinematic || this.glide || this.mode === "menu") this.zoomEase = null;
      else {
        const r = Z.to / v.halfH, last = Math.abs(Math.log(r)) < 0.004;
        v.zoomAt(Z.px, Z.py, last ? r : Math.pow(r, 1 - Math.exp(-dt * 16)));
        this.clampView();
        if (last) this.zoomEase = null;
      }
    }
    if (pitch) { this.pitchBy(pitch * KEY_TILT * dt); this.pitching = true; }
    else if (this.pitching) { this.pitching = false; this.settleView(); }
    if (K.x || K.y || K.turn || K.zoom) this.clampView();
    // easing between the Diorama and the Map view (M, the Camera setting): 0.4 s
    if (this.tiltAnim) {
      const A = this.tiltAnim;
      A.t += dt;
      const k = Math.min(1, A.t / 0.4), e = k * k * (3 - 2 * k);
      this.view.pitch = A.from + (A.to - A.from) * e;
      if (k >= 1) this.tiltAnim = null;
    }
    // the title menu's backdrop: the Diorama, swaying slowly round the town (still, with reduced motion asked for)
    if (this.mode === "menu" && this.menuCam) {
      const M = this.menuCam, v = this.view;
      if (!reducedMotion()) M.t += dt;
      v.pitch = MENU_TILT;
      v.halfH = M.halfH;
      v.rot = M.rot + MENU_SWAY * Math.sin((M.t * 2 * Math.PI) / MENU_SWAY_S);
      // (the town a little right of the middle, clear of the menu card, whichever way the camera has swung)
      const W = v.halfH * 2 * (v.w / Math.max(1, v.h));
      v.cx = M.c.x - Math.cos(v.rot) * W * 0.14;
      v.cy = M.c.y - Math.sin(v.rot) * W * 0.14;
    }
    g.update(dt);
    this.audio.update(dt);
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
    }
    // following a vehicle, a cinematic shot, the fade between shots
    this.camera.update(dt);
    // whatever moved the view moved what is under the cursor; and the player's own turn and tilt are remembered
    const vk = `${this.view.cx.toFixed(2)},${this.view.cy.toFixed(2)},${this.view.halfH.toFixed(2)},${this.view.rot.toFixed(4)},${this.view.tilt.toFixed(4)}`;
    if (vk !== this.viewKey) {
      this.viewKey = vk;
      if (this.hasCursor && !this.camera.cinematic) { this.aimCursor(); this.dirtyPreview = true; }
    }
    this.transit3d.update(g.transit, g.net, this.st.tool === "transit" || !!this.hud?.linesShown, this.view.mpp, this.view.rot);
    this.flowT += dt;
    const flowOn = this.overlay === "flow";
    this.roads.update(g.traffic, flowOn && this.flowT > 0.5);
    if (this.flowT > 0.5) this.flowT = 0;
    if (this.dirtyPreview && !this.camera.cinematic) {
      // (a preview that can't be drawn must never stop the game)
      try { this.refreshPreview(); } catch (e) { this.dirtyPreview = false; console.error(e); }
    }
    // (the clock counts every game minute; the rest of the bar every quarter second)
    this.hud?.clock();
    this.buildings3d.frameConstruction();
    this.hudT += dt;
    if (this.hudT > 0.25) {
      this.hudT = 0;
      this.rememberView();
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
    // the trees make way for what was just built (and come back where it was removed)
    if (this.forestDue && now - this.forestAt > 250) {
      this.forestDue = false;
      this.forestAt = now;
      this.terrain3d.invalidateTrees(this.forest.setShapes(clearShapes(g.net, g.buildings.list)));
    }
    this.dayFrame(dt, far);
    if (!g.paused) this.windClock += dt;
    setWind(g.time + g.alpha * SIM.dt, this.windClock);
    // the trees stand in 3D near in; farther out the ground paints their crowns. The planted ones (streets, greens,
    // squares, front gardens) are handed over whenever their lists change
    const tv = `${this.roads.treeVersion}:${this.greens3d.treeVersion}:${this.buildings3d.treeVersion}`;
    if (tv !== this.treeSig) {
      this.treeSig = tv;
      this.trees3d.setPlanted([...this.roads.streetTrees, ...this.greens3d.trees, ...this.buildings3d.squareTrees, ...this.buildings3d.stripTrees]);
    }
    this.trees3d.update(this.view.camera, this.view.mpp, this.terrain3d.shared.uOverlay.value > 0.5);
    this.terrain3d.shared.uPaint.value = this.trees3d.paint;
    this.terrain3d.crownsSoon = this.trees3d.handoverNear;
    // the works smoke, the chimneys too in the cold, and the dirt roads raise dust (not on the data maps)
    if (this.buildings3d.version !== this.smokeSig) {
      this.smokeSig = this.buildings3d.version;
      this.smoke.setEmitters(this.buildings3d.emitters);
    }
    this.smoke.mesh.visible = this.terrain3d.shared.uOverlay.value < 0.5;
    this.smoke.update(this.view.camera, this.view.mpp, g.paused ? 0 : dt, g.time + g.alpha * SIM.dt, far ? null : g.traffic);
    // and over the woods and the fields a few birds wheel
    this.birds.update(this.view.camera, this.view.mpp, g.paused ? 0 : dt);
    if (this.terrain3d.shared.uOverlay.value >= 0.5) this.birds.mesh.visible = false;
    this.landMask.update(g.buildings.list, this.buildings3d.version);
    this.terrain3d.update(this.view);
    this.roadsFar.update(this.view.mpp, this.view.w, this.view.h);
    this.labels.update(this.view);
    this.convoyTags.update(this.view, g.alpha);
    this.townPings.update(this.view);
    this.depositMarks.update(this.view);
    this.goalPtr.update(this.view);
    this.gateMark.set(this.gateAsk());
    this.gateMark.update(this.view);
    this.stuckAlerts.update(this.view);
    if (this.groundField() !== this.groundKey) { this.groundOverlay(); this.iconT = 1; }
    this.highlight.group.visible = this.mode !== "menu";
    this.highlight.update(g, g.alpha, this.view.mpp, dt);
    this.iconT += dt;
    if (this.iconT > 0.4) {
      this.iconT = 0;
      this.icons.set(this.bare ? [] : g.buildings.list, this.view);
      this.townLabels();
      this.convoyTags.sync(g.traffic.vehicles, g.buildings.byId, this.bare);
      this.townPings.sync(g.towns.list, g.time, served, this.bare);
      this.stuckAlerts.sync(g.traffic.stuckCars(STUCK_KEEP), g.time, this.bare);
      const dm = this.markedDeposits();
      this.depositMarks.show(dm.kinds, dm.focus);
      this.depositMarks.inView = dm.focus && this.fieldInView(dm.kinds[0].field);
      // the first goal's soil: pointed at till the first farm is placed
      const farming = this.st.tool === "place" && this.st.placed === "farm";
      this.goalPtr.set(!this.bare && this.mode === "play" && !g.progress.done.includes("food10") ? farmSpot(g) : null, farming);
      this.depositMarks.mute = this.goalPtr.pointing;
    }
    else this.icons.update(this.view);
    this.pops.update(this.view, this.bare || far ? null : g.traffic, g.alpha);
    this.hud?.cameraPose(this.view.rot, this.view.tilt);
    this.view.render();
    requestAnimationFrame(this.frame);
  };

  /** Keep the player's own turn and Diorama pitch (not a cinematic camera's, nor the title menu's) for next time. */
  private rememberView() {
    if (this.mode !== "play" || this.camera.cinematic || this.tiltAnim) return;
    const key = `${this.view.rot.toFixed(3)},${this.dioTilt.toFixed(3)}`;
    if (key === this.viewSaved) return;
    this.viewSaved = key;
    saveTurn(this.view.rot);
    saveTilt(this.dioTilt);
  }

  /**
   * The towns' names on the map, with their size and, under them, the needs that want seeing to: each need's picture
   * on a disc tinted by how it is doing (fine, running low, none), nothing at all while every need is met, and a town
   * no road reaches yet says so. Click one to open its panel.
   */
  private townLabels() {
    const g = this.game;
    const hide = this.bare;
    const info = g.towns.list.map((t) => ({ t, ln: labelNeeds(t, t.spawned && joinedUp(g, t)) }));
    const sig = (ln: LabelNeeds) => (ln.kind === "calm" ? "" : ln.kind === "noroad" ? `x${ln.joined ? "j" : ""}${ln.needs.join(",")}` : ln.needs.map((n) => `${n.p}.${n.state}`).join(","));
    // (a town with an open order wears a tag saying what for: owner, 2026-11-08)
    const ord = (id: number) => g.orders.openIn(id).map((o) => CIVICS[o.kind].fair ? CIVICS[o.kind].fair!.event : CIVICS[o.kind].name).join(" · ");
    const key = hide ? "" : info.map(({ t, ln }) => `${t.id}:${t.name}:${g.towns.sizeName(t)}:${t.pop}:${sig(ln)}:${ord(t.id)}`).join("|");
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.labels.set(hide ? [] : info.map(({ t, ln }) => {
      const size = g.towns.sizeName(t);
      const pop = t.pop.toLocaleString("en-US");
      const words = (ps: Product[]) => ps.map((p) => PRODUCTS[p].name.toLowerCase()).join(" and ");
      let say = "";
      if (ln.kind === "noroad") say = ln.joined ? ", joined by road, waiting for its first load" : ", no road reaches it yet";
      else if (ln.kind === "needs") {
        const none = ln.needs.filter((n) => n.state === "none").map((n) => n.p), low = ln.needs.filter((n) => n.state === "low").map((n) => n.p);
        say = `${none.length ? `, no ${words(none)} coming` : ""}${low.length ? `, running low on ${words(low)}` : ""}`;
      }
      // (the name stands over its hall's roof)
      const hall = g.towns.hallOf(t);
      return {
        p: t.c, h: hall ? this.buildings3d.topOf(hall) + 4 : 0, name: t.name, sub: `${size} · ${pop}`, minHalfH: 160, rank: t.pop,
        title: `${t.name}, ${size} of ${pop} people${say}${ord(t.id) ? `, with an order open: ${ord(t.id)}` : ""}. Open the town`,
        order: ord(t.id) || undefined,
        icons: ln.kind === "calm" ? undefined
          : ln.kind === "noroad" ? ln.needs.map((p) => ({ svg: productIcon(p), cls: "noroad" }))
          : ln.needs.map((n) => ({ svg: productIcon(n.p), cls: n.state })),
        note: ln.kind === "noroad" ? (ln.joined ? "First load due" : "No road yet") : undefined,
        summary: labelSummary(ln) ?? undefined,
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
