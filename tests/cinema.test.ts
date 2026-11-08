// The camera's automatic modes (render/cinema.ts): follow damping, the follow's hand-off when its vehicle goes, the
// tour's spots and their weighting by activity, shots that never repeat a place, the fades, and the vehicle cam's picks.

import { describe, expect, it } from "vitest";
import {
  FADE, FollowCam, FollowSession, RIDE_LEN, SHOT_LEN, ShotHistory, Spring2, cutShort, evalShot, fadeAt, gatherSpots, nearestRide,
  pickRide, pickSpot, planRide, planShot, samePlace, successorOf,
  type CamVehicle, type Pose, type RideCandidate, type SpotInputs,
} from "../src/render/cinema";

/** a small seeded random (mulberry32), so the picks are the same every run */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const empty = (): SpotInputs => ({ vehicles: [], junctions: [], towns: [], sites: [], convoys: [], bridges: [], events: [] });

describe("follow damping", () => {
  it("closes on a still target without overshoot or blow-up at any time step", () => {
    for (const dt of [1 / 144, 1 / 60, 0.1, 0.5, 2, 30]) {
      const s = new Spring2(4);
      s.reset(100, -40);
      let d = Math.hypot(s.x, s.y);
      for (let t = 0; t < 12; t += dt) {
        s.step(0, 0, dt);
        const nd = Math.hypot(s.x, s.y);
        expect(Number.isFinite(nd)).toBe(true);
        expect(nd).toBeLessThanOrEqual(d + 1e-9);
        // never past the target (critically damped from rest)
        expect(s.x).toBeGreaterThanOrEqual(-1e-9);
        d = nd;
      }
      expect(d).toBeLessThan(1e-3);
    }
  });

  it("follows a moving vehicle smoothly at every game speed, even with uneven frames", () => {
    const frames = [1 / 60, 1 / 60, 0.1, 1 / 30, 1 / 144, 0.25, 1 / 60, 0.1];
    for (const gameSpeed of [1, 2, 4]) {
      const cam = new FollowCam();
      const v = 15 * gameSpeed; // m/s on screen
      let x = 0;
      cam.start(-300, 40, 0, 0);
      let px = cam.x;
      for (let i = 0; i < 600; i++) {
        const dt = frames[i % frames.length];
        x += v * dt;
        cam.step(x, 0, 1, 0, v, 150, dt);
        // once it has caught up, the camera never moves backwards and keeps the truck in the frame, a little behind
        if (i > 120) {
          expect(cam.x).toBeGreaterThanOrEqual(px - 1e-6);
          expect(cam.x - x).toBeGreaterThanOrEqual(0);
          expect(cam.x - x).toBeLessThanOrEqual(150 * cam.leadMax + 1e-6);
          expect(Math.abs(cam.y)).toBeLessThan(1);
        }
        px = cam.x;
      }
      // the look-ahead is ahead of the truck along its heading
      expect(cam.x - x).toBeGreaterThan(5);
    }
  });

  it("settles back onto a stopped vehicle (a hold), even across a long frame hitch", () => {
    const cam = new FollowCam();
    cam.start(0, 0, 0, 0);
    for (let i = 0; i < 200; i++) cam.step(i * 0.25, 0, 1, 0, 15, 150, 1 / 60);
    const stop = 199 * 0.25;
    cam.step(stop, 0, 1, 0, 0, 150, 0.1);
    cam.step(stop, 0, 1, 0, 0, 150, 3);
    for (let i = 0; i < 300; i++) cam.step(stop, 0, 1, 0, 0, 150, 1 / 60);
    expect(Math.abs(cam.x - stop)).toBeLessThan(0.5);
  });
});

describe("following a vehicle that goes", () => {
  it("holds on the spot, then ends", () => {
    const s = new FollowSession(7, 4);
    for (let i = 0; i < 10; i++) expect(s.update(true, 0.1)).toBe("track");
    expect(s.update(false, 0.1)).toBe("hold");
    let t = 0;
    while (s.update(false, 0.1) === "hold") t += 0.1;
    expect(s.phase).toBe("done");
    expect(t).toBeGreaterThan(3.5);
    expect(t).toBeLessThan(4.5);
    // done stays done, even if the id turns up again
    expect(s.update(true, 0.1)).toBe("done");
  });

  it("moves on to the same truck's next run", () => {
    const s = new FollowSession(7, 4);
    s.update(true, 0.1);
    s.update(false, 0.1);
    s.update(false, 1);
    s.retarget(12);
    expect(s.id).toBe(12);
    expect(s.update(true, 0.1)).toBe("track");
  });

  it("finds that next run: home from the drop, or out again from home, in the same class", () => {
    const veh = (id: number, haul: CamVehicle["trip"]["haul"], startT: number): CamVehicle => ({ id, truck: true, v: 10, trip: { startT, haul } });
    const vs = [
      veh(1, { plant: 5, dest: 9, leg: "back", cls: "heavy" }, 90), // set off before it arrived: another truck
      veh(2, { plant: 6, dest: 9, leg: "back", cls: "heavy" }, 101), // another plant's
      veh(3, { plant: 5, dest: 9, leg: "back", cls: "light" }, 101), // another class
      veh(4, { plant: 5, dest: 8, leg: "back", cls: "heavy" }, 101), // from another drop
      veh(5, { plant: 5, dest: 9, leg: "back", cls: "heavy", big: "turbine" }, 101), // a convoy
      veh(6, { plant: 5, dest: 9, leg: "back", cls: "heavy" }, 100.2), // it
    ];
    expect(successorOf({ plant: 5, dest: 9, leg: "out", cls: "heavy", t: 100.1 }, vs)).toBe(6);
    expect(successorOf({ plant: 5, dest: 9, leg: "out", cls: "heavy", t: 100.1 }, vs.slice(0, 5))).toBe(null);
    // home again: the plant's next truck out in the class
    const out = [veh(9, { plant: 5, dest: 3, leg: "out", cls: "heavy" }, 200.5)];
    expect(successorOf({ plant: 5, dest: 9, leg: "back", cls: "heavy", t: 200 }, out)).toBe(9);
  });
});

describe("the tour's spots", () => {
  it("weights places by what is going on there now", () => {
    const inp = empty();
    inp.junctions.push({ id: 1, x: 0, y: 0, arms: 4 }, { id: 2, x: 3000, y: 0, arms: 4 });
    for (let i = 0; i < 20; i++) inp.vehicles.push({ x: (i % 5) * 8 - 16, y: Math.floor(i / 5) * 8 - 12 });
    const spots = gatherSpots(inp);
    const busy = spots.find((s) => s.key === "j1")!, quiet = spots.find((s) => s.key === "j2")!;
    expect(busy.w).toBeGreaterThan(quiet.w * 8);
    expect(quiet.w).toBeGreaterThan(0);
    // and the cluster of traffic itself is a spot
    expect(spots.some((s) => s.kind === "busy")).toBe(true);
  });

  it("keeps the busiest junctions only, and always offers a convoy on its way", () => {
    const inp = empty();
    for (let i = 0; i < 200; i++) inp.junctions.push({ id: i, x: i * 400, y: 0, arms: 3 });
    inp.convoys.push({ id: 77, x: 50, y: 50 });
    const spots = gatherSpots(inp);
    expect(spots.filter((s) => s.kind === "junction").length).toBeLessThanOrEqual(24);
    const c = spots.find((s) => s.kind === "convoy")!;
    expect(c.vehicle).toBe(77);
    expect(c.w).toBeGreaterThan(spots.find((s) => s.kind === "junction")!.w);
  });

  it("frames a big town wider than a hamlet, and a running site above an idle one", () => {
    const inp = empty();
    inp.towns.push({ id: 1, x: 0, y: 0, pop: 80 }, { id: 2, x: 5000, y: 0, pop: 9000 });
    inp.sites.push({ id: 3, x: 0, y: 4000, size: 110, level: 3, running: true }, { id: 4, x: 5000, y: 4000, size: 110, level: 3, running: false });
    const spots = gatherSpots(inp);
    const t1 = spots.find((s) => s.key === "t1")!, t2 = spots.find((s) => s.key === "t2")!;
    expect(t2.h).toBeGreaterThan(t1.h);
    expect(t2.w).toBeGreaterThan(t1.w);
    expect(spots.find((s) => s.key === "s3")!.w).toBeGreaterThan(spots.find((s) => s.key === "s4")!.w);
  });
});

describe("the tour's shots", () => {
  const map = () => {
    const inp = empty();
    for (let i = 0; i < 12; i++) inp.junctions.push({ id: i, x: (i % 4) * 900, y: Math.floor(i / 4) * 900, arms: 4 });
    inp.towns.push({ id: 1, x: 1300, y: 1300, pop: 2000 });
    // traffic piled round junction 0
    for (let i = 0; i < 40; i++) inp.vehicles.push({ x: (i % 7) * 6, y: Math.floor(i / 7) * 6 });
    for (let i = 0; i < 4; i++) inp.vehicles.push({ x: 1800 + i * 10, y: 900 });
    return gatherSpots(inp);
  };

  it("never shows the same place twice in a row, and favours the busy one", () => {
    const spots = map(), hist = new ShotHistory(), r = rng(3);
    const counts = new Map<string, number>();
    let last: { x: number; y: number; h: number; key: string } | null = null;
    for (let i = 0; i < 3000; i++) {
      const s = pickSpot(spots, hist, r)!;
      expect(s).not.toBeNull();
      if (last) expect(samePlace(s, last)).toBe(false);
      const shot = planShot(s, 0, last?.h ?? 0, r);
      last = { x: s.x, y: s.y, h: shot.from.h, key: s.key };
      hist.push(last);
      // (by place: the cluster of traffic is a spot of its own over junction 0)
      const place = `${Math.round(s.x / 450)},${Math.round(s.y / 450)}`;
      counts.set(place, (counts.get(place) ?? 0) + 1);
    }
    const busy = counts.get("0,0") ?? 0;
    const quietest = Math.min(...["6,0", "0,4", "6,4"].map((k) => counts.get(k) ?? 0));
    expect(busy).toBeGreaterThan(quietest * 3);
  });

  it("has nowhere to go when the only place is the one on screen", () => {
    const inp = empty();
    inp.towns.push({ id: 1, x: 0, y: 0, pop: 100 });
    const spots = gatherSpots(inp), hist = new ShotHistory();
    hist.push({ x: 0, y: 0, h: 200, key: "t1" });
    expect(pickSpot(spots, hist, rng(1))).toBeNull();
  });

  it("on a small map where everything is in sight, still alternates between things, farthest first", () => {
    const inp = empty();
    inp.towns.push({ id: 1, x: 0, y: 0, pop: 100 });
    inp.sites.push({ id: 2, x: 120, y: 0, size: 30, level: 1, running: true });
    inp.sites.push({ id: 3, x: 60, y: 0, size: 30, level: 1, running: true });
    const spots = gatherSpots(inp), hist = new ShotHistory(), r = rng(4);
    let lastKey = "";
    for (let i = 0; i < 40; i++) {
      const s = pickSpot(spots, hist, r)!;
      expect(s).not.toBeNull();
      expect(s.key).not.toBe(lastKey);
      lastKey = s.key;
      hist.push({ x: s.x, y: s.y, h: 200, key: s.key });
    }
    hist.push({ x: 0, y: 0, h: 200, key: "t1" });
    expect(pickSpot(spots, hist, r)!.key).toBe("s2");
  });

  it("plans slow 8-14 s moves with varied zoom, eased from the first pose to the last", () => {
    const r = rng(9);
    const spot = { kind: "junction" as const, x: 100, y: 200, h: 100, w: 1, key: "j" };
    const out: Pose = { x: 0, y: 0, h: 0, rot: 0 };
    const hs: number[] = [];
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      const s = planShot(spot, 0.3, prev, r);
      expect(s.dur).toBeGreaterThanOrEqual(SHOT_LEN[0]);
      expect(s.dur).toBeLessThanOrEqual(SHOT_LEN[1]);
      expect(evalShot(s, 0, out)).toBe(out);
      expect(out.x).toBeCloseTo(s.from.x);
      expect(out.h).toBeCloseTo(s.from.h);
      evalShot(s, s.dur, out);
      expect(out.x).toBeCloseTo(s.to.x);
      expect(out.h).toBeCloseTo(s.to.h);
      // slow: the frame moves under half its width over the shot
      expect(Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y)).toBeLessThan(s.from.h * (16 / 9) * 0.7 + 1);
      hs.push(s.from.h);
      prev = s.from.h;
    }
    // zoom variety: tight and wide shots both turn up
    expect(Math.max(...hs) / Math.min(...hs)).toBeGreaterThan(1.8);
  });

  it("fades out over the last 0.4 s of a shot and in over the next one's first 0.4 s", () => {
    const dur = 10;
    expect(fadeAt(0, dur)).toBe(1);
    expect(fadeAt(dur, dur)).toBe(1);
    expect(fadeAt(dur / 2, dur)).toBe(0);
    expect(fadeAt(FADE, dur)).toBe(0);
    expect(fadeAt(dur - FADE, dur)).toBe(0);
    expect(fadeAt(FADE / 2, dur)).toBeCloseTo(0.5);
    // a shot cut short (its vehicle gone) fades to black from where it is, never brighter first, even mid fade-in
    for (const t0 of [0, 0.1, 0.2, 0.39, 0.4, 3]) {
      const d = cutShort(t0);
      let prev = fadeAt(t0, dur);
      expect(fadeAt(t0, d)).toBeCloseTo(prev, 9);
      for (let t = t0; t <= d + 1e-9; t += 0.01) {
        const f = fadeAt(t, d);
        expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = f;
      }
      expect(fadeAt(d, d)).toBe(1);
    }
    // through black: about 0.8 s from clear to clear
    expect(2 * FADE).toBeCloseTo(0.8);
  });
});

describe("the vehicle cam", () => {
  const cands: RideCandidate[] = [
    { id: 1, x: 0, y: 0, truck: false, speed: 14 },
    { id: 2, x: 1000, y: 0, truck: true, cls: "light", speed: 12 },
    { id: 3, x: 2000, y: 0, truck: true, cls: "roadtrain", speed: 11 },
    { id: 4, x: 3000, y: 0, truck: true, cls: "roadtrain", speed: 0 },
    { id: 5, x: 4000, y: 0, truck: true, cls: "heavy", big: true, speed: 7 },
  ];

  it("prefers convoys and heavy trucks on the move, and never one it just rode with", () => {
    const r = rng(5), n = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const c = pickRide(cands, [5], null, r)!;
      expect(c.id).not.toBe(5);
      n.set(c.id, (n.get(c.id) ?? 0) + 1);
    }
    expect(n.get(3)!).toBeGreaterThan(n.get(2)!);
    expect(n.get(2)!).toBeGreaterThan(n.get(1)!);
    expect(n.get(3)!).toBeGreaterThan((n.get(4) ?? 0) * 5);
    const conv = new Map<number, number>();
    for (let i = 0; i < 2000; i++) { const c = pickRide(cands, [], null, r)!; conv.set(c.id, (conv.get(c.id) ?? 0) + 1); }
    expect(conv.get(5)!).toBeGreaterThan(conv.get(3)!);
    expect(pickRide(cands, [1, 2, 3, 4, 5], null, r)).toBeNull();
  });

  it("rides for 10-15 s each, close or medium", () => {
    const r = rng(2);
    for (let i = 0; i < 100; i++) {
      const s = planRide(3, i % 2 ? 50 : 120, r);
      expect(s.move).toBe("track");
      expect(s.vehicle).toBe(3);
      expect(s.dur).toBeGreaterThanOrEqual(RIDE_LEN[0]);
      expect(s.dur).toBeLessThanOrEqual(RIDE_LEN[1]);
      expect(s.from.h).toBeGreaterThan(30);
      expect(s.from.h).toBeLessThan(160);
    }
  });

  it("follows the truck nearest the middle of the screen, a moving one first", () => {
    expect(nearestRide(cands, 2600, 0, 5000)!.id).toBe(3); // the parked road train at 3000 counts double its distance
    expect(nearestRide(cands, 2900, 0, 5000)!.id).toBe(4); // (but not when it is right there)
    expect(nearestRide(cands, 50, 0, 5000)!.id).toBe(2); // cars don't count
    expect(nearestRide(cands, 50, 0, 100)).toBeNull();
  });
});
