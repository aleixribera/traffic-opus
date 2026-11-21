import "./gamepad.css";
import type { App } from "../app";
import type { Hud } from "./hud";
import { B, PadReader, padWords, pickDir, type Box, type PadFrame } from "./padRead";
import { ROAD_MODES } from "../app";

// The game on a controller (a PS4 DualShock, or any "standard" pad), with no mouse or keyboard: the living-room TV.
//
// On the map, a cursor on the left stick stands in for the mouse: the pad calls the same pointer handlers a mouse
// does (App.padPointer), so every tool works as it does with the mouse, snapping and drag included. Menus, dialogs and
// panels are walked with the d-pad: a focus frame moves between their buttons by where they sit on screen.
// Whichever came last, the pad or the mouse and keys, is in charge: the pad's cursor, glyphs and the larger
// interface for the TV show only after the pad was touched, and go at the first move of the mouse or a key.

type Ui = "map" | "build" | "hud";

/** Things a focus frame can land on. Text boxes are left out: a pad can't type (their dialogs have a button that does). */
const FOCUSABLE = "button, a[href], input[type=range], input[type=checkbox], input[type=radio], select, summary, [tabindex]:not([tabindex='-1'])";

const CATS = ["roads", "industry", "transport"] as const;

/** The button map, as the Controls dialog lists it with the pad in hand. */
export const PAD_KEYS: [string, string][] = [
  ["lstick", "Move the cursor (to the edge of the screen: move the map)"],
  ["rstick", "Move the map. In a list: scroll"],
  ["l2 r2", "Zoom out / in"],
  ["l1 r1", "Turn the map. With a building in hand: turn it. In the build menu: Roads, Industry, Transport"],
  ["cross", "Select, build, place. Hold and move to drag a road or a bulldozer box"],
  ["circle", "Back: undo a road's last point, put the tool down, close"],
  ["triangle", "Build menu"],
  ["square", "Bulldozer"],
  ["dpad", "Roads: height and mode. Otherwise: game speed (down to pause)"],
  ["share", "Panels and buttons on screen"],
  ["options", "Pause menu"],
  ["l3", "Map view and back"],
  ["r3", "Undo"],
];

const SYM: Record<string, string> = {
  cross: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="#8fb8f2" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  circle: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5.6" fill="none" stroke="#f08c8c" stroke-width="2.4"/></svg>`,
  square: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" fill="none" stroke="#e7a0d2" stroke-width="2.3"/></svg>`,
  triangle: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.2l6.2 10.6H3.8z" fill="none" stroke="#5fd6b0" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
};
const NAMES: Record<string, string> = {
  cross: "Cross", circle: "Circle", square: "Square", triangle: "Triangle", l1: "L1", r1: "R1", l2: "L2", r2: "R2",
  share: "Share", options: "Options", l3: "L3", r3: "R3", lstick: "Left stick", rstick: "Right stick", dpad: "D-pad",
  "dpad-ud": "D-pad up and down", "dpad-lr": "D-pad left and right",
};

/** One button's picture: the PlayStation shapes, else its name on a key cap. */
export function glyph(k: string): string {
  const label = NAMES[k] ?? k;
  if (SYM[k]) return `<span class="pg pg-face" role="img" aria-label="${label}">${SYM[k]}</span>`;
  if (k === "lstick" || k === "rstick") return `<span class="pg pg-stick" role="img" aria-label="${label}">${k[0].toUpperCase()}</span>`;
  if (k.startsWith("dpad")) {
    const arms = k === "dpad-ud" ? "ud" : k === "dpad-lr" ? "lr" : "udlr";
    const on = (a: string) => (arms.includes(a) ? "#f3ead6" : "#55627a");
    return `<span class="pg pg-dpad" role="img" aria-label="${label}"><svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8 2h4v5H8z" fill="${on("u")}"/><path d="M8 13h4v5H8z" fill="${on("d")}"/><path d="M2 8h5v4H2z" fill="${on("l")}"/><path d="M13 8h5v4h-5z" fill="${on("r")}"/></svg></span>`;
  }
  return `<span class="pg pg-cap" role="img" aria-label="${label}">${label.toUpperCase()}</span>`;
}

/** The Controls dialog's list with the pad in hand. */
export function padKeysHtml(): string {
  return `<dl class="keys pad-keys">${PAD_KEYS.map(([k, v]) => `<dt>${k.split(" ").map(glyph).join("")}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

/** A control's own words, without the value beside them ("Sound", not "Sound 80%"). */
const label = (el: Element): string => (el.firstChild?.textContent ?? el.textContent ?? "").trim();

const boxOf = (el: Element): Box => el.getBoundingClientRect();

function shown(el: HTMLElement): boolean {
  if (el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) {
    // (off screen but in a list that scrolls: still reachable, the list scrolls to it)
    if (!scroller(el)) return false;
  }
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && cs.pointerEvents !== "none";
}

function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let e = el?.parentElement ?? null; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2) return e;
  }
  return null;
}

/**
 * Scrolls a block that scrolls by most of its height, `dir` 1 down or -1 up. False when it does not scroll, or is
 * already at that end (so the focus may leave it).
 */
function scrollStep(el: HTMLElement, dir: 1 | -1): boolean {
  if (el.scrollHeight <= el.clientHeight + 2 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return false;
  const max = el.scrollHeight - el.clientHeight;
  if ((dir > 0 && el.scrollTop >= max - 1) || (dir < 0 && el.scrollTop <= 1)) return false;
  el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + dir * Math.max(40, el.clientHeight * 0.6)));
  return true;
}

export class PadControl {
  private reader = new PadReader();
  /** the pad was the last thing used (else the mouse and keys) */
  private on = false;
  private ui: Ui = "map";
  private focus: HTMLElement | null = null;
  private focusBox: Box | null = null;
  private scopeKey: Element | null = null;
  /** the cursor, in the canvas's pixels */
  private cx = -1;
  private cy = -1;
  private cursorEl = document.createElement("div");
  private hintsEl = document.createElement("div");
  private hintSig = "";
  /** Cross held down on the map as a mouse button (a road or a bulldozer box dragged) */
  private dragging = false;
  private lastCat: (typeof CATS)[number] = "roads";
  private last = performance.now();
  private wordsT = 0;
  private said = new WeakMap<Text, string>();
  private saidNodes = new Set<Text>();

  constructor(private app: App, private hud: Hud) {
    // (the dev build lets a script reach it: tools/pad-audit.mjs walks every screen with it)
    if (import.meta.env.DEV) (window as unknown as { __padctl?: PadControl }).__padctl = this;
    this.cursorEl.className = "pad-cursor";
    this.cursorEl.hidden = true;
    this.cursorEl.innerHTML = `<i></i>`;
    this.hintsEl.className = "pad-hints";
    this.hintsEl.hidden = true;
    this.hintsEl.setAttribute("aria-hidden", "true");
    document.body.append(this.cursorEl);
    // (in the HUD, where the pointer's line keeps clear of it as of every card)
    hud.root.append(this.hintsEl);
    // the mouse or a key takes over again (a real move: a click from the pad's focus is not one)
    const off = () => { if (this.on) this.setOn(false); };
    window.addEventListener("mousemove", (e) => { if (e.movementX || e.movementY) off(); }, true);
    window.addEventListener("pointerdown", (e) => { if (e.isTrusted) off(); }, true);
    window.addEventListener("wheel", off, { capture: true, passive: true });
    window.addEventListener("keydown", (e) => { if (e.isTrusted) off(); }, true);
    window.addEventListener("resize", () => this.applyTv());
    window.addEventListener("gamepadconnected", () => this.loop());
    requestAnimationFrame(this.loop);
  }

  /** Is the pad in charge (for the HUD: the Controls dialog, the words). */
  get active(): boolean { return this.on; }

  private running = false;
  private loop = () => {
    if (this.running) return;
    this.running = true;
    const step = () => {
      try { this.frame(performance.now()); } catch (e) { console.error(e); }
      // (no pad ever connected: one look a second is enough, and the browser wakes the loop on gamepadconnected)
      if (this.everPad || this.on) requestAnimationFrame(step);
      else { this.running = false; setTimeout(this.loop, 1000); }
    };
    step();
  };
  private everPad = false;

  private setOn(on: boolean) {
    this.on = on;
    document.body.classList.toggle("pad-on", on);
    this.applyTv();
    if (!on) {
      this.release(true);
      // (the browser's focus leaves the pad's last item too: the keys move the camera again, Enter clicks nothing)
      if (this.focus && document.activeElement === this.focus) this.focus.blur();
      this.app.padCam.x = this.app.padCam.y = this.app.padCam.turn = this.app.padCam.zoom = 0;
      this.setFocus(null);
      this.cursorEl.hidden = true;
      this.hintsEl.hidden = true;
      this.hintSig = "";
      this.ui = "map";
      this.restoreWords();
    } else {
      this.app.audio.unlock();
      // (the cursor starts where the mouse last was over the map, else in the middle)
      const p = this.app.padCursorStart();
      this.cx = p.x; this.cy = p.y;
    }
  }

  /** The TV: the interface a third larger at 1080p (read from three metres away), only with the pad in hand. */
  private applyTv() {
    const tv = this.on && window.innerWidth >= 1280;
    document.body.classList.toggle("pad-tv", tv);
    document.documentElement.style.setProperty("--pad-z", String(Math.min(1.4, Math.max(1, window.innerWidth / 1440))));
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const pads = typeof navigator.getGamepads === "function" ? [...navigator.getGamepads()] : [];
    if (pads.some((p) => p?.connected)) this.everPad = true;
    const f = this.reader.read(pads, now);
    if (f.active && !this.on) {
      this.setOn(true);
      // (the press that woke the pad does its job too)
    }
    if (!this.on) return;
    const app = this.app;
    // (the pad went away with Cross held: its drag ends there)
    if (f.index === null) this.release();
    // a cinematic camera: any button leaves it, and does nothing else
    if (app.camera.cinematic) {
      if (f.pressed.size) app.camera.exitCinema();
      this.release();
      app.padCam.x = app.padCam.y = app.padCam.turn = app.padCam.zoom = 0;
      this.cursorEl.hidden = true;
      this.hints([]);
      return;
    }
    const roots = this.scope();
    // (a dialog opened afresh starts at its top: what was focused is remembered only while dialogs stay up)
    if (!roots?.some((r) => r.matches("[aria-modal='true']"))) this.lastIn.clear();
    if (roots) this.uiFrame(f, roots, dt);
    else this.mapFrame(f, dt);
    // (a few times a second: both read the page's layout)
    if (now > this.wordsT) { this.wordsT = now + 200; this.padTexts(); this.placeHints(); }
  }

  // ------------------------------------------------------------------ where the focus lives

  /** What the d-pad walks now, or null for the map. */
  private scope(): HTMLElement[] | null {
    const modals = [...document.querySelectorAll<HTMLElement>("[aria-modal='true'], .gl-notice")].filter((m) => !m.closest("[hidden]"));
    if (modals.length) return [modals[modals.length - 1]];
    // (a milestone's banner pauses the game until it is read: its Continue takes the focus like a dialog's)
    const banner = document.querySelector<HTMLElement>(".hud > .banner");
    if (banner && !banner.hidden && banner.querySelector("button")) return [banner];
    const app = this.app;
    if (app.mode === "menu") return [...document.querySelectorAll<HTMLElement>(".mm, .ver-tag")];
    if (this.ui === "build") {
      if (!this.hud.catOpen) { this.ui = "map"; return null; }
      return [...document.querySelectorAll<HTMLElement>(".hud .assets, .hud .cats, .hud .toolopts")];
    }
    if (this.ui === "hud") {
      return [...document.querySelectorAll<HTMLElement>(".hud > .corner, .hud > .bottom, .hud > .banner, .hud > .season-card, .hud > .season-pop, .goal-ptr-layer, .sa-chip, .mm-strip, .ver-tag")];
    }
    return null;
  }

  private candidates(roots: HTMLElement[]): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const r of roots) {
      const list = r.matches(FOCUSABLE) ? [r] : [];
      list.push(...r.querySelectorAll<HTMLElement>(FOCUSABLE));
      for (const el of list) {
        if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-hidden") === "true") continue;
        if (shown(el)) out.push(el);
      }
    }
    return out;
  }

  private setFocus(el: HTMLElement | null) {
    if (this.focus && this.focus !== el) this.focus.classList.remove("pad-focus");
    this.focus = el;
    if (!el) { this.focusBox = null; return; }
    el.classList.add("pad-focus");
    // (remembered per dialog, so Back from Controls lands on Controls again in the pause menu)
    const dlg = el.closest(".dialog");
    if (dlg) this.lastIn.set(dlg.className, label(el));
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.focusBox = boxOf(el);
  }

  /** The words of the last thing focused in each kind of dialog (by its class). */
  private lastIn = new Map<string, string>();

  /** Where the focus starts in a dialog or menu just opened. */
  private firstOf(cands: HTMLElement[], roots: HTMLElement[]): HTMLElement | null {
    const dlg = roots[roots.length - 1]?.querySelector(".dialog") ?? roots[roots.length - 1]?.closest(".dialog");
    const was = dlg ? this.lastIn.get(dlg.className) : undefined;
    if (was) {
      const el = cands.find((c) => label(c) === was);
      if (el) return el;
    }
    const act = document.activeElement as HTMLElement | null;
    if (act && cands.includes(act)) return act;
    // (the title menu: its first line, Continue)
    if (this.app.mode === "menu" && !roots[0]?.matches("[aria-modal='true']")) return cands[0] ?? null;
    for (const sel of [".asset.on", ".asset:not(.locked)", ".resume", ".primary", "[type=submit]", ".pause .pm"]) {
      const el = cands.find((c) => c.matches(sel));
      if (el) return el;
    }
    // (the HUD: start at the selection's panel, else an open window, else the top bar)
    if (this.ui === "hud" && roots.length) {
      for (const sel of [".hud .panel", ".hud .win", ".hud .banner", ".hud .tl-row"]) {
        const el = cands.find((c) => c.closest(sel));
        if (el) return el;
      }
    }
    // (a dialog's Back button is a last resort: its first real choice comes first)
    return cands.find((c) => !c.matches(".back, .close")) ?? cands[0] ?? null;
  }

  private uiFrame(f: PadFrame, roots: HTMLElement[], dt: number) {
    const app = this.app;
    app.padCam.x = app.padCam.y = app.padCam.turn = app.padCam.zoom = 0;
    this.release();
    if (!this.cursorEl.hidden) { this.cursorEl.hidden = true; app.padAway(); }
    const key = roots[0] ?? null;
    let cands: HTMLElement[] | null = null;
    const all = () => (cands ??= this.candidates(roots));
    // a new dialog or menu: the focus starts on its first choice
    if (key !== this.scopeKey) {
      this.scopeKey = key;
      this.setFocus(this.firstOf(all(), roots));
    } else if (!this.focus || !this.focus.isConnected || !roots.some((r) => r.contains(this.focus)) || !shown(this.focus)) {
      // the panel was drawn again under the focus: the same place in it, else the nearest thing
      const act = document.activeElement as HTMLElement | null;
      const c = all();
      if (act && c.includes(act)) this.setFocus(act);
      else if (this.focusBox && c.length) {
        const fb = this.focusBox, fx = (fb.left + fb.right) / 2, fy = (fb.top + fb.bottom) / 2;
        let best = c[0], bd = Infinity;
        for (const el of c) {
          const b = boxOf(el), d = Math.hypot((b.left + b.right) / 2 - fx, (b.top + b.bottom) / 2 - fy);
          if (d < bd) { bd = d; best = el; }
        }
        this.setFocus(best);
      } else this.setFocus(this.firstOf(c, roots));
    }
    const el = this.focus;
    // a slider takes left and right itself
    if (f.nav && el instanceof HTMLInputElement && el.type === "range" && (f.nav === "left" || f.nav === "right")) {
      const step = Number(el.step) || 1, v = Number(el.value) + (f.nav === "right" ? step : -step);
      el.value = String(Math.max(Number(el.min || 0), Math.min(Number(el.max || 100), v)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (f.nav && el && (f.nav === "up" || f.nav === "down") && scrollStep(el, f.nav === "down" ? 1 : -1)) {
      // (a list that is one block, What's new: up and down read through it first, then leave it at its ends)
    } else if (f.nav) {
      const c = all().filter((x) => x !== el);
      const from = el ? boxOf(el) : this.focusBox;
      if (from) {
        const i = pickDir(from, c.map(boxOf), f.nav);
        if (i >= 0) this.setFocus(c[i]);
        // (nothing more that way: the list the focus is in shows its last lines)
        else if (el && (f.nav === "up" || f.nav === "down")) { const s = scroller(el); if (s) scrollStep(s, f.nav === "down" ? 1 : -1); }
      } else this.setFocus(this.firstOf(all(), roots));
    }
    // the right stick scrolls the list the focus is in (or the dialog)
    if (f.ry) {
      const s = scroller(this.focus) ?? roots.map((r) => r.querySelector<HTMLElement>("[tabindex], .win-body, .cl-list")).find((x) => x && x.scrollHeight > x.clientHeight) ?? null;
      if (s) s.scrollTop += f.ry * 900 * dt;
    }
    const modal = !!roots[0]?.matches("[aria-modal='true'], .gl-notice, .banner");
    if (f.pressed.has(B.cross) && this.focus) {
      const target = this.focus, before = this.toolSig();
      this.app.audio.unlock();
      if (target instanceof HTMLSelectElement) {
        target.selectedIndex = (target.selectedIndex + 1) % Math.max(1, target.options.length);
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else target.click();
      // a card picked from the build menu, or a tool taken up from a panel: back to the map with it in hand
      if (!modal && this.ui !== "map") {
        const picked = this.ui === "build" && target.matches(".asset:not(.locked)");
        const took = this.toolSig() !== before && app.st.tool !== "inspect";
        if (picked || took) this.toMap();
      }
    } else if (f.pressed.has(B.circle)) {
      if (modal) {
        const back = roots[0].querySelector<HTMLElement>("button.back");
        if (back && shown(back)) back.click();
        else this.hud.back();
      } else if (this.ui === "build") {
        // (out of the build menu: with nothing in hand, it closes too)
        if (app.st.tool === "inspect" && this.hud.catOpen) this.hud.catKey(this.hud.catOpen);
        this.toMap();
      } else if (this.ui === "hud") this.toMap();
    } else if (f.pressed.has(B.options) && app.mode !== "menu") {
      // (the pause menu's own button closes it again)
      if (modal && roots[0].matches(".pause")) this.hud.back();
      else if (!modal) { this.toMap(); this.hud.openPause(); }
    } else if (!modal && this.ui === "build" && (f.pressed.has(B.l1) || f.pressed.has(B.r1))) {
      const c = this.hud.catOpen;
      const i = Math.max(0, CATS.indexOf((c ?? "roads") as (typeof CATS)[number]));
      const next = CATS[(i + (f.pressed.has(B.r1) ? 1 : CATS.length - 1)) % CATS.length];
      this.hud.catKey(next);
      this.lastCat = next;
      this.scopeKey = null;
    } else if (!modal && this.ui === "build" && f.pressed.has(B.triangle)) {
      if (app.st.tool === "inspect" && this.hud.catOpen) this.hud.catKey(this.hud.catOpen);
      this.toMap();
    } else if (!modal && this.ui === "hud" && f.pressed.has(B.share)) this.toMap();
    this.hints(this.uiHints(modal));
  }

  private toMap() {
    this.ui = "map";
    this.scopeKey = null;
    this.setFocus(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private toolSig(): string {
    const s = this.app.st;
    return `${s.tool}|${s.roadType}|${s.placed}|${s.mode}|${s.transitMode}|${s.rbSize}`;
  }

  // ------------------------------------------------------------------ the map

  private release(cancel = false) {
    if (!this.dragging) return;
    this.dragging = false;
    this.app.padPointer(cancel ? "cancel" : "up", this.cx, this.cy);
  }

  private mapFrame(f: PadFrame, dt: number) {
    const app = this.app, v = app.view;
    this.scopeKey = null;
    if (this.focus) this.setFocus(null);
    const w = v.w, h = v.h;
    if (this.cx < 0 || this.cx > w || this.cy < 0 || this.cy > h) { this.cx = w / 2; this.cy = h / 2; }
    // the cursor: a curve on the stick, fine near the middle and quick when pushed all the way (a screen in ~1 s)
    const m = Math.hypot(f.lx, f.ly);
    let ex = 0, ey = 0;
    if (m > 0) {
      const speed = h * (0.12 + 1.0 * m * m) / m;
      const nx = this.cx + f.lx * speed * dt, ny = this.cy + f.ly * speed * dt;
      // (on a TV the cursor keeps to the safe area, as the HUD does: gamepad.css)
      const tv = document.body.classList.contains("pad-tv");
      const px = tv ? Math.round(w * 0.025) : 6, py = tv ? Math.round(h * 0.025) : 6;
      this.cx = Math.max(px, Math.min(w - px, nx));
      this.cy = Math.max(py, Math.min(h - py, ny));
      // (pushed against an edge of the screen, the map moves under it)
      if (nx <= px && f.lx < 0) ex = f.lx; else if (nx >= w - px && f.lx > 0) ex = f.lx;
      if (ny <= py && f.ly < 0) ey = f.ly; else if (ny >= h - py && f.ly > 0) ey = f.ly;
    }
    const placing = app.st.tool === "place";
    const pc = app.padCam;
    pc.x = Math.max(-1, Math.min(1, f.rx + ex));
    pc.y = Math.max(-1, Math.min(1, f.ry + ey));
    pc.zoom = f.l2 - f.r2;
    pc.turn = placing ? 0 : (f.held.has(B.r1) ? 1 : 0) - (f.held.has(B.l1) ? 1 : 0);
    const r = v.canvas.getBoundingClientRect();
    this.cursorEl.hidden = false;
    this.cursorEl.style.transform = `translate(${Math.round(r.left + this.cx)}px, ${Math.round(r.top + this.cy)}px)`;
    this.cursorEl.classList.toggle("down", this.dragging);
    // the ground under the cursor moves with the stick and with the camera: the tool hears of it as a mouse move
    if (m > 0 || pc.x || pc.y || pc.zoom || pc.turn || f.pressed.size || !app.padHasCursor) app.padPointer("move", this.cx, this.cy);

    const p = f.pressed;
    const t = app.st.tool;
    // (the cursor over a button on screen, a card or a town's name: Cross presses it, as a click would)
    const r0 = v.canvas.getBoundingClientRect();
    const over = p.has(B.cross) ? document.elementFromPoint(r0.left + this.cx, r0.top + this.cy) : null;
    const btn = over && over !== v.canvas ? (over as HTMLElement).closest<HTMLElement>(FOCUSABLE) : null;
    if (btn) {
      this.app.audio.unlock();
      const before = this.toolSig();
      btn.click();
      if (this.toolSig() !== before) app.padPointer("move", this.cx, this.cy);
    } else if (p.has(B.cross) && !over?.closest(".hud > .corner, .hud > .bottom, .hud > .banner, .hud > .modal, .hud > .season-card, .card")) {
      // (over the plain part of a panel, as a click there, nothing happens on the map under it)
      this.app.audio.unlock();
      // a road and the bulldozer's box are drawn with Cross held; anything else is one click
      if (t === "road" || t === "bulldoze") { app.padPointer("down", this.cx, this.cy); this.dragging = true; }
      else { app.padPointer("down", this.cx, this.cy); app.padPointer("up", this.cx, this.cy); }
    }
    if (f.released.has(B.cross)) this.release();
    if (p.has(B.circle)) { this.release(); app.padBack(); }
    if (p.has(B.square)) { this.release(); app.setTool({ tool: t === "bulldoze" ? "inspect" : "bulldoze" }); this.hud.sound("click"); }
    if (p.has(B.triangle)) {
      this.release();
      const c = this.hud.catOpen;
      // (open the menu last used; one folded away under the tool in hand unfolds)
      if (!c) this.hud.catKey(this.lastCat);
      else if (!this.hud.catCards) this.hud.catKey(c);
      if (this.hud.catOpen) { this.lastCat = this.hud.catOpen as (typeof CATS)[number]; this.ui = "build"; }
      this.hud.sound("click");
    }
    if (p.has(B.share)) { this.release(); this.ui = "hud"; }
    if (p.has(B.options)) { this.release(); this.hud.openPause(); }
    if (p.has(B.l3)) { app.toggleMapView(); this.hud.sound("click"); }
    if (p.has(B.r3)) app.undo();
    if (placing && (p.has(B.l1) || p.has(B.r1))) app.turnPlaced(p.has(B.r1) ? 1 : -1);
    // the d-pad: a road's height and drawing mode; a building's turn; else the game's speed
    if (t === "road") {
      if (p.has(B.up)) app.setLevel(app.st.level + 1);
      if (p.has(B.down)) app.setLevel(app.st.level - 1);
      if (p.has(B.left) || p.has(B.right)) {
        const i = ROAD_MODES.indexOf(app.st.mode);
        app.setTool({ tool: "road", mode: ROAD_MODES[(i + (p.has(B.right) ? 1 : ROAD_MODES.length - 1)) % ROAD_MODES.length] });
        this.hud.sound("click");
      }
    } else if (placing) {
      if (p.has(B.left) || p.has(B.right)) app.turnPlaced(p.has(B.right) ? 1 : -1);
    } else if (p.has(B.up) || p.has(B.down)) {
      const steps = [0, 1, 2, 4], g = app.game;
      const i = g.paused ? 0 : Math.max(1, steps.indexOf(g.speed));
      const j = Math.max(0, Math.min(steps.length - 1, i + (p.has(B.up) ? 1 : -1)));
      if (j !== i) { if (j === 0) app.togglePause(); else app.setSpeed(steps[j]); }
    }
    this.hints(this.mapHints());
  }

  // ------------------------------------------------------------------ what the buttons do now

  private mapHints(): [string, string][] {
    const app = this.app, t = app.st.tool;
    const cross: Record<string, string> = {
      inspect: "Select", road: app.st.mode === "replace" ? "Upgrade" : app.drawingRoad ? "End road" : "Start road", place: "Build",
      bulldoze: "Demolish", transit: "Place", lane: "Add lane", junction: "Lights", roundabout: "Build",
    };
    const out: [string, string][] = [["lstick", "Cursor"], ["rstick", "Map"], ["l2 r2", "Zoom"], ["cross", cross[t] ?? "Select"]];
    if (app.hasDraft) out.push(["circle", "Undo point"]);
    else if (t !== "inspect") out.push(["circle", "Put down"]);
    else if (this.hud.anythingOpen) out.push(["circle", "Close"]);
    if (t === "road") out.push(["dpad-lr", "Mode"], ["dpad-ud", "Height"]);
    else if (t === "place") out.push(["l1 r1", "Turn"]);
    // (with nothing in hand the camera's turn and the speed are in the Controls list: the row stays short)
    out.push(["triangle", "Build"]);
    if (t !== "bulldoze") out.push(["square", "Bulldoze"]);
    out.push(["share", "Panels"], ["options", "Menu"]);
    return out;
  }

  private uiHints(modal: boolean): [string, string][] {
    const out: [string, string][] = [["dpad", "Move"], ["cross", "Choose"], ["circle", "Back"]];
    if (!modal && this.ui === "build") out.push(["l1 r1", "Category"], ["triangle", "Close"]);
    if (this.focus && scroller(this.focus)) out.push(["rstick", "Scroll"]);
    return out;
  }

  private hints(list: [string, string][]) {
    const sig = list.map((x) => x.join(":")).join("|");
    if (sig === this.hintSig) return;
    this.hintSig = sig;
    this.hintsEl.hidden = !list.length;
    // (over the title menu there is no bar: the row stands at the foot of the screen, in the middle)
    this.hintsEl.classList.toggle("at-foot", this.app.mode === "menu");
    this.hintsEl.innerHTML = list.map(([k, v]) => `<span class="ph"><span class="ph-g">${k.split(" ").map(glyph).join("")}</span><b>${v}</b></span>`).join("");
  }

  /** The row of hints stands above the bar, and above any card at the foot of the screen it would cover. */
  private placeHints() {
    const el = this.hintsEl;
    if (el.hidden || el.classList.contains("at-foot")) { if (this.hintLift) { el.style.bottom = ""; this.hintLift = 0; } return; }
    const z = Number(getComputedStyle(el).zoom) || 1;
    const me = el.getBoundingClientRect();
    let lift = 0;
    for (const c of document.querySelectorAll<HTMLElement>(".hud .assets, .hud .toolopts, .hud .follow-chip, .hud > .season-card")) {
      if (c.hidden || !c.offsetParent) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.right < me.left || r.left > me.right) continue;
      lift = Math.max(lift, window.innerHeight - r.top + 8);
    }
    // (never up over the cards at the top right: there it stays put, over the edge of the card below)
    const tr = document.querySelector(".hud > .corner.tr")?.getBoundingClientRect();
    if (lift && tr && tr.height > 0 && window.innerHeight - lift - me.height < tr.bottom + 8) lift = 0;
    if (Math.abs(lift - this.hintLift) < 1) return;
    this.hintLift = lift;
    el.style.bottom = lift ? `${lift / z}px` : "";
  }
  private hintLift = 0;

  // ------------------------------------------------------------------ the words

  /** "Click" in the tool's notes and the pointer's line says "Press ✕" while the pad is in hand. */
  private padTexts() {
    // (the pointer's line says it itself, where it is written: Hud.chips; nodes since redrawn are forgotten)
    for (const n of this.saidNodes) if (!n.isConnected) this.saidNodes.delete(n);
    const roots = document.querySelectorAll(".hud .toolopts, .hud > .toasts, .hud .goals, .hud .assets .as-read");
    for (const r of roots) {
      const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
        const s = n.data;
        if (!/click/i.test(s)) continue;
        const said = padWords(s);
        if (said !== s) { this.said.set(n, s); this.saidNodes.add(n); n.data = said; }
      }
    }
  }

  private restoreWords() {
    for (const n of this.saidNodes) {
      const s = this.said.get(n);
      if (s !== undefined && n.isConnected) n.data = s;
    }
    this.saidNodes.clear();
  }
}
