import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cameraRig, footprint, groundBounds, groundRay, rayAt, screenToGround, shadowFit, worldToScreen,
  riseShare, risenTilt, CASTER_H, RISE_FROM, RISE_TO, TILT_DEFAULT, TILT_MAX, type ViewPose,
} from "../src/render/viewmath";

const deg = (d: number) => (d * Math.PI) / 180;
const pose = (o: Partial<ViewPose> = {}): ViewPose => ({ cx: 1200, cy: 900, halfH: 160, rot: 0, tilt: TILT_DEFAULT, w: 1600, h: 900, ...o });

const TILTS = [0, deg(15), TILT_DEFAULT, TILT_MAX];
const TURNS = [0, deg(30), deg(-75), deg(140), Math.PI];
const ZOOMS = [28, 160, 900, 12000];

/** The same projection, done by three.js: the camera the game really renders with. */
function threeScreen(v: ViewPose, x: number, y: number, h: number) {
  const rig = cameraRig(v);
  const halfW = v.halfH * (v.w / v.h);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, v.halfH, -v.halfH, rig.near, rig.far);
  cam.position.set(...rig.pos);
  cam.up.set(...rig.up);
  cam.lookAt(v.cx, 0, v.cy);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const p = new THREE.Vector3(x, h, y).project(cam);
  return { x: (p.x * 0.5 + 0.5) * v.w, y: (-p.y * 0.5 + 0.5) * v.h, z: p.z };
}

describe("the Diorama camera's maths", () => {
  it("straight down, it is the old top-down map", () => {
    const v = pose({ tilt: 0, rot: 0 });
    const m = (v.halfH * 2) / v.h;
    expect(screenToGround(v, 800, 450)).toEqual({ x: 1200, y: 900 });
    const p = screenToGround(v, 900, 500);
    expect(p.x).toBeCloseTo(1200 + 100 * m, 9);
    expect(p.y).toBeCloseTo(900 + 50 * m, 9);
    // height changes nothing seen from straight above
    const q = screenToGround(v, 900, 500, 18);
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });

  it("world -> screen -> world comes back, at every tilt, turn and zoom, on the ground and above it", () => {
    for (const tilt of TILTS) for (const rot of TURNS) for (const halfH of ZOOMS) {
      const v = pose({ tilt, rot, halfH });
      for (const [x, y, h] of [[1200, 900, 0], [1310.5, 742.25, 0], [1000, 1100, 6], [1456, 880, 18], [900, 300, 60]] as const) {
        const s = worldToScreen(v, x, y, h);
        const g = screenToGround(v, s.x, s.y, h);
        expect(g.x).toBeCloseTo(x, 6);
        expect(g.y).toBeCloseTo(y, 6);
      }
    }
  });

  it("screen -> world -> screen comes back too", () => {
    for (const tilt of TILTS) for (const rot of TURNS) for (const halfH of ZOOMS) {
      const v = pose({ tilt, rot, halfH });
      for (const [px, py, h] of [[0, 0, 0], [1600, 900, 0], [412, 87, 6], [1333, 801, 12]] as const) {
        const g = screenToGround(v, px, py, h);
        const s = worldToScreen(v, g.x, g.y, h);
        expect(s.x).toBeCloseTo(px, 6);
        expect(s.y).toBeCloseTo(py, 6);
      }
    }
  });

  it("agrees with the three.js camera it places, and nothing on screen is clipped", () => {
    for (const tilt of TILTS) for (const rot of TURNS) for (const halfH of ZOOMS) {
      const v = pose({ tilt, rot, halfH });
      for (const [px, py, h] of [[0, 0, 0], [1600, 0, 0], [1600, 900, 0], [0, 900, 0], [800, 450, 0], [0, 900, 400], [1600, 0, -40], [700, 200, 30]] as const) {
        const g = screenToGround(v, px, py, h);
        const t = threeScreen(v, g.x, g.y, h);
        // (float32-free here, but far from the origin at wide zooms: a thousandth of a pixel is plenty)
        expect(Math.abs(t.x - px)).toBeLessThan(1e-3);
        expect(Math.abs(t.y - py)).toBeLessThan(1e-3);
        // inside the near and far planes (NDC z within -1..1): a 400 m tower at the bottom edge, the ground at the top
        expect(t.z).toBeGreaterThan(-1);
        expect(t.z).toBeLessThan(1);
      }
    }
  });

  it("a ray meets each height where screenToGround says, and higher planes land nearer the camera", () => {
    for (const tilt of TILTS) for (const rot of TURNS) {
      const v = pose({ tilt, rot });
      const r = groundRay(v, 1010, 333);
      for (const h of [0, 6, 12, 18, 55]) {
        const a = rayAt(r, h), b = screenToGround(v, 1010, 333, h);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
        // every point of the ray is drawn at the pixel it was cast from
        const s = worldToScreen(v, a.x, a.y, h);
        expect(s.x).toBeCloseTo(1010, 6);
        expect(s.y).toBeCloseTo(333, 6);
      }
      // a bridge deck 6 m up under the cursor: its ground point is 6·tan(tilt) nearer the camera (down the screen)
      const g0 = rayAt(r, 0), g6 = rayAt(r, 6);
      expect(Math.hypot(g6.x - g0.x, g6.y - g0.y)).toBeCloseTo(6 * Math.tan(tilt), 9);
      const down = { x: -Math.sin(rot), y: Math.cos(rot) };
      expect((g6.x - g0.x) * down.x + (g6.y - g0.y) * down.y).toBeCloseTo(6 * Math.tan(tilt), 9);
    }
  });

  it("the default tilt at no turn: up the screen is north, stretched by 1/cos(tilt)", () => {
    const v = pose({ rot: 0 });
    const m = (v.halfH * 2) / v.h;
    const a = screenToGround(v, 800, 450), b = screenToGround(v, 800, 350), c = screenToGround(v, 900, 450);
    expect(b.x - a.x).toBeCloseTo(0, 9);
    expect(b.y - a.y).toBeCloseTo((-100 * m) / Math.cos(TILT_DEFAULT), 9);
    expect(c.x - a.x).toBeCloseTo(100 * m, 9);
    expect(c.y - a.y).toBeCloseTo(0, 9);
    // a roof 20 m up is drawn 20·sin(tilt) metres up the screen from its foot
    const foot = worldToScreen(v, 1300, 800, 0), roof = worldToScreen(v, 1300, 800, 20);
    expect(roof.x).toBeCloseTo(foot.x, 9);
    expect(foot.y - roof.y).toBeCloseTo((20 * Math.sin(TILT_DEFAULT)) / m, 9);
  });

  it("the camera rises as it pulls back: the player's pitch close in, straight down far out, eased between", () => {
    // close in, the pitch asked for; far out, straight down
    for (const h of [28, 110, 260, RISE_FROM]) expect(risenTilt(TILT_DEFAULT, h)).toBe(TILT_DEFAULT);
    for (const h of [RISE_TO, 4000, 30000]) expect(risenTilt(TILT_MAX, h)).toBe(0);
    // the far views the tilt only squashed are (nearly) the map again; a town seen whole still stands up
    expect(risenTilt(TILT_DEFAULT, 1200)).toBeLessThan(deg(16));
    expect(risenTilt(TILT_DEFAULT, 1600)).toBeLessThan(deg(5));
    expect(risenTilt(TILT_DEFAULT, 650)).toBeGreaterThan(deg(32));
    // eased: it never goes back, and never jumps, in the pitch or in how fast the pitch changes (per 2% of zoom)
    let prev = 1, prevStep = 0;
    for (let h = RISE_FROM * 0.9; h < RISE_TO * 1.1; h *= 1.02) {
      const k = riseShare(h), step = prev - k;
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(0.03);
      expect(Math.abs(step - prevStep)).toBeLessThan(0.002);
      prev = k; prevStep = step;
    }
    // the Map view stays the Map view at every zoom
    for (const h of [100, 900, 5000]) expect(risenTilt(0, h)).toBe(0);
  });

  it("the footprint is the ground the screen's corners see", () => {
    for (const tilt of TILTS) for (const rot of TURNS) {
      const v = pose({ tilt, rot });
      const q = footprint(v);
      const halfW = v.halfH * (v.w / v.h), depth = v.halfH / Math.cos(tilt);
      // a rectangle 2·halfW wide and 2·halfH/cos(tilt) deep, centred on the view, turned with it
      expect(Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y)).toBeCloseTo(2 * halfW, 6);
      expect(Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y)).toBeCloseTo(2 * depth, 6);
      expect((q[0].x + q[1].x + q[2].x + q[3].x) / 4).toBeCloseTo(v.cx, 6);
      expect((q[0].y + q[1].y + q[2].y + q[3].y) / 4).toBeCloseTo(v.cy, 6);
      const corners = [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h]];
      q.forEach((p, i) => {
        const s = worldToScreen(v, p.x, p.y, 0);
        expect(s.x).toBeCloseTo(corners[i][0], 6);
        expect(s.y).toBeCloseTo(corners[i][1], 6);
      });
    }
  });

  it("the bounds hold everything on screen, and tall things standing below its bottom edge", () => {
    for (const tilt of TILTS) for (const rot of TURNS) for (const halfH of [60, 400]) {
      const v = pose({ tilt, rot, halfH });
      const b = groundBounds(v, 40);
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) for (const h of [0, 20, 40]) {
        // whatever is drawn at this pixel, standing h tall: its foot is in the box
        const g = screenToGround(v, (v.w * i) / 8, (v.h * j) / 8, h);
        expect(g.x).toBeGreaterThanOrEqual(b.x0 - 1e-6);
        expect(g.x).toBeLessThanOrEqual(b.x1 + 1e-6);
        expect(g.y).toBeGreaterThanOrEqual(b.y0 - 1e-6);
        expect(g.y).toBeLessThanOrEqual(b.y1 + 1e-6);
      }
      // and it is not wastefully big: no more than the turned rectangle's own box
      const halfW = v.halfH * (v.w / v.h), depth = v.halfH / Math.cos(tilt) + 40 * Math.tan(tilt);
      expect(b.x1 - b.x0).toBeLessThanOrEqual(2 * Math.hypot(halfW, depth) + 1e-6);
      const p = groundBounds(v, 40, 25);
      expect(p.x0).toBeCloseTo(b.x0 - 25, 9);
      expect(p.y1).toBeCloseTo(b.y1 + 25, 9);
    }
  });

  it("the sun's shadow frustum holds the ground on screen and whatever casts onto it, at any sun, tilt and turn", () => {
    const suns: [number, number, number][] = [];
    for (const elev of [8, 25, 53, 85]) for (const bear of [0, 70, 200, 310]) {
      const e = deg(elev), b = deg(bear);
      suns.push([Math.cos(b) * Math.cos(e), Math.sin(e), Math.sin(b) * Math.cos(e)]);
    }
    for (const tilt of TILTS) for (const rot of TURNS) for (const halfH of [28, 160, 2400]) for (const sun of suns) {
      const v = pose({ tilt, rot, halfH });
      const f = shadowFit(v, sun, 4096);
      const light = new THREE.OrthographicCamera(-f.ext, f.ext, f.ext, -f.ext, f.near, f.far);
      light.position.set(...f.pos);
      light.lookAt(...f.target);
      light.updateProjectionMatrix();
      light.updateMatrixWorld();
      const inside = (x: number, h: number, y: number) => {
        const p = new THREE.Vector3(x, h, y).project(light);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
      };
      for (const g of footprint(v, CASTER_H)) {
        // the ground at each corner of the screen, and the top of a tower whose shadow falls exactly there
        inside(g.x, 0, g.y);
        const k = CASTER_H / Math.max(0.12, sun[1]);
        inside(g.x + sun[0] * k, sun[1] * k, g.y + sun[2] * k);
      }
      // texels stay sharp: the map covers little more than the screen's own circle
      const halfW = v.halfH * (v.w / v.h);
      expect(f.ext).toBeLessThan(Math.hypot(halfW, v.halfH / Math.cos(tilt) + CASTER_H) * 1.04 + 25);
    }
  });

  it("the shadow map moves in whole texels, so shadows hold still while the map pans", () => {
    const sun: [number, number, number] = [-0.42, 0.78, -0.46];
    const n = Math.hypot(...sun);
    const s: [number, number, number] = [sun[0] / n, sun[1] / n, sun[2] / n];
    const light = (v: ViewPose) => {
      const f = shadowFit(v, s, 4096);
      const cam = new THREE.OrthographicCamera(-f.ext, f.ext, f.ext, -f.ext, f.near, f.far);
      cam.position.set(...f.pos);
      cam.lookAt(...f.target);
      cam.updateMatrixWorld();
      return { f, cam };
    };
    const a = light(pose({ rot: deg(30) }));
    for (const [dx, dy] of [[0.013, 0], [3.7, -1.21], [-55.5, 80.02]]) {
      const b = light(pose({ rot: deg(30), cx: 1200 + dx, cy: 900 + dy }));
      expect(b.f.ext).toBeCloseTo(a.f.ext, 9);
      // a fixed world point lands a whole number of texels from where it was in the map
      const pa = new THREE.Vector3(1234.5, 0, 950.25).applyMatrix4(a.cam.matrixWorldInverse);
      const pb = new THREE.Vector3(1234.5, 0, 950.25).applyMatrix4(b.cam.matrixWorldInverse);
      const tx = (pa.x - pb.x) / a.f.texel, ty = (pa.y - pb.y) / a.f.texel;
      expect(Math.abs(tx - Math.round(tx))).toBeLessThan(1e-3);
      expect(Math.abs(ty - Math.round(ty))).toBeLessThan(1e-3);
    }
  });
});
