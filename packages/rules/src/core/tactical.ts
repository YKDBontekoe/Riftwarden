/**
 * Tactical construction mode: a limited energy pool that slows hostile time.
 * Rules: activate needs >= minToActivate; drains while active; auto-ends when empty;
 * recharges after a short delay once inactive.
 */
export class TacticalEnergy {
  static readonly MAX = 100;
  static readonly DRAIN = 22; // per real second (~4.5s from full)
  static readonly RECHARGE = 9; // per real second
  static readonly RECHARGE_DELAY = 1.5;
  static readonly MIN_TO_ACTIVATE = 25;
  static readonly HOSTILE_SCALE = 0.22;

  energy = TacticalEnergy.MAX;
  active = false;
  private sinceActive = 99;
  /** Smoothed time scale applied to hostile simulation. */
  hostileScale = 1;
  /** Recharge speed multiplier (equipment). */
  rechargeMult = 1;

  reset(): void {
    this.energy = TacticalEnergy.MAX;
    this.active = false;
    this.sinceActive = 99;
    this.hostileScale = 1;
  }

  /** Returns true if the state actually changed. */
  toggle(): boolean {
    if (this.active) {
      this.deactivate();
      return true;
    }
    if (this.energy >= TacticalEnergy.MIN_TO_ACTIVATE) {
      this.active = true;
      return true;
    }
    return false;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.sinceActive = 0;
  }

  update(realDt: number): void {
    if (this.active) {
      this.energy -= TacticalEnergy.DRAIN * realDt;
      if (this.energy <= 0) {
        this.energy = 0;
        this.deactivate();
      }
    } else {
      this.sinceActive += realDt;
      if (this.sinceActive >= TacticalEnergy.RECHARGE_DELAY) {
        this.energy = Math.min(TacticalEnergy.MAX, this.energy + TacticalEnergy.RECHARGE * this.rechargeMult * realDt);
      }
    }
    const target = this.active ? TacticalEnergy.HOSTILE_SCALE : 1;
    // Fast but non-instant transition to avoid jarring snaps.
    const k = 1 - Math.exp(-realDt * 14);
    this.hostileScale += (target - this.hostileScale) * k;
    if (Math.abs(this.hostileScale - target) < 0.002) this.hostileScale = target;
  }
}

export class Wallet {
  cores: number;
  earned = 0;
  constructor(private readonly start: number) {
    this.cores = start;
  }
  reset(): void {
    this.cores = this.start;
    this.earned = 0;
  }
  canAfford(cost: number): boolean {
    return this.cores >= cost;
  }
  spend(cost: number): boolean {
    if (cost < 0 || this.cores < cost) return false;
    this.cores -= cost;
    return true;
  }
  earn(amount: number): void {
    if (amount <= 0) return;
    this.cores += amount;
    this.earned += amount;
  }
}
