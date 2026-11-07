import { BUILDING_TYPES, CARGO_LABEL, ROAD_ORDER, ROAD_TYPES, SIGNAL_COST, ZONE_LABEL, type BuildingKind } from "../config";
import { formatMoney, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { FACTOR_LABEL } from "../game/city";
import { levelDef } from "../game/levels";
import type { SignalPlan } from "../roads/network";
import { ROAD_MODES, type App, type OverlayId, type RoadMode, type ToolId } from "../app";
import { ROUNDABOUTS, type RoundaboutSize } from "../roads/planner";
import { ICON, buildingIcon, roadIcon } from "./icons";
import { Sfx } from "./sfx";

export interface Chip {
  text: string;
  kind: "info" | "error" | "cost";
  icon?: keyof typeof ICON;
}

const OVERLAYS: { id: OverlayId; label: string }[] = [
  { id: "flow", label: "Traffic flow" },
  { id: "sat", label: "Overall building satisfaction" },
  { id: "commercial", label: "Access to nearby commercial" },
  { id: "work", label: "Access to nearby workplaces" },
  { id: "staff", label: "Access to workers/customers" },
  { id: "input", label: "Access to input resources" },
  { id: "pollution", label: "Air pollution" },
  { id: "noise", label: "Road noise" },
];

const KIND_ORDER: BuildingKind[] = ["house", "terrace", "apartments", "shop", "store", "mall", "office", "tower", "mine", "farm", "works", "foodplant"];

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

export class Hud {
  root = h("div", "hud");
  private money = h("div", "money");
  private speed = h("div", "speed");
  private objCard = h("section", "card objectives");
  private tut = h("section", "card tutorial");
  private overlayBtn = h("button", "btn overlay-btn");
  private overlayList = h("div", "card overlay-list");
  private legend = h("div", "legend");
  private toolbar = h("nav", "toolbar");
  private subbar = h("div", "subbar");
  private chipBox = h("div", "chips");
  private toastBox = h("div", "toasts");
  private panel = h("aside", "card panel");
  private modal = h("div", "modal");
  private rectEl = h("div", "selrect");
  private banner = h("section", "card banner");
  private snapMenu = h("div", "card snap-menu");
  private compass = h("button", "btn icon-btn compass");
  private compassRot = NaN;
  private undoBtn = h("button", "btn icon-btn");
  private redoBtn = h("button", "btn icon-btn");
  private toolBtns = new Map<string, HTMLButtonElement>();
  private kindBtns = new Map<BuildingKind, HTMLButtonElement>();
  private panelKind: "building" | "signal" | null = null;
  private panelNode = -1;
  private panelPhase = 0;
  private tutHidden = new Set<number>();
  private lastObj = "";
  private lastHint = "";
  private objCollapsed = typeof matchMedia === "function" && matchMedia("(max-width: 560px)").matches; // phones start folded
  private sfx = new Sfx();

  constructor(private app: App, parent: HTMLElement) {
    parent.appendChild(this.root);
    this.build();
  }

  private build() {
    const app = this.app;
    // ---- top left: menu + overlays
    const tl = h("div", "corner tl");
    const menu = h("button", "btn icon-btn", ICON.menu);
    menu.title = "Saves and new city (Ctrl+S)";
    menu.setAttribute("aria-label", "Game menu");
    menu.onclick = () => this.openSaves();
    this.overlayBtn.innerHTML = `Overlays ${ICON.caret}`;
    this.overlayBtn.setAttribute("aria-expanded", "false");
    this.overlayBtn.onclick = () => {
      const open = !this.overlayList.classList.contains("open");
      this.overlayList.classList.toggle("open", open);
      this.overlayBtn.setAttribute("aria-expanded", String(open));
    };
    for (const o of OVERLAYS) {
      const b = h("button", "overlay-item", `<span class="ov-dot ov-${o.id}"></span>${o.label}`);
      b.dataset.id = o.id;
      b.onclick = () => app.setOverlay(o.id);
      this.overlayList.appendChild(b);
    }
    this.overlayList.appendChild(this.legend);
    this.compass.innerHTML = ICON.north;
    this.compass.title = "North up (the map is turned: Q / E or middle-drag)";
    this.compass.setAttribute("aria-label", "Turn the map north up");
    this.compass.onclick = () => { app.resetNorth(); this.compassAngle(0); };
    this.compass.hidden = true;
    tl.append(menu, this.overlayBtn, this.overlayList, this.compass);

    // ---- top centre: money + speed
    const tc = h("div", "corner tc");
    const speeds: [string, () => void, string][] = [
      [ICON.pause, () => app.togglePause(), "Pause (Space)"],
      [ICON.play, () => app.setSpeed(1), "Normal speed"],
      [ICON.fast, () => app.setSpeed(2), "Fast"],
      [ICON.fastest, () => app.setSpeed(4), "Fastest"],
    ];
    for (const [icon, fn, title] of speeds) {
      const b = h("button", "btn speed-btn", icon);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = fn;
      this.speed.appendChild(b);
    }
    tc.append(this.money, this.speed);

    // ---- top right: objectives + tutorial
    const tr = h("div", "corner tr");
    tr.append(this.objCard, this.tut, this.panel);

    // ---- bottom: sub-bar + toolbar
    const bc = h("div", "corner bc");
    this.buildToolbar();
    this.snapMenu.hidden = true;
    bc.append(this.snapMenu, this.subbar, this.toolbar);
    // narrow screens: the toolbar scrolls sideways; fade the edge that has more tools behind it
    const edges = () => {
      const t = this.toolbar;
      t.classList.toggle("more-l", t.scrollLeft > 2);
      t.classList.toggle("more-r", t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
    };
    this.toolbar.addEventListener("scroll", edges, { passive: true });
    addEventListener("resize", edges);
    requestAnimationFrame(edges);

    this.panel.hidden = true;
    this.modal.hidden = true;
    this.banner.hidden = true;
    this.rectEl.hidden = true;
    this.root.append(tl, tc, tr, bc, this.chipBox, this.toastBox, this.banner, this.rectEl, this.modal);
    document.addEventListener("pointerdown", (e) => {
      const tg = e.target as Node;
      if (!this.snapMenu.hidden && !this.snapMenu.contains(tg) && !(tg instanceof Element && tg.closest(".snap-btn"))) { this.snapMenu.hidden = true; this.renderSubbar(); }
      if (!this.overlayList.contains(e.target as Node) && e.target !== this.overlayBtn && !this.overlayBtn.contains(e.target as Node)) {
        this.overlayList.classList.remove("open");
        this.overlayBtn.setAttribute("aria-expanded", "false");
      }
      this.sfx.unlock();
    });
  }

  private toolButton(key: string, icon: string, title: string, fn: () => void, cls = "") {
    const b = h("button", "tool " + cls, icon);
    b.title = title;
    b.setAttribute("aria-label", title);
    b.onclick = () => { fn(); this.sfx.play("click"); };
    this.toolBtns.set(key, b);
    return b;
  }

  private buildToolbar() {
    const app = this.app;
    const roads = h("div", "group");
    for (const id of ROAD_ORDER) {
      const T = ROAD_TYPES[id];
      roads.appendChild(this.toolButton("road:" + id, roadIcon(id), `${T.name} · ${T.hint}`, () => app.setTool({ tool: "road", roadType: id })));
    }
    const shapes = h("div", "group");
    shapes.append(
      this.toolButton("roundabout", ICON.roundabout, "Roundabout", () => app.setTool({ tool: "roundabout" })),
      this.toolButton("junction", ICON.junction, "Junctions and traffic lights", () => app.setTool({ tool: "junction" })),
    );
    const kinds = h("div", "group kinds");
    for (const k of KIND_ORDER) {
      const T = BUILDING_TYPES[k];
      const b = this.toolButton("kind:" + k, buildingIcon(k, T.zone) + `<span class="count"></span>`, `${T.name} · ${T.blurb}`, () => app.setTool({ tool: "building", kind: k }), "kind z-" + T.zone);
      this.kindBtns.set(k, b);
      kinds.appendChild(b);
    }
    const edit = h("div", "group");
    edit.append(
      this.toolButton("bulldoze", ICON.bulldoze, "Bulldozer (B) · click or drag", () => app.setTool({ tool: "bulldoze" })),
      this.toolButton("unlock", ICON.unlock + `<span class="count"></span>`, "Unlock a new area", () => app.setTool({ tool: "unlock" })),
    );
    const hist = h("div", "group hist");
    this.undoBtn.innerHTML = ICON.undo;
    this.undoBtn.title = "Undo (Ctrl+Z) · full refund";
    this.undoBtn.setAttribute("aria-label", "Undo");
    this.undoBtn.onclick = () => app.undo();
    this.redoBtn.innerHTML = ICON.redo;
    this.redoBtn.title = "Redo (Ctrl+Y)";
    this.redoBtn.setAttribute("aria-label", "Redo");
    this.redoBtn.onclick = () => app.redo();
    hist.append(this.undoBtn, this.redoBtn);
    this.toolbar.append(roads, shapes, kinds, edit, hist);
  }

  // ---------------------------------------------------------------- refresh

  refresh() {
    const app = this.app, g = app.game, st = app.st;
    if (!g) return;
    // tools
    for (const [key, b] of this.toolBtns) {
      let on = false;
      if (key.startsWith("road:")) on = st.tool === "road" && st.roadType === key.slice(5) && !(st.mode === "replace" && st.reverse);
      else if (key.startsWith("kind:")) on = st.tool === "building" && st.kind === key.slice(5);
      else on = st.tool === (key as ToolId);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const [k, b] of this.kindBtns) {
      const n = g.inventory[k] ?? 0;
      b.hidden = n <= 0 && !g.buildings.list.some((x) => x.kind === k);
      b.disabled = n <= 0;
      b.querySelector(".count")!.textContent = n > 0 ? String(n) : "";
      const T = BUILDING_TYPES[k];
      b.title = `${T.name} · ${n > 0 ? `${n} left` : "none left"} · ${T.blurb}`;
      b.setAttribute("aria-label", `${T.name}, ${n} left`);
    }
    const un = this.toolBtns.get("unlock")!;
    un.hidden = g.tileTokens <= 0 && st.tool !== "unlock";
    un.querySelector(".count")!.textContent = g.tileTokens > 0 ? String(g.tileTokens) : "";
    this.undoBtn.disabled = !g.canUndo();
    this.redoBtn.disabled = !g.canRedo();
    // speed
    const sb = this.speed.children;
    const sp = g.paused ? 0 : g.speed === 1 ? 1 : g.speed === 2 ? 2 : 3;
    for (let i = 0; i < sb.length; i++) sb[i].classList.toggle("on", i === sp);
    // overlays
    for (const el of this.overlayList.querySelectorAll<HTMLButtonElement>(".overlay-item")) el.classList.toggle("on", el.dataset.id === app.overlay);
    this.overlayBtn.classList.toggle("on", app.overlay !== "none");
    this.overlayBtn.innerHTML = `<span class="ov-label">${app.overlay === "none" ? "Overlays" : OVERLAYS.find((o) => o.id === app.overlay)!.label}</span> ${ICON.caret}`;
    this.legend.innerHTML = app.overlay === "none" ? "" : app.overlay === "flow"
      ? `<span class="lg lg-flow"></span><span>Free flowing</span><span>Jammed</span>`
      : `<span class="lg lg-sat"></span><span>Poor</span><span>Good</span>`;
    this.renderSubbar();
    this.tick(true);
  }

  private renderSubbar() {
    const app = this.app, st = app.st, g = app.game;
    const sb = this.subbar;
    // the bar is rebuilt on every change: remember which control had keyboard focus
    const fa = document.activeElement;
    const focusKey = fa instanceof HTMLElement && sb.contains(fa) ? fa.getAttribute("aria-label") : null;
    sb.innerHTML = "";
    const label = (t: string) => h("span", "sb-label", t);
    const seg = (items: { html: string; on: boolean; title: string; fn: () => void; cls?: string }[]) => {
      const w = h("div", "seg");
      for (const it of items) {
        const b = h("button", "seg-btn " + (it.cls ?? ""), it.html);
        b.classList.toggle("on", it.on);
        b.setAttribute("aria-pressed", String(it.on));
        b.title = it.title;
        b.setAttribute("aria-label", it.title);
        b.onclick = () => { it.fn(); this.sfx.play("click"); };
        w.appendChild(b);
      }
      return w;
    };
    const elevation = () => [
      label("Height"),
      seg([0, 1, 2, 3].map((l) => ({ html: String(l), on: st.level === l, title: l === 0 ? "Ground level (Page Down)" : `Bridge level ${l}: passes over roads below (Page Up / Page Down)`, fn: () => app.setLevel(l), cls: "lvl lvl" + l }))),
    ];
    const items: HTMLElement[] = [];
    this.snapMenu.hidden = this.snapMenu.hidden || st.tool !== "road" || st.mode === "replace";
    if (st.tool === "road") {
      const T = ROAD_TYPES[st.roadType];
      const MODE: Record<RoadMode, { icon: string; title: string }> = {
        straight: { icon: ICON.straight, title: "Straight: click the start, then the end" },
        curve: { icon: ICON.curve, title: "Simple curve: start, bend point, end" },
        complex: { icon: ICON.complex, title: "Complex curve: start, two handles, end" },
        continuous: { icon: ICON.continuous, title: "Continuous: each click carries the road on smoothly, and it meets roads square" },
        grid: { icon: ICON.gridMode, title: "Grid: click a corner, the width, then the depth" },
        replace: { icon: ICON.replace, title: "Replace: click a road to change it to this type" },
      };
      items.push(
        h("span", "sb-name", `${T.name} <span class="muted">${T.short}</span>`),
        seg(ROAD_MODES.map((m) => ({ html: MODE[m].icon, on: st.mode === m, title: MODE[m].title + " (Tab)", fn: () => app.setTool({ mode: m }) }))),
      );
      if (st.mode === "replace") {
        items.push(seg([
          { html: "Change type", on: !st.reverse, title: `Turn a road into ${T.name}`, fn: () => app.setTool({ reverse: false }) },
          { html: "Reverse", on: st.reverse, title: "Flip a one-way road (Shift+click)", fn: () => app.setTool({ reverse: true }) },
        ]));
      } else {
        if (st.mode !== "grid") {
          const off = Math.round(app.parallelOffset());
          const par = seg([
            { html: ICON.parallel, on: st.parallel, title: T.bwd === 0 ? "Parallel: also build the opposite carriageway alongside" : "Parallel: also build a second road alongside", fn: () => app.setTool({ parallel: !st.parallel }) },
            ...(st.parallel ? [
              { html: "−", on: false, title: "Closer ([)", fn: () => app.nudgeParallel(-1) },
              { html: `${off} m`, on: false, title: "Distance between the two road centres (click to reset)", fn: () => app.setTool({ parOffset: null }), cls: "val" },
              { html: "+", on: false, title: "Further apart (])", fn: () => app.nudgeParallel(1) },
            ] : []),
          ]);
          items.push(par);
        }
        const snapBtn = h("button", "seg-btn snap-btn", ICON.magnet + ICON.caret);
        const anyOff = st.snapOff.geometry || st.snapOff.guides || st.snapOff.netSide;
        snapBtn.classList.toggle("on", !this.snapMenu.hidden);
        snapBtn.classList.toggle("partial", anyOff);
        snapBtn.title = "Snapping";
        snapBtn.setAttribute("aria-label", "Snapping options");
        snapBtn.setAttribute("aria-expanded", String(!this.snapMenu.hidden));
        snapBtn.onclick = () => { this.snapMenu.hidden = !this.snapMenu.hidden; this.renderSubbar(); };
        if (!this.snapMenu.hidden) requestAnimationFrame(() => {
          // sit over the snapping button, kept on screen
          const host = this.snapMenu.parentElement!.getBoundingClientRect(), r = snapBtn.getBoundingClientRect();
          const w = this.snapMenu.offsetWidth, vw = document.documentElement.clientWidth;
          const left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
          this.snapMenu.style.left = `${left - host.left}px`;
        });
        items.push(snapBtn, ...elevation());
        this.renderSnapMenu();
      }
    } else if (st.tool === "roundabout") {
      items.push(label("Size"), seg(([1, 2, 3, 4] as RoundaboutSize[]).map((n) => {
        const R = ROUNDABOUTS[n];
        return { html: R.name, on: st.rbSize === n, title: `${R.name}: ${R.r * 2} m across, ${ROAD_TYPES[R.type].fwd}-lane ring`, fn: () => app.setTool({ rbSize: n }) };
      })), ...elevation());
    } else if (st.tool === "bulldoze") {
      items.push(label("Elevations"), seg([null, 0, 1, 2, 3].map((l) => ({
        html: l === null ? "All" : `${l} only`, on: st.bdzLevel === l, title: l === null ? "Remove roads at any height" : `Only remove roads at elevation ${l}`, fn: () => app.setTool({ bdzLevel: l }),
      }))));
    } else if (st.tool === "building" && st.kind) {
      const T = BUILDING_TYPES[st.kind];
      items.push(h("span", `sb-text zone-tag z-${T.zone}`, `${T.name}`), h("span", "sb-text muted", T.blurb));
    } else if (st.tool === "junction") {
      items.push(h("span", "sb-text", "Click a junction to add traffic lights or edit their phases"));
    } else if (st.tool === "unlock") {
      items.push(h("span", "sb-text", `${g.tileTokens} area unlock${g.tileTokens === 1 ? "" : "s"} left · click a darkened area next to yours`));
    }
    sb.append(...items);
    sb.hidden = items.length === 0;
    if (focusKey) [...sb.querySelectorAll<HTMLElement>("[aria-label]")].find((e) => e.getAttribute("aria-label") === focusKey)?.focus();
  }

  private renderSnapMenu() {
    const app = this.app, st = app.st;
    const opts: { k: "geometry" | "guides" | "netSide" | "length"; label: string; on: boolean }[] = [
      { k: "geometry", label: "Existing roads and junctions", on: !st.snapOff.geometry },
      { k: "guides", label: "Guidelines and right angles", on: !st.snapOff.guides },
      { k: "netSide", label: "Alongside other roads", on: !st.snapOff.netSide },
      { k: "length", label: "Lengths in 8 m steps", on: st.snapLength },
    ];
    this.snapMenu.innerHTML = `<div class="sm-head">Snapping</div>` + opts.map((o) =>
      `<label class="sm-row"><input type="checkbox" data-k="${o.k}" ${o.on ? "checked" : ""}><span>${o.label}</span></label>`).join("") +
      `<div class="sm-foot">Hold Shift for 15° steps</div>`;
    for (const cb of this.snapMenu.querySelectorAll<HTMLInputElement>("input")) {
      cb.onchange = () => {
        const k = cb.dataset.k!;
        if (k === "length") app.setTool({ snapLength: cb.checked });
        else app.setTool({ snapOff: { ...st.snapOff, [k]: !cb.checked } });
      };
    }
  }

  /** Keep the north arrow in step with the view; it only shows while the map is turned. */
  compassAngle(rot: number) {
    if (Math.abs(rot - this.compassRot) < 1e-4) return;
    this.compassRot = rot;
    const turned = Math.abs(Math.atan2(Math.sin(rot), Math.cos(rot))) > 0.01;
    this.compass.hidden = !turned;
    (this.compass.firstElementChild as HTMLElement | null)?.style.setProperty("transform", `rotate(${-rot}rad)`);
  }

  /** Cheap periodic update: money, objectives, open panels. */
  tick(force = false) {
    const g = this.app.game;
    if (!g) return;
    this.money.textContent = formatMoney(g.money);
    this.money.classList.toggle("low", g.money < 500);
    const L = levelDef(g.level);
    const app = this.app;
    const key = JSON.stringify([g.level, g.objectives, app.focus, this.objCollapsed]);
    if (force || key !== this.lastObj) {
      this.lastObj = key;
      const rows = g.objectives.map((o) => {
        const mag = o.id === "placed" ? "" : `<button class="mag ${app.focus === o.id ? "on" : ""}" data-f="${o.id}" title="Show what holds this back" aria-label="Highlight ${o.label}">${ICON.magnifier}</button>`;
        const sub = o.sub && !o.done ? `<div class="obj-sub"><span>${o.sub.label}</span><span class="bad">−${o.sub.value}</span></div>` : "";
        return `<div class="obj ${o.done ? "done" : ""}">${o.done ? ICON.check : ICON.open}<span class="obj-label">${o.label}</span><span class="obj-val ${o.good === null ? "" : o.good ? "good" : "bad"}">${o.value}</span>${mag}</div>${sub}`;
      }).join("");
      const done = g.objectives.filter((o) => o.done).length;
      const nx = g.objectives.find((o) => !o.done);
      const next = nx ? `<div class="obj-next"><span class="obj-label">${nx.label}</span><span class="obj-val ${nx.good === null ? "" : nx.good ? "good" : "bad"}">${nx.value}</span></div>` : "";
      this.objCard.classList.toggle("folded", this.objCollapsed);
      this.objCard.innerHTML = `<header><button class="obj-head" aria-expanded="${!this.objCollapsed}" title="${this.objCollapsed ? "Show" : "Hide"} goals">City Level ${g.level}<span class="obj-count">${done}/${g.objectives.length}</span>${ICON.caret}</button></header>${this.objCollapsed ? next : rows}`;
      (this.objCard.querySelector(".obj-head") as HTMLButtonElement).onclick = () => { this.objCollapsed = !this.objCollapsed; this.tick(true); };
      for (const b of this.objCard.querySelectorAll<HTMLButtonElement>(".mag")) b.onclick = () => app.setFocus(b.dataset.f as "trips" | "sat" | "flow");
    }
    // tutorial / level note
    const tips = this.tips();
    if (tips && !this.tutHidden.has(g.level)) {
      this.tut.hidden = false;
      if (this.tut.dataset.k !== tips.key) {
        this.tut.dataset.k = tips.key;
        this.tut.innerHTML = `<button class="close" aria-label="Hide tips">${ICON.close}</button><p>${tips.html}</p>`;
        (this.tut.querySelector(".close") as HTMLButtonElement).onclick = () => { this.tutHidden.add(g.level); this.tut.hidden = true; };
      }
    } else this.tut.hidden = true;
    // the tool the tip talks about pulses until it is picked; on narrow screens scroll it into view
    const hint = this.tut.hidden ? "" : tips?.key === "1a" ? "road:street" : tips?.key === "1b" ? "kind:" : "";
    let first: HTMLButtonElement | null = null;
    for (const [k, b] of this.toolBtns) {
      const on = !!hint && (hint.endsWith(":") ? k.startsWith(hint) && !b.hidden && !b.disabled : k === hint);
      b.classList.toggle("hint", on);
      if (on && !first) first = b;
    }
    if (first && this.lastHint !== hint) {
      const t = this.toolbar, bl = first.offsetLeft, br = bl + first.offsetWidth;
      if (bl < t.scrollLeft || br > t.scrollLeft + t.clientWidth) t.scrollTo({ left: bl - 12, behavior: "smooth" });
    }
    this.lastHint = hint;
    void L;
    if (this.panelKind === "building" && this.app.selected) this.fillBuilding(this.app.selected);
  }

  private tips(): { key: string; html: string } | null {
    const g = this.app.game;
    const L = levelDef(g.level);
    if (g.level === 1) {
      if (g.net.segs.size === 0) return { key: "1a", html: "<b>Draw a street.</b> Pick <b>Street</b> in the toolbar, click to start and click again to finish. Keep clicking to continue the road; right-click steps back." };
      if (g.remainingToPlace() > 0) return { key: "1b", html: "<b>Place your buildings.</b> Choose a building in the toolbar and click beside a street. Each one gets its own driveway." };
      return { key: "1c", html: "<b>Keep traffic moving.</b> Residents drive to shops and work. Hold all four goals for a few seconds to reach the next level." };
    }
    if (L.note) return { key: "n" + g.level, html: L.note };
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

  levelUp(level: number, note?: string) {
    const L = levelDef(level);
    const gifts = Object.entries(L.give).filter(([, n]) => n).map(([k, n]) => `${n} × ${BUILDING_TYPES[k as BuildingKind].name}`);
    this.banner.innerHTML = `<header>Level ${level - 1} complete</header>
      <p class="sub">City Level ${level} unlocks</p>
      <p class="gifts">${gifts.join(" · ")}</p>
      <p class="gifts">+${formatMoney(L.money)} road budget${L.tiles ? ` · ${L.tiles} area unlock` : ""}</p>
      ${note ? `<p class="note">${note}</p>` : ""}
      <button class="btn primary">Continue</button>`;
    this.banner.hidden = false;
    this.banner.classList.remove("in");
    void this.banner.offsetWidth;
    this.banner.classList.add("in");
    this.root.classList.add("banner-up");
    const ok = this.banner.querySelector("button") as HTMLButtonElement;
    ok.onclick = () => { this.banner.hidden = true; this.root.classList.remove("banner-up"); };
    requestAnimationFrame(() => ok.focus({ preventScroll: true }));
    this.sfx.play("level");
    this.refresh();
  }

  // ---------------------------------------------------------------- panels

  /** Close the snapping menu if it is open (Esc). */
  closeMenu(): boolean {
    if (this.snapMenu.hidden) return false;
    this.snapMenu.hidden = true;
    this.renderSubbar();
    return true;
  }

  closePanels(): boolean {
    const was = !this.panel.hidden || !this.modal.hidden;
    this.panel.hidden = true;
    this.modal.hidden = true;
    this.panelKind = null;
    return was;
  }

  openBuilding(b: Building) {
    this.panelKind = "building";
    this.panel.hidden = false;
    this.fillBuilding(b);
  }

  private fillBuilding(b: Building) {
    const g = this.app.game;
    const T = BUILDING_TYPES[b.kind];
    const fac = Object.entries(b.factors).filter(([k]) => !k.startsWith("_"));
    const bars = fac.map(([k, v]) => {
      const bad = k === "pollution" || k === "noise";
      const val = bad ? v : Math.min(1, v);
      const pct = Math.round(val * 100);
      return `<div class="fac"><span>${FACTOR_LABEL[k] ?? k}</span><span class="bar ${bad ? "neg" : ""}"><i style="width:${bad && !pct ? 0 : Math.max(3, pct)}%"></i></span><span class="num">${bad ? (pct ? "−" + pct + "%" : "none") : pct + "%"}</span></div>`;
    }).join("");
    const residents = g.residents.filter((r) => r.home === b.id).length;
    const workers = g.residents.filter((r) => r.job === b.id).length;
    const facts: string[] = [];
    if (T.residents) facts.push(`${residents} resident${residents === 1 ? "" : "s"}`);
    if (T.jobs) facts.push(`${workers}/${T.jobs} jobs filled`);
    if (T.consumes) facts.push(`${b.stock > 0 ? "Has" : "Waiting for"} ${CARGO_LABEL[T.consumes]}`);
    if (T.produces) facts.push(`Ships ${CARGO_LABEL[T.produces]}`);
    if (!b.access) facts.push(`<span class="bad">Not connected to a road</span>`);
    this.panel.innerHTML = `<button class="close" aria-label="Close">${ICON.close}</button>
      <header><span class="zone-tag z-${T.zone}">${ZONE_LABEL[T.zone]}</span>${T.name}</header>
      <div class="sat"><span>Satisfaction</span><b class="${b.sat >= g.levelSatTarget ? "good" : "bad"}">${Math.round(b.sat * 100)}%</b></div>
      ${bars}
      <p class="facts">${facts.join(" · ")}</p>
      <button class="btn pick">Pick up</button>`;
    (this.panel.querySelector(".close") as HTMLButtonElement).onclick = () => this.closePanels();
    const pick = this.panel.querySelector(".pick") as HTMLButtonElement | null;
    if (pick) pick.onclick = () => { g.bulldoze([], [b.id]); this.closePanels(); this.app.selected = null; this.sfx.play("remove"); };
  }

  openSignal(node: number) {
    this.panelKind = "signal";
    this.panelNode = node;
    this.panelPhase = 0;
    this.panel.hidden = false;
    this.fillSignal();
  }

  private fillSignal() {
    const g = this.app.game;
    const node = g.net.nodes.get(this.panelNode);
    const ng = g.net.nodeGeom.get(this.panelNode);
    if (!node || !ng) { this.closePanels(); return; }
    const plan = node.signal;
    const arms = ng.arms;
    const ph = plan ? plan.phases[Math.min(this.panelPhase, plan.phases.length - 1)] : null;
    // connection diagram: arms as spokes, green when in the selected phase
    const spokes = arms.map((a) => {
      const on = ph?.arms.includes(a.seg);
      const x = 50 + a.dir.x * 40, y = 50 + a.dir.y * 40;
      const lx = 50 + a.dir.x * 47 + (Math.abs(a.dir.y) > 0.7 ? 9 : 0), ly = 50 + a.dir.y * 47 + (Math.abs(a.dir.x) > 0.7 ? -8 : 4);
      return `<line x1="50" y1="50" x2="${x}" y2="${y}" stroke="${on ? "#2a9e49" : plan ? "#e5484d" : "#b6bbc1"}" stroke-width="10" stroke-linecap="round" ${on || !plan ? "" : 'stroke-dasharray="2 5"'}/>` +
        `<text x="${lx}" y="${ly}" font-size="10" font-weight="600" fill="#5d6168" text-anchor="middle">${compass(a.dir)}</text>`;
    }).join("");
    const diagram = `<svg viewBox="-8 -8 116 116" class="diagram" aria-hidden="true">${spokes}<circle cx="50" cy="50" r="9" fill="#fff" stroke="#8d939a" stroke-width="2"/></svg>`;
    let body = "";
    if (!plan) {
      body = `<p class="muted">Unsignalled: cars give way by road priority. Lights stop traffic in turns and help busy crossings.</p>
        <button class="btn primary add-sig">Add traffic lights · ${formatMoney(SIGNAL_COST)}</button>`;
    } else {
      body = plan.phases.map((p, i) => `<div class="phase ${i === this.panelPhase ? "on" : ""}" data-i="${i}">
          <span class="ph-name">Phase ${i + 1}</span>
          <span class="ph-arms">${arms.map((a, k) => `<button class="arm ${p.arms.includes(a.seg) ? "on" : ""}" data-i="${i}" data-seg="${a.seg}" title="Toggle this approach">${compass(a.dir)}${k >= 0 ? "" : ""}</button>`).join("")}</span>
          <span class="ph-dur"><button class="dur" data-i="${i}" data-d="-2" aria-label="Shorter">−</button><b>${p.dur}s</b><button class="dur" data-i="${i}" data-d="2" aria-label="Longer">+</button></span>
          ${plan.phases.length > 1 ? `<button class="ph-del" data-i="${i}" aria-label="Remove phase">${ICON.close}</button>` : ""}
        </div>`).join("") + `<div class="row"><button class="btn add-ph">+ Add phase</button><button class="btn quiet danger rm-sig">Remove lights</button></div>`;
    }
    this.panel.innerHTML = `<button class="close" aria-label="Close">${ICON.close}</button><header>Junction</header>${diagram}${body}`;
    const q = <T extends Element>(s: string) => [...this.panel.querySelectorAll<T & HTMLElement>(s)];
    (this.panel.querySelector(".close") as HTMLButtonElement).onclick = () => this.closePanels();
    const set = (p: SignalPlan | null) => { if (!g.setSignal(this.panelNode, p)) this.toast("Not enough money", true); this.fillSignal(); };
    q(".add-sig").forEach((b) => (b.onclick = () => { set(g.defaultSignal(this.panelNode)); this.sfx.play("build"); }));
    q(".rm-sig").forEach((b) => (b.onclick = () => set(null)));
    q(".add-ph").forEach((b) => (b.onclick = () => { const p = clonePlan(plan!); p.phases.push({ arms: [], dur: 10 }); this.panelPhase = p.phases.length - 1; set(p); }));
    q(".phase").forEach((el) => (el.onclick = (e) => { if ((e.target as HTMLElement).closest("button")) return; this.panelPhase = +el.dataset.i!; this.fillSignal(); }));
    q(".arm").forEach((b) => (b.onclick = () => {
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

  openSaves() {
    const app = this.app;
    const list = app.saves.list();
    this.modal.hidden = false;
    const g = app.game;
    this.modal.innerHTML = `<div class="card dialog" role="dialog" aria-modal="true" aria-label="Saves">
      <button class="close" aria-label="Close">${ICON.close}</button>
      <header>Saves</header>
      <form class="save-row"><input name="n" maxlength="40" autocomplete="off" aria-label="Save name" value="City Level ${g.level}"><button class="btn primary" type="submit">Save</button></form>
      <ul class="save-list">${list.map((m) => `<li data-id="${m.id}">
          ${m.thumb ? `<img src="${m.thumb}" alt="" width="96" height="60">` : `<span class="thumb-empty"></span>`}
          <span class="save-meta"><b>${escapeHtml(m.name)}</b><span>City Level ${m.level} · ${fmtTime(m.playtime)} playtime · ${m.residents} residents</span></span>
          <button class="btn load">Load</button>${m.auto ? "" : `<button class="btn icon-btn del" aria-label="Delete save" title="Delete save">${ICON.bulldoze}</button>`}
        </li>`).join("") || `<li class="muted">No saves yet. The game autosaves every minute.</li>`}</ul>
      <div class="row"><button class="btn new">New city</button></div>
    </div>`;
    const dlg = this.modal.querySelector(".dialog") as HTMLElement;
    (dlg.querySelector(".close") as HTMLButtonElement).onclick = () => this.closePanels();
    this.modal.onclick = (e) => { if (e.target === this.modal) this.closePanels(); };
    (dlg.querySelector("form") as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const name = ((dlg.querySelector("input") as HTMLInputElement).value || "City").trim();
      const m = app.saves.save(g, name);
      this.toast(m ? "Game saved" : "Couldn't save: browser storage is full", !m);
      this.openSaves();
    };
    for (const li of dlg.querySelectorAll<HTMLLIElement>("li[data-id]")) {
      (li.querySelector(".load") as HTMLButtonElement).onclick = () => {
        const d = app.saves.load(li.dataset.id!);
        if (!d) { this.toast("That save is unreadable", true); return; }
        app.loadGame(d);
        this.closePanels();
        this.toast("Loaded");
      };
      const del = li.querySelector(".del") as HTMLButtonElement | null;
      if (del) del.onclick = () => {
        if (del.dataset.armed) { app.saves.remove(li.dataset.id!); this.openSaves(); return; }
        del.dataset.armed = "1";
        del.classList.add("danger");
        del.innerHTML = "Delete?";
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.classList.remove("danger"); del.innerHTML = ICON.bulldoze; } }, 2500);
      };
    }
    (dlg.querySelector(".new") as HTMLButtonElement).onclick = () => {
      app.saves.autosave(g);
      app.newGame(1 + Math.floor(Math.random() * 9999));
      this.closePanels();
      this.toast("New city. Your last one is in the autosaves.");
    };
    (dlg.querySelector("input") as HTMLInputElement).focus();
  }
}

function clonePlan(p: SignalPlan): SignalPlan {
  return { phases: p.phases.map((x) => ({ arms: [...x.arms], dur: x.dur })) };
}

function compass(d: V2): string {
  // world y is south; arm dir points away from the junction
  const a = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const names = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}


