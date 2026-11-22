import { type RarityId, rarity } from './rarity';

/**
 * Physical loot in the arena.
 *
 * Lifetime rule (explicit, wave based): a pickup dropped during wave W stays collectible
 * through waves W, W+1 and W+2 and expires when wave W+2 is cleared. Expiry is only
 * evaluated on wave-clear events, so pauses, inventory inspection and preparation phases
 * never age loot.
 *
 * Saturation rule: once LOW_GRADE_LIMIT pickups lie in the arena, new drops below Rare
 * are converted to salvage at the moment they drop (they never appear, so nothing is
 * deleted). Rare and better always spawn physically; HARD_LIMIT only exists as a
 * last-resort guard and is far above what the lifetime rule allows in practice.
 */
export const LOOT_LIFETIME_WAVES = 2;
export const LOW_GRADE_LIMIT = 40;
export const HARD_LIMIT = 120;
export const PICKUP_RANGE = 3.4;
/** Focus height of the floating hologram above its ground point. */
export const HOLO_HEIGHT = 0.95;

export function expiresAfterWave(droppedWave: number): number {
  return droppedWave + LOOT_LIFETIME_WAVES;
}

export function isExpired(droppedWave: number, clearedWave: number): boolean {
  return clearedWave >= expiresAfterWave(droppedWave);
}

/** Whether a new drop of this rarity becomes salvage instead of a pickup. */
export function convertsToSalvage(count: number, r: RarityId): boolean {
  if (count >= HARD_LIMIT) return true;
  return count >= LOW_GRADE_LIMIT && rarity(r).index < 2;
}

