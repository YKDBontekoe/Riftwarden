// Reclamation "all downgrades": picks build downgrades, never the strongest owned item of its kind.
import { describe, expect, it } from 'vitest';
import { downgradePicks } from '@riftwarden/rules/loot/dismantlePick';

const it_ = (uid: string, level: number, rarity = 'common', category = 'armor') => ({ uid, category: category as 'armor', defId: '', level, rarity: rarity as 'common' });

describe('downgradePicks', () => {
  it('picks downgrades that are not the best of their kind', () => {
    const owned = [it_('worn', 30, 'epic'), it_('a', 5), it_('b', 8)];
    const r = downgradePicks([{ item: owned[1], verdict: 'downgrade' }, { item: owned[2], verdict: 'downgrade' }], owned);
    expect(r.sort()).toEqual(['a', 'b']);
  });
  it('keeps the strongest owned item of its kind even when it is a downgrade for the build', () => {
    const owned = [it_('top', 40, 'legendary', 'shield'), it_('low', 3, 'common', 'shield')];
    expect(downgradePicks([{ item: owned[0], verdict: 'downgrade' }, { item: owned[1], verdict: 'downgrade' }], owned)).toEqual(['low']);
  });
  it('ignores upgrades, sidegrades and unknown verdicts', () => {
    const owned = [it_('x', 50, 'epic'), it_('u', 1), it_('s', 1), it_('n', 1)];
    expect(downgradePicks([{ item: owned[1], verdict: 'upgrade' }, { item: owned[2], verdict: 'sidegrade' }, { item: owned[3], verdict: null }], owned)).toEqual([]);
  });
});
