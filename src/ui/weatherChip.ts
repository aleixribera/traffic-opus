// The weather beside the clock (game/weather.ts): a small glyph over its word, in the clock's own lettering. The
// weather is mood only, and the tooltip says so in plain words: it never slows a truck or changes a route.
// Self-contained: it sits itself just before the clock and writes only when what it shows changes.
import "./weatherChip.css";
import { WEATHER_NAME, type WeatherKind } from "../game/weather";

const SUN = `<circle cx="8" cy="8" r="2.6"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/>`;
const MOON = `<path d="M11.6 10.4A5 5 0 0 1 5.6 4.4a5 5 0 1 0 6 6z"/>`;
const CLOUD = (y = 0) => `<path d="M4.6 ${11 + y}h7a2.6 2.6 0 0 0 .2-5.2 3.6 3.6 0 0 0-6.9-.6A2.9 2.9 0 0 0 4.6 ${11 + y}z"/>`;
const SMALL_SUN = `<circle cx="5" cy="5.2" r="2"/><path d="M5 1.2v.9M1 5.2h.9M2.2 2.4l.6.6M7.8 2.4l-.6.6"/>`;
const SMALL_MOON = `<path d="M7.4 6.6A3 3 0 0 1 3.6 2.8a3 3 0 1 0 3.8 3.8z"/>`;
const LINES = (n: number) => [`<path d="M5.6 12.6l-.9 1.8"/>`, `<path d="M8.6 12.6l-.9 1.8"/>`, `<path d="M11.4 12.6l-.9 1.8"/>`].slice(0, n).join("");

function glyph(k: WeatherKind, night: boolean): string {
  switch (k) {
    case "clear": return night ? MOON : SUN;
    case "fair": case "clearing": return `${night ? SMALL_MOON : SMALL_SUN}<g transform="translate(1.2 1.2) scale(0.92)">${CLOUD()}</g>`;
    case "overcast": return CLOUD(0.6);
    case "showers": return CLOUD(-1.6) + LINES(2);
    case "rain": return CLOUD(-1.6) + LINES(3);
    case "snow": return CLOUD(-1.6) + `<path d="M5.4 13.4h.01M8.2 14.2h.01M11 13.4h.01" stroke-width="2.2"/>`;
    case "mist": return `<path d="M2.5 5.5h9M4.5 8.5h9M2.5 11.5h9"/>`;
  }
}

/** What the tooltip says about each. */
const SAY: Record<WeatherKind, string> = {
  clear: "Clear skies.",
  fair: "Fair, a few clouds.",
  overcast: "Overcast.",
  showers: "Passing showers.",
  rain: "Rain.",
  clearing: "Clearing after rain: the roads are drying.",
  mist: "Morning mist. It lifts by mid-morning.",
  snow: "Snow falling.",
};

export class WeatherChip {
  readonly el: HTMLElement;
  private shown = "";

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "wx";
    this.el.setAttribute("role", "img");
  }

  /** Put it just before the clock (once the HUD has built its bar). */
  mount(clock: Element | null) {
    if (clock?.parentElement && this.el.parentElement !== clock.parentElement) clock.parentElement.insertBefore(this.el, clock);
  }

  /** Every frame; writes only when the weather's word or the day/night glyph changes. */
  update(kind: WeatherKind, night: boolean) {
    const key = `${kind}|${night && (kind === "clear" || kind === "fair" || kind === "clearing") ? "n" : "d"}`;
    if (key === this.shown) return;
    this.shown = key;
    const name = WEATHER_NAME[kind];
    this.el.dataset.k = kind;
    this.el.classList.toggle("night", key.endsWith("n"));
    this.el.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${glyph(kind, night)}</svg><span>${name}</span>`;
    const say = `${SAY[kind]} The weather is only for the look and sound: it never slows a truck or changes a route.`;
    this.el.title = say;
    this.el.setAttribute("aria-label", `Weather: ${say}`);
  }
}
