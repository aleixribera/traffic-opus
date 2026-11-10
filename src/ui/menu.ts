import "./menu.css";
import type { App } from "../app";
import type { Game } from "../game/city";
import type { Hud } from "./hud";
import { cubicClosest } from "../roads/planner";
import { cubicTangent, formatMoney, norm, scale, sub, v2, type V2 } from "../core/math";
import { ROAD_TYPES } from "../config";
import { SAVE_V, START_MONEY } from "../game/city";
import { CHANGELOG, VERSION } from "../changelog";

type SaveData = ReturnType<Game["serialize"]>;

/** Game time run ahead when the showcase opens, so its traffic is already flowing (and the clock reaches the morning rush). */
const PREWARM_S = 90;

const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");
const clock = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/**
 * The title menu: a small card over the showcase city, which plays live behind it with a still camera.
 * From it: carry on with the last city, start one, load one, or explore the showcase freely (never saved).
 */
export class MainMenu {
  private root = document.createElement("div");
  private live = document.createElement("div");
  private curtain = document.createElement("div");
  private strip = document.createElement("div");
  /** the version in the bottom-right corner, in every mode; it opens What's new */
  private ver = document.createElement("button");
  private data: SaveData | null = null;
  private timer = 0;

  constructor(private app: App, private hud: Hud) {
    this.root.className = "mm";
    this.root.hidden = true;
    this.curtain.className = "mm-curtain";
    this.curtain.hidden = true;
    this.strip.className = "card mm-strip";
    this.strip.hidden = true;
    this.ver.className = "ver-tag";
    this.ver.textContent = VERSION;
    this.ver.title = "What's new";
    this.ver.setAttribute("aria-label", `Version ${VERSION}: what's new`);
    this.ver.onclick = () => { this.hud.sound("click"); this.hud.openNews(app.mode === "menu"); };
    document.body.append(this.root, this.curtain, this.strip, this.ver);
    // (the explore strip sits in the middle of the top edge, but never over the top bar, which grows a button when
    // the map is turned)
    const bar = document.querySelector(".corner.tl");
    if (bar) new ResizeObserver(() => this.placeStrip()).observe(bar);
    window.addEventListener("resize", () => this.placeStrip());
    app.onMode((m) => {
      this.root.hidden = m !== "menu";
      this.strip.hidden = m !== "explore";
      if (m === "explore") this.placeStrip();
      if (m !== "menu") window.clearInterval(this.timer);
    });
  }

  /** The showcase save, fetched once. */
  /** The explore strip at the middle of the top edge, or just right of the top bar when the bar reaches past it. */
  private placeStrip(): void {
    if (this.strip.hidden) return;
    const bar = document.querySelector(".corner.tl")?.getBoundingClientRect();
    const w = this.strip.offsetWidth;
    this.strip.style.left = `${Math.max(window.innerWidth / 2 - w / 2, (bar?.right ?? 0) + 12)}px`;
  }

  private async showcase(): Promise<SaveData | null> {
    if (this.data) return this.data;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}showcase.json`);
      if (!r.ok) return null;
      this.data = (await r.json()) as SaveData;
      return this.data;
    } catch {
      return null;
    }
  }

  /** Load the showcase behind the menu and show it. False if it couldn't be loaded (the caller starts a game instead). */
  async open(progress?: (k: number) => void): Promise<boolean> {
    const data = await this.showcase();
    if (!data) return false;
    const app = this.app;
    const boot = !!progress;
    if (!boot) this.cover(true);
    try { app.loadGame(data); } catch { this.cover(false); return false; }
    app.setMode("menu");
    this.frame();
    this.render();
    await app.prewarm(PREWARM_S, progress);
    if (!boot) this.cover(false);
    return true;
  }

  /** A paper-coloured cover while the city is swapped and run ahead (when coming back from a game). */
  private cover(on: boolean) {
    if (on) { this.curtain.hidden = false; this.curtain.classList.remove("out"); return; }
    this.curtain.classList.add("out");
    window.setTimeout(() => { if (this.curtain.classList.contains("out")) this.curtain.hidden = true; }, 360);
  }

  /**
   * The camera on the showcase: the town centre a little right of the middle (clear of the menu card), its main
   * street level with the screen. The app tilts it into the Diorama and sways it slowly from there (App.menuCam).
   */
  private frame() {
    const g = this.app.game, v = this.app.view;
    const bs = g.buildings.list;
    // the centre of the town: weighted by size, so the big buildings pull it downtown; then shifted
    // onto the densest cluster, so thinly built outskirts don't drag the shot into empty fields
    const centre = (r: number, c?: V2) => {
      let sx = 0, sy = 0, sw = 0;
      for (const b of bs) {
        if (c && Math.hypot(b.c.x - c.x, b.c.y - c.y) > r) continue;
        const w = b.hw * b.hd;
        sx += b.c.x * w; sy += b.c.y * w; sw += w;
      }
      return sw ? v2(sx / sw, sy / sw) : c ?? v2(v.cx, v.cy);
    };
    let c = centre(Infinity);
    for (let i = 0; i < 8; i++) c = centre(450, c);
    // the widest road near it sets the screen's axis
    let d = v2(1, 0), best = -Infinity;
    for (const s of g.net.segs.values()) {
      const r = cubicClosest(s.c, c);
      if (r.d > 400) continue;
      const k = ROAD_TYPES[s.type].fwd + ROAD_TYPES[s.type].bwd - r.d / 100;
      if (k > best) { best = k; d = norm(cubicTangent(s.c, r.t)); }
    }
    // (close enough that the town fills the screen beside the card and its buildings read as models: tilted, the
    // screen holds half as much ground again up and down)
    v.halfH = 205;
    v.rot = Math.atan2(d.y, d.x);
    const W = v.halfH * 2 * (v.w / Math.max(1, v.h));
    const p = sub(c, scale(d, W * 0.14));
    v.cx = p.x;
    v.cy = p.y;
    this.app.menuCam = { c, rot: v.rot, halfH: v.halfH, t: 0 };
  }

  private render() {
    const app = this.app;
    const last = app.saves.latest();
    const meta = last && (last.v ?? 1) === SAVE_V ? last : null;
    const name = app.game.cityName;
    this.root.innerHTML = `
      <nav class="card mm-card" aria-label="Main menu">
        <header class="mm-head">
          <h1 class="mm-title">Kilometre <span>Zero</span></h1>
        </header>
        <div class="mm-list">
          ${meta ? `<button class="mm-item primary" data-a="continue"><span class="mm-l">Continue</span><span class="mm-s">${esc(meta.name.replace(/, autosave$/, ""))} · ${fmtNum(meta.residents)} people · ${ago(meta.savedAt)}</span></button>` : ""}
          <button class="mm-item${meta ? "" : " primary"}" data-a="new" title="A hamlet, a road out of it and ${formatMoney(START_MONEY)}"><span class="mm-l">New company</span></button>
          <button class="mm-item" data-a="load"><span class="mm-l">Load game</span></button>
          <button class="mm-item" data-a="explore" title="The company behind this menu. Try the tools, nothing is saved"><span class="mm-l">Explore ${esc(name)}</span></button>
          <button class="mm-item" data-a="keys"><span class="mm-l">Controls</span></button>
        </div>
        <button class="mm-news" data-a="news"><span class="mm-news-k">New in ${VERSION}</span><span class="mm-news-t">${esc(CHANGELOG[0].title)}</span></button>
      </nav>`;
    this.live.className = "card mm-live";
    this.live.setAttribute("aria-live", "off");
    this.root.append(this.live);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>(".mm-item, .mm-news")) b.onclick = () => this.act(b.dataset.a!);
    this.strip.innerHTML = `<span><b>Exploring ${esc(name)}</b><span class="muted"> · nothing is saved</span></span><button class="btn">Main menu</button>`;
    (this.strip.querySelector("button") as HTMLButtonElement).onclick = () => this.open();
    this.tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 500);
  }

  /** The live line under the city: its name, the clock (the time-lapse's, so it matches the light), people and cars on the road right now. */
  private tick() {
    const g = this.app.game;
    const st = g.people.stats;
    this.live.innerHTML = `<b>${esc(g.cityName)}</b><span>${fmtNum(st.population)} people · ${fmtNum(g.buildings.list.length)} buildings</span><span class="mm-now"><i aria-hidden="true"></i>${clock(this.app.dayCycle.hour)} · ${fmtNum(g.traffic.vehicles.length)} vehicles on the road</span>`;
  }

  private act(a: string) {
    const app = this.app;
    this.hud.sound("click");
    if (a === "continue") {
      const last = app.saves.latest();
      const d = last ? app.saves.load(last.id) : null;
      if (!d) { this.hud.toast("That save is unreadable", true); return; }
      try { app.loadGame(d, app.saves.viewOf(last!.id)); } catch { this.hud.toast("That save is from an older version", true); return; }
      app.setMode("play");
    } else if (a === "new") {
      app.newGame(app.saves.latest() ? 1 + Math.floor(Math.random() * 9999) : 7);
      app.setMode("play");
      this.hud.newCity();
    } else if (a === "load") this.hud.openSaves(false);
    else if (a === "explore") app.setMode("explore");
    else if (a === "keys") this.hud.openKeys();
    else if (a === "news") this.hud.openNews();
  }
}
