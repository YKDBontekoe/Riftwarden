// After a run: which secured items are upgrades for the build, and the slot each would go to (pure). The run summary
// offers to equip them in one step; each suggestion is applied through the named `equipFromStorage` op.
import { loadoutScore, type ScoreContext, swapImpact } from '../loot/loadoutScore';
import type { ItemInstance } from '../loot/types';
import { slotsFor, type SlotId } from './items';
import { equippedItem, equippedItems, itemByUid } from './save/ownership';
import type { SaveData } from './save/types';
import { lockedSlots } from './unlocks';

export interface GearSuggestion {
  uid: string;
  name: string;
  slot: SlotId;
  /** Item it replaces (null = empty slot). */
  replaces: string | null;
  /** Weighted relative gain of the whole loadout (build priority). */
  score: number;
}

/**
 * Stored items among `uids` that improve the loadout, at most one per slot and one slot per item, best first.
 * Weapons only suggest the primary slot (the secondary is a deliberate choice) unless the secondary slot is empty.
 */
export function suggestEquips(d: SaveData, uids: readonly string[], ctx: ScoreContext = {}): GearSuggestion[] {
  const locked = lockedSlots(d);
  const worn = equippedItems(d);
  const base = loadoutScore(worn, ctx);
  const options: GearSuggestion[] = [];
  for (const uid of new Set(uids)) {
    if (!d.storage.uids.includes(uid)) continue;
    const item: ItemInstance | null = itemByUid(d, uid);
    if (!item) continue;
    for (const slot of slotsFor(item.category)) {
      if (locked.includes(slot)) continue;
      const replaced = equippedItem(d, slot);
      if (slot === 'weapon2' && replaced) continue;
      const impact = swapImpact(worn, item, replaced, base, 'build', undefined, ctx);
      if (impact.verdict === 'upgrade') options.push({ uid, name: item.name, slot, replaces: replaced?.uid ?? null, score: impact.score });
    }
  }
  options.sort((a, b) => b.score - a.score);
  const out: GearSuggestion[] = [];
  for (const o of options) if (!out.some((x) => x.uid === o.uid || x.slot === o.slot)) out.push(o);
  return out;
}
