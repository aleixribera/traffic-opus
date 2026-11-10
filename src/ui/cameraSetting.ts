// The Camera setting: which of the game's two views a game opens in and the camera comes back to. Diorama is the
// tilted view, Map looks straight down. It is kept in localStorage, with the Diorama's own pitch and the turn the
// player left the map at, so all three hold across games and reloads.
//
// M flips between the two during play, and it is this same setting it flips: the pause menu's button always says
// what is on screen. Pitching the camera by hand (the pitch keys, the camera control) all the way up to straight
// down makes it the Map view, and pitching down from the Map view makes it the Diorama again.

import { TILT_DEFAULT, TILT_MAX } from "../render/viewmath";

export type CameraView = "diorama" | "map";

export const CAMERA_VIEWS: { id: CameraView; name: string; blurb: string }[] = [
  { id: "diorama", name: "Diorama", blurb: "The tilted view: buildings, bridges and trucks stand up off the ground. Far out it flattens into a map" },
  { id: "map", name: "Map", blurb: "Straight down, like a map. Nothing tilts unless you tilt it" },
];

export const CAMERA_KEY = "flowtown.camera";
export const TILT_KEY = "flowtown.cameraTilt";
export const TURN_KEY = "flowtown.cameraTurn";

/** The least pitch the Diorama is remembered at (radians): flatter than this and M would seem to do nothing. */
export const TILT_MIN = (12 * Math.PI) / 180;

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window: the setting lasts the session */ } };

export function loadCameraView(): CameraView {
  return read(CAMERA_KEY) === "map" ? "map" : "diorama";
}
export function saveCameraView(v: CameraView) {
  write(CAMERA_KEY, v);
}

/** The Diorama's pitch as the player left it (radians from straight down). */
export function loadTilt(): number {
  const v = Number(read(TILT_KEY));
  return Number.isFinite(v) && v >= TILT_MIN - 1e-6 && v <= TILT_MAX + 1e-6 ? v : TILT_DEFAULT;
}
export function saveTilt(t: number) {
  write(TILT_KEY, t.toFixed(4));
}

/** The turn the player left the map at (radians; 0: north up). */
export function loadTurn(): number {
  const s = read(TURN_KEY), v = Number(s);
  return s !== null && Number.isFinite(v) && Math.abs(v) <= Math.PI + 1e-6 ? v : 0;
}
export function saveTurn(r: number) {
  write(TURN_KEY, r.toFixed(4));
}

/**
 * Wire a pause-menu button to the setting: it shows the current choice (as the Nights button does) and each click
 * switches to the other view, at once.
 */
export function wireCamera(b: HTMLButtonElement | null, get: () => CameraView, set: (v: CameraView) => void, click: () => void): () => void {
  if (!b) return () => {};
  const show = () => {
    const m = CAMERA_VIEWS.find((x) => x.id === get()) ?? CAMERA_VIEWS[0];
    b.innerHTML = `Camera <span class="muted">· ${m.name}</span>`;
    b.title = `${m.blurb}. Click to change (M).`;
    b.setAttribute("aria-label", `Camera: ${m.name}. ${m.blurb}. Click to change.`);
  };
  b.onclick = () => {
    click();
    const i = CAMERA_VIEWS.findIndex((x) => x.id === get());
    set(CAMERA_VIEWS[(i + 1) % CAMERA_VIEWS.length].id);
    show();
  };
  show();
  return show;
}
