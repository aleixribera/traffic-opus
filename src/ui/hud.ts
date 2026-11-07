import { BUILDING_TYPES, LEVEL_H, MAX_LEVEL, ROAD_TYPES, SIGNAL_COST, type RoadTypeId } from "../config";
import { formatMoney, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { LEVEL_LV, ZONE_GROUP } from "../game/growables";
import { MILESTONES } from "../game/progression";
import { ZONES, ZONE_ORDER, type ZoneGroup, type ZoneId } from "../game/zones";
import type { SignalPlan } from "../roads/network";
import { ROAD_MODES, type App, type OverlayId, type RoadMode, type ToolId, type ZoneMode } from "../app";
import { ROUNDABOUTS, type RoundaboutSize } from "../roads/planner";
import { ICON, roadIcon, serviceIcon } from "./icons";
import { SERVICES, SERVICE_TABS, type ServiceKind } from "../game/services";
import { Sfx } from "./sfx";

export interface Chip {
  text: string;
  kind: "info" | "error" | "cost";
  icon?: keyof typeof ICON;
}

const OVERLAYS: { id: OverlayId; label: string; blurb: string }[] = [
  { id: "flow", label: "Traffic flow", blurb: "How fast each road moves compared with its speed limit" },
  { id: "zones", label: "Zoning", blurb: "What each zoned cell allows to grow" },
  { id: "landvalue", label: "Land value", blurb: "Higher value lets buildings level up" },
  { id: "level", label: "Building level", blurb: "Buildings grow from level 1 to 5" },
  { id: "problems", label: "Problems", blurb: "Buildings missing workers, goods or customers" },
  { id: "garbage", label: "Garbage", blurb: "Where garbage trucks reach in time" },
  { id: "health", label: "Healthcare", blurb: "Where ambulances reach in time" },
  { id: "fire", label: "Fire", blurb: "Where fire engines reach in time" },
  { id: "police", label: "Police", blurb: "Where patrols reach in time" },
  { id: "school", label: "Education", blurb: "Homes within reach of an elementary school" },
  { id: "parks", label: "Parks", blurb: "Homes near a park" },
];

const GROUP_NAME: Record<ZoneGroup, string> = { res: "Residential", com: "Commercial", ind: "Industrial", off: "Office" };
/** What the player zones more of, for each group ("Zone more homes"). */
const GROUP_LAND: Record<ZoneGroup, string> = { res: "homes", com: "shops", ind: "industry", off: "offices" };
/** Demand at which a group with no empty zoned land left is worth telling the player about. */
const LAND_SHORT = 40;
const GROUP_LETTER: Record<ZoneGroup, string> = { res: "R", com: "C", ind: "I", off: "O" };
const GROUPS: ZoneGroup[] = ["res", "com", "ind", "off"];
export const BRUSH_SIZES: { r: number; label: string }[] = [{ r: 10, label: "S" }, { r: 22, label: "M" }, { r: 40, label: "L" }];

/** Build categories along the bottom bar, each with its asset tabs. */
type CatId = "roads" | "zoning" | "services";
type Asset =
  | { kind: "road"; id: RoadTypeId }
  | { kind: "service"; id: ServiceKind }
  | { kind: "roundabout"; size: RoundaboutSize }
  | { kind: "junction" }
  | { kind: "lane" }
  | { kind: "zone"; id: ZoneId };
interface Tab { id: string; label: string; assets: Asset[] }
const CATS: Record<CatId, { label: string; tabs: Tab[] }> = {
  roads: {
    label: "Roads",
    tabs: [
      { id: "small", label: "Small roads", assets: [{ kind: "road", id: "one1" }, { kind: "road", id: "street" }, { kind: "road", id: "streetM" }] },
      { id: "medium", label: "Medium roads", assets: [{ kind: "road", id: "one2" }, { kind: "road", id: "avenue" }, { kind: "road", id: "avenueM" }] },
      { id: "large", label: "Large roads", assets: [{ kind: "road", id: "boulevard" }, { kind: "road", id: "boulevardM" }] },
      { id: "highways", label: "Highways", assets: [{ kind: "road", id: "hw1" }, { kind: "road", id: "hw2" }, { kind: "road", id: "one3" }, { kind: "road", id: "one4" }] },
      { id: "junctions", label: "Intersections", assets: [1, 2, 3, 4].map((s) => ({ kind: "roundabout", size: s as RoundaboutSize }) as Asset).concat([{ kind: "lane" }, { kind: "junction" }]) },
    ],
  },
  zoning: {
    label: "Zoning",
    tabs: GROUPS.map((gp) => ({ id: gp, label: GROUP_NAME[gp], assets: ZONE_ORDER.filter((z) => ZONES[z].group === gp).map((id) => ({ kind: "zone", id }) as Asset) })),
  },
  services: {
    label: "Services",
    tabs: SERVICE_TABS.map((t) => ({ id: t.id, label: t.label, assets: t.kinds.map((id) => ({ kind: "service", id }) as Asset) })),
  },
};
const catOf = (t: ToolId): CatId | null => (t === "road" || t === "roundabout" || t === "junction" || t === "lane" ? "roads" : t === "zone" ? "zoning" : t === "service" ? "services" : null);

type WinId = "info" | "progression" | "economy" | "city" | "transport";

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
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(Math.round(n)))}`;
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

type Milestone = (typeof MILESTONES)[number];
const unlockAt = (test: (m: Milestone) => boolean): Milestone | undefined => MILESTONES.find(test);
const servicesAt = (i: number) => (Object.values(SERVICES)).filter((s) => s.unlock === i).map((s) => BUILDING_TYPES[s.kind].name);
const FEATURE_NAME = { roundabout: "Roundabouts", signals: "Traffic lights", grid: "Grid tool", parallel: "Parallel roads" } as const;

const KEYS: [string, string][] = [
  ["Esc", "Back: close a panel, drop the tool, then the pause menu"],
  ["Right click", "Undo the last click of a road; again to drop the tool"],
  ["W A S D / drag", "Move the camera"],
  ["Q / E", "Rotate the camera"],
  ["R / F, wheel", "Zoom in / out"],
  ["Tab", "Next road mode"],
  ["Page Up / Down", "Raise or lower the road"],
  ["[ / ]", "Parallel road spacing"],
  ["Shift", "15° angle steps"],
  ["B", "Bulldozer"],
  ["L", "Add lane (Shift or right click removes)"],
  ["M", "Map tiles"],
  ["P / Z / C / X", "Progression / Economy / City / Transport"],
  ["Space, 1 2 3", "Pause, game speed"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["F5 / F9", "Quicksave / quickload"],
  ["`", "Hide the interface"],
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
  private demandBtn = h("button", "cb-demand");
  private demandPop = h("section", "card demand-pop");
  private cats = h("nav", "cats");
  private assets = h("section", "card assets");
  private toolOpts = h("section", "card toolopts");
  // corners
  private tlBtns = new Map<WinId | "menu" | "tiles", HTMLButtonElement>();
  private win = h("section", "card win");
  private tut = h("section", "card tutorial");
  private panel = h("aside", "card panel");
  private chipBox = h("div", "chips");
  private toastBox = h("div", "toasts");
  private modal = h("div", "modal");
  private rectEl = h("div", "selrect");
  private banner = h("section", "card banner");
  private compass = h("button", "btn icon-btn compass");
  private compassRot = NaN;
  private undoBtn = h("button", "cat hist");
  private redoBtn = h("button", "cat hist");
  private catBtns = new Map<string, HTMLButtonElement>();
  private cat: CatId | null = null;
  private tab: Record<CatId, string> = { roads: "small", zoning: "res", services: "garbage" };
  private lastRoad: RoadTypeId = "street";
  private winKind: WinId | null = null;
  private panelKind: "building" | "signal" | null = null;
  private panelNode = -1;
  private panelPhase = 0;
  private tutHidden = false;
  private lastPanel = "";
  private lastWin = "";
  private lastAssets = "";
  private resumeOnClose = false;
  private sfx = new Sfx();

  constructor(private app: App, parent: HTMLElement) {
    parent.appendChild(this.root);
    this.build();
  }

  private build() {
    const app = this.app;
    // ---- top left: the menu and the city's info buttons
    const tl = h("div", "corner tl");
    const row = h("div", "tl-row");
    const tlb = (k: WinId | "menu" | "tiles", icon: string, title: string, fn: () => void) => {
      const b = h("button", "tlb", icon);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = () => { fn(); this.sfx.play("click"); };
      this.tlBtns.set(k, b);
      row.appendChild(b);
    };
    tlb("menu", ICON.menu, "Pause menu (Esc)", () => this.openPause());
    row.appendChild(h("span", "tl-sep"));
    tlb("info", ICON.layers, "Info views", () => this.toggleWin("info"));
    tlb("progression", ICON.flag, "Progression (P)", () => this.toggleWin("progression"));
    tlb("economy", ICON.coins, "Economy (Z)", () => this.toggleWin("economy"));
    tlb("city", ICON.chart, "City information (C)", () => this.toggleWin("city"));
    tlb("transport", ICON.car, "Transportation overview (X)", () => this.toggleWin("transport"));
    tlb("tiles", ICON.tiles, "Map tiles (M)", () => app.setTool({ tool: app.st.tool === "unlock" ? "inspect" : "unlock" }));
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
      cat("zoning", ICON.zone, "Zoning", "Zoning", () => this.toggleCat("zoning")),
      cat("services", ICON.services, "Services", "City services", () => this.toggleCat("services")),
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
    this.demandBtn.title = "Zone demand: what the city wants built";
    this.demandBtn.setAttribute("aria-label", "Zone demand");
    this.demandBtn.setAttribute("aria-expanded", "false");
    this.demandBtn.innerHTML = GROUPS.map((gp) => `<span class="dm dm-${gp}"><i></i><b>${GROUP_LETTER[gp]}</b></span>`).join("");
    this.demandBtn.onclick = () => {
      this.demandPop.hidden = !this.demandPop.hidden;
      this.demandBtn.setAttribute("aria-expanded", String(!this.demandPop.hidden));
      this.fillDemand();
    };
    this.demandPop.hidden = true;
    time.append(this.clockEl, this.speed, this.demandBtn);
    this.bbar.append(city, this.cats, time);
    this.assets.hidden = true;
    this.toolOpts.hidden = true;
    bottom.append(this.toolOpts, this.assets, this.demandPop, this.bbar);

    this.panel.hidden = true;
    this.modal.hidden = true;
    this.banner.hidden = true;
    this.rectEl.hidden = true;
    this.tut.hidden = true;
    this.root.append(tl, tr, bottom, this.chipBox, this.toastBox, this.banner, this.rectEl, this.modal);
    document.addEventListener("pointerdown", (e) => {
      const tg = e.target as Node;
      if (!this.demandPop.hidden && !this.demandPop.contains(tg) && !this.demandBtn.contains(tg)) {
        this.demandPop.hidden = true;
        this.demandBtn.setAttribute("aria-expanded", "false");
      }
      this.sfx.unlock();
    });
  }

  // ---------------------------------------------------------------- categories

  private toggleCat(c: CatId) {
    const app = this.app;
    if (this.cat === c) {
      this.cat = null;
      if (catOf(app.st.tool) === c) app.setTool({ tool: "inspect" });
      else this.refresh();
      return;
    }
    this.cat = c;
    // like picking up the last thing you built from this category
    if (c === "roads") app.setTool({ tool: "road", roadType: this.lastRoad });
    else if (c === "services") {
      // open on the first tab with something buildable, holding the tool only if it's unlocked
      const k = app.game.serviceUnlocked(app.st.service) ? app.st.service : SERVICE_TABS.flatMap((t) => t.kinds).find((x) => app.game.serviceUnlocked(x));
      if (k) app.setTool({ tool: "service", service: k });
      else this.refresh();
    } else app.setTool({ tool: "zone", erase: false });
  }

  private pick(a: Asset) {
    const app = this.app;
    if (a.kind === "road") { this.lastRoad = a.id; app.setTool({ tool: "road", roadType: a.id }); }
    else if (a.kind === "roundabout") app.setTool({ tool: "roundabout", rbSize: a.size });
    else if (a.kind === "junction") app.setTool({ tool: "junction" });
    else if (a.kind === "lane") app.setTool({ tool: "lane" });
    else if (a.kind === "service") app.setTool({ tool: "service", service: a.id });
    else app.setTool({ tool: "zone", zone: a.id, erase: false });
    this.sfx.play("click");
  }

  /** The asset a tool state points at (to light its card and open its tab). */
  private current(): Asset | null {
    const st = this.app.st;
    if (st.tool === "road") return { kind: "road", id: st.roadType };
    if (st.tool === "roundabout") return { kind: "roundabout", size: st.rbSize };
    if (st.tool === "junction") return { kind: "junction" };
    if (st.tool === "lane") return { kind: "lane" };
    if (st.tool === "service") return { kind: "service", id: st.service };
    if (st.tool === "zone") return st.erase ? null : { kind: "zone", id: st.zone };
    return null;
  }

  private assetInfo(a: Asset): { key: string; icon: string; name: string; sub: string; title: string; locked?: Milestone } {
    const g = this.app.game;
    if (a.kind === "road") {
      const T = ROAD_TYPES[a.id];
      const locked = g.roadsUnlocked.has(a.id) ? undefined : unlockAt((m) => m.roads.includes(a.id));
      const lanes = T.bwd ? `${T.fwd}+${T.bwd} lanes` : `${T.fwd} lane${T.fwd > 1 ? "s" : ""} one-way`;
      return { key: "road:" + a.id, icon: roadIcon(a.id), name: T.name, sub: `${formatMoney(T.costPerM * 10)}/10 m`, title: `${T.name} · ${lanes} · ${Math.round(T.speed * 3.6)} km/h. ${T.hint}`, locked };
    }
    if (a.kind === "roundabout") {
      const R = ROUNDABOUTS[a.size];
      const locked = g.featureUnlocked("roundabout") ? undefined : unlockAt((m) => m.features.includes("roundabout"));
      return { key: "rb:" + a.size, icon: rbIcon(a.size), name: `${R.name} roundabout`, sub: `${R.r * 2} m`, title: `${R.name} roundabout: ${R.r * 2} m across, ${ROAD_TYPES[R.type].fwd}-lane ring. Drop it on a junction or a road.`, locked };
    }
    if (a.kind === "service") {
      const S = SERVICES[a.id], T = BUILDING_TYPES[a.id];
      const locked = g.serviceUnlocked(a.id) ? undefined : MILESTONES[S.unlock];
      const what = S.vehicles ? `${S.vehicles} vehicles` : S.cap ? `${S.cap} ${S.tier === 0 ? "pupils" : "students"}` : "";
      return {
        key: "svc:" + a.id, icon: serviceIcon(a.id), name: T.name, sub: `${formatMoney(S.cost)} · ${formatMoney(S.upkeep)}/h`,
        title: `${T.name}: ${T.blurb}${what ? ` ${what}.` : ""} Costs ${formatMoney(S.cost)}, upkeep ${formatMoney(S.upkeep)} an hour.`, locked,
      };
    }
    if (a.kind === "lane") {
      return {
        key: "lane", icon: ICON.lane, name: "Add lane", sub: "Turn & slip lanes",
        title: "Add lane (L): click a road just before a junction for a turn lane, nearer the middle for left turns, nearer the kerb for right turns. On a motorway, click before an exit or after an entry to lengthen its slip lane. Shift or right click removes a turn lane.",
      };
    }
    if (a.kind === "junction") {
      const locked = g.featureUnlocked("signals") ? undefined : unlockAt((m) => m.features.includes("signals"));
      return { key: "junction", icon: ICON.junction, name: "Traffic lights", sub: formatMoney(SIGNAL_COST), title: "Traffic lights: click a junction to add lights or edit their phases", locked };
    }
    const Z = ZONES[a.id];
    const locked = g.zonesUnlocked.has(a.id) ? undefined : unlockAt((m) => m.zones.includes(a.id));
    return { key: "zone:" + a.id, icon: `<i class="swatch" style="background:${hex(Z.color)}"></i>`, name: Z.short, sub: Z.high ? "High density" : "Low density", title: Z.name, locked };
  }

  private renderAssets() {
    const c = this.cat, el = this.assets;
    if (!c) { el.hidden = true; this.lastAssets = ""; return; }
    const cur = this.current();
    const curKey = cur ? this.assetInfo(cur).key : "";
    const C = CATS[c];
    // follow the tool to its tab (keyboard, right click, loading)
    if (cur && catOf(this.app.st.tool) === c) {
      const t = C.tabs.find((t) => t.assets.some((a) => this.assetInfo(a).key === curKey));
      if (t && this.followKey !== curKey) this.tab[c] = t.id;
    }
    this.followKey = curKey;
    const tab = C.tabs.find((t) => t.id === this.tab[c]) ?? C.tabs[0];
    const infos = tab.assets.map((a) => ({ a, ...this.assetInfo(a) }));
    const sig = [c, tab.id, curKey, infos.map((i) => i.key + (i.locked ? "L" : "")).join()].join("|");
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
      b.title = i.locked ? `${i.name} · unlocks at ${i.locked.name} (${fmtNum(i.locked.pop)} people)` : i.title;
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
    const tc = catOf(st.tool);
    if (tc) this.cat = tc;
    else if (st.tool !== "inspect") this.cat = null;
    if (st.tool === "road") this.lastRoad = st.roadType;
    for (const [k, b] of this.catBtns) {
      const on = k === "bulldoze" ? st.tool === "bulldoze" : this.cat === k;
      b.classList.toggle("on", on);
      b.setAttribute(k === "bulldoze" ? "aria-pressed" : "aria-expanded", String(on));
    }
    for (const [k, b] of this.tlBtns) {
      const on = k === "tiles" ? st.tool === "unlock" : k === "info" ? this.winKind === "info" || app.overlay !== "none" : this.winKind === k;
      b.classList.toggle("on", on);
    }
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
    const app = this.app, st = app.st, g = app.game;
    const el = this.toolOpts;
    const fa = document.activeElement;
    const focusKey = fa instanceof HTMLElement && el.contains(fa) ? fa.getAttribute("aria-label") : null;
    el.innerHTML = "";
    const sec = (title: string, ...kids: HTMLElement[]) => {
      const s = h("div", "to-sec");
      s.append(h("span", "to-label", title), ...kids);
      return s;
    };
    const seg = (items: { html: string; on: boolean; title: string; fn: () => void; cls?: string; disabled?: boolean }[], cls = "") => {
      const w = h("div", "seg " + cls);
      for (const it of items) {
        const b = h("button", "seg-btn " + (it.cls ?? ""), it.html);
        b.classList.toggle("on", it.on);
        b.setAttribute("aria-pressed", String(it.on));
        b.title = it.title;
        b.setAttribute("aria-label", it.title);
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
    const elevation = () => sec("Elevation", stepper(st.level === 0 ? "Ground" : `${st.level * LEVEL_H} m`, "lvl lvl" + st.level,
      () => app.setLevel(st.level - 1), () => app.setLevel(st.level + 1), ["Lower (Page Down)", "Raise (Page Up)"], [st.level <= 0, st.level >= MAX_LEVEL]));
    const items: HTMLElement[] = [];
    if (st.tool === "road") {
      const T = ROAD_TYPES[st.roadType];
      const MODE: Record<RoadMode, { icon: string; title: string }> = {
        straight: { icon: ICON.straight, title: "Straight: click the start, then the end" },
        curve: { icon: ICON.curve, title: "Simple curve: start, bend point, end" },
        complex: { icon: ICON.complex, title: "Complex curve: start, two handles, end" },
        continuous: { icon: ICON.continuous, title: "Continuous: each click carries the road on smoothly" },
        grid: { icon: ICON.gridMode, title: "Grid: click a corner, the width, then the depth" },
        replace: { icon: ICON.replace, title: "Replace: click a road to change it to this type" },
      };
      items.push(sec("Mode", seg(ROAD_MODES.map((m) => ({ html: MODE[m].icon, on: st.mode === m, title: MODE[m].title + " (Tab)", fn: () => app.setTool({ mode: m }), disabled: m === "grid" && !g.featureUnlocked("grid") })))));
      if (st.mode === "replace") {
        items.push(sec("Replace", seg([
          { html: "Type", on: !st.reverse, title: `Turn a road into ${T.name}`, fn: () => app.setTool({ reverse: false }) },
          { html: "Reverse", on: st.reverse, title: "Flip a one-way road (Shift+click)", fn: () => app.setTool({ reverse: true }) },
        ])));
      } else {
        if (st.mode !== "grid") {
          const off = Math.round(app.parallelOffset());
          const par = seg([{ html: ICON.parallel, on: st.parallel, title: T.bwd === 0 ? "Parallel: also build the opposite carriageway" : "Parallel: also build a second road alongside", fn: () => app.setTool({ parallel: !st.parallel }) }]);
          items.push(st.parallel
            ? sec("Parallel", par, stepper(`${off} m`, "", () => app.nudgeParallel(-1), () => app.nudgeParallel(1), ["Closer ([)", "Further apart (])"], [false, false]))
            : sec("Parallel", par));
        }
        items.push(elevation());
        const snap = h("div", "snaps");
        const opts: { k: "geometry" | "guides" | "netSide" | "length" | "angle"; label: string; on: boolean }[] = [
          { k: "angle", label: "15° angles", on: st.angleLock },
          { k: "geometry", label: "Existing roads", on: !st.snapOff.geometry },
          { k: "guides", label: "Guidelines", on: !st.snapOff.guides },
          { k: "netSide", label: "Road sides", on: !st.snapOff.netSide },
          { k: "length", label: "8 m lengths", on: st.snapLength },
        ];
        for (const o of opts) {
          const l = h("label", "snap-row", `<input type="checkbox" ${o.on ? "checked" : ""}><span>${o.label}</span>`);
          const cb = l.querySelector("input")!;
          if (o.k === "angle") l.title = "Straight roads turn in 15° steps. Hold Shift to flip this while drawing.";
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
    } else if (st.tool === "zone") {
      const ZMODE: Record<ZoneMode, { icon: string; title: string }> = {
        fill: { icon: ICON.fill, title: "Fill: click to zone a whole block of empty cells" },
        brush: { icon: ICON.brush, title: "Paint: drag over cells" },
        marquee: { icon: ICON.marquee, title: "Marquee: drag a rectangle" },
      };
      items.push(sec("Mode", seg((["fill", "brush", "marquee"] as ZoneMode[]).map((m) => ({ html: ZMODE[m].icon, on: st.zoneMode === m, title: ZMODE[m].title, fn: () => app.setTool({ zoneMode: m }) })))));
      if (st.zoneMode === "brush") items.push(sec("Size", seg(BRUSH_SIZES.map((s) => ({ html: s.label, on: st.brush === s.r, title: `Brush size ${s.label}`, fn: () => app.setTool({ brush: s.r }) })))));
      items.push(sec("Unzone", seg([{ html: ICON.erase, on: st.erase, title: "Unzone (or use the right mouse button)", fn: () => app.setTool({ erase: !st.erase }) }])));
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
    } else if (st.tool === "unlock") {
      const left = g.tileSlotsLeft;
      items.push(h("p", "to-text", left > 0
        ? `Next tile ${formatMoney(g.nextTilePrice)} · ${left} more allowed. Click a darkened tile next to your land.`
        : "Reach the next milestone to buy more land."));
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

  /** Cheap periodic update: the bar, tips, open panels. */
  tick(force = false) {
    const g = this.app.game;
    if (!g) return;
    const st = g.people.stats;
    const M = MILESTONES[g.milestone], N = MILESTONES[g.milestone + 1];
    const prog = N ? Math.max(0, Math.min(1, (st.population - M.pop) / (N.pop - M.pop))) : 1;
    const key = [g.cityName, g.milestone, Math.round(prog * 100)].join("|");
    if (force || this.cityName.dataset.k !== key) {
      this.cityName.dataset.k = key;
      this.cityName.innerHTML = `<b>${escapeHtml(g.cityName)}</b><span class="cb-ms"><span>${M.name}</span><i style="--p:${prog}"></i></span>`;
      this.cityName.setAttribute("aria-label", `${g.cityName}, ${M.name}. ${N ? `${Math.round(prog * 100)}% of the way to ${N.name}` : "Final milestone"}. Open progression`);
    }
    this.popEl.innerHTML = `${ICON.people}<span>${fmtNum(st.population)}</span>`;
    const net = g.netIncome;
    this.moneyBtn.innerHTML = `<b class="${g.money < 0 ? "bad" : ""}">${formatMoney(Math.round(g.money))}</b><span class="${net >= 0 ? "good" : "bad"}">${signed(net)}/h</span>`;
    this.moneyBtn.setAttribute("aria-label", `Money ${formatMoney(Math.round(g.money))}, ${signed(net)} per hour. Open economy`);
    const hr = g.hour, mm = Math.floor((hr % 1) * 60 / 10) * 10;
    this.clockEl.innerHTML = `<b>${String(Math.floor(hr)).padStart(2, "0")}:${String(mm).padStart(2, "0")}</b><span class="cb-day">Day ${g.day}</span>`;
    this.clockEl.classList.toggle("night", hr < 6 || hr >= 21);
    const bars = this.demandBtn.querySelectorAll<HTMLElement>(".dm i");
    GROUPS.forEach((gp, i) => bars[i].style.setProperty("--v", String(g.demand[gp].v / 100)));
    if (!this.demandPop.hidden) this.fillDemand();
    this.renderTips();
    if (this.panelKind === "building" && this.app.selected) {
      if (!g.buildings.byId.has(this.app.selected.id)) { this.closeSelection(); this.app.selected = null; }
      else this.fillBuilding(this.app.selected);
    }
    if (this.winKind) this.fillWin();
  }

  private fillDemand() {
    const g = this.app.game;
    const html = GROUPS.map((gp) => {
      const d = g.demand[gp];
      let fs = d.factors.filter((f) => f.v !== 0 || f.label.startsWith("Unlocks")).map((f) =>
        `<li><span>${f.label}</span><b class="${f.v > 0 ? "good" : f.v < 0 ? "bad" : ""}">${f.v > 0 ? "+" : f.v < 0 ? "−" : ""}${Math.abs(f.v) || ""}</b></li>`).join("");
      if (d.v >= LAND_SHORT && g.freeLand(gp) === 0) fs += `<li class="short"><span>No empty ${GROUP_LAND[gp]} zones: zone more</span></li>`;
      return `<div class="dp-row"><div class="dp-head"><i class="dm-${gp}"></i><span>${GROUP_NAME[gp]}</span><span class="dp-bar"><i class="dm-${gp}" style="width:${d.v}%"></i></span><b>${d.v}</b></div><ul>${fs}</ul></div>`;
    }).join("");
    if (this.demandPop.dataset.h !== html) {
      this.demandPop.dataset.h = html;
      this.demandPop.innerHTML = `<header>Zone demand</header><p class="muted small">Zone more of whatever is high: buildings only grow where there is demand.</p>${html}`;
    }
  }

  private renderTips() {
    const tip = this.tipFor();
    const crowded = !!this.winKind && matchMedia("(max-width: 760px)").matches; // phones: one thing at the top at a time
    if (!tip || this.tutHidden || this.panelKind || crowded || this.app.mode !== "play") { this.tut.hidden = true; this.hint(null); return; }
    this.tut.hidden = false;
    if (this.tut.dataset.k !== tip.key) {
      this.tut.dataset.k = tip.key;
      this.tut.innerHTML = `<button class="close" aria-label="Hide tips">${ICON.close}</button><p>${tip.html}</p>`;
      (this.tut.querySelector(".close") as HTMLButtonElement).onclick = () => { this.tutHidden = true; this.tut.hidden = true; this.hint(null); };
    }
    this.hint(tip.cat ?? null);
  }

  private hint(cat: string | null) {
    for (const [k, b] of this.catBtns) b.classList.toggle("hint", k === cat && !b.classList.contains("on"));
  }

  private tipFor(): { key: string; html: string; cat?: string } | null {
    const g = this.app.game;
    let own = 0;
    for (const s of g.net.segs.values()) if (ROAD_TYPES[s.type].allowsAccess) { own++; break; }
    if (!own) return { key: "roads", cat: "roads", html: "<b>Connect to the highway.</b> Open <b>Roads</b>, pick <b>Street</b>, click on the highway to start, and click again to lay a road towards open land." };
    let zoned = 0, jobsZoned = 0;
    for (const c of g.zones.allCells()) if (c.zone) { zoned++; if (ZONE_GROUP[c.zone] !== "res") jobsZoned++; if (zoned > 40 && jobsZoned > 20) break; }
    if (zoned < 10) return { key: "zone", cat: "zoning", html: "<b>Zone homes.</b> Open <b>Zoning</b>, pick <b>Low homes</b> and click beside your street. Houses grow when there is demand." };
    if (jobsZoned < 8) return { key: "jobs", cat: "zoning", html: "<b>Zone jobs.</b> New residents need work and shops. Zone some <b>Industry</b> and <b>Low shops</b>, away from homes if you can: factories lower land value." };
    // demand nothing can meet: everything zoned for it is built
    for (const gp of GROUPS) {
      if (g.demand[gp].v >= LAND_SHORT && g.freeLand(gp) === 0) return { key: "land-" + gp, cat: "zoning", html: `<b>Zone more ${GROUP_LAND[gp]}.</b> Demand is high, but every lot zoned for ${GROUP_LAND[gp]} is built: nothing more can grow until you zone more land.` };
    }
    if (g.people.stats.population < 60) return { key: "grow", html: "<b>Watch the demand bars</b> at the bottom right. Zone more of whatever is high. Trucks bring goods from the highway; keep the road to it flowing." };
    if (g.milestone === 0) return { key: "ms", html: `<b>Grow to ${MILESTONES[1].pop} people</b> to reach ${MILESTONES[1].name}: it unlocks avenues, roundabouts and traffic lights. Progression (P) shows what's next.` };
    return null;
  }

  // ---------------------------------------------------------------- transient UI

  chips(pos: V2 | null, list: Chip[] = []) {
    const box = this.chipBox;
    if (!pos || !list.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = list.map((c) => `<span class="chip ${c.kind}">${c.icon ? ICON[c.icon] : ""}${c.text}</span>`).join("");
    const r = this.root.getBoundingClientRect();
    const w = box.offsetWidth || 200, hh = box.offsetHeight || 24;
    let x = pos.x + 18, y = pos.y + 20;
    if (x + w > r.width - 8) x = pos.x - w - 14;
    if (y + hh > r.height - 90) y = pos.y - hh - 16;
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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

  /** A milestone was reached: what it unlocks, and the grant. */
  milestone(index: number) {
    const M = MILESTONES[index];
    const unl: string[] = [...M.roads.map((r) => ROAD_TYPES[r].name), ...M.zones.map((z) => ZONES[z].name), ...M.features.map((f) => FEATURE_NAME[f]), ...servicesAt(index)];
    this.banner.innerHTML = `<header>${M.name}</header>
      <p class="sub">Milestone reached · ${fmtNum(M.pop)} people</p>
      ${unl.length ? `<p class="gifts">Unlocked: ${unl.join(" · ")}</p>` : ""}
      ${index === 1 ? `<p class="gifts">Your town now needs city services: garbage, healthcare, fire and police (Services menu)</p>` : ""}
      <p class="gifts">+${formatMoney(M.grant)} grant · ${M.tiles} more map tile${M.tiles === 1 ? "" : "s"} to buy</p>
      <button class="btn primary">Continue</button>`;
    this.banner.hidden = false;
    this.banner.classList.remove("in");
    void this.banner.offsetWidth;
    this.banner.classList.add("in");
    const ok = this.banner.querySelector("button") as HTMLButtonElement;
    ok.onclick = () => { this.banner.hidden = true; };
    requestAnimationFrame(() => ok.focus({ preventScroll: true }));
    this.sfx.play("level");
    this.refresh();
  }

  // ---------------------------------------------------------------- back / Esc

  /** One step back, the way Esc works: popups, dialogs, panels, the tool, the asset menu. False when there was nothing to close. */
  /** A new city has just been started (from the title menu): the tips start over. */
  newCity() {
    this.tutHidden = false;
    this.refresh();
  }

  back(): boolean {
    if (!this.demandPop.hidden) { this.demandPop.hidden = true; this.demandBtn.setAttribute("aria-expanded", "false"); return true; }
    if (!this.banner.hidden) { this.banner.hidden = true; return true; }
    if (!this.modal.hidden) { this.closeModal(); return true; }
    if (this.panelKind) { this.closeSelection(); this.app.selected = null; return true; }
    if (this.winKind) { this.closeWin(); return true; }
    if (this.app.st.tool !== "inspect") { this.cat = null; this.app.setTool({ tool: "inspect" }); return true; }
    if (this.cat) { this.cat = null; this.refresh(); return true; }
    return false;
  }

  /** Called when the tool changes away from inspecting: the selection panel gives way. */
  closePanels(): boolean {
    const was = !!this.panelKind;
    this.closeSelection();
    return was;
  }

  private closeSelection() {
    this.panel.hidden = true;
    this.panelKind = null;
    this.lastPanel = "";
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

  private setWin(title: string, html: string): boolean {
    const full = `<header class="win-head"><b>${title}</b><button class="close" aria-label="Close ${title}">${ICON.close}</button></header><div class="win-body">${html}</div>`;
    if (full === this.lastWin) return false;
    this.lastWin = full;
    const body = this.win.querySelector(".win-body");
    const scroll = body?.scrollTop ?? 0;
    this.win.innerHTML = full;
    this.win.querySelector(".win-body")!.scrollTop = scroll;
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
  }

  private fillInfo() {
    const app = this.app;
    const rows = OVERLAYS.map((o) => `<button class="iv ${app.overlay === o.id ? "on" : ""}" data-id="${o.id}" aria-pressed="${app.overlay === o.id}"><span class="ov-dot ov-${o.id}"></span><span><b>${o.label}</b><span class="small muted">${o.blurb}</span></span></button>`).join("");
    if (!this.setWin("Info views", `<div class="iv-list">${rows}</div><div class="legend">${this.legendHtml()}</div>`)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".iv")) b.onclick = () => { app.setOverlay(b.dataset.id as OverlayId); this.sfx.play("click"); this.fillInfo(); };
  }

  private legendHtml(): string {
    const o = this.app.overlay;
    if (o === "flow") return `<span class="lg lg-flow"></span><span>Free flowing</span><span>Jammed</span>`;
    if (o === "landvalue") return `<span class="lg lg-sat"></span><span>Low</span><span>High</span>`;
    if (o === "level") return `<span class="lg lg-level"></span><span>Level 1</span><span>Level 5</span>`;
    if (o === "problems") return `<span class="lg lg-prob"></span><span>Has a problem</span><span>Fine</span>`;
    if (o === "zones") return GROUPS.map((gp) => `<span class="lg-key"><i class="dm-${gp}"></i>${GROUP_NAME[gp]}</span>`).join("");
    if (o === "garbage" || o === "health" || o === "fire" || o === "police" || o === "school" || o === "parks") return `<span class="lg lg-cov"></span><span>Not covered</span><span>Well covered</span>`;
    return "";
  }

  private fillEconomy() {
    const g = this.app.game;
    const B = g.budget;
    const inc = GROUPS.map((gp) => [GROUP_NAME[gp], B.income[gp]] as [string, number]);
    const totalIn = inc.reduce((a, [, v]) => a + v, 0);
    const totalOut = B.expense.roads + B.expense.services + B.expense.loans;
    const spark = sparkline(g.history.map((x) => x.money), "Money");
    const tax = GROUPS.map((gp) => `<div class="tax-row"><span>${GROUP_NAME[gp]}</span>
      <button class="dur" data-g="${gp}" data-d="-1" aria-label="Lower ${GROUP_NAME[gp]} tax">−</button><b>${g.tax[gp]}%</b><button class="dur" data-g="${gp}" data-d="1" aria-label="Raise ${GROUP_NAME[gp]} tax">+</button></div>`).join("");
    const html = `<p class="win-sub">Per game hour</p>
      <dl class="facts money-rows">${inc.map(([k, v]) => `<dt>${k} taxes</dt><dd class="good">${signed(v)}</dd>`).join("")}
      <dt>Road upkeep</dt><dd class="bad">${signed(-B.expense.roads)}</dd>
      <dt>Service upkeep</dt><dd class="bad">${signed(-B.expense.services)}</dd>
      <dt class="tot">Balance</dt><dd class="tot ${totalIn - totalOut >= 0 ? "good" : "bad"}">${signed(totalIn - totalOut)}</dd></dl>
      ${spark}
      <h3 class="sub-h">Tax rates</h3>
      <p class="muted small">Higher taxes earn more but lower demand for that zone.</p>
      ${tax}`;
    if (!this.setWin("Economy", html)) return;
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".tax-row .dur")) {
      b.onclick = () => {
        const gp = b.dataset.g as ZoneGroup;
        g.tax[gp] = Math.max(0, Math.min(30, g.tax[gp] + Number(b.dataset.d)));
        this.fillEconomy();
        this.sfx.play("click");
      };
    }
  }

  private fillProgression() {
    const g = this.app.game;
    const pop = g.people.stats.population;
    const rows = MILESTONES.slice(1).map((M, k) => {
      const i = k + 1;
      const done = g.milestone >= i;
      const cur = i === g.milestone + 1;
      const unl = [...M.roads.map((r) => ROAD_TYPES[r].name), ...M.zones.map((z) => ZONES[z].short), ...M.features.map((f) => FEATURE_NAME[f]), ...servicesAt(i)];
      const p = cur ? Math.min(1, pop / M.pop) : done ? 1 : 0;
      return `<li class="${done ? "done" : cur ? "cur" : ""}">
        <div class="ms-top">${done ? ICON.check : ICON.open}<b>${M.name}</b><span class="muted">${fmtNum(M.pop)} people</span></div>
        ${cur ? `<span class="bar"><i style="width:${Math.max(2, p * 100)}%"></i></span>` : ""}
        <p class="small muted">${unl.length ? unl.join(" · ") + " · " : ""}${formatMoney(M.grant)} · +${M.tiles} tiles</p></li>`;
    }).join("");
    this.setWin("Progression", `<ul class="ms-list">${rows}</ul>`);
  }

  private fillCity() {
    const g = this.app.game;
    const s = g.people.stats;
    let jobs = 0, homes = 0;
    for (const b of g.buildings.list) { if (!b.zone || b.built < 1) continue; if (ZONE_GROUP[b.zone] === "res") homes += b.cap; else jobs += b.cap; }
    const [e0, e1, e2] = s.edu;
    const edTot = Math.max(1, e0 + e1 + e2);
    const html = `<dl class="facts">
        <dt>Population</dt><dd>${fmtNum(s.population)}${s.movingIn ? ` <span class="muted">+${s.movingIn} moving in</span>` : ""}</dd>
        <dt>Households</dt><dd>${fmtNum(s.households)} <span class="muted">of ${fmtNum(homes)} homes</span></dd>
        <dt>Children · adults · seniors</dt><dd>${s.children} · ${s.adults} · ${s.seniors}</dd>
        <dt>Employed</dt><dd>${fmtNum(s.employed)} <span class="muted">of ${fmtNum(s.workers)}</span></dd>
        <dt>Unemployed</dt><dd class="${s.unemployed > s.workers * 0.1 ? "bad" : ""}">${fmtNum(s.unemployed)}</dd>
        <dt>Commuters from outside</dt><dd>${fmtNum(s.commuters)}</dd>
        <dt>Jobs</dt><dd>${fmtNum(jobs)}</dd>
      </dl>
      <h3 class="sub-h">Education</h3>
      <span class="edu"><i style="flex:${e0 / edTot}"></i><i style="flex:${e1 / edTot}"></i><i style="flex:${e2 / edTot}"></i></span>
      <p class="small muted">Basic ${e0} · High school ${e1} · University ${e2}</p>
      ${sparkline(g.history.map((x) => x.pop), "Population")}`;
    this.setWin("City information", html);
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
      <p class="small muted">The map shows the Traffic flow view while this is open: red roads are jammed.</p>`;
    this.setWin("Transportation", html);
  }

  // ---------------------------------------------------------------- selection panel (top right)

  /** Set the panel's HTML only when it changed (keeps focus and hover steady under the live refresh). */
  private setPanel(html: string): boolean {
    if (html === this.lastPanel) return false;
    this.lastPanel = html;
    this.panel.innerHTML = `<button class="close" aria-label="Close">${ICON.close}</button>${html}`;
    (this.panel.querySelector(".close") as HTMLButtonElement).onclick = () => { this.closeSelection(); this.app.selected = null; };
    return true;
  }

  openBuilding(b: Building) {
    this.panelKind = "building";
    this.lastPanel = "";
    this.panel.hidden = false;
    this.fillBuilding(b);
  }

  private fillBuilding(b: Building) {
    const g = this.app.game;
    const T = BUILDING_TYPES[b.kind];
    const rows: [string, string][] = [];
    let status = "", statusCls = "";
    if (b.svc && b.kind in SERVICES) {
      const S = SERVICES[b.kind as ServiceKind];
      const w = g.people.workersAt(b.id);
      const fleet = g.services.fleet(b);
      if (b.problem) { status = b.problem; statusCls = "bad"; }
      else { status = "Working normally"; statusCls = "good"; }
      if (S.svc !== "parks") rows.push(["Staff", `${w} / ${b.cap}`]);
      if (S.vehicles) rows.push(["Vehicles", `${Math.min(b.busy ?? 0, fleet)} of ${fleet} out${fleet < S.vehicles ? ` <span class="muted">· ${S.vehicles} with full staff</span>` : ""}`]);
      if (S.svc === "health") rows.push(["Patients", `${b.users ?? 0} / ${S.cap}`]);
      if (S.svc === "school") rows.push([S.tier === 0 ? "Pupils" : "Students", `${b.users ?? 0} / ${S.cap}`]);
      if (S.svc === "parks") rows.push(["Visitors", `${Math.round(b.visits)} <span class="muted">recently</span>`]);
      if (S.svc !== "parks") {
        const reach = g.services.reachOf(b).size;
        rows.push(["Covers", `${reach} road${reach === 1 ? "" : "s"} <span class="muted">· ${Math.round(S.range)} s drive</span>`]);
      }
      rows.push(["Upkeep", `${formatMoney(S.upkeep)} / h`]);
      const html = `<header><span class="svc-tag">${serviceIcon(b.kind)}</span>${T.name}</header>
        <p class="muted small">${T.blurb}</p>
        <p class="status ${statusCls}">${status}</p>
        <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        <button class="btn quiet danger demolish">Demolish</button>`;
      if (this.setPanel(html)) this.bindDemolish(b);
      return;
    }
    if (!b.zone) {
      if (!this.setPanel(`<header>${T.name}</header><p class="muted">${T.blurb}</p><button class="btn quiet danger demolish">Demolish</button>`)) return;
      this.bindDemolish(b);
      return;
    }
    const Z = ZONES[b.zone], grp = ZONE_GROUP[b.zone];
    const health = (b as Building & { health?: number }).health ?? 1;
    if (b.abandoned) { status = "Abandoned: it will be cleared and something new can grow"; statusCls = "bad"; }
    else if (b.built < 1) { status = `Under construction · ${Math.round(b.built * 100)}%`; }
    else if (b.problem) { status = b.problem; statusCls = "bad"; }
    else { status = grp === "res" ? "Residents are happy here" : "Business is doing well"; statusCls = "good"; }
    if (grp === "res") {
      const hhs = g.people.hhAt.get(b.id) ?? [];
      let res = 0, adults = 0, emp = 0, kids = 0, old = 0, moving = 0;
      for (const hh of hhs) {
        if (!hh.arrived) moving++;
        for (const c of hh.members) {
          res++;
          if (c.age === 1) { adults++; if (c.job >= 0) emp++; } else if (c.age === 0) kids++; else old++;
        }
      }
      rows.push(["Households", `${hhs.length} / ${b.cap}${moving ? ` <span class="muted">(${moving} moving in)</span>` : ""}`]);
      rows.push(["Residents", `${res}${res ? ` <span class="muted">· ${kids} children, ${old} seniors</span>` : ""}`]);
      if (adults) rows.push(["Working", `${emp} of ${adults} adults`]);
    } else {
      const w = g.people.workersAt(b.id);
      rows.push(["Workers", `${w} / ${b.cap}${grp === "off" ? ` <span class="muted">· needs high school</span>` : ""}`]);
      if (grp === "com") {
        rows.push(["Goods in stock", stockBar(b.stock, 6)]);
        rows.push(["Customers", `${Math.round(b.visits)} <span class="muted">recently</span>`]);
      } else if (grp === "ind") {
        rows.push(["Materials", stockBar(b.stock, 6)]);
        rows.push(["Goods to ship", stockBar(b.out, 6)]);
      }
      if (b.built >= 1 && !b.abandoned) rows.push(["Efficiency", `${Math.round(health * 100)}%`]);
    }
    const next = b.level < 5 ? LEVEL_LV[b.level + 1] : null;
    const lvBar = `<span class="bar lv"><i style="width:${Math.max(3, b.lv)}%"></i>${next ? `<em style="left:${next}%"></em>` : ""}</span>`;
    rows.push(["Land value", `${lvBar}<span class="num">${Math.round(b.lv)}</span>`]);
    if (g.services.active && b.built >= 1 && !b.abandoned) {
      const cv = g.services.cov.get(b.id);
      const have = (["health", "police", "fire", "garbage", "school", "parks"] as const).filter((k) => (cv?.[k] ?? 0) > 0);
      const NAME = { health: "healthcare", police: "police", fire: "fire", garbage: "garbage", school: "school", parks: "park" };
      const miss = (["garbage", "health", "fire", "police"] as const).filter((k) => !have.includes(k));
      rows.push(["Services", have.length ? `${have.map((k) => NAME[k]).join(", ")}${miss.length ? ` <span class="bad">· no ${miss.map((k) => NAME[k]).join(", ")}</span>` : ""}` : `<span class="bad">None in reach</span>`]);
      if (grp === "res" && (g.people.hhAt.get(b.id)?.length ?? 0) > 0) rows.push(["Happiness", `${Math.round(g.services.happiness(b) * 100)}%`]);
      if ((b.garbage ?? 0) > 12) rows.push(["Garbage", stockBar(Math.min(6, Math.round((b.garbage ?? 0) / 20)), 6)]);
      if ((b.crime ?? 0) > 22) rows.push(["Crime", stockBar(Math.min(6, Math.round((b.crime ?? 0) / 15)), 6)]);
    }
    if (!g.linkedOutside(b)) rows.push(["Highway", `<span class="bad">Not connected</span>`]);
    const stars = Array.from({ length: 5 }, (_, i) => `<i class="${i < b.level ? "on" : ""}"></i>`).join("");
    const html = `<header><span class="zone-tag" style="background:${hex(Z.color)}">${Z.short}</span>${Z.name}</header>
      <div class="lvl-row"><span class="stars" role="img" aria-label="Level ${b.level} of 5">${stars}</span><span class="muted">Level ${b.level}${next ? ` · next at land value ${next}` : " · top level"}</span></div>
      <p class="status ${statusCls}">${status}</p>
      <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      <button class="btn quiet danger demolish">Demolish</button>`;
    if (this.setPanel(html)) this.bindDemolish(b);
  }

  private bindDemolish(b: Building) {
    const g = this.app.game;
    const btn = this.panel.querySelector(".demolish") as HTMLButtonElement | null;
    if (btn) btn.onclick = () => { g.bulldoze([], [b.id]); this.closeSelection(); this.app.selected = null; this.sfx.play("remove"); };
  }

  openSignal(node: number) {
    this.panelKind = "signal";
    this.panelNode = node;
    this.panelPhase = 0;
    this.lastPanel = "";
    this.panel.hidden = false;
    this.fillSignal();
  }

  private fillSignal() {
    const g = this.app.game;
    const node = g.net.nodes.get(this.panelNode);
    const ng = g.net.nodeGeom.get(this.panelNode);
    if (!node || !ng) { this.closeSelection(); return; }
    const plan = node.signal;
    const arms = ng.arms;
    const ph = plan ? plan.phases[Math.min(this.panelPhase, plan.phases.length - 1)] : null;
    const spokes = arms.map((a) => {
      const on = ph?.arms.includes(a.seg);
      const x = 50 + a.dir.x * 40, y = 50 + a.dir.y * 40;
      const lx = 50 + a.dir.x * 47 + (Math.abs(a.dir.y) > 0.7 ? 9 : 0), ly = 50 + a.dir.y * 47 + (Math.abs(a.dir.x) > 0.7 ? -8 : 4);
      const stop = !plan && node.stops?.includes(a.seg);
      return `<line x1="50" y1="50" x2="${x}" y2="${y}" stroke="${on ? "#2a9e49" : plan ? "#e5484d" : "#b6bbc1"}" stroke-width="10" stroke-linecap="round" ${on || !plan ? "" : 'stroke-dasharray="2 5"'}/>` +
        (stop ? `<polygon points="${octagon(50 + a.dir.x * 30, 50 + a.dir.y * 30, 7)}" fill="#d9302c" stroke="#fff" stroke-width="1.5"/>` : "") +
        `<text x="${lx}" y="${ly}" font-size="10" font-weight="600" fill="#5d6168" text-anchor="middle">${compass(a.dir)}</text>`;
    }).join("");
    const diagram = `<svg viewBox="-8 -8 116 116" class="diagram" aria-hidden="true">${spokes}<circle cx="50" cy="50" r="9" fill="#fff" stroke="#8d939a" stroke-width="2"/></svg>`;
    const sigOn = g.featureUnlocked("signals");
    let body = "";
    if (!plan) {
      const stops = node.stops ?? [];
      // (approaches only: not a roundabout's own ring, nor a one-way leading away)
      const stopArms = arms.filter((a) => !g.net.segs.get(a.seg)?.ring && ng.conns.some((c) => c.armIn === a.seg));
      body = `<p class="muted">Unsignalled: cars give way by road priority. A stop sign makes an approach stop and give way to all the others. Lights stop traffic in turns and help busy crossings.</p>
        <div class="phase stops"><span class="ph-name">Stop signs</span><span class="ph-arms">${stopArms.map((a) => `<button class="arm stop-arm ${stops.includes(a.seg) ? "on stop" : ""}" data-seg="${a.seg}" aria-pressed="${stops.includes(a.seg)}" title="Stop sign on this approach">${compass(a.dir)}</button>`).join("")}</span></div>
        <button class="btn primary add-sig" ${sigOn ? "" : "disabled"}>${sigOn ? `Add traffic lights · ${formatMoney(SIGNAL_COST)}` : `Traffic lights unlock at ${MILESTONES.find((m) => m.features.includes("signals"))!.name}`}</button>`;
    } else {
      body = `<p class="muted small">The lights follow the traffic: a green ends early when its road is empty and runs up to twice its time while cars keep coming. Cars may turn right on red after stopping.</p>` + plan.phases.map((p, i) => `<div class="phase ${i === this.panelPhase ? "on" : ""}" data-i="${i}">
          <span class="ph-name">Phase ${i + 1}</span>
          <span class="ph-arms">${arms.map((a) => `<button class="arm ${p.arms.includes(a.seg) ? "on" : ""}" data-i="${i}" data-seg="${a.seg}" title="Toggle this approach">${compass(a.dir)}</button>`).join("")}</span>
          <span class="ph-dur"><button class="dur" data-i="${i}" data-d="-2" aria-label="Shorter">−</button><b title="Usual green time">${p.dur}s</b><button class="dur" data-i="${i}" data-d="2" aria-label="Longer">+</button></span>
          ${plan.phases.length > 1 ? `<button class="ph-del" data-i="${i}" aria-label="Remove phase">${ICON.close}</button>` : ""}
        </div>`).join("") + `<div class="row"><button class="btn add-ph">+ Add phase</button><button class="btn quiet danger rm-sig">Remove lights</button></div>`;
    }
    this.lastPanel = "";
    this.setPanel(`<header>Junction</header>${diagram}${body}`);
    const q = <T extends Element>(s: string) => [...this.panel.querySelectorAll<T & HTMLElement>(s)];
    const set = (p: SignalPlan | null) => { if (!g.setSignal(this.panelNode, p)) this.toast("Not enough money", true); this.fillSignal(); };
    q(".add-sig").forEach((b) => (b.onclick = () => { set(g.defaultSignal(this.panelNode)); this.sfx.play("build"); }));
    q(".rm-sig").forEach((b) => (b.onclick = () => set(null)));
    q(".stop-arm").forEach((b) => (b.onclick = () => {
      const seg = +b.dataset.seg!, cur = node.stops ?? [];
      g.setStops(this.panelNode, cur.includes(seg) ? cur.filter((x) => x !== seg) : [...cur, seg]);
      this.sfx.play("build");
      this.fillSignal();
    }));
    q(".add-ph").forEach((b) => (b.onclick = () => { const p = clonePlan(plan!); p.phases.push({ arms: [], dur: 10 }); this.panelPhase = p.phases.length - 1; set(p); }));
    q(".phase").forEach((el) => (el.onclick = (e) => { if ((e.target as HTMLElement).closest("button")) return; this.panelPhase = +el.dataset.i!; this.fillSignal(); }));
    q(".arm:not(.stop-arm)").forEach((b) => (b.onclick = () => {
      const p = clonePlan(plan!);
      const i = +b.dataset.i!, seg = +b.dataset.seg!;
      const a = p.phases[i].arms;
      p.phases[i].arms = a.includes(seg) ? a.filter((x) => x !== seg) : [...a, seg];
      this.panelPhase = i;
      set(p);
    }));
    q(".dur").forEach((b) => (b.onclick = () => {
      const p = clonePlan(plan!);
      const i = +b.dataset.i!;
      p.phases[i].dur = Math.max(4, Math.min(60, p.phases[i].dur + +b.dataset.d!));
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
    const dlg = this.showModal(`<header class="pm-head">${escapeHtml(app.game.cityName)}<span class="muted">Paused</span></header>
      <div class="pm-list">
        <button class="pm resume">Resume</button>
        <button class="pm save">Save game</button>
        <button class="pm load">Load game</button>
        <button class="pm keys">Controls</button>
        <button class="pm home">Main menu</button>
        <button class="pm new">New city</button>
      </div>`, "Pause menu");
    dlg.classList.add("pause");
    const on = (s: string, fn: () => void) => { (dlg.querySelector(s) as HTMLButtonElement).onclick = () => { this.sfx.play("click"); fn(); }; };
    on(".resume", () => this.closeModal());
    on(".save", () => this.openSaves(true));
    on(".load", () => this.openSaves(false));
    on(".keys", () => this.openKeys());
    on(".home", () => {
      if (app.mode === "play") app.saves.autosave(app.game);
      this.resumeOnClose = false;
      this.closeModal();
      app.openMenu?.();
    });
    on(".new", () => {
      const b = dlg.querySelector(".new") as HTMLButtonElement;
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Start a new city? Your city is autosaved"; b.classList.add("danger"); return; }
      if (app.mode === "play") app.saves.autosave(app.game);
      app.newGame(1 + Math.floor(Math.random() * 9999));
      app.setMode("play");
      this.resumeOnClose = false;
      this.closeModal();
      this.tutHidden = false;
      this.toast(app.saves.latest() ? "New city. Your last one is in the autosaves." : "New city");
    });
    requestAnimationFrame(() => (dlg.querySelector(".resume") as HTMLButtonElement).focus());
  }

  private backButton(dlg: HTMLElement) {
    const b = h("button", "btn quiet back", `${ICON.caret}<span>Back</span>`);
    b.onclick = () => (this.app.mode === "menu" ? this.closeModal() : this.openPause());
    dlg.prepend(b);
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
        const old = (m.v ?? 1) < 2;
        return `<li data-id="${m.id}">
          ${m.thumb ? `<img src="${m.thumb}" alt="" width="96" height="60">` : `<span class="thumb-empty"></span>`}
          <span class="save-meta"><b>${escapeHtml(m.name)}</b><span>${old ? "Older version: can't be loaded" : `${MILESTONES[m.level]?.name ?? ""} · ${fmtNum(m.residents)} people · ${fmtTime(m.playtime)} played`}</span></span>
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

function sparkline(vs: number[], what: string): string {
  if (vs.length < 2) return "";
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(1, hi - lo);
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * 220},${38 - ((v - lo) / span) * 34}`).join(" ");
  return `<svg class="spark" viewBox="0 -2 220 42" preserveAspectRatio="none" role="img" aria-label="${what} over the last ${vs.length} hours"><polyline points="${pts}" fill="none" stroke="#2373c4" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg><p class="muted small">${what}, last ${vs.length} hours</p>`;
}

function rbIcon(size: RoundaboutSize): string {
  const r = 4 + size * 1.6, w = 1.6 + size * 0.5;
  return `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false"><path d="M14 1 v${14 - r - 1} M14 ${14 + r + 1} V27 M1 14 h${14 - r - 1} M${14 + r + 1} 14 H27" stroke="#8d939a" stroke-width="3"/><circle cx="14" cy="14" r="${r}" fill="#cfe6b8" stroke="#5b6168" stroke-width="${w}"/></svg>`;
}

function stockBar(n: number, max: number): string {
  const k = Math.max(0, Math.min(max, Math.round(n)));
  return `<span class="pips" role="img" aria-label="${k} of ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < k ? "on" : ""}"></i>`).join("")}</span>`;
}

function clonePlan(p: SignalPlan): SignalPlan {
  return { phases: p.phases.map((x) => ({ arms: [...x.arms], dur: x.dur })) };
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
