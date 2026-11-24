// Loot feedback (docs/progression-design.md §6): build-aware verdicts, NEW BEST, item level vs baseline, run recap.
import { describe, expect, it } from 'vitest';
import { bestFinds, bestKey, bestPowers, isNewBest, levelDelta, powerGain } from '@riftwarden/rules/loot/feedback';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { buildWeights, COMPARISON_PRIORITIES, impactBetween, loadoutScore, weightsFor } from '@riftwarden/rules/loot/loadoutScore';
import { RunLedger } from '@riftwarden/rules/progression/run';

const item = (baseId: string, level: number, rarity: 'common' | 'rare' | 'epic' | 'legendary', seed = 1) => generateItem({ uid: `${baseId}.${level}.${rarity}.${seed}`, seed, level, rarity, baseId, source: 't' });

describe('build-aware verdicts', () => {
  it('weights shift toward what the build invests in and always sum to one', () => {
    expect(COMPARISON_PRIORITIES[0]).toBe('build');
    const plain = buildWeights({ mobility: 100, towers: 100 });
    const towery = buildWeights({ mobility: 100, towers: 180 });
    const fast = buildWeights({ mobility: 125, towers: 100 });
    for (const w of [plain, towery, fast]) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(towery.towers).toBeGreaterThan(plain.towers + 0.3);
    expect(fast.mobility).toBeGreaterThan(plain.mobility + 0.1);
    expect(weightsFor('balanced', { mobility: 300, towers: 300 }).towers).toBe(0.1);
  });

  it('a tower build judges a mixed swap by its towers', () => {
    const b = { ...loadoutScore([]), dps: 100, ehp: 100, mobility: 100, towers: 180 };
    const a = { ...b, dps: 96, towers: 200 };
    expect(impactBetween(b, a, 'build').verdict).toBe('upgrade');
    expect(impactBetween(b, a, 'firepower').verdict).not.toBe('upgrade');
  });
});

describe('NEW BEST and recap', () => {
  it('beats every owned item of its kind (weapons per family); modules never', () => {
    const owned = bestPowers([item('plasma_repeater', 20, 'rare'), item('rail_lancer', 40, 'epic')]);
    expect(bestKey(item('plasma_repeater', 1, 'common'))).toBe('weapon:plasma');
    expect(isNewBest(item('plasma_repeater', 22, 'rare', 2), owned)).toBe(true);
    expect(isNewBest(item('plasma_repeater', 18, 'rare', 2), owned)).toBe(false);
    // A better plasma does not beat a rail; a first item of a new kind is a new best.
    expect(isNewBest(item('rail_lancer', 30, 'epic', 3), owned)).toBe(false);
    const armor = generateItem({ uid: 'a1', seed: 4, level: 5, rarity: 'common', category: 'armor', source: 't' });
    expect(isNewBest(armor, owned)).toBe(true);
    const mod = generateItem({ uid: 'm1', seed: 5, level: 50, rarity: 'legendary', category: 'module', source: 't' });
    expect(isNewBest(mod, owned)).toBe(false);
  });

  it('level delta, best finds and power gain', () => {
    expect(levelDelta(24, 21)).toBe(3);
    const finds = bestFinds([item('plasma_repeater', 5, 'common'), item('plasma_repeater', 30, 'epic'), item('plasma_repeater', 30, 'rare')], 2);
    expect(finds.map((f) => f.rarity)).toEqual(['epic', 'rare']);
    expect(powerGain(2, 2.5)).toBeCloseTo(0.25);
    expect(powerGain(0, 3)).toBe(0);
  });

  it('run results list the best secured finds first and carry the starting power', () => {
    const run = new RunLedger('rr', 1, 1);
    run.powerAtStart = 1.8;
    for (let w = 1; w <= 5; w++) run.waveCleared(w);
    run.collect({ items: [item('plasma_repeater', 3, 'common', 7), item('plasma_repeater', 9, 'rare', 8)] });
    run.bank(5);
    const res = run.finalize('returned');
    expect(res.securedItems![0].rarity).toBe('rare');
    expect(res.powerAtStart).toBe(1.8);
  });
});
