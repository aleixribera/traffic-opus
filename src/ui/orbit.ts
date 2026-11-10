// The drag that turns and tilts the camera (the middle button, the camera block), as pure maths: which part of each
// mouse step turns the map and which part tilts it.
//
// Sideways turns, up and down tilts, and a hand never moves in a dead straight line. So each of the two only starts
// once the drag has clearly gone its way: a few pixels of travel that the other direction does not explain. A sideways
// drag that wanders up or down a little never moves the pitch; a drag up or down never turns the map; a diagonal drag
// starts both. Once started a direction follows the hand one to one (no dead zone when it turns back), and lets go
// again after a clear stretch of the drag going the other way only.

/** One direction of the drag: whether it has started, the travel gathered toward starting, and the run against it. */
interface Gate { on: boolean; acc: number; run: number }

export interface OrbitDrag {
  /** how far the drag has gone, in pixels (right and down positive) */
  ax: number;
  ay: number;
  turn: Gate;
  tilt: Gate;
}

export const newOrbit = (): OrbitDrag => ({ ax: 0, ay: 0, turn: { on: false, acc: 0, run: 0 }, tilt: { on: false, acc: 0, run: 0 } });

/** Travel before a turn starts, and before a tilt does (px): the tilt is the one that must not happen by accident. */
const TURN_SLACK = 5;
const TILT_SLACK = 12;
/** How much of the other direction's travel is taken as wander (a drag flatter than this slope is "sideways"). */
const LEAN = 0.45;
/** A direction lets go after this much travel (px, already scaled by LEAN) of the drag going the other way only. */
const RELEASE = 22;
/** The Map view is harder to tip: more travel, and the drag must go more up than across. */
const MAP_SLACK = 26;
const MAP_LEAN = 1;

function gate(g: Gate, along: number, across: number, slack: number, lean: number): number {
  const wander = Math.abs(across) * lean;
  if (g.on) {
    g.run = Math.max(0, g.run + wander - Math.abs(along));
    if (g.run <= RELEASE) return along;
    g.on = false; g.acc = 0; g.run = 0;
    return 0;
  }
  g.acc = Math.sign(g.acc) * Math.max(0, Math.abs(g.acc) - wander) + along;
  if (Math.abs(g.acc) < slack) return 0;
  // (it starts: only the travel past the slack moves the camera, so nothing jumps)
  const out = g.acc - Math.sign(g.acc) * slack;
  g.on = true; g.acc = 0; g.run = 0;
  return out;
}

/**
 * One step of the drag, (dx, dy) pixels: how many pixels of it turn the camera and how many tilt it. `map` is the
 * Map view, straight down: there only a drag that plainly goes up the screen starts a tilt.
 */
export function orbitStep(o: OrbitDrag, dx: number, dy: number, map = false): { turn: number; tilt: number } {
  o.ax += dx;
  o.ay += dy;
  const turn = gate(o.turn, dx, dy, TURN_SLACK, LEAN);
  let tilt = gate(o.tilt, dy, dx, map ? MAP_SLACK : TILT_SLACK, map ? MAP_LEAN : LEAN);
  // (straight down is as high as the camera goes: a drag down from there starts nothing)
  if (map && tilt > 0) { tilt = 0; o.tilt.on = false; }
  return { turn, tilt };
}
