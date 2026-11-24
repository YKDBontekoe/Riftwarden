import { STAT_DEFS } from '../combat/stats';
import { MAX_TIER } from '../loot/affixes';
import { clampLevel } from '../loot/generate';
import { rarity } from '../loot/rarity';
import type { Category, ItemInstance } from '../loot/types';

/**
 * M4 economy: every cost, price and yield formula in one place (pure).
 *
 * Three resources only:
 *  - credits     trade currency (merchants, services, part of crafting)
 *  - salvage     common engineering material (enhancement, rerolls, crafting)
 *  - components  "advanced components": rare material for high-end engineering
 *
 * All formulas are finite by construction: item levels are clamped (MAX_ITEM_LEVEL),
 * growth with level is linear, escalation counters are capped, and every result is
 * rounded to a non-negative integer. No formula grows exponentially without a cap.
 */
export type ResourceKey = 'credits' | 'salvage' | 'components' | 'shards';
export const RESOURCE_KEYS: readonly ResourceKey[] = ['credits', 'salvage', 'components', 'shards'];

export const RESOURCE_LABEL: Record<ResourceKey, string> = { credits: 'Credits', salvage: 'Salvage', components: 'Adv. Components', shards: 'Rift Shards' };
export const RESOURCE_SHORT: Record<ResourceKey, string> = { credits: 'CR', salvage: 'SALVAGE', components: 'COMP', shards: 'SHARDS' };

export type Cost = Partial<Record<ResourceKey, number>>;

/** Resources granted to a fresh (or migrated) profile: enough to try a first purchase or craft. */
export const STARTING_CREDITS = 200;

/** Hard numeric bound for stored balances (keeps sums exact in doubles). */
export const MAX_BALANCE = 1e12;

// ------------------------------------------------------------------ shared scaling

const int = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** Linear cost growth with item level (1 at L1, 2 at L11, 11 at L101). */
export function levelFactor(level: number): number {
  return 1 + 0.1 * (clampLevel(level) - 1);
}

/** Rarity index 0..6. */
export const ri = (item: Pick<ItemInstance, 'rarity'>) => rarity(item.rarity).index;

/** Relative value per rarity (credits, crafting). */
export const RARITY_VALUE = [1, 1.8, 3.4, 6.5, 13, 26, 48] as const;

/** Relative value per category. */
export const CATEGORY_VALUE: Record<Category, number> = { weapon: 1.25, armor: 1, shield: 1, reactor: 1, processor: 1, accessory: 0.9, module: 0.85, ability: 1, ultimate: 1.15 };

/** Affix roll quality 0..1 (tier position and roll inside the tier). 0.5 when there are no affixes. */
export function affixQuality(item: Pick<ItemInstance, 'affixes'>): number {
  if (!item.affixes.length) return 0.5;
  let s = 0;
  for (const a of item.affixes) s += ((Math.min(MAX_TIER, Math.max(1, a.tier)) - 1) / (MAX_TIER - 1)) * 0.6 + Math.min(1, Math.max(0, a.roll)) * 0.4;
  return s / item.affixes.length;
}

export function sumCost(...costs: Cost[]): Cost {
  const out: Cost = {};
  for (const c of costs) for (const k of RESOURCE_KEYS) if (c[k]) out[k] = (out[k] ?? 0) + (c[k] ?? 0);
  return out;
}

export function scaleCost(c: Cost, f: number): Cost {
  const out: Cost = {};
  for (const k of RESOURCE_KEYS) if (c[k]) out[k] = int((c[k] ?? 0) * f);
  return out;
}

export function isFree(c: Cost): boolean {
  return RESOURCE_KEYS.every((k) => !c[k]);
}

// ------------------------------------------------------------------ trade prices

/** Merchant markup over item value. Buying is always far above selling or dismantling. */
export const MARKUP = { equipment: 2.4, modules: 2.3 } as const;
/** Fraction of item value paid when the player sells. */
export const SELL_RATE = 0.3;

/** Credit value of an item (pricing basis). Enhancement is deliberately not included. */
export function itemValue(item: Pick<ItemInstance, 'level' | 'rarity' | 'category' | 'affixes'>): number {
  const q = affixQuality(item);
  return 18 * levelFactor(item.level) * RARITY_VALUE[ri(item)] * (CATEGORY_VALUE[item.category] ?? 1) * (0.8 + 0.4 * q);
}

export function buyPrice(item: Pick<ItemInstance, 'level' | 'rarity' | 'category' | 'affixes'>, merchant: 'equipment' | 'modules' = item.category === 'module' ? 'modules' : 'equipment'): number {
  return Math.max(1, Math.ceil(itemValue(item) * MARKUP[merchant]));
}

export function sellPrice(item: Pick<ItemInstance, 'level' | 'rarity' | 'category' | 'affixes'>): number {
  return Math.max(1, Math.floor(itemValue(item) * SELL_RATE));
}

// ------------------------------------------------------------------ dismantling

/** Category weight of dismantle output (weapons are mostly machinery). */
export const CATEGORY_SALVAGE: Record<Category, number> = { weapon: 1.2, armor: 1.1, shield: 1, reactor: 1, processor: 0.9, accessory: 0.9, module: 0.8, ability: 1, ultimate: 1.1 };
/**
 * Advanced components per rarity before level growth (fractions floor away: a rare yields
 * its first component around item level 28, an epic always yields at least one).
 */
export const COMPONENT_YIELD = [0, 0, 0.6, 1.5, 4, 8, 14] as const;
/** Rift shards recovered by dismantling (exotic, ascended). */
export const SHARD_YIELD = [0, 0, 0, 0, 0, 1, 5] as const;

export interface Yield {
  salvage: number;
  components: number;
  shards: number;
}

/**
 * Materials from dismantling an item. Grows with level, rarity, affix quality and the
 * enhancement invested (part of the investment is recovered). Installed modules are not
 * included: they return to storage intact.
 */
export function dismantleYield(item: Pick<ItemInstance, 'level' | 'rarity' | 'category' | 'affixes' | 'enhance'>): Yield {
  const L = clampLevel(item.level);
  const r = ri(item);
  const enh = Math.max(0, Math.min(MAX_ENHANCE_ANY, Math.floor(item.enhance ?? 0)));
  const salvage = (4 + 0.6 * (L - 1)) * (1 + 1.1 * r) * (CATEGORY_SALVAGE[item.category] ?? 1) * (0.9 + 0.2 * affixQuality(item)) * (1 + 0.25 * enh);
  const components = Math.floor(COMPONENT_YIELD[r] * (1 + (L - 1) / 40)) + Math.floor(enh / 3);
  return { salvage: Math.max(1, int(salvage)), components: int(Math.min(components, 1e6)), shards: SHARD_YIELD[r] };
}

// ------------------------------------------------------------------ enhancement

/** Maximum enhancement per rarity: better items can absorb more investment. */
export const MAX_ENHANCE = [4, 6, 8, 10, 12, 15, 18] as const;
export const MAX_ENHANCE_ANY = 18;

export const ENHANCE_EFFECT = {
  /** Weapons: base damage per level (multiplicative on the stored roll). */
  weaponDamage: 0.04,
  /** Weapons: cooling per level. */
  weaponCooling: 0.015,
  /** Armor, shields, reactors, processors, accessories: beneficial base (implicit) stats per level. */
  gearBase: 0.04,
  /** Modules: every beneficial stat (implicit and affixes) per level. */
  module: 0.05,
} as const;

/** Stats that are counts (never scaled by enhancement). */
const COUNT_STATS = new Set(['projectiles', 'pierce']);

export function maxEnhance(item: Pick<ItemInstance, 'rarity'>): number {
  return MAX_ENHANCE[ri(item)];
}

export function enhanceLevel(item: Pick<ItemInstance, 'enhance' | 'rarity'>): number {
  const v = Math.floor(item.enhance ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(maxEnhance(item), v)) : 0;
}

/**
 * Multiplier enhancement applies to one stored stat value of an item. Only beneficial
 * values grow (trade-off penalties such as Overcharge heat are never amplified).
 */
export function enhanceStatMult(item: Pick<ItemInstance, 'enhance' | 'rarity' | 'category'>, stat: keyof typeof STAT_DEFS, value: number, kind: 'base' | 'affix'): number {
  const lvl = enhanceLevel(item);
  if (lvl === 0 || COUNT_STATS.has(stat) || value === 0) return 1;
  const def = STAT_DEFS[stat];
  const beneficial = value > 0 === (def.better === 'higher');
  if (!beneficial) return 1;
  if (item.category === 'module') return 1 + ENHANCE_EFFECT.module * lvl;
  if (item.category === 'weapon') return 1;
  return kind === 'base' ? 1 + ENHANCE_EFFECT.gearBase * lvl : 1;
}

export function weaponEnhance(item: Pick<ItemInstance, 'enhance' | 'rarity' | 'category'>): { damage: number; cooling: number } {
  const lvl = item.category === 'weapon' ? enhanceLevel(item) : 0;
  return { damage: 1 + ENHANCE_EFFECT.weaponDamage * lvl, cooling: 1 + ENHANCE_EFFECT.weaponCooling * lvl };
}

/** Cost of raising an item from its current enhancement level to the next one. */
export function enhanceCost(item: Pick<ItemInstance, 'level' | 'rarity' | 'category' | 'enhance'>): Cost {
  const next = enhanceLevel(item) + 1;
  const r = ri(item);
  const f = levelFactor(item.level) * (1 + 0.5 * r) * (item.category === 'weapon' ? 1.2 : item.category === 'module' ? 0.8 : 1);
  return {
    salvage: int(20 * f * Math.pow(next, 1.35)),
    credits: int(15 * f * next),
    components: next >= 4 ? Math.ceil(((next - 3) * (1 + 0.5 * r)) / 2) : 0,
  };
}

// ------------------------------------------------------------------ affix engineering

export type RerollMode = 'stat' | 'value';

/** Escalation per engineering operation on the same item (linear, capped at ×10). */
export const REROLL_ESCALATION = 0.15;
export const REROLL_ESCALATION_CAP = 60;

export function escalation(count: number | undefined): number {
  return 1 + REROLL_ESCALATION * Math.min(REROLL_ESCALATION_CAP, Math.max(0, Math.floor(count ?? 0)));
}

/**
 * Affix engineering cost.
 *  - single 'stat'  : replace one affix with a new compatible affix (any stat)
 *  - single 'value' : keep the stat, reroll its tier and roll (cheaper)
 *  - full           : reroll every unlocked affix; each locked affix adds a surcharge
 *                     and advanced components (locking is never free)
 */
export function rerollCost(item: Pick<ItemInstance, 'level' | 'rarity' | 'rerolls'>, op: { kind: 'single'; mode: RerollMode } | { kind: 'full'; locks: number }): Cost {
  const r = ri(item);
  const f = levelFactor(item.level) * (1 + 0.6 * r) * escalation(item.rerolls);
  if (op.kind === 'single') {
    const m = op.mode === 'value' ? 0.7 : 1;
    return { salvage: int(14 * f * m), credits: int(10 * f * m), components: op.mode === 'stat' && r >= 3 ? 1 : 0 };
  }
  const locks = Math.max(0, Math.floor(op.locks));
  return { salvage: int(14 * f * 1.6 * (1 + 0.75 * locks)), credits: int(10 * f * 1.6), components: locks * Math.ceil((r + 1) / 2) };
}

// ------------------------------------------------------------------ component engineering

export function componentSwapCost(item: Pick<ItemInstance, 'level' | 'rarity' | 'mods'>, slot: string, premium: boolean): Cost {
  const r = ri(item);
  const f = levelFactor(item.level) * (1 + 0.5 * r);
  return {
    credits: int(30 * f * escalation(item.mods)),
    salvage: int(25 * f),
    components: premium ? 3 : slot === 'mechanism' ? 1 : 0,
  };
}

// ------------------------------------------------------------------ run income

/** Credits and components earned in survival (scaled by the threat tier's creditMult). */
export const RUN_INCOME = {
  /** Wave clear: base + per wave number. */
  waveCredits: (wave: number) => 8 + 2 * Math.max(1, wave),
  /** Checkpoint milestone bonus (with the banking). */
  checkpointCredits: (wave: number) => 30 + 6 * Math.max(1, wave),
  /** Checkpoint advanced components: per tier, +1 every 10 waves. */
  checkpointComponents: (wave: number, tier: number) => Math.max(1, tier) + Math.floor(Math.max(0, wave) / 10),
  /** Credits per kill by enemy kind (elites pay well). */
  killCredits: { walker: 1, rusher: 0, bulwark: 6 } as Record<string, number>,
  /** Chance an elite kill also yields an advanced component. */
  eliteComponentChance: 0.25,
  /** Rift shards (Ascended crafting): chance per elite kill (+ per modifier), boss kills, checkpoints on tier III+. */
  eliteShardChance: (mods: number) => Math.min(0.6, 0.12 + 0.05 * Math.max(0, mods)),
  bossShards: (tier: number) => 3 + Math.max(1, tier),
  checkpointShards: (wave: number, tier: number) => (tier >= 3 ? tier - 2 + Math.floor(Math.max(0, wave) / 20) : 0),
} as const;

// ------------------------------------------------------------------ merchants & exchange

export const MARKET = {
  equipmentSlots: 8,
  moduleSlots: 6,
  /** Manual manifest refresh: credits × (1 + refreshes this rotation). Free rotation after every run. */
  refreshCost: (n: number) => 60 * (1 + Math.min(20, Math.max(0, n))),
  /** Merchants never sell above epic (and never above the Rift Level's own drops): legendary and exotic gear stays a drop/fabrication prize. */
  maxRarity: 'epic' as const,
  /** The featured slot may stock a legendary from this Rift Level. */
  featuredLegendaryAt: 9,
  equipmentLuck: 1.5,
  moduleLuck: 1.8,
  /** Material exchange: fixed packs with limited stock per rotation (no selling back). */
  exchange: [
    { id: 'salvage_crate', label: 'Salvage crate', give: { salvage: 60 } as Cost, price: 150, stock: 3 },
    { id: 'component_cell', label: 'Advanced component', give: { components: 1 } as Cost, price: 90, stock: 2 },
  ],
} as const;

/** Reference exchange prices (credits per unit) used by exploit invariants. */
export const EXCHANGE_UNIT = { salvage: 150 / 60, components: 90 } as const;
