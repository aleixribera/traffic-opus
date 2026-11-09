// The scroll wheel and the touchpad (owner, 2026-11-09: "playable smoothly on touchpad"), as Google Maps and Figma
// read them: a mouse wheel zooms on the cursor in notches, two fingers on a touchpad move the map 1:1 (the
// operating system's own inertia comes along as more wheel events), and a pinch (Chrome and Edge send it as a wheel
// event with ctrlKey) zooms on the cursor in proportion to the fingers. Which device sent an event is guessed from
// the event, once per gesture, so a gesture never flips between moving and zooming halfway; the Scroll wheel
// setting (pause menu) can force either reading for a wheel the guess gets wrong.
//
// Pure: nothing here touches the DOM or the view, so it is tested on its own (tests/wheel.test.ts). App's wheel
// handler feeds events in and applies what comes out.

/** The Scroll wheel setting: Auto guesses the device; Zoom always zooms (the old way); Pan always moves the map. */
export type WheelMode = "auto" | "zoom" | "pan";
export const WHEEL_MODES: { id: WheelMode; name: string; blurb: string }[] = [
  { id: "auto", name: "Auto", blurb: "A mouse wheel zooms, two fingers on a touchpad move the map, a pinch zooms" },
  { id: "zoom", name: "Zoom", blurb: "Scrolling always zooms on the cursor; a pinch zooms too" },
  { id: "pan", name: "Pan", blurb: "Scrolling always moves the map; Ctrl + scroll or a pinch zooms" },
];
/** Where the setting is kept (the game's localStorage prefix). */
export const WHEEL_KEY = "flowtown.scrollWheel";

export function loadWheelMode(): WheelMode {
  try {
    const v = localStorage.getItem(WHEEL_KEY);
    return v === "zoom" || v === "pan" || v === "auto" ? v : "auto";
  } catch {
    return "auto";
  }
}
export function saveWheelMode(m: WheelMode) {
  try { localStorage.setItem(WHEEL_KEY, m); } catch { /* private window: the setting lasts the session */ }
}

/** The parts of a WheelEvent the reading needs (a plain object in the tests). */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages */
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey?: boolean;
  /** ms (Event.timeStamp) */
  timeStamp: number;
}

/** The device an event most likely came from. */
export type WheelDevice = "mouse" | "touchpad" | "pinch";
/** What an event does to the camera: zoom in notches (mouse), move the map (touchpad), zoom with the fingers (pinch). */
export type WheelAct = "zoom" | "pan" | "pinch";

/** A mouse notch is at least this many pixels (Chrome and Edge: 100 or 120, more with display scaling). */
const NOTCH_MIN = 50;
/** A step this big is a mouse notch even when fractional. */
const NOTCH_BIG = 96;
/** Events closer together than this (ms) belong to one gesture: a touchpad's stream and its inertia, a wheel spun. */
export const GESTURE_GAP = 220;

const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-3;

/**
 * Which device one event looks like it came from, on its own. ctrlKey is a pinch (unless the event looks like a mouse
 * notch: Ctrl + mouse wheel); lines or pages are a mouse wheel; whole pixel steps of 50 or more with no sideways part
 * are a mouse wheel; anything else (small or fractional steps, any sideways part) is a touchpad.
 */
export function wheelDevice(e: WheelSample): WheelDevice {
  // (Edge's percent-based scrolling can make a notch fractional, ~100 px or more: a step that big is a notch too; a
  // touchpad's gesture starts with small steps, and the first event decides the gesture: WheelReader)
  const ay = Math.abs(e.deltaY);
  const notch = e.deltaMode !== 0 || (e.deltaX === 0 && ((ay >= NOTCH_MIN && whole(e.deltaY)) || ay >= NOTCH_BIG));
  if (e.ctrlKey) return notch ? "mouse" : "pinch";
  // (Shift + mouse wheel arrives sideways in Chrome: a whole notch of deltaX with no deltaY is still a notch)
  if (!notch && e.shiftKey && e.deltaY === 0 && e.deltaMode === 0 && Math.abs(e.deltaX) >= NOTCH_MIN && whole(e.deltaX)) return "mouse";
  return notch ? "mouse" : "touchpad";
}

/**
 * Reads wheel events into camera acts, deciding once per gesture: the first event of a gesture (after a pause of
 * GESTURE_GAP, or when Ctrl goes down or up) sets what the whole gesture does.
 */
export class WheelReader {
  mode: WheelMode;
  private act: WheelAct | null = null;
  private lastT = -Infinity;
  private lastCtrl = false;

  constructor(mode: WheelMode = "auto") {
    this.mode = mode;
  }

  /** The act for one event (sticky within its gesture). */
  read(e: WheelSample): WheelAct {
    const fresh = this.act === null || e.timeStamp - this.lastT > GESTURE_GAP || e.ctrlKey !== this.lastCtrl;
    this.lastT = e.timeStamp;
    this.lastCtrl = e.ctrlKey;
    if (!fresh) return this.act!;
    const dev = wheelDevice(e);
    let act: WheelAct;
    if (dev === "pinch") act = "pinch";
    else if (e.ctrlKey) act = "zoom"; // Ctrl + mouse wheel: zoom in notches, in every mode
    else if (this.mode === "zoom") act = "zoom"; // (a touchpad's small steps zoom in proportion: the old way)
    else if (this.mode === "pan") act = "pan";
    else act = dev === "mouse" ? "zoom" : "pan";
    this.act = act;
    return act;
  }

  /** Forget the gesture (the next event starts a new one). */
  reset() {
    this.act = null;
    this.lastT = -Infinity;
  }
}

/** Pixels per line and per page, for events that count in those. */
const LINE_PX = 33;

/** An event's movement in CSS pixels (lines and pages turned into pixels). */
export function wheelPixels(e: WheelSample, pageH: number): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/** A mouse notch's zoom: about 1.25x per notch (the size of a notch hardly matters), as before. */
const NOTCH_ZOOM = 0.0022;
/** A pinch: Chrome sends about 100 px of deltaY per e-fold of finger spread; the view follows the fingers. */
const PINCH_ZOOM = 0.01;
/** (one pinch event never zooms more than this e-fold: a stray huge delta) */
const PINCH_MAX = 0.5;

/**
 * How much one event scales the view's half height (above 1: out; below: in). Zoom: notches; pinch: in proportion
 * to the delta, so the map follows the fingers.
 */
export function wheelZoomFactor(e: WheelSample, act: "zoom" | "pinch", pageH = 800): number {
  const { dy } = wheelPixels(e, pageH);
  if (act === "zoom") return Math.exp(Math.sign(dy) * Math.min(Math.abs(dy), 120) * NOTCH_ZOOM);
  const k = Math.max(-PINCH_MAX, Math.min(PINCH_MAX, dy * PINCH_ZOOM));
  return Math.exp(k);
}

/**
 * How far one pan event drags the map, in CSS pixels, as a pointer drag would (View.pan): fingers moving up the pad
 * scroll the page down (deltaY > 0), and the map slides up under the screen the same distance.
 */
export function wheelPan(e: WheelSample, pageH = 800): { dx: number; dy: number } {
  const { dx, dy } = wheelPixels(e, pageH);
  return { dx: -dx, dy: -dy };
}

/**
 * Whether a press has become a drag, from how far it has gone (px) and for how long (ms). A tap on a touchpad (or a
 * quick click) wanders a few pixels as the finger lifts: within the first 180 ms a press must go 12 px to count as a
 * drag, after that 5 (a mouse) or 10 (a finger on a touch screen).
 */
export function dragStarted(dist: number, ms: number, pointerType: string): boolean {
  if (pointerType === "touch") return dist > 10;
  return dist > (ms < 180 ? 12 : 5);
}
