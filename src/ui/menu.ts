import "./menu.css";
import type { App } from "../app";
import type { Game } from "../game/city";
import type { Hud } from "./hud";
import { cubicClosest } from "../roads/planner";
import { add, cubicAt, cubicTangent, dot, norm, scale, sub, v2, type V2 } from "../core/math";

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
  private data: SaveData | null = null;
  private timer = 0;

  constructor(private app: App, private hud: Hud) {
    this.root.className = "mm";
    this.root.hidden = true;
    this.curtain.className = "mm-curtain";
    this.curtain.hidden = true;
    this.strip.className = "card mm-strip";
    this.strip.hidden = true;
    document.body.append(this.root, this.curtain, this.strip);
    app.onMode((m) => {
      this.root.hidden = m !== "menu";
      this.strip.hidden = m !== "explore";
      if (m !== "menu") window.clearInterval(this.timer);
    });
  }

  /** The showcase save, fetched once. */
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

  /** Still camera on the showcase: the town square on, its streets level with the screen, the motorway running up the right. */
  private frame() {
    const g = this.app.game, v = this.app.view;
    const bs = g.buildings.list;
    // the centre of the town: weighted by size, so the towers pull it downtown
    let sx = 0, sy = 0, sw = 0;
    for (const b of bs) { const w = b.hw * b.hd; sx += b.c.x * w; sy += b.c.y * w; sw += w; }
    const c = sw ? v2(sx / sw, sy / sw) : v2(v.cx, v.cy);
    // the motorway nearest it
    let m: V2 | null = null, d = v2(0, 1), bd = Infinity;
    for (const s of g.net.segs.values()) {
      if (s.type !== "hw2" && s.type !== "one3") continue;
      const r = cubicClosest(s.c, c);
      if (r.d < bd) { bd = r.d; m = r.p; d = norm(cubicTangent(s.c, r.t)); }
    }
    v.halfH = 300;
    if (!m || bd > 1500) { v.rot = 0; v.cx = c.x; v.cy = c.y; return; }
    // screen right across the motorway, away from the town; the motorway a fifth of the way in from the right edge
    let r = v2(-d.y, d.x);
    if (dot(sub(c, m), r) > 0) r = scale(r, -1);
    v.rot = Math.atan2(r.y, r.x);
    // along the motorway: towards its interchange (the ramps), which sits a little above the middle
    let along = dot(sub(c, m), d);
    let ix = 0, iy = 0, n = 0;
    for (const s of g.net.segs.values()) {
      if (s.type !== "hw1") continue;
      const q = cubicAt(s.c, 0.5);
      if (Math.hypot(q.x - m.x, q.y - m.y) < 900) { ix += q.x; iy += q.y; n++; }
    }
    if (n) {
      const ai = dot(sub(v2(ix / n, iy / n), m), d);
      along = ai + Math.sign(along - ai) * Math.min(Math.abs(along - ai), v.halfH * 0.45);
    }
    const W = v.halfH * 2 * (v.w / Math.max(1, v.h));
    const p = add(add(m, scale(d, along)), scale(r, -W * 0.36));
    v.cx = p.x;
    v.cy = p.y;
  }

  private render() {
    const app = this.app;
    const last = app.saves.latest();
    const meta = last && (last.v ?? 1) >= 2 ? last : null;
    const name = app.game.cityName;
    this.root.innerHTML = `
      <nav class="card mm-card" aria-label="Main menu">
        <header class="mm-head">
          <h1 class="mm-title">Kilometre Zero</h1>
          <p class="mm-tag">Claim the land, build the roads, keep every truck moving.</p>
        </header>
        <div class="mm-list">
          ${meta ? `<button class="mm-item primary" data-a="continue"><span class="mm-l">Continue</span><span class="mm-s">${esc(meta.name.replace(/, autosave$/, ""))} · ${fmtNum(meta.residents)} people · ${ago(meta.savedAt)}</span></button>` : ""}
          <button class="mm-item${meta ? "" : " primary"}" data-a="new"><span class="mm-l">New city</span>${meta ? "" : `<span class="mm-s">Start by a motorway with $60,000</span>`}</button>
          <button class="mm-item" data-a="load"><span class="mm-l">Load city</span></button>
          <button class="mm-item" data-a="explore"><span class="mm-l">Explore ${esc(name)}</span><span class="mm-s">The city behind this menu. Look round, try the tools; nothing is saved</span></button>
          <button class="mm-item" data-a="keys"><span class="mm-l">Controls</span></button>
        </div>
      </nav>`;
    this.live.className = "card mm-live";
    this.live.setAttribute("aria-live", "off");
    this.root.append(this.live);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>(".mm-item")) b.onclick = () => this.act(b.dataset.a!);
    this.strip.innerHTML = `<span><b>Exploring ${esc(name)}</b><span class="muted"> · nothing here is saved</span></span><button class="btn">Main menu</button>`;
    (this.strip.querySelector("button") as HTMLButtonElement).onclick = () => this.open();
    this.tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 500);
  }

  /** The live line under the city: its name, the clock, people and cars on the road right now. */
  private tick() {
    const g = this.app.game;
    const st = g.people.stats;
    this.live.innerHTML = `<b>${esc(g.cityName)}</b><span>${fmtNum(st.population)} people · ${fmtNum(g.buildings.list.length)} buildings</span><span class="mm-now"><i aria-hidden="true"></i>${clock(g.hour)} · ${fmtNum(g.traffic.vehicles.length)} vehicles on the road</span>`;
  }

  private act(a: string) {
    const app = this.app;
    this.hud.sound("click");
    if (a === "continue") {
      const last = app.saves.latest();
      const d = last ? app.saves.load(last.id) : null;
      if (!d) { this.hud.toast("That save is unreadable", true); return; }
      try { app.loadGame(d); } catch { this.hud.toast("That save is from an older version", true); return; }
      app.setMode("play");
    } else if (a === "new") {
      app.newGame(app.saves.latest() ? 1 + Math.floor(Math.random() * 9999) : 7);
      app.setMode("play");
      this.hud.newCity();
    } else if (a === "load") this.hud.openSaves(false);
    else if (a === "explore") app.setMode("explore");
    else if (a === "keys") this.hud.openKeys();
  }
}
