// Rift Levels (docs/progression-design.md §1-3, §9, §11): endless levels, checkpoint unlocks, Rift Surges and their
// validation, item level from the level, readiness, and the v11 progression restart.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { DROP_SOURCES, PITY_RESET } from '@riftwarden/rules/loot/drops';
import { hashSeed } from '@riftwarden/rules/loot/generate';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { nextPity, rollLoot } from '@riftwarden/rules/loot/roll';
import { gearPower, levelLoot, readiness, recommendedLevel, unlockProgress } from '@riftwarden/rules/progression/riftLevel';
import { RunLedger } from '@riftwarden/rules/progression/run';
import { checkRunEntry, replayLoot } from '@riftwarden/rules/progression/runCheck';
import type { LootRecord } from '@riftwarden/rules/progression/runRules';
import { applyRunEntry } from '@riftwarden/rules/progression/runRules';
import { bankRewards, beginRun, checksum, createDefaultSave, parseSave, runLevel, sanitizeSave, saveMapProgress, SAVE_VERSION } from '@riftwarden/rules/progression/save';
import { getTier, levelBase, lootLevel } from '@riftwarden/rules/progression/tiers';
import { canSurge, maxSurges, newMapState, sanitizeMapState } from '@riftwarden/rules/runmap/state';
import { emptyRewards } from '@riftwarden/rules/progression/run';

const NOW = 1_800_000_000_000;
const cp = (n = 0) => ({ ...emptyRewards(), salvage: n });

describe('Rift Levels', () => {
  it('item level comes from the level and joins up between levels', () => {
    for (let rl = 1; rl <= 30; rl++) {
      const t = getTier(rl);
      expect(t.lootLevelBonus).toBe(levelBase(rl));
      expect(lootLevel(t, 1)).toBe(levelBase(rl));
      // The deepest wave band of one level ends right below the next level's first wave.
      expect(lootLevel(t, 10_000)).toBe(levelBase(rl + 1) - 1);
    }
    expect(levelLoot(9).levels).toEqual([81, 90]);
  });

  it('checkpoints unlock the next level on the level actually played (surges included)', () => {
    const d = createDefaultSave(NOW);
    beginRun(d, 'r1', 1, NOW);
    expect(bankRewards(d, 'r1', 5, cp())).toBe(true);
    expect(d.threat.unlocked).toBe(2);
    // RL 2 needs two checkpoints on RL 2.
    beginRun(d, 'r2', 2, NOW);
    bankRewards(d, 'r2', 5, cp());
    expect(d.threat.unlocked).toBe(2);
    expect(unlockProgress(d.records, 2)).toEqual({ level: 3, have: 1, need: 2 });
    bankRewards(d, 'r2', 10, cp());
    expect(d.threat.unlocked).toBe(3);
    // A surged map run counts its checkpoints on the surged level.
    beginRun(d, 'r3', 2, NOW, { mapSeed: 77 });
    d.activeRun!.map!.surge = 1;
    expect(runLevel(d.activeRun!)).toBe(3);
    bankRewards(d, 'r3', 5, cp());
    expect(d.records['3'].checkpoints).toBe(1);
    expect(d.records['2'].checkpoints).toBe(2);
  });

  it('readiness and the recommended level follow gear power', () => {
    const starter = gearPower([{ level: 1, rarity: 'common' }]);
    expect(readiness(starter, 1)).not.toBe('deadly');
    expect(readiness(starter, 12)).toBe('deadly');
    expect(recommendedLevel(starter, 20)).toBeLessThanOrEqual(2);
    const geared = gearPower(Array.from({ length: 7 }, () => ({ level: 95, rarity: 'epic' as const })));
    const rec = recommendedLevel(geared, 40);
    expect(rec).toBeGreaterThanOrEqual(9);
    expect(rec).toBeLessThan(14);
    expect(recommendedLevel(geared, 3)).toBe(3);
    // Only the best seven pieces count; extra junk never lowers power.
    expect(gearPower([...Array.from({ length: 7 }, () => ({ level: 95, rarity: 'epic' as const })), { level: 1, rarity: 'common' }])).toBeCloseTo(geared);
  });
});

describe('Rift Surge', () => {
  it('opens after two nodes, then every three, never into a boss sector', () => {
    const m = { ...newMapState(9), cleared: 1 };
    expect(canSurge(m)).toBe(false);
    expect(canSurge({ ...m, cleared: 2 })).toBe(true);
    expect(canSurge({ ...m, cleared: 4, surge: 1, surgeAt: 3 })).toBe(false);
    expect(canSurge({ ...m, cleared: 6, surge: 1, surgeAt: 3 })).toBe(true);
    expect(maxSurges(0)).toBe(0);
    expect(maxSurges(2)).toBe(1);
    expect(maxSurges(5)).toBe(2);
    expect(maxSurges(1e6)).toBe(50);
  });

  it('sanitize and map entries cannot claim surges that were never taken', () => {
    expect(sanitizeMapState({ ...newMapState(9), cleared: 2, surge: 40 })!.surge).toBe(1);
    expect(sanitizeMapState({ ...newMapState(9), cleared: 0, surge: 3 })!.surge).toBeUndefined();
    const d = createDefaultSave(NOW);
    beginRun(d, 'rs', 4, NOW, { mapSeed: 12 });
    const a = d.activeRun!;
    // A forged jump: ten nodes and ten surges in one entry -> one node, one surge (if the spacing allows).
    expect(saveMapProgress(d, 'rs', { ...a.map!, cleared: 10, surge: 10, surgeAt: 10 })).toBe(true);
    expect(a.map!.cleared).toBe(1);
    expect(a.map!.surge ?? 0).toBe(0);
    for (let i = 0; i < 2; i++) saveMapProgress(d, 'rs', { ...a.map!, cleared: a.map!.cleared + 1, surge: (a.map!.surge ?? 0) + 1 });
    expect(a.map!.cleared).toBe(3);
    expect(a.map!.surge).toBe(1);
    // A different war seed is refused.
    expect(saveMapProgress(d, 'rs', { ...a.map!, seed: 99 })).toBe(false);
  });

  it('the server accepts loot of surged levels only up to the surges taken', () => {
    const runId = 'run_surge';
    const rand = mulberry32((hashSeed(runId) ^ 0) >>> 0);
    let counter = 0;
    const t = getTier(5);
    const rec: LootRecord = { node: null, draw: 0, counter: 0, source: DROP_SOURCES.checkpoint, wave: 5, tier: { lootLevelBonus: t.lootLevelBonus, lootLuck: t.lootLuck, id: 5 }, faction: null };
    const items = rollLoot({ source: DROP_SOURCES.checkpoint, wave: 5, tier: rec.tier, rand, nextUid: () => `${runId}.${++counter}`, originId: runId, faction: null });
    expect(items.length).toBeGreaterThan(0);
    expect(replayLoot(runId, 4, 0, [rec])).toBe('tier mismatch');
    const ok = replayLoot(runId, 4, 0, [rec], 1);
    expect(typeof ok).not.toBe('string');
    expect((ok as Map<string, unknown>).size).toBe(items.length);
    expect(replayLoot(runId, 4, 0, [{ ...rec, tier: { ...rec.tier, lootLevelBonus: 999 } }], 1)).toBe('loot level altered');
    expect(replayLoot(runId, 4, 0, [{ ...rec, pity: -1 }], 1)).toBe('bad loot record');
  });
});

describe('bad-luck protection', () => {
  it('rides the ledger and resumes, and the server replays rolls with it', () => {
    const run = new RunLedger('rp', 9, NOW);
    run.pity = 37;
    const back = new RunLedger('rp', 9, NOW);
    back.restore(run.exportState());
    expect(back.pity).toBe(37);
    const runId = 'run_pity';
    const t = getTier(30);
    const tier = { lootLevelBonus: t.lootLevelBonus, lootLuck: t.lootLuck, id: 30 };
    const roll = (pity: number) => {
      let c = 0;
      return rollLoot({ source: { ...DROP_SOURCES.walker, chance: 1, rolls: 3 }, wave: 3, tier, rand: mulberry32(5), nextUid: () => `${runId}.${++c}`, originId: runId, faction: null, pity });
    };
    // Pity changes which rarity a draw lands on, so the server must replay with the recorded counter.
    let differs = false;
    for (let seed = 0; seed < 50_000 && !differs; seed++) {
      const a = rollLoot({ source: { ...DROP_SOURCES.walker, chance: 1 }, wave: 3, tier, rand: mulberry32(seed), nextUid: () => 'x', originId: runId, pity: 0 });
      const b = rollLoot({ source: { ...DROP_SOURCES.walker, chance: 1 }, wave: 3, tier, rand: mulberry32(seed), nextUid: () => 'x', originId: runId, pity: 200 });
      differs = a[0].rarity !== b[0].rarity;
    }
    expect(differs).toBe(true);
    expect(roll(10).length).toBe(3);
    const items = roll(10);
    const expected = items.reduce((p, it) => (rarity(it.rarity).index >= PITY_RESET ? 0 : p + 1), 10);
    expect(nextPity(10, items)).toBe(expected);
  });
});

describe('save v11: progression restart', () => {
  const veteran = () => {
    const d = createDefaultSave(NOW - 1e9, { profileId: 'pf_vet' });
    d.resources.credits = 99_999;
    d.threat.unlocked = 5;
    d.progress.xp = 5_000_000;
    d.tutorial.done = ['move', 'deploy'];
    d.profile.callsign = 'ACE';
    return d;
  };
  const asV10 = (d: object) => {
    const body = JSON.stringify({ ...d, version: 10 });
    return `{"v":10,"sum":"${checksum(body)}","data":${body}}`;
  };

  it('resets progression but keeps identity and tutorial, deterministically', () => {
    const a = parseSave(asV10(veteran()), NOW);
    const b = parseSave(asV10(veteran()), NOW + 5000);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(SAVE_VERSION).toBe(11);
    expect(a.migratedFrom).toBe(10);
    expect(a.data.profile.id).toBe('pf_vet');
    expect(a.data.profile.callsign).toBe('ACE');
    expect(a.data.tutorial.done).toEqual(['move', 'deploy']);
    expect(a.data.threat).toEqual({ selected: 1, unlocked: 1 });
    expect(a.data.progress.xp).toBe(0);
    expect(a.data.items.length).toBe(1);
    expect(a.data.wiped?.from).toBe(10);
    // Same stored profile -> same migrated document on every device and on the server.
    expect(a.data.items[0].uid).toBe(b.data.items[0].uid);
    expect(JSON.stringify(a.data.market)).toBe(JSON.stringify(b.data.market));
    // The notice survives sanitize; current saves never get it.
    expect(sanitizeSave(a.data, NOW).data.wiped).toEqual(a.data.wiped);
    expect(createDefaultSave(NOW).wiped).toBeUndefined();
  });

  it('a synced run start may pick any unlocked Rift Level', () => {
    const d = createDefaultSave(NOW);
    d.threat.unlocked = 40;
    expect(checkRunEntry(d, { kind: 'start', runId: 'r40', tier: 40, at: NOW, mapSeed: 0, mode: 'defense', select: true }, NOW)).toBeNull();
    expect(checkRunEntry(d, { kind: 'start', runId: 'r41', tier: 41, at: NOW, mapSeed: 0, mode: 'defense', select: true }, NOW)).toBe('tier locked');
    expect(applyRunEntry(d, { kind: 'start', runId: 'r40', tier: 40, at: NOW, mapSeed: 0, mode: 'defense', select: true })).toBe(true);
    expect(d.threat.selected).toBe(40);
  });
});
