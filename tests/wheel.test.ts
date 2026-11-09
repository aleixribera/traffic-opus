import { describe, expect, it } from "vitest";
import { GESTURE_GAP, WheelReader, dragStarted, wheelDevice, wheelPan, wheelZoomFactor, type WheelSample } from "../src/ui/wheel";
import { View } from "../src/render/view";

const ev = (deltaY: number, o: Partial<WheelSample> = {}): WheelSample => ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, timeStamp: 0, ...o });

/** A View without a renderer: just its camera numbers (the pan and zoom maths need nothing else). */
function view(cx = 1000, cy = 2000, halfH = 160, rot = 0, tilt = 0): View {
  const v = Object.create(View.prototype) as View;
  Object.assign(v, { cx, cy, halfH, rot, tilt, w: 1920, h: 1080, minHalfH: 28, maxHalfH: 30000 });
  return v;
}

describe("which device a wheel event came from", () => {
  it("reads mouse notches as a mouse", () => {
    expect(wheelDevice(ev(100))).toBe("mouse");
    expect(wheelDevice(ev(-120))).toBe("mouse");
    expect(wheelDevice(ev(250))).toBe("mouse"); // (two notches at once)
    expect(wheelDevice(ev(-102.4))).toBe("mouse"); // (Edge's percent-based scrolling: a fractional notch)
    expect(wheelDevice(ev(3, { deltaMode: 1 }))).toBe("mouse"); // lines (Firefox)
    expect(wheelDevice(ev(1, { deltaMode: 2 }))).toBe("mouse"); // pages
    // Shift + mouse wheel: Chrome sends the notch sideways
    expect(wheelDevice(ev(0, { deltaX: 100, shiftKey: true }))).toBe("mouse");
  });

  it("reads small, fractional or sideways steps as a touchpad", () => {
    expect(wheelDevice(ev(4))).toBe("touchpad");
    expect(wheelDevice(ev(-12.5))).toBe("touchpad");
    expect(wheelDevice(ev(63.75))).toBe("touchpad"); // a big but fractional step
    expect(wheelDevice(ev(100, { deltaX: 2 }))).toBe("touchpad"); // any sideways part
    expect(wheelDevice(ev(0, { deltaX: -7.2 }))).toBe("touchpad");
  });

  it("reads ctrlKey as a pinch, unless it is a mouse notch (Ctrl + wheel)", () => {
    expect(wheelDevice(ev(-3.4, { ctrlKey: true }))).toBe("pinch");
    expect(wheelDevice(ev(8, { ctrlKey: true }))).toBe("pinch");
    expect(wheelDevice(ev(100, { ctrlKey: true }))).toBe("mouse");
  });
});

describe("WheelReader: what each event does", () => {
  it("Auto: a mouse wheel zooms, a touchpad pans, a pinch pinches", () => {
    expect(new WheelReader("auto").read(ev(100))).toBe("zoom");
    expect(new WheelReader("auto").read(ev(4.5, { deltaX: 1.25 }))).toBe("pan");
    expect(new WheelReader("auto").read(ev(-2, { ctrlKey: true }))).toBe("pinch");
    expect(new WheelReader("auto").read(ev(100, { ctrlKey: true }))).toBe("zoom");
  });

  it("is sticky within a gesture: a touchpad flick's big whole steps still pan", () => {
    const r = new WheelReader("auto");
    const seq = [2.5, 6, 14.5, 60, 100, 120, 80, 40, 12, 3]; // a flick that peaks at mouse-like steps, then inertia
    const acts = seq.map((d, i) => r.read(ev(d, { timeStamp: i * 16 })));
    expect(new Set(acts)).toEqual(new Set(["pan"]));
  });

  it("is sticky within a gesture: a mouse spun fast keeps zooming", () => {
    const r = new WheelReader("auto");
    const acts = [100, 100, 100, 100].map((d, i) => r.read(ev(d, { timeStamp: i * 30 })));
    expect(acts).toEqual(["zoom", "zoom", "zoom", "zoom"]);
  });

  it("starts a new gesture after a pause, or when Ctrl goes down", () => {
    const r = new WheelReader("auto");
    expect(r.read(ev(5.5, { timeStamp: 0 }))).toBe("pan");
    expect(r.read(ev(100, { timeStamp: 50 }))).toBe("pan"); // same gesture
    expect(r.read(ev(100, { timeStamp: 50 + GESTURE_GAP + 1 }))).toBe("zoom"); // after a pause: the mouse
    expect(r.read(ev(-2.5, { timeStamp: 50 + GESTURE_GAP + 20, ctrlKey: true }))).toBe("pinch"); // Ctrl: a pinch begins
    expect(r.read(ev(-1, { timeStamp: 50 + GESTURE_GAP + 36, ctrlKey: true }))).toBe("pinch");
    r.reset();
    expect(r.read(ev(4, { timeStamp: 50 + GESTURE_GAP + 40 }))).toBe("pan");
  });

  it("the setting overrides the guess (Ctrl and a pinch still zoom)", () => {
    const zoom = new WheelReader("zoom");
    expect(zoom.read(ev(4.5, { timeStamp: 0 }))).toBe("zoom");
    expect(zoom.read(ev(100, { timeStamp: 1000 }))).toBe("zoom");
    expect(zoom.read(ev(-2, { timeStamp: 2000, ctrlKey: true }))).toBe("pinch");
    const pan = new WheelReader("pan");
    expect(pan.read(ev(100, { timeStamp: 0 }))).toBe("pan");
    expect(pan.read(ev(4.5, { timeStamp: 1000 }))).toBe("pan");
    expect(pan.read(ev(-2, { timeStamp: 2000, ctrlKey: true }))).toBe("pinch");
    expect(pan.read(ev(100, { timeStamp: 3000, ctrlKey: true }))).toBe("zoom");
    // changed mid-game: the next gesture reads the new way
    pan.mode = "auto";
    pan.reset();
    expect(pan.read(ev(100, { timeStamp: 4000 }))).toBe("zoom");
  });
});

describe("how far it zooms and pans", () => {
  it("a mouse notch zooms about 1.25x, as before; down is out", () => {
    expect(wheelZoomFactor(ev(100), "zoom")).toBeCloseTo(Math.exp(0.22), 6);
    expect(wheelZoomFactor(ev(-100), "zoom")).toBeCloseTo(Math.exp(-0.22), 6);
    expect(wheelZoomFactor(ev(3, { deltaMode: 1 }), "zoom")).toBeCloseTo(Math.exp(99 * 0.0022), 6);
  });

  it("a pinch zooms in proportion: halves add up to the whole", () => {
    const whole = wheelZoomFactor(ev(-20, { ctrlKey: true }), "pinch");
    const half = wheelZoomFactor(ev(-10, { ctrlKey: true }), "pinch");
    expect(whole).toBeLessThan(1); // fingers apart: in
    expect(half * half).toBeCloseTo(whole, 9);
    // (a stray huge delta is capped)
    expect(wheelZoomFactor(ev(5000, { ctrlKey: true }), "pinch")).toBeCloseTo(Math.exp(0.5), 9);
  });

  it("a touchpad pan drags the map the other way to the scroll", () => {
    expect(wheelPan(ev(12.5, { deltaX: -4 }))).toEqual({ dx: 4, dy: -12.5 });
    expect(wheelPan(ev(3, { deltaMode: 1 }))).toEqual({ dx: -0, dy: -99 });
  });

  it("the pan moves the camera by the scrolled pixels in metres at the current zoom", () => {
    for (const halfH of [50, 160, 2000]) {
      for (const rot of [0, 0.7]) {
        const v = view(1000, 2000, halfH, rot);
        const mpp = (2 * halfH) / v.h;
        const e = ev(30, { deltaX: 10 });
        const d = wheelPan(e);
        v.pan(d.dx, d.dy);
        // scrolled (10, 30) px on screen: the camera goes (10, 30) px further along the screen's axes, in metres
        const c = Math.cos(rot), s = Math.sin(rot);
        expect(v.cx - 1000).toBeCloseTo((10 * c - 30 * s) * mpp, 9);
        expect(v.cy - 2000).toBeCloseTo((10 * s + 30 * c) * mpp, 9);
        expect(Math.hypot(v.cx - 1000, v.cy - 2000)).toBeCloseTo(Math.hypot(10, 30) * mpp, 9);
      }
    }
  });

  it("at a tilt a pan still drags the ground with the pointer, pixel for pixel", () => {
    for (const tilt of [0.3, 0.7, 1.0]) {
      for (const rot of [0, 0.7]) {
        const v = view(1000, 2000, 160, rot, tilt);
        const g = v.screenToGround(700, 400);
        v.pan(10, 30);
        const s = v.worldToScreen(g.x, g.y);
        expect(s.x).toBeCloseTo(710, 6);
        expect(s.y).toBeCloseTo(430, 6);
      }
    }
  });

  it("a zoom stays anchored on the cursor (mouse and pinch, turned or not, tilted or not)", () => {
    for (const [e, act] of [[ev(100), "zoom"], [ev(-100), "zoom"], [ev(-7.5, { ctrlKey: true }), "pinch"], [ev(4, { ctrlKey: true }), "pinch"]] as const) {
      for (const [rot, tilt] of [[0, 0], [-1.1, 0], [0, 0.7], [-1.1, 1.0]]) {
        const v = view(1000, 2000, 300, rot, tilt);
        const px = 1500, py = 210;
        const before = v.screenToGround(px, py);
        const h0 = v.halfH;
        v.zoomAt(px, py, wheelZoomFactor(e, act));
        const after = v.screenToGround(px, py);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
        expect(v.halfH).not.toBeCloseTo(h0, 3);
      }
    }
  });

  it("many small pinch events zoom as far as one big one", () => {
    const a = view(), b = view();
    for (let i = 0; i < 20; i++) a.zoomAt(400, 300, wheelZoomFactor(ev(-2, { ctrlKey: true }), "pinch"));
    b.zoomAt(400, 300, wheelZoomFactor(ev(-40, { ctrlKey: true }), "pinch"));
    expect(a.halfH).toBeCloseTo(b.halfH, 6);
    expect(a.cx).toBeCloseTo(b.cx, 6);
    expect(a.cy).toBeCloseTo(b.cy, 6);
  });
});

describe("a press becoming a drag", () => {
  it("a quick touchpad tap that wanders a few pixels stays a click", () => {
    expect(dragStarted(8, 90, "mouse")).toBe(false);
    expect(dragStarted(11, 150, "mouse")).toBe(false);
    expect(dragStarted(14, 60, "mouse")).toBe(true); // a quick, real drag
  });
  it("after the first moment, 5 px is a drag (a mouse), 10 px on a touch screen", () => {
    expect(dragStarted(6, 400, "mouse")).toBe(true);
    expect(dragStarted(4, 400, "mouse")).toBe(false);
    expect(dragStarted(9, 400, "touch")).toBe(false);
    expect(dragStarted(11, 50, "touch")).toBe(true);
  });
});
