/**
 * Combat stat block. All damage/rate calculations read the computed block, so future
 * equipment affixes and run upgrades only need to contribute StatModifiers.
 */
export interface CombatStats {
  weaponDamageMult: number;
  fireRateMult: number;
  critChance: number;
  critMultiplier: number;
  heatEfficiency: number;
  moveSpeedMult: number;
  turretDamageMult: number;
  turretFireRateMult: number;
  turretRangeMult: number;
  maxHealthBonus: number;
}

export const BASE_STATS: Readonly<CombatStats> = Object.freeze({
  weaponDamageMult: 1,
  fireRateMult: 1,
  critChance: 0.05,
  critMultiplier: 2,
  heatEfficiency: 1,
  moveSpeedMult: 1,
  turretDamageMult: 1,
  turretFireRateMult: 1,
  turretRangeMult: 1,
  maxHealthBonus: 0,
});

export type StatKey = keyof CombatStats;

export interface StatModifier {
  stat: StatKey;
  /** 'add' is summed first, then 'mul' factors (1 + value) are applied multiplicatively. */
  op: 'add' | 'mul';
  value: number;
  source?: string;
}

export function computeStats(mods: readonly StatModifier[], base: Readonly<CombatStats> = BASE_STATS): CombatStats {
  const out: CombatStats = { ...base };
  for (const m of mods) if (m.op === 'add') out[m.stat] += m.value;
  for (const m of mods) if (m.op === 'mul') out[m.stat] *= 1 + m.value;
  out.critChance = Math.min(1, Math.max(0, out.critChance));
  return out;
}
