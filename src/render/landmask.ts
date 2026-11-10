// Where the land is built on, as a small texture the ground shader reads: a town's lots (red), a works' plot
// (green), a farm's plot (blue), each soft at its edge, and how near a town's lots a point is (alpha: 1 on a lot,
// falling to 0 over FALL metres), which lets a town's mown ground run out into the meadow with no edge. The ground under a works is bare trodden earth, a farmyard is
// worn pale, a town's ground is mown and plain; far out, the atlas tints its built-up blocks and its works from the
// same texture. Worked out on the CPU from the buildings' plots (a few thousand small rectangles: a few
// milliseconds), again whenever they change.

import * as THREE from "three";

/** What the mask needs of a building (game/buildings.ts Building has all of it). */
export interface MaskPlot {
  kind: string;
  c: { x: number; y: number };
  rot: number;
  hw: number;
  hd: number;
  plant?: unknown;
}

/** The mask's texels: at least this many metres across, and never more of them than this along a side. */
const TEXEL = 6, MAX = 1024;
/** How far past a plot its ground reaches (m): a town's lots close up into blocks, a works' yard spills a little. */
const PAD = { town: 9, works: 5, farm: 3 };
/** At most this often (ms): a growing town adds a house every few seconds, and the texture is a few megabytes. */
const EVERY = 1500;
/** How far out from a town's lots its ground still tells (m). */
const FALL = 30;

export class LandMask {
  private tex: THREE.DataTexture;
  /** uMask: the texture; uMaskRect: its corner in the world (x, y) and one over its size in metres. */
  readonly uniforms = {
    uMask: { value: null as unknown as THREE.Texture },
    uMaskRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  private sig = -1;
  private at = -1e9;
  private last: ReturnType<typeof rasterPlots> | null = null;
  /** Counts the times the mask was drawn again. */
  stamp = 0;

  /** How near a town's lots a point is: 1 on a lot, falling to 0 over the reach of its ground (the alpha byte). */
  townAt(x: number, y: number): number {
    const r = this.last;
    if (!r) return 0;
    const i = Math.floor((x - r.x0) / r.texel), j = Math.floor((y - r.y0) / r.texel);
    return i < 0 || j < 0 || i >= r.w || j >= r.h ? 0 : r.data[(j * r.w + i) * 4 + 3] / 255;
  }

  constructor() {
    this.tex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.needsUpdate = true;
    this.uniforms.uMask.value = this.tex;
  }

  /** Call every frame with the buildings and a number that changes when they do. */
  update(list: readonly MaskPlot[], version: number, now = performance.now()) {
    if (version === this.sig || now - this.at < EVERY) return;
    this.sig = version;
    this.at = now;
    const r = rasterPlots(list);
    this.last = r;
    this.stamp++;
    this.tex.dispose();
    this.tex = new THREE.DataTexture(r.data, r.w, r.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.generateMipmaps = true;
    this.tex.needsUpdate = true;
    this.uniforms.uMask.value = this.tex;
    this.uniforms.uMaskRect.value.set(r.x0, r.y0, 1 / (r.w * r.texel), 1 / (r.h * r.texel));
  }

  dispose() {
    this.tex.dispose();
  }
}

/** The plots drawn into bytes (r town, g works, b farm), over the rectangle that holds them all. */
export function rasterPlots(list: readonly MaskPlot[]): { data: Uint8Array; w: number; h: number; x0: number; y0: number; texel: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of list) {
    const r = Math.hypot(b.hw, b.hd) + FALL + 12;
    x0 = Math.min(x0, b.c.x - r); y0 = Math.min(y0, b.c.y - r);
    x1 = Math.max(x1, b.c.x + r); y1 = Math.max(y1, b.c.y + r);
  }
  if (!(x1 > x0)) return { data: new Uint8Array(4), w: 1, h: 1, x0: 0, y0: 0, texel: 1 };
  const texel = Math.max(TEXEL, (x1 - x0) / MAX, (y1 - y0) / MAX);
  const w = Math.max(1, Math.ceil((x1 - x0) / texel)), h = Math.max(1, Math.ceil((y1 - y0) / texel));
  const data = new Uint8Array(w * h * 4);
  const soft = texel * 0.9; // the edge's width
  for (const b of list) {
    const ch = b.plant ? (b.kind === "farm" ? 2 : 1) : 0;
    const pad = ch === 0 ? PAD.town : ch === 1 ? PAD.works : PAD.farm;
    const hw = b.hw + pad, hd = b.hd + pad;
    const ux = Math.cos(b.rot), uy = Math.sin(b.rot);
    const reach = ch === 0 ? FALL - pad : soft;
    const r = Math.abs(ux) * hw + Math.abs(uy) * hd + reach, s = Math.abs(uy) * hw + Math.abs(ux) * hd + reach;
    const i0 = Math.max(0, Math.floor((b.c.x - r - x0) / texel)), i1 = Math.min(w - 1, Math.ceil((b.c.x + r - x0) / texel));
    const j0 = Math.max(0, Math.floor((b.c.y - s - y0) / texel)), j1 = Math.min(h - 1, Math.ceil((b.c.y + s - y0) / texel));
    // (Math.sqrt, not Math.hypot, and rounding by hand: this runs for every texel round every lot, some half a million
    // times a build)
    const bhw = b.hw, bhd = b.hd, cx = b.c.x, cy = b.c.y;
    for (let j = j0; j <= j1; j++) {
      const dy = y0 + (j + 0.5) * texel - cy;
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * texel - cx;
        // (along the frontage, and across it)
        const a = Math.abs(dx * ux + dy * uy), d = Math.abs(-dx * uy + dy * ux);
        const o = (j * w + i) * 4;
        if (ch === 0) {
          const ea = a > bhw ? a - bhw : 0, ed = d > bhd ? d - bhd : 0;
          const out = Math.sqrt(ea * ea + ed * ed);
          if (out < FALL) {
            const n = ((1 - out / FALL) * 255 + 0.5) | 0;
            if (n > data[o + 3]) data[o + 3] = n;
          }
        }
        const ka = (hw - a) / soft + 0.5, kd = (hd - d) / soft + 0.5;
        if (ka <= 0 || kd <= 0) continue;
        const v = ((ka < 1 ? ka : 1) * (kd < 1 ? kd : 1) * 255 + 0.5) | 0;
        if (v > data[o + ch]) data[o + ch] = v;
      }
    }
  }
  return { data, w, h, x0, y0, texel };
}
