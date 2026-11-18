import type { EnemyKind } from '../data/defs';

/**
 * Elite modifiers (pure data + rolls). Each modifier adds a MECHANIC, not just numbers; the runtime lives in
 * EnemyManager (`updateElite`) and the visuals in visuals/enemyParts.ts. Compatibility is explicit.
 */
export type EliteModId = 'overcharged' | 'armored' | 'accelerated' | 'volatile';

export interface EliteModDef {
  id: EliteModId;
  name: string;
  /** Short HUD tag. */
  tag: string;
  /** HUD/marker colour (CSS). */
  color: string;
  blurb: string;
  /** Kinds that can carry it. */
  kinds: readonly EnemyKind[];
  /** Mods it cannot be combined with (contradictory mechanics). */
  excludes: readonly EliteModId[];
  /** Health multiplier (small: elites are dangerous through mechanics). */
  hpMult: number;
  /** Extra encounter cost fraction of the base enemy cost. */
  cost: number;
  /** Drop luck bonus (additive to the elite drop source luck). */
  luck: number;
}

const GROUND: EnemyKind[] = ['walker', 'bulwark', 'enforcer', 'engineer', 'crawler'];

export const ELITE_MODS: Record<EliteModId, EliteModDef> = {
  overcharged: {
    id: 'overcharged',
    name: 'Overcharged',
    tag: 'OVR',
    color: '#5fb8ff',
    blurb: 'Discharges telegraphed chain lightning at the drone and shorts nearby towers.',
    kinds: [...GROUND, 'artillery', 'rusher'],
    excludes: [],
    hpMult: 1.25,
    cost: 0.7,
    luck: 0.35,
  },
  armored: {
    id: 'armored',
    name: 'Armored',
    tag: 'ARM',
    color: '#d8d2c4',
    blurb: 'Plating absorbs 55% of body damage until it is shot off. Weakpoints bypass it.',
    kinds: [...GROUND, 'artillery'],
    excludes: ['accelerated'],
    hpMult: 1.15,
    cost: 0.8,
    luck: 0.35,
  },
  accelerated: {
    id: 'accelerated',
    name: 'Accelerated',
    tag: 'ACC',
    color: '#ffd84a',
    blurb: 'Moves 40% faster, recovers attacks faster and fires thruster boosts.',
    kinds: [...GROUND, 'rusher', 'artillery'],
    excludes: ['armored'],
    hpMult: 1.1,
    cost: 0.6,
    luck: 0.3,
  },
  volatile: {
    id: 'volatile',
    name: 'Volatile',
    tag: 'VOL',
    color: '#ff4a3a',
    blurb: 'Its core goes critical when destroyed: a telegraphed blast 1.4 s later.',
    kinds: [...GROUND, 'rusher', 'artillery'],
    excludes: [],
    hpMult: 1.1,
    cost: 0.5,
    luck: 0.3,
  },
};

export const ELITE_IDS = Object.keys(ELITE_MODS) as EliteModId[];

/** Tuning shared by runtime and tests. */
export const ELITE = {
  armorAbsorb: 0.55,
  /** Plating breaks after absorbing this fraction of max HP. */
  armorBreak: 0.35,
  speed: 1.4,
  attackRate: 1.5,
  boostEvery: 5,
  boostTime: 0.6,
  boostMult: 2.4,
  dischargeEvery: 4.2,
  dischargeWindup: 0.9,
  dischargeRange: 8,
  dischargeDamage: 16,
  towerShortTime: 2.5,
  volatileDelay: 1.4,
  volatileRadius: 5.5,
  volatileDamage: 34,
} as const;

/** Is `mods` a valid set for `kind`? (no duplicates, allowed kinds, no exclusions) */
export function validMods(kind: EnemyKind, mods: readonly EliteModId[]): boolean {
  const seen = new Set<EliteModId>();
  for (const m of mods) {
    const d = ELITE_MODS[m];
    if (!d || seen.has(m) || !d.kinds.includes(kind)) return false;
    for (const x of d.excludes) if (mods.includes(x)) return false;
    seen.add(m);
  }
  return true;
}

/** Roll `count` compatible modifiers for `kind` (fewer if the pool runs out). Pure. */
export function rollMods(kind: EnemyKind, count: number, rand: () => number): EliteModId[] {
  const out: EliteModId[] = [];
  for (let i = 0; i < count; i++) {
    const pool = ELITE_IDS.filter((m) => validMods(kind, [...out, m]));
    if (!pool.length) break;
    out.push(pool[Math.floor(rand() * pool.length) % pool.length]);
  }
  return out;
}

export function eliteHpMult(mods: readonly EliteModId[]): number {
  return mods.reduce((m, id) => m * ELITE_MODS[id].hpMult, 1);
}

export function eliteName(baseName: string, mods: readonly EliteModId[]): string {
  return mods.length ? `${mods.map((m) => ELITE_MODS[m].name).join(' ')} ${baseName}` : baseName;
}
