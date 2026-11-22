/**
 * Warden levels (pure). XP is derived from measured run statistics, so every source of progress
 * (kills, waves, elites, bosses, events, milestones) counts without extra hooks in the arena.
 * The run ledger turns it into unsecured -> secured XP exactly like salvage.
 */
import type { SurvivalStats } from './run';

/** Inputs to the XP formula (a subset of the run ledger). */
export interface XpInput {
  tier: number;
  kills: number;
  wavesCleared: number;
  survival: Pick<SurvivalStats, 'elitesKilled' | 'bossesKilled' | 'events' | 'milestones' | 'hvtKilled' | 'dev'>;
}

/** XP per source. Waves dominate so a long run is always worth more than farming kills. */
export const XP = {
  kill: 2,
  wave: 40,
  /** Extra per cleared wave grows slowly with depth (wave n is worth wave + n * waveGrowth). */
  waveGrowth: 2,
  elite: 15,
  boss: 250,
  event: 60,
  hvt: 120,
  milestone: 300,
  /** Multiplier per threat tier above I. */
  tierStep: 0.25,
  /** Share of unsecured XP kept when the run is lost or abandoned. */
  keepOnLoss: 0.25,
} as const;

/** Levels that reveal a new ring of the skill tree. */
export const RING_EVERY = 5;
/** Skill points per level. */
export const POINTS_PER_LEVEL = 1;
/** Numeric safety bound (levels are endless in practice). */
export const MAX_LEVEL = 10_000;

export const tierXpMult = (tier: number): number => 1 + XP.tierStep * Math.max(0, Math.min(9, Math.floor(tier) - 1));

/** Total XP a run has earned so far (development sessions earn none). */
export function xpFor(s: XpInput): number {
  if (s.survival.dev) return 0;
  const w = Math.max(0, Math.min(1e6, Math.floor(s.wavesCleared)));
  // sum over waves 1..w of (wave + n * growth)
  const waves = XP.wave * w + XP.waveGrowth * (w * (w + 1)) / 2;
  const raw =
    waves +
    XP.kill * Math.max(0, s.kills) +
    XP.elite * Math.max(0, s.survival.elitesKilled) +
    XP.boss * Math.max(0, s.survival.bossesKilled) +
    XP.event * s.survival.events.length +
    XP.hvt * Math.max(0, s.survival.hvtKilled) +
    XP.milestone * s.survival.milestones.length;
  return Math.max(0, Math.floor(raw * tierXpMult(s.tier)));
}

/** XP needed to go from level L to L+1 (L >= 1): linear with a mild quadratic term. */
export function xpToNext(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return Math.round(400 + 220 * (l - 1) + 6 * (l - 1) * (l - 1));
}

/** Total XP required to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  let total = 0;
  for (let i = 1; i < l; i++) total += xpToNext(i);
  return total;
}

export interface LevelInfo {
  level: number;
  /** XP into the current level. */
  into: number;
  /** XP needed for the next level. */
  need: number;
  /** 0..1 progress to the next level. */
  frac: number;
}

/** Level for a total XP amount. */
export function levelInfo(xp: number): LevelInfo {
  let rest = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let level = 1;
  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (rest < need) return { level, into: rest, need, frac: rest / need };
    rest -= need;
    level++;
  }
  return { level, into: 0, need: xpToNext(level), frac: 1 };
}

export const levelForXp = (xp: number): number => levelInfo(xp).level;

/** Skill points earned at a level. */
export const pointsAt = (level: number): number => Math.max(0, Math.floor(level) - 1) * POINTS_PER_LEVEL;

/** Skill tree rings revealed at a level (ring 1 is open from the start). */
export const ringsAt = (level: number): number => 1 + Math.floor(Math.max(0, Math.floor(level) - 1) / RING_EVERY);

/** Levels gained when going from `before` to `after` XP. */
export const levelsGained = (before: number, after: number): number => levelForXp(after) - levelForXp(before);
