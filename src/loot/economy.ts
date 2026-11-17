import { dismantleYield } from '../economy/config';
import type { ItemInstance } from './types';

/**
 * Small, explicit loot economy (pure). M4 pricing/yields live in economy/config.ts; this keeps:
 *  - scrapping unwanted stored items for salvage (storage management),
 *  - buying storage expansions with salvage (the first salvage sink),
 *  - converting low-grade overflow drops into salvage when the arena is saturated.
 */
export const STORAGE_EXPANSION = 10;

export function storageExpansionCost(expansionsOwned: number): number {
  const n = Math.max(0, Math.floor(expansionsOwned));
  return 150 + n * 100;
}

/** Salvage gained from dismantling an item (M4: see economy/config dismantleYield). */
export function scrapValue(item: Pick<ItemInstance, 'level' | 'rarity' | 'category' | 'affixes' | 'enhance'>): number {
  return dismantleYield(item).salvage;
}
