// Reclamation press quick-select: "all downgrades" picks the stored items that would lower the build score in the slot
// they would take, but never the strongest owned item of its kind (a future build may want it). Pure: verdicts are
// computed by the caller (build-aware scoring), the "best of its kind" check runs on the owned items here.
import { bestPowers, isNewBest } from './feedback';
import type { Verdict } from './loadoutScore';
import type { ItemInstance } from './types';

type Owned = Pick<ItemInstance, 'uid' | 'category' | 'defId' | 'level' | 'rarity'>;

export function downgradePicks(cands: readonly { item: Owned; verdict: Verdict | null }[], owned: readonly Owned[]): string[] {
  return cands
    .filter(({ item, verdict }) => verdict === 'downgrade' && !isNewBest(item, bestPowers(owned.filter((o) => o.uid !== item.uid))))
    .map(({ item }) => item.uid);
}
