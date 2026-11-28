// Loot filter: thresholds by rarity, upgrades-only, and the drops that always pass.
import { describe, expect, it } from 'vitest';
import { LOOT_FILTERS, passesLootFilter } from '@riftwarden/rules/loot/filter';
import { sanitizeSettings } from '@riftwarden/game/core/settings';

const none = { upgrade: false, newBest: false, unique: false };

describe('passesLootFilter', () => {
  it('thresholds by rarity', () => {
    expect(passesLootFilter('all', 0, none)).toBe(true);
    expect(passesLootFilter('uncommon', 0, none)).toBe(false);
    expect(passesLootFilter('uncommon', 1, none)).toBe(true);
    expect(passesLootFilter('rare', 1, none)).toBe(false);
    expect(passesLootFilter('epic', 3, none)).toBe(true);
  });
  it('upgrades-only keeps upgrades', () => {
    expect(passesLootFilter('upgrades', 3, none)).toBe(false);
    expect(passesLootFilter('upgrades', 0, { ...none, upgrade: true })).toBe(true);
  });
  it('new bests, uniques and legendary+ always pass', () => {
    for (const f of LOOT_FILTERS) {
      expect(passesLootFilter(f, 0, { ...none, newBest: true })).toBe(true);
      expect(passesLootFilter(f, 0, { ...none, unique: true })).toBe(true);
      expect(passesLootFilter(f, 4, none)).toBe(true);
    }
  });
  it('the setting defaults to all and rejects unknown values', () => {
    expect(sanitizeSettings({}).lootFilter).toBe('all');
    expect(sanitizeSettings({ lootFilter: 'rare' }).lootFilter).toBe('rare');
    expect(sanitizeSettings({ lootFilter: 'junk' }).lootFilter).toBe('all');
  });
});
