// Run summary "equip upgrades": which secured items improve the build, one per slot, applied through the named op.
import { describe, expect, it } from 'vitest';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { suggestEquips } from '@riftwarden/rules/progression/gearSuggest';
import { runOp } from '@riftwarden/rules/progression/ops';
import { createDefaultSave, equippedItem } from '@riftwarden/rules/progression/save';
import type { ItemInstance } from '@riftwarden/rules/loot/types';

const store = (d: ReturnType<typeof createDefaultSave>, it: ItemInstance) => {
  d.items.push(it);
  d.storage.uids.push(it.uid);
  return it;
};

describe('equip suggestions after a run', () => {
  it('suggests gear for empty slots, the better of two items per slot, and nothing that is worse', () => {
    const d = createDefaultSave(1, { profileId: 'p1', starterUid: 'starter' });
    const armorA = store(d, generateItem({ uid: 'a1', seed: 1, level: 8, rarity: 'rare', category: 'armor', source: 't', now: 1 }));
    const armorB = store(d, generateItem({ uid: 'a2', seed: 2, level: 2, rarity: 'common', category: 'armor', source: 't', now: 1 }));
    const weak = store(d, generateItem({ uid: 'w1', seed: 3, level: 1, rarity: 'common', baseId: 'plasma_light', source: 't', now: 1, fixedRoll: 0 }));
    const s = suggestEquips(d, [armorA.uid, armorB.uid, weak.uid, 'missing']);
    const armor = s.filter((x) => x.slot === 'armor');
    expect(armor.length).toBe(1);
    expect(armor[0].uid).toBe('a1');
    expect(armor[0].replaces).toBeNull();
    expect(s.some((x) => x.uid === 'w1' && x.slot === 'weapon')).toBe(false);
    // Applying every suggestion through the op equips them.
    for (const g of s) expect(runOp(d, 'equipFromStorage', [g.uid, g.slot], 'tx' + g.uid, 1).ok).toBe(true);
    expect(equippedItem(d, 'armor')?.uid).toBe('a1');
    // Nothing left to suggest.
    expect(suggestEquips(d, [armorA.uid, armorB.uid]).filter((x) => x.slot === 'armor')).toEqual([]);
  });
});
