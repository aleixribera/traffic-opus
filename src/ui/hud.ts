import { BUILDING_TYPES, LEVEL_H, MAX_LEVEL, ROAD_TYPES, SIGNAL_COST, type BuildingKind, type RoadTypeId } from "../config";
import { wireNights } from "./nightsSetting";
import { wireCamera } from "./cameraSetting";
import { WHEEL_MODES, saveWheelMode } from "./wheel";
import { saveEdgeScroll, wireEdgeScroll } from "./panning";
import { formatMoney, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { ZONE_GROUP } from "../game/growables";
import { MILESTONES, unlockedBy, type Milestone, type Unlocks } from "../game/progression";
import { buildTime } from "../game/construction";
import { DEPOT_REACH, HIST_HOURS, Industry, PLANTS, PRODUCTS, MIN_DEPOSIT, SUPPLY_STORE, UNPOWERED, isPlantKind, powerPace, type PlantKind, type Product } from "../game/industry";
import { TRUCK_CLASSES, TRUCK_CLASS_ORDER, type TruckClass } from "../game/trucks";
import { LEVEL_MULT, SITE_LEVELS } from "../game/sites";
import { compassWords, served, type Town } from "../game/settlements";
import { HALLS, TOWN_SIZES, needFrom, needsOf, sizeOf } from "../game/towns";
import { HOUR } from "../game/society";
import { PAL } from "../render/palette";
import { F } from "../world/gen";
import { DEPOSIT_KINDS } from "./depositMarks";
import type { SignalPlan } from "../roads/network";
import { GREEN, LEFT_GREEN, greenFor, stuckNow } from "../sim/traffic";
import { SEASONS } from "../game/calendar";
import type { GameAudio } from "../audio";
import { ROAD_MODES, type App, type OverlayId, type RoadMode, type ToolId } from "../app";
import { ROUNDABOUTS, type RoundaboutSize } from "../roads/planner";
import { ICON, buildingIcon, placedIcon, productIcon, roadIcon } from "./icons";
import { TradeLedger, approaches, extractorFor, fmtRate, modelOf, sameSel, signedMoney, waitTone, worksStatus, type FlowChip, type PanelModel, type Sel } from "./inspect";
import { comingNeeds, growthOf, townNeeds, type NeedView } from "./needs";
import type { Lane } from "../roads/network";
import { CHANGELOG } from "../changelog";
import { PLACED, PLACED_TABS, type PlacedKind } from "../game/placed";
import { SAVE_V, type Game } from "../game/city";
import { BUS_UPKEEP, STOP_COST } from "../game/transit";
import { WirelessControl, soundHtml, soundSummary, wireSound } from "./soundPanel";
import { heraldSvg } from "./herald";
import { cleanName, COMPANY_NAME_MAX, randomHerald } from "../game/company";
import { companyName } from "../game/names";
import { landmarkDone, landmarkSite, parkSection, seasonLine, specialRows } from "./specials";
import { MEGAS, isMega } from "../game/megaprojects";
import { TipPrefs, joinedUp, tipFor } from "./tips";
import { blockWords, buildOrder, shortfalls, shownRate } from "./bottleneck";
import { longProject, type LongProject } from "./longProject";
import { distText, planLength } from "./distance";
import { goalNow, goalNowSay, lineOf } from "./goalNow";
import { STUCK_RAISE, stuckSpots } from "./stuckAlerts";
import { nextTown } from "./nextTown";
import { openOrders, townOrders } from "./orders";
import { CIVICS, type CivicKind } from "../game/civics";
import { orderLine } from "../game/orders";
import { SeasonCard } from "./seasonCard";
import { escLayer, type EscState } from "./escape";
import { pointerLine, type PointerChip } from "./pointer";
import { catalogLayout } from "./catalog";
import { lockShort } from "./lockText";

/** Something a tool says about a click: the pointer shows the one that matters, the tool options the rest (pointer.ts). */
export interface Chip extends PointerChip {
  icon?: keyof typeof ICON;
}

const OVERLAYS: { id: OverlayId; label: string; blurb: string; tip?: string }[] = [
  { id: "flow", label: "Traffic flow", blurb: "Road speed against the limit" },
  { id: "resources", label: "Resources", blurb: "Where extractors can work", tip: "Click a kind under the list to fly to its nearest deposit" },
  // (both drive how a town builds up, and the company moves them: a works beside homes, a town order filled)
  { id: "landvalue", label: "Land value", blurb: "What a street is worth", tip: "Your works and power plants drag it down next door. Shops close by and a town's civic buildings lift it" },
  { id: "level", label: "Building level", blurb: "Homes and shops, level 1 to 5", tip: "They build up where land value is high. Each level holds more people or more trade" },
  { id: "problems", label: "Problems", blurb: "Works held up by something" },
  { id: "power", label: "Power", blurb: "Who has power and who is short" },
];

/** Build categories along the bottom bar, each with its asset tabs (towns spring up by themselves: the Towns window is in the top bar). */
type CatId = "roads" | "industry" | "transport";
type Asset =
  | { kind: "road"; id: RoadTypeId }
  | { kind: "placed"; id: PlacedKind }
  | { kind: "roundabout"; size: RoundaboutSize }
  | { kind: "junction" }
  | { kind: "lane" }
  | { kind: "busstop" }
  | { kind: "busline" };
interface Tab { id: string; label: string; assets: Asset[] }
const CATS: Record<CatId, { label: string; tabs: Tab[] }> = {
  roads: {
    label: "Roads",
    tabs: [
      { id: "small", label: "Small roads", assets: [{ kind: "road", id: "dirt" }, { kind: "road", id: "one1" }, { kind: "road", id: "street" }, { kind: "road", id: "streetM" }] },
      { id: "medium", label: "Medium roads", assets: [{ kind: "road", id: "one2" }, { kind: "road", id: "avenue" }, { kind: "road", id: "avenueM" }] },
      { id: "large", label: "Large roads", assets: [{ kind: "road", id: "boulevard" }, { kind: "road", id: "boulevardM" }] },
      { id: "highways", label: "Highways", assets: [{ kind: "road", id: "hw1" }, { kind: "road", id: "hw2" }, { kind: "road", id: "one3" }, { kind: "road", id: "one4" }] },
      { id: "junctions", label: "Junctions", assets: [1, 2, 3, 4].map((s) => ({ kind: "roundabout", size: s as RoundaboutSize }) as Asset).concat([{ kind: "lane" }, { kind: "junction" }]) },
    ],
  },
  industry: {
    label: "Industry",
    // (the power plant is one card: it shares a tab with the warehouse and the fuel depot, not a tab to itself)
    tabs: PLACED_TABS.filter((t) => t.id !== "power").map((t) => {
      const kinds = t.id === "logistics" ? [...t.kinds, ...PLACED_TABS.filter((x) => x.id === "power").flatMap((x) => x.kinds)] : t.kinds;
      return { id: t.id, label: t.id === "logistics" ? "Logistics & power" : t.label, assets: kinds.map((id) => ({ kind: "placed", id }) as Asset) };
    }),
  },
  transport: {
    label: "Transport",
    tabs: [{ id: "bus", label: "Bus", assets: [{ kind: "busstop" }, { kind: "busline" }] }],
  },
};
const catOf = (st: { tool: ToolId }): CatId | null => {
  const t = st.tool;
  if (t === "road" || t === "roundabout" || t === "junction" || t === "lane") return "roads";
  if (t === "place") return "industry";
  return t === "transit" ? "transport" : null;
};

type WinId = "info" | "progression" | "economy" | "city" | "transport" | "camera";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60), x = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};

const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString("en-US"));
/** A banner waiting its turn: a milestone reached (with the towns it brought), a town grown into a new size, a landmark, a town sprung up. */
type Banner = { m: Milestone; towns?: number[] } | { town: number; size: number } | { landmark: number } | { spawned: number; from: number | null; dist: number; dir: string }
  | { order: number; kind: CivicKind; b?: number; grant: number };
/** (nothing at all is "$0" in plain cream, never a green "+$0": the one sign-and-colour rule every money figure uses) */
const signed = signedMoney;
const moneyTone = (n: number) => (Math.round(n) > 0 ? "good" : Math.round(n) < 0 ? "bad" : "");
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const lum = (c: number) => {
  const ch = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((c >> 16) & 255) + 0.7152 * ch((c >> 8) & 255) + 0.0722 * ch(c & 255);
};
const mixRgb = (a: number, b: number, k: number) =>
  [16, 8, 0].reduce((o, s) => o | (Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s), 0);
const PLATE_LUM = lum(0x122036), CREAM_2 = 0xcfc4ab;
/**
 * A product's colour for bars and pips on the dark plates (theme --plate): a dark one (coal, crude oil) is lifted
 * toward cream until it reads at 3:1, the others pass as they are.
 */
const onPlate = (c: number) => {
  let x = c;
  for (let k = 0.1; k <= 1 && (lum(x) + 0.05) / (PLATE_LUM + 0.05) < 3; k += 0.1) x = mixRgb(c, CREAM_2, k);
  return hex(x);
};

const FEATURE_NAME = { roundabout: "Roundabouts", signals: "Traffic lights", parallel: "Parallel roads", transit: "Buses" } as const;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A kind of site, plural: "Farms", "Quarries", "Cement Works". */
const plantsName = (k: BuildingKind) => {
  const n = BUILDING_TYPES[k].name;
  return /(works|s)$/i.test(n) ? n : /[^aeiou]y$/i.test(n) ? `${n.slice(0, -1)}ies` : `${n}s`;
};
/** "a", "a and b", "a, b and c" */
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

/** What a milestone unlocks, item by item: "Iron Mine", "A new town: Fort Pryor", "$15,000 grant" (`towns`: the names of the towns it brought, once reached). */
function unlockList(u: Unlocks, towns: string[] = []): string[] {
  return [
    ...(u.buildings ?? []).map((k) => BUILDING_TYPES[k].name),
    ...(u.trucks ?? []).map((c) => `${TRUCK_CLASSES[c].name}s`),
    ...(u.roads ?? []).map((r) => ROAD_TYPES[r].name),
    ...(u.features ?? []).map((f) => FEATURE_NAME[f]),
    ...(u.towns ? [towns.length ? `${towns.length > 1 ? "New towns" : "A new town"}: ${towns.join(" and ")}` : u.towns > 1 ? `${u.towns} new towns spring up` : "A new town springs up"] : []),
    ...(u.levels ? [`${andList(u.levels.kinds.map((k) => plantsName(k)))} grow to level ${u.levels.to}`] : []),
    ...(u.grant ? [`${formatMoney(u.grant)} grant`] : []),
  ];
}

/** How far along a milestone is, as text: "214 / 300", "$12,400 / $20,000". */
function measureText(m: Milestone, have: number, need: number): string {
  const f = m.money ? (x: number) => formatMoney(Math.round(x)) : fmtNum;
  return `${f(Math.min(have, need))} / ${f(need)}`;
}

/** What each snapping switch does (the road tool's snapping menu). */
const SNAP_HELP = {
  geometry: "Ends join the road or junction you aim at; near a junction they join the junction, and aimed nearly square they meet the road square.",
  guides: "Dashed guides: straight on from a dead end, square to nearby roads and through their junctions, right angles off the start, and level with nearby junctions.",
  netSide: "Guides parallel to nearby straight roads: kerb to kerb, a verge apart, one lot deep, and a town block apart.",
  length: "Straight roads come in 8 m steps of length.",
  angle: "Straight roads turn in 15° steps. Hold Shift to flip this while drawing; hold Alt to ignore all snapping.",
} as const;

const KEYS: [string, string][] = [
  ["Esc", "Back one step. With nothing open, the pause menu"],
  ["Right click", "Undo a road's last click, again to drop the tool"],
  ["W A S D / drag", "Move the camera. Right-drag, or left-drag with nothing in hand"],
  ["Space + drag", "Move the camera with a tool in hand"],
  ["Two fingers", "Touchpad: scroll to move, pinch to zoom, click to right-click"],
  ["Q / E", "Turn the camera"],
  ["Middle drag", "Turn sideways, tilt up and down"],
  ["Y / H", "Tilt toward straight down / toward the horizon"],
  ["M", "Map view and back to the Diorama"],
  ["Camera block", "Drag to turn and tilt, click for the Map view"],
  ["Wheel, + / -", "Zoom"],
  ["R / I", "Roads / Industry"],
  ["Tab", "Next road mode: curve, straight, upgrade"],
  ["Page Up / Down", "Raise or lower the road"],
  ["[ / ]", "Parallel road spacing"],
  [", / .", "Turn the building in hand 15°, 1° with Shift. Shift + wheel too"],
  ["Shift", "15° angle steps while drawing"],
  ["Alt (hold)", "Ignore snapping and guides"],
  ["B", "Bulldozer"],
  ["L", "Add lane. Shift or right click removes"],
  ["P / Z / C / X", "Goals / Economy / Towns / Traffic"],
  ["Space, 1 2 3", "Pause, game speed"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["F5 / F9", "Quicksave / quickload"],
  ["`", "Hide the interface"],
  ["G", "Follow the nearest truck"],
  ["T / Shift+T", "Tour camera / Vehicle cam"],
  ["N", "Sound on / off"],
];

export class Hud {
  root = h("div", "hud");
  // bottom bar
  private bbar = h("footer", "bbar");
  private popEl = h("span", "cb-pop");
  private moneyBtn = h("button", "cb-money");
  private clockEl = h("button", "cb-clock");
  private speed = h("div", "speed");
  private cats = h("nav", "cats");
  private assets = h("section", "card assets");
  private toolOpts = h("section", "card toolopts");
  // corners
  private tlBtns = new Map<WinId | "menu", HTMLButtonElement>();
  private win = h("section", "card win");
  private tut = h("section", "card goals");
  private panel = h("aside", "card panel");
  private chipBox = h("div", "chips");
  /** the notes a tool has about the click under the pointer, beyond the one line shown there */
  private readEl = h("ul", "to-read");
  /** the tool options card has no options for the tool in hand, only the notes about the click (shown while there are some) */
  private toolNotesOnly = false;
  private readKey = "";
  /** "Following · Heavy truck · Coal to the Smelter · Stop", above the bar while the camera follows a vehicle */
  private followEl = h("div", "card follow-chip");
  private toastBox = h("div", "toasts");
  private modal = h("div", "modal");
  private rectEl = h("div", "selrect");
  private banner = h("section", "card banner");
  /** the season's title card when the calendar turns, and the clock's season popover */
  private seasons = new SeasonCard(() => ({ game: this.app.game, mode: this.app.mode }));
  /** the company's name and herald, top left by the menu (click: rename it) */
  private companyEl = h("button", "company");
  private companyKey = "";
  private compass = h("button", "tlb compass");
  private compassRot = NaN;
  /** the camera control: a small block seen as the camera sees the map (turned, tilted); click for the Map view, drag to turn and tilt */
  private viewBtn = h("button", "tlb viewgiz");
  private viewKey = "";
  /** the pause menu's Camera button, while it is open: M and the control flip the same setting */
  private camShow: (() => void) | null = null;
  private undoBtn = h("button", "cat hist");
  private redoBtn = h("button", "cat hist");
  private catBtns = new Map<string, HTMLButtonElement>();
  private cat: CatId | null = null;
  private tab: Record<CatId, string> = { roads: "small", industry: "extraction", transport: "bus" };
  private lastRoad: RoadTypeId = "dirt";
  /** the drawing mode last used (curve or straight): picking a road card comes back to it from Upgrade */
  private lastDraw: RoadMode = "curve";
  /** the catalog asked open while a building is in hand (it folds to its strip by itself, out of the map's way) */
  private catPeek = false;
  /** a card picked (or the tool used on the map) since the catalog opened: its cards have done their job and fold */
  private handPicked = false;
  /** the catalog put out of sight with its tool still in hand (the strip's Hide; the category's button brings it back) */
  private catHidden = false;
  /** the card under the pointer or the keyboard focus: the catalog's line reads it out */
  private hoverKey = "";
  private winKind: WinId | null = null;
  /** the one thing selected on the map (its panel is open top right) */
  private sel: Sel | null = null;
  /** who trades with whom lately (the panels' flow chips) */
  private ledger = new TradeLedger();
  /** when the panel's demolish button was armed (a second click within 3 s pulls it down) */
  private armed = 0;
  private panelNode = -1;
  private panelPhase = 0;
  /** the Goals card folded to its one line (remembered per browser: a player who folds it wants it folded) */
  private get tutHidden(): boolean { try { return localStorage.getItem("flowtown.goals.folded") === "1"; } catch { return this.tutFold; } }
  private set tutHidden(v: boolean) { this.tutFold = v; try { localStorage.setItem("flowtown.goals.folded", v ? "1" : "0"); } catch { /* private window: for the session */ } }
  private tutFold = false;
  /** tips off, and the ones dismissed (kept per browser) */
  private tipPrefs = new TipPrefs();
  private lastPanel = "";
  private lastWin = "";
  private lastAssets = "";
  private resumeOnClose = false;
  /** everything heard goes through the app's audio (audio/index.ts) */
  private get sfx() { return this.app.audio; }
  private wireless!: WirelessControl;

  constructor(private app: App, parent: HTMLElement) {
    this.holdPanel();
    parent.appendChild(this.root);
    this.build();
  }

  private build() {
    const app = this.app;
    // ---- top left: the menu and the city's info buttons
    const tl = h("div", "corner tl");
    const row = h("div", "tl-row");
    // (each with its name under its picture, like the bottom bar: design audit 2026-11-10, F28. The tooltip keeps the
    // longer say and the key)
    const tlb = (k: WinId | "menu", icon: string, label: string, title: string, fn: () => void) => {
      const b = h("button", "tlb", `${icon}<span class="tlb-l">${label}</span>`);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = () => { fn(); this.sfx.play("click"); };
      this.tlBtns.set(k, b);
      row.appendChild(b);
    };
    tlb("menu", ICON.menu, "Menu", "Pause menu (Esc)", () => this.openPause());
    this.companyEl.title = "Your company: rename it, change its badge";
    this.companyEl.onclick = () => { this.sfx.play("click"); this.openCompany(); };
    row.appendChild(this.companyEl);
    row.appendChild(h("span", "tl-sep"));
    tlb("info", ICON.layers, "Views", "Map views: traffic flow, power, soil and more", () => this.toggleWin("info"));
    tlb("progression", ICON.flag, "Goals", "Goals (P): every goal, reached and to come", () => this.toggleWin("progression"));
    tlb("economy", ICON.coins, "Economy", "Economy (Z): money in and out, and what your works made", () => this.toggleWin("economy"));
    tlb("city", ICON.townGlyph, "Towns", "Towns (C)", () => this.toggleWin("city"));
    tlb("transport", ICON.car, "Traffic", "Traffic (X): how the roads are flowing, and your bus lines", () => this.toggleWin("transport"));
    tlb("camera", ICON.camera, "Camera", "Camera: follow a truck, Tour, Vehicle cam (G, T, Shift+T)", () => this.toggleWin("camera"));
    this.buildViewBtn(row);
    this.compass.innerHTML = `${ICON.north}<span class="tlb-l">North</span>`;
    this.compass.title = "North up (the map is turned: Q / E or middle-drag)";
    this.compass.setAttribute("aria-label", "Turn the map north up");
    this.compass.onclick = () => { app.resetNorth(); this.compassAngle(0); };
    this.compass.hidden = true;
    row.appendChild(this.compass);
    this.win.hidden = true;
    tl.append(row, this.win);

    // ---- top right: tips + the selected object
    const tr = h("div", "corner tr");
    this.tut.setAttribute("aria-label", "Goals");
    tr.append(this.tut, this.panel);

    // ---- bottom: tool options, asset panel, the bar
    const bottom = h("div", "bottom");
    // city block (left)
    const city = h("div", "bb-city");
    this.moneyBtn.onclick = () => this.toggleWin("economy");
    this.moneyBtn.title = "Economy (Z)";
    this.popEl.title = "People living in all your towns together";
    // (the goals' count and progress live in the Goals card and its window: the bar keeps people and money.
    // docs/ui-words.md, one place per fact)
    city.append(this.popEl, this.moneyBtn);
    // categories (centre)
    const cat = (key: string, icon: string, label: string, title: string, fn: () => void) => {
      const b = h("button", "cat", `${icon}<span>${label}</span>`);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = () => { fn(); this.sfx.play("click"); };
      this.catBtns.set(key, b);
      return b;
    };
    this.cats.append(
      cat("roads", ICON.roadCat, "Roads", "Roads", () => this.toggleCat("roads")),
      cat("industry", ICON.industry, "Industry", "Industry: extractors, plants and power", () => this.toggleCat("industry")),
      cat("transport", ICON.busCat, "Transport", "Public transport", () => this.toggleCat("transport")),
      h("span", "cat-sep"),
      cat("bulldoze", ICON.bulldoze, "Bulldoze", "Bulldozer (B)", () => app.setTool({ tool: app.st.tool === "bulldoze" ? "inspect" : "bulldoze" })),
    );
    this.undoBtn.innerHTML = ICON.undo + "<span>Undo</span>";
    this.undoBtn.title = "Undo (Ctrl+Z) · full refund";
    this.undoBtn.setAttribute("aria-label", "Undo");
    this.undoBtn.onclick = () => app.undo();
    this.redoBtn.innerHTML = ICON.redo + "<span>Redo</span>";
    this.redoBtn.title = "Redo (Ctrl+Y)";
    this.redoBtn.setAttribute("aria-label", "Redo");
    this.redoBtn.onclick = () => app.redo();
    this.cats.append(this.undoBtn, this.redoBtn);
    // time, speed, demand (right)
    const time = h("div", "bb-time");
    const speeds: [string, () => void, string][] = [
      [ICON.pause, () => app.togglePause(), "Pause (Space)"],
      [ICON.play, () => app.setSpeed(1), "Normal speed (1)"],
      [ICON.fast, () => app.setSpeed(2), "Fast (2)"],
      [ICON.fastest, () => app.setSpeed(4), "Fastest (3)"],
    ];
    for (const [icon, fn, title] of speeds) {
      const b = h("button", "speed-btn", icon);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = fn;
      this.speed.appendChild(b);
    }
    this.wireless = new WirelessControl(app.audio, () => this.sfx.play("click"));
    app.audio.onChange = () => this.wireless.paint();
    time.append(this.wireless.el, this.clockEl, this.speed);
    this.bbar.append(city, this.cats, time);
    this.assets.hidden = true;
    this.toolOpts.hidden = true;
    this.followEl.hidden = true;
    bottom.append(this.followEl, this.toolOpts, this.assets, this.bbar);

    this.panel.hidden = true;
    this.modal.hidden = true;
    this.banner.hidden = true;
    // (news a player doesn't have to act on, like a town grown, is read out without taking the keyboard)
    this.banner.setAttribute("aria-live", "polite");
    this.bannerQ = [];
    this.rectEl.hidden = true;
    this.tut.hidden = true;
    this.seasons.wireClock(this.clockEl);
    this.root.append(tl, tr, bottom, this.chipBox, this.toastBox, this.banner, this.seasons.el, this.seasons.pop, this.rectEl, this.modal);
    // (sound may only start on a click or a key: the browser's rule)
    document.addEventListener("pointerdown", () => this.sfx.unlock());
    document.addEventListener("keydown", () => this.sfx.unlock());
    this.seasons.onShow = (s) => this.sfx.season(SEASONS.indexOf(s));
  }

  // ---------------------------------------------------------------- categories

  /** R and I, and the bar's buttons. */
  catKey(c: CatId) { this.toggleCat(c); }

  /**
   * Every catalog folds to its one-line strip (what is in hand, the tabs) while its tool is held and in use, so the
   * map under the cursor is free (play-test 2026-11-10: the road cards hid the town a road was being drawn to;
   * review 2026-11-10: and the bus cards the street a stop was going on). A works is in use as soon as it is in
   * hand: a click on the map builds it. Roads and Transport put a tool in hand when they open, so theirs is in use
   * once a card is picked or the map clicked. A tab or the category's button brings the cards back for a look.
   */
  private folded(): boolean {
    if (this.catPeek) return false;
    const c = this.cat, app = this.app;
    if (!c || catOf(app.st) !== c) return false;
    return c === "industry" || this.handPicked || app.hasDraft || app.drawingRoad;
  }

  /** A road's first point placed or a bus line begun (the cards fold away), or the draft done with. */
  drawing(on: boolean) {
    if (on) this.catPeek = false;
    if (this.cat) this.refresh();
  }

  /** The catalog's tool used on the map (a stop put down): from now on its cards fold away. */
  used() {
    if (this.handPicked) return;
    this.handPicked = true;
    this.catPeek = false;
    this.refresh();
  }

  private toggleCat(c: CatId) {
    const app = this.app;
    const inHand = catOf(app.st) === c;
    // (hidden with its tool in hand: the button brings the strip back; folded: the cards)
    if (this.cat === c && this.catHidden) { this.catHidden = false; this.sfx.play("open"); this.refresh(); return; }
    if (this.cat === c && this.folded()) { this.catPeek = true; this.refresh(); return; }
    this.catPeek = false;
    this.catHidden = false;
    this.handPicked = false;
    if (this.cat === c) {
      this.cat = null;
      this.sfx.play("close");
      if (inHand) app.setTool({ tool: "inspect" });
      else this.refresh();
      return;
    }
    this.cat = c;
    // Roads picks up the road last drawn, in the drawing mode last used: a road only starts with a click on the map,
    // and costs nothing until its second. Industry puts nothing in hand: there a stray click is a works bought.
    if (c === "roads") app.setTool({ tool: "road", roadType: this.lastRoad, mode: this.lastDraw });
    else if (c === "transport" && app.game.featureUnlocked("transit")) app.setTool({ tool: "transit" });
    // (whatever was in hand is put down: the catalog open with another category's tool armed would lie)
    else if (app.st.tool !== "inspect") { app.setTool({ tool: "inspect" }); this.cat = c; this.refresh(); }
    else this.refresh();
  }

  private pick(a: Asset) {
    const app = this.app;
    this.catPeek = false;
    this.handPicked = true;
    // (a road card is for drawing that road: out of Upgrade, back to the drawing mode last used)
    if (a.kind === "road") { this.lastRoad = a.id; app.setTool({ tool: "road", roadType: a.id, mode: this.lastDraw }); }
    else if (a.kind === "roundabout") app.setTool({ tool: "roundabout", rbSize: a.size });
    else if (a.kind === "junction") app.setTool({ tool: "junction" });
    else if (a.kind === "lane") app.setTool({ tool: "lane" });
    // (a different building starts square to the screen: the last one's turn is not carried over)
    else if (a.kind === "placed") app.setTool({ tool: "place", placed: a.id, ...(app.st.tool === "place" && app.st.placed === a.id ? {} : { placeTurn: 0 }) });
    else if (a.kind === "busstop") app.setTool({ tool: "transit", transitMode: "stop" });
    else app.setTool({ tool: "transit", transitMode: "line" });
    this.sfx.play("click");
  }

  /** The asset a tool state points at (to light its card and open its tab). */
  private current(): Asset | null {
    const st = this.app.st;
    if (st.tool === "road") return { kind: "road", id: st.roadType };
    if (st.tool === "roundabout") return { kind: "roundabout", size: st.rbSize };
    if (st.tool === "junction") return { kind: "junction" };
    if (st.tool === "lane") return { kind: "lane" };
    if (st.tool === "place") return { kind: "placed", id: st.placed };
    if (st.tool === "transit") return { kind: st.transitMode === "stop" ? "busstop" : "busline" };
    return null;
  }

  /**
   * One catalog card: its icon and name, the row under the name that says what it is in pictures (`flow`: what a
   * works takes and makes, a road's lanes and speed), its price (`sub`), what it is in one sentence (`desc`), and the
   * facts the card has no room for (`more`: what its building site needs, the power it draws or makes).
   */
  private assetInfo(a: Asset): { key: string; icon: string; name: string; flow: string; sub: string; desc: string; more: string[]; title: string; locked?: Milestone } {
    const g = this.app.game;
    if (a.kind === "road") {
      const T = ROAD_TYPES[a.id];
      const locked = g.roadsUnlocked.has(a.id) ? undefined : unlockedBy((u) => u.roads?.includes(a.id));
      const n = (k: number) => ["no", "one", "two", "three", "four"][k] ?? String(k);
      const lanes = T.bwd ? `${n(T.fwd)} lane${T.fwd > 1 ? "s" : ""} each way` : `${n(T.fwd)} lane${T.fwd > 1 ? "s" : ""}, one way`;
      const kmh = Math.round(T.speed * 3.6);
      const cost = `${formatMoney(T.costPerM * 10)}/10 m`;
      return {
        key: "road:" + a.id, icon: roadIcon(a.id), name: T.name, sub: cost, locked,
        flow: `<span class="fl-spec">${laneArrows(T.fwd, T.bwd)}${kmh} km/h</span>`,
        title: `${T.name}: ${lanes}, ${kmh} km/h. ${T.hint}`,
        desc: T.hint, more: [],
      };
    }
    if (a.kind === "roundabout") {
      const R = ROUNDABOUTS[a.size];
      const locked = g.featureUnlocked("roundabout") ? undefined : unlockedBy((u) => u.features?.includes("roundabout"));
      const ring = `${ROAD_TYPES[R.type].fwd}-lane ring`;
      return {
        key: "rb:" + a.size, icon: rbIcon(a.size), name: `${R.name} roundabout`, sub: `${R.r * 2} m across`, locked,
        flow: `<span class="fl-spec">${ring}</span>`,
        title: `${R.name} roundabout: ${R.r * 2} m across, ${ring}. Drop it on a junction or a road.`,
        desc: "Drop it on a junction or a road.", more: [],
      };
    }
    if (a.kind === "placed") {
      const S = PLACED[a.id], T = BUILDING_TYPES[a.id];
      const D = PLANTS[a.id];
      const locked = g.placedUnlocked(a.id) ? undefined : unlockedBy((u) => u.buildings?.includes(a.id));
      const site = D.site ? ` Starts as a building site: it needs ${siteText(D.site)} trucked to it.` : "";
      const power = D.power ? ` Draws ${D.power} MW: without power it works at ${Math.round(UNPOWERED * 100)}%.` : D.makes ? ` Makes ${D.makes} MW for the buildings on its roads within ${D.reach! / 1000} km that draw power.` : "";
      // (the card says the price alone: with the upkeep beside it, it wrapped onto two lines on a narrow card; the
      // upkeep is named on the line, since "$8,000 · $12/h" did not say whether it was earned or spent)
      const price = formatMoney(S.cost);
      const more: string[] = [`Upkeep ${formatMoney(S.upkeep)}/h`];
      if (D.site) more.push(`Site needs ${siteShort(D.site)}`);
      if (D.power) more.push(`Draws ${D.power} MW`);
      else if (D.makes) more.push(`Makes ${D.makes} MW`);
      return {
        key: "placed:" + a.id, icon: placedIcon(a.id), name: T.name, sub: price, locked,
        flow: flowIcons(a.id),
        title: `${T.name}: ${chainText(a.id)}. ${T.blurb}${site}${power} Costs ${formatMoney(S.cost)}, upkeep ${formatMoney(S.upkeep)} an hour plus its ${T.jobs} workers' wages.`,
        desc: T.blurb, more,
      };
    }
    if (a.kind === "lane") {
      return {
        key: "lane", icon: ICON.lane, name: "Add lane", sub: "Free", flow: `<span class="fl-spec">Turn and slip lanes</span>`,
        title: "Add lane (L): click a road just before a junction for a turn lane, nearer the middle for left turns, nearer the kerb for right turns. On a highway, click before an exit or after an entry to lengthen its slip lane. Shift or right click removes a turn lane.",
        desc: "Click a road just before a junction for a turn lane.", more: ["Shift or right click removes one"],
      };
    }
    if (a.kind === "busstop" || a.kind === "busline") {
      const locked = g.featureUnlocked("transit") ? undefined : unlockedBy((u) => u.features?.includes("transit"));
      return a.kind === "busstop"
        ? { key: "busstop", icon: ICON.busStop, name: "Bus stop", sub: formatMoney(STOP_COST), flow: `<span class="fl-spec">On a kerb</span>`, title: `Bus stop: put it on the kerb of a street, on the side the buses will stop. ${formatMoney(STOP_COST)}.`, desc: "Goes on a street's kerb, on the side the buses stop.", more: [], locked }
        : { key: "busline", icon: ICON.busLine, name: "Bus line", sub: `${formatMoney(BUS_UPKEEP)}/h a bus`, flow: `<span class="fl-spec">Stop to stop</span>`, title: `Bus line: click stops in the order the buses visit them, then the first again to close the loop. Each bus costs ${formatMoney(BUS_UPKEEP)} an hour, and riders pay a fare.`, desc: "Click the stops in order, then the first again to close the loop.", more: [], locked };
    }
    const locked = g.featureUnlocked("signals") ? undefined : unlockedBy((u) => u.features?.includes("signals"));
    return { key: "junction", icon: ICON.junction, name: "Traffic lights", sub: formatMoney(SIGNAL_COST), flow: `<span class="fl-spec">At a junction</span>`, title: "Traffic lights: click a junction to add lights or edit their phases", desc: "Click a junction to add lights or edit their phases.", more: [], locked };
  }

  /**
   * The catalog above the bar (play-test 2026-11-09, A5, C7, D1): the cards, one line that reads out the card under
   * the pointer (or the one in hand), and under them the strip with the tabs. The strip is the part that never
   * moves: the window grows upward from it, so a tab is at the same place on the screen whichever tab is open and
   * however many rows it holds. With a building in hand the cards fold away and only the line and the strip stay.
   */
  private renderAssets() {
    const c = this.cat, el = this.assets;
    const cur = this.current();
    const inHand = c && cur && catOf(this.app.st) === c ? cur : null;
    if (!c || (inHand && this.catHidden)) { el.hidden = true; this.lastAssets = ""; this.hoverKey = ""; return; }
    const curKey = inHand ? this.assetInfo(inHand).key : "";
    const C = CATS[c];
    // follow the tool to its tab (keyboard, right click, loading)
    if (inHand) {
      const t = C.tabs.find((t) => t.assets.some((a) => this.assetInfo(a).key === curKey));
      if (t && this.followKey !== curKey) this.tab[c] = t.id;
    }
    this.followKey = curKey;
    const tab = C.tabs.find((t) => t.id === this.tab[c]) ?? C.tabs[0];
    const infos = tab.assets.map((a) => ({ a, ...this.assetInfo(a) }));
    const folded = this.folded();
    const sig = [c, tab.id, curKey, folded, infos.map((i) => i.key + (i.locked ? "L" : "") + i.sub).join()].join("|");
    el.hidden = false;
    if (sig === this.lastAssets) return;
    this.lastAssets = sig;
    const fa = document.activeElement;
    const focusKey = fa instanceof HTMLElement && el.contains(fa) ? fa.dataset.key : null;
    el.innerHTML = "";
    el.classList.toggle("folded", folded);
    this.hoverKey = "";
    // ---- the line: the card under the pointer, else the one in hand, in one sentence and what the card can't show
    // (nothing in hand and nothing under the pointer: the line stays empty. It used to say how to use the catalog)
    const lay = catalogLayout(infos.length);
    // (wide plates say what each is on the card: the line only adds what they leave out, or stands down)
    const showDesc = folded || !lay.wide;
    const hasLine = showDesc || infos.some((x) => x.more.length || x.locked);
    const read = h("p", "as-read");
    const held = inHand ? this.assetInfo(inHand) : null;
    const say = () => {
      const i = infos.find((x) => x.key === this.hoverKey) ?? held;
      if (!i) {
        // (a category still locked says what opens it, on the line: the Transport button used to do nothing at all)
        const lk = infos.every((x) => x.locked) ? infos[0]?.locked : undefined;
        read.innerHTML = lk ? `<span class="as-lock">${ICON.lock} ${C.label === "Transport" ? "Buses unlock" : "Unlocks"} with the goal ${escapeHtml(lk.name)}</span>` : "";
        return;
      }
      // (what opens a locked card comes straight after its name: last on the line, a narrow screen cut it off)
      const bits = [
        ...(i.locked ? [`<span class="as-lock">${ICON.lock} Unlocks with the goal ${escapeHtml(i.locked.name)}</span>`] : []),
        ...(showDesc ? [`<span class="as-say" title="${escapeHtml(i.desc)}">${escapeHtml(i.desc)}</span>`] : []),
        ...(folded ? [`<span class="num">${i.sub}</span>`] : []),
        ...i.more.map((m) => `<span>${escapeHtml(m)}</span>`),
      ];
      read.innerHTML = `<b>${escapeHtml(i.name)}</b>${bits.join("")}`;
    };
    // ---- the strip: the category, its tabs, close
    const head = h("header", "as-head");
    const tabs = h("div", "as-tabs");
    tabs.setAttribute("role", "tablist");
    for (const t of C.tabs) {
      const b = h("button", "as-tab", t.label);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t === tab && !folded));
      b.dataset.key = "tab:" + t.id;
      b.classList.toggle("on", t === tab && !folded);
      // (a tab clicked while the cards are folded away brings them back)
      b.onclick = () => { this.tab[c] = t.id; this.catPeek = true; this.renderAssets(); this.sfx.play("click"); };
      tabs.appendChild(b);
    }
    const close = h("button", "close", ICON.close);
    close.setAttribute("aria-label", `Close ${C.label}`);
    close.title = `Close ${C.label}`;
    close.dataset.key = "close";
    close.onclick = () => {
      this.catPeek = false;
      this.cat = null;
      this.sfx.play("close");
      if (catOf(this.app.st) === c) this.app.setTool({ tool: "inspect" });
      else this.refresh();
    };
    // (put the catalog out of sight and keep the tool: the category's button or key brings it back)
    const key = c === "roads" ? "R" : c === "industry" ? "I" : "";
    const hide = inHand ? h("button", "as-hide", `Hide ${ICON.caret}`) : null;
    if (hide) {
      hide.dataset.key = "hide";
      hide.title = `Hide the catalog; the ${held!.name} stays in hand${key ? ` (${key} brings it back)` : ""}`;
      hide.setAttribute("aria-label", `Hide ${C.label}, keep the ${held!.name} in hand`);
      hide.onclick = () => { this.catHidden = true; this.catPeek = false; this.sfx.play("close"); this.refresh(); };
    }
    head.append(h("b", "as-title", C.label), tabs, ...(hide ? [hide] : []), close);
    if (!folded) {
      // (the cards are fitted to the window: a few become wide plates that say what each is, more share the row,
      // and a long tab is split into even rows. catalog.ts; a short tab left most of the window empty)
      const cards = h("div", "as-cards" + (lay.wide ? " wide" : ""));
      cards.style.setProperty("--cols", String(lay.cols));
      for (const i of infos) {
        const sub = `<span class="as-sub">${i.locked ? `${ICON.lock} ${escapeHtml(lockShort(i.locked))}` : i.sub}</span>`;
        const b = h("button", "asset", lay.wide
          ? `<span class="as-top"><span class="as-icon">${i.icon}</span><b>${i.name}</b></span><span class="as-desc">${escapeHtml(i.desc)}</span><span class="as-foot"><span class="as-flow">${i.flow}</span>${sub}</span>`
          : `<span class="as-icon">${i.icon}</span><b>${i.name}</b><span class="as-flow">${i.flow}</span>${sub}`);
        b.dataset.key = i.key;
        const on = i.key === curKey;
        b.classList.toggle("on", on);
        b.classList.toggle("locked", !!i.locked);
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("aria-label", i.locked ? `${i.name}, locked. Unlocks with the goal ${i.locked.name}: ${i.locked.goal}` : i.title);
        // (a locked card is not pressed, but it can still be read: the pointer and the keyboard reach it)
        b.setAttribute("aria-disabled", String(!!i.locked));
        const over = (k: string) => { if (this.hoverKey !== k) { this.hoverKey = k; say(); } };
        b.onpointerenter = () => over(i.key);
        b.onpointerleave = () => { if (this.hoverKey === i.key) over(""); };
        b.onfocus = () => over(i.key);
        b.onblur = () => { if (this.hoverKey === i.key) over(""); };
        b.onclick = () => { if (!i.locked) this.pick(i.a); };
        cards.appendChild(b);
      }
      el.append(cards);
    }
    say();
    el.append(...(hasLine ? [read] : []), head);
    if (focusKey) el.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }
  private followKey = "";

  // ---------------------------------------------------------------- refresh

  refresh() {
    const app = this.app, g = app.game, st = app.st;
    if (!g) return;
    const tc = catOf(st);
    // (another catalog's tool taken up by key: its cards start open, as from its button)
    if (tc && this.cat !== tc) { this.handPicked = false; this.catHidden = false; this.catPeek = false; }
    if (tc) this.cat = tc;
    else if (st.tool !== "inspect") this.cat = null;
    // (nothing of the catalog's in hand: nothing to fold for or to hide behind)
    if (!tc) { this.handPicked = false; this.catHidden = false; }
    if (st.tool === "road") this.lastRoad = st.roadType;
    if (st.tool === "road" && st.mode !== "replace") this.lastDraw = st.mode;
    for (const [k, b] of this.catBtns) {
      const on = k === "bulldoze" ? st.tool === "bulldoze" : this.cat === k;
      b.classList.toggle("on", on);
      b.setAttribute(k === "bulldoze" ? "aria-pressed" : "aria-expanded", String(on));
    }
    for (const [k, b] of this.tlBtns) {
      const on = k === "info" ? this.winKind === "info" || app.overlay !== "none" : this.winKind === k;
      b.classList.toggle("on", on);
    }
    this.syncCompany();
    this.undoBtn.disabled = !g.canUndo();
    this.redoBtn.disabled = !g.canRedo();
    const sb = this.speed.children;
    const sp = g.paused ? 0 : g.speed === 1 ? 1 : g.speed === 2 ? 2 : 3;
    for (let i = 0; i < sb.length; i++) {
      sb[i].classList.toggle("on", i === sp);
      sb[i].setAttribute("aria-pressed", String(i === sp));
    }
    this.renderAssets();
    this.renderToolOpts();
    this.tick(true);
    // (the view was flipped: the pause menu's button and the camera menu say which is on)
    if (this.camShow && !this.modal.hidden && this.modal.querySelector(".camview")) this.camShow();
    if (this.winKind === "camera" && this.camShown !== app.camView) this.fillCamera();
  }
  private camShown = "";

  // ---------------------------------------------------------------- tool options

  private renderToolOpts() {
    const app = this.app, st = app.st;
    const el = this.toolOpts;
    const fa = document.activeElement;
    const focusKey = fa instanceof HTMLElement && el.contains(fa) ? fa.getAttribute("aria-label") : null;
    el.innerHTML = "";
    const sec = (title: string, ...kids: HTMLElement[]) => {
      const s = h("div", "to-sec");
      s.append(h("span", "to-label", title), ...kids);
      return s;
    };
    const seg = (items: { html: string; on: boolean; title: string; label?: string; fn: () => void; cls?: string; disabled?: boolean }[], cls = "") => {
      const w = h("div", "seg " + cls);
      for (const it of items) {
        const b = h("button", "seg-btn " + (it.cls ?? ""), it.html);
        b.classList.toggle("on", it.on);
        b.setAttribute("aria-pressed", String(it.on));
        b.title = it.title;
        // (the tooltip can run long: a short name for screen readers when there is one)
        b.setAttribute("aria-label", it.label ?? it.title);
        b.disabled = !!it.disabled;
        b.onclick = () => { it.fn(); this.sfx.play("click"); };
        w.appendChild(b);
      }
      return w;
    };
    const stepper = (value: string, cls: string, down: () => void, up: () => void, labels: [string, string], dis: [boolean, boolean]) => {
      const w = h("div", "stepper " + cls);
      const a = h("button", "seg-btn", "−"), v = h("span", "st-val", value), b = h("button", "seg-btn", "+");
      a.title = labels[0]; a.setAttribute("aria-label", labels[0]); a.disabled = dis[0]; a.onclick = () => { down(); this.sfx.play("click"); };
      b.title = labels[1]; b.setAttribute("aria-label", labels[1]); b.disabled = dis[1]; b.onclick = () => { up(); this.sfx.play("click"); };
      w.append(a, v, b);
      return w;
    };
    // (a dirt road stays on the ground: its bridges are built paved, on their own)
    const ground = st.tool === "road" && !!ROAD_TYPES[st.roadType].unpaved;
    const elevation = () => sec("Elevation", stepper(st.level === 0 ? "Ground" : `${st.level * LEVEL_H} m`, "lvl lvl" + st.level,
      () => app.setLevel(st.level - 1), () => app.setLevel(st.level + 1), ["Lower (Page Down)", ground ? "Dirt roads stay on the ground: bridges on them are built paved" : "Raise (Page Up)"], [st.level <= 0, st.level >= MAX_LEVEL || (ground && st.level === 0)]));
    const items: HTMLElement[] = [];
    if (st.tool === "road") {
      const T = ROAD_TYPES[st.roadType];
      const MODE: Record<RoadMode, { icon: string; title: string; label: string }> = {
        curve: { icon: ICON.curve, label: "Curve", title: "Curve: click the start; the road bends after the cursor, leaving its start smoothly. Click to set the end and carry on; right click ends the chain" },
        straight: { icon: ICON.straight, label: "Straight", title: "Straight: click the start, then the end; carries on from the end" },
        replace: { icon: ICON.replace, label: "Upgrade", title: "Upgrade: click a road to change it to this type" },
      };
      items.push(sec("Mode", seg(ROAD_MODES.map((m) => ({ html: MODE[m].icon, on: st.mode === m, title: MODE[m].title + " (Tab)", label: `${MODE[m].label} mode`, fn: () => app.setTool({ mode: m }) })))));
      if (st.mode === "replace") {
        items.push(sec("Upgrade", seg([
          { html: "Type", on: !st.reverse, title: `Turn a road into ${T.name}`, fn: () => app.setTool({ reverse: false }) },
          { html: "Reverse", on: st.reverse, title: "Flip a one-way road (Shift+click)", fn: () => app.setTool({ reverse: true }) },
        ])));
      } else {
        const off = Math.round(app.parallelOffset());
        const par = seg([{ html: ICON.parallel, on: st.parallel, title: T.bwd === 0 ? "Parallel: also build the opposite carriageway" : "Parallel: also build a second road alongside", fn: () => app.setTool({ parallel: !st.parallel }) }]);
        items.push(st.parallel
          ? sec("Parallel", par, stepper(`${off} m`, "", () => app.nudgeParallel(-1), () => app.nudgeParallel(1), ["Closer ([)", "Further apart (])"], [false, false]))
          : sec("Parallel", par));
        items.push(elevation());
        const snap = h("div", "snaps");
        const opts: { k: "geometry" | "guides" | "netSide" | "length" | "angle"; label: string; on: boolean }[] = [
          { k: "geometry", label: "Roads", on: !st.snapOff.geometry },
          { k: "guides", label: "Guidelines", on: !st.snapOff.guides },
          { k: "netSide", label: "Parallels", on: !st.snapOff.netSide },
          { k: "length", label: "8 m lengths", on: st.snapLength },
          { k: "angle", label: "15° angles", on: st.angleLock },
        ];
        for (const o of opts) {
          const l = h("label", "snap-row", `<input type="checkbox" ${o.on ? "checked" : ""}><span>${o.label}</span>`);
          const cb = l.querySelector("input")!;
          l.title = SNAP_HELP[o.k];
          cb.setAttribute("aria-label", o.k === "angle" ? "Lock road angles to 15 degree steps" : `Snap to ${o.label.toLowerCase()}`);
          cb.onchange = () => {
            if (o.k === "angle") app.setTool({ angleLock: cb.checked });
            else if (o.k === "length") app.setTool({ snapLength: cb.checked });
            else app.setTool({ snapOff: { ...st.snapOff, [o.k]: !cb.checked } });
          };
          snap.appendChild(l);
        }
        items.push(sec("Snapping", snap));
      }
    } else if (st.tool === "place" && isPlantKind(st.placed)) {
      const D = PLANTS[st.placed];
      // (the keys to turn it, and the ground it needs: the rest is at the pointer as it moves, and in the catalog's
      // line. Its own street to the road is said at the pointer, with its length)
      items.push(sec("Turn", h("p", "to-keys", `<kbd>,</kbd><kbd>.</kbd><span>or Shift + wheel</span>`)));
      if (D.deposit) items.push(sec("Needs", h("p", "to-keys", `${cap(D.deposit.name)} on ${Math.round(MIN_DEPOSIT * 100)}% of its plot or more`)));
    } else if (st.tool === "roundabout") {
      items.push(elevation());
    } else if (st.tool === "bulldoze") {
      items.push(sec("Elevation", seg([null, 0, 1, 2, 3].map((l) => ({
        html: l === null ? "All" : l === 0 ? "Ground" : `${l * LEVEL_H} m`, on: st.bdzLevel === l, title: l === null ? "Remove roads at any height" : `Only remove roads at ${l === 0 ? "ground level" : `${l * LEVEL_H} m`}`, fn: () => app.setTool({ bdzLevel: l }),
      })), "wrap")));
    }
    // (traffic lights and turn lanes have no options: what to click is in the catalog's line. The card still shows
    // for the notes about the click the pointer's one line leaves out, while there are some)
    const notesOnly = !items.length && (st.tool === "junction" || st.tool === "lane");
    this.toolNotesOnly = notesOnly;
    if (!items.length && !notesOnly) { el.hidden = true; return; }
    el.hidden = notesOnly && this.readEl.hidden;
    el.append(h("header", "to-head", "Tool options"), ...items, this.readEl);
    if (focusKey) [...el.querySelectorAll<HTMLElement>("[aria-label]")].find((e) => e.getAttribute("aria-label") === focusKey)?.focus();
  }

  /**
   * The camera control by the top-left buttons: a small block seen exactly as the camera sees the map (it turns
   * with it, and shows its sides as the camera tilts; from straight above it is a plain square), brick on its north
   * side, so the view reads at a glance. A click is M (the Map view and back); dragging it turns and tilts the
   * camera, for a touchpad with no middle button.
   */
  private buildViewBtn(row: HTMLElement) {
    const app = this.app, b = this.viewBtn;
    b.type = "button";
    b.innerHTML = `<span class="vg" aria-hidden="true"><span class="vg-cube"><i class="vg-top"></i><i class="vg-n"></i><i class="vg-s"></i><i class="vg-e"></i><i class="vg-w"></i></span></span><span class="tlb-l">Map</span>`;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    let dragged = false;
    b.onpointerdown = (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      dragged = false;
      b.setPointerCapture(e.pointerId);
    };
    b.onpointermove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = dragged = true;
      drag.x = e.clientX; drag.y = e.clientY;
      b.classList.add("dragging");
      app.orbitBy(dx, dy);
    };
    const end = (e: PointerEvent) => {
      if (!drag) return;
      if (drag.moved) app.settleView();
      drag = null;
      b.classList.remove("dragging");
      if (b.hasPointerCapture(e.pointerId)) b.releasePointerCapture(e.pointerId);
    };
    b.onpointerup = end;
    b.onpointercancel = end;
    b.onclick = () => {
      // (the click that ends a drag is not a press)
      if (dragged) { dragged = false; return; }
      this.sfx.play("click");
      app.toggleMapView();
    };
    row.appendChild(b);
    this.cameraPose(app.view.rot, app.view.tilt);
  }

  /** Every frame: the camera control and the north arrow follow the camera (they write only when it has moved). */
  cameraPose(rot: number, tilt: number) {
    this.compassAngle(rot);
    const map = this.app.camView === "map";
    const key = `${rot.toFixed(2)}|${tilt.toFixed(2)}|${map}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    const b = this.viewBtn;
    (b.querySelector(".vg-cube") as HTMLElement).style.transform = `rotateX(${tilt.toFixed(3)}rad) rotateZ(${(-rot).toFixed(3)}rad)`;
    b.classList.toggle("map", map);
    b.setAttribute("aria-pressed", String(map));
    b.setAttribute("aria-label", "Map view");
    b.title = map
      ? "Camera: Map view. Click for the Diorama (M). Drag sideways to turn the map, up to tilt it."
      : "Camera: Diorama. Click for the Map view, straight down (M). Drag to turn and tilt (or the middle button, Q / E, Y / H).";
  }

  compassAngle(rot: number) {
    if (Math.abs(rot - this.compassRot) < 1e-4) return;
    this.compassRot = rot;
    const turned = Math.abs(Math.atan2(Math.sin(rot), Math.cos(rot))) > 0.01;
    this.compass.hidden = !turned;
    (this.compass.firstElementChild as HTMLElement | null)?.style.setProperty("transform", `rotate(${-rot}rad)`);
  }

  private clockShown = "";

  /** The clock, minute by minute (every frame: it writes only when the minute shown changes). */
  clock() {
    const g = this.app.game;
    if (!g) return;
    const hr = g.hour, txt = clockText(hr);
    if (txt === this.clockShown) return;
    this.clockShown = txt;
    const b = this.clockEl.firstElementChild;
    if (b) b.textContent = txt;
    this.clockEl.classList.toggle("night", hr < 6 || hr >= 21);
  }

  /** Cheap periodic update: the bar, tips, open panels. */
  tick(force = false) {
    const g = this.app.game;
    if (!g) return;
    const st = g.people.stats;
    const pop = `${ICON.people}<span class="cb-pop-n"><b>${fmtNum(st.population)}</b><small>${g.towns.list.length === 1 ? "people" : "in all towns"}</small></span>`;
    if (this.popEl.dataset.k !== pop) { this.popEl.dataset.k = pop; this.popEl.innerHTML = pop; }
    const net = g.netIncome;
    this.moneyBtn.innerHTML = `<b class="${g.money < 0 ? "bad" : ""}">${formatMoney(Math.round(g.money))}</b><span class="${moneyTone(net)}">${signed(net)}/h</span>`;
    this.moneyBtn.setAttribute("aria-label", `Money ${formatMoney(Math.round(g.money))}, ${signed(net)} per hour. Open economy`);
    const season = seasonLine(g.time);
    if (this.clockEl.dataset.k !== season) {
      this.clockEl.dataset.k = season;
      this.clockEl.innerHTML = `<b></b>${season}`;
      // (the season popover says what the tooltip did, and more)
      this.clockEl.querySelector(".cb-season")?.removeAttribute("title");
      this.clockShown = "";
    }
    this.clock();
    this.seasons.tick(!this.banner.hidden || this.bannerQ.length > 0);
    this.renderTips();
    this.ledger.observe(g);
    if (this.sel) this.fillSel();
    if (this.winKind) this.fillWin();
  }

  /**
   * The Goals card (top right): the milestones open now, how far along each is and what it unlocks, with a next step
   * underneath while there is an obvious one. It folds to its header; it steps aside while a panel is open there.
   */
  private renderTips() {
    const g = this.app.game;
    if (this.app.mode !== "play") { this.tut.hidden = true; this.hint(null); return; }
    if (this.sel) { this.goalStrip(); return; }
    const prefs = this.tipPrefs;
    const open = g.progress.open();
    // (with every goal reached the card lists the towns' shortfalls itself: the tip that says the same stands down)
    // (and a tip that says to take in hand the works already in hand: the tool options say how to place it)
    const st = this.app.st, inHand = (id: string) => st.tool === "place" && st.placed === id;
    const tip = prefs.off ? null : tipFor(g, (id) => prefs.dismissed.has(id) || (id === "ceiling" && !open.length) || ((id === "farm" || id === "foodplant") && inHand(id)), this.app.stuckAlerts.count);
    this.tut.hidden = false;
    const v = g.progressView();
    const folded = this.tutHidden;
    // (a goal that waits on a first load says what the chain is doing now and when its first truck leaves: the
    // works' own status, so the wait counts down here as it does in its panel. Owner, 2026-11-10. One line: the state
    // in bold, the one thing to do after it, and a missing link's chain on a line of its own)
    const nowLine = (now: ReturnType<typeof goalNow>, one = false) => {
      if (!now) return "";
      const say = goalNowSay(now);
      const go = now.works !== undefined ? ` data-id="${now.works}"` : now.spot ? ` data-spot="${Math.round(now.spot.x)},${Math.round(now.spot.y)}"` : " disabled";
      const tip = [one ? [say, now.more].filter(Boolean).join(" ") : now.more, now.works !== undefined ? "Click to show it" : now.spot ? "Click to fly there" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="gl-now${one ? " gl-now-one" : ""} ${now.tone}"${go}${tip ? ` title="${escapeHtml(tip)}"` : ""} aria-label="${escapeHtml(say)}"><span class="gl-now-t">${now.key === "Where" ? `${escapeHtml(now.text).replace(/^(Place an? )(.+?)( on | in )/, "$1<b>$2</b>$3")}.` : `<b>${escapeHtml(lineOf(now))}.</b>`}${now.fix ? ` ${escapeHtml(now.fix)}${/[.!?]$/.test(now.fix) ? "" : "."}` : ""}${now.where ? ` ${escapeHtml(now.where)}.` : ""}${now.chain && !one ? `<span class="gl-chain">${escapeHtml(now.chain)}</span>` : ""}</span></button>`;
    };
    // (folded, the card is its header and one line under it: the goal at hand, how far along, and what its chain is
    // doing now, cut to two lines and whole on hover. Review 2026-11-10: the full card stood over the map all game,
    // and folding it hid the goal too)
    let fold = `<span class="gl-count">${g.progress.done.length} of ${MILESTONES.length}</span>`;
    let body = `<div id="gl-body" hidden></div>`;
    if (folded && open[0]) {
      const m = open[0], [have, need] = m.measure(v), now = goalNow(g, m, have);
      fold = `<span class="gl-fold"><b>${escapeHtml(m.name)}</b><span class="num">${measureText(m, have, need)}</span></span>`;
      body = `<div id="gl-body" class="gl-one">${now ? nowLine(now, true) : `<p class="gl-goal">${escapeHtml(m.goal)}</p>`}</div>`;
    } else if (folded) {
      // (every goal reached: the long project, and how it is going)
      const lp = longProject(g);
      if (lp) {
        fold = `<span class="gl-fold"><b>${escapeHtml(lp.name)}</b><span class="num">${escapeHtml(lp.measure)}</span></span>`;
        body = `<div id="gl-body" class="gl-one">${this.projNow(g, lp, true)}</div>`;
      }
    }
    const foldName = folded ? /<b>([^<]*)<\/b>/.exec(fold)?.[1] : undefined;
    const head = `<button class="gl-head" aria-expanded="${!folded}" aria-controls="gl-body" title="${foldName ? `${foldName}. Click for the whole card` : "Fold the card to one line"}"><b>Goals</b>${fold}<span class="gl-caret">${ICON.caret}</span></button>`;
    let tipShown = tip;
    if (!folded) {
      // (the goal at hand in full: what it asks, how far along, what its chain is doing, what it brings. The other open
      // goals one line each, with their own line under them only when something holds them. docs/ui-words.md)
      // (a later goal's line on a chain an earlier one already speaks for stays quiet: the planks the held hamlet
      // waits for and the first planks are one chain, said once)
      const said = new Set<string>();
      const nows = open.map((m) => {
        const [have] = m.measure(v), n = goalNow(g, m, have);
        if (n?.p && said.has(n.p)) return null;
        if (n?.p) said.add(n.p);
        return n;
      });
      const items = open.map((m, i) => {
        const [have, need] = m.measure(v);
        const p = Math.max(0, Math.min(1, have / need));
        const bar = `<span class="bar gl-bar" role="progressbar" aria-label="${m.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><i style="width:${Math.max(2, p * 100)}%"></i></span>`;
        const gifts = unlockList(m.unlocks).join(" · ");
        if (i > 0) return `<li class="gl-more" title="${escapeHtml(`${m.goal}. Unlocks ${gifts}`)}"><div class="gl-top"><b>${m.name}</b><span class="num">${measureText(m, have, need)}</span></div>${bar}${nowLine(nows[i])}</li>`;
        return `<li><div class="gl-top"><b>${m.name}</b><span class="num">${measureText(m, have, need)}</span></div>
          <p class="gl-goal">${m.goal}</p>${bar}
          ${nowLine(nows[i])}<p class="gl-gift"><span class="gl-gift-k">Unlocks</span> ${gifts}</p></li>`;
      }).join("");
      // (a tip on the chain a goal's line already speaks for stands down: one place per fact)
      if (tip?.p && nows.some((n) => n?.p === tip.p)) tipShown = null;
      // (the road offered under the pointer stays drawn only while its button is still there, for that works)
      if (this.app.offerFor !== null && tipShown?.road?.works !== this.app.offerFor) this.app.offerFor = null;
      const roadBtn = tipShown?.road ? ` <button type="button" class="btn gl-act" data-id="${tipShown.road.works}"${g.money < tipShown.road.cost ? ` disabled title="More than you have now"` : ""}>Build this road · ${formatMoney(tipShown.road.cost)}</button>` : "";
      body = `<div id="gl-body">${items ? `<ol class="gl-list">${items}</ol>` : this.afterGoals()}${tipShown ? `<div class="gl-tip" data-tip="${tipShown.id}"><p>${tipShown.html}${roadBtn}</p><button class="gl-x" aria-label="Dismiss this tip" title="Dismiss this tip (Pause › Tips turns them all off)">${ICON.close}</button></div>` : ""}</div>`;
    }
    const html = head + body;
    if (this.tut.dataset.html !== html) {
      const hadFocus = this.tut.contains(document.activeElement);
      this.tut.dataset.html = html;
      this.tut.innerHTML = html;
      const btn = this.tut.querySelector(".gl-head") as HTMLButtonElement;
      btn.onclick = () => { this.tutHidden = !this.tutHidden; this.sfx.play("click"); this.renderTips(); };
      const x = this.tut.querySelector<HTMLButtonElement>(".gl-x");
      if (x && tipShown) x.onclick = () => { prefs.dismiss(tipShown.id); this.sfx.play("click"); this.renderTips(); this.tut.querySelector<HTMLButtonElement>(".gl-head")?.focus({ preventScroll: true }); };
      for (const n of this.tut.querySelectorAll<HTMLButtonElement>(".gl-now[data-id]")) n.onclick = () => {
        const b = g.buildings.byId.get(+n.dataset.id!);
        if (!b) return;
        this.sfx.play("click");
        this.app.setTool({ tool: "inspect" });
        this.app.glideTo(b.c, Math.min(this.app.view.halfH, CHIP_HALF_H), 1);
        this.openBuilding(b);
      };
      const act = this.tut.querySelector<HTMLButtonElement>(".gl-act[data-id]");
      if (act) {
        const id = +act.dataset.id!;
        act.onclick = () => this.buildRoadTo(id);
        // (the road it would lay shows dashed on the map while the button is under the pointer)
        act.onpointerenter = act.onfocus = () => { this.app.offerFor = id; };
        act.onpointerleave = act.onblur = () => { if (this.app.offerFor === id) this.app.offerFor = null; };
      }
      for (const n of this.tut.querySelectorAll<HTMLButtonElement>(".gl-now[data-spot]")) n.onclick = () => {
        const [x, y] = n.dataset.spot!.split(",").map(Number);
        this.sfx.play("click");
        this.app.flyTo({ x, y }, Math.max(this.app.view.halfH, 420));
      };
      if (hadFocus && !this.tut.contains(document.activeElement)) btn.focus({ preventScroll: true });
    }
    // (a tip that stands down for a goal line still lights its category: the goal line says what to build there)
    this.hint(folded ? null : tip?.cat ?? null);
  }

  /**
   * While a panel stands where the Goals card was, the goal stays in view as one line over it (design audit
   * 2026-11-10, F01: the first farm's panel took the card's place, and with it the goal and the next step): the goal
   * and how far along it is, and under it what the chain is doing now when there is something (the goal line's own
   * words, cut to one line). Click it to put the panel away and see the card.
   */
  private goalStrip() {
    const g = this.app.game, m = g.progress.open()[0];
    this.hint(null);
    if (!m) { this.tut.hidden = true; this.tut.dataset.html = ""; return; }
    const [have, need] = m.measure(g.progressView());
    const now = goalNow(g, m, have);
    // (a missing link of the chain says what to build too, wrapping as it needs: design audit 2026-11-10, F01)
    const text = !now ? "" : now.link && now.fix ? `${lineOf(now)}. ${now.fix}${/[.!?]$/.test(now.fix) ? "" : "."}` : `${lineOf(now)}.`;
    const full = `${m.name}: ${m.goal}, ${measureText(m, have, need)}.${now ? ` ${goalNowSay(now)}` : ""}`;
    const nowRow = now ? `<span class="gl-strip-t ${now.tone}${now.link ? " wrap" : ""}">${escapeHtml(text)}</span>` : "";
    const html = `<button type="button" class="gl-strip" title="${escapeHtml(full)} Click to see your goals." aria-label="${escapeHtml(full)} Show the goals"><span class="gl-strip-t"><b>${escapeHtml(m.goal)}</b></span><span class="num">${measureText(m, have, need)}</span>${nowRow}</button>`;
    this.tut.hidden = false;
    if (this.tut.dataset.html === html) return;
    this.tut.dataset.html = html;
    this.tut.innerHTML = html;
    this.tut.querySelector<HTMLButtonElement>(".gl-strip")!.onclick = () => { this.sfx.play("click"); this.closeSelection(); };
    // (the panel under it gives up the strip's height, whatever it wraps to)
    this.tut.parentElement?.style.setProperty("--strip-h", `${this.tut.offsetHeight}px`);
  }

  /**
   * Under the Goals card once every goal is reached (play-test 2026-11-09, E2: "nothing to aim at"): what the towns
   * are short of, the biggest first, each turned into works to build.
   */
  private afterGoals(): string {
    const g = this.app.game, lp = longProject(g);
    if (lp) {
      const means = lp.means.map((j) => `<li><div class="gl-top"><b>${escapeHtml(j.head)}</b></div><p class="gl-goal gl-job">${escapeHtml(j.say)}</p></li>`).join("");
      return `<ol class="gl-list gl-proj"><li><div class="gl-top" title="Every goal reached. The long project"><b>${escapeHtml(lp.name)}</b><span class="num">${escapeHtml(lp.measure)}</span></div>
        <span class="bar gl-bar" role="progressbar" aria-label="${escapeHtml(lp.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lp.p * 100)}"><i style="width:${Math.max(2, lp.p * 100)}%"></i></span>
        ${this.projNow(g, lp)}</li></ol>
        ${means ? `<p class="gl-means-k">To get there</p><ol class="gl-list gl-means">${means}</ol>` : `<p class="gl-done">Nothing holds it back: it gets there by itself, a little every day.</p>`}
        ${lp.ahead ? `<p class="gl-ahead">${escapeHtml(lp.ahead)}</p>` : ""}`;
    }
    const jobs = shortfalls(g);
    if (!jobs.length) return `<p class="gl-done">Every goal reached, and every town has what it needs. Grow them on: the next size asks for more.</p>`;
    const items = jobs.map((j) => `<li><div class="gl-top"><b>${PRODUCTS[j.p].name}</b><span class="num">${fmtNum(j.more)} more ${j.more === 1 ? "load" : "loads"} a day</span></div>
      <p class="gl-goal gl-job">${escapeHtml(j.say)}</p></li>`).join("");
    return `<p class="gl-done">Every goal reached. Now the towns set the work:</p><ol class="gl-list">${items}</ol>`;
  }

  /** The long project's line under its bar: how it is going; a click flies to the town or the site. */
  private projNow(g: Game, lp: LongProject, one = false): string {
    const t = lp.town !== undefined ? g.towns.byId.get(lp.town) : undefined;
    const at = lp.works !== undefined ? ` data-id="${lp.works}" title="Show it on the map"` : t ? ` data-spot="${Math.round(t.c.x)},${Math.round(t.c.y)}" title="Fly there"` : " disabled";
    return `<button type="button" class="gl-now${one ? " gl-now-one" : ""}${lp.bad ? " bad" : ""}"${at}><span class="gl-now-t">${escapeHtml(lp.state)}.</span></button>`;
  }

  /** The notes at the foot of the tool options card (only redrawn when they change: the pointer moves every frame). */
  private notes(list: Chip[]) {
    const key = list.map((c) => `${c.kind}:${c.text}`).join("|");
    if (key === this.readKey) return;
    this.readKey = key;
    this.readEl.innerHTML = list.map((c) => `<li class="${c.kind}">${c.icon ? ICON[c.icon] : ""}<span>${c.text}</span></li>`).join("");
    this.readEl.hidden = !list.length;
    if (this.toolNotesOnly) this.toolOpts.hidden = !list.length;
  }

  private hint(cat: string | null) {
    for (const [k, b] of this.catBtns) b.classList.toggle("hint", k === cat && !b.classList.contains("on"));
  }

  // ---------------------------------------------------------------- transient UI

  /**
   * What a tool says about the click under the pointer. The pointer carries one line: the thing that matters now and
   * the price (pointer.ts; seven chips in a row on a long road were never read: owner, 2026-11-10). The other notes
   * go to the foot of the tool options card, where they hold still.
   */
  chips(pos: V2 | null, list: Chip[] = []) {
    const box = this.chipBox;
    const line = pointerLine(pos ? list : []);
    this.notes(line.rest);
    if (!pos || !line.head) { box.hidden = true; return; }
    box.hidden = false;
    const chip = (c: Chip) => `<span class="chip ${c.kind}">${c.icon ? ICON[c.icon] : ""}${c.text}</span>`;
    box.innerHTML = chip(line.head) + (line.cost ? chip(line.cost) : "");
    const r = this.root.getBoundingClientRect();
    const w = box.offsetWidth || 200, hh = box.offsetHeight || 24;
    // keep clear of the HUD's panels (the road drawer's tabs, tool options, goals, the bars): below and right of the
    // cursor if that is clear, else above it, else to its left; failing all, lifted above whatever it would cover
    const walls: DOMRect[] = [];
    for (const el of this.root.querySelectorAll<HTMLElement>(".card, .bbar, .corner")) {
      if (el === box || el.hidden || !el.offsetParent) continue;
      const q = el.getBoundingClientRect();
      if (q.width > 0 && q.height > 0) walls.push(new DOMRect(q.left - r.left, q.top - r.top, q.width, q.height));
    }
    const hits = (x: number, y: number) => walls.filter((q) => x < q.right + 4 && x + w > q.left - 4 && y < q.bottom + 4 && y + hh > q.top - 4);
    const inside = (x: number, y: number) => x >= 8 && y >= 8 && x + w <= r.width - 8 && y + hh <= r.height - 8;
    const tries: [number, number][] = [
      [pos.x + 18, pos.y + 20], [pos.x + 18, pos.y - hh - 16], [pos.x - w - 14, pos.y + 20], [pos.x - w - 14, pos.y - hh - 16],
    ];
    let at = tries.find(([x, y]) => inside(x, y) && !hits(x, y).length);
    if (!at) {
      let [x, y] = tries[0];
      if (x + w > r.width - 8) x = pos.x - w - 14;
      // (a long row never runs off the screen's side: its first notes were cut off at the left edge)
      x = Math.max(8, Math.min(x, r.width - 8 - w));
      for (let k = 0; k < 4; k++) {
        const hit = hits(x, y);
        if (!hit.length) break;
        y = Math.min(...hit.map((q) => q.top)) - hh - 6;
      }
      at = [x, Math.max(8, y)];
    }
    box.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
  }

  toast(msg: string, error = false) {
    const t = h("div", "toast " + (error ? "error" : ""), msg);
    t.setAttribute("role", "status");
    this.toastBox.appendChild(t);
    // (the order note stays: it is put away by itself)
    for (let ts = this.toastBox.querySelectorAll(".toast:not(.order-note)"), i = 0; i < ts.length - 3; i++) ts[i].remove();
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, error ? 2200 : 2800);
  }

  rect(r: [V2, V2] | null) {
    if (!r) { this.rectEl.hidden = true; return; }
    const [a, b] = r;
    Object.assign(this.rectEl.style, {
      left: Math.min(a.x, b.x) + "px", top: Math.min(a.y, b.y) + "px", width: Math.abs(a.x - b.x) + "px", height: Math.abs(a.y - b.y) + "px",
    });
    this.rectEl.hidden = false;
  }

  shake(k: number) {
    this.chipBox.style.marginLeft = k > 0 ? `${Math.sin(k * 40) * 4 * k}px` : "0";
  }

  sound(k: Parameters<GameAudio["play"]>[0]) {
    this.sfx.play(k);
  }

  /** Milestones reached (and towns grown) not yet shown: several can come at once, each gets its banner in turn. */
  private bannerQ: Banner[] = [];
  private bannerT = 0;
  /**
   * The clock was stopped for a card that waits to be read, and starts again once the last is put away (review
   * 2026-11-10, B7: at speed 4 two milestones stacked in the middle of the screen while the trucks ran on behind
   * them). Queued and paused rather than a ribbon: a milestone's card introduces new works one by one, which is
   * reading, and a game day at speed 4 passes in seconds. The player's own pause or speed change takes over.
   */
  private bannerHeld = false;

  /** The player set the clock: a card that stopped it no longer starts it again. */
  clockSet() { this.bannerHeld = false; }

  /** A milestone was reached: what it unlocks (with the towns it brought), and the grant. */
  milestone(M: Milestone, towns?: number[]) {
    this.queueBanner({ m: M, towns });
  }

  /** A fresh town sprang up: its arrival, where it lies and a way to fly there. */
  townSpawned(town: number, from: number | null, dist: number, dir: string) {
    this.queueBanner({ spawned: town, from, dist, dir });
  }

  /** A town has grown into a new size: its moment. */
  townGrew(town: number, size: number) {
    this.queueBanner({ town, size });
  }

  /** One of the company's landmarks is finished: its opening, the biggest moment in the game. */
  landmarkDone(b: number) {
    this.queueBanner({ landmark: b });
  }

  /** A town's order is filled: its banner (the building going up, the grant, the perk). */
  orderFilled(town: number, kind: CivicKind, b: number | undefined, grant: number) {
    this.queueBanner({ order: town, kind, b, grant });
  }

  // (orders opened lately, still on the note: newest last)
  private orderNote: HTMLElement | null = null;
  private orderNoteT = 0;
  private orderNoted: { town: number; kind: CivicKind }[] = [];

  /**
   * An order opened in a town: a small note under the toasts, which stays a while and can be put away. Orders that
   * open while it shows join it rather than piling up notes.
   */
  orderOpened(town: number, kind: CivicKind) {
    const g = this.app.game;
    if (!g.towns.byId.has(town)) return;
    let n = this.orderNote;
    if (!n || !n.isConnected) {
      n = this.orderNote = h("div", "toast order-note");
      n.setAttribute("role", "status");
      this.orderNoted = [];
      this.toastBox.prepend(n);
      const note = n;
      // (only while it is still the note showing: one fading out leaves the next one's timer alone)
      n.addEventListener("mouseenter", () => { if (this.orderNote === note) clearTimeout(this.orderNoteT); });
      n.addEventListener("mouseleave", () => { if (this.orderNote === note) this.orderNoteAway(6000); });
    }
    this.orderNoted = this.orderNoted.filter((x) => x.town !== town || x.kind !== kind).concat({ town, kind });
    const list = this.orderNoted.map((x) => ({ x, o: g.orders.open.find((o) => o.town === x.town && o.kind === x.kind), t: g.towns.byId.get(x.town) }))
      .filter((r): r is { x: { town: number; kind: CivicKind }; o: NonNullable<typeof r.o>; t: Town } => !!r.o && !!r.t);
    const shown = list.slice(-3);
    const one = list.length === 1 ? list[0] : null;
    n.innerHTML = `<p class="on-k">${list.length > 1 ? `${list.length} new town orders` : "New town order"}</p>
      <ul class="on-list">${shown.map((r) => `<li><button class="on-row" data-id="${r.t.id}">${escapeHtml(orderLine(r.o, r.t.name))}</button></li>`).join("")}</ul>
      ${list.length > shown.length ? `<p class="on-more">and ${list.length - shown.length} more in the Towns window</p>` : ""}
      <button class="close on-x" aria-label="Put the note away">${ICON.close}</button>`;
    for (const b of n.querySelectorAll<HTMLButtonElement>(".on-row")) b.onclick = () => { this.sfx.play("click"); this.orderNoteAway(0); this.showTown(+b.dataset.id!); };
    n.querySelector<HTMLButtonElement>(".on-x")!.onclick = () => this.orderNoteAway(0);
    n.classList.remove("out");
    if (one) n.title = `Open ${one.t.name}`;
    this.sfx.sting("orderOpen");
    this.orderNoteAway(14000);
  }

  private orderNoteAway(ms: number) {
    clearTimeout(this.orderNoteT);
    this.orderNoteT = window.setTimeout(() => {
      const n = this.orderNote;
      if (!n) return;
      // (being read, or holding the keyboard: it waits a little longer)
      if (ms && n.matches(":hover, :focus-within")) { this.orderNoteAway(4000); return; }
      n.classList.add("out");
      this.orderNote = null;
      setTimeout(() => n.remove(), 300);
    }, ms);
  }

  /** A town's order ran out of time: a quiet word, no cost (it asks again later). */
  orderLapsed(town: number, kind: CivicKind) {
    const t = this.app.game.towns.byId.get(town);
    if (t) this.toast(`${t.name}'s ${CIVICS[kind].name.toLowerCase()} order ran out of time. It will ask again.`);
  }

  /** Drop every banner still showing or waiting (a new game or a load: they belonged to the last one). */
  clearBanners() {
    clearTimeout(this.bannerT);
    this.bannerQ = [];
    this.bannerHeld = false;
    this.banner.hidden = true;
    this.orderNoteAway(0);
    this.seasons.clear();
  }

  private queueBanner(x: Banner) {
    this.bannerQ.push(x);
    if (this.banner.hidden) this.nextBanner();
    else this.bannerMore();
    this.refresh();
  }

  private nextBanner() {
    clearTimeout(this.bannerT);
    const X = this.bannerQ.shift();
    const g = this.app.game;
    // (the cards that wait to be read stop the clock; the town's news that steps aside by itself does not)
    const read = !!X && ("m" in X || "landmark" in X || "spawned" in X);
    if (!read && this.bannerHeld) {
      this.bannerHeld = false;
      if (g.paused) { g.paused = false; this.refresh(); }
    }
    if (!X) { this.banner.hidden = true; return; }
    const t = "town" in X ? g.towns.byId.get(X.town) : "spawned" in X ? g.towns.byId.get(X.spawned) : "order" in X ? g.towns.byId.get(X.order) : undefined;
    if (("town" in X || "spawned" in X || "order" in X) && !t) { this.nextBanner(); return; }
    const civ = "order" in X && X.b !== undefined ? g.buildings.byId.get(X.b) : undefined;
    const lm = "landmark" in X ? g.buildings.byId.get(X.landmark) : undefined;
    if ("landmark" in X && (!lm || !isMega(lm.kind))) { this.nextBanner(); return; }
    // the banner's moment, heard as it drops in
    this.sfx.sting("m" in X ? "milestone" : "spawned" in X ? "newTown" : "landmark" in X ? "landmark" : "order" in X ? "orderDone" : "townGrew");
    if ("order" in X && X.grant > 0) this.sfx.sting("money");
    this.banner.classList.toggle("lm", !!lm || "spawned" in X);
    this.banner.classList.toggle("nt", "spawned" in X);
    this.banner.classList.toggle("ord", "order" in X);
    if (lm && isMega(lm.kind)) {
      this.banner.innerHTML = `<header>The ${BUILDING_TYPES[lm.kind].name} is open</header>
        <p class="gifts">${escapeHtml(MEGAS[lm.kind].reward)}</p>
        <div class="banner-btns"><button class="btn" data-k="show">Show me</button><button class="btn primary" data-k="ok">Continue</button></div>`;
    } else if ("order" in X) {
      // an order filled: the town's new building going up, the grant, and what it does for the town for good
      const C = CIVICS[X.kind];
      this.banner.innerHTML = `<header>${escapeHtml(t!.name)} builds its ${C.name.toLowerCase()}</header>
        <p class="sub">${escapeHtml(t!.name)} pays the company ${formatMoney(X.grant)}</p>
        <p class="gifts">${escapeHtml(C.perkText)}.</p>
        <div class="banner-btns">${civ ? `<button class="btn" data-k="civic">Show me</button>` : ""}<button class="btn" data-k="town">Open ${escapeHtml(t!.name)}</button><button class="btn primary" data-k="ok">Continue</button></div>`;
    } else if ("spawned" in X) {
      const T = g.towns.byId.get(X.spawned)!;
      const from = X.from !== null ? g.towns.byId.get(X.from) : undefined;
      // (the arrow points the way the town lies on screen, whichever way the camera is turned)
      const a = this.app.screenBearing(from?.c ?? { x: this.app.view.cx, y: this.app.view.cy }, T.c);
      const where = from ? `${km(X.dist)} ${X.dir} of ${escapeHtml(from.name)}` : "on the map";
      this.banner.innerHTML = `<div class="nt-head">${spawnCompass(a)}<header>${escapeHtml(T.name)} has sprung up</header></div>
        <p class="sub">${where} · no road yet</p>
        <p class="gifts">Lay a road out to it and keep it fed.</p>
        <div class="banner-btns"><button class="btn" data-k="fly">Fly there</button><button class="btn" data-k="town">Open ${escapeHtml(T.name)}</button><button class="btn primary" data-k="ok">Continue</button></div>`;
    } else if ("m" in X) {
      const M = X.m;
      const co = g.company;
      const names = (X.towns ?? []).map((id) => g.towns.byId.get(id)?.name).filter((n): n is string => !!n);
      // new works are introduced one by one, in the order to build them, each with what it takes and makes
      // (play-test 2026-11-09, B5: "Village unlocks four buildings at once and then explains none of them")
      const works = buildOrder(M.unlocks.buildings ?? []);
      // (the works that powers the rest leads the list, and says why: it was listed third. Owner, 2026-11-10)
      const powerFirst = works.length > 1 && !!PLANTS[works[0]].makes && works.some((k) => PLANTS[k].power);
      const intro = works.map((k, i) => {
        const D = PLANTS[k];
        const needs = [i === 0 && powerFirst ? `build it first: the others work at ${Math.round(UNPOWERED * 100)}% without power` : "", D.site ? `site needs ${siteShort(D.site)}` : "", D.power ? `draws ${D.power} MW` : ""].filter(Boolean).join(" · ");
        return `<li><span class="bn-ic" aria-hidden="true">${placedIcon(k)}</span><b>${BUILDING_TYPES[k].name}</b><span class="bn-flow as-flow" aria-hidden="true">${flowIcons(k)}</span><span class="bn-say">${escapeHtml(chainText(k))}${needs ? `<small>${escapeHtml(needs)}</small>` : ""}</span></li>`;
      }).join("");
      const rest = unlockList({ ...M.unlocks, buildings: [] }, names);
      this.banner.innerHTML = `<header class="banner-co">${heraldSvg(co.herald, co.name, 26)}<span>${M.name}</span></header>
        <p class="sub">Goal reached: ${escapeHtml(M.goal[0].toLowerCase() + M.goal.slice(1))}</p>
        ${works.length ? `<p class="bn-lead">${works.length > 1 ? "New in Industry, in build order" : "New in Industry"}</p><ol class="bn-new${works.length > 1 ? " num" : ""}">${intro}</ol>` : ""}
        ${rest.length ? `<p class="gifts">${works.length ? "Also" : "Unlocked"}: ${rest.map(escapeHtml).join(" · ")}</p>` : ""}
        <div class="banner-btns">${works.length ? `<button class="btn" data-k="industry">Open Industry</button>` : ""}<button class="btn primary" data-k="ok">Continue</button></div>`;
    } else if ("town" in X) {
      const S = TOWN_SIZES[X.size];
      const adds = S.adds.filter((p) => needFrom(p) === S.pop).map((p) => PRODUCTS[p].name.toLowerCase());
      const what = [
        adds.length ? `now needs ${adds.join(" and ")} too` : "",
        X.size > 0 ? `a new ${BUILDING_TYPES[HALLS[X.size]].name.toLowerCase()} is going up` : "",
        "the centre rebuilds denser",
      ].filter(Boolean).join(" · ");
      this.banner.innerHTML = `<header>${escapeHtml(t!.name)} is now a ${S.name}</header>
        <p class="sub">${fmtNum(t!.pop)} people</p>
        <p class="gifts">${what[0].toUpperCase() + what.slice(1)}</p>
        <div class="banner-btns"><button class="btn" data-k="town">Open ${escapeHtml(t!.name)}</button><button class="btn primary" data-k="ok">Continue</button></div>`;
    }
    if (read && !g.paused && this.app.mode === "play") { g.paused = true; this.bannerHeld = true; this.refresh(); }
    // (said beside the button that starts it again)
    if (this.bannerHeld) this.banner.querySelector(".banner-btns")?.insertAdjacentHTML("afterbegin", `<span class="bn-held">Paused while you read</span>`);
    this.banner.hidden = false;
    this.seasons.yieldTo();
    this.banner.classList.remove("in");
    void this.banner.offsetWidth;
    this.banner.classList.add("in");
    const ok = this.banner.querySelector<HTMLButtonElement>('[data-k="ok"]')!;
    ok.onclick = () => this.nextBanner();
    const open = this.banner.querySelector<HTMLButtonElement>('[data-k="town"]');
    if (open && t) open.onclick = () => { this.nextBanner(); this.openTown(t.id); };
    const show = this.banner.querySelector<HTMLButtonElement>('[data-k="show"]');
    if (show && lm) show.onclick = () => { this.app.glideTo(lm.c, Math.max(220, Math.hypot(lm.hw, lm.hd) * 1.6)); this.nextBanner(); this.app.selected = lm; this.openBuilding(lm); };
    const sc = this.banner.querySelector<HTMLButtonElement>('[data-k="civic"]');
    if (sc && civ) sc.onclick = () => { this.app.glideTo(civ.c, Math.max(150, Math.hypot(civ.hw, civ.hd) * 2.8)); this.nextBanner(); };
    const fly = this.banner.querySelector<HTMLButtonElement>('[data-k="fly"]');
    if (fly && t) fly.onclick = () => { this.nextBanner(); this.app.flyToTown(t.id); };
    // (a milestone's new works: straight to their tab in the catalog, nothing in hand)
    const ind = this.banner.querySelector<HTMLButtonElement>('[data-k="industry"]');
    if (ind && "m" in X) ind.onclick = () => {
      const first = buildOrder(X.m.unlocks.buildings ?? [])[0];
      const tab = CATS.industry.tabs.find((x) => x.assets.some((a) => a.kind === "placed" && a.id === first));
      this.nextBanner();
      if (tab) this.tab.industry = tab.id;
      this.cat = "industry";
      this.catPeek = false;
      this.sfx.play("open");
      if (this.app.st.tool !== "inspect") this.app.setTool({ tool: "inspect" });
      else this.refresh();
    };
    this.bannerMore();
    // a milestone waits to be read; a town's news steps aside by itself after a while (and doesn't take the keyboard)
    if ("m" in X || lm || "spawned" in X) requestAnimationFrame(() => ok.focus({ preventScroll: true }));
    else this.bannerAway(12000);
  }

  /** A town's news steps aside after `ms`, but not while the cinematic camera hides it (it waits to be seen). */
  private bannerAway(ms: number) {
    this.bannerT = window.setTimeout(() => {
      if (this.app.camera.cinematic) this.bannerAway(4000);
      else if (!this.banner.matches(":hover, :focus-within")) this.nextBanner();
    }, ms);
  }

  /** The banner's button says when more news waits behind this one. */
  private bannerMore() {
    const ok = this.banner.querySelector<HTMLButtonElement>('[data-k="ok"]');
    if (ok) ok.textContent = this.bannerQ.length ? `Next (${this.bannerQ.length} more)` : "Continue";
  }

  // ---------------------------------------------------------------- back / Esc

  /** One step back, the way Esc works: popups, dialogs, panels, the tool, the asset menu. False when there was nothing to close. */
  /** A new city has just been started (from the title menu): the tips start over. */
  newCity() {
    this.tutHidden = false;
    this.refresh();
    this.openCompany("new");
  }

  /** The company's name and herald by the menu, redrawn when either changes. */
  private syncCompany() {
    const co = this.app.game.company;
    const key = co.name + "|" + co.herald.shape + co.herald.field + co.herald.ink;
    if (key === this.companyKey) return;
    this.companyKey = key;
    this.companyEl.innerHTML = `${heraldSvg(co.herald, co.name, 28)}<span class="company-name">${escapeHtml(co.name)}</span>`;
    this.companyEl.setAttribute("aria-label", `${co.name}: rename the company or change its badge`);
  }

  /**
   * The company: its name (edit it, or draw another) and its herald (draw another). A new game opens on it, to
   * name the company before the first road.
   */
  openCompany(from: "hud" | "pause" | "new" = "hud") {
    const fresh = from === "new";
    const app = this.app, g = app.game;
    if (this.modal.hidden && !g.paused) { app.togglePause(); this.resumeOnClose = true; }
    let herald = { ...g.company.herald };
    const dlg = this.showModal(`<header>${fresh ? "Your company" : "Company"}</header>
      <form class="co-form">
        <div class="co-badge"></div>
        <label class="co-field"><span>Name</span><input name="n" maxlength="${COMPANY_NAME_MAX}" autocomplete="off" spellcheck="false" value="${escapeHtml(g.company.name)}"></label>
        <div class="co-btns">
          <button class="btn" type="button" data-k="name">Another name</button>
          <button class="btn" type="button" data-k="badge">Another badge</button>
          <button class="btn primary" type="submit">${fresh ? "Start" : "Done"}</button>
        </div>
      </form>`, "Company");
    dlg.classList.add("co-dlg");
    if (from === "pause") this.backButton(dlg);
    const input = dlg.querySelector("input") as HTMLInputElement;
    const badge = dlg.querySelector(".co-badge") as HTMLElement;
    const draw = () => { badge.innerHTML = heraldSvg(herald, input.value || g.company.name, 72, "Company badge"); };
    draw();
    input.oninput = draw;
    (dlg.querySelector('[data-k="name"]') as HTMLButtonElement).onclick = () => { input.value = companyName(Math.random); draw(); };
    (dlg.querySelector('[data-k="badge"]') as HTMLButtonElement).onclick = () => {
      let n = randomHerald(Math.random);
      for (let k = 0; k < 8 && n.shape === herald.shape && n.field === herald.field; k++) n = randomHerald(Math.random);
      herald = n;
      draw();
    };
    (dlg.querySelector("form") as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      g.company = { name: cleanName(input.value) || g.company.name, herald };
      this.syncCompany();
      if (from === "pause") this.openPause();
      else this.closeModal();
    };
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  /** What is open now, for Esc (ui/escape.ts has the order they go in). */
  private escState(): EscState {
    return {
      dialog: !this.modal.hidden, banner: !this.banner.hidden, popover: this.seasons.popOpen, draft: this.app.hasDraft,
      tool: this.app.st.tool !== "inspect", catalog: !!this.cat, selection: !!this.sel, window: !!this.winKind,
      view: this.app.overlay !== "none",
    };
  }

  /**
   * One step back, the way Esc works: one press puts away exactly one thing, the one on top (a dialog, a banner, the
   * tool in hand, the catalog, the selection, a window, an info view). False when there was nothing to put away:
   * only then does Esc open the pause menu.
   */
  back(): boolean {
    const layer = escLayer(this.escState());
    if (layer === "dialog") this.closeModal();
    else if (layer === "banner") this.nextBanner();
    else if (layer === "popover") this.seasons.closePop();
    else if (layer === "draft") this.app.cancelDraft();
    // (the catalog it came from stays open, its list unfolded again: the next press closes that)
    else if (layer === "tool") { this.catPeek = false; this.app.setTool({ tool: "inspect" }); }
    else if (layer === "catalog") { this.cat = null; this.sfx.play("close"); this.refresh(); }
    else if (layer === "selection") this.closeSelection();
    else if (layer === "window") this.closeWin();
    else if (layer === "view") this.app.setOverlay(this.app.overlay);
    return layer !== null;
  }

  /** Called when the tool changes away from inspecting: the selection panel gives way. */
  closePanels(): boolean {
    const was = !!this.sel;
    this.closeSelection();
    return was;
  }

  private closeSelection() {
    this.panel.hidden = true;
    this.sel = null;
    this.lastPanel = "";
    this.armed = 0;
    this.app.sel = null;
    this.app.selected = null;
    this.app.highlight.set(null);
    this.renderTips();
  }

  /** Stopped only because a menu is up (a save taken now is of a running game); and a game loaded under a menu: the menu goes, without its resume. */
  get menuPaused(): boolean { return this.resumeOnClose && !this.modal.hidden; }
  dropModal() { this.resumeOnClose = false; if (!this.modal.hidden) this.closeModal(); }

  private closeModal() {
    this.modal.hidden = true;
    this.modal.innerHTML = "";
    if (this.resumeOnClose) { this.resumeOnClose = false; if (this.app.game.paused) this.app.togglePause(); }
  }

  // ---------------------------------------------------------------- windows (top left)

  toggleWin(k: WinId) {
    if (this.winKind === k) { this.closeWin(); return; }
    // (one window at a time: the one open gives way, and its info view with it)
    this.dropView();
    this.sfx.play("open");
    this.winKind = k;
    this.lastWin = "";
    this.win.hidden = false;
    if (k === "transport" && this.app.overlay !== "flow") this.app.setOverlay("flow");
    this.fillWin();
    this.refresh();
  }

  /**
   * The info view the open window shows goes off with it (play-test 2026-11-09, A8: Esc closed Info views and left
   * the Resources tint on for minutes, and no night falls while a view is on). Info views owns whichever view is on,
   * Transportation its Traffic flow.
   */
  private dropView() {
    const o = this.app.overlay;
    if (this.winKind === "info" && o !== "none") this.app.setOverlay(o);
    else if (this.winKind === "transport" && o === "flow") this.app.setOverlay("flow");
  }

  private closeWin() {
    this.dropView();
    if (this.winKind) this.sfx.play("close");
    this.winKind = null;
    this.win.hidden = true;
    this.lastWin = "";
    this.refresh();
  }

  /** line whose delete button has been clicked once (a second click deletes it) */
  private armedLine: number | null = null;
  private armedT = 0;

  private setWin(title: string, html: string): boolean {
    const full = `<header class="win-head"><b>${title}</b><button class="close" aria-label="Close ${title}">${ICON.close}</button></header><div class="win-body">${html}</div>`;
    if (full === this.lastWin) return false;
    this.lastWin = full;
    const body = this.win.querySelector(".win-body");
    const scroll = body?.scrollTop ?? 0;
    // keep keyboard focus across the rebuild (the window refreshes as the numbers in it change)
    const fe = document.activeElement as HTMLElement | null;
    let refocus: ((root: HTMLElement) => HTMLElement | null) | null = null;
    if (fe && fe !== document.body && this.win.contains(fe)) {
      const all = [...this.win.querySelectorAll<HTMLElement>("button, input, select, [tabindex]")];
      const i = all.indexOf(fe);
      refocus = (root) => root.querySelectorAll<HTMLElement>("button, input, select, [tabindex]")[i] ?? null;
    }
    this.win.innerHTML = full;
    // (the windows that are lists of named things get the room to name them: A15, E4)
    this.win.classList.toggle("wide", title === "Towns" || title === "Economy");
    this.win.querySelector(".win-body")!.scrollTop = scroll;
    if (refocus) refocus(this.win)?.focus({ preventScroll: true });
    (this.win.querySelector(".close") as HTMLButtonElement).onclick = () => this.closeWin();
    return true;
  }

  private fillWin() {
    const k = this.winKind;
    if (k === "info") this.fillInfo();
    else if (k === "progression") this.fillProgression();
    else if (k === "economy") this.fillEconomy();
    else if (k === "city") this.fillCity();
    else if (k === "transport") this.fillTransport();
    else if (k === "camera") this.fillCamera();
  }

  /** The camera menu: follow a truck, the Tour and the Vehicle cam. */
  private fillCamera() {
    const app = this.app, following = app.camera.following !== null;
    const opt = (id: string, icon: string, name: string, key: string, blurb: string, on = false) =>
      `<button class="cam-opt${on ? " on" : ""}" data-cam="${id}" aria-pressed="${on}"><span class="cam-ic">${icon}</span><span class="cam-txt"><b>${name}</b><span class="small muted">${blurb}</span></span><span class="cam-key">${key}</span></button>`;
    const map = app.camView === "map";
    const html = `<div class="cam-list">${
      opt("view", ICON.camMap, "Map view", "<kbd>M</kbd>", map ? "Looking straight down. Again for the Diorama, the tilted view." : "Look straight down, like a map. To turn and tilt the Diorama: drag with the middle button, or drag the small block by the buttons above; Q / E and Y / H do it from the keys.", map)
    }${
      opt("follow", ICON.camFollow, following ? "Stop following" : "Follow a truck", "<kbd>G</kbd>", following ? "Let go of the vehicle the camera is riding with." : "The camera rides with the truck nearest the middle of the screen. Zoom, click and Esc as you like; moving the map lets go.", following)
    }${
      opt("tour", ICON.camera, "Tour", "<kbd>T</kbd>", "An automatic camera drifts over your busiest junctions, towns, works and bridges, fading from one to the next. The interface hides; the game runs on.")
    }${
      opt("ride", ICON.camRide, "Vehicle cam", "<kbd>Shift</kbd><kbd>T</kbd>", "Rides along with one heavy truck, road train or convoy after another, a few seconds each.")
    }</div><p class="cam-foot small muted">Any key or a click leaves the Tour and the Vehicle cam.</p>`;
    this.camShown = app.camView;
    if (!this.setWin("Camera", html)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".cam-opt")) b.onclick = () => {
      const k = b.dataset.cam;
      this.sfx.play("click");
      // (the view flips in front of the open menu: it shows which one is on)
      if (k === "view") { app.toggleMapView(); return; }
      this.closeWin();
      if (k === "follow") app.camera.toggleFollowNearest();
      else if (k === "tour") app.startTour();
      else app.startVehicleCam();
    };
  }

  /** The follow chip: what the camera rides with (null: hide it). */
  followChip(info: { what: string; sub: string } | null) {
    // (built once: only the words change, so the Stop button keeps the keyboard when the truck sets off again, and
    // only the words are read out)
    const el = this.followEl;
    if (!el.firstChild) {
      el.innerHTML = `<i class="fc-lamp" aria-hidden="true"></i><span class="fc-text" role="status"><span class="fc-k">Following</span><b class="fc-what"></b><span class="fc-sub"></span></span><button class="fc-stop" type="button" aria-label="Stop following (G)">Stop<kbd>G</kbd></button>`;
      (el.querySelector(".fc-stop") as HTMLButtonElement).onclick = () => { this.sfx.play("click"); this.app.stopFollow(); };
    }
    if (info) {
      (el.querySelector(".fc-what") as HTMLElement).textContent = info.what;
      const sub = el.querySelector(".fc-sub") as HTMLElement;
      sub.textContent = info.sub;
      sub.hidden = !info.sub;
    }
    el.hidden = !info;
    if (this.winKind === "camera") this.fillCamera();
  }

  private fillInfo() {
    const app = this.app;
    const rows = OVERLAYS.map((o) => `<button class="iv ${app.overlay === o.id ? "on" : ""}" data-id="${o.id}" aria-pressed="${app.overlay === o.id}"${o.tip ? ` title="${o.tip}"` : ""}><span class="ov-dot ov-${o.id}"></span><span><b>${o.label}</b><span class="small muted">${o.blurb}</span></span></button>`).join("");
    if (!this.setWin("Info views", `<div class="iv-list">${rows}</div><div class="legend">${this.legendHtml()}</div>`)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".iv")) b.onclick = () => { app.setOverlay(b.dataset.id as OverlayId); this.sfx.play("click"); this.fillInfo(); };
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".lg-go")) b.onclick = () => { this.sfx.play("click"); app.flyTo({ x: Number(b.dataset.x), y: Number(b.dataset.y) }); };
  }

  private legendHtml(): string {
    const o = this.app.overlay;
    if (o === "flow") return `<span class="lg lg-flow"></span><span>Free flowing</span><span>Jammed</span>`;
    if (o === "landvalue") return `<span class="lg lg-sat"></span><span>Low</span><span>High</span>`;
    if (o === "level") return `<span class="lg lg-level"></span><span>Level 1</span><span>Level 5</span>`;
    if (o === "problems") return `<span class="lg lg-prob"></span><span>Has a problem</span><span>Fine</span>`;
    const keys = (l: [string, number][]) => l.map(([k, c]) => `<span class="lg-key"><i style="background:${hex(c)}"></i>${k}</span>`).join("");
    if (o === "resources") {
      // (each mined kind flies to its nearest deposit; soil and forest are all round and need no finding)
      const v = this.app.view, gen = this.app.game.terrain.gen;
      const col: Record<number, number> = { [F.fert]: PAL.resFert, [F.forest]: PAL.resForest, [F.ore]: PAL.resOre, [F.coal]: PAL.resCoal, [F.lime]: PAL.resLime, [F.oil]: PAL.resOil, [F.sand]: PAL.resSand, [F.copper]: PAL.resCopper };
      return [...DEPOSIT_KINDS.values()].map((k) => {
        const sw = `<i style="background:${hex(col[k.field] ?? 0x888888)}"></i>`;
        const d = k.field === F.fert || k.field === F.forest ? undefined : gen.depositsNear(k.field, v.cx, v.cy, 24000)[0];
        if (!d) return `<span class="lg-key">${sw}${k.name}</span>`;
        const km = Math.hypot(d.x - v.cx, d.y - v.cy) / 1000;
        return `<button type="button" class="lg-key lg-go" data-x="${Math.round(d.x)}" data-y="${Math.round(d.y)}" title="Fly to the nearest ${k.name.toLowerCase()}">${sw}<span>${k.name}</span><span class="lg-km">${km < 10 ? km.toFixed(1) : Math.round(km)} km</span></button>`;
      }).join("");
    }
    if (o === "power") return keys([["Power plant", 0x2f86e0], ["Full power", 0x3faa5a], ["Short", 0xf0a33a], ["None", 0xe5484d]]);
    return "";
  }

  private fillEconomy() {
    const g = this.app.game;
    const B = g.budgetAvg;
    const rows: [string, number, boolean][] = [
      ["Sales to towns", B.income.sales, true],
      ["Bus fares", B.income.transit, false],
      ["Wages", -B.expense.wages, true],
      ["Plant upkeep", -B.expense.upkeep, true],
      ["Truck fuel", -B.expense.fuel, true],
      ["Road upkeep", -B.expense.roads, true],
      ["Bus upkeep", -B.expense.transit, false],
      ["Loan repayments", -B.expense.loans, false],
    ];
    const total = rows.reduce((a, [, v]) => a + v, 0);
    const n = Math.max(1, g.budgetLog.length);
    // each plant's own books over the last hour
    // (told apart by where they stand, the ones in trouble first; a row flies there. Play-test 2026-11-09, E3:
    // "plants cannot be told apart")
    const open = (b: Building) => b.built >= 1 && !b.plant!.site;
    // (its state: the very line its panel leads with, so a row here never says what the panel does not)
    const state = new Map(g.industry.plants().filter(open).map((b) => [b.id, worksStatus(g, b)]));
    const rank = (b: Building) => (state.get(b.id)?.tone === "bad" ? 0 : open(b) ? 1 : 2);
    const plants = [...g.industry.plants()].sort((a, b) => rank(a) - rank(b) || (a.plant!.last.earned - a.plant!.last.spent) - (b.plant!.last.earned - b.plant!.last.spent)).map((b) => {
      const L = b.plant!.last, net = L.earned - L.spent;
      const st = state.get(b.id);
      const word = !st ? `<span class="ec-st">Being built</span>` : st.tone !== "good" ? `<span class="ec-st ${st.tone}">${escapeHtml(st.text)}</span>` : "";
      return `<li><button class="ec-row" data-id="${b.id}" title="Show this ${escapeHtml(BUILDING_TYPES[b.kind].name)} on the map"><span class="ec-ic" aria-hidden="true">${iconFor(b.kind)}</span><span class="ec-name"><b>${BUILDING_TYPES[b.kind].name}</b><span class="small muted">${escapeHtml(whereIs(g, b))}</span>${word}</span><span class="num ${moneyTone(net)}">${signed(net)}</span></button></li>`;
    }).join("");
    // what the company made over the last day, per product, against what its plants can make
    // (each works' own pace, the very figure its panel shows, added up: on a young save a 24-hour total read "1 of 3"
    // beside a works panel's "10 loads a day", two windows for one thing. Design audit 2026-11-10, F05)
    const made = new Map<Product, { made: number; can: number }>();
    for (const b of g.industry.plants()) {
      if (b.built < 1 || b.plant!.site) continue;
      for (const p of Object.keys(PLANTS[b.kind as PlantKind].outputs) as Product[]) {
        const { rate, can } = shownRate(g, b, p), e = made.get(p) ?? { made: 0, can: 0 };
        e.made += (rate ?? 0) * 24; e.can += can * 24;
        made.set(p, e);
      }
    }
    // (a bar filled to made of can make, in the product's colour: design audit 2026-11-10, F16 and F17. The hour by
    // hour picture is the works' own Details chart)
    const prodRows = [...made].map(([p, e]) => `<li><span class="pd-name">${productIcon(p)}${PRODUCTS[p].name}</span>${ratioBar(e.made, e.can, PRODUCTS[p].color)}<span class="num"><b>${e.made < 0.05 ? "0" : fmtRate(e.made)}</b><span class="muted"> of ${fmtRate(e.can)}</span></span></li>`).join("");
    const html = `<p class="win-sub">${n === 1 ? "Last hour" : `Average hour, last ${n} hours`}</p>
      <dl class="facts money-rows">${rows.filter(([, v, always]) => always || Math.abs(v) >= 0.5).map(([k, v]) => `<dt>${k}</dt><dd class="${moneyTone(v)}">${signed(v)}</dd>`).join("")}
      <dt class="tot">Balance</dt><dd class="tot ${moneyTone(total)}">${signed(total)}</dd></dl>
      ${prodRows ? `<h3 class="sub-h" title="Loads a day lately, of what your works can make">Made per day</h3><ul class="pd-list">${prodRows}</ul>` : ""}
      ${plants ? `<h3 class="sub-h" title="Profit over the last hour. Click one to go there">Your works, last hour</h3><ul class="ec-list">${plants}</ul>` : ""}
      ${sparkline(g.history.map((x) => x.money), "Money", formatMoney)}`;
    if (!this.setWin("Economy", html)) return;
    for (const r of this.win.querySelectorAll<HTMLButtonElement>(".ec-row")) r.onclick = () => {
      const b = g.buildings.byId.get(+r.dataset.id!);
      if (!b) return;
      this.sfx.play("click");
      this.app.setTool({ tool: "inspect" });
      this.app.glideTo(b.c, Math.min(this.app.view.halfH, CHIP_HALF_H), 1);
      this.openBuilding(b);
    };
  }

  private fillProgression() {
    const g = this.app.game;
    const v = g.progressView();
    const open = new Set(g.progress.open().map((m) => m.id));
    const rows = MILESTONES.map((M) => {
      const done = g.progress.isDone(M.id), cur = open.has(M.id);
      const [have, need] = M.measure(v);
      const p = Math.max(0, Math.min(1, have / need));
      return `<li class="${done ? "done" : cur ? "cur" : "later"}">
        <div class="ms-top">${done ? ICON.check : ICON.open}<b>${M.name}</b><span class="muted num">${done ? "Reached" : cur ? measureText(M, have, need) : ""}</span></div>
        <p class="small">${M.goal}</p>
        ${cur ? `<span class="bar"><i style="width:${Math.max(2, p * 100)}%"></i></span>` : ""}
        <p class="small muted">${unlockList(M.unlocks, (g.progress.spawned[M.id] ?? []).map((id) => g.towns.byId.get(id)?.name).filter((n): n is string => !!n)).map(escapeHtml).join(" · ")}</p></li>`;
    }).join("");
    this.setWin("Goals", `<ul class="ms-list" title="Up to three goals are open at once. Reach one to open the next">${rows}</ul>`);
  }

  /** The Towns window: every town, how big it is and which way it's heading. */
  private fillCity() {
    const g = this.app.game;
    const rows = g.towns.list.map((t) => {
      const tr = trendOf(t);
      // its worst-supplied need, in the panel's words ("Food · Running low")
      const worst = townNeeds(t).reduce<NeedView | null>((w, v) => (!w || v.got / v.want < w.got / w.want ? v : w), null);
      // (a town that sprang up and no road reaches yet says so: its needs mean nothing till one does)
      // (its worst need only when it is short: a town doing well says so in its trend word alone)
      const need = t.spawned && !joinedUp(g, t)
        ? `<span class="tw-need low">No road yet</span>`
        : t.spawned && !served(t)
        ? `<span class="tw-need">First load due</span>`
        : worst && t.pop >= 60 && (worst.state === "low" || worst.state === "none")
        ? `<span class="tw-need ${worst.state === "low" ? "mid" : "low"}">${productIcon(worst.p)}${PRODUCTS[worst.p].name} · ${worst.word}</span>`
        : "";
      return `<li><button class="tw-row" data-id="${t.id}"><span class="tw-name"><b>${escapeHtml(t.name)}</b><span class="small muted">${g.towns.sizeName(t)} · ${fmtNum(t.pop)} people</span></span><span class="tw-right"><span class="tw-trend ${tr.cls}">${tr.short}</span>${need}</span></button></li>`;
    }).join("");
    // when the next town springs up: which goal brings it, and how far along that is
    const nt = nextTown(g);
    const next = nt
      ? `<p class="tw-next" title="A new town springs up when this goal is reached${nt.before ? `. It opens after ${nt.before} more goal${nt.before === 1 ? "" : "s"}` : ""}"><span>Next town:</span> <b>${escapeHtml(nt.m.name)}</b> · ${measureText(nt.m, nt.have, nt.need)}</p>`
      : "";
    const html = `${next}${openOrders(g)}<ul class="tw-list">${rows}</ul>
      <dl class="facts">
        <dt>Working at your works</dt><dd>${fmtNum(g.industry.plants().reduce((a, b) => a + g.people.workersAt(b.id), 0))}</dd>
      </dl>
      ${sparkline(g.history.map((x) => x.pop), "People", fmtNum)}`;
    if (!this.setWin("Towns", html)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".tw-row, .tw-order")) b.onclick = () => { this.sfx.play("click"); this.showTown(+b.dataset.id!); };
  }

  /** Look at a town and open its panel. */
  showTown(id: number) {
    const t = this.app.game.towns.byId.get(id);
    if (!t) return;
    // (in to where the town fills the view: from far out the row used to centre it and leave it a dot. E4)
    this.app.glideTo(t.c, Math.max(220, t.reach * 1.2), 1);
    this.openTown(id);
  }

  private fillTransport() {
    const g = this.app.game;
    const flow = g.traffic.flowScore();
    let cars = 0, trucks = 0, standing = 0;
    for (const v of g.traffic.vehicles) { if (v.truck) trucks++; else cars++; if (stuckNow(v, STANDING_S)) standing++; }
    const all = cars + trucks;
    const jams = stuckSpots(g.traffic.stuckCars(STUCK_RAISE)).length;
    let len = 0;
    for (const s of g.net.segs.values()) len += cubicLength(s);
    const html = `<dl class="facts">
        <dt title="How fast traffic is moving, against the speed limits of the roads it is on">Traffic flow</dt><dd class="${flow < 0.6 ? "bad" : flow > 0.85 ? "good" : ""}">${Math.round(flow * 100)}%</dd>
        <dt title="Vehicles that have not moved for ${STANDING_S} seconds or more">Standing still</dt><dd class="${all && standing / all > 0.25 ? "bad" : ""}">${fmtNum(standing)} <span class="muted">of ${fmtNum(all)} vehicles</span></dd>
        ${jams ? `<dt title="The sign above the clock flies there">Stuck</dt><dd class="bad">${jams === 1 ? "1 place" : `${jams} places`}</dd>` : ""}
        <dt>Cars on the road</dt><dd>${fmtNum(cars)}</dd>
        <dt>Trucks on the road</dt><dd>${fmtNum(trucks)}</dd>
        <dt>Road network</dt><dd>${(len / 1000).toFixed(1)} km</dd>
      </dl>
      ${this.linesHtml()}`;
    if (!this.setWin("Traffic", html)) return;
    this.bindLines();
  }

  /** The bus lines list in the Traffic window. */
  private linesHtml(): string {
    const g = this.app.game, tr = g.transit;
    if (!g.featureUnlocked("transit")) {
      const m = unlockedBy((u) => u.features?.includes("transit"));
      return `<h3 class="sub-h">Bus lines</h3><p class="small muted"${m ? ` title="${escapeHtml(m.goal)}"` : ""}>${ICON.lock} Buses unlock with ${escapeHtml(m?.name ?? "a later goal")}</p>`;
    }
    const lines = [...tr.lines.values()];
    if (!lines.length) return `<h3 class="sub-h">Bus lines</h3><p class="small muted" title="Put down stops with Transport › Bus stop, then click them in order with Bus line">No bus lines yet</p>`;
    let riders = 0, buses = 0;
    const rows = lines.map((l) => {
      const n = tr.busesOn(l.id);
      riders += l.riders;
      buses += n;
      const waiting = l.stops.reduce((a, id) => a + (tr.stops.get(id)?.wait.filter((x) => x.line === l.id).length ?? 0), 0);
      const broken = !isFinite(tr.loopTime(l));
      const sub = broken ? `<span class="bad">Buses can't get round it</span>` : `${l.stops.length} stops · ${fmtNum(l.riders)} riders/h${waiting ? ` · ${waiting} waiting` : ""}`;
      return `<li class="bl" data-id="${l.id}"><i class="bl-sw" style="background:${hex(l.color)}"></i><span class="bl-name"><b>${l.name}</b><span class="small muted">${sub}</span></span>
        <span class="bl-buses" title="Buses on this line (${n} running)"><button class="dur" data-d="-1" aria-label="One bus fewer on the ${l.name}">−</button><b>${l.want}</b><button class="dur" data-d="1" aria-label="One more bus on the ${l.name}">+</button></span>
        ${this.armedLine === l.id
          ? `<button class="bl-del close armed" aria-label="Click again to delete the ${l.name}">Delete</button>`
          : `<button class="bl-del close" aria-label="Delete the ${l.name}">${ICON.close}</button>`}</li>`;
    }).join("");
    return `<h3 class="sub-h">Bus lines</h3>
      <dl class="facts"><dt>Riders last hour</dt><dd>${fmtNum(riders)}</dd><dt>Buses running</dt><dd>${buses}</dd><dt>Fares / upkeep</dt><dd>${signed(g.budget.income.transit)} / ${signed(-g.budget.expense.transit)}</dd></dl>
      <ul class="bus-lines">${rows}</ul>`;
  }

  private bindLines() {
    const g = this.app.game, tr = g.transit;
    for (const li of this.win.querySelectorAll<HTMLElement>(".bl")) {
      const id = +li.dataset.id!;
      const on = () => { this.app.transit3d.focus = id; };
      const off = () => { if (this.app.transit3d.focus === id) this.app.transit3d.focus = null; };
      li.onpointerenter = on;
      li.onpointerleave = off;
      li.addEventListener("focusin", on);
      li.addEventListener("focusout", off);
      for (const b of li.querySelectorAll<HTMLButtonElement>(".dur")) {
        b.onclick = () => {
          const l = tr.lines.get(id);
          if (!l) return;
          l.want = Math.max(1, Math.min(20, l.want + +b.dataset.d!));
          this.sfx.play("click");
          this.fillWin();
        };
      }
      (li.querySelector(".bl-del") as HTMLButtonElement).onclick = () => {
        // two clicks: the first arms it (a line is a dozen clicks to draw again)
        if (this.armedLine !== id) {
          this.armedLine = id;
          clearTimeout(this.armedT);
          this.armedT = window.setTimeout(() => { this.armedLine = null; this.fillWin(); }, 3000);
          this.fillWin();
          return;
        }
        this.armedLine = null;
        tr.removeLine(id);
        this.app.transit3d.focus = null;
        this.sfx.play("remove");
        this.fillWin();
      };
    }
  }

  /** Bus line routes are drawn on the map while the lines list or a stop is open. */
  get linesShown(): boolean {
    return this.winKind === "transport" || this.sel?.k === "stop";
  }

  /** Open the lines list with one line picked out. */
  openLines(id: number) {
    if (this.winKind !== "transport") this.toggleWin("transport");
    this.app.transit3d.focus = id;
  }

  // ---------------------------------------------------------------- selection panel (top right)

  /** Set the panel's HTML only when it changed (keeps focus and hover steady under the live refresh). */
  private setPanel(html: string): boolean {
    if (html === this.lastPanel) return false;
    // a button held down in the panel keeps it as it is until let go (a vehicle's numbers change four times a
    // second: replacing the button between press and release would lose the click)
    if (this.panelHeld) { this.panelHeld = 2; return false; }
    // keyboard focus on a control stays on the same control in the new panel
    const was = document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    this.lastPanel = html;
    this.panel.innerHTML = `<button class="close" aria-label="Close">${ICON.close}</button>${html}`;
    if (was) (this.panel.querySelector<HTMLElement>(was) ?? null)?.focus({ preventScroll: true });
    (this.panel.querySelector(".close") as HTMLButtonElement).onclick = () => { this.sfx.play("click"); this.closeSelection(); };
    const more = this.panel.querySelector<HTMLDetailsElement>(".ip-more");
    if (more) more.ontoggle = () => { setMoreOpen(more.dataset.k!, more.open); };
    const rb = this.panel.querySelector<HTMLButtonElement>(".ip-roadbtn[data-id]");
    if (rb) rb.onclick = () => this.buildRoadTo(+rb.dataset.id!);
    for (const c of this.panel.querySelectorAll<HTMLButtonElement>(".fchip[data-k]")) c.onclick = () => {
      this.sfx.play("click");
      const s = { k: c.dataset.k, id: +c.dataset.id! } as Sel;
      if (s.k === "node") this.openSignal(s.id);
      else this.openSel(s);
      const g = this.app.game;
      const at = s.k === "town" ? g.towns.byId.get(s.id)?.c : s.k === "building" ? g.buildings.byId.get(s.id)?.c
        : s.k === "node" ? g.net.nodes.get(s.id)?.p : s.k === "vehicle" ? g.traffic.vehicles.find((v) => v.id === s.id) : undefined;
      // (from far out a works is a dot: fly in to where it can be read. Play-test 2026-11-09, A20)
      const near = s.k === "town" ? Infinity : CHIP_HALF_H;
      if (at && (!this.app.onScreen(at) || this.app.view.halfH > near * 1.6)) this.app.glideTo(at, Math.min(this.app.view.halfH, near), 1);
    };
    return true;
  }

  /** 1: a pointer is down in the panel; 2: and a refresh waited for it */
  private panelHeld = 0;
  private holdPanel() {
    this.panel.addEventListener("pointerdown", () => { this.panelHeld = 1; });
    const up = () => {
      if (!this.panelHeld) return;
      const late = this.panelHeld === 2;
      this.panelHeld = 0;
      // (after the click has run: then catch up on what changed meanwhile)
      if (late) setTimeout(() => { if (this.sel) this.fillSel(); }, 0);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Select something on the map and open its panel (the one selection: whatever was open gives way). */
  openSel(s: Sel) {
    if (!sameSel(this.sel, s)) { this.lastPanel = ""; this.armed = 0; }
    this.sel = s;
    this.app.sel = s;
    this.app.selected = s.k === "building" ? this.app.game.buildings.byId.get(s.id) ?? null : null;
    this.panel.hidden = false;
    this.fillSel();
    this.renderTips();
  }

  openTown(id: number) { this.openSel({ k: "town", id }); }
  openBuilding(b: Building) { this.openSel({ k: "building", id: b.id }); }
  openSignal(node: number) {
    if (!(this.sel?.k === "node" && this.sel.id === node)) this.panelPhase = 0;
    this.panelNode = node;
    this.openSel({ k: "node", id: node });
  }

  private fillSel() {
    const s = this.sel;
    if (!s) return;
    const g = this.app.game;
    const m = modelOf(g, s, this.ledger, compass);
    if (!m) { this.closeSelection(); return; }
    this.app.highlight.set(m.related);
    if (s.k === "building") this.fillBuilding(g.buildings.byId.get(s.id)!, m);
    else if (s.k === "town") this.fillTown(m);
    else if (s.k === "vehicle") this.fillVehicle(m);
    else if (s.k === "seg") this.fillRoad(m);
    else if (s.k === "node") this.fillSignal(m);
    else if (s.k === "ground") this.fillGround(s, m);
    else if (s.k === "stuck") this.fillStuck(m);
    else this.fillStop(m);
  }

  /** Open ground: what it is, who works it, and a shortcut to place its extractor right there. */
  private fillGround(s: Extract<Sel, { k: "ground" }>, m: PanelModel) {
    const g = this.app.game;
    const k = s.id >= 0 ? extractorFor(g, s.id) : null;
    const body = k ? `<button type="button" class="btn ip-place"><span aria-hidden="true">${placedIcon(k)}</span>Place a ${escapeHtml(BUILDING_TYPES[k].name.toLowerCase())} here</button>` : "";
    if (!this.setPanel(this.anatomy(m, { kind: "ground", body }))) return;
    const b = this.panel.querySelector<HTMLButtonElement>(".ip-place");
    if (b && k) b.onclick = () => {
      this.sfx.play("click");
      this.cat = "industry";
      this.app.setTool({ tool: "place", placed: k });
    };
  }

  /** A stuck-traffic diamond: the vehicles standing there and the junctions holding them (all chips select). */
  private fillStuck(m: PanelModel) {
    if (!this.setPanel(this.anatomy(m, { kind: "stuck" }))) return;
    // the one-click fix for a deadlock: lights on the junction it forms at (its whole cluster: Game.setSignal)
    const b = this.panel.querySelector<HTMLButtonElement>(".ip-act-fix");
    const act = m.status.act;
    if (b && act) b.onclick = () => {
      const g = this.app.game, plan = g.defaultSignal(act.node);
      // (the junction changed since the panel was drawn: it can't take lights now, or has them)
      if (!plan || g.net.nodes.get(act.node)?.signal) { this.lastPanel = ""; this.fillSel(); return; }
      if (!g.setSignal(act.node, plan)) { this.toast("Not enough money", true); return; }
      this.sfx.play("build");
      this.toast("Traffic lights built");
      this.lastPanel = "";
      this.fillSel();
    };
  }

  /**
   * One panel anatomy for everything (docs/ui-style.md "Inspector"): the header with its level and small actions,
   * a status line with its mark, three key numbers, the flow in and out as chips, the level bar, then whatever else
   * there is to read tucked under Details (open or shut per kind, remembered).
   */
  private anatomy(m: PanelModel, o: { actions?: string; danger?: string; lead?: string; body?: string; details?: string; kind: string; summaryFirst?: boolean }): string {
    const st = m.status;
    const keys = m.keys.length ? `<div class="ip-keys" style="--n:${m.keys.length}">${m.keys.map((k) => `<div class="ip-key"${k.title ? ` title="${escapeHtml(k.title)}"` : ""}><b class="${k.tone ?? ""}">${escapeHtml(k.value)}${k.unit ? `<small>${escapeHtml(k.unit)}</small>` : ""}</b><span>${escapeHtml(k.label)}</span></div>`).join("")}</div>` : "";
    const chip = (c: FlowChip) => {
      // (a product with no picture of its own would show the plain diamond the status line uses: left out)
      const pIcon = c.product && productIcon(c.product) !== NO_PRODUCT_ICON ? productIcon(c.product) : "";
      const icon = c.town ? ICON.town : c.kind ? iconFor(c.kind) : pIcon;
      // (a place shows its cargo as a small product mark beside its own icon)
      const prod = pIcon && (c.kind || c.town) ? `<span class="fc-p">${pIcon}</span>` : "";
      const body = `${icon}${prod}<span class="fc-t">${escapeHtml(c.text)}</span>${c.note ? `<em class="${c.tone ?? ""}">${escapeHtml(c.note)}</em>` : ""}`;
      return c.ref
        ? `<button class="fchip" data-k="${c.ref.k}" data-id="${c.ref.id}" title="${escapeHtml(c.title ? `${c.title}. Click to select it` : `Select ${c.text} and light it up on the map`)}">${body}</button>`
        : `<span class="fchip still"${c.title ? ` title="${escapeHtml(c.title)}"` : ""}>${body}</span>`;
    };
    const flow = m.flow.length ? `<dl class="ip-flow">${m.flow.map((r) => `<dt class="fl-${r.label.toLowerCase().replace(/\s+/g, "-")}"${r.title ? ` title="${escapeHtml(r.title)}"` : ""}>${escapeHtml(r.label)}</dt><dd>${r.chips.map(chip).join("")}</dd>`).join("")}</dl>` : "";
    const lv = m.level ? `<div class="ip-lvl">${levelRun(m.level.from, m.level.to, m.level.pct)}<span class="ip-lvl-t ${m.level.tone ?? ""}">${escapeHtml(m.level.line)}</span></div>` : "";
    const open = moreOpen(o.kind);
    const details = o.details ? `<details class="ip-more" data-k="${o.kind}"${open ? " open" : ""}><summary>Details</summary><div class="ip-more-body">${o.details}</div></details>` : "";
    return `<header class="ip-head"><span class="svc-tag${/^(junction|roundabout|road:)/.test(m.icon) ? " lit" : ""}">${iconFor(m.icon)}</span><span class="ip-t"><span class="ip-tn">${escapeHtml(m.title)}</span>${m.sub ? `<small class="ip-ts">${escapeHtml(m.sub)}</small>` : ""}</span>${m.badge ? `<span class="lv-badge" title="Site level">${m.badge}</span>` : ""}${o.actions ?? ""}</header>
      <p class="ip-st ${st.tone}"${st.title ? ` title="${escapeHtml(st.title)}"` : ""}><i aria-hidden="true"></i><span class="ip-st-t">${escapeHtml(st.text)}</span>${st.tag ? `<span class="ip-tag">${escapeHtml(st.tag)}</span>` : ""}</p>
      ${st.fix ? `<p class="ip-fix${st.show ? " has-show" : ""}"><span>${escapeHtml(st.fix)}</span>${st.show ? `<button class="fchip" data-k="building" data-id="${st.show.id}" title="Select your ${escapeHtml(BUILDING_TYPES[st.show.kind as BuildingKind]?.name ?? "works")} and fly to it">${iconFor(st.show.kind)}<span class="fc-t">Show it</span></button>` : ""}</p>` : ""}
      ${st.act ? `<p class="ip-fixit"><button type="button" class="btn primary ip-act-fix" data-node="${st.act.node}"${st.act.cost > this.app.game.money ? " disabled" : ""}>${escapeHtml(st.act.label)}</button>${st.act.cost > this.app.game.money ? `<span class="small muted">Not enough money</span>` : ""}</p>` : ""}
      ${o.summaryFirst ? `${keys}${lv}${o.lead ?? ""}${flow}` : `${o.lead ?? ""}${keys}${flow}${lv}`}${o.body ?? ""}${details}${o.danger ? `<footer class="ip-foot">${o.danger}</footer>` : ""}`;
  }

  /** The small icon buttons in a panel's header: follow. */
  private actionBtn(cls: string, icon: string, label: string, on?: boolean): string {
    // (`on` given: a toggle, whose state screen readers hear either way)
    return `<button class="ip-act ${cls}${on ? " on" : ""}" aria-label="${label}" title="${label}"${on === undefined ? "" : ` aria-pressed="${on}"`}>${icon}</button>`;
  }

  /**
   * Demolish, at the foot of the panel with its name on it, far from Close in the header (design audit 2026-11-10,
   * F19: the two sat 1 px apart, so a slip on the way to shut the panel pulled down a working site).
   */
  private demolishBtn(what: string): string {
    const armed = this.armed && performance.now() - this.armed < 3000;
    const say = armed ? `Click again to ${what}` : cap(what);
    return `<button class="btn quiet ip-del demolish${armed ? " armed" : ""}" title="${say}. Two clicks, so a slip cannot do it">${ICON.bulldoze}<span>${say}</span></button>`;
  }

  /** Two clicks to pull something down: the first arms the button (it turns brick), the second within 3 s does it. */
  private bindDemolishBtn(fn: () => void) {
    const btn = this.panel.querySelector<HTMLButtonElement>(".ip-del.demolish");
    if (!btn) return;
    btn.onclick = () => {
      if (this.armed && performance.now() - this.armed < 3000) { this.armed = 0; fn(); return; }
      this.armed = performance.now();
      this.sfx.play("click");
      this.lastPanel = "";
      this.fillSel();
      setTimeout(() => { if (this.armed && performance.now() - this.armed >= 3000) { this.armed = 0; this.lastPanel = ""; this.fillSel(); } }, 3100);
    };
  }

  private fillStop(m: PanelModel) {
    const tr = this.app.game.transit, st = tr.stops.get(this.sel!.id)!;
    const lines = [...tr.lines.values()].filter((l) => l.stops.includes(st.id));
    const ls = lines.length ? `<ul class="bus-lines">${lines.map((l) => `<li class="bl"><i class="bl-sw" style="background:${hex(l.color)}"></i><span class="bl-name"><b>${l.name}</b><span class="small muted">${tr.busesOn(l.id)} buses · ${fmtNum(l.riders)} riders/h</span></span></li>`).join("")}</ul>` : "";
    const html = this.anatomy(m, { kind: "stop", danger: this.demolishBtn("remove the stop"), body: ls });
    if (!this.setPanel(html)) return;
    this.bindDemolishBtn(() => { tr.removeStop(st.id); this.sfx.play("remove"); this.closeSelection(); });
  }

  private fillVehicle(m: PanelModel) {
    const g = this.app.game, v = g.traffic.vehicles.find((x) => x.id === this.sel!.id)!;
    const tr = v.trip, h = tr.haul;
    const rows: [string, string][] = [];
    if (h && !h.big) rows.push(["Length", `${Math.round(v.len)} m`]);
    // (a loaded truck's key numbers are its cargo: its speed goes here)
    if (h && h.leg === "out" && !h.big) rows.push(["Speed", `${Math.round(v.v * 3.6)} km/h <span class="muted">· limit ${Math.round(v.edge.speed * 3.6)}</span>`]);
    if (tr.bus) rows.push(["Aboard", plural(tr.bus.pax.length, "rider")]);
    const elapsed = Math.max(0, g.time - tr.startT);
    rows.push(["On the road", `${Math.round((elapsed / HOUR) * 60)} min`]);
    if (tr.freeFlow > 0 && elapsed > tr.freeFlow * 1.15) rows.push(["Held up", `<span class="bad">+${Math.round(((elapsed - tr.freeFlow) / HOUR) * 60)} min</span> <span class="muted">over a clear road</span>`]);
    if (v.block && v.v < 0.5) rows.push(["Standing", escapeHtml(cap(blockWords(v.block)))]);
    const on = v.edge.kind === "lane" ? g.net.segs.get((v.edge as Lane).seg) : undefined;
    if (on) rows.push(["On", `${ROAD_TYPES[on.type].name} · ${Math.round(ROAD_TYPES[on.type].speed * 3.6)} km/h`]);
    const details = `<dl class="facts">${rows.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join("")}</dl>`;
    const following = this.app.following === v.id;
    const html = this.anatomy(m, { kind: "vehicle", details, actions: this.actionBtn("follow", ICON.follow, "Follow with the camera", following) });
    if (!this.setPanel(html)) return;
    const f = this.panel.querySelector<HTMLButtonElement>(".ip-act.follow");
    if (f) f.onclick = () => { this.sfx.play("click"); this.app.followVehicle(this.app.following === v.id ? null : v.id); this.lastPanel = ""; this.fillSel(); };
  }

  private fillRoad(m: PanelModel) {
    const g = this.app.game, id = this.sel!.id, s = g.net.segs.get(id)!, geo = g.net.segGeom.get(id)!, T = ROAD_TYPES[s.type];
    const dirRow = (k: number, name: string) => {
      const f = g.traffic.flow.get(k);
      const lanes = k % 2 === 0 ? T.fwd : T.bwd;
      if (!lanes) return "";
      return `<dt>${name}</dt><dd>${f ? `${plural(f.n, "vehicle")} · ${Math.round(f.speed * 100)}% speed${f.queue ? ` · <span class="bad">${f.queue} queued</span>` : ""}` : "empty"}</dd>`;
    };
    const a = g.net.nodes.get(s.a)!.p, b = g.net.nodes.get(s.b)!.p;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const flowOn = this.app.overlay === "flow";
    const details = `<dl class="facts">
        <dt>Type</dt><dd>${T.name} · ${Math.round(T.speed * 3.6)} km/h</dd>
        <dt>Length</dt><dd>${Math.round(geo.center.length)} m</dd>
        ${dirRow(id * 2, `Toward ${compass(d)}`)}${dirRow(id * 2 + 1, `Toward ${compass({ x: -d.x, y: -d.y })}`)}
        ${s.town !== undefined ? `<dt>Laid by</dt><dd>${escapeHtml(g.towns.byId.get(s.town)?.name ?? "a town")} <span class="muted">· no upkeep</span></dd>` : ""}
      </dl>`;
    const body = `<button class="btn quiet ip-flowbtn" aria-pressed="${flowOn}" title="Traffic flow on every road">${ICON.layers}${flowOn ? "Hide traffic flow" : "Show traffic flow"}</button>`;
    const html = this.anatomy(m, { kind: "road", details, body });
    if (!this.setPanel(html)) return;
    const fb = this.panel.querySelector<HTMLButtonElement>(".ip-flowbtn");
    if (fb) fb.onclick = () => { this.sfx.play("click"); this.app.setOverlay("flow"); this.lastPanel = ""; this.fillSel(); };
  }

  private fillTown(m: PanelModel) {
    const g = this.app.game, t = g.towns.byId.get(this.sel!.id)!;
    const si = sizeOf(t.pop), next = TOWN_SIZES[si + 1];
    // its needs, readable by a child (docs/design.md, 2026-11-08): per product its picture, one word for how it is
    // doing, a bar of loads a day coming against loads a day wanted, and the figure. Every bar is drawn on one scale
    // (the biggest need is the full width), so the need that matters most looks biggest (design audit 2026-11-10, F25).
    const mine = g.towns.buildingsOf(t);
    const stations = mine.filter((b) => BUILDING_TYPES[b.kind].fuel).length;
    const offices = mine.some((b) => Industry.isOffice(b) && b.built >= 1 && !b.abandoned);
    const buyer = (p: Product) => (p === "fuel" && stations ? "Filling stations buy" : p === "machinery" && offices ? "Offices buy" : "Shops buy");
    const joined = !t.spawned || joinedUp(g, t);
    const views = townNeeds(t, t.spawned && joined);
    // (figures only: the status line and the one piece of advice above them do the talking. Owner, 2026-11-10)
    const most = Math.max(1e-6, ...views.map((v) => v.want));
    const rows = views.map((v) => {
      const tip = `${fmtLoads(v.got)} loads a day coming, of the ${fmtLoads(v.want)} it needs to grow. ${buyer(v.p)} up to ${fmtLoads(g.towns.buysPerDay(t.id, v.p))} a day and no more.`;
      const track = Math.max(6, (v.want / most) * 100);
      return `<li class="nd ${v.state}" title="${escapeHtml(tip)}">
          <span class="nd-ic" aria-hidden="true">${productIcon(v.p)}</span>
          <span class="nd-top"><b>${PRODUCTS[v.p].name}</b><span class="nd-st">${v.word}</span></span>
          <span class="nd-bar" aria-hidden="true"><i style="width:${track.toFixed(1)}%"><s style="width:${(v.fill * 100).toFixed(1)}%"></s></i></span>
          <span class="nd-fig"><b>${fmtLoads(v.got)}</b> of ${fmtLoads(v.want)} loads/day</span>
        </li>`;
    }).join("");
    const cn = comingNeeds(t.pop);
    const soon = cn
      ? `<p class="nd-soon">${cn.products.map((p) => `<span class="nd-ic" aria-hidden="true">${productIcon(p)}</span>`).join("")}<span><b>Soon: ${cn.products.map((p) => PRODUCTS[p].name).join(" and ")}</b> <span class="muted">at ${fmtNum(cn.pop)} people</span></span></p>`
      : "";
    const lead = `<h3 class="sub-h nd-h">What it needs</h3><ul class="nds">${rows}</ul>${soon}${townOrders(g, t)}`;
    // what came, by product, and what it was worth
    const sold = (Object.entries(t.yesterday) as [Product, number][]).filter(([, n]) => n > 0);
    const worth = sold.reduce((a, [p, n]) => a + n * PRODUCTS[p].price, 0);
    const deliveries = sold.length
      ? `<dl class="facts">${sold.map(([p, n]) => `<dt>${PRODUCTS[p].name}</dt><dd>${fmtLoads(n)} ${Math.round(n) === 1 ? "load" : "loads"}</dd>`).join("")}<dt class="tot">Worth</dt><dd class="tot">${formatMoney(worth)}</dd></dl>`
      : `<p class="small muted">Nothing</p>`;
    // homes and work, and the blocks waiting for construction parts
    let jobs = 0, rebuilding = 0, waiting = 0, partsLeft = 0;
    for (const b of mine) {
      if (b.zone && ZONE_GROUP[b.zone] === "com") jobs += b.cap;
      if (b.redev && b.built < 1) rebuilding++;
      if (b.site) { waiting++; partsLeft += Math.max(0, (b.site.need.parts ?? 0) - (b.site.got.parts ?? 0)); }
    }
    const hall = g.buildings.byId.get(t.hall);
    const hallLine = hall ? `${BUILDING_TYPES[hall.kind].name}${hall.built < 1 ? ` <span class="muted">· building, ${Math.round(hall.built * 100)}%</span>` : ""}` : "None yet";
    // (the status line says how it grows; here only the mark it moves at, "Grows from 85%")
    const gl = growthOf(t).line, mark = gl.includes(" from ") ? gl.slice(gl.lastIndexOf(", ") + 2) : "";
    const details = `${townChart(t, next)}
      <dl class="facts">
        <dt>Households</dt><dd>${fmtNum(t.households)} <span class="muted">of ${fmtNum(t.homes)} homes</span></dd>
        ${mark ? `<dt>Growth</dt><dd>${escapeHtml(cap(mark))}</dd>` : ""}
        <dt>Shops and offices</dt><dd>${t.shops} <span class="muted">· ${fmtNum(jobs)} jobs</span></dd>
        <dt>Hall</dt><dd>${hallLine}</dd>
        ${rebuilding ? `<dt>Rebuilding</dt><dd>${plural(rebuilding, "site")}</dd>` : ""}
        ${stations ? `<dt>Filling stations</dt><dd>${stations}</dd>` : ""}
        ${waiting ? `<dt>Waiting for parts</dt><dd class="${waiting > 3 ? "bad" : ""}">${plural(waiting, "block")}, ${plural(partsLeft, "load")}</dd>` : ""}
      </dl>
      <h3 class="sub-h">Delivered yesterday</h3>
      ${deliveries}`;
    // (its size, needs met and the track to the next size first, under the status: below the needs they fell past the
    // panel's foot on a big town at 900 px tall. Design audit 2026-11-10, F26)
    this.setPanel(this.anatomy(m, { kind: "town", lead, details, summaryFirst: true }));
  }

  private fillBuilding(b: Building, m: PanelModel) {
    const g = this.app.game;
    const T = BUILDING_TYPES[b.kind];
    const demolish = () => { g.bulldoze([], [b.id]); this.closeSelection(); this.sfx.play("remove"); };
    const act = this.demolishBtn("demolish");
    // (a works with no road to its gate: the road the game would lay to it, with its price and one click)
    const lead = b.plant ? this.roadOffer(b) : "";
    if (b.plant && isPlantKind(b.kind)) {
      const D = PLANTS[b.kind], P = b.plant;
      const chain = `<p class="small muted ip-chain">${chainText(b.kind)}</p>`;
      // a landmark's site: its ring and stage, materials and pieces, and what it will do once open (it is the panel)
      const lmSite = landmarkSite(g, b);
      if (lmSite) {
        if (this.setPanel(this.anatomy(m, { kind: b.kind, danger: act, lead, body: `${chain}${lmSite}` }))) this.bindDemolishBtn(demolish);
        return;
      }
      // a site: the materials trucked to it so far
      if (P.site) {
        const mats = (Object.keys(P.site.need) as Product[]).map((p) => {
          const need = P.site!.need[p]!, got = Math.min(need, P.site!.got[p] ?? 0);
          return `<dt>${PRODUCTS[p].name}</dt><dd>${stockBar(got, need, PRODUCTS[p].color)}<span class="num">${Math.floor(got)} / ${need}</span></dd>`;
        }).join("");
        const body = `<dl class="facts">${mats}</dl><p class="small muted" title="No wages or upkeep until it is built">Then ${buildTime(b.kind) / HOUR} hours to build</p>`;
        if (this.setPanel(this.anatomy(m, { kind: b.kind, danger: act, lead, body: chain + body }))) this.bindDemolishBtn(demolish);
        return;
      }
      const pw = D.power && b.built >= 1 ? g.utilities.supplyOf(b) : null;
      const powerRow = pw === null ? "" : `<dt>Power</dt><dd class="${pw >= 0.999 ? "good" : "bad"}">${pw >= 0.999 ? `${D.power} MW · full` : pw <= 0 ? `none · working at ${Math.round(UNPOWERED * 100)}%` : `${Math.round(pw * 100)}% · working at ${Math.round(powerPace(pw) * 100)}%`}</dd>`;
      const pl = D.makes ? g.utilities.plants.get(b.id) : undefined;
      const plantRows = D.makes ? `<dt>Making</dt><dd>${Math.round(pl?.made ?? 0)} / ${D.makes} MW</dd><dt>Wanted in reach</dt><dd>${Math.round(pl?.used ?? 0)} MW · ${plural(pl?.users ?? 0, "building")}</dd>` : "";
      const store = Industry.storeOf(b);
      const stock = (p: Product, n: number) => `<dt>${PRODUCTS[p].name}</dt><dd>${stockBar(n, store, PRODUCTS[p].color)}<span class="num">${Math.floor(n)}</span></dd>`;
      // (an alternate shows under the input it stands in for: "Slag, for limestone")
      const ins = (Object.keys(D.inputs) as Product[]).map((p) => {
        const a = D.alt?.[p];
        return stock(p, P.stock[p] ?? 0) + (a ? `<dt>${PRODUCTS[a].name}, for ${PRODUCTS[p].name.toLowerCase()}</dt><dd>${stockBar(P.stock[a] ?? 0, store, PRODUCTS[a].color)}<span class="num">${Math.floor(P.stock[a] ?? 0)}</span></dd>` : "");
      }).join("");
      // supplies: a small store it draws down while it works (docs/design.md "Supplies")
      const sup = b.built >= 1 ? g.industry.supplyRows(b) : [];
      const lvl = P.level ?? 1;
      // (what each one in store adds to its pace, as the badge by its gate on the map shows)
      const gains = b.built >= 1 ? g.industry.boosts(b) : [];
      const boost = (p: Product) => {
        const x = gains.find((q) => q.p === p);
        return x ? `<dd class="good boost-gain">+${x.pct}% from ${PRODUCTS[p].name.toLowerCase()}</dd>` : "";
      };
      const supRows = sup.map(({ p, stock: n, now }) => `<dt title="${now ? `Used up as it works at level ${lvl}` : `Needed in store to grow to level ${lvl + 1}`}">${PRODUCTS[p].name}${now ? "" : ` <span class="muted">(level ${lvl + 1})</span>`}</dt><dd>${stockBar(n, SUPPLY_STORE, PRODUCTS[p].color)}<span class="num">${n.toFixed(1)}</span></dd>${boost(p)}`).join("");
      const supNote = sup.some((s) => s.now)
        ? `Drawn down as it works. Out of one, it slips back to the pace of a lower level, never below level 2, until your trucks bring more`
        : `Its next level works through these. It needs them in store to grow`;
      // perishables: what arrived fresh last hour (and all time), and the value lost on the way
      const pct = (a: number, n: number) => `${Math.round((100 * a) / Math.max(1e-9, n))}%`;
      const freshRows = P.last.perish || P.perish
        ? `${P.last.perish ? `<dt>Delivered fresh</dt><dd class="${(P.last.fresh ?? 0) >= P.last.perish * 0.9 ? "good" : "bad"}">${pct(P.last.fresh ?? 0, P.last.perish)} of ${plural(Math.round(P.last.perish), "load")}</dd>` : ""}
          <dt>Spoiled</dt><dd class="${(P.last.spoiled ?? 0) > 0.5 ? "bad" : ""}">${signed(-Math.round(P.last.spoiled ?? 0))}</dd>
          ${P.perish ? `<dt title="Every perishable load it has shipped">Fresh, all time</dt><dd>${pct(P.fresh ?? 0, P.perish)}</dd>` : ""}`
        : "";
      const outs = (Object.keys(D.outputs) as Product[]).map((p) => stock(p, P.out[p] ?? 0)).join("");
      const L = P.last;
      const flare = b.built >= 1 ? Industry.flaring(b) : undefined;
      const logi = D.logistics;
      // its fleet by class: the mix its level runs, up to the best class unlocked (read-only: nothing to pick)
      const mix = D.trucks ? g.industry.mixOf(b) : null;
      const short: Record<TruckClass, [string, string]> = { light: ["light", "light"], heavy: ["heavy", "heavy"], roadtrain: ["road train", "road trains"] };
      const used = mix ? TRUCK_CLASS_ORDER.filter((c) => mix[c] > 0) : [];
      const mixText = mix ? used.map((c) => `${mix[c]} ${short[c][mix[c] === 1 ? 0 : 1]}`).join(" · ") : "";
      const mixBar = mix && used.length > 1 ? `<span class="fm-bar" aria-hidden="true">${used.map((c) => `<i class="fm-${c}" style="flex:${mix[c]}"></i>`).join("")}</span>` : "";
      const next = TRUCK_CLASS_ORDER.find((c) => !g.truckUnlocked(c));
      const loads = TRUCK_CLASS_ORDER.filter((c) => g.truckUnlocked(c)).map((c) => `${TRUCK_CLASSES[c].name.toLowerCase()}s carry ${plural(g.industry.capOf(b, c), "load")}`).join(", ");
      const classTip = `Its level sets the mix: each level swaps light trucks for bigger ones, and a level ${SITE_LEVELS} site runs mostly the biggest. ${cap(loads)}. A truck at the dock waits for a full load, up to an hour, so a big one doesn't set off half empty.${next ? ` ${TRUCK_CLASSES[next].name}s join the mix with the “${unlockedBy((u) => u.trucks?.includes(next))?.name}” milestone.` : ""}`;
      const classRow = D.trucks ? `<dt>Fleet</dt><dd title="${escapeHtml(classTip)}">${used.length > 1 ? plural(g.industry.trucksOf(b), "truck") : mixText}</dd>${mixBar ? `<dd class="fm-row" title="${escapeHtml(classTip)}">${mixBar}<span class="fm-key">${mixText}</span></dd>` : ""}` : "";
      if (logi) {
        const held = Industry.stored(b);
        const body = logi === "warehouse" ? this.warehouseBody(b, store, held) : this.depotBody(b, store);
        const details = `${chain}${body}${D.trucks ? `<dl class="facts">${classRow}</dl>` : ""}`;
        if (this.setPanel(this.anatomy(m, { kind: b.kind, danger: act, lead, details }))) this.bindDemolish(b, demolish);
        return;
      }
      const details = `${chain}
        ${b.built >= 1 ? outputDay(b) : ""}
        ${ins ? `<h3 class="sub-h">In the yard</h3><dl class="facts">${ins}</dl>` : ""}
        ${outs ? `<h3 class="sub-h">Ready to ship</h3><dl class="facts">${outs}</dl>` : ""}
        ${flare ? `<p class="small muted" title="${escapeHtml(`${g.industry.wants(flare) ? `Your ${Industry.takers(flare)} can't take more for now` : Industry.usedBy(flare) ? `Nothing of yours uses it until you build a ${Industry.takers(flare)}` : `Nothing of yours uses it until tier ${Industry.laterTier(flare)}`}. It keeps making ${(Object.keys(D.outputs) as Product[]).filter((p) => p !== flare).map((p) => PRODUCTS[p].name.toLowerCase()).join(" and ")}`)}">Burning off spare ${PRODUCTS[flare].name.toLowerCase()}</p>` : ""}
        ${supRows ? `<h3 class="sub-h" title="${escapeHtml(supNote)}">Supplies</h3><dl class="facts">${supRows}</dl>` : ""}
        ${isMega(b.kind) ? "" : siteLevel(b, sup.filter((s) => !s.now).map((s) => s.p))}
        <h3 class="sub-h">Running it</h3>
        <dl class="facts">
          ${plantRows}${powerRow}${specialRows(g, b, stockBar, false)}
          ${classRow}
          <dt>Staff</dt><dd>${g.people.workersAt(b.id)} / ${b.cap}</dd>
          ${D.deposit ? `<dt>${cap(D.deposit.name)}</dt><dd>${Math.round(P.yld * 100)}% of full yield</dd>` : ""}
        </dl>
        ${parkSection(g, b)}
        <h3 class="sub-h">Last hour</h3>
        <dl class="facts">
          <dt>Made</dt><dd>${L.made} load${L.made === 1 ? "" : "s"}</dd>
          <dt>Earned</dt><dd class="${L.earned > 0 ? "good" : ""}">${signed(L.earned)}</dd>
          <dt>Spent</dt><dd class="${L.spent > 0 ? "bad" : ""}">${signed(-L.spent)}</dd>
          ${freshRows}
        </dl>`;
      const body = isMega(b.kind) ? landmarkDone(g, b) : "";
      if (this.setPanel(this.anatomy(m, { kind: b.kind, danger: act, lead, body, details }))) this.bindDemolishBtn(demolish);
      return;
    }
    if (!b.zone) {
      if (this.setPanel(this.anatomy(m, { kind: "other", danger: act, details: `<p class="muted">${T.blurb}</p>` }))) this.bindDemolishBtn(demolish);
      return;
    }
    const grp = ZONE_GROUP[b.zone];
    const rows: [string, string][] = [];
    // (a block a Town puts up waits for construction parts, trucked in from the company's construction plant)
    if (b.site) for (const p of Object.keys(b.site.need) as Product[]) {
      const need = b.site.need[p]!, got = Math.min(need, b.site.got[p] ?? 0);
      rows.push([`${PRODUCTS[p].name} in`, `${stockBar(got, need, PRODUCTS[p].color)}<span class="num">${Math.floor(got)} / ${need}</span>`]);
    }
    if (grp === "res") {
      const hhs = g.people.hhAt.get(b.id) ?? [];
      let kids = 0, old = 0;
      for (const hh of hhs) for (const c of hh.members) { if (c.age === 0) kids++; else if (c.age !== 1) old++; }
      rows.push(["Children", String(kids)], ["Seniors", String(old)]);
    } else if (grp === "com" && T.fuel) rows.push(["Sells", `${productIcon("fuel")} the town's fuel`]);
    else if (grp === "com") {
      rows.push(["Food on the shelves", stockBar(b.stock, 6)]);
      // (a City's offices and towers take its machinery)
      const tw = b.town !== undefined ? g.towns.byId.get(b.town) : undefined;
      if (Industry.isOffice(b) && tw && needsOf(tw.pop).includes("machinery")) rows.push(["Buys", `${productIcon("machinery")} Machinery`]);
    }
    // (a town's own building: the town puts it up, grows it and replaces it. No land value, level or demolish
    // button here, which were a city-builder's: the Bulldoze tool still clears one out of a road's way. D8)
    const details = rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : undefined;
    const mine = b.town === undefined;
    if (this.setPanel(this.anatomy(m, { kind: grp === "res" ? "home" : "shop", danger: mine ? act : undefined, details })) && mine) this.bindDemolishBtn(demolish);
  }

  /**
   * The road offered to a placed works with no road to its gate (Game.roadTo, review 2026-11-10): how long and what it
   * costs, dashed on the map while the panel is open, and the button that lays it. Empty with a road at its gate.
   */
  private roadOffer(b: Building): string {
    if (!b.placed || b.access) return "";
    const g = this.app.game, plan = g.roadTo(b);
    if (!plan) return `<p class="ip-road small">No road reaches its gate. Draw one with Roads</p>`;
    const short = g.money < plan.cost;
    return `<div class="ip-road"><p class="small" title="A dirt road from its gate to your roads, dashed on the map">Road to its gate: <b>${distText(planLength(plan))}</b>, <b class="num">${formatMoney(plan.cost)}</b></p><button type="button" class="btn ip-roadbtn" data-id="${b.id}"${short ? " disabled" : ""}>${short ? "Not enough money" : "Build this road"}</button></div>`;
  }

  /** Lay the road offered to a works (its panel's button, or its tip's). */
  buildRoadTo(id: number) {
    const g = this.app.game, b = g.buildings.byId.get(id);
    if (!b || !g.roadTo(b)) return;
    const built = g.buildRoadTo(b);
    if (!built) {
      // (worked out afresh: the way may be blocked now, or dearer than the money there is)
      const now = g.roadTo(b);
      this.sfx.play("error");
      this.toast(now && g.money < now.cost ? "Not enough money for that road" : "That road can't be laid now", true);
      this.lastPanel = "";
      if (this.sel) this.fillSel();
      this.renderTips();
      return;
    }
    this.sfx.play("build");
    this.toast(`Dirt road to the ${BUILDING_TYPES[b.kind].name}'s gate built for ${formatMoney(built.cost)}`);
    this.app.offerFor = null;
    this.lastPanel = "";
    if (this.sel) this.fillSel();
    this.renderTips();
  }

  /** A warehouse's panel: what it holds, and per product whether it takes it and whether it is a feeder for it. */
  private warehouseBody(b: Building, store: number, held: number): string {
    const g = this.app.game, P = b.plant!;
    const stock = (Object.keys(P.stock) as Product[]).filter((p) => (P.stock[p] ?? 0) >= 1);
    // the products the company can make by now, and anything already in store
    const made = new Set<Product>(stock);
    for (const k of g.progress.unlocked.buildings) for (const p of Object.keys(PLANTS[k].outputs) as Product[]) made.add(p);
    const list = (Object.keys(PRODUCTS) as Product[]).filter((p) => made.has(p));
    const rows = stock.map((p) => `<dt>${PRODUCTS[p].name}</dt><dd>${stockBar(P.stock[p]!, store, PRODUCTS[p].color)}<span class="num">${Math.floor(P.stock[p]!)}</span></dd>`).join("");
    const takes = (p: Product) => !P.takes || P.takes.includes(p), feeds = (p: Product) => !!P.feeds?.includes(p);
    const opts = list.map((p) => `<tr><th scope="row">${productIcon(p)}${PRODUCTS[p].name}</th>
        <td><label class="wh-hit"><input type="checkbox" class="wh-take" data-p="${p}" aria-label="Take ${escapeHtml(PRODUCTS[p].name.toLowerCase())}" ${takes(p) ? "checked" : ""}></label></td>
        <td><label class="wh-hit"><input type="checkbox" class="wh-feed" data-p="${p}" aria-label="Feeder for ${escapeHtml(PRODUCTS[p].name.toLowerCase())}" ${feeds(p) ? "checked" : ""}></label></td></tr>`).join("");
    return `<h3 class="sub-h">In store <span class="muted num">${Math.floor(held)} / ${store}</span></h3>
      ${rows ? `<dl class="facts">${rows}</dl>` : `<p class="small muted" title="Your works send it what no works or town can take yet">Empty</p>`}
      <h3 class="sub-h" title="Taken products come here only when no works or town wants them. A feeder product comes here first when the warehouse is nearer than its buyers, and its own trucks carry it on">Products</h3>
      <table class="wh-opts"><thead><tr><th scope="col"><span class="sr">Product</span></th><th scope="col" title="Your trucks may bring it here when nothing else will take it">Take</th><th scope="col" title="Sent here first, before plants and towns farther away: it splits a long haul into two legs">Feeder</th></tr></thead><tbody>${opts}</tbody></table>`;
  }

  /** A fuel depot's panel: its fuel, the trucks it filled and what that saved. */
  private depotBody(b: Building, store: number): string {
    const P = b.plant!;
    const fuel = P.stock.fuel ?? 0;
    return `<dl class="facts">
        <dt title="Your trucks whose run passes within ${(DEPOT_REACH / 1000).toFixed(1)} km fill up here at cost while it has fuel. Your refineries' tankers keep it stocked">Fuel</dt><dd>${stockBar(fuel, store, PRODUCTS.fuel.color)}<span class="num">${fuel.toFixed(1)}</span></dd>
        <dt>Trucks filled</dt><dd>${fmtNum(P.served ?? 0)}</dd>
        <dt>Saved on fuel</dt><dd class="${(P.saved ?? 0) > 0 ? "good" : ""}">${formatMoney(Math.round(P.saved ?? 0))}</dd>
        <dt>Last hour</dt><dd>${plural(P.last.served ?? 0, "truck")} · ${formatMoney(Math.round(P.last.saved ?? 0))}</dd>
      </dl>`;
  }


  /** A warehouse's or depot's panel controls, and the demolish button. */
  private bindDemolish(b: Building, demolish: () => void) {
    const g = this.app.game;
    this.bindDemolishBtn(demolish);
    const redraw = () => { this.lastPanel = ""; this.fillSel(); };
    for (const el of this.panel.querySelectorAll<HTMLInputElement>(".wh-take, .wh-feed")) el.onchange = () => {
      const p = el.dataset.p as Product;
      const why = g.setWarehouse(b.id, p, el.classList.contains("wh-take") ? { take: el.checked } : { feed: el.checked });
      if (why) this.toast(why); else { this.sfx.play("click"); redraw(); }
    };
  }

  private fillSignal(m: PanelModel) {
    const g = this.app.game;
    this.panelNode = this.sel!.id;
    const node = g.net.nodes.get(this.panelNode)!;
    const ng = g.net.nodeGeom.get(this.panelNode)!;
    const plan = node.signal;
    // (the phase that is green now gets a green edge in the list, as its roads do on the map)
    const live = plan ? g.traffic.signalNow(this.panelNode) : null;
    const arms = ng.arms;
    const ph = plan ? plan.phases[Math.min(this.panelPhase, plan.phases.length - 1)] : null;
    const spokes = arms.map((a) => {
      const on = ph?.arms.includes(a.seg);
      const x = 50 + a.dir.x * 40, y = 50 + a.dir.y * 40;
      const lx = 50 + a.dir.x * 47 + (Math.abs(a.dir.y) > 0.7 ? 9 : 0), ly = 50 + a.dir.y * 47 + (Math.abs(a.dir.x) > 0.7 ? -8 : 4);
      const stop = !plan && node.stops?.includes(a.seg);
      return `<line x1="50" y1="50" x2="${x}" y2="${y}" stroke="${on ? "#6fae5c" : plan ? "#d4573d" : "#a99f8a"}" stroke-width="10" stroke-linecap="round" ${on || !plan ? "" : 'stroke-dasharray="2 5"'}/>` +
        (stop ? `<polygon points="${octagon(50 + a.dir.x * 30, 50 + a.dir.y * 30, 7)}" fill="#d9302c" stroke="#f3ead6" stroke-width="1.5"/>` : "") +
        `<text x="${lx}" y="${ly}" font-size="10" font-weight="600" fill="#cfc4ab" text-anchor="middle">${compass(a.dir)}</text>`;
    }).join("");
    const diagram = `<svg viewBox="-8 -8 116 116" class="diagram" aria-hidden="true">${spokes}<circle cx="50" cy="50" r="9" fill="#f3ead6" stroke="#0c1524" stroke-width="2"/></svg>`;
    const sigOn = g.featureUnlocked("signals");
    let body = "";
    if (!plan) {
      const stops = node.stops ?? [];
      // (approaches only: not a roundabout's own ring, nor a one-way leading away)
      const stopArms = arms.filter((a) => !g.net.segs.get(a.seg)?.ring && ng.conns.some((c) => c.armIn === a.seg));
      body = `<div class="phase stops" title="Without lights, cars give way by road priority. A stop sign makes an approach stop and give way to all the others. Lights stop traffic in turns and help busy crossings"><span class="ph-name">Stop signs</span><span class="ph-arms">${stopArms.map((a) => `<button class="arm stop-arm ${stops.includes(a.seg) ? "on stop" : ""}" data-seg="${a.seg}" aria-pressed="${stops.includes(a.seg)}" title="Stop sign on this approach">${compass(a.dir)}</button>`).join("")}</span></div>
        <button class="btn primary add-sig" ${sigOn ? "" : "disabled"}>${sigOn ? `Add traffic lights · ${formatMoney(g.lightsCost(this.panelNode))}` : `Traffic lights unlock with ${unlockedBy((u) => u.features?.includes("signals"))!.name}`}</button>`;
    } else {
      const clock = `A fixed clock: ${GREEN} s of green for each phase, ${LEFT_GREEN} s for a left-turn arrow, then amber and a moment of all red. Cars may turn right on red after stopping`;
      body = plan.phases.map((p, i) => `<div class="phase ${i === this.panelPhase ? "on" : ""}${live?.st === 0 && live.i === i ? " live" : ""}" data-i="${i}"${live?.st === 0 && live.i === i ? ` title="Green now"` : ""}>
          <span class="ph-name">${i + 1}. ${p.left ? "Left turns" : "All turns"}<button class="ph-left ${p.left ? "on" : ""}" data-i="${i}" aria-pressed="${!!p.left}" title="Only left turns and U-turns go in this phase">Left only</button></span>
          <span class="ph-arms">${arms.map((a) => `<button class="arm ${p.arms.includes(a.seg) ? "on" : ""}" data-i="${i}" data-seg="${a.seg}" title="Toggle this approach">${compass(a.dir)}</button>`).join("")}</span>
          <span class="ph-dur"><b title="${clock}">${greenFor(p)} s</b></span>
          ${plan.phases.length > 1 ? `<button class="ph-del" data-i="${i}" aria-label="Remove phase">${ICON.close}</button>` : ""}
        </div>`).join("") + `<div class="row"><button class="btn add-ph">+ Add phase</button><button class="btn quiet danger rm-sig">Remove lights</button></div>`;
    }
    // each approach: what is on it, what is queued and how long the first in the queue has stood (the map shows the
    // lights' greens and reds on the same roads)
    const ap = approaches(g, this.panelNode);
    const tones = m.related.segTone ?? {};
    const mark = (seg: number) => { const t = tones[seg]; return t ? `<i class="aw-${t}" aria-hidden="true"></i>` : `<i aria-hidden="true"></i>`; };
    const said = (seg: number) => (tones[seg] === "go" ? "green now" : tones[seg] === "stop" ? "red now" : "");
    const waits = ap.length ? `<h3 class="sub-h">Approaches</h3><dl class="facts ip-waits">${ap.map((a) => {
      const w = a.queue ? ` · <span class="${waitTone(a.wait)}">waiting ${a.wait < 90 ? `${Math.round(a.wait)} s` : `${Math.round(a.wait / 60)} min`}</span>` : "";
      const st = said(a.seg);
      return `<dt>${mark(a.seg)}From the ${compass(a.dir)}${st ? ` <span class="muted">· ${st}</span>` : ""}</dt><dd>${plural(a.cars, "vehicle")}${a.queue ? ` · ${a.queue} queued` : ""}${w}</dd>`;
    }).join("")}</dl>` : "";
    if (!this.setPanel(this.anatomy(m, { kind: "junction", body: `${waits}<div class="ip-sig">${diagram}${body}</div>` }))) return;
    const q = <T extends Element>(s: string) => [...this.panel.querySelectorAll<T & HTMLElement>(s)];
    const redraw = () => { this.lastPanel = ""; this.fillSel(); };
    const set = (p: SignalPlan | null) => { if (!g.setSignal(this.panelNode, p)) this.toast("Not enough money", true); redraw(); };
    q(".add-sig").forEach((b) => (b.onclick = () => { set(g.defaultSignal(this.panelNode)); this.sfx.play("build"); }));
    q(".rm-sig").forEach((b) => (b.onclick = () => set(null)));
    q(".stop-arm").forEach((b) => (b.onclick = () => {
      const seg = +b.dataset.seg!, cur = node.stops ?? [];
      g.setStops(this.panelNode, cur.includes(seg) ? cur.filter((x) => x !== seg) : [...cur, seg]);
      this.sfx.play("build");
      redraw();
    }));
    q(".add-ph").forEach((b) => (b.onclick = () => { const p = clonePlan(plan!); p.phases.push({ arms: [] }); this.panelPhase = p.phases.length - 1; set(p); }));
    q(".phase").forEach((el) => (el.onclick = (e) => { if ((e.target as HTMLElement).closest("button")) return; this.panelPhase = +el.dataset.i!; redraw(); }));
    q(".arm:not(.stop-arm)").forEach((b) => (b.onclick = () => {
      const p = clonePlan(plan!);
      const i = +b.dataset.i!, seg = +b.dataset.seg!;
      const a = p.phases[i].arms;
      p.phases[i].arms = a.includes(seg) ? a.filter((x) => x !== seg) : [...a, seg];
      this.panelPhase = i;
      set(p);
    }));
    q(".ph-left").forEach((b) => (b.onclick = () => {
      const p = clonePlan(plan!);
      const i = +b.dataset.i!;
      p.phases[i].left = !p.phases[i].left || undefined;
      if (!p.phases[i].left) delete p.phases[i].left;
      this.panelPhase = i;
      set(p);
    }));
    q(".ph-del").forEach((b) => (b.onclick = () => { const p = clonePlan(plan!); p.phases.splice(+b.dataset.i!, 1); this.panelPhase = 0; set(p); }));
  }

  // ---------------------------------------------------------------- pause menu, saves

  private showModal(html: string, label: string): HTMLElement {
    this.modal.hidden = false;
    this.modal.innerHTML = `<div class="card dialog" role="dialog" aria-modal="true" aria-label="${label}">${html}</div>`;
    this.modal.onclick = (e) => { if (e.target === this.modal) this.closeModal(); };
    return this.modal.querySelector(".dialog") as HTMLElement;
  }

  /** The pause menu (Esc with nothing else open). The game stops while it is up. */
  openPause() {
    const app = this.app;
    if (!app.game.paused) { app.togglePause(); this.resumeOnClose = true; }
    const co = app.game.company;
    const dlg = this.showModal(`<header class="pm-head pm-co">${heraldSvg(co.herald, co.name, 36)}<span class="pm-co-t">${escapeHtml(co.name)}</span></header>
      <div class="pm-list">
        <button class="pm resume">Resume</button>
        <button class="pm co">Company</button>
        <button class="pm save">Save game</button>
        <button class="pm load">Load game</button>
        <button class="pm keys">Controls</button>
        <button class="pm sound">Sound<span class="pm-v">${soundSummary(app.audio)}</span></button>
        <button class="pm tips" role="switch" aria-label="Tips" aria-checked="${!this.tipPrefs.off}">Tips<span class="pm-v">${this.tipPrefs.off ? "Off" : "On"}</span></button>
        <button class="pm camview"></button>
        <button class="pm nights"></button>
        <button class="pm wheel"></button>
        <button class="pm edge"></button>
        <button class="pm home">Main menu</button>
        <button class="pm new">New company</button>
      </div>`, "Pause menu");
    dlg.classList.add("pause");
    const on = (s: string, fn: () => void) => { (dlg.querySelector(s) as HTMLButtonElement).onclick = () => { this.sfx.play("click"); fn(); }; };
    on(".resume", () => this.closeModal());
    on(".save", () => this.openSaves(true));
    on(".load", () => this.openSaves(false));
    on(".keys", () => this.openKeys());
    on(".sound", () => this.openSound());
    on(".tips", () => {
      // off, or back on with every dismissed tip back too
      const off = !this.tipPrefs.off;
      this.tipPrefs.setOff(off);
      if (!off) this.tipPrefs.reset();
      const b = dlg.querySelector(".tips") as HTMLButtonElement;
      b.setAttribute("aria-checked", String(!off));
      b.querySelector(".pm-v")!.textContent = off ? "Off" : "On";
      this.renderTips();
    });
    // the Camera setting: the Diorama (tilted) or the Map view (straight down). M flips this same setting.
    this.camShow = wireCamera(dlg.querySelector(".camview"), () => app.camView, (v) => app.setCameraView(v), () => this.sfx.play("click"));
    wireNights(dlg.querySelector(".nights"), app.dayCycle, () => this.sfx.play("click"));
    // the Scroll wheel setting: Auto (a mouse wheel zooms, a touchpad's two fingers move the map), Zoom, Pan
    const wb = dlg.querySelector(".wheel") as HTMLButtonElement;
    const showWheel = () => {
      const m = WHEEL_MODES.find((x) => x.id === app.wheel.mode) ?? WHEEL_MODES[0];
      wb.innerHTML = `Scroll wheel<span class="pm-v">${m.name}</span>`;
      wb.title = `${m.blurb}. Click to change.`;
      wb.setAttribute("aria-label", `Scroll wheel: ${m.name}. ${m.blurb}. Click to change.`);
    };
    wb.onclick = () => {
      this.sfx.play("click");
      const i = WHEEL_MODES.findIndex((x) => x.id === app.wheel.mode);
      app.wheel.mode = WHEEL_MODES[(i + 1) % WHEEL_MODES.length].id;
      app.wheel.reset();
      saveWheelMode(app.wheel.mode);
      showWheel();
    };
    showWheel();
    wireEdgeScroll(dlg.querySelector(".pm.edge"), () => app.edgeScroll, (v) => { app.edgeScroll = v; saveEdgeScroll(v); }, () => this.sfx.play("click"));
    on(".pm.co", () => this.openCompany("pause"));
    on(".home", () => {
      if (app.mode === "play") app.saves.autosave(app.game);
      this.resumeOnClose = false;
      this.closeModal();
      app.openMenu?.();
    });
    on(".new", () => {
      const b = dlg.querySelector(".new") as HTMLButtonElement;
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Start a new company? This one is autosaved"; b.classList.add("danger"); return; }
      if (app.mode === "play") app.saves.autosave(app.game);
      app.newGame(1 + Math.floor(Math.random() * 9999));
      app.setMode("play");
      this.resumeOnClose = false;
      this.closeModal();
      this.tutHidden = false;
      this.toast(app.saves.latest() ? "New company. Your last one is in the autosaves." : "New company");
      this.openCompany("new");
    });
    requestAnimationFrame(() => (dlg.querySelector(".resume") as HTMLButtonElement).focus());
  }

  private backButton(dlg: HTMLElement) {
    const b = h("button", "btn quiet back", `${ICON.caret}<span>Back</span>`);
    b.onclick = () => (this.app.mode === "menu" ? this.closeModal() : this.openPause());
    dlg.prepend(b);
  }

  /** What's new: every release, newest first, scrolling back to the first. */
  openNews(back = true) {
    const when = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const rels = CHANGELOG.map((r, i) => `<section class="cl-rel${i === 0 ? " latest" : ""}">
        <h3><span class="cl-v">${r.v}</span><span class="cl-t">${escapeHtml(r.title)}</span><time datetime="${r.date}">${when(r.date)}</time></h3>
        <ul>${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
      </section>`).join("");
    const dlg = this.showModal(`<header>What's new</header><div class="cl-list" tabindex="0" aria-label="Updates, newest first">${rels}</div>`, "What's new");
    dlg.classList.add("news");
    if (back) this.backButton(dlg);
  }

  /** Sound: the four volumes, Mute, the wireless's tone (ui/soundPanel.ts). */
  openSound() {
    const dlg = this.showModal(`<header>Sound</header>${soundHtml(this.app.audio)}`, "Sound");
    dlg.classList.add("sound");
    this.backButton(dlg);
    wireSound(dlg, this.app.audio, () => this.sfx.play("click"));
  }

  openKeys() {
    const dlg = this.showModal(`<header>Controls</header><dl class="keys">${KEYS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join("")}</dl>`, "Controls");
    this.backButton(dlg);
  }

  openSaves(saving = true) {
    const app = this.app;
    if (this.modal.hidden && !app.game.paused) { app.togglePause(); this.resumeOnClose = true; }
    const list = app.saves.list();
    const g = app.game;
    const dlg = this.showModal(`<header>${saving ? "Save game" : "Load game"}</header>
      ${saving ? `<form class="save-row"><input name="n" maxlength="40" autocomplete="off" aria-label="Save name" value="${escapeHtml(g.cityName)}"><button class="btn primary" type="submit">Save</button></form>` : ""}
      <ul class="save-list">${list.map((m) => {
        const old = (m.v ?? 1) !== SAVE_V;
        return `<li data-id="${m.id}">
          ${m.thumb ? `<img src="${m.thumb}" alt="" width="96" height="60">` : `<span class="thumb-empty"></span>`}
          <span class="save-meta"><b>${escapeHtml(m.name)}</b>${m.company ? `<span class="save-co">${heraldSvg(m.company.herald, m.company.name, 16)}${escapeHtml(m.company.name)}</span>` : ""}<span>${old ? "Older version: can't be loaded" : `${plural(m.level, "milestone")} · ${fmtNum(m.residents)} people · ${fmtTime(m.playtime)} played`}</span></span>
          ${saving ? "" : `<button class="btn load" ${old ? "disabled" : ""}>Load</button>`}${m.auto ? "" : `<button class="btn icon-btn del" aria-label="Delete save" title="Delete save">${ICON.bulldoze}</button>`}
        </li>`;
      }).join("") || `<li class="muted">No saves yet. The game autosaves every minute.</li>`}</ul>`, saving ? "Save game" : "Load game");
    this.backButton(dlg);
    const form = dlg.querySelector("form") as HTMLFormElement | null;
    if (form) form.onsubmit = (e) => {
      e.preventDefault();
      const name = ((dlg.querySelector("input") as HTMLInputElement).value || "City").trim();
      const m = app.saves.save(g, name);
      this.toast(m ? "Game saved" : "Couldn't save: browser storage is full", !m);
      this.openSaves(true);
    };
    for (const li of dlg.querySelectorAll<HTMLLIElement>("li[data-id]")) {
      const load = li.querySelector(".load") as HTMLButtonElement | null;
      if (load) load.onclick = () => {
        const d = app.saves.load(li.dataset.id!);
        if (!d) { this.toast("That save is unreadable", true); return; }
        try { app.loadGame(d, app.saves.viewOf(li.dataset.id!)); } catch { this.toast("That save is from an older version", true); return; }
        app.setMode("play");
        this.resumeOnClose = false;
        this.closeModal();
        this.toast("Loaded");
      };
      const del = li.querySelector(".del") as HTMLButtonElement | null;
      if (del) del.onclick = () => {
        if (del.dataset.armed) { app.saves.remove(li.dataset.id!); this.openSaves(saving); return; }
        del.dataset.armed = "1";
        del.classList.add("danger");
        del.innerHTML = "Delete?";
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.classList.remove("danger"); del.innerHTML = ICON.bulldoze; } }, 2500);
      };
    }
    (dlg.querySelector("input, .load:not(:disabled), .back") as HTMLElement | null)?.focus();
  }
}

function cubicLength(s: { c: { p0: V2; p1: V2; p2: V2; p3: V2 } }): number {
  const { p0, p1, p2, p3 } = s.c;
  let len = 0, px = p0.x, py = p0.y;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    len += Math.hypot(x - px, y - py);
    px = x; py = y;
  }
  return len;
}

/** A town's people over the last days (hourly), with the size it is heading for as a dashed line when it is near. */
function townChart(t: Town, next: (typeof TOWN_SIZES)[number] | undefined): string {
  const vs = [...t.hist.pop, t.pop];
  if (vs.length < 6) return "";
  const W = 248, H = 78, top = 12, bot = 62;
  const hi0 = Math.max(...vs);
  const goal = next && next.pop < Math.max(hi0, 40) * 1.6 ? next.pop : null;
  const hi = niceCeil(Math.max(hi0, goal ?? 0, 10));
  const y = (v: number) => bot - (v / hi) * (bot - top);
  const x = (i: number) => (i / (vs.length - 1)) * W;
  const pts = vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const hrs = vs.length - 1;
  const span = hrs >= 48 ? `${Math.round(hrs / 24)} days` : `${hrs} hours`;
  const goalLine = goal ? `<line class="tc-goal" x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/><text class="tc-t" x="2" y="${y(goal) - 3}">${next!.name}, ${fmtNum(goal)}</text>` : "";
  return `<svg class="tn-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t.name)}'s people over the last ${span}: from ${fmtNum(vs[0])} to ${fmtNum(t.pop)}">
    <line class="tc-grid" x1="0" x2="${W}" y1="${top}" y2="${top}"/><line class="tc-base" x1="0" x2="${W}" y1="${bot}" y2="${bot}"/>
    <text class="tc-t" x="${W}" y="${top - 3}" text-anchor="end">${hi >= 10000 ? `${hi / 1000}k` : fmtNum(hi)} people</text>
    ${goalLine}
    <polyline class="tc-line" points="${pts}"/>
    <circle class="tc-dot" cx="${x(vs.length - 1)}" cy="${y(t.pop)}" r="2.5"/>
    <text class="tc-t" x="0" y="${H - 2}">${span} ago</text><text class="tc-t" x="${W}" y="${H - 2}" text-anchor="end">now</text>
  </svg>`;
}

/**
 * What a plant makes a day: per product, the loads made over the last day and what it can make at its level, fully
 * staffed and powered; under it, its main product hour by hour against that pace.
 */
function outputDay(b: Building): string {
  const D = PLANTS[b.kind as PlantKind];
  const ps = (Object.keys(D.outputs) as Product[]);
  if (!ps.length) return "";
  const rows = ps.map((p) => {
    const m = Industry.madeLately(b, p), can = Industry.perDay(b, p) * Math.min(1, Math.max(m.hours, 1) / HIST_HOURS);
    const made = m.hours ? fmtNum(Math.round(m.made)) : "–";
    const share = m.hours >= HIST_HOURS && can > 0 ? m.made / can : null;
    const cls = share === null ? "" : share >= 0.8 ? "good" : share < 0.4 ? "bad" : "";
    return `<dt>${PRODUCTS[p].name}</dt><dd><b class="num pd-made ${cls}">${made}</b><span class="muted"> of ${fmtNum(Math.round(can))} it can make</span></dd>`;
  }).join("");
  const m = Industry.madeLately(b, ps[0]);
  const hrs = m.hours;
  const head = hrs >= HIST_HOURS ? "A day, last 24 hours" : hrs ? `Its first ${plural(hrs, "hour")}` : "Its first hour";
  // (nothing made yet: one line instead of an empty chart)
  const any = ps.some((p) => Industry.madeLately(b, p).made > 0);
  const chart = any ? hourBars(m.byHour, Industry.perDay(b, ps[0]) / 24, PRODUCTS[ps[0]]) : `<p class="small muted">No output yet.</p>`;
  return `<h3 class="sub-h">${head}</h3><dl class="facts">${rows}</dl>${chart}`;
}

/** A bar filled to n of max, in a product's colour, on a dim track. */
function ratioBar(n: number, max: number, color: number): string {
  const k = max > 0 ? Math.max(0, Math.min(1, n / max)) : 0;
  return `<span class="pd-bar" style="--pc:${onPlate(color)}" aria-hidden="true"><i style="width:${(k * 100).toFixed(1)}%"></i></span>`;
}

/** Bars of loads made each hour (oldest left), with the full pace as a dashed line. */
function hourBars(vs: number[], pace: number, P: { name: string; color: number }): string {
  if (vs.length < 2) return "";
  const W = 248, H = 60, top = 18, bot = 46, n = HIST_HOURS;
  const hi = niceCeil(Math.max(1, pace * 1.15, ...vs));
  const y = (v: number) => bot - (v / hi) * (bot - top);
  const bw = W / n;
  const x0 = (n - vs.length) * bw;
  const bars = vs.map((v, i) => v > 0 ? `<rect x="${(x0 + i * bw + 1).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(bot - y(v)).toFixed(1)}"/>` : "").join("");
  const pl = y(pace);
  const total = vs.reduce((a, v) => a + v, 0);
  return `<svg class="tn-chart hb-chart" style="--pc:${onPlate(P.color)}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${P.name} made each hour over the last ${vs.length} hours: ${fmtNum(Math.round(total))} loads, against a full pace of ${pace.toFixed(1)} an hour">
    <line class="tc-base" x1="0" x2="${W}" y1="${bot}" y2="${bot}"/>
    ${bars}
    <line class="tc-goal" x1="0" x2="${W}" y1="${pl.toFixed(1)}" y2="${pl.toFixed(1)}"/>
    <text class="tc-t" x="${W}" y="9" text-anchor="end">dashed: full pace, ${fmtNum(Math.round(pace * 24))} loads a day</text>
    <text class="tc-t" x="0" y="${H - 2}">${n} hours ago</text><text class="tc-t" x="${W}" y="${H - 2}" text-anchor="end">now</text>
  </svg>`;
}

/** A round number at or above v, for a chart's top line: 10, 15, 20, 30, 40, 50, 60, 80, 100… */
function niceCeil(v: number): number {
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (k * m >= v) return k * m;
  return 10 * m;
}

/** A tiny line of a town's people (the Towns list). */
/** A chart of the last hours, hidden until there are 6 of them; its ends in words under it: "People, last 30 hours: 120 → 450". */
function sparkline(vs: number[], what: string, fmt: (n: number) => string): string {
  if (vs.length < 6) return "";
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(1, hi - lo);
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * 220},${38 - ((v - lo) / span) * 34}`).join(" ");
  return `<svg class="spark" viewBox="0 -2 220 42" preserveAspectRatio="none" role="img" aria-label="${what} over the last ${vs.length} hours"><polyline points="${pts}" fill="none" stroke="#2373c4" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg><p class="muted small">${what}, last ${vs.length} hours: ${fmt(Math.round(vs[0]))} → ${fmt(Math.round(vs[vs.length - 1]))}</p>`;
}

function rbIcon(size: RoundaboutSize): string {
  const r = 4 + size * 1.6, w = 1.6 + size * 0.5;
  return `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false"><path d="M14 1 v${14 - r - 1} M14 ${14 + r + 1} V27 M1 14 h${14 - r - 1} M${14 + r + 1} 14 H27" stroke="#cfc4ab" stroke-width="3.4"/><circle cx="14" cy="14" r="${r}" fill="#6f8a45" stroke="#f3ead6" stroke-width="${w}"/></svg>`;
}

function stockBar(n: number, max: number, color?: number): string {
  const k = Math.max(0, Math.min(max, Math.floor(n)));
  const st = color === undefined ? "" : ` style="--pc:${onPlate(color)}"`;
  // (a big store shows as 12 pips, each a share of it)
  const pips = Math.min(max, 12), on = Math.round((k / Math.max(1, max)) * pips);
  return `<span class="pips" role="img" aria-label="${k} of ${max}"${st}>${Array.from({ length: pips }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("")}</span>`;
}

/** A company site's level, how far it is to the next, and what holds it back. */
/**
 * A level bar with both ends named: "Level 1 ━━━━──── Level 2", filled `pct` of the way (owner, 2026-11-08: a bar
 * with only the next level on it read as the level it is). With no next level: "Level 4 · top level".
 */
function levelRun(from: string, to: string | undefined, pct: number): string {
  if (to === undefined) return `<span class="lvr-k lvr-top">${escapeHtml(from)} · top level</span>`;
  const p = Math.round(pct * 100);
  return `<span class="lvr-k">${escapeHtml(from)}</span><span class="bar lvr-bar" role="progressbar" aria-label="${escapeHtml(`${from} to ${to}`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${Math.max(2, p)}%"></i></span><span class="lvr-k lvr-to">${escapeHtml(to)}</span>`;
}

function siteLevel(b: Building, next: Product[] = []): string {
  const P = b.plant;
  if (!P || !b.placed || b.built < 1) return "";
  const L = P.level ?? 1;
  const mult = `×${LEVEL_MULT[L - 1]} output, jobs and trucks`;
  if (L >= SITE_LEVELS) return `<h3 class="sub-h">Site level ${L} of ${SITE_LEVELS}</h3><p class="small muted">Fully grown, ${mult}</p>`;
  // (its track to the next level is the panel's level line above, with what holds it: here only what a level gives)
  const tip = "A works grows while it runs near capacity, ships its output and gets its inputs";
  return `<h3 class="sub-h" title="${tip}">Site level ${L} of ${SITE_LEVELS}</h3>
    <p class="small muted">Now ${mult}. Level ${L + 1} gives ×${LEVEL_MULT[L]}</p>${next.length ? `<p class="small muted">Grows once it has ${productList(Object.fromEntries(next.map((p) => [p, 1])))} in store</p>` : ""}`;
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** Seconds without moving before a vehicle counts as standing still in the Traffic window. */
const STANDING_S = 15;

/** Where a works stands, to tell it from the others of its kind: "600 m north-east of Alder Run". */
function whereIs(g: Game, b: Building): string {
  let t: Town | null = null, bd = Infinity;
  for (const x of g.towns.list) { const d = Math.hypot(x.c.x - b.c.x, x.c.y - b.c.y); if (d < bd) { bd = d; t = x; } }
  if (!t) return "";
  return `${bd < 950 ? `${Math.round(bd / 50) * 50} m` : `${(bd / 1000).toFixed(1)} km`} ${compassWords(t.c, b.c)} of ${t.name}`;
}

/** The view (half its height, m) a panel chip flies in to when its works is clicked from far out. */
const CHIP_HALF_H = 420;
const fmtLoads = (n: number) => (n < 10 && n % 1 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));

function productList(o: Partial<Record<Product, number>>): string {
  return (Object.keys(o) as Product[]).map((p) => PRODUCTS[p].name.toLowerCase()).join(" and ");
}

/** What a plant takes and makes: "Fertile soil → crops", "Crops → food". */
function chainText(k: keyof typeof PLANTS): string {
  const D = PLANTS[k];
  if (D.logistics === "warehouse") return "Any product → stored, shipped on";
  if (D.logistics === "depot") return "Fuel → your trucks, at cost";
  // (a landmark makes nothing to ship: the dam turns the river into power, the others are one of a kind)
  if (D.mega) return D.makes ? "Landmark · the river → power" : "Landmark · one of a kind";
  const to = D.makes ? "power" : productList(D.outputs);
  // (a mine digs what its deposit is: "Coal deposit → coal", not "Coal → coal")
  // (an alternate input reads "limestone or slag")
  const ins = (Object.keys(D.inputs) as Product[]).map((p) => PRODUCTS[p].name.toLowerCase() + (D.alt?.[p] ? ` or ${PRODUCTS[D.alt[p]!].name.toLowerCase()}` : "")).join(" and ");
  const from = D.deposit ? `${cap(D.deposit.name)}${D.deposit.name === to ? " deposit" : ""}` : cap(ins);
  return `${from} → ${to}`;
}

/** A site's materials, short: "30 planks, 20 cement". */
function siteShort(o: Partial<Record<Product, number>>): string {
  return (Object.entries(o) as [Product, number][]).map(([p, n]) => `${n} ${PRODUCTS[p].name.toLowerCase()}`).join(", ");
}

/** A road's lanes as small arrows, the way they run: one down and one up for a street, two up for a one-way. */
function laneArrows(fwd: number, bwd: number): string {
  let d = "", x = 3;
  for (let i = 0; i < bwd; i++, x += 6) d += `M${x} 2V10M${x - 2.2} 7.4L${x} 10L${x + 2.2} 7.4`;
  if (bwd) x += 2;
  for (let i = 0; i < fwd; i++, x += 6) d += `M${x} 10V2M${x - 2.2} 4.6L${x} 2L${x + 2.2} 4.6`;
  const w = x - 3;
  return `<svg class="fl-lanes" viewBox="0 0 ${w} 12" width="${w}" height="12" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

const FLOW_TO = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1.5 6H10M6.8 2.8L10 6L6.8 9.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
// (the ground an extractor stands on: a plot seen from above, hatched)
const FLOW_GROUND = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5L14.5 8L8 13.5L1.5 8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 8L8 10.6M8 5.4L11 8" stroke="currentColor" stroke-width="1.2"/></svg>`;

/**
 * What a works takes and makes, as a row of pictures for its catalog card: "crops → food", "ground → coal",
 * "ore, coal → steel, slag" (play-test 2026-11-09, D1: "two icons on each card (in → out)"). The words are in the
 * catalog's line and the card's label, never the pictures alone.
 */
function flowIcons(k: PlantKind): string {
  const D = PLANTS[k];
  const ic = (p: Product) => `<i>${productIcon(p)}</i>`;
  const to = `<i class="fl-to">${FLOW_TO}</i>`;
  if (D.logistics === "warehouse") return `<span class="fl-spec">Stores any load</span>`;
  if (D.logistics === "depot") return `${ic("fuel")}${to}<i class="fl-big">${ICON.truck}</i>`;
  if (D.mega) return D.makes ? `<span class="fl-spec">River</span>${to}<i class="fl-big">${ICON.power}</i>` : `<span class="fl-spec">One of a kind</span>`;
  const ins = D.deposit ? `<i class="fl-ground">${FLOW_GROUND}</i>` : (Object.keys(D.inputs) as Product[]).map(ic).join("");
  const outs = D.makes ? `<i class="fl-big">${ICON.power}</i>` : (Object.keys(D.outputs) as Product[]).map(ic).join("");
  return `${ins}${to}${outs}`;
}

/** A site's materials: "6 loads of planks". */
function siteText(o: Partial<Record<Product, number>>): string {
  return (Object.entries(o) as [Product, number][]).map(([p, n]) => `${plural(n, "load")} of ${PRODUCTS[p].name.toLowerCase()}`).join(" and ");
}

/** Which way a town is heading, in the word that leads its panel's growth line (the Towns list: needs.ts growthOf). */
function trendOf(t: Town): { short: string; cls: string } {
  const gr = growthOf(t);
  return { short: gr.word, cls: gr.tone };
}

/** A time of day as the clock shows it, to the minute: "08:07". */
export function clockText(hr: number): string {
  const m = Math.floor((((hr % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function clonePlan(p: SignalPlan): SignalPlan {
  return { phases: p.phases.map((x) => ({ ...x, arms: [...x.arms] })) };
}

/** A small Deco compass rose for a new town's banner: its needle points `a` radians clockwise from screen up. */
function spawnCompass(a: number): string {
  const deg = (a * 180) / Math.PI;
  return `<svg class="nt-rose" viewBox="-24 -24 48 48" width="48" height="48" aria-hidden="true">
    <circle r="21" fill="var(--plate-2)" stroke="var(--ochre)" stroke-width="2"/>
    <circle r="16" fill="none" stroke="var(--pin)" stroke-width="1"/>
    ${[0, 90, 180, 270].map((d) => `<path d="M0 -21 V-17" stroke="var(--cream-3)" stroke-width="2" transform="rotate(${d})"/>`).join("")}
    <g transform="rotate(${deg.toFixed(1)})"><path d="M0 -17 L5 2 L0 -2 L-5 2 Z" fill="var(--ochre-hi)"/><path d="M0 12 L4 2 L0 -2 L-4 2 Z" fill="var(--cream-3)"/></g>
    <circle r="2.4" fill="var(--brick)"/></svg>`;
}

function compass(d: V2): string {
  const a = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const names = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** SVG points of a stop-sign octagon centred on (cx, cy). */
function octagon(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 8; k++) {
    const t = Math.PI / 8 + (k * Math.PI) / 4;
    pts.push(`${(cx + Math.cos(t) * r).toFixed(1)},${(cy + Math.sin(t) * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Whether a kind's Details are open (remembered per kind; the browser may refuse storage: then shut). */
function moreOpen(kind: string): boolean {
  try { return localStorage.getItem(`flowtown.more.${kind}`) === "1"; } catch { return false; }
}

function setMoreOpen(kind: string, open: boolean) {
  try { localStorage.setItem(`flowtown.more.${kind}`, open ? "1" : "0"); } catch { /* private window: not remembered */ }
}

/** The header icon of a panel model's kind. */
/** A selector that finds the same control again after the panel is redrawn (by class and data keys). */
function focusKey(el: HTMLElement): string | null {
  const cls = [...el.classList].filter((c) => c !== "on" && c !== "armed").map((c) => `.${CSS.escape(c)}`).join("");
  if (!cls && !el.tagName) return null;
  const data = Object.entries(el.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(v ?? "")}"]`).join("");
  return `${el.tagName.toLowerCase()}${cls}${data}`;
}

/** What productIcon draws for a product without a picture of its own. */
const NO_PRODUCT_ICON = productIcon("");

function iconFor(k: string): string {
  if (k === "town") return ICON.town;
  if (k.startsWith("product:")) return productIcon(k.slice(8));
  if (k === "water") return ICON.water;
  if (k === "hills") return ICON.hills;
  if (k === "stuck") return ICON.stuck;
  if (k === "truck" || k === "convoy") return ICON.truck;
  if (k === "car") return ICON.sedan;
  if (k === "bus") return ICON.busCat;
  if (k === "stop") return ICON.busStop;
  if (k === "junction") return ICON.junction;
  if (k === "roundabout") return ICON.roundabout;
  if (k.startsWith("road:")) return roadIcon(k.slice(5) as RoadTypeId);
  return isPlantKind(k) ? placedIcon(k) : buildingIcon(k as BuildingKind, "");
}
