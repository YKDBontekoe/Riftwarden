import { rarity } from './rarity';
import type { ItemInstance } from './types';

/**
 * Small, explicit loot economy (pure). Full salvage/selling systems are M4; M2 only has:
 *  - scrapping unwanted stored items for salvage (storage management),
 *  - buying storage expansions with salvage (the first salvage sink),
 *  - converting low-grade overflow drops into salvage when the arena is saturated.
 */
export const STORAGE_EXPANSION = 10;

export function storageExpansionCost(expansionsOwned: number): number {
  const n = Math.max(0, Math.floor(expansionsOwned));
  return 150 + n * 100;
}

/** Salvage gained from dismantling an item: grows with level and rarity. */
export function scrapValue(item: Pick<ItemInstance, 'level' | 'rarity'>): number {
  const lvl = Math.max(1, Math.min(1e6, item.level));
  return Math.round((3 + lvl * 0.5) * (1 + rarity(item.rarity).index * 1.25));
}
