// The sound's two bits of interface (docs/design.md, "Sound"): the Sound dialog reached from the pause menu (four
// volume sliders, Mute, the wireless's tone), and the wireless set beside the clock (on or off, the tune it is
// playing, next tune). The settings themselves live in audio/index.ts, kept in localStorage.

import "./sound.css";
import type { GameAudio } from "../audio";

const svg = (body: string) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
/**
 * a tabletop radio: a wide case on its aerial, the speaker grille on the left, the tuning dial on the right (the old
 * arched cathedral set with one dot read as a padlock: design audit 2026-11-10, F28)
 */
const ICON_SET = svg(`<path d="M5 5 L11 1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="1.2" y="5" width="13.6" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.6 7.6 v3.8 M5.3 7.6 v3.8 M7 7.6 v3.8" stroke="currentColor" stroke-width="1.1"/><circle cx="11.2" cy="9.5" r="1.9" fill="none" stroke="currentColor" stroke-width="1.2"/>`);
const ICON_NEXT = svg(`<path d="M3 3.5 L9 8 L3 12.5 Z" fill="currentColor"/><rect x="10.5" y="3.5" width="2.2" height="9" fill="currentColor"/>`);

const SLIDERS: [key: "master" | "music" | "world" | "ui", name: string, hint: string][] = [
  ["master", "Master", "Everything"],
  ["music", "Music", "The radio"],
  ["world", "World", "Traffic, works, towns, weather"],
  ["ui", "Interface", "Clicks, building, fanfares"],
];

/** The Sound dialog's body. */
export function soundHtml(a: GameAudio): string {
  const s = a.settings;
  return `<div class="snd">
    ${SLIDERS.map(([k, name, hint]) => `<label class="snd-row" title="${hint}"><span class="snd-n">${name}</span>
      <input type="range" min="0" max="100" step="5" value="${Math.round(s[k] * 100)}" data-k="${k}" aria-label="${name} volume">
      <output class="num">${Math.round(s[k] * 100)}</output></label>`).join("")}
    <button class="pm snd-sw mute" role="switch" aria-checked="${s.muted}">Mute<span class="muted">N</span><span class="pm-v">${s.muted ? "On" : "Off"}</span></button>
    <button class="pm snd-sw old" role="switch" aria-checked="${s.old}" title="Old set: the band through a 1930s wireless, a narrow, warm sound with a faint crackle. Off: the band as it is.">Old radio tone<span class="pm-v">${s.old ? "On" : "Off"}</span></button>
  </div>`;
}

/** Wire the Sound dialog. `click` plays the interface's click (so a slider can be judged by ear). */
export function wireSound(dlg: HTMLElement, a: GameAudio, click: () => void) {
  for (const input of dlg.querySelectorAll<HTMLInputElement>(".snd-row input")) {
    const k = input.dataset.k as "master" | "music" | "world" | "ui", out = input.parentElement!.querySelector("output")!;
    const paint = () => input.style.setProperty("--p", String(+input.value / 100));
    paint();
    input.oninput = () => { a.set({ [k]: +input.value / 100 }); out.textContent = input.value; paint(); };
    // (letting go of a slider sounds the interface once at the new level)
    input.onchange = () => click();
  }
  const sw = (sel: string, key: "muted" | "old") => {
    const b = dlg.querySelector<HTMLButtonElement>(sel)!;
    b.onclick = () => {
      a.set({ [key]: !a.settings[key] });
      b.setAttribute("aria-checked", String(a.settings[key]));
      b.querySelector(".pm-v")!.textContent = a.settings[key] ? "On" : "Off";
      click();
    };
  };
  sw(".mute", "muted");
  sw(".old", "old");
}

/** The pause menu's Sound row: what it says on the right. */
export const soundSummary = (a: GameAudio) => (a.settings.muted ? "Muted" : `${Math.round(a.settings.master * 100)}%`);

/**
 * The radio beside the clock: the set's icon and the tune's name in quotes, so a tune called "Payday in Quimbyton"
 * reads as a song, not a game event (design audit 2026-11-10, F28, F31). No "Radio" label over it: the icon says
 * what the slot is, and "Radio off" when it is off (no eyebrows, docs/ui-words.md).
 */
export class WirelessControl {
  readonly el = document.createElement("div");
  private onBtn = document.createElement("button");
  private nextBtn = document.createElement("button");
  private name = document.createElement("span");
  private tuneEl = document.createElement("span");
  private last = "";

  constructor(private a: GameAudio, click: () => void) {
    this.el.className = "wireless";
    this.el.setAttribute("role", "group");
    this.el.setAttribute("aria-label", "Radio");
    this.onBtn.className = "speed-btn wl-on";
    this.onBtn.innerHTML = ICON_SET;
    this.onBtn.setAttribute("role", "switch");
    this.onBtn.onclick = () => { a.set({ wireless: !a.settings.wireless }); click(); };
    this.name.className = "wl-name";
    this.tuneEl.className = "wl-tune";
    this.name.append(this.tuneEl);
    this.nextBtn.className = "speed-btn wl-next";
    this.nextBtn.innerHTML = ICON_NEXT;
    this.nextBtn.title = "Next tune";
    this.nextBtn.setAttribute("aria-label", "Next tune");
    this.nextBtn.onclick = () => { a.nextTune(); click(); };
    this.el.append(this.onBtn, this.name, this.nextBtn);
    this.paint();
  }

  /** Bring it up to date (the tune changed, a setting changed). */
  paint() {
    const s = this.a.settings, on = s.wireless, tune = this.a.tune;
    const text = !on ? "Radio off" : s.muted ? "Sound muted" : tune ? `“${tune}”` : "Tuning in";
    const key = `${on}|${text}`;
    if (key === this.last) return;
    this.last = key;
    this.onBtn.classList.toggle("on", on);
    this.onBtn.setAttribute("aria-checked", String(on));
    this.onBtn.title = on ? "Radio: on. Click to switch it off." : "Radio: off. Click to switch it on.";
    this.onBtn.setAttribute("aria-label", "Radio");
    this.tuneEl.textContent = text;
    this.name.title = on && tune ? `Now playing: ${tune}` : "";
    this.name.classList.toggle("idle", !on || !tune || s.muted);
    this.nextBtn.disabled = !on;
  }
}
