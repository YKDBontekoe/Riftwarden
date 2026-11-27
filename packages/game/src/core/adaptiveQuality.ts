/**
 * Adaptive quality: when frames miss the target frame rate during a heavy fight, step down purely cosmetic cost
 * (particle density first, then render resolution) and step back up once there is clear headroom. Pure: fed frame
 * times, returns the level; the client applies it (render scale) and the arena (effect density).
 *
 * Stability over reactivity (no visible pumping): decisions use the 90th percentile frame time of one-second
 * windows, a step down needs two overloaded windows in a row, a step up needs six windows with headroom, and every
 * change is followed by a cooldown. Frames over 250 ms (tab switch, loading, a breakpoint) are not load and are
 * ignored. Gameplay-critical visuals (enemies, telegraphs, projectiles, HUD) are never scaled.
 */
export interface QualityLevel {
  /** Multiplier on the render-scale setting. */
  renderScale: number;
  /** Multiplier on the particle-density setting (cosmetic bursts, ambient particles, debris). */
  effects: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { renderScale: 1, effects: 1 },
  { renderScale: 1, effects: 0.7 },
  { renderScale: 0.9, effects: 0.6 },
  { renderScale: 0.8, effects: 0.5 },
  { renderScale: 0.7, effects: 0.45 },
];

export const ADAPTIVE = {
  /** Window length (ms of frame time). */
  windowMs: 1000,
  /** Overloaded when the window's p90 frame time exceeds the budget by this factor. */
  overload: 1.2,
  /** Headroom when the p90 is below the budget by this factor. */
  headroom: 0.75,
  downAfter: 2,
  upAfter: 6,
  /** Windows to wait after any change before the next one. */
  cooldown: 2,
  /** Frames longer than this are hitches of another kind (not load) and are skipped. */
  ignoreMs: 250,
};

export class AdaptiveQuality {
  level = 0;
  private samples: number[] = [];
  private sum = 0;
  private over = 0;
  private room = 0;
  private cool = 0;

  /** `targetFps` 0 = off (always full quality). */
  constructor(public targetFps: number) {}

  get current(): QualityLevel {
    return QUALITY_LEVELS[this.level];
  }

  /** Feed one frame time (ms). Returns true when the level changed. */
  sample(frameMs: number): boolean {
    if (!this.targetFps) {
      if (this.level === 0) return false;
      this.reset(0);
      return true;
    }
    if (!(frameMs > 0) || frameMs > ADAPTIVE.ignoreMs) return false;
    this.samples.push(frameMs);
    this.sum += frameMs;
    if (this.sum < ADAPTIVE.windowMs) return false;
    const sorted = this.samples.sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    this.samples = [];
    this.sum = 0;
    const budget = 1000 / this.targetFps;
    this.over = p90 > budget * ADAPTIVE.overload ? this.over + 1 : 0;
    this.room = p90 < budget * ADAPTIVE.headroom ? this.room + 1 : 0;
    if (this.cool > 0) {
      this.cool--;
      return false;
    }
    if (this.over >= ADAPTIVE.downAfter && this.level < QUALITY_LEVELS.length - 1) return this.change(this.level + 1);
    if (this.room >= ADAPTIVE.upAfter && this.level > 0) return this.change(this.level - 1);
    return false;
  }

  /** New scene or new target: start measuring afresh (keeps `level` unless given). */
  reset(level = this.level): void {
    this.level = level;
    this.samples = [];
    this.sum = 0;
    this.over = 0;
    this.room = 0;
    this.cool = 0;
  }

  private change(level: number): boolean {
    this.level = level;
    this.over = 0;
    this.room = 0;
    this.cool = ADAPTIVE.cooldown;
    return true;
  }
}
