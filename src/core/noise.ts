// Seeded RNG and 2D value-gradient noise. Deterministic so a seed always rebuilds the same map.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  private perm: Uint8Array;
  private grads: Float32Array;
  private salt: number;

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.salt = (rnd() * 0x7fffffff) | 0;
    this.grads = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const a = rnd() * Math.PI * 2;
      this.grads[i * 2] = Math.cos(a);
      this.grads[i * 2 + 1] = Math.sin(a);
    }
  }

  private g(ix: number, iy: number, x: number, y: number): number {
    // integer hash (not a 256-periodic table): the world is endless, so the noise must never repeat
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ this.salt;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = (h ^ (h >>> 13)) & 255;
    return this.grads[h * 2] * x + this.grads[h * 2 + 1] * y;
  }

  /** Gradient noise in roughly [-1, 1]. */
  noise(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const n00 = this.g(ix, iy, fx, fy);
    const n10 = this.g(ix + 1, iy, fx - 1, fy);
    const n01 = this.g(ix, iy + 1, fx, fy - 1);
    const n11 = this.g(ix + 1, iy + 1, fx - 1, fy - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41;
  }

  /** Ridged noise in [0, 1]: sharp crests where the gradient noise crosses zero (mountain ranges). */
  ridged(x: number, y: number, oct = 4): number {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(this.noise(x * f, y * f));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }

  fbm(x: number, y: number, oct = 4, lac = 2, gain = 0.5): number {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += this.noise(x * f, y * f) * amp;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }
}
