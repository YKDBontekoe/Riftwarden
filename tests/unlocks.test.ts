// Staged feature unlocks (docs/progression-design.md §5): the track, loot locks, slot locks and the op gate.
import { describe, expect, it } from 'vitest';
import { xpForLevel } from '@riftwarden/rules/progression/level';
import { ALL_LOOT_LOCKS, isUnlocked, lockReason, lockedCategories, lockedFamilies, lootLocks, newlyUnlocked, nextUnlocks, opFeature, slotUnlocked, stationForUnlock, STATION_FEATURE, visibleCurrencies, unlockTrack, UNLOCKS } from '@riftwarden/rules/progression/unlocks';

const at = (warden: number, rl = 1) => ({ progress: { xp: xpForLevel(warden) }, threat: { unlocked: rl } });

describe('unlock track', () => {
  it('a new warden starts with plasma only; families open with Warden levels', () => {
    expect(lockedFamilies(at(1))).toEqual(['rail', 'beam', 'swarm']);
    expect(lockedFamilies(at(3))).toEqual(['beam', 'swarm']);
    expect(lockedFamilies(at(12))).toEqual([]);
    expect(lockedCategories(at(1))).toEqual(['ultimate', 'module']);
    expect(lockedCategories(at(7, 3))).toEqual([]);
  });

  it('loot locks are sorted, known, and shrink as the warden grows', () => {
    const l = lootLocks(at(1));
    expect(l).toEqual([...l].sort());
    for (const x of l) expect(ALL_LOOT_LOCKS).toContain(x);
    // Only mastery components stay locked once every staged unlock is open.
    expect(lootLocks(at(30, 30)).every((l) => l.startsWith('comp:'))).toBe(true);
  });

  it('slots, ops and reasons follow the track', () => {
    expect(slotUnlocked(at(1), 'weapon')).toBe(true);
    expect(slotUnlocked(at(1), 'weapon2')).toBe(false);
    expect(slotUnlocked(at(4), 'weapon2')).toBe(true);
    expect(opFeature('buyItem', ['modules'])).toBe('station:modules');
    expect(opFeature('buyItem', ['equipment'])).toBe('station:merchant');
    expect(opFeature('equipFromStorage', [])).toBeNull();
    expect(lockReason(at(1), 'station:fabricate')).toBe('Fabricator unlocks at Warden level 10.');
    expect(lockReason(at(10), 'station:fabricate')).toBeNull();
    expect(isUnlocked(at(1, 2), 'workshop:enhance')).toBe(true);
  });

  it('the track lists every unlock with progress; the next goals are the closest', () => {
    const t = unlockTrack(at(2, 2));
    expect(t.length).toBe(UNLOCKS.length);
    expect(t.find((e) => e.def.id === 'slot:ability2')!.open).toBe(true);
    const next = nextUnlocks(at(2, 2));
    expect(next.length).toBe(3);
    expect(next.every((e) => !e.open)).toBe(true);
    expect(next[0].progress).toBeGreaterThanOrEqual(next[2].progress);
    expect(new Set(UNLOCKS.map((u) => u.id)).size).toBe(UNLOCKS.length);
  });

  it('every station and workshop unlock powers up a station (unlock card marks it)', () => {
    for (const u of UNLOCKS.filter((x) => x.kind === 'station' || x.id.startsWith('workshop:'))) expect(stationForUnlock(u.id), u.id).toBeTruthy();
    for (const [station, feature] of Object.entries(STATION_FEATURE)) expect(stationForUnlock(feature)).toBe(station);
    expect(stationForUnlock('workshop:affixes')).toBe('workshop');
    expect(stationForUnlock('family:rail')).toBeNull();
  });

  it('a fresh warden sees credits only; other currencies appear when held or when a system spends them', () => {
    const res = { credits: 200, salvage: 0, components: 0, shards: 0 };
    const fresh = { progress: { xp: 0 }, threat: { unlocked: 1 }, resources: res };
    expect(visibleCurrencies(fresh)).toEqual(['credits']);
    expect(visibleCurrencies({ ...fresh, resources: { ...res, salvage: 12 } })).toEqual(['credits', 'salvage']);
    // Reclamation Press (Warden 3) uses salvage; RL 2 opens enhancement (components).
    expect(visibleCurrencies({ ...fresh, progress: { xp: xpForLevel(3) } })).toContain('salvage');
    expect(visibleCurrencies({ ...fresh, threat: { unlocked: 2 } })).toContain('components');
    expect(visibleCurrencies({ ...fresh, threat: { unlocked: 14 }, progress: { xp: xpForLevel(20) } })).toEqual(['credits', 'salvage', 'components', 'shards']);
  });

  it('reports what a level-up opened', () => {
    expect(newlyUnlocked(at(2), at(4)).map((u) => u.id)).toEqual(['family:rail', 'station:salvage', 'slot:weapon2']);
    expect(newlyUnlocked(at(4, 2), at(4, 3)).map((u) => u.id)).toEqual(['station:modules', 'workshop:towers']);
  });
});
