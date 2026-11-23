// Rolling a drop source into concrete items (pure: randomness, ids and tier numbers are injected).
// One implementation for single-player runs (Game), team drops and per-player rolls (ServerGame).
import { type DropSource, type LootContext, PITY_RESET, rollDrops } from './drops';
import { rarity } from './rarity';
import { generateItem } from './generate';
import { generateUnique, uniqueForDrop } from './uniques';
import type { ItemInstance } from './types';

export interface RollParams {
  source: DropSource;
  wave: number;
  /** Threat tier numbers that feed item level and luck. */
  tier: { lootLevelBonus: number; lootLuck: number; id?: number };
  /** The stream this roll consumes (run stream, or a player's own stream in co-op). */
  rand: () => number;
  /** Produces the next unique item uid (called once per generated item, in order). */
  nextUid: () => string;
  /** Recorded on the item (run id / team id). */
  originId: string;
  /** Debug/automation multiplier on every source's drop chance (1 = normal). */
  chanceMult?: number;
  /** Sector faction (faction-locked uniques); null on the classic arena. */
  faction?: string | null;
  /** Bad-luck protection counter (ordinary drops since the last legendary or better; see `nextPity`). */
  pity?: number;
}

/** A source with its chance scaled (clamped to 1). Returns the same object when the multiplier is 1. */
export function scaleChance(src: DropSource, mult: number): DropSource {
  return mult === 1 ? src : { ...src, chance: Math.min(1, src.chance * mult) };
}

export function lootContext(wave: number, tier: RollParams['tier'], pity = 0): LootContext {
  return { wave, tier: tier.id, tierLevelBonus: tier.lootLevelBonus, tierLuck: tier.lootLuck, pity };
}

/** Highest meaningful pity value (the boost caps at PITY.max / PITY.step drops). */
export const MAX_PITY = 1000;

/** The bad-luck counter after a roll: reset by a legendary or better, +1 per other item rolled. */
export function nextPity(pity: number, items: readonly Pick<ItemInstance, 'rarity'>[]): number {
  let p = Math.max(0, Math.floor(pity) || 0);
  for (const it of items) p = rarity(it.rarity).index >= PITY_RESET ? 0 : Math.min(MAX_PITY, p + 1);
  return p;
}

/** Roll the source and generate the items (deterministic for a given stream, ids and parameters). */
export function rollLoot(p: RollParams): ItemInstance[] {
  const table = scaleChance(p.source, p.chanceMult ?? 1);
  let unique = false;
  return rollDrops(table, lootContext(p.wave, p.tier, p.pity ?? 0), p.rand).map((d) => {
    // Target farming: at most one drop per trigger becomes a unique listed for this source (seed-decided).
    const u = unique ? null : uniqueForDrop(d.source, d.seed, p.faction);
    if (u) {
      unique = true;
      return generateUnique(u, { uid: p.nextUid(), seed: d.seed, level: d.level, source: p.originId });
    }
    return generateItem({
      uid: p.nextUid(),
      seed: d.seed,
      level: d.level,
      rarity: d.rarity,
      category: d.category,
      baseId: d.baseId,
      allowExclusive: d.baseId ? [d.baseId] : [],
      source: p.originId,
    });
  });
}
