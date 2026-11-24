// "Is this better?" for the pickup the drone is aiming at: NEW BEST against everything owned (profile + run cargo),
// the build-aware swap verdict against the slot it would fill, and the item level against the level's baseline.
// Computed once per targeted item (cached by uid), so the 20 Hz HUD never re-scores a loadout.
import { bestKey, bestPowers, isNewBest, levelDelta } from '@riftwarden/rules/loot/feedback';
import { swapImpact, type Verdict } from '@riftwarden/rules/loot/loadoutScore';
import type { ItemInstance } from '@riftwarden/rules/loot/types';

export interface LootVerdict {
  newBest: boolean;
  verdict: Verdict | null;
  levelDelta: number;
}

export interface LootVerdictHost {
  /** Best owned power per kind at deployment (profile items). */
  readonly ownedBest: ReadonlyMap<string, number>;
  /** Items of the run (equipped + cargo). */
  runItems(): readonly ItemInstance[];
  equippedList(): readonly (ItemInstance | null)[];
  /** Item in the slot this item would fill. */
  replaced(item: ItemInstance): ItemInstance | null;
  /** Drop baseline item level of a wave on this level. */
  baseline(wave: number): number;
}

export class LootVerdicts {
  private cache = new Map<string, LootVerdict>();

  constructor(private h: LootVerdictHost) {}

  /** Inventory changed: verdicts against the loadout and the best owned items may differ now. */
  reset(): void {
    this.cache.clear();
  }

  of(item: ItemInstance, droppedWave: number): LootVerdict {
    const hit = this.cache.get(item.uid);
    if (hit) return hit;
    const owned = new Map(this.h.ownedBest);
    for (const [k, v] of bestPowers(this.h.runItems().filter((i) => i.uid !== item.uid))) owned.set(k, Math.max(owned.get(k) ?? 0, v));
    const v: LootVerdict = {
      newBest: isNewBest(item, owned),
      verdict: item.category === 'module' ? null : swapImpact(this.h.equippedList(), item, this.h.replaced(item), undefined, 'build').verdict,
      levelDelta: levelDelta(item.level, this.h.baseline(droppedWave)),
    };
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(item.uid, v);
    return v;
  }
}

export { bestKey };
