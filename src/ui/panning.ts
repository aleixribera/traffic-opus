// Moving the map without the mouse (review 2026-11-10, Camera 1 and 2):
// - the keys' speed, a share of the screen a second at every zoom, speeding up while held;
// - edge scrolling: the pointer held against an edge of the window moves the map that way, as in Cities: Skylines
//   and Transport Fever. Off unless the player turns it on in the pause menu: in a window (not full screen) the
//   pointer crosses the edges all the time on its way to other things.
//
// Pure but for the setting's storage, so it is tested on its own (tests/panning.test.ts).

/**
 * How fast the keys move the map, in screen heights a second, after `held` seconds: a third of the screen at first,
 * so a tap is a small step, speeding up over a second and a half to a screen a second for crossing the map.
 */
export function panRate(held: number): number {
  const r = Math.min(1, Math.max(0, held) / 1.5);
  return 0.32 + 0.68 * r * r;
}

/** Where the setting is kept (the game's localStorage prefix). */
export const EDGE_KEY = "flowtown.edgeScroll";

/** How close to an edge the pointer must be (CSS pixels) for the map to move, at full push on the edge itself. */
export const EDGE_ZONE = 12;

export function loadEdgeScroll(): boolean {
  try {
    return localStorage.getItem(EDGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveEdgeScroll(on: boolean) {
  try { localStorage.setItem(EDGE_KEY, on ? "on" : "off"); } catch { /* private window: the setting lasts the session */ }
}

/**
 * Which way, and how hard, the pointer at (x, y) in a w x h window pushes the map: each of x and y from -1 (left,
 * up) to 1 (right, down), 0 away from the edges. Full on the outermost pixels, easing to nothing EDGE_ZONE in.
 */
export function edgePush(x: number, y: number, w: number, h: number, zone = EDGE_ZONE): { x: number; y: number } {
  const one = (p: number, size: number) => {
    if (!(size > zone * 4)) return 0;
    const lo = 1 - p / zone, hi = 1 - (size - 1 - p) / zone;
    return Math.min(1, Math.max(0, hi)) - Math.min(1, Math.max(0, lo));
  };
  return { x: one(x, w), y: one(y, h) };
}

/** The pause menu's Edge scrolling switch. */
export function wireEdgeScroll(b: HTMLButtonElement | null, get: () => boolean, set: (on: boolean) => void, click: () => void) {
  if (!b) return;
  const show = () => {
    const on = get();
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(on));
    b.innerHTML = `Edge scrolling<span class="pm-v">${on ? "On" : "Off"}</span>`;
    b.title = "The pointer against an edge of the window moves the map. Click to change.";
  };
  b.onclick = () => {
    click();
    set(!get());
    show();
  };
  show();
}
