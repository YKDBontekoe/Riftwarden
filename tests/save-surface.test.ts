// The save barrel must keep exporting the surface the rest of the app (and server) imports.
// Names captured from the pre-split src/progression/save.ts; additions are fine, removals are not.
import { describe, expect, it } from 'vitest';
import * as save from '@riftwarden/rules/progression/save';

const RUNTIME_EXPORTS = [
  'ANNEX_BAYS',
  'BACKUP_KEY',
  'CORRUPT_KEY',
  'DEFAULT_FACILITIES',
  'HISTORY_LIMIT',
  'MIGRATIONS',
  'PRESET_COUNT',
  'SAVE_KEY',
  'SAVE_VERSION',
  'STORAGE_CAPACITY',
  'TX_HISTORY',
  'allOwnedUids',
  'applyLoadout',
  'bankRewards',
  'beginRun',
  'checksum',
  'createDefaultSave',
  'deployBlocker',
  'emptyEconomy',
  'emptyRecord',
  'equipFromStorage',
  'equippedItem',
  'equippedItems',
  'expandStorage',
  'facilityCount',
  'installModule',
  'itemByUid',
  'loadPreset',
  'loadSave',
  'marketProgress',
  'migrate',
  'moduleRemovalCost',
  'parseSave',
  'recordRun',
  'resolveInterruptedRun',
  'rotateMarket',
  'sanitizeItem',
  'sanitizeSave',
  'sanitizeTowerTech',
  'savePreset',
  'scrapItem',
  'selectTier',
  'serializeSave',
  'slotOf',
  'storageOverCapacity',
  'storedItems',
  'transferModule',
  'unequipToStorage',
  'uninstallModule',
  'writeSave',
  'isSlotId',
];

describe('progression/save barrel', () => {
  it('still exports every runtime symbol of the original module', () => {
    const have = new Set(Object.keys(save));
    expect(RUNTIME_EXPORTS.filter((n) => !have.has(n))).toEqual([]);
  });
  it('keeps the on-disk constants stable', () => {
    expect(save.SAVE_KEY).toBe('riftwarden.save');
    expect(save.BACKUP_KEY).toBe('riftwarden.save.bak');
    expect(save.CORRUPT_KEY).toBe('riftwarden.save.corrupt');
    expect(save.SAVE_VERSION).toBeGreaterThanOrEqual(7);
  });
});
