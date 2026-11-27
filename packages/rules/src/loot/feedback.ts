// Loot feedback (docs/design/progression-design.md §6): "is this better?" made obvious. NEW BEST (beats every owned item of
// its slot kind; weapons per family), item level against the level's baseline, the best finds of a run and the power
// gained since the previous run. Pure: the pickup prompt, item cards, world labels and the run summary read it.
import { itemPower } from '../progression/riftLevel';
import { baseDef } from './bases';
import type { ItemInstance } from './types';

/** What an item is compared against for NEW BEST: its category, and its family for weapons. */
export function bestKey(it: Pick<ItemInstance, 'category' | 'defId'>): string {
  const fam = it.category === 'weapon' ? baseDef(it.defId)?.weapon?.family : undefined;
  return fam ? `weapon:${fam}` : it.category;
}

/** Best owned power per key (profile items + run cargo). */
export function bestPowers(items: readonly (Pick<ItemInstance, 'category' | 'defId' | 'level' | 'rarity' | 'uid'> | null | undefined)[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    if (!it || it.category === 'module') continue;
    const k = bestKey(it);
    out.set(k, Math.max(out.get(k) ?? 0, itemPower(it)));
  }
  return out;
}

/**
 * Does `it` beat every owned item of its kind? (Modules never; the first item of a new kind is a new best.)
 * `owned` must not contain `it` itself.
 */
export function isNewBest(it: Pick<ItemInstance, 'category' | 'defId' | 'level' | 'rarity'>, owned: ReadonlyMap<string, number>): boolean {
  if (it.category === 'module') return false;
  return itemPower(it) > (owned.get(bestKey(it)) ?? 0) * 1.0001;
}

/** Item level against the drop baseline of the level and wave (+3 = three levels above what this wave usually drops). */
export const levelDelta = (itemLevel: number, baseline: number): number => Math.round(itemLevel - baseline);

/** The best finds of a run (highest power first). */
export function bestFinds<T extends Pick<ItemInstance, 'level' | 'rarity'>>(items: readonly T[], n = 3): T[] {
  return [...items].sort((a, b) => itemPower(b) - itemPower(a)).slice(0, n);
}

/** Relative change of loadout power (0.12 = +12%). */
export const powerGain = (before: number, after: number): number => (before > 0 ? after / before - 1 : 0);
