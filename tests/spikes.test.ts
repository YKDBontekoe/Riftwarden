// Big spikes (docs/design/progression-design.md §7): codex first finds, breakthroughs, pinnacle keys + runs, war caches.
import { describe, expect, it } from 'vitest';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { generateUnique, UNIQUES } from '@riftwarden/rules/loot/uniques';
import { emptyRewards } from '@riftwarden/rules/progression/run';
import { checkRunEntry, replayLoot } from '@riftwarden/rules/progression/runCheck';
import { applyRunEntry } from '@riftwarden/rules/progression/runRules';
import { runOp } from '@riftwarden/rules/progression/ops';
import { bankRewards, beginRun, createDefaultSave, parseSave, serializeSave } from '@riftwarden/rules/progression/save';
import { breakthroughItem, breakthroughRarity, CODEX, codexIdsOf, isBreakthrough, newCodexEntries, PINNACLE, pinnacleBoss, titleOf, warCacheItem } from '@riftwarden/rules/progression/spikes';
import { DROP_SOURCES } from '@riftwarden/rules/loot/drops';
import { getTier } from '@riftwarden/rules/progression/tiers';

const NOW = 1_800_000_000_000;

describe('codex', () => {
  it('items count for their rarity, family and unique; first finds pay shards once', () => {
    const w = generateItem({ uid: 'w1', seed: 3, level: 30, rarity: 'epic', baseId: 'rail_lancer', source: 't' });
    expect(codexIdsOf(w)).toEqual(['rarity:epic', 'family:rail']);
    const u = generateUnique(UNIQUES[0], { uid: 'u1', seed: 4, level: 80, source: 't' });
    expect(codexIdsOf(u)).toContain(`unique:${UNIQUES[0].id}`);
    expect(newCodexEntries(['rarity:epic'], [w]).map((c) => c.id)).toEqual(['family:rail']);
    const d = createDefaultSave(NOW);
    beginRun(d, 'rc', 1, NOW);
    const before = d.resources.shards;
    bankRewards(d, 'rc', 5, { ...emptyRewards(), items: [w] });
    expect(d.codex).toEqual(expect.arrayContaining(['rarity:epic', 'family:rail']));
    expect(d.resources.shards).toBe(before + 1 + 1);
    expect(CODEX.length).toBe(6 + 5 + UNIQUES.length);
    const back = parseSave(serializeSave(d));
    expect(back.ok && back.data.codex).toEqual(d.codex);
  });
});

describe('breakthroughs', () => {
  it('every fifth level cleared grants a deterministic cache above the ceiling, shards and a title once', () => {
    expect(isBreakthrough(4)).toBe(false);
    expect(isBreakthrough(5)).toBe(true);
    expect(rarity(breakthroughRarity(5)).index).toBeGreaterThan(rarity('epic').index - 1);
    expect(breakthroughItem('pf_a', 10)).toEqual(breakthroughItem('pf_a', 10));
    expect(breakthroughItem('pf_a', 10).level).toBe(100);
    const d = createDefaultSave(NOW);
    d.threat.unlocked = 5;
    d.records['5'] = { ...d.records['1'], bestWave: 0, checkpoints: 2 } as never;
    beginRun(d, 'rb', 5, NOW);
    const items = d.items.length;
    const shards = d.resources.shards;
    bankRewards(d, 'rb', 5, emptyRewards());
    expect(d.threat.unlocked).toBe(6);
    expect(d.breakthroughs).toEqual([5]);
    expect(d.items.length).toBe(items + 1);
    expect(d.resources.shards).toBeGreaterThan(shards);
    expect(titleOf(d.breakthroughs!)).toBe('Rift Breaker');
  });
});

describe('pinnacle', () => {
  it('runs need RL 8 and a key, spend it, and allow the pinnacle table only in pinnacle runs', () => {
    const d = createDefaultSave(NOW);
    d.threat.unlocked = 9;
    const start = (id: string, pinnacle = true) => ({ kind: 'start' as const, runId: id, tier: 9, at: NOW, mapSeed: 0, mode: 'defense' as const, select: true, pinnacle });
    expect(checkRunEntry(d, start('p1'), NOW)).toMatch(/No pinnacle key/);
    d.pinnacle = { keys: 1, runs: 0 };
    expect(checkRunEntry(d, { ...start('p1'), tier: 7 }, NOW)).toMatch(/Rift Level 8/);
    expect(checkRunEntry(d, start('p1'), NOW)).toBeNull();
    applyRunEntry(d, start('p1'));
    expect(d.pinnacle).toEqual({ keys: 0, runs: 1 });
    expect(d.activeRun?.pinnacle).toBe(true);
    const t = getTier(9);
    const rec = { node: null, draw: 0, counter: 0, source: DROP_SOURCES.pinnacle, wave: 1, tier: { lootLevelBonus: t.lootLevelBonus, lootLuck: t.lootLuck, id: 9 }, faction: null };
    expect(typeof replayLoot('p1', 9, 0, [rec], 0, [], true)).not.toBe('string');
    expect(replayLoot('p1', 9, 0, [rec], 0, [], false)).toMatch(/pinnacle/);
    expect(['colossus', 'overseer']).toContain(pinnacleBoss('p1'));
  });

  it('keys craft from shards at the fabricator (RL 8+) and bank from runs within a ceiling', () => {
    const d = createDefaultSave(NOW);
    d.progress.xp = 5e6;
    d.resources.shards = 25;
    expect(runOp(d, 'craftKey', []).ok).toBe(false);
    d.threat.unlocked = 8;
    expect(runOp(d, 'craftKey', []).ok).toBe(true);
    expect(d.pinnacle?.keys).toBe(1);
    expect(d.resources.shards).toBe(25 - PINNACLE.craftShards);
    beginRun(d, 'rk', 8, NOW);
    expect(checkRunEntry(d, { kind: 'bank', runId: 'rk', wave: 5, bosses: 0, loot: [], rewards: { ...emptyRewards(), keys: 50 } }, NOW)).toMatch(/keys/);
    bankRewards(d, 'rk', 5, { ...emptyRewards(), keys: 2 });
    expect(d.pinnacle?.keys).toBe(3);
  });
});

describe('war victory caches', () => {
  it('only regions fought in can be claimed, once, for a deterministic cache', () => {
    const d = createDefaultSave(NOW);
    expect(runOp(d, 'claimWarCache', [2]).ok).toBe(false);
    expect(runOp(d, 'warContribute', [2]).ok).toBe(true);
    expect(runOp(d, 'warContribute', [2]).ok).toBe(true);
    expect(d.war).toEqual({ fought: [2], claimed: [] });
    const r = runOp(d, 'claimWarCache', [2]);
    expect(r.ok).toBe(true);
    expect(d.items.some((i) => i.uid === warCacheItem(d.profile.id, 2, 1).uid)).toBe(true);
    expect(runOp(d, 'claimWarCache', [2]).ok).toBe(false);
  });
});
