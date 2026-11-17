import type { SpawnEntry, WaveDef } from './waves';
import { getWave } from './waves';
import type { WavePhase } from '../ui/store';
import { NO_SCALING, type WaveScaling } from '../progression/tiers';

export interface WaveHooks {
  spawn(entry: SpawnEntry, wave: WaveDef): void;
  aliveCount(): number;
  onWaveStart(wave: WaveDef): void;
  onWaveCleared(wave: WaveDef): void;
  onPrepStart(wave: WaveDef): void;
}

/** Concurrency cap keeps late waves performant; spawns queue behind it. */
export const MAX_ACTIVE_ENEMIES = 42;

/**
 * Wave lifecycle: prep (real time, skippable) -> combat (hostile time, spawn schedule)
 * -> cleared (short celebration) -> prep of the next wave. Endless.
 */
export class WaveManager {
  phase: WavePhase = 'prep';
  number = 1;
  wave: WaveDef = getWave(1);
  timer = 0;
  private elapsed = 0;
  private cursor = 0;
  spawnedTotal = 0;

  /** M6: the survival director composes waves when provided (legacy generator otherwise). */
  compose: ((n: number) => WaveDef) | null = null;

  constructor(private hooks: WaveHooks, public scaling: WaveScaling = NO_SCALING, compose?: (n: number) => WaveDef) {
    if (compose) {
      this.compose = compose;
      this.wave = compose(1);
    }
  }

  private make(n: number): WaveDef {
    return this.compose ? this.compose(n) : getWave(n, this.scaling);
  }

  reset(): void {
    this.number = 1;
    this.wave = this.make(1);
    this.enterPrep();
  }

  /** Development tools: jump to the preparation phase of wave n (current enemies are the caller's problem). */
  jumpTo(n: number): void {
    this.number = Math.max(1, Math.floor(n));
    this.wave = this.make(this.number);
    this.cursor = 0;
    this.elapsed = 0;
    this.enterPrep();
  }

  /** Re-compose the upcoming wave during preparation (plan changed by an event/debug force). */
  recompose(): void {
    if (this.phase === 'prep') this.wave = this.make(this.number);
  }

  private enterPrep(): void {
    this.phase = 'prep';
    this.timer = this.wave.prepTime;
    this.hooks.onPrepStart(this.wave);
  }

  /** Skip the rest of preparation. */
  startNow(): void {
    if (this.phase === 'prep') this.timer = 0;
  }

  get remainingToSpawn(): number {
    return this.wave.spawns.length - this.cursor;
  }

  /** Enemies left in the wave = alive + not yet spawned. */
  get enemiesLeft(): number {
    return this.phase === 'combat' ? this.hooks.aliveCount() + this.remainingToSpawn : 0;
  }

  update(realDt: number, hostileDt: number): void {
    switch (this.phase) {
      case 'prep':
        this.timer -= realDt;
        if (this.timer <= 0) {
          this.phase = 'combat';
          this.elapsed = 0;
          this.cursor = 0;
          this.hooks.onWaveStart(this.wave);
        }
        break;
      case 'combat': {
        this.elapsed += hostileDt;
        const spawns = this.wave.spawns;
        while (this.cursor < spawns.length && spawns[this.cursor].time <= this.elapsed && this.hooks.aliveCount() < MAX_ACTIVE_ENEMIES) {
          this.hooks.spawn(spawns[this.cursor], this.wave);
          this.cursor++;
          this.spawnedTotal++;
        }
        // Cap held the queue back: let time not run ahead too far.
        if (this.cursor < spawns.length && spawns[this.cursor].time < this.elapsed - 1) this.elapsed = spawns[this.cursor].time + 1;
        if (this.cursor >= spawns.length && this.hooks.aliveCount() === 0) {
          this.phase = 'cleared';
          this.timer = 3;
          this.hooks.onWaveCleared(this.wave);
        }
        break;
      }
      case 'cleared':
        this.timer -= realDt;
        if (this.timer <= 0) {
          this.number++;
          this.wave = this.make(this.number);
          this.enterPrep();
        }
        break;
    }
  }
}
