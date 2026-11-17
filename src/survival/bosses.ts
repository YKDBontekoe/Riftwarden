/**
 * Boss encounters (pure definitions + scaling). The runtime state machines live in enemies/bosses/*.
 * Difficulty grows per repeated encounter through extra patterns, faster attacks and support, not only health.
 */
export type BossId = 'colossus' | 'overseer';

export interface BossDef {
  id: BossId;
  name: string;
  title: string;
  warning: string;
  /** Phase thresholds (fraction of max HP at which phase 2 and 3 start). */
  phases: [number, number];
}

export const BOSSES: Record<BossId, BossDef> = {
  colossus: {
    id: 'colossus',
    name: 'SIEGE COLOSSUS',
    title: 'Ground assault platform',
    warning: 'SEISMIC SIGNATURE · SIEGE COLOSSUS APPROACHING',
    phases: [0.66, 0.33],
  },
  overseer: {
    id: 'overseer',
    name: 'OVERSEER CORE',
    title: 'Floating command machine',
    warning: 'COMMAND UPLINK DETECTED · OVERSEER CORE INBOUND',
    phases: [0.6, 0.28],
  },
};

export const BOSS_IDS = Object.keys(BOSSES) as BossId[];

export interface BossScaling {
  /** Health multiplier on top of the wave/tier multiplier. */
  hp: number;
  /** Damage multiplier on top of the wave/tier multiplier. */
  damage: number;
  /** Attack cooldown multiplier (< 1 = more frequent). */
  cadence: number;
  /** Extra summons per summon action. */
  extraSummons: number;
  /** Repeat-encounter variations unlocked (0 = base kit). */
  variant: number;
}

/**
 * Encounter `k` (1-based) of a boss: health grows gently (log), attacks speed up, more support and new
 * pattern variants. Tier `bossPower` multiplies health and damage. Always finite.
 */
export function bossScaling(k: number, bossPower: number): BossScaling {
  const n = Math.max(1, Math.min(1e6, Math.floor(Number.isFinite(k) ? k : 1)));
  const p = Number.isFinite(bossPower) && bossPower > 0 ? bossPower : 1;
  return {
    hp: p * (1 + 0.35 * Math.log2(n)),
    damage: p * (1 + 0.12 * Math.log2(n)),
    cadence: Math.max(0.6, 1 - 0.08 * (n - 1)),
    extraSummons: Math.min(4, n - 1),
    variant: Math.min(2, n - 1),
  };
}

export function bossPhase(def: BossDef, hpFrac: number): 1 | 2 | 3 {
  if (hpFrac <= def.phases[1]) return 3;
  if (hpFrac <= def.phases[0]) return 2;
  return 1;
}
