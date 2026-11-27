/**
 * Rolling frame-time statistics for the F3 overlay: average FPS hides stutter, so report the 1% and 0.1% lows
 * (FPS at the 99th / 99.9th percentile frame time) over the last `size` frames. Pure; the sort runs only when the
 * overlay asks (20 Hz while F3 is open).
 */
export class FrameStats {
  private readonly ring: Float32Array;
  private n = 0;
  private i = 0;

  constructor(readonly size = 1200) {
    this.ring = new Float32Array(size);
  }

  push(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    this.ring[this.i] = ms;
    this.i = (this.i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  /** Frame time (ms) at quantile q (0..1) of the window; 0 when empty. */
  quantile(q: number): number {
    if (!this.n) return 0;
    const s = this.ring.slice(0, this.n).sort();
    return s[Math.min(this.n - 1, Math.floor(this.n * q))];
  }

  /** `{ p99, p999 }` frame times and the matching 1% / 0.1% low FPS. */
  summary(): { p99: number; p999: number; low1: number; low01: number } {
    const p99 = this.quantile(0.99);
    const p999 = this.quantile(0.999);
    return { p99, p999, low1: p99 ? Math.round(1000 / p99) : 0, low01: p999 ? Math.round(1000 / p999) : 0 };
  }

  reset(): void {
    this.n = 0;
    this.i = 0;
  }
}

/** Overlay fields: 1% / 0.1% low FPS and the p99 frame time (ms, 2 decimals). */
export function lows(f: FrameStats): { low1: number; low01: number; p99: number } {
  const s = f.summary();
  return { low1: s.low1, low01: s.low01, p99: Math.round(s.p99 * 100) / 100 };
}
