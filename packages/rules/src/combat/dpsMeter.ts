// Firing range readout: damage samples over time -> burst / sustained DPS, crit rate, best window. [pure]

export interface DpsSample {
  t: number;
  amount: number;
}

export interface DpsReadout {
  /** Damage per second over the last `window` seconds (default 5 s). */
  dps: number;
  /** Best 3 s burst since the last reset. */
  burst: number;
  /** Average from the first hit to now (capped at 30 s of history). */
  sustained: number;
  /** Total damage since the last reset. */
  total: number;
  /** Share of hits that were critical (0..1). */
  critRate: number;
  hits: number;
  /** Seconds since the first hit (0 = no hit yet). */
  elapsed: number;
}

export const DPS_WINDOW = 5;
export const BURST_WINDOW = 3;
export const SUSTAIN_WINDOW = 30;

export class DpsMeter {
  private samples: DpsSample[] = [];
  private total = 0;
  private hits = 0;
  private crits = 0;
  private first = -1;
  private bestBurst = 0;

  /** Damage landed at time t (every source the drone owns, damage over time included). */
  add(t: number, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(t)) return;
    if (this.first < 0) this.first = t;
    this.samples.push({ t, amount });
    this.total += amount;
    // Keep only what the longest window needs.
    const cut = t - SUSTAIN_WINDOW;
    let i = 0;
    while (i < this.samples.length && this.samples[i].t < cut) i++;
    if (i) this.samples.splice(0, i);
    this.bestBurst = Math.max(this.bestBurst, this.sum(t, BURST_WINDOW) / BURST_WINDOW);
  }

  /** One direct hit (crit rate counts hits, not damage samples). */
  hit(crit: boolean): void {
    this.hits++;
    if (crit) this.crits++;
  }

  reset(): void {
    this.samples = [];
    this.total = this.hits = this.crits = this.bestBurst = 0;
    this.first = -1;
  }

  private sum(now: number, window: number): number {
    let s = 0;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].t > now - window; i--) s += this.samples[i].amount;
    return s;
  }

  read(now: number, window = DPS_WINDOW): DpsReadout {
    const elapsed = this.first < 0 ? 0 : Math.max(0, now - this.first);
    // The sustained figure divides by at least one second so a single shot does not read as a huge DPS.
    const span = Math.min(SUSTAIN_WINDOW, Math.max(1, elapsed));
    return {
      dps: this.sum(now, window) / Math.max(1, Math.min(window, elapsed || 1)),
      burst: this.bestBurst,
      sustained: this.sum(now, SUSTAIN_WINDOW) / span,
      total: this.total,
      critRate: this.hits ? this.crits / this.hits : 0,
      hits: this.hits,
      elapsed,
    };
  }
}
