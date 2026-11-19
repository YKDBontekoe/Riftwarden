import type { ItemInstance } from './items';
import { isCheckpointWave } from './tiers';
import { XP, xpFor } from './level';

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
  /** M4: trade currency and advanced components (banked like salvage). */
  credits: number;
  components: number;
  /** Warden XP (derived from run statistics by accrueXp; banked like salvage). */
  xp: number;
  items: ItemInstance[];
}

export type RunOutcome = 'returned' | 'defeat' | 'abandoned';

/** M6 survival statistics, measured from gameplay events during the run. */
export interface SurvivalStats {
  elitesKilled: number;
  bossesKilled: number;
  /** Boss names in kill order (with encounter index), e.g. "Siege Colossus I". */
  bosses: string[];
  deaths: number;
  reactorDamage: number;
  playerDamage: number;
  towerDamage: number;
  /** Events encountered (ids, in order). */
  events: string[];
  hvtKilled: number;
  hvtEscaped: number;
  /** Milestone ids reached this run (see survival/records.ts). */
  milestones: string[];
  /** Development tools were used: not eligible for records or permanent rewards. */
  dev: boolean;
}

export const emptySurvival = (): SurvivalStats => ({ elitesKilled: 0, bossesKilled: 0, bosses: [], deaths: 0, reactorDamage: 0, playerDamage: 0, towerDamage: 0, events: [], hvtKilled: 0, hvtEscaped: 0, milestones: [], dev: false });

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
  creditsSecured: number;
  creditsLost: number;
  componentsSecured: number;
  componentsLost: number;
  /** XP banked at checkpoints during the run. */
  xpSecured?: number;
  /** Unsecured XP kept at the end (all of it on extraction, a share on defeat/abandon). */
  xpKept?: number;
  xpLost?: number;
  /** Names of lost / secured items for the summary screens (capped). */
  lostItems?: ItemBrief[];
  securedItems?: ItemBrief[];
  checkpoints: number;
  endedAt: number;
  /** Filled by the profile when the run is recorded. */
  newRecord?: boolean;
  /** M6 */
  itemsCollected?: number;
  survival?: SurvivalStats;
  /** M6: personal records broken by this run (labels), filled when recorded. */
  records?: string[];
}

export interface ItemBrief {
  uid: string;
  name: string;
  rarity: string;
  level: number;
  category: string;
}

export const brief = (i: ItemInstance): ItemBrief => ({ uid: i.uid, name: i.name, rarity: i.rarity, level: i.level, category: i.category });

export const emptyRewards = (): Rewards => ({ salvage: 0, credits: 0, components: 0, xp: 0, items: [] });

export class RunLedger {
  duration = 0;
  kills = 0;
  wave = 1;
  wavesCleared = 0;
  checkpoints = 0;
  lastBankedWave = 0;
  unsecured: Rewards = emptyRewards();
  secured: Rewards = emptyRewards();
  /** M6 survival statistics (mutated by the arena; frozen into the result). */
  survival: SurvivalStats = emptySurvival();
  private result: RunResult | null = null;
  /** Co-op replica: XP pools are mirrored from the server, never derived locally. */
  xpReplica = false;
  /** XP multiplier (skill tree keystones), set at deploy. */
  xpMult = 1;
  /** XP already moved into the unsecured/secured pools. */
  private xpAccounted = 0;

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

  /** Collect a reward into the unsecured pool. Ignored after the run ended; items are idempotent by uid. */
  collect(r: Partial<Rewards>): boolean {
    if (this.ended) return false;
    const s = Math.max(0, Math.floor(r.salvage ?? 0));
    const cr = Math.max(0, Math.floor(r.credits ?? 0));
    const co = Math.max(0, Math.floor(r.components ?? 0));
    const xp = Math.max(0, Math.floor(r.xp ?? 0));
    this.unsecured.xp += xp;
    this.unsecured.salvage += s;
    this.unsecured.credits += cr;
    this.unsecured.components += co;
    let added = 0;
    for (const it of r.items ?? []) {
      if (this.has(it.uid)) continue;
      this.unsecured.items.push(it);
      this.itemsCollected++;
      added++;
    }
    return s > 0 || cr > 0 || co > 0 || xp > 0 || added > 0;
  }

  /** Items collected so far (for statistics). */
  itemsCollected = 0;
  itemsDiscarded = 0;

  has(uid: string): boolean {
    return this.unsecured.items.some((i) => i.uid === uid) || this.secured.items.some((i) => i.uid === uid);
  }

  isSecured(uid: string): boolean {
    return this.secured.items.some((i) => i.uid === uid);
  }

  /** Throw away an unsecured item (never a secured one). */
  discard(uid: string): ItemInstance | null {
    if (this.ended) return null;
    const idx = this.unsecured.items.findIndex((i) => i.uid === uid);
    if (idx < 0) return null;
    this.itemsDiscarded++;
    return this.unsecured.items.splice(idx, 1)[0];
  }

  /** Move XP earned since the last call (from the run statistics) into the unsecured pool. */
  accrueXp(): number {
    if (this.ended) return 0;
    const total = this.xpTotal();
    const delta = total - this.xpAccounted;
    if (delta <= 0) return 0;
    this.unsecured.xp += delta;
    this.xpAccounted = total;
    return delta;
  }

  private xpTotal(): number {
    if (this.xpReplica) return this.xpAccounted;
    return Math.floor(xpFor(this) * Math.max(0, Math.min(10, this.xpMult)));
  }

  /** XP earned this run so far (secured + unsecured, without accruing). */
  get xpEarned(): number {
    return this.secured.xp + this.unsecured.xp + Math.max(0, this.xpTotal() - this.xpAccounted);
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
    this.accrueXp();
    const moved = this.unsecured;
    this.unsecured = emptyRewards();
    this.secured.salvage += moved.salvage;
    this.secured.credits += moved.credits;
    this.secured.components += moved.components;
    this.secured.xp += moved.xp;
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
    this.accrueXp();
    const xpKept = outcome === 'returned' ? this.unsecured.xp : Math.floor(this.unsecured.xp * XP.keepOnLoss);
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
      creditsSecured: this.secured.credits,
      creditsLost: this.unsecured.credits,
      componentsSecured: this.secured.components,
      componentsLost: this.unsecured.components,
      xpSecured: this.secured.xp,
      xpKept,
      xpLost: this.unsecured.xp - xpKept,
      lostItems: this.unsecured.items.slice(0, 12).map(brief),
      securedItems: this.secured.items.slice(0, 12).map(brief),
      checkpoints: this.checkpoints,
      endedAt: now,
      itemsCollected: this.itemsCollected,
      survival: { ...this.survival, bosses: [...this.survival.bosses], events: [...this.survival.events], milestones: [...this.survival.milestones] },
    };
    // Unsecured rewards are gone for good.
    this.unsecured = emptyRewards();
    return this.result;
  }
}
