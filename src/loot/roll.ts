// Rolling a drop source into concrete items (pure: randomness, ids and tier numbers are injected).
// One implementation for single-player runs (Game), team drops and per-player rolls (ServerGame).
import { type DropSource, type LootContext, rollDrops } from './drops';
import { generateItem } from './generate';
import type { ItemInstance } from './types';

export interface RollParams {
  source: DropSource;
  wave: number;
  /** Threat tier numbers that feed item level and luck. */
  tier: { lootLevelBonus: number; lootLuck: number };
  /** The stream this roll consumes (run stream, or a player's own stream in co-op). */
  rand: () => number;
  /** Produces the next unique item uid (called once per generated item, in order). */
  nextUid: () => string;
  /** Recorded on the item (run id / team id). */
  originId: string;
  /** Debug/automation multiplier on every source's drop chance (1 = normal). */
  chanceMult?: number;
}

/** A source with its chance scaled (clamped to 1). Returns the same object when the multiplier is 1. */
export function scaleChance(src: DropSource, mult: number): DropSource {
  return mult === 1 ? src : { ...src, chance: Math.min(1, src.chance * mult) };
}

export function lootContext(wave: number, tier: RollParams['tier']): LootContext {
  return { wave, tierLevelBonus: tier.lootLevelBonus, tierLuck: tier.lootLuck };
}

/** Roll the source and generate the items (deterministic for a given stream, ids and parameters). */
export function rollLoot(p: RollParams): ItemInstance[] {
  const table = scaleChance(p.source, p.chanceMult ?? 1);
  return rollDrops(table, lootContext(p.wave, p.tier), p.rand).map((d) =>
    generateItem({
      uid: p.nextUid(),
      seed: d.seed,
      level: d.level,
      rarity: d.rarity,
      category: d.category,
      baseId: d.baseId,
      allowExclusive: d.baseId ? [d.baseId] : [],
      source: p.originId,
    }),
  );
}
