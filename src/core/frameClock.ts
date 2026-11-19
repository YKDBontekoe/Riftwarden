/**
 * Frame pacing filter for the variable-step render loop. Raw browser frame deltas jitter by a millisecond or two
 * (timer resolution, compositor scheduling) even at a steady frame rate; fed straight into movement and the
 * camera that shows up as micro-stutter at high speed. Deltas close to the recent average are replaced by the
 * average; real changes (hitches, refresh-rate switches, tab throttling) pass straight through. Simulated time is
 * never lost: the difference between raw and filtered time is repaid a little per frame. Pure.
 */
export class FrameClock {
  private avg = 0;
  /** Raw minus simulated time not yet repaid (s). */
  private debt = 0;

  /** `max`: upper bound for one simulation step (s). `tolerance`: relative jitter treated as noise. */
  constructor(private readonly max = 1 / 20, private readonly tolerance = 0.2) {}

  next(rawSeconds: number): number {
    if (!(rawSeconds > 0) || !Number.isFinite(rawSeconds)) return 0;
    const raw = Math.min(rawSeconds, this.max);
    if (this.avg === 0) this.avg = raw;
    const steady = Math.abs(raw - this.avg) <= this.avg * this.tolerance;
    this.avg += (raw - this.avg) * (steady ? 0.05 : 0.5);
    let dt = steady ? this.avg : raw;
    this.debt += raw - dt;
    // Proportional repayment (a few percent of the debt per frame) so it does not re-inject the jitter.
    const repay = Math.max(-dt * 0.05, Math.min(dt * 0.05, this.debt * 0.05));
    dt += repay;
    this.debt -= repay;
    // A long pause must not be paid back as a fast-forward later.
    if (Math.abs(this.debt) > this.max) this.debt = Math.sign(this.debt) * this.max;
    return Math.min(this.max, dt);
  }

  reset(): void {
    this.avg = 0;
    this.debt = 0;
  }
}
