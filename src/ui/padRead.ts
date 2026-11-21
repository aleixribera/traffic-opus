// A game controller, read the way the game wants it (ui/gamepad.ts drives the game with it). Pure: the browser's
// pads go in, one pad's presses and sticks come out, so the rules are a test (tests/gamepad.test.ts).
//
// The "standard" mapping (a PS4 DualShock in Chrome and Firefox, and the Xbox pad Steam adds beside it):
// 0 Cross, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 8 Share, 9 Options, 10 L3, 11 R3,
// 12-15 d-pad up, down, left, right, 16 PS. Axes 0/1 the left stick, 2/3 the right one.

export const B = {
  cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7,
  share: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16,
} as const;
export type ButtonName = keyof typeof B;

/** The part of a browser Gamepad this reads (so a test can hand in plain objects). */
export interface PadLike {
  index: number;
  connected: boolean;
  mapping?: string;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

/** Under this a stick is at rest (worn DualShocks drift to ~0.1). */
export const DEAD = 0.2;
/** A trigger counts as pressed from here (L2 / R2 are analog). */
const TRIGGER_ON = 0.35;
/** A held direction repeats after this long, then every REPEAT_MS (menus). */
export const REPEAT_DELAY_MS = 380;
export const REPEAT_MS = 110;

/** A stick's axis past the dead zone, rescaled so it starts from 0 at the edge of the zone. */
export function deadzone(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
}

export interface PadFrame {
  /** the pad followed now, or null when none is connected */
  index: number | null;
  /** went down this frame */
  pressed: Set<number>;
  /** went up this frame */
  released: Set<number>;
  /** held now */
  held: Set<number>;
  /** sticks past the dead zone: left x, y; right x, y */
  lx: number; ly: number; rx: number; ry: number;
  /** triggers 0..1 */
  l2: number; r2: number;
  /** a menu direction this frame (d-pad or left stick, with repeat), or null */
  nav: "up" | "down" | "left" | "right" | null;
  /** anything on the followed pad moved or was pressed this frame */
  active: boolean;
}

const pressedOf = (p: PadLike, i: number): boolean => {
  const b = p.buttons[i];
  if (!b) return false;
  return i === B.l2 || i === B.r2 ? b.pressed || b.value > TRIGGER_ON : b.pressed;
};

/** A pad's button pressed just before switching to another pad still counts as the same press this long. */
const ECHO_MS = 150;

/**
 * Reads the pads each frame. It follows the pad used last: Steam can add a virtual Xbox pad beside the real one, and
 * either may be index 0. A pad only takes over when it is used (a button or a stick), so an idle twin never steals it.
 */
export class PadReader {
  private follow: number | null = null;
  private prev = new Map<number, Set<number>>();
  private navDir: PadFrame["nav"] = null;
  private navNext = 0;
  /** each pad's axes when first seen: a device without the standard mapping is read from where it rests */
  private rest = new Map<number, readonly number[]>();
  /** when the followed pad last pressed each button (a twin's echo of it a frame later is no new press) */
  private pressT = new Map<number, number>();

  /** An axis as read: from rest for a device without the standard mapping (its triggers may rest at -1). */
  private axis(p: PadLike, a: number): number {
    const v = p.axes[a] ?? 0;
    return p.mapping === "standard" ? v : v - (this.rest.get(p.index)?.[a] ?? 0);
  }

  /** Is this pad being used: a button down or a stick off centre (what makes it the one followed). */
  private inUse(p: PadLike): boolean {
    for (let i = 0; i < p.buttons.length; i++) if (pressedOf(p, i)) return true;
    for (let a = 0; a + 1 < p.axes.length && a < 4; a += 2) {
      const [x, y] = deadzone(this.axis(p, a), this.axis(p, a + 1));
      if (x || y) return true;
    }
    return false;
  }

  read(pads: readonly (PadLike | null | undefined)[], now: number): PadFrame {
    let live = pads.filter((p): p is PadLike => !!p && p.connected);
    // (a pad with the standard mapping wins over any other device: a throttle or pedals never drive the game;
    // without one, the others are read from where they rest)
    if (live.some((p) => p.mapping === "standard")) live = live.filter((p) => p.mapping === "standard");
    for (const p of live) if (!this.rest.has(p.index)) this.rest.set(p.index, [...p.axes]);
    // the pad that changed most recently wins: one with a new press, else one in use while the followed one is idle
    // (a twin that mirrors the followed pad, as Steam's virtual one does, presses in the same frame: the followed one
    // keeps it, so the two never swap on every press)
    let fresh: PadLike | null = null, curPressed = false;
    for (const p of live) {
      const was = this.prev.get(p.index) ?? new Set<number>();
      let newPress = false;
      for (let i = 0; i < p.buttons.length; i++) if (pressedOf(p, i) && !was.has(i)) newPress = true;
      if (newPress && p.index === this.follow) curPressed = true;
      else if (newPress && !fresh) fresh = p;
    }
    const cur = live.find((p) => p.index === this.follow) ?? null;
    const was0 = this.follow;
    if (fresh && !curPressed) this.follow = fresh.index;
    else if (!cur || !this.inUse(cur)) {
      const other = live.find((p) => p.index !== this.follow && this.inUse(p));
      if (other) this.follow = other.index;
      else if (!cur) this.follow = live[0]?.index ?? null;
    }
    const pad = live.find((p) => p.index === this.follow) ?? null;
    const out: PadFrame = {
      index: pad?.index ?? null, pressed: new Set(), released: new Set(), held: new Set(),
      lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0, nav: null, active: false,
    };
    // (every pad's buttons are remembered, so switching pads mid-press never reads a held button as a new press)
    for (const p of live) {
      const now2 = new Set<number>();
      for (let i = 0; i < p.buttons.length; i++) if (pressedOf(p, i)) now2.add(i);
      if (p === pad) {
        const was = new Set(this.prev.get(p.index));
        // (just switched from another pad: what that one held, or pressed a moment ago, is the same press echoed)
        if (was0 !== null && was0 !== p.index) {
          for (const i of this.prev.get(was0) ?? []) was.add(i);
          for (const [i, t] of this.pressT) if (now - t < ECHO_MS) was.add(i);
        }
        for (const i of now2) if (!was.has(i)) { out.pressed.add(i); this.pressT.set(i, now); }
        for (const i of was) if (!now2.has(i)) out.released.add(i);
        out.held = now2;
      }
      this.prev.set(p.index, now2);
    }
    for (const k of [...this.prev.keys()]) if (!live.some((p) => p.index === k)) { this.prev.delete(k); this.rest.delete(k); }
    if (!pad) { this.navDir = null; return out; }
    [out.lx, out.ly] = deadzone(this.axis(pad, 0), this.axis(pad, 1));
    [out.rx, out.ry] = deadzone(this.axis(pad, 2), this.axis(pad, 3));
    // (a pad that reports its triggers only as pressed, with no value, reads as all the way)
    const trig = (i: number) => { const b = pad.buttons[i]; return !b ? 0 : b.value > 0 ? b.value : b.pressed ? 1 : 0; };
    out.l2 = trig(B.l2);
    out.r2 = trig(B.r2);
    if (out.l2 < 0.08) out.l2 = 0;
    if (out.r2 < 0.08) out.r2 = 0;
    // (a press or a stick: a button merely still held, as on a device that never lets go, wakes nothing)
    out.active = out.pressed.size > 0 || !!(out.lx || out.ly || out.rx || out.ry || out.l2 || out.r2);
    // one menu direction: the d-pad first, else the left stick pushed well over (half way), the stronger axis
    const held = out.held;
    let dir: PadFrame["nav"] = held.has(B.up) ? "up" : held.has(B.down) ? "down" : held.has(B.left) ? "left" : held.has(B.right) ? "right" : null;
    if (!dir) {
      const x = this.axis(pad, 0), y = this.axis(pad, 1);
      if (Math.max(Math.abs(x), Math.abs(y)) > 0.5) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
    }
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navNext = now + REPEAT_DELAY_MS;
      out.nav = dir;
    } else if (dir && now >= this.navNext) {
      this.navNext = now + REPEAT_MS;
      out.nav = dir;
    }
    return out;
  }
}

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * The next thing to focus from `from` in a direction, among `boxes` (screen rectangles): the nearest one that lies
 * that way, an overlapping row or column first. Returns its index, or -1 when there is none that way.
 */
export function pickDir(from: Box, boxes: readonly Box[], dir: "up" | "down" | "left" | "right"): number {
  const fcx = (from.left + from.right) / 2, fcy = (from.top + from.bottom) / 2;
  let best = -1, bestScore = Infinity;
  boxes.forEach((b, i) => {
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    let along: number, across: number, overlap: boolean;
    if (dir === "left" || dir === "right") {
      const s = dir === "right" ? 1 : -1;
      if ((cx - fcx) * s <= 2) return;
      along = Math.max(0, s > 0 ? b.left - from.right : from.left - b.right);
      overlap = b.top < from.bottom - 1 && b.bottom > from.top + 1;
      across = overlap ? 0 : Math.abs(cy - fcy);
    } else {
      const s = dir === "down" ? 1 : -1;
      if ((cy - fcy) * s <= 2) return;
      along = Math.max(0, s > 0 ? b.top - from.bottom : from.top - b.bottom);
      overlap = b.left < from.right - 1 && b.right > from.left + 1;
      // (in a column of rows, the one most under the focus: its centre's offset breaks ties)
      across = overlap ? Math.abs(cx - fcx) * 0.05 : Math.abs(cx - fcx);
    }
    const score = along + across * 2.5 + (overlap ? 0 : 40);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/**
 * The interface's words for a mouse, said for the pad: "Click a junction" is "Press ✕ on a junction" with the pad in
 * hand. Pure (tests/gamepad.test.ts).
 */
export function padWords(s: string): string {
  return s
    .replace(/\b([Rr])ight[- ]click(s|ed)?\b/g, (_m, r: string) => (r === "R" ? "Press ○" : "press ○"))
    .replace(/\b([Cc])lick(?:s|ed)? (a|an|the|it|one|them|stops|stop|its|this)\b/g, (_m, c: string, w: string) => `${c === "C" ? "Press" : "press"} ✕ on ${w}`)
    .replace(/\b([Cc])lick(s|ed)?\b/g, (_m, c: string) => (c === "C" ? "Press ✕" : "press ✕"));
}
