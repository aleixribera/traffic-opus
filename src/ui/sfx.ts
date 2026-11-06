/** Tiny synthesized UI sounds (no assets). Quiet, short, and off until the first user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, t0: number, dur: number, type: OscillatorType, gain: number, slide = 0) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  play(k: "build" | "remove" | "place" | "error" | "level" | "click") {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    switch (k) {
      case "click": this.tone(1400, t, 0.03, "triangle", 0.025); break;
      case "build": this.tone(520, t, 0.07, "triangle", 0.06); this.tone(780, t + 0.05, 0.09, "triangle", 0.05); break;
      case "place": this.tone(660, t, 0.06, "sine", 0.07); this.tone(990, t + 0.045, 0.1, "sine", 0.05); break;
      case "remove": this.tone(300, t, 0.12, "triangle", 0.06, -120); break;
      case "error": this.tone(180, t, 0.09, "square", 0.025); this.tone(150, t + 0.08, 0.1, "square", 0.02); break;
      case "level": [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.09, 0.22, "triangle", 0.06)); break;
    }
  }
}
