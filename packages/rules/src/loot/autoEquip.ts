// "Equip best for my build" (Loadout terminal): a greedy search over stored items that repeatedly takes the single swap
// raising the build score most, until no swap is an upgrade. It uses the same build-aware scoring as the upgrade arrows
// (swapImpact with the player's comparison priority), so the result agrees with what the item cards say. Pure: the
// caller applies the steps through the existing equipFromStorage op (one op per step, so sync and replay are unchanged).
import { type ComparisonPriority, loadoutScore, type ScoreContext, swapImpact } from './loadoutScore';
import type { ItemInstance } from './types';
import { fitsSlot, SLOTS, type SlotId } from '../progression/items';

export interface EquipStep {
  uid: string;
  slot: SlotId;
  /** Weighted score gain of this step (impact score). */
  score: number;
}

/** Below this weighted gain a swap is noise, not an upgrade. */
const MIN_GAIN = 0.005;

/**
 * Swaps that improve the loadout, best first. `equipped` follows SLOTS order; `locked` slots are skipped. Items
 * replaced by a step return to the candidate pool (a later step may move them to another slot of the same kind).
 */
export function bestLoadoutSteps(equipped: readonly (ItemInstance | null)[], stored: readonly ItemInstance[], opts: { locked?: readonly SlotId[]; priority?: ComparisonPriority; ctx?: ScoreContext; maxSteps?: number } = {}): EquipStep[] {
  const cur = SLOTS.map((_, i) => equipped[i] ?? null);
  const pool = [...stored];
  const steps: EquipStep[] = [];
  const max = opts.maxSteps ?? SLOTS.length * 2;
  for (let n = 0; n < max; n++) {
    const base = loadoutScore(cur, opts.ctx);
    let best: { i: number; item: ItemInstance; score: number } | null = null;
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i].id;
      if (opts.locked?.includes(slot)) continue;
      for (const item of pool) {
        if (!fitsSlot(item, slot)) continue;
        const imp = swapImpact(cur, item, cur[i], base, opts.priority ?? 'build', i, opts.ctx);
        if (imp.verdict === 'upgrade' && imp.score > MIN_GAIN && (!best || imp.score > best.score)) best = { i, item, score: imp.score };
      }
    }
    if (!best) break;
    const prev = cur[best.i];
    cur[best.i] = best.item;
    pool.splice(pool.indexOf(best.item), 1);
    if (prev) pool.push(prev);
    steps.push({ uid: best.item.uid, slot: SLOTS[best.i].id, score: best.score });
  }
  return steps;
}
