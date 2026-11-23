// Offline-first sync (architecture v2 step 5): genesis checks, op replay, run validation with loot re-rolls.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { DROP_SOURCES, type DropSource } from '@riftwarden/rules/loot/drops';
import { generateItem, hashSeed } from '@riftwarden/rules/loot/generate';
import { rollLoot } from '@riftwarden/rules/loot/roll';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { CEILINGS, checkRunEntry, replayLoot, sameItem } from '@riftwarden/rules/progression/runCheck';
import type { LootRecord, RunEntry } from '@riftwarden/rules/progression/runRules';
import { createDefaultSave, type SaveData } from '@riftwarden/rules/progression/save';
import { genesisProblem, type LogEntry, openDoc, replay } from '@riftwarden/rules/progression/sync';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { regionLayout } from '@riftwarden/rules/war/regions';
import { lootLocks } from '@riftwarden/rules/progression/unlocks';

const NOW = 1_800_000_000_000;
/** A fresh profile's loot locks (staged unlocks): the run start records them, every roll replays with them. */
const LOCKS = lootLocks(createDefaultSave(NOW));

/** Mirrors Game: a counting loot stream per node and a record per roll. */
function runLoot(runId: string, node: string | null, salt: number) {
  const base = mulberry32((hashSeed(runId) ^ salt) >>> 0);
  let draws = 0;
  const rand = () => {
    draws++;
    return base();
  };
  let counter = 0;
  const records: LootRecord[] = [];
  const items: ItemInstance[] = [];
  const tier = getTier(1);
  return {
    records,
    items,
    rand,
    roll(source: DropSource, wave: number) {
      records.push({ node, draw: draws, counter, source, wave, tier: { lootLevelBonus: tier.lootLevelBonus, lootLuck: tier.lootLuck, id: tier.id }, faction: null, locks: [...LOCKS] });
      items.push(...rollLoot({ source, wave, tier: { lootLevelBonus: tier.lootLevelBonus, lootLuck: tier.lootLuck, id: tier.id }, rand, nextUid: () => `${runId}.${++counter}`, originId: runId, faction: null, locks: LOCKS }));
    },
  };
}

function bankedRun(runId = 'run_sync_1') {
  const loot = runLoot(runId, null, 0);
  for (let w = 1; w <= 5; w++) {
    loot.roll(DROP_SOURCES.wave, w);
    for (let k = 0; k < 6; k++) loot.roll(DROP_SOURCES.walker, w);
    loot.rand(); // an unrelated draw (elite component chance) between rolls
    loot.roll({ ...DROP_SOURCES.elite, chance: 1, luck: DROP_SOURCES.elite.luck + 0.7 }, w);
  }
  loot.roll(DROP_SOURCES.checkpoint, 5);
  return loot;
}

const start = (runId: string, mapSeed = 0): RunEntry => ({ kind: 'start', runId, tier: 1, at: NOW, mapSeed, mode: 'defense', select: true });
const bank = (runId: string, items: ItemInstance[], records: LootRecord[], extra: Partial<RunEntry & { kind: 'bank' }> = {}): RunEntry => ({
  kind: 'bank',
  runId,
  wave: 5,
  bosses: 0,
  loot: records,
  rewards: { salvage: 120, credits: 300, components: 2, shards: 0, xp: 900, items },
  ...extra,
});

describe('genesis', () => {
  it('a fresh default profile is a valid genesis, an edited one is not', () => {
    const g = createDefaultSave(NOW);
    expect(genesisProblem(JSON.parse(JSON.stringify(g)))).toBeNull();
    const rich = JSON.parse(JSON.stringify(g)) as SaveData;
    rich.resources.credits += 1_000_000;
    expect(genesisProblem(rich)).toMatch(/fresh/);
    const extraItem = JSON.parse(JSON.stringify(g)) as SaveData;
    extraItem.items.push(generateItem({ uid: 'it_x', seed: 1, level: 50, rarity: 'exotic', category: 'weapon', source: 'x' }));
    expect(genesisProblem(extraItem)).toMatch(/fresh/);
  });

  it('openDoc keeps a current document intact', () => {
    const g = createDefaultSave(NOW);
    expect(openDoc(JSON.parse(JSON.stringify(g)), NOW)).toEqual(g);
  });
});

describe('replay', () => {
  it('applies ops in order, each atomically, with per-entry results', () => {
    const d = createDefaultSave(NOW);
    const entries: LogEntry[] = [
      { seq: 1, at: NOW, op: { name: 'selectTier', args: [1] } },
      { seq: 2, at: NOW, op: { name: 'selectTier', args: [3] } },
      { seq: 3, at: NOW, op: { name: 'noSuchOp', args: [] } },
      { seq: 4, at: NOW, op: { name: 'tutorialSkip', args: [] } },
    ];
    const r = replay(d, entries, NOW);
    expect(r.results.map((x) => x.ok)).toEqual([true, false, false, true]);
    expect(r.doc.tutorial.skipped).toBe(true);
    expect(d.tutorial.skipped).toBe(false); // the input is untouched
  });
});

describe('run validation', () => {
  it('a genuine run banks its own drops and records', () => {
    const loot = bankedRun();
    expect(loot.items.length).toBeGreaterThan(3);
    const d = createDefaultSave(NOW);
    const r = replay(d, [
      { seq: 1, at: NOW, run: start('run_sync_1') },
      { seq: 2, at: NOW + 200_000, run: bank('run_sync_1', loot.items, loot.records) },
    ], NOW + 300_000);
    expect(r.results).toEqual([{ seq: 1, ok: true }, { seq: 2, ok: true }]);
    expect(r.doc.resources.credits).toBe(d.resources.credits + 300);
    expect(r.doc.items.length).toBe(d.items.length + loot.items.length);
  });

  it('replayLoot reproduces every item exactly', () => {
    const loot = bankedRun('run_sync_2');
    // Dropping the locks from the journal (to widen or narrow the pool) is refused.
    expect(replayLoot('run_sync_2', 1, 0, loot.records.map((r) => ({ ...r, locks: [] })), 0, LOCKS)).toBe('loot locks altered');
    expect(replayLoot('run_sync_2', 1, 0, loot.records.map((r) => ({ ...r, locks: ['cat:module'] })), 0, LOCKS)).toBe('loot locks altered');
    const produced = replayLoot('run_sync_2', 1, 0, loot.records, 0, LOCKS);
    expect(typeof produced).not.toBe('string');
    for (const it of loot.items) expect(sameItem((produced as Map<string, ItemInstance>).get(it.uid), it)).toBe(true);
  });

  it('rejects edited, invented and duplicated items', () => {
    const loot = bankedRun('run_sync_3');
    const d = createDefaultSave(NOW);
    replay(d, [], NOW);
    const started = replay(d, [{ seq: 1, at: NOW, run: start('run_sync_3') }], NOW).doc;
    const edited = structuredClone(loot.items);
    const victim = edited.find((i) => i.affixes.length) ?? edited[0];
    if (victim.affixes.length) victim.affixes[0].value *= 3;
    else victim.base[0].value *= 3;
    expect(checkRunEntry(started, bank('run_sync_3', edited, loot.records), NOW)).toMatch(/not produced/);
    const invented = [...loot.items, generateItem({ uid: 'run_sync_3.999', seed: 7, level: 5, rarity: 'exotic', category: 'weapon', source: 'run_sync_3' })];
    expect(checkRunEntry(started, bank('run_sync_3', invented, loot.records), NOW)).toMatch(/not produced/);
    expect(checkRunEntry(started, bank('run_sync_3', [loot.items[0], loot.items[0]], loot.records), NOW)).toMatch(/duplicate/);
    expect(checkRunEntry(started, bank('run_sync_3', loot.items, loot.records), NOW)).toBeNull();
  });

  it('rejects altered drop sources, luck and resource numbers', () => {
    const loot = bankedRun('run_sync_4');
    const started = replay(createDefaultSave(NOW), [{ seq: 1, at: NOW, run: start('run_sync_4') }], NOW).doc;
    const greedy = loot.records.map((r) => ({ ...r, source: { ...r.source, rolls: 50 } }));
    expect(checkRunEntry(started, bank('run_sync_4', loot.items, greedy), NOW)).toMatch(/rolls/);
    const floor = loot.records.map((r) => ({ ...r, source: { ...r.source, minRarity: 'legendary' as const } }));
    expect(checkRunEntry(started, bank('run_sync_4', loot.items, floor), NOW)).toMatch(/rarity floor/);
    const lucky = loot.records.map((r) => ({ ...r, tier: { ...r.tier, lootLuck: 99 } }));
    expect(checkRunEntry(started, bank('run_sync_4', loot.items, lucky), NOW)).toMatch(/luck/);
    const rich: RunEntry = bank('run_sync_4', [], [], { rewards: { salvage: 0, credits: 10_000_000, components: 0, shards: 0, xp: 0, items: [] } });
    expect(checkRunEntry(started, rich, NOW)).toMatch(/credits/);
    const xp: RunEntry = bank('run_sync_4', [], [], { rewards: { salvage: 0, credits: 0, components: 0, shards: 0, xp: CEILINGS.xpPerWave(5) * 5 * 2, items: [] } });
    expect(checkRunEntry(started, xp, NOW)).toMatch(/xp/);
  });

  it('merchant stock must be a genuine generator output of at most epic rarity', () => {
    const started = replay(createDefaultSave(NOW), [{ seq: 1, at: NOW, run: start('run_sync_5') }], NOW).doc;
    const ware = generateItem({ uid: 'run_sync_5.m1abc', seed: 123456, level: 6, rarity: 'rare', category: 'armor', source: 'run_sync_5' });
    expect(checkRunEntry(started, bank('run_sync_5', [ware], []), NOW)).toBeNull();
    const shiny = generateItem({ uid: 'run_sync_5.m2abc', seed: 99, level: 6, rarity: 'legendary', category: 'weapon', source: 'run_sync_5' });
    expect(checkRunEntry(started, bank('run_sync_5', [shiny], []), NOW)).toMatch(/not produced/);
  });

  it('map runs salt each node stream with the node arena seed from the war layout', () => {
    const mapSeed = 424242;
    const node = regionLayout(mapSeed, 0).nodes[0];
    const loot = runLoot('run_sync_6', 'r0n0', node.seed);
    loot.roll(DROP_SOURCES.wave, 1);
    loot.roll(DROP_SOURCES.checkpoint, 5);
    expect(loot.items.length).toBeGreaterThan(0);
    const produced = replayLoot('run_sync_6', 1, mapSeed, loot.records, 0, LOCKS) as Map<string, ItemInstance>;
    expect(loot.items.every((i) => sameItem(produced.get(i.uid), i))).toBe(true);
    const wrongNode = loot.records.map((r) => ({ ...r, node: 'r0n2' }));
    const other = replayLoot('run_sync_6', 1, mapSeed, wrongNode, 0, LOCKS) as Map<string, ItemInstance>;
    expect(loot.items.every((i) => sameItem(other.get(i.uid), i))).toBe(false);
    expect(replayLoot('run_sync_6', 1, mapSeed, loot.records.map((r) => ({ ...r, node: 'nowhere' })), 0, LOCKS)).toMatch(/unknown map node/);
  });

  it('run starts need an unlocked tier and a fresh id; impossible results are refused', () => {
    const d = createDefaultSave(NOW);
    expect(checkRunEntry(d, { ...start('run_x'), tier: 3 } as RunEntry, NOW)).toMatch(/locked/);
    const started = replay(d, [{ seq: 1, at: NOW, run: start('run_x') }], NOW).doc;
    expect(checkRunEntry(started, start('run_x'), NOW)).toMatch(/already/);
    const result = { id: 'run_x', outcome: 'returned', wavesCleared: 50, kills: 10, duration: 10 } as never;
    expect(checkRunEntry(started, { kind: 'end', result, loadout: {} }, NOW)).toMatch(/faster/);
  });
});
