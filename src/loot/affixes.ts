import type { StatKey, StatOp } from '../combat/stats';
import type { Category } from './types';

/**
 * Affix pool (pure data). Each affix modifies exactly one real stat that a gameplay
 * system reads; there are no cosmetic numbers. Category lists define compatibility,
 * `group` prevents two affixes on the same stat, and `scaling` sets level growth:
 *  - 'flat'  linear-quadratic growth (absolute amounts that must keep pace with enemies)
 *  - 'pct'   slow logarithmic growth (percentages; final stats are clamped anyway)
 *  - 'none'  level independent (chances, delays)
 */
export type Scaling = 'flat' | 'pct' | 'none';

export interface AffixDef {
  id: string;
  stat: StatKey;
  op: StatOp;
  /** Tier-1 roll range at item level 1 (negative ranges are reductions). */
  range: [number, number];
  scaling: Scaling;
  /** Selection weight per compatible category. */
  weights: Partial<Record<Category, number>>;
  group: string;
  /** Naming theme: adjective used when this is the item's strongest affix. */
  adjective: string;
}

/** Tier multipliers applied to an affix range (tier 1..5). Ranges overlap on purpose. */
export const TIER_MULT = [1, 1.3, 1.65, 2.05, 2.5] as const;
export const MAX_TIER = TIER_MULT.length;

export const AFFIXES: readonly AffixDef[] = [
  // ---- offensive
  { id: 'dmg', stat: 'weaponDamageMult', op: 'pct', range: [0.04, 0.08], scaling: 'pct', weights: { weapon: 10, processor: 4, accessory: 3, module: 10 }, group: 'dmg', adjective: 'Overcharged' },
  { id: 'crit', stat: 'critChance', op: 'add', range: [0.012, 0.025], scaling: 'none', weights: { weapon: 7, processor: 9, accessory: 5, module: 7 }, group: 'crit', adjective: 'Precision' },
  { id: 'critdmg', stat: 'critMultiplier', op: 'add', range: [0.07, 0.14], scaling: 'pct', weights: { weapon: 7, processor: 8, accessory: 3, module: 7 }, group: 'critdmg', adjective: 'Lethal' },
  { id: 'rate', stat: 'fireRateMult', op: 'pct', range: [0.025, 0.05], scaling: 'none', weights: { weapon: 7, processor: 4, module: 7 }, group: 'rate', adjective: 'Rapid' },
  { id: 'heat', stat: 'heatEfficiency', op: 'pct', range: [0.05, 0.1], scaling: 'none', weights: { weapon: 6, reactor: 8, processor: 4, module: 6 }, group: 'heat', adjective: 'Stabilized' },
  { id: 'cool', stat: 'coolRateMult', op: 'pct', range: [0.06, 0.12], scaling: 'none', weights: { weapon: 4, reactor: 9, module: 6 }, group: 'cool', adjective: 'Cryo-Cooled' },
  // ---- defensive
  { id: 'hull', stat: 'maxHealthBonus', op: 'add', range: [5, 10], scaling: 'flat', weights: { armor: 10, shield: 3, accessory: 4, reactor: 2 }, group: 'hull', adjective: 'Reinforced' },
  { id: 'hullpct', stat: 'maxHealthMult', op: 'pct', range: [0.03, 0.06], scaling: 'pct', weights: { armor: 6, accessory: 2 }, group: 'hullpct', adjective: 'Fortified' },
  { id: 'armor', stat: 'armor', op: 'add', range: [6, 12], scaling: 'flat', weights: { armor: 9, shield: 4, accessory: 2 }, group: 'armor', adjective: 'Hardened' },
  { id: 'resist', stat: 'damageResist', op: 'add', range: [0.015, 0.03], scaling: 'none', weights: { armor: 6, shield: 5, accessory: 3 }, group: 'resist', adjective: 'Insulated' },
  { id: 'shieldcap', stat: 'shieldCapacity', op: 'add', range: [6, 12], scaling: 'flat', weights: { shield: 10, reactor: 5, armor: 3, module: 4 }, group: 'shieldcap', adjective: 'Bastion' },
  { id: 'shieldregen', stat: 'shieldRegen', op: 'add', range: [1.2, 2.4], scaling: 'flat', weights: { shield: 8, reactor: 5, module: 4 }, group: 'shieldregen', adjective: 'Regenerative' },
  { id: 'shielddelay', stat: 'shieldDelay', op: 'pct', range: [-0.05, -0.1], scaling: 'none', weights: { shield: 7, processor: 3 }, group: 'shielddelay', adjective: 'Responsive' },
  // ---- utility
  { id: 'move', stat: 'moveSpeedMult', op: 'pct', range: [0.02, 0.04], scaling: 'none', weights: { accessory: 9, armor: 2, reactor: 3 }, group: 'move', adjective: 'Agile' },
  { id: 'dash', stat: 'dashRechargeMult', op: 'pct', range: [0.06, 0.12], scaling: 'none', weights: { accessory: 8, reactor: 5 }, group: 'dash', adjective: 'Kinetic' },
  { id: 'tactical', stat: 'tacticalRechargeMult', op: 'pct', range: [0.07, 0.14], scaling: 'none', weights: { reactor: 8, processor: 5, accessory: 3 }, group: 'tactical', adjective: 'Temporal' },
  { id: 'buildcost', stat: 'buildCostMult', op: 'pct', range: [-0.025, -0.05], scaling: 'none', weights: { accessory: 6, processor: 5 }, group: 'buildcost', adjective: 'Efficient' },
  // ---- towers
  { id: 'tdmg', stat: 'turretDamageMult', op: 'pct', range: [0.05, 0.1], scaling: 'pct', weights: { processor: 9, accessory: 5, reactor: 3 }, group: 'tdmg', adjective: 'Commanding' },
  { id: 'trange', stat: 'turretRangeMult', op: 'pct', range: [0.03, 0.06], scaling: 'none', weights: { processor: 6, accessory: 4 }, group: 'trange', adjective: 'Long-Range' },
  { id: 'trate', stat: 'turretFireRateMult', op: 'pct', range: [0.03, 0.06], scaling: 'none', weights: { processor: 6, reactor: 3 }, group: 'trate', adjective: 'Synchronized' },
  // ---- abilities
  { id: 'apower', stat: 'abilityPowerMult', op: 'pct', range: [0.06, 0.12], scaling: 'pct', weights: { ability: 10, ultimate: 9, processor: 2 }, group: 'apower', adjective: 'Volatile' },
  { id: 'acool', stat: 'abilityCooldownMult', op: 'pct', range: [-0.04, -0.08], scaling: 'none', weights: { ability: 9, reactor: 2, accessory: 2 }, group: 'acool', adjective: 'Rapid-Cycle' },
  { id: 'aradius', stat: 'abilityRadiusMult', op: 'pct', range: [0.04, 0.08], scaling: 'none', weights: { ability: 6, ultimate: 6 }, group: 'aradius', adjective: 'Wide-Field' },
  { id: 'ucharge', stat: 'ultChargeMult', op: 'pct', range: [0.05, 0.1], scaling: 'none', weights: { ultimate: 10, processor: 2, ability: 3 }, group: 'ucharge', adjective: 'Surging' },
];

const BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));

export function affixDef(id: string): AffixDef | undefined {
  return BY_ID.get(id);
}

/** Affixes that can roll on a category, excluding the given groups. */
export function affixPool(category: Category, exclude: ReadonlySet<string> = new Set(), only?: readonly string[]): AffixDef[] {
  return AFFIXES.filter((a) => (a.weights[category] ?? 0) > 0 && !exclude.has(a.group) && (!only || only.includes(a.id)));
}
