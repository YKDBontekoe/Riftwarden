import type { EnemyKind } from '../data/defs';

/**
 * Elite modifiers (pure data + rolls). Each modifier adds a MECHANIC, not just numbers; the runtime lives in
 * EnemyManager (`updateElite`) and the visuals in visuals/enemyParts.ts. Compatibility is explicit.
 */
export type EliteModId =
  | 'overcharged'
  | 'armored'
  | 'accelerated'
  | 'volatile'
  // M10 mutations
  | 'regenerating'
  | 'splitting'
  | 'shielded'
  | 'blinking'
  | 'frostbound'
  | 'molten';

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

const GROUND: EnemyKind[] = ['walker', 'bulwark', 'enforcer', 'engineer', 'crawler', 'sapper', 'marksman', 'burrower'];
/** Small frames that can split into two (big frames already carry drones). */
const SMALL: EnemyKind[] = ['walker', 'rusher', 'skimmer', 'sapper', 'marksman'];

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
    kinds: [...GROUND, 'rusher', 'artillery', 'skimmer'],
    excludes: [],
    hpMult: 1.1,
    cost: 0.5,
    luck: 0.3,
  },
  // ---- M10 mutations (runtime: enemies/mutations.ts)
  regenerating: {
    id: 'regenerating',
    name: 'Regenerating',
    tag: 'REG',
    color: '#6dff9a',
    blurb: 'Knits itself back together (4% max HP/s) after 2 s without taking damage. Burn stops it.',
    kinds: [...GROUND, 'artillery', 'jammer'],
    excludes: [],
    hpMult: 1.05,
    cost: 0.55,
    luck: 0.3,
  },
  splitting: {
    id: 'splitting',
    name: 'Splitting',
    tag: 'SPL',
    color: '#ff8ad8',
    blurb: 'Splits into two lesser copies when destroyed.',
    kinds: SMALL,
    excludes: ['volatile'],
    hpMult: 1,
    cost: 0.7,
    luck: 0.35,
  },
  shielded: {
    id: 'shielded',
    name: 'Shielded',
    tag: 'SHD',
    color: '#7fd6ff',
    blurb: 'Projects an energy barrier worth 45% of its health that recharges. Energy damage breaks it fast.',
    kinds: [...GROUND, 'artillery', 'skimmer', 'jammer'],
    excludes: ['armored'],
    hpMult: 1,
    cost: 0.6,
    luck: 0.3,
  },
  blinking: {
    id: 'blinking',
    name: 'Blinking',
    tag: 'BLK',
    color: '#c69bff',
    blurb: 'Phases forward along its route every few seconds. Shock or freeze pins it in place.',
    kinds: ['walker', 'enforcer', 'engineer', 'sapper', 'marksman', 'burrower'],
    excludes: ['accelerated'],
    hpMult: 1.05,
    cost: 0.65,
    luck: 0.35,
  },
  frostbound: {
    id: 'frostbound',
    name: 'Frostbound',
    tag: 'FRS',
    color: '#bfefff',
    blurb: 'Immune to chill and freeze. Pulses a telegraphed frost nova that shorts nearby towers.',
    kinds: [...GROUND, 'artillery'],
    excludes: ['molten'],
    hpMult: 1.15,
    cost: 0.6,
    luck: 0.35,
  },
  molten: {
    id: 'molten',
    name: 'Molten',
    tag: 'MLT',
    color: '#ff7a1a',
    blurb: 'Immune to burning. Leaves pools of slag in its wake that scorch the drone.',
    kinds: [...GROUND, 'rusher', 'skimmer'],
    excludes: ['frostbound'],
    hpMult: 1.1,
    cost: 0.55,
    luck: 0.35,
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
  // M10 mutations
  regenDelay: 2,
  regenRate: 0.04,
  splitCount: 2,
  splitHp: 0.4,
  shieldShare: 0.45,
  blinkEvery: 4.2,
  blinkDist: 7,
  novaEvery: 6,
  novaWindup: 1.1,
  novaRadius: 6.5,
  novaDamage: 10,
  novaDisable: 1.6,
  slagEvery: 1.6,
  slagRadius: 1.8,
  slagLife: 5,
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
export function rollMods(kind: EnemyKind, count: number, rand: () => number, o: { wave?: number; weights?: Partial<Record<EliteModId, number>> } = {}): EliteModId[] {
  const out: EliteModId[] = [];
  const wave = o.wave ?? Infinity;
  for (let i = 0; i < count; i++) {
    const pool = ELITE_IDS.filter((m) => (MUTATION_WAVE[m] ?? 0) <= wave && (o.weights?.[m] ?? 1) > 0 && validMods(kind, [...out, m]));
    if (!pool.length) break;
    if (!o.weights) {
      out.push(pool[Math.floor(rand() * pool.length) % pool.length]);
      continue;
    }
    const total = pool.reduce((sum, m) => sum + (o.weights?.[m] ?? 1), 0);
    let x = rand() * total;
    let pick = pool[pool.length - 1];
    for (const m of pool) {
      x -= o.weights[m] ?? 1;
      if (x < 0) {
        pick = m;
        break;
      }
    }
    out.push(pick);
  }
  return out;
}

/** First wave each M10 mutation can roll (the M6 modifiers are available whenever elites are). */
export const MUTATION_WAVE: Partial<Record<EliteModId, number>> = {
  regenerating: 8,
  shielded: 8,
  splitting: 10,
  blinking: 11,
  frostbound: 9,
  molten: 9,
};

export function eliteHpMult(mods: readonly EliteModId[]): number {
  return mods.reduce((m, id) => m * ELITE_MODS[id].hpMult, 1);
}

export function eliteName(baseName: string, mods: readonly EliteModId[]): string {
  return mods.length ? `${mods.map((m) => ELITE_MODS[m].name).join(' ')} ${baseName}` : baseName;
}
