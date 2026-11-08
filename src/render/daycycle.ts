// The day and the year on the map, once a frame (docs/design.md, "Day and night, and the seasons' looks"): reads the
// clock (the sim's, the title menu's slow time-lapse, or a time set from the dev console), works out the light and
// the season's look (render/daylight.ts), and hands them to the two scene lights, the shared shader uniforms and the
// lamps layer. Also the Nights setting, and `window.__env`, the dev hook:
//   __env.set({ hour: 20, season: "winter", day: 6 })   freeze the look at a moment (any part may be left out)
//   __env.set({ speed: 40 })                             ...and let it run, 40 game seconds a second
//   __env.set({ mode: "soft" })                          try a Nights setting (not saved)
//   __env.clear()                                        back to the sim's own clock

import { DAY, HOUR, START_HOUR } from "../game/society";
import { SEASONS, SEASON_DAYS, START_YDAY, YEAR_DAYS, type Season } from "../game/calendar";
import { clockOf, lightAt, loadNightMode, saveNightMode, seasonLook, type Light, type NightMode, type SeasonLook } from "./daylight";
import { setEnv } from "./envShader";

/** The sim time at a day of the year (fractional: the hour is its fraction) in the first year. */
export const timeAtYday = (yday: number) => (yday - START_YDAY) * DAY - START_HOUR * HOUR;

/** The title menu's time-lapse: from an autumn afternoon, through its golden hour and a lamplit night, a day every two minutes. */
const MENU_START = timeAtYday(2 * SEASON_DAYS + 5 + 14.5 / 24);
const MENU_SPEED = DAY / 120;

export interface EnvSet { hour?: number; season?: Season | number; day?: number; yday?: number; speed?: number; mode?: NightMode }

export class DayCycle {
  /** The player's Nights setting. */
  mode: NightMode = loadNightMode();
  /** A dev override of the setting (not saved). */
  private devMode: NightMode | null = null;
  /** A look fixed from the console: its sim time, and how fast it runs on (game seconds a second). */
  private dev: { t: number; speed: number } | null = null;
  private menu: { t: number } | null = null;
  /** How far the map's light is lifted towards day for an overlay (eased). */
  private lift = 0;
  /** The moment last drawn. */
  hour = 12;
  yday = 0;
  light!: Light;
  look!: SeasonLook;

  setMode(m: NightMode) {
    this.mode = m;
    saveNightMode(m);
  }

  /** The time the map looks like (for the fields' season too): the dev's, the menu's, or the sim's. */
  lookTime(simTime: number): number {
    return this.dev?.t ?? this.menu?.t ?? simTime;
  }

  /** The console hook's set. */
  set(o: EnvSet) {
    const base = clockOf(this.lookTime(this.simTime));
    let yday = Math.floor(base.yday);
    if (o.yday !== undefined) yday = Math.floor(o.yday);
    if (o.season !== undefined || o.day !== undefined) {
      // (a season alone: its middle day; a day alone: that day of the season shown now; days count from 1)
      const si = o.season === undefined ? Math.floor(yday / SEASON_DAYS) : typeof o.season === "number" ? o.season : Math.max(0, SEASONS.indexOf(o.season));
      const d = o.day !== undefined ? o.day - 1 : o.season !== undefined ? SEASON_DAYS / 2 - 1 : yday % SEASON_DAYS;
      yday = si * SEASON_DAYS + Math.min(SEASON_DAYS - 1, Math.max(0, Math.round(d)));
    }
    const hour = o.hour ?? base.hour;
    this.dev = { t: timeAtYday(((yday % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS + hour / 24), speed: o.speed ?? this.dev?.speed ?? 0 };
    if (o.mode) this.devMode = o.mode;
  }

  clear() {
    this.dev = null;
    this.devMode = null;
  }

  private simTime = 0;

  /**
   * Once a frame: `simTime` the sim clock, `dt` real seconds, `menu` whether the title menu is up, `overlay` whether
   * a data overlay is on (it lifts the night so its colours read). Returns the light, which the caller hands on.
   */
  update(simTime: number, dt: number, menu: boolean, overlay: boolean): Light {
    this.simTime = simTime;
    if (menu) this.menu = { t: (this.menu?.t ?? MENU_START) + dt * MENU_SPEED };
    else this.menu = null;
    if (this.dev) this.dev.t += dt * this.dev.speed;
    const { hour, yday } = clockOf(this.lookTime(simTime));
    this.hour = hour;
    this.yday = yday;
    const mode = this.devMode ?? this.mode;
    let L = lightAt(hour, yday, mode);
    const S = seasonLook(yday);
    // autumn's light is a little warmer
    if (S.warm > 0) L.sun = [L.sun[0] * (1 + 0.06 * S.warm), L.sun[1] * (1 + 0.01 * S.warm), L.sun[2] * (1 - 0.1 * S.warm)];
    // an overlay lifts the night most of the way to day: its colours have to read
    this.lift += ((overlay ? 1 : 0) - this.lift) * Math.min(1, dt * 6);
    if (this.lift > 0.002 && mode !== "day") L = mixLight(L, lightAt(hour, yday, "day"), this.lift * 0.8);
    this.light = L;
    this.look = S;
    setEnv(L, S);
    return L;
  }
}

/** A light partway to another (`k` 0..1). */
export function mixLight(a: Light, b: Light, k: number): Light {
  const m = (x: number, y: number) => x + (y - x) * k;
  const m3 = (x: readonly number[], y: readonly number[]): [number, number, number] => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  const dir = m3(a.dir, b.dir);
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return {
    amb: m3(a.amb, b.amb), sun: m3(a.sun, b.sun), dir: [dir[0] / n, dir[1] / n, dir[2] / n],
    lamps: m(a.lamps, b.lamps), dark: m(a.dark, b.dark), shade: m(a.shade, b.shade), shadowLen: m(a.shadowLen, b.shadowLen),
    height: m(a.height, b.height),
  };
}
