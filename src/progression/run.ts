import type { ItemInstance } from './items';
import { isCheckpointWave } from './tiers';

/**
 * Per-run reward ledger (pure; never touches persistence).
 *
 * Reward lifecycle:
 *  - collect()  -> UNSECURED (held by the run only)
 *  - bank(wave) -> SECURED   (at a checkpoint wave; the caller commits it to the save)
 *  - finalize('defeat' | 'abandoned') -> remaining unsecured rewards are LOST
 * Equipped gear is never part of the ledger, so it can never be lost.
 */
export interface Rewards {
  salvage: number;
  items: ItemInstance[];
}

export type RunOutcome = 'returned' | 'defeat' | 'abandoned';

export interface RunResult {
  id: string;
  tier: number;
  outcome: RunOutcome;
  /** Wave the run ended on (reached). */
  finalWave: number;
  wavesCleared: number;
  kills: number;
  /** Simulated seconds spent deployed (excludes menus/pauses). */
  duration: number;
  salvageSecured: number;
  salvageLost: number;
  itemsSecured: number;
  itemsLost: number;
  checkpoints: number;
  endedAt: number;
  /** Filled by the profile when the run is recorded. */
  newRecord?: boolean;
}

export const emptyRewards = (): Rewards => ({ salvage: 0, items: [] });

export class RunLedger {
  duration = 0;
  kills = 0;
  wave = 1;
  wavesCleared = 0;
  checkpoints = 0;
  lastBankedWave = 0;
  unsecured: Rewards = emptyRewards();
  secured: Rewards = emptyRewards();
  private result: RunResult | null = null;

  constructor(
    readonly id: string,
    readonly tier: number,
    readonly startedAt: number,
  ) {}

  get ended(): boolean {
    return this.result !== null;
  }

  tick(dt: number): void {
    if (!this.ended && dt > 0) this.duration += dt;
  }

  addKill(): void {
    if (!this.ended) this.kills++;
  }

  /** Collect a reward into the unsecured pool. Ignored after the run ended. */
  collect(r: Partial<Rewards>): boolean {
    if (this.ended) return false;
    const s = Math.max(0, Math.floor(r.salvage ?? 0));
    this.unsecured.salvage += s;
    if (r.items?.length) this.unsecured.items.push(...r.items);
    return s > 0 || !!r.items?.length;
  }

  waveReached(n: number): void {
    if (!this.ended) this.wave = Math.max(this.wave, n);
  }

  waveCleared(n: number): void {
    if (!this.ended) this.wavesCleared = Math.max(this.wavesCleared, n);
  }

  /**
   * Move every unsecured reward to secured. Only valid once per checkpoint wave, for
   * a wave that has been cleared, while the run is live. Returns the moved rewards
   * (possibly empty) or null when banking is not allowed.
   */
  bank(wave: number): Rewards | null {
    if (this.ended || !isCheckpointWave(wave) || wave <= this.lastBankedWave || wave > this.wavesCleared) return null;
    const moved = this.unsecured;
    this.unsecured = emptyRewards();
    this.secured.salvage += moved.salvage;
    this.secured.items.push(...moved.items);
    this.lastBankedWave = wave;
    this.checkpoints++;
    return moved;
  }

  /** Can the player extract to HQ right now (a checkpoint was just banked)? */
  get atCheckpoint(): boolean {
    return !this.ended && this.lastBankedWave > 0 && this.lastBankedWave === this.wavesCleared;
  }

  /** End the run. Idempotent: later calls return the first result unchanged. */
  finalize(outcome: RunOutcome, now = Date.now()): RunResult {
    if (this.result) return this.result;
    this.result = {
      id: this.id,
      tier: this.tier,
      outcome,
      finalWave: this.wave,
      wavesCleared: this.wavesCleared,
      kills: this.kills,
      duration: this.duration,
      salvageSecured: this.secured.salvage,
      salvageLost: this.unsecured.salvage,
      itemsSecured: this.secured.items.length,
      itemsLost: this.unsecured.items.length,
      checkpoints: this.checkpoints,
      endedAt: now,
    };
    // Unsecured rewards are gone for good.
    this.unsecured = emptyRewards();
    return this.result;
  }
}
