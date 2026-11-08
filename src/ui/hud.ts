import { BUILDING_TYPES, LEVEL_H, MAX_LEVEL, ROAD_TYPES, SIGNAL_COST, type BuildingKind, type RoadTypeId } from "../config";
import { wireNights } from "./nightsSetting";
import { formatMoney, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { LEVEL_LV, ZONE_GROUP } from "../game/growables";
import { MILESTONES, unlockedBy, type Milestone, type Unlocks } from "../game/progression";
import { BUILD_TIME, DEPOT_REACH, HIST_HOURS, Industry, PLANTS, PRODUCTS, MIN_DEPOSIT, SUPPLY_STORE, UNPOWERED, isPlantKind, powerPace, type PlantKind, type Product } from "../game/industry";
import { TRUCK_CLASSES, TRUCK_CLASS_ORDER, type TruckClass } from "../game/trucks";
import { LEVEL_MULT, SITE_LEVELS, growNeed } from "../game/sites";
import { MARKET, type Town } from "../game/settlements";
import { HALLS, SUPPLY_COVER, TOWN_SIZES, needFrom, needsOf, sizeOf } from "../game/towns";
import { HOUR } from "../game/society";
import { PAL } from "../render/palette";
import { F } from "../world/gen";
import { DEPOSIT_KINDS } from "./depositMarks";
import type { SignalPlan } from "../roads/network";
import { GREEN, LEFT_GREEN, greenFor } from "../sim/traffic";
import { ROAD_MODES, type App, type OverlayId, type RoadMode, type ToolId } from "../app";
import { ROUNDABOUTS, type RoundaboutSize } from "../roads/planner";
import { ICON, buildingIcon, placedIcon, productIcon, roadIcon } from "./icons";
import { TradeLedger, approaches, extractorFor, modelOf, sameSel, waitTone, type FlowChip, type PanelModel, type Sel } from "./inspect";
import { comingNeeds, growthOf, townNeeds, type NeedView } from "./needs";
import type { Lane } from "../roads/network";
import { CHANGELOG } from "../changelog";
import { PLACED, PLACED_TABS, type PlacedKind } from "../game/placed";
import { GATE_LINK_REACH, SAVE_V } from "../game/city";
import { BUS_UPKEEP, STOP_COST } from "../game/transit";
import { Sfx } from "./sfx";
import { heraldSvg } from "./herald";
import { cleanName, COMPANY_NAME_MAX, randomHerald } from "../game/company";
import { companyName } from "../game/names";
import { landmarkDone, landmarkSite, parkSection, seasonLine, specialRows } from "./specials";
import { MEGAS, isMega } from "../game/megaprojects";
import { TipPrefs, joinedUp, tipFor } from "./tips";
import { nextTown } from "./nextTown";

export interface Chip {
  text: string;
  kind: "info" | "error" | "cost";
  icon?: keyof typeof ICON;
}

const OVERLAYS: { id: OverlayId; label: string; blurb: string }[] = [
  { id: "flow", label: "Traffic flow", blurb: "How fast each road moves compared with its speed limit" },
  { id: "resources", label: "Resources", blurb: "Where each extractor can work, tagged on the map. Click a kind below to fly to its nearest deposit" },
  { id: "landvalue", label: "Land value", blurb: "Higher value lets buildings level up" },
  { id: "level", label: "Building level", blurb: "Buildings grow from level 1 to 5" },
  { id: "problems", label: "Problems", blurb: "Plants and buildings with something holding them up" },
  { id: "power", label: "Power", blurb: "Power plants in blue; buildings that draw power green with all they need, orange to red when short" },
];

/** Build categories along the bottom bar, each with its asset tabs (the Towns button beside them opens the Towns window: towns spring up by themselves). */
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
      { id: "junctions", label: "Intersections", assets: [1, 2, 3, 4].map((s) => ({ kind: "roundabout", size: s as RoundaboutSize }) as Asset).concat([{ kind: "lane" }, { kind: "junction" }]) },
    ],
  },
  industry: {
    label: "Industry",
    tabs: PLACED_TABS.map((t) => ({ id: t.id, label: t.label, assets: t.kinds.map((id) => ({ kind: "placed", id }) as Asset) })),
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
type Banner = { m: Milestone; towns?: number[] } | { town: number; size: number } | { landmark: number } | { spawned: number; from: number | null; dist: number; dir: string };
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(Math.round(n)))}`;
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
  ["Esc", "Back: close a panel, drop the tool, then the pause menu"],
  ["Right click", "Undo the last click of a road; again to drop the tool"],
  ["W A S D / drag", "Move the camera"],
  ["Q / E", "Rotate the camera"],
  ["R / F, wheel", "Zoom in / out (placing a building: the wheel turns it, Shift + wheel by 1°, Ctrl + wheel zooms)"],
  ["Tab", "Next road mode: curve, straight, upgrade"],
  ["Page Up / Down", "Raise or lower the road (bridges over water and motorways rise on their own)"],
  ["[ / ]", "Parallel road spacing"],
  [", / .", "Turn the building you are placing 15° (with Shift: 1°)"],
  ["Shift", "15° angle steps while drawing"],
  ["Alt (hold)", "Ignore snapping and guides for a moment"],
  ["B", "Bulldozer"],
  ["L", "Add lane (Shift or right click removes)"],
  ["P / Z / C / X", "Progression / Economy / Towns / Transport"],
  ["Space, 1 2 3", "Pause, game speed"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["F5 / F9", "Quicksave / quickload"],
  ["`", "Hide the interface"],
  ["G", "Follow the truck nearest the middle of the screen (again, or Esc, lets go)"],
  ["T / Shift+T", "Tour camera / Vehicle cam (any key or click comes back)"],
];

export class Hud {
  root = h("div", "hud");
  // bottom bar
  private bbar = h("footer", "bbar");
  private cityName = h("button", "cb-city");
  private popEl = h("span", "cb-pop");
  private moneyBtn = h("button", "cb-money");
  private clockEl = h("span", "cb-clock");
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
  /** "Following · Heavy truck · Coal to the Smelter · Stop", above the bar while the camera follows a vehicle */
  private followEl = h("div", "card follow-chip");
  private toastBox = h("div", "toasts");
  private modal = h("div", "modal");
  private rectEl = h("div", "selrect");
  private banner = h("section", "card banner");
  /** the company's name and herald, top left by the menu (click: rename it) */
  private companyEl = h("button", "company");
  private companyKey = "";
  private compass = h("button", "btn icon-btn compass");
  private compassRot = NaN;
  private undoBtn = h("button", "cat hist");
  private redoBtn = h("button", "cat hist");
  private catBtns = new Map<string, HTMLButtonElement>();
  private cat: CatId | null = null;
  private tab: Record<CatId, string> = { roads: "small", industry: "extraction", transport: "bus" };
  private lastRoad: RoadTypeId = "dirt";
  private winKind: WinId | null = null;
  /** the one thing selected on the map (its panel is open top right) */
  private sel: Sel | null = null;
  /** who trades with whom lately (the panels' flow chips) */
  private ledger = new TradeLedger();
  /** when the panel's demolish button was armed (a second click within 3 s pulls it down) */
  private armed = 0;
  private panelNode = -1;
  private panelPhase = 0;
  private tutHidden = false;
  /** tips off, and the ones dismissed (kept per browser) */
  private tipPrefs = new TipPrefs();
  private lastPanel = "";
  private lastWin = "";
  private lastAssets = "";
  private resumeOnClose = false;
  private sfx = new Sfx();

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
    const tlb = (k: WinId | "menu", icon: string, title: string, fn: () => void) => {
      const b = h("button", "tlb", icon);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = () => { fn(); this.sfx.play("click"); };
      this.tlBtns.set(k, b);
      row.appendChild(b);
    };
    tlb("menu", ICON.menu, "Pause menu (Esc)", () => this.openPause());
    this.companyEl.title = "Your company: rename it, change its badge";
    this.companyEl.onclick = () => { this.sfx.play("click"); this.openCompany(); };
    row.appendChild(this.companyEl);
    row.appendChild(h("span", "tl-sep"));
    tlb("info", ICON.layers, "Info views", () => this.toggleWin("info"));
    tlb("progression", ICON.flag, "Progression (P)", () => this.toggleWin("progression"));
    tlb("economy", ICON.coins, "Economy (Z)", () => this.toggleWin("economy"));
    tlb("city", ICON.townGlyph, "Towns (C)", () => this.toggleWin("city"));
    tlb("transport", ICON.car, "Transportation overview (X)", () => this.toggleWin("transport"));
    tlb("camera", ICON.camera, "Camera: follow a truck, Tour, Vehicle cam (G, T, Shift+T)", () => this.toggleWin("camera"));
    this.compass.innerHTML = ICON.north;
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
    this.cityName.onclick = () => this.toggleWin("progression");
    this.cityName.title = "Progression (P)";
    this.moneyBtn.onclick = () => this.toggleWin("economy");
    this.moneyBtn.title = "Economy (Z)";
    this.popEl.title = "Population";
    city.append(this.cityName, this.popEl, this.moneyBtn);
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
      cat("towns", ICON.town, "Towns", "Towns (C): your towns, what they need and how they are growing. New ones spring up as you reach milestones", () => this.toggleWin("city")),
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
    time.append(this.clockEl, this.speed);
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
    this.root.append(tl, tr, bottom, this.chipBox, this.toastBox, this.banner, this.rectEl, this.modal);
    document.addEventListener("pointerdown", () => this.sfx.unlock());
  }

  // ---------------------------------------------------------------- categories

  private toggleCat(c: CatId) {
    const app = this.app;
    if (this.cat === c) {
      this.cat = null;
      if (catOf(app.st) === c) app.setTool({ tool: "inspect" });
      else this.refresh();
      return;
    }
    this.cat = c;
    // like picking up the last thing you built from this category
    if (c === "roads") app.setTool({ tool: "road", roadType: this.lastRoad });
    else if (c === "transport") {
      if (app.game.featureUnlocked("transit")) app.setTool({ tool: "transit" });
      else this.refresh();
    } else if (c === "industry") {
      // hold the tool only on something already unlocked
      const k = app.game.placedUnlocked(app.st.placed) ? app.st.placed : PLACED_TABS.flatMap((t) => t.kinds).find((x) => app.game.placedUnlocked(x));
      if (k) app.setTool({ tool: "place", placed: k });
      else this.refresh();
    }
  }

  private pick(a: Asset) {
    const app = this.app;
    if (a.kind === "road") { this.lastRoad = a.id; app.setTool({ tool: "road", roadType: a.id }); }
    else if (a.kind === "roundabout") app.setTool({ tool: "roundabout", rbSize: a.size });
    else if (a.kind === "junction") app.setTool({ tool: "junction" });
    else if (a.kind === "lane") app.setTool({ tool: "lane" });
    else if (a.kind === "placed") app.setTool({ tool: "place", placed: a.id });
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

  private assetInfo(a: Asset): { key: string; icon: string; name: string; sub: string; title: string; locked?: Milestone } {
    const g = this.app.game;
    if (a.kind === "road") {
      const T = ROAD_TYPES[a.id];
      const locked = g.roadsUnlocked.has(a.id) ? undefined : unlockedBy((u) => u.roads?.includes(a.id));
      const lanes = T.bwd ? `${T.fwd}+${T.bwd} lanes` : `${T.fwd} lane${T.fwd > 1 ? "s" : ""} one-way`;
      return { key: "road:" + a.id, icon: roadIcon(a.id), name: T.name, sub: `${formatMoney(T.costPerM * 10)}/10 m`, title: `${T.name} · ${lanes} · ${Math.round(T.speed * 3.6)} km/h. ${T.hint}`, locked };
    }
    if (a.kind === "roundabout") {
      const R = ROUNDABOUTS[a.size];
      const locked = g.featureUnlocked("roundabout") ? undefined : unlockedBy((u) => u.features?.includes("roundabout"));
      return { key: "rb:" + a.size, icon: rbIcon(a.size), name: `${R.name} roundabout`, sub: `${R.r * 2} m`, title: `${R.name} roundabout: ${R.r * 2} m across, ${ROAD_TYPES[R.type].fwd}-lane ring. Drop it on a junction or a road.`, locked };
    }
    if (a.kind === "placed") {
      const S = PLACED[a.id], T = BUILDING_TYPES[a.id];
      const D = PLANTS[a.id];
      const locked = g.placedUnlocked(a.id) ? undefined : unlockedBy((u) => u.buildings?.includes(a.id));
      const site = D.site ? ` Starts as a building site: it needs ${siteText(D.site)} trucked to it.` : "";
      const power = D.power ? ` Draws ${D.power} MW: without power it works at ${Math.round(UNPOWERED * 100)}%.` : D.makes ? ` Makes ${D.makes} MW for the buildings on its roads within ${D.reach! / 1000} km that draw power.` : "";
      return {
        key: "placed:" + a.id, icon: placedIcon(a.id), name: T.name, sub: `${formatMoney(S.cost)} · ${formatMoney(S.upkeep)}/h`,
        title: `${T.name}: ${chainText(a.id)}. ${T.blurb}${site}${power} Costs ${formatMoney(S.cost)}; upkeep ${formatMoney(S.upkeep)} an hour plus its ${T.jobs} workers' wages.`, locked,
      };
    }
    if (a.kind === "lane") {
      return {
        key: "lane", icon: ICON.lane, name: "Add lane", sub: "Turn & slip lanes",
        title: "Add lane (L): click a road just before a junction for a turn lane, nearer the middle for left turns, nearer the kerb for right turns. On a motorway, click before an exit or after an entry to lengthen its slip lane. Shift or right click removes a turn lane.",
      };
    }
    if (a.kind === "busstop" || a.kind === "busline") {
      const locked = g.featureUnlocked("transit") ? undefined : unlockedBy((u) => u.features?.includes("transit"));
      return a.kind === "busstop"
        ? { key: "busstop", icon: ICON.busStop, name: "Bus stop", sub: formatMoney(STOP_COST), title: `Bus stop: put it on the kerb of a street, on the side the buses will stop. ${formatMoney(STOP_COST)}.`, locked }
        : { key: "busline", icon: ICON.busLine, name: "Bus line", sub: `${formatMoney(BUS_UPKEEP)}/h a bus`, title: `Bus line: click stops in the order the buses visit them, then the first again to close the loop. Each bus costs ${formatMoney(BUS_UPKEEP)} an hour; riders pay a fare.`, locked };
    }
    const locked = g.featureUnlocked("signals") ? undefined : unlockedBy((u) => u.features?.includes("signals"));
    return { key: "junction", icon: ICON.junction, name: "Traffic lights", sub: formatMoney(SIGNAL_COST), title: "Traffic lights: click a junction to add lights or edit their phases", locked };
  }

  private renderAssets() {
    const c = this.cat, el = this.assets;
    if (!c) { el.hidden = true; this.lastAssets = ""; return; }
    const cur = this.current();
    const curKey = cur ? this.assetInfo(cur).key : "";
    const C = CATS[c];
    // follow the tool to its tab (keyboard, right click, loading)
    if (cur && catOf(this.app.st) === c) {
      const t = C.tabs.find((t) => t.assets.some((a) => this.assetInfo(a).key === curKey));
      if (t && this.followKey !== curKey) this.tab[c] = t.id;
    }
    this.followKey = curKey;
    const tab = C.tabs.find((t) => t.id === this.tab[c]) ?? C.tabs[0];
    const infos = tab.assets.map((a) => ({ a, ...this.assetInfo(a) }));
    const sig = [c, tab.id, curKey, infos.map((i) => i.key + (i.locked ? "L" : "") + i.sub).join()].join("|");
    el.hidden = false;
    if (sig === this.lastAssets) return;
    this.lastAssets = sig;
    const fa = document.activeElement;
    const focusKey = fa instanceof HTMLElement && el.contains(fa) ? fa.dataset.key : null;
    el.innerHTML = "";
    const head = h("header", "as-head");
    const tabs = h("div", "as-tabs");
    tabs.setAttribute("role", "tablist");
    for (const t of C.tabs) {
      const b = h("button", "as-tab", t.label);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t === tab));
      b.dataset.key = "tab:" + t.id;
      b.classList.toggle("on", t === tab);
      b.onclick = () => { this.tab[c] = t.id; this.renderAssets(); this.sfx.play("click"); };
      tabs.appendChild(b);
    }
    const close = h("button", "close", ICON.close);
    close.setAttribute("aria-label", `Close ${C.label}`);
    close.dataset.key = "close";
    close.onclick = () => this.toggleCat(c);
    head.append(h("b", "as-title", C.label), tabs, close);
    const cards = h("div", "as-cards");
    for (const i of infos) {
      const b = h("button", "asset", `<span class="as-icon">${i.icon}</span><b>${i.name}</b><span class="as-sub">${i.locked ? `${ICON.lock} ${i.locked.name}` : i.sub}</span>`);
      b.dataset.key = i.key;
      const on = i.key === curKey;
      b.classList.toggle("on", on);
      b.classList.toggle("locked", !!i.locked);
      b.setAttribute("aria-pressed", String(on));
      b.title = i.locked ? `${i.name} · unlocks with the milestone ${i.locked.name}: ${i.locked.goal}` : i.title;
      b.setAttribute("aria-label", b.title);
      b.disabled = !!i.locked;
      b.onclick = () => this.pick(i.a);
      cards.appendChild(b);
    }
    el.append(head, cards);
    if (focusKey) el.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }
  private followKey = "";

  // ---------------------------------------------------------------- refresh

  refresh() {
    const app = this.app, g = app.game, st = app.st;
    if (!g) return;
    const tc = catOf(st);
    if (tc) this.cat = tc;
    else if (st.tool !== "inspect") this.cat = null;
    if (st.tool === "road") this.lastRoad = st.roadType;
    for (const [k, b] of this.catBtns) {
      // (Towns opens the Towns window: lit while that is open)
      const on = k === "bulldoze" ? st.tool === "bulldoze" : k === "towns" ? this.winKind === "city" : this.cat === k;
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
  }

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
      items.push(h("p", "to-text", `Scroll to turn it, or hold Shift to turn it 1° at a time. The comma and period keys turn it 15° (1° with Shift); Ctrl + scroll zooms. A street is laid from its gate to the nearest road within ${GATE_LINK_REACH} m, round any homes, shown before you click.`));
      items.push(h("p", "to-text", D.deposit
        ? `At least ${Math.round(MIN_DEPOSIT * 100)}% of the plot must be ${D.deposit.name}: the ground shows it while you place, and the pointers at the screen's edge lead to the nearest deposits. More of it, faster work.`
        : `Trucks from your other plants bring it ${productList(D.inputs)}; ${D.makes ? `it powers the buildings on its roads within ${D.reach! / 1000} km that draw power`
          : outputsText(D.outputs)}.`));
    } else if (st.tool === "roundabout") {
      items.push(elevation());
    } else if (st.tool === "bulldoze") {
      items.push(sec("Elevation", seg([null, 0, 1, 2, 3].map((l) => ({
        html: l === null ? "All" : l === 0 ? "Ground" : `${l * LEVEL_H} m`, on: st.bdzLevel === l, title: l === null ? "Remove roads at any height" : `Only remove roads at ${l === 0 ? "ground level" : `${l * LEVEL_H} m`}`, fn: () => app.setTool({ bdzLevel: l }),
      })), "wrap")));
    } else if (st.tool === "junction") {
      items.push(h("p", "to-text", "Click a junction to add traffic lights or edit their phases."));
    } else if (st.tool === "lane") {
      items.push(h("p", "to-text", "Click a road where the turn lane should start, back from the junction. Middle half: left turns, kerb half: right turns. On a motorway, click before an exit or after an entry. Shift or right click removes."));
    }
    if (!items.length) { el.hidden = true; return; }
    el.hidden = false;
    el.append(h("header", "to-head", "Tool options"), ...items);
    if (focusKey) [...el.querySelectorAll<HTMLElement>("[aria-label]")].find((e) => e.getAttribute("aria-label") === focusKey)?.focus();
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
    const reached = g.progress.done.length, all = MILESTONES.length;
    const last = reached ? MILESTONES.find((m) => m.id === g.progress.done[reached - 1]) : undefined;
    const key = [g.cityName, reached].join("|");
    if (force || this.cityName.dataset.k !== key) {
      this.cityName.dataset.k = key;
      this.cityName.innerHTML = `<b>${escapeHtml(g.cityName)}</b><span class="cb-ms"><span>${last ? escapeHtml(last.name) : "No milestones yet"}</span><i style="--p:${reached / all}"></i></span>`;
      this.cityName.setAttribute("aria-label", `${g.cityName}: ${reached} of ${all} milestones reached${last ? `, last ${last.name}` : ""}. Open progression`);
    }
    this.popEl.innerHTML = `${ICON.people}<span>${fmtNum(st.population)}</span>`;
    const net = g.netIncome;
    this.moneyBtn.innerHTML = `<b class="${g.money < 0 ? "bad" : ""}">${formatMoney(Math.round(g.money))}</b><span class="${net >= 0 ? "good" : "bad"}">${signed(net)}/h</span>`;
    this.moneyBtn.setAttribute("aria-label", `Money ${formatMoney(Math.round(g.money))}, ${signed(net)} per hour. Open economy`);
    const season = seasonLine(g.time);
    if (this.clockEl.dataset.k !== season) {
      this.clockEl.dataset.k = season;
      this.clockEl.innerHTML = `<b></b>${season}`;
      this.clockShown = "";
    }
    this.clock();
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
    if (this.sel || this.app.mode !== "play") { this.tut.hidden = true; this.hint(null); return; }
    const prefs = this.tipPrefs;
    const tip = prefs.off ? null : tipFor(g, (id) => prefs.dismissed.has(id));
    this.tut.hidden = false;
    const open = g.progress.open();
    const v = g.progressView();
    const folded = this.tutHidden;
    const head = `<button class="gl-head" aria-expanded="${!folded}" aria-controls="gl-body"><b>Goals</b><span class="gl-count">${g.progress.done.length} of ${MILESTONES.length} reached</span><span class="gl-caret">${ICON.caret}</span></button>`;
    let body = `<div id="gl-body" hidden></div>`;
    if (!folded) {
      const items = open.map((m) => {
        const [have, need] = m.measure(v);
        const p = Math.max(0, Math.min(1, have / need));
        return `<li><div class="gl-top"><b>${m.name}</b><span class="num">${measureText(m, have, need)}</span></div>
          <p class="gl-goal">${m.goal}</p>
          <span class="bar gl-bar" role="progressbar" aria-label="${m.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><i style="width:${Math.max(2, p * 100)}%"></i></span>
          <p class="gl-gift">${unlockList(m.unlocks).join(" · ")}</p></li>`;
      }).join("");
      body = `<div id="gl-body">${items ? `<ol class="gl-list">${items}</ol>` : `<p class="gl-done">Every milestone reached, to the first cars off the line. More comes with the Metropolis.</p>`}${tip ? `<div class="gl-tip" data-tip="${tip.id}"><p>${tip.html}</p><button class="gl-x" aria-label="Dismiss this tip" title="Dismiss this tip (Pause › Tips turns them all off)">${ICON.close}</button></div>` : ""}</div>`;
    }
    const html = head + body;
    if (this.tut.dataset.html !== html) {
      const hadFocus = this.tut.contains(document.activeElement);
      this.tut.dataset.html = html;
      this.tut.innerHTML = html;
      const btn = this.tut.querySelector(".gl-head") as HTMLButtonElement;
      btn.onclick = () => { this.tutHidden = !this.tutHidden; this.sfx.play("click"); this.renderTips(); };
      const x = this.tut.querySelector<HTMLButtonElement>(".gl-x");
      if (x && tip) x.onclick = () => { prefs.dismiss(tip.id); this.sfx.play("click"); this.renderTips(); this.tut.querySelector<HTMLButtonElement>(".gl-head")?.focus({ preventScroll: true }); };
      if (hadFocus && !this.tut.contains(document.activeElement)) btn.focus({ preventScroll: true });
    }
    this.hint(folded ? null : tip?.cat ?? null);
  }

  private hint(cat: string | null) {
    for (const [k, b] of this.catBtns) b.classList.toggle("hint", k === cat && !b.classList.contains("on"));
  }

  // ---------------------------------------------------------------- transient UI

  chips(pos: V2 | null, list: Chip[] = []) {
    const box = this.chipBox;
    if (!pos || !list.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = list.map((c) => `<span class="chip ${c.kind}">${c.icon ? ICON[c.icon] : ""}${c.text}</span>`).join("");
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
    while (this.toastBox.children.length > 3) this.toastBox.firstChild!.remove();
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

  sound(k: "build" | "remove" | "place" | "error" | "level" | "click") {
    this.sfx.play(k);
  }

  /** Milestones reached (and towns grown) not yet shown: several can come at once, each gets its banner in turn. */
  private bannerQ: Banner[] = [];
  private bannerT = 0;

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

  /** Drop every banner still showing or waiting (a new game or a load: they belonged to the last one). */
  clearBanners() {
    clearTimeout(this.bannerT);
    this.bannerQ = [];
    this.banner.hidden = true;
  }

  private queueBanner(x: Banner) {
    this.bannerQ.push(x);
    if (this.banner.hidden) this.nextBanner();
    else this.bannerMore();
    this.sfx.play("level");
    this.refresh();
  }

  private nextBanner() {
    clearTimeout(this.bannerT);
    const X = this.bannerQ.shift();
    if (!X) { this.banner.hidden = true; return; }
    const g = this.app.game;
    const t = "town" in X ? g.towns.byId.get(X.town) : "spawned" in X ? g.towns.byId.get(X.spawned) : undefined;
    if (("town" in X || "spawned" in X) && !t) { this.nextBanner(); return; }
    const lm = "landmark" in X ? g.buildings.byId.get(X.landmark) : undefined;
    if ("landmark" in X && (!lm || !isMega(lm.kind))) { this.nextBanner(); return; }
    this.banner.classList.toggle("lm", !!lm || "spawned" in X);
    this.banner.classList.toggle("nt", "spawned" in X);
    if (lm && isMega(lm.kind)) {
      this.banner.innerHTML = `<p class="lm-kicker">The company presents</p>
        <header>The ${BUILDING_TYPES[lm.kind].name} is open</header>
        <p class="gifts">${escapeHtml(MEGAS[lm.kind].reward)}</p>
        <div class="banner-btns"><button class="btn" data-k="show">Show me</button><button class="btn primary" data-k="ok">Continue</button></div>`;
    } else if ("spawned" in X) {
      const T = g.towns.byId.get(X.spawned)!;
      const from = X.from !== null ? g.towns.byId.get(X.from) : undefined;
      // (the arrow points the way the town lies on screen, whichever way the camera is turned)
      const a = this.app.screenBearing(from?.c ?? { x: this.app.view.cx, y: this.app.view.cy }, T.c);
      const where = from ? `${km(X.dist)} ${X.dir} of ${escapeHtml(from.name)}` : "on the map";
      this.banner.innerHTML = `<p class="lm-kicker">A new town on the map</p>
        <div class="nt-head">${spawnCompass(a)}<header>${escapeHtml(T.name)} has sprung up</header></div>
        <p class="sub">${where} · ${g.towns.sizeName(T)} of ${fmtNum(T.pop)} · no road yet</p>
        <p class="gifts">Lay a road out to it and keep it fed: a new market for the company, and a longer drive for your trucks.</p>
        <div class="banner-btns"><button class="btn" data-k="fly">Fly there</button><button class="btn" data-k="town">Open ${escapeHtml(T.name)}</button><button class="btn primary" data-k="ok">Continue</button></div>`;
    } else if ("m" in X) {
      const M = X.m;
      const co = g.company;
      const names = (X.towns ?? []).map((id) => g.towns.byId.get(id)?.name).filter((n): n is string => !!n);
      this.banner.innerHTML = `<header class="banner-co">${heraldSvg(co.herald, co.name, 26)}<span>${M.name}</span></header>
        <p class="sub">${escapeHtml(co.name)} · milestone reached · ${M.goal}</p>
        <p class="gifts">Unlocked: ${unlockList(M.unlocks, names).map(escapeHtml).join(" · ")}</p>
        <div class="banner-btns"><button class="btn primary" data-k="ok">Continue</button></div>`;
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
    this.banner.hidden = false;
    this.banner.classList.remove("in");
    void this.banner.offsetWidth;
    this.banner.classList.add("in");
    const ok = this.banner.querySelector<HTMLButtonElement>('[data-k="ok"]')!;
    ok.onclick = () => this.nextBanner();
    const open = this.banner.querySelector<HTMLButtonElement>('[data-k="town"]');
    if (open && t) open.onclick = () => { this.nextBanner(); this.openTown(t.id); };
    const show = this.banner.querySelector<HTMLButtonElement>('[data-k="show"]');
    if (show && lm) show.onclick = () => { this.app.glideTo(lm.c, Math.max(220, Math.hypot(lm.hw, lm.hd) * 1.6)); this.nextBanner(); this.app.selected = lm; this.openBuilding(lm); };
    const fly = this.banner.querySelector<HTMLButtonElement>('[data-k="fly"]');
    if (fly && t) fly.onclick = () => { this.nextBanner(); this.app.flyToTown(t.id); };
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

  back(): boolean {
    if (!this.banner.hidden) { this.nextBanner(); return true; }
    if (!this.modal.hidden) { this.closeModal(); return true; }
    if (this.sel) { this.closeSelection(); return true; }
    if (this.winKind) { this.closeWin(); return true; }
    if (this.app.st.tool !== "inspect") { this.cat = null; this.app.setTool({ tool: "inspect" }); return true; }
    if (this.cat) { this.cat = null; this.refresh(); return true; }
    return false;
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

  private closeModal() {
    this.modal.hidden = true;
    this.modal.innerHTML = "";
    if (this.resumeOnClose) { this.resumeOnClose = false; if (this.app.game.paused) this.app.togglePause(); }
  }

  // ---------------------------------------------------------------- windows (top left)

  toggleWin(k: WinId) {
    if (this.winKind === k) { this.closeWin(); return; }
    this.winKind = k;
    this.lastWin = "";
    this.win.hidden = false;
    if (k === "transport" && this.app.overlay !== "flow") this.app.setOverlay("flow");
    this.fillWin();
    this.refresh();
  }

  private closeWin() {
    if (this.winKind === "transport" && this.app.overlay === "flow") this.app.setOverlay("flow");
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
    const html = `<div class="cam-list">${
      opt("follow", ICON.camFollow, following ? "Stop following" : "Follow a truck", "<kbd>G</kbd>", following ? "Let go of the vehicle the camera is riding with." : "The camera rides with the truck nearest the middle of the screen. Zoom as you like; pan, click the map or Esc lets go.", following)
    }${
      opt("tour", ICON.camera, "Tour", "<kbd>T</kbd>", "An automatic camera drifts over your busiest junctions, towns, works and bridges, fading from one to the next. The interface hides; the game runs on.")
    }${
      opt("ride", ICON.camRide, "Vehicle cam", "<kbd>Shift</kbd><kbd>T</kbd>", "Rides along with one heavy truck, road train or convoy after another, a few seconds each.")
    }</div><p class="cam-foot small muted">Any key or a click leaves the Tour and the Vehicle cam.</p>`;
    if (!this.setWin("Camera", html)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".cam-opt")) b.onclick = () => {
      const k = b.dataset.cam;
      this.sfx.play("click");
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
      el.innerHTML = `<i class="fc-lamp" aria-hidden="true"></i><span class="fc-text" role="status"><span class="fc-k">Following</span><b class="fc-what"></b><span class="fc-sub"></span></span><button class="fc-stop" type="button" aria-label="Stop following (Esc)">Stop<kbd>Esc</kbd></button>`;
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
    const rows = OVERLAYS.map((o) => `<button class="iv ${app.overlay === o.id ? "on" : ""}" data-id="${o.id}" aria-pressed="${app.overlay === o.id}"><span class="ov-dot ov-${o.id}"></span><span><b>${o.label}</b><span class="small muted">${o.blurb}</span></span></button>`).join("");
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
    const plants = g.industry.plants().map((b) => {
      const L = b.plant!.last, net = L.earned - L.spent;
      return `<dt>${BUILDING_TYPES[b.kind].name}</dt><dd class="${net >= 0 ? "good" : "bad"}">${signed(net)}</dd>`;
    }).join("");
    // what the company made over the last day, per product, against what its plants can make
    const made = new Map<Product, { made: number; can: number; byHour: number[] }>();
    for (const b of g.industry.plants()) {
      if (b.built < 1 || b.plant!.site) continue;
      for (const p of Object.keys(PLANTS[b.kind as PlantKind].outputs) as Product[]) {
        const m = Industry.madeLately(b, p), e = made.get(p) ?? { made: 0, can: 0, byHour: Array(HIST_HOURS).fill(0) };
        // (a plant not a day old yet: what it could make in the hours it has worked)
        e.made += m.made; e.can += Industry.perDay(b, p) * Math.min(1, m.hours / HIST_HOURS);
        m.byHour.forEach((v, i) => { e.byHour[HIST_HOURS - m.byHour.length + i] += v; });
        made.set(p, e);
      }
    }
    const prodRows = [...made].map(([p, e]) => `<li><span class="pd-name">${productIcon(p)}${PRODUCTS[p].name}</span>${hourTicks(e.byHour, PRODUCTS[p].color)}<span class="num"><b>${fmtNum(Math.round(e.made))}</b><span class="muted"> / ${fmtNum(Math.round(e.can))}</span></span></li>`).join("");
    const html = `<p class="win-sub">Average hour, last ${n} hour${n === 1 ? "" : "s"}</p>
      <dl class="facts money-rows">${rows.filter(([, v, always]) => always || Math.abs(v) >= 0.5).map(([k, v]) => `<dt>${k}</dt><dd class="${v > 0 ? "good" : v < 0 ? "bad" : ""}">${signed(v)}</dd>`).join("")}
      <dt class="tot">Balance</dt><dd class="tot ${total >= 0 ? "good" : "bad"}">${signed(total)}</dd></dl>
      ${prodRows ? `<h3 class="sub-h">Made, last 24 hours <span class="muted">· made / can make</span></h3><ul class="pd-list">${prodRows}</ul>` : ""}
      ${plants ? `<h3 class="sub-h">Your plants, last hour</h3><dl class="facts">${plants}</dl>` : ""}
      ${sparkline(g.history.map((x) => x.money), "Money")}`;
    this.setWin("Economy", html);
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
    this.setWin("Progression", `<p class="win-sub">${g.progress.done.length} of ${MILESTONES.length} reached · up to three open at once, reach one to open the next</p><ul class="ms-list">${rows}</ul>`);
  }

  /** The Towns window: every town, how big it is and which way it's heading. */
  private fillCity() {
    const g = this.app.game;
    const s = g.people.stats;
    const rows = g.towns.list.map((t) => {
      const tr = trendOf(t);
      // its worst-supplied need, in the panel's words ("Food · Running low")
      const worst = townNeeds(t).reduce<NeedView | null>((w, v) => (!w || v.got / v.want < w.got / w.want ? v : w), null);
      // (a town that sprang up and no road reaches yet says so: its needs mean nothing till one does)
      const need = t.spawned && !joinedUp(g, t)
        ? `<span class="tw-need low">No road yet</span>`
        : worst && t.pop >= 60
        ? `<span class="tw-need ${worst.state === "low" ? "mid" : worst.state === "none" ? "low" : ""}">${productIcon(worst.p)}${PRODUCTS[worst.p].name} · ${worst.word}</span>`
        : "";
      return `<li><button class="tw-row" data-id="${t.id}"><span class="tw-name"><b>${escapeHtml(t.name)}</b><span class="small muted">${g.towns.sizeName(t)} · ${fmtNum(t.pop)} people</span></span>${miniSpark(t.hist.pop.slice(-72))}<span class="tw-right"><span class="tw-trend ${tr.cls}">${tr.short}</span>${need}</span></button></li>`;
    }).join("");
    // when the next town springs up: which goal brings it, and how far along that is
    const nt = nextTown(g);
    const next = nt
      ? `<p class="tw-next"><span>Next town springs up at</span> <b>${escapeHtml(nt.m.name)}</b> · ${measureText(nt.m, nt.have, nt.need)}${nt.before ? ` <span class="muted">· opens after ${nt.before} more goal${nt.before === 1 ? "" : "s"}</span>` : ""}</p>`
      : `<p class="tw-next muted">Every town the goals bring has sprung up.</p>`;
    const html = `${next}<ul class="tw-list">${rows}</ul>
      <dl class="facts">
        <dt>People in your towns</dt><dd>${fmtNum(s.population)}</dd>
        <dt>Working at your plants</dt><dd>${fmtNum(g.industry.plants().reduce((a, b) => a + g.people.workersAt(b.id), 0))}</dd>
      </dl>
      ${sparkline(g.history.map((x) => x.pop), "Population")}`;
    if (!this.setWin("Towns", html)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".tw-row")) b.onclick = () => { this.sfx.play("click"); this.showTown(+b.dataset.id!); };
  }

  /** Look at a town and open its panel. */
  showTown(id: number) {
    const t = this.app.game.towns.byId.get(id);
    if (!t) return;
    this.app.lookAt(t.c, Math.max(220, t.reach * 1.2));
    this.openTown(id);
  }

  private fillTransport() {
    const g = this.app.game;
    const flow = g.traffic.flowScore();
    let cars = 0, trucks = 0;
    for (const v of g.traffic.vehicles) { if (v.truck) trucks++; else cars++; }
    let len = 0;
    for (const s of g.net.segs.values()) len += cubicLength(s);
    const html = `<dl class="facts">
        <dt>Traffic flow</dt><dd class="${flow < 0.6 ? "bad" : flow > 0.85 ? "good" : ""}">${Math.round(flow * 100)}%</dd>
        <dt>Cars on the road</dt><dd>${fmtNum(cars)}</dd>
        <dt>Trucks on the road</dt><dd>${fmtNum(trucks)}</dd>
        <dt>Road network</dt><dd>${(len / 1000).toFixed(1)} km</dd>
      </dl>
      <p class="small muted">The map shows the Traffic flow view while this is open: red roads are jammed.</p>
      ${this.linesHtml()}`;
    if (!this.setWin("Transportation", html)) return;
    this.bindLines();
  }

  /** The bus lines list in the Transportation window. */
  private linesHtml(): string {
    const g = this.app.game, tr = g.transit;
    if (!g.featureUnlocked("transit")) {
      const m = unlockedBy((u) => u.features?.includes("transit"));
      return `<h3 class="sub-h">Bus lines</h3><p class="small muted">${ICON.lock} Buses unlock with the milestone ${m?.name ?? "a later milestone"}${m ? `: ${m.goal.toLowerCase()}` : ""}.</p>`;
    }
    const lines = [...tr.lines.values()];
    if (!lines.length) return `<h3 class="sub-h">Bus lines</h3><p class="small muted">No bus lines yet. Put down stops with Transport › Bus stop, then click them in order with Bus line.</p>`;
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
    for (const c of this.panel.querySelectorAll<HTMLButtonElement>(".fchip[data-k]")) c.onclick = () => {
      this.sfx.play("click");
      const s = { k: c.dataset.k, id: +c.dataset.id! } as Sel;
      if (s.k === "node") this.openSignal(s.id);
      else this.openSel(s);
      const g = this.app.game;
      const at = s.k === "town" ? g.towns.byId.get(s.id)?.c : s.k === "building" ? g.buildings.byId.get(s.id)?.c
        : s.k === "node" ? g.net.nodes.get(s.id)?.p : s.k === "vehicle" ? g.traffic.vehicles.find((v) => v.id === s.id) : undefined;
      if (at && !this.app.onScreen(at)) this.app.glideTo(at, this.app.view.halfH, 1);
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
  openStop(id: number) { this.openSel({ k: "stop", id }); }
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
    const note = s.id >= 0 ? `<p class="small muted ip-note">The Resources view is on while this is selected: ${escapeHtml(m.title.replace(/ deposit$/, "").toLowerCase())} shows strong, the rest faint.</p>` : "";
    const body = k ? `<button type="button" class="btn ip-place"><span aria-hidden="true">${placedIcon(k)}</span>Place a ${escapeHtml(BUILDING_TYPES[k].name.toLowerCase())} here</button>${note}` : note;
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
    this.setPanel(this.anatomy(m, { kind: "stuck", body: `<p class="small muted ip-note">Ringed on the map: the vehicles standing still, and the roads they are on.</p>` }));
  }

  /**
   * One panel anatomy for everything (docs/ui-style.md "Inspector"): the header with its level and small actions,
   * a status line with its mark, three key numbers, the flow in and out as chips, the level bar, then whatever else
   * there is to read tucked under Details (open or shut per kind, remembered).
   */
  private anatomy(m: PanelModel, o: { actions?: string; lead?: string; body?: string; details?: string; kind: string }): string {
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
        ? `<button class="fchip" data-k="${c.ref.k}" data-id="${c.ref.id}" title="Select ${escapeHtml(c.text)} and light it up on the map">${body}</button>`
        : `<span class="fchip still">${body}</span>`;
    };
    const flow = m.flow.length ? `<dl class="ip-flow">${m.flow.map((r) => `<dt class="fl-${r.label.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(r.label)}</dt><dd>${r.chips.map(chip).join("")}</dd>`).join("")}</dl>` : "";
    const lv = m.level ? `<div class="ip-lvl">${levelRun(m.level.from, m.level.to, m.level.pct)}<span class="ip-lvl-t ${m.level.tone ?? ""}">${escapeHtml(m.level.line)}</span></div>` : "";
    const open = moreOpen(o.kind);
    const details = o.details ? `<details class="ip-more" data-k="${o.kind}"${open ? " open" : ""}><summary>Details</summary><div class="ip-more-body">${o.details}</div></details>` : "";
    return `<header class="ip-head"><span class="svc-tag${/^(junction|roundabout|road:)/.test(m.icon) ? " lit" : ""}">${iconFor(m.icon)}</span><span class="ip-t"><span class="ip-tn">${escapeHtml(m.title)}</span>${m.sub ? `<small class="ip-ts">${escapeHtml(m.sub)}</small>` : ""}</span>${m.badge ? `<span class="lv-badge" title="Site level">${m.badge}</span>` : ""}${o.actions ?? ""}</header>
      <p class="ip-st ${st.tone}"><i aria-hidden="true"></i><span class="ip-st-t">${escapeHtml(st.text)}</span>${st.tag ? `<span class="ip-tag">${escapeHtml(st.tag)}</span>` : ""}</p>
      ${st.fix ? `<p class="ip-fix">${escapeHtml(st.fix)}</p>` : ""}
      ${o.lead ?? ""}${keys}${flow}${lv}${o.body ?? ""}${details}`;
  }

  /** The small icon buttons in a panel's header: demolish (two clicks), follow. */
  private actionBtn(cls: string, icon: string, label: string, on?: boolean): string {
    // (`on` given: a toggle, whose state screen readers hear either way)
    return `<button class="ip-act ${cls}${on ? " on" : ""}" aria-label="${label}" title="${label}"${on === undefined ? "" : ` aria-pressed="${on}"`}>${icon}</button>`;
  }

  private demolishBtn(what: string): string {
    const armed = this.armed && performance.now() - this.armed < 3000;
    return this.actionBtn(`demolish${armed ? " armed" : ""}`, ICON.bulldoze, armed ? `Click again to ${what}` : cap(what));
  }

  /** Two clicks to pull something down: the first arms the button (it turns brick), the second within 3 s does it. */
  private bindDemolishBtn(fn: () => void) {
    const btn = this.panel.querySelector<HTMLButtonElement>(".ip-act.demolish");
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
    const html = this.anatomy(m, { kind: "stop", actions: this.demolishBtn("remove the stop"), body: ls });
    if (!this.setPanel(html)) return;
    this.bindDemolishBtn(() => { tr.removeStop(st.id); this.sfx.play("remove"); this.closeSelection(); });
  }

  private fillVehicle(m: PanelModel) {
    const g = this.app.game, v = g.traffic.vehicles.find((x) => x.id === this.sel!.id)!;
    const tr = v.trip, h = tr.haul;
    const rows: [string, string][] = [];
    if (h && !h.big) rows.push(["Truck", `${TRUCK_CLASSES[h.cls ?? "light"].name} · ${Math.round(v.len)} m`]);
    if (h && h.leg === "back") rows.push(["Load", "Empty, on its way back"]);
    // (a loaded truck's key numbers are its cargo: its speed goes here)
    if (h && h.leg === "out" && !h.big) rows.push(["Speed", `${Math.round(v.v * 3.6)} km/h <span class="muted">· limit ${Math.round(v.edge.speed * 3.6)}</span>`]);
    if (tr.bus) rows.push(["Aboard", plural(tr.bus.pax.length, "rider")]);
    const elapsed = Math.max(0, g.time - tr.startT);
    rows.push(["On the road", `${Math.round((elapsed / HOUR) * 60)} min`]);
    if (tr.freeFlow > 0 && elapsed > tr.freeFlow * 1.15) rows.push(["Held up", `<span class="bad">+${Math.round(((elapsed - tr.freeFlow) / HOUR) * 60)} min</span> <span class="muted">over a clear road</span>`]);
    if (v.block && v.v < 0.5) rows.push(["Waiting for", escapeHtml(v.block)]);
    const on = v.edge.kind === "lane" ? g.net.segs.get((v.edge as Lane).seg) : undefined;
    if (on) rows.push(["On", `${ROAD_TYPES[on.type].name} · ${Math.round(ROAD_TYPES[on.type].speed * 3.6)} km/h`]);
    const details = `<dl class="facts">${rows.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join("")}</dl>`;
    const body = `<p class="small muted ip-note">On the map: dashes run the way it will take, to the square at its end; the faded line is the way it came.</p>`;
    const following = this.app.following === v.id;
    const html = this.anatomy(m, { kind: "vehicle", details, body, actions: this.actionBtn("follow", ICON.follow, "Follow with the camera", following) });
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
        <dt>Type</dt><dd>${T.name} · ${T.short}</dd>
        <dt>Speed limit</dt><dd>${Math.round(T.speed * 3.6)} km/h</dd>
        <dt>Length</dt><dd>${Math.round(geo.center.length)} m</dd>
        ${dirRow(id * 2, `Toward ${compass(d)}`)}${dirRow(id * 2 + 1, `Toward ${compass({ x: -d.x, y: -d.y })}`)}
        ${s.town !== undefined ? `<dt>Laid by</dt><dd>${escapeHtml(g.towns.byId.get(s.town)?.name ?? "a town")} <span class="muted">· no upkeep</span></dd>` : ""}
      </dl>`;
    const n = m.related.routes?.length ?? 0;
    const routes = n ? `<p class="small muted ip-note">On the map: the whole routes of the ${plural(n, "vehicle")} on it now, thicker where more share a road; ochre is your freight, cream everyone else.</p>` : "";
    const body = `${routes}<button class="btn quiet ip-flowbtn" aria-pressed="${flowOn}">${ICON.layers}${flowOn ? "Hide the traffic flow view" : "Show traffic flow on every road"}</button>`;
    const html = this.anatomy(m, { kind: "road", details, body });
    if (!this.setPanel(html)) return;
    const fb = this.panel.querySelector<HTMLButtonElement>(".ip-flowbtn");
    if (fb) fb.onclick = () => { this.sfx.play("click"); this.app.setOverlay("flow"); this.lastPanel = ""; this.fillSel(); };
  }

  private fillTown(m: PanelModel) {
    const g = this.app.game, t = g.towns.byId.get(this.sel!.id)!;
    const si = sizeOf(t.pop), next = TOWN_SIZES[si + 1];
    // its needs, readable by a child (docs/design.md, 2026-11-08): per product its picture, one word for how it is
    // doing, a row of crates (loads a day coming against loads a day wanted) and what to do. The figures sit in each
    // row's tooltip and under Details.
    const mine = g.towns.buildingsOf(t);
    const stations = mine.filter((b) => BUILDING_TYPES[b.kind].fuel).length;
    const offices = mine.some((b) => Industry.isOffice(b) && b.built >= 1 && !b.abandoned);
    const buyer = (p: Product) => (p === "fuel" && stations ? "Filling stations buy" : p === "machinery" && offices ? "Offices buy" : "Shops buy");
    const views = townNeeds(t);
    const rows = views.map((v) => {
      const tip = `${fmtLoads(v.got)} loads a day coming, of the ${fmtLoads(v.want)} it needs to grow. ${buyer(v.p)} up to ${fmtLoads(v.want * MARKET)} a day; ${fmtLoads(t.today[v.p] ?? 0)} so far today.`;
      const crates = Array.from({ length: v.crates.n }, (_, i) => `<i class="cr${i < v.crates.full ? " on" : ""}"></i>`).join("");
      const each = v.crates.per > 1 ? `<span class="nd-each">1 crate = ${fmtNum(v.crates.per)} loads</span>` : "";
      return `<li class="nd ${v.state}" title="${escapeHtml(tip)}">
          <span class="nd-ic" aria-hidden="true">${productIcon(v.p)}</span>
          <span class="nd-top"><b>${PRODUCTS[v.p].name}</b><span class="nd-st">${v.word}</span></span>
          <span class="nd-crates" role="img" aria-label="${v.crates.full} of ${v.crates.n} crates filled">${crates}${each}</span>
          <span class="nd-say">${escapeHtml(v.say)}</span>
        </li>`;
    }).join("");
    const cn = comingNeeds(t.pop);
    const soon = cn
      ? `<p class="nd-soon">${cn.products.map((p) => `<span class="nd-ic" aria-hidden="true">${productIcon(p)}</span>`).join("")}<span><b>Soon: ${cn.products.map((p) => PRODUCTS[p].name).join(" and ")}</b> <span class="muted">when it reaches ${fmtNum(cn.pop)} people</span></span></p>`
      : "";
    const lead = `<h3 class="sub-h nd-h">What it needs</h3><ul class="nds">${rows}</ul>${soon}`;
    const figures = views.map((v) => `<dt title="${buyer(v.p)} up to ${fmtLoads(v.want * MARKET)} a day; ${fmtLoads(t.today[v.p] ?? 0)} so far today">${PRODUCTS[v.p].name}</dt><dd>${fmtLoads(v.got)} <span class="muted">of ${fmtLoads(v.want)}</span></dd>`).join("");
    // what holds it back, in words (no figures: docs/design.md, "growth in words"): the need its proven supply runs
    // out on, and that it grows again once that supply has held for a couple of days
    const holds = t.pop >= 60 ? t.limit ?? needsOf(t.pop).find((p) => (t.supply[p] ?? 1) < SUPPLY_COVER) : undefined;
    const cost = holds
      ? `<p class="tn-cost"><b>Held back by ${PRODUCTS[holds].name.toLowerCase()}.</b> Bring it more ${PRODUCTS[holds].name.toLowerCase()}, and keep it coming for a couple of days, and it grows again.</p>`
      : "";
    // what came, by product, and what it was worth
    const sold = (Object.entries(t.yesterday) as [Product, number][]).filter(([, n]) => n > 0);
    const worth = sold.reduce((a, [p, n]) => a + n * PRODUCTS[p].price, 0);
    const deliveries = sold.length
      ? `<dl class="facts">${sold.map(([p, n]) => `<dt>${PRODUCTS[p].name}</dt><dd>${fmtLoads(n)} ${Math.round(n) === 1 ? "load" : "loads"}</dd>`).join("")}<dt class="tot">Worth</dt><dd class="tot">${formatMoney(worth)}</dd></dl>`
      : `<p class="small muted">Nothing delivered yesterday.</p>`;
    // homes and work, and the blocks waiting for construction parts
    let jobs = 0, rebuilding = 0, waiting = 0, partsLeft = 0;
    for (const b of mine) {
      if (b.zone && ZONE_GROUP[b.zone] === "com") jobs += b.cap;
      if (b.redev && b.built < 1) rebuilding++;
      if (b.site) { waiting++; partsLeft += Math.max(0, (b.site.need.parts ?? 0) - (b.site.got.parts ?? 0)); }
    }
    const hall = g.buildings.byId.get(t.hall);
    const hallLine = hall ? `${BUILDING_TYPES[hall.kind].name}${hall.built < 1 ? ` <span class="muted">· building, ${Math.round(hall.built * 100)}%</span>` : ""}` : "None yet";
    const details = `${townChart(t, next)}
      <dl class="facts">
        <dt>People</dt><dd>${fmtNum(t.pop)}</dd>
        <dt>Households</dt><dd>${fmtNum(t.households)} <span class="muted">of ${fmtNum(t.homes)} homes</span></dd>
        <dt>Growth</dt><dd class="${growthOf(t).tone}">${growthOf(t).word}</dd>
        <dt>Shops and offices</dt><dd>${t.shops} <span class="muted">· ${fmtNum(jobs)} jobs</span></dd>
        <dt>Hall</dt><dd>${hallLine}</dd>
        ${rebuilding ? `<dt>Rebuilding</dt><dd>${plural(rebuilding, "site")}</dd>` : ""}
        ${stations ? `<dt>Filling stations</dt><dd>${stations}</dd>` : ""}
        ${waiting ? `<dt>Waiting for parts</dt><dd class="${waiting > 3 ? "bad" : ""}">${plural(waiting, "block")}, ${plural(partsLeft, "load")}</dd>` : ""}
      </dl>
      <h3 class="sub-h">Needs in figures <span class="muted">loads a day</span></h3>
      <dl class="facts">${figures}</dl>
      <p class="small muted">Its shops buy up to ${MARKET}× what it needs to grow, so extra loads still sell.</p>
      ${cost}
      <h3 class="sub-h">Delivered yesterday</h3>
      ${deliveries}`;
    this.setPanel(this.anatomy(m, { kind: "town", lead, details }));
  }

  private fillBuilding(b: Building, m: PanelModel) {
    const g = this.app.game;
    const T = BUILDING_TYPES[b.kind];
    const demolish = () => { g.bulldoze([], [b.id]); this.closeSelection(); this.sfx.play("remove"); };
    const act = this.demolishBtn("demolish");
    if (b.plant && isPlantKind(b.kind)) {
      const D = PLANTS[b.kind], P = b.plant;
      const chain = `<p class="small muted ip-chain">${chainText(b.kind)}</p>`;
      // a landmark's site: its ring and stage, materials and pieces, and what it will do once open (it is the panel)
      const lmSite = landmarkSite(g, b);
      if (lmSite) {
        if (this.setPanel(this.anatomy(m, { kind: b.kind, actions: act, body: `${chain}${lmSite}` }))) this.bindDemolishBtn(demolish);
        return;
      }
      // a site: the materials trucked to it so far
      if (P.site) {
        const mats = (Object.keys(P.site.need) as Product[]).map((p) => {
          const need = P.site!.need[p]!, got = Math.min(need, P.site!.got[p] ?? 0);
          return `<dt>${PRODUCTS[p].name}</dt><dd>${stockBar(got, need, PRODUCTS[p].color)}<span class="num">${Math.floor(got)} / ${need}</span></dd>`;
        }).join("");
        const body = `<dl class="facts">${mats}</dl><p class="small muted">Once all are in it takes ${BUILD_TIME / HOUR} hours to build. No wages or upkeep until then.</p>`;
        if (this.setPanel(this.anatomy(m, { kind: b.kind, actions: act, body: chain + body }))) this.bindDemolishBtn(demolish);
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
        ? `Drawn down as it works. Out of one, it slips back to the pace of a lower level (never below level 2) until your trucks bring more.`
        : `Its next level works through these: it needs them in store to grow.`;
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
        if (this.setPanel(this.anatomy(m, { kind: b.kind, actions: act, details }))) this.bindDemolish(b, demolish);
        return;
      }
      const details = `${chain}
        ${b.built >= 1 ? outputDay(b) : ""}
        ${ins ? `<h3 class="sub-h">In the yard</h3><dl class="facts">${ins}</dl>` : ""}
        ${outs ? `<h3 class="sub-h">Ready to ship</h3><dl class="facts">${outs}</dl>` : ""}
        ${flare ? `<p class="small muted">Its yard is full of ${PRODUCTS[flare].name.toLowerCase()}: ${g.industry.wants(flare) ? `your ${Industry.takers(flare)} can't take more for now` : Industry.usedBy(flare) ? `nothing of yours uses it until you build a ${Industry.takers(flare)}` : `nothing of yours uses it until tier ${Industry.laterTier(flare)}`}, so it burns off the rest and keeps making ${(Object.keys(D.outputs) as Product[]).filter((p) => p !== flare).map((p) => PRODUCTS[p].name.toLowerCase()).join(" and ")}.</p>` : ""}
        ${supRows ? `<h3 class="sub-h">Supplies</h3><dl class="facts">${supRows}</dl><p class="small muted">${supNote}</p>` : ""}
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
      if (this.setPanel(this.anatomy(m, { kind: b.kind, actions: act, body, details }))) this.bindDemolishBtn(demolish);
      return;
    }
    if (!b.zone) {
      if (this.setPanel(this.anatomy(m, { kind: "other", actions: act, details: `<p class="muted">${T.blurb}</p>` }))) this.bindDemolishBtn(demolish);
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
    const nextLv = b.level < 5 ? LEVEL_LV[b.level + 1] : null;
    const lvBar = `<span class="bar lv"><i style="width:${Math.max(3, b.lv)}%"></i>${nextLv ? `<em style="left:${nextLv}%"></em>` : ""}</span>`;
    rows.push(["Land value", `${lvBar}<span class="num">${Math.round(b.lv)}</span>`]);
    const lvK = nextLv ? Math.max(0, Math.min(1, (b.lv - LEVEL_LV[b.level]) / (nextLv - LEVEL_LV[b.level]))) : 1;
    rows.push(["Level", `<span class="lv-run">${levelRun(`Level ${b.level}`, nextLv ? `Level ${b.level + 1}` : undefined, lvK)}</span>${nextLv ? `<span class="muted small">at land value ${nextLv}</span>` : ""}`]);
    const details = `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
    if (this.setPanel(this.anatomy(m, { kind: grp === "res" ? "home" : "shop", actions: act, details }))) this.bindDemolishBtn(demolish);
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
      ${rows ? `<dl class="facts">${rows}</dl>` : `<p class="small muted">Empty. Your buildings send it what no plant or town can take yet.</p>`}
      <h3 class="sub-h">Products</h3>
      <table class="wh-opts"><thead><tr><th scope="col"><span class="sr">Product</span></th><th scope="col" title="Your trucks may bring it here when nothing else will take it">Take</th><th scope="col" title="Sent here first, before plants and towns farther away: it splits a long haul into two legs">Feeder</th></tr></thead><tbody>${opts}</tbody></table>
      <p class="small muted">Taken products come here only when no plant or town wants them. A feeder product comes here first when the warehouse is nearer than its buyers, and its own trucks carry it on.</p>`;
  }

  /** A fuel depot's panel: its fuel, the trucks it filled and what that saved. */
  private depotBody(b: Building, store: number): string {
    const P = b.plant!;
    const fuel = P.stock.fuel ?? 0;
    return `<dl class="facts">
        <dt>Fuel</dt><dd>${stockBar(fuel, store, PRODUCTS.fuel.color)}<span class="num">${fuel.toFixed(1)}</span></dd>
        <dt>Trucks filled</dt><dd>${fmtNum(P.served ?? 0)}</dd>
        <dt>Saved on fuel</dt><dd class="${(P.saved ?? 0) > 0 ? "good" : ""}">${formatMoney(Math.round(P.saved ?? 0))}</dd>
        <dt>Last hour</dt><dd>${plural(P.last.served ?? 0, "truck")} · ${formatMoney(Math.round(P.last.saved ?? 0))}</dd>
      </dl>
      <p class="small muted">Your trucks whose run passes within ${(DEPOT_REACH / 1000).toFixed(1)} km of it fill up here at cost, not the market price, while it has fuel. Your refineries' tankers keep it stocked.</p>`;
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
      body = `<p class="small muted">Unsignalled: cars give way by road priority. A stop sign makes an approach stop and give way to all the others. Lights stop traffic in turns and help busy crossings.</p>
        <div class="phase stops"><span class="ph-name">Stop signs</span><span class="ph-arms">${stopArms.map((a) => `<button class="arm stop-arm ${stops.includes(a.seg) ? "on stop" : ""}" data-seg="${a.seg}" aria-pressed="${stops.includes(a.seg)}" title="Stop sign on this approach">${compass(a.dir)}</button>`).join("")}</span></div>
        <button class="btn primary add-sig" ${sigOn ? "" : "disabled"}>${sigOn ? `Add traffic lights · ${formatMoney(SIGNAL_COST)}` : `Traffic lights unlock with ${unlockedBy((u) => u.features?.includes("signals"))!.name}`}</button>`;
    } else {
      body = `<p class="muted small">The lights run on a fixed clock: ${GREEN} s of green for each phase (${LEFT_GREEN} s for a left-turn arrow), then amber and a moment of all red. Cars may turn right on red after stopping.</p>` + plan.phases.map((p, i) => `<div class="phase ${i === this.panelPhase ? "on" : ""}${live?.st === 0 && live.i === i ? " live" : ""}" data-i="${i}"${live?.st === 0 && live.i === i ? ` title="Green now"` : ""}>
          <span class="ph-name">${i + 1}. ${p.left ? "Left turns" : "All turns"}<button class="ph-left ${p.left ? "on" : ""}" data-i="${i}" aria-pressed="${!!p.left}" title="Only left turns (and U-turns) go in this phase">Left only</button></span>
          <span class="ph-arms">${arms.map((a) => `<button class="arm ${p.arms.includes(a.seg) ? "on" : ""}" data-i="${i}" data-seg="${a.seg}" title="Toggle this approach">${compass(a.dir)}</button>`).join("")}</span>
          <span class="ph-dur"><b title="Green time">${greenFor(p)} s</b></span>
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
    const dlg = this.showModal(`<header class="pm-head pm-co">${heraldSvg(co.herald, co.name, 36)}<span class="pm-co-t">${escapeHtml(co.name)}<span class="muted">Paused · ${escapeHtml(app.game.cityName)}</span></span></header>
      <div class="pm-list">
        <button class="pm resume">Resume</button>
        <button class="pm co">Company</button>
        <button class="pm save">Save game</button>
        <button class="pm load">Load game</button>
        <button class="pm keys">Controls</button>
        <button class="pm tips" role="switch" aria-label="Tips" aria-checked="${!this.tipPrefs.off}">Tips<span class="pm-v">${this.tipPrefs.off ? "Off" : "On"}</span></button>
        <button class="pm nights"></button>
        <button class="pm home">Main menu</button>
        <button class="pm new">New company</button>
      </div>`, "Pause menu");
    dlg.classList.add("pause");
    const on = (s: string, fn: () => void) => { (dlg.querySelector(s) as HTMLButtonElement).onclick = () => { this.sfx.play("click"); fn(); }; };
    on(".resume", () => this.closeModal());
    on(".save", () => this.openSaves(true));
    on(".load", () => this.openSaves(false));
    on(".keys", () => this.openKeys());
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
    wireNights(dlg.querySelector(".nights"), app.dayCycle, () => this.sfx.play("click"));
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
        try { app.loadGame(d); } catch { this.toast("That save is from an older version", true); return; }
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
  if (vs.length < 3) return "";
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

/** A tiny row of 24 hourly bars (the Economy window's production list). */
function hourTicks(vs: number[], color: number): string {
  const hi = Math.max(1, ...vs), W = 72, H = 16, bw = W / vs.length;
  const bars = vs.map((v, i) => v > 0 ? `<rect x="${(i * bw).toFixed(1)}" y="${(H - (v / hi) * H).toFixed(1)}" width="${(bw - 0.6).toFixed(1)}" height="${((v / hi) * H).toFixed(1)}"/>` : "").join("");
  return `<svg class="pd-ticks" style="--pc:${onPlate(color)}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg>`;
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
    <text class="tc-t" x="${W}" y="9" text-anchor="end">dashed: full pace, ${pace < 10 ? pace.toFixed(1) : Math.round(pace)} an hour</text>
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
function miniSpark(vs: number[]): string {
  if (vs.length < 3) return `<span class="tw-spark"></span>`;
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(1, hi - lo);
  const pts = vs.map((v, i) => `${((i / (vs.length - 1)) * 56).toFixed(1)},${(17 - ((v - lo) / span) * 14).toFixed(1)}`).join(" ");
  return `<svg class="tw-spark" viewBox="0 0 56 20" aria-hidden="true" focusable="false"><polyline points="${pts}"/></svg>`;
}

function sparkline(vs: number[], what: string): string {
  if (vs.length < 2) return "";
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(1, hi - lo);
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * 220},${38 - ((v - lo) / span) * 34}`).join(" ");
  return `<svg class="spark" viewBox="0 -2 220 42" preserveAspectRatio="none" role="img" aria-label="${what} over the last ${vs.length} hours"><polyline points="${pts}" fill="none" stroke="#2373c4" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg><p class="muted small">${what}, last ${vs.length} hours</p>`;
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
  if (L >= SITE_LEVELS) return `<h3 class="sub-h">Site level ${L} of ${SITE_LEVELS}</h3><p class="small muted">Fully grown: ${mult}.</p>`;
  const k = Math.max(0, Math.min(1, (P.grow ?? 0) / growNeed(P.level)));
  // (the reason it stalls is often the status line above already: no need to say it twice)
  const why = !P.why ? "Growing: it works near capacity, ships its output and gets its inputs."
    : P.why === b.problem ? "Not growing till that is fixed."
    : `<span class="bad">Held back: ${P.why}.</span>`;
  return `<h3 class="sub-h">Site level ${L} of ${SITE_LEVELS}</h3>
    <dl class="facts"><dt>Growing</dt><dd><span class="lv-run">${levelRun(`Level ${L}`, `Level ${L + 1}`, k)}</span><span class="num">${Math.round(k * 100)}%</span></dd></dl>
    <p class="small muted">${why} Now ${mult}; level ${L + 1} gives ×${LEVEL_MULT[L]}${next.length ? ` and works through ${productList(Object.fromEntries(next.map((p) => [p, 1])))}, so it grows once it has some in store` : ""}.</p>`;
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmtLoads = (n: number) => (n < 10 && n % 1 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));

/** Where a plant's outputs go, as a clause: sold to towns, taken to the company's plants, or flared for now. */
function outputsText(o: Partial<Record<Product, number>>): string {
  const outs = Object.keys(o) as Product[];
  const pick = (f: (p: Product) => boolean) => Object.fromEntries(outs.filter(f).map((p) => [p, 1])) as Partial<Record<Product, number>>;
  const sold = pick((p) => PRODUCTS[p].price > 0), fed = pick((p) => !PRODUCTS[p].price && Industry.usedBy(p)), idle = pick((p) => !Industry.useful(p));
  const parts: string[] = [];
  if (Object.keys(sold).length) parts.push(`its own trucks sell the ${productList(sold)} to the towns on your roads`);
  if (Object.keys(fed).length) parts.push(`its trucks take the ${productList(fed)} to your plants that use it`);
  for (const p of Object.keys(idle) as Product[]) parts.push(`it burns off the ${PRODUCTS[p].name.toLowerCase()} until tier ${Industry.laterTier(p)} brings plants that use it`);
  return parts.join("; ");
}

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

/** A site's materials: "6 loads of planks". */
function siteText(o: Partial<Record<Product, number>>): string {
  return (Object.entries(o) as [Product, number][]).map(([p, n]) => `${plural(n, "load")} of ${PRODUCTS[p].name.toLowerCase()}`).join(" and ");
}

/** Which way a town is heading, in a word (the Towns list): no numbers, as in its panel (needs.ts growthOf). */
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
