// Weapon-family mastery (docs/design/progression-design.md §6, §11): ranks, damage bonus, component locks, finishes, perks,
// co-op squad XP and team bonus, sanitize.
import { describe, expect, it } from 'vitest';
import {
  ALL_COMPONENT_LOCKS,
  componentLocks,
  excludedComponents,
  finishesAt,
  masteryModifiers,
  masteryTitle,
  MAX_RANK,
  perkBlocker,
  perkOptions,
  perkTiers,
  rankDamage,
  rankInfo,
  sanitizeMastery,
  squadMasteryMult,
  teamMasteryBonus,
  xpForRank,
} from '@riftwarden/rules/progression/mastery';

describe('mastery ranks', () => {
  it('ranks follow the XP curve and stop at 50', () => {
    expect(rankInfo(0).rank).toBe(0);
    expect(rankInfo(xpForRank(1)).rank).toBe(1);
    expect(rankInfo(xpForRank(7) - 1).rank).toBe(6);
    expect(rankInfo(1e15).rank).toBe(MAX_RANK);
    expect(xpForRank(10)).toBe(300 * 10 + 90 * 45);
  });

  it('the damage bonus is soft-capped toward 15%', () => {
    expect(rankDamage(0)).toBe(0);
    expect(rankDamage(10)).toBeCloseTo(0.0425, 3);
    expect(rankDamage(50)).toBeGreaterThan(0.11);
    expect(rankDamage(50)).toBeLessThan(0.15);
    for (let r = 1; r <= 50; r++) expect(rankDamage(r)).toBeGreaterThan(rankDamage(r - 1));
  });

  it('components unlock by rank and turn into loot locks', () => {
    const fresh = componentLocks({});
    expect(fresh).toEqual(ALL_COMPONENT_LOCKS);
    const m = { rail: { xp: xpForRank(10), perks: [] } };
    expect(componentLocks(m)).not.toContain('comp:rail:mc_cycle');
    expect(componentLocks(m)).not.toContain('comp:rail:rb_quad');
    expect(componentLocks(m)).toContain('comp:rail:co_prism');
    expect(excludedComponents(componentLocks(m), 'rail')).toEqual(['co_prism']);
    expect(excludedComponents(fresh, 'plasma')).toEqual(expect.arrayContaining(['mc_scatter', 'pb_long', 'co_prism']));
  });

  it('finishes and titles follow the rank', () => {
    expect(finishesAt(9)).toEqual([]);
    expect(finishesAt(10).length).toBe(2);
    expect(finishesAt(50)).toEqual(expect.arrayContaining(['gilded', 'iridescent', 'ascended']));
    expect(masteryTitle('rail', 0)).toBe('Railgun Initiate');
    expect(masteryTitle('beam', 50)).toBe('Beam Grandmaster');
  });
});

describe('mastery perks and modifiers', () => {
  it('a perk tier opens every 5 ranks with two options that grow per tier', () => {
    expect(perkTiers(4)).toBe(0);
    expect(perkTiers(5)).toBe(1);
    expect(perkTiers(50)).toBe(10);
    const [a1] = perkOptions('plasma', 1);
    const [a4] = perkOptions('plasma', 4);
    expect(a4.stat).toBe(a1.stat);
    expect(a4.value).toBeCloseTo(a1.value * 1.3, 6);
    const m = { plasma: { xp: xpForRank(5), perks: [] } };
    expect(perkBlocker(m, 'plasma', 1, 0)).toBeNull();
    expect(perkBlocker(m, 'plasma', 2, 0)).toMatch(/rank 10/);
    expect(perkBlocker(m, 'plasma', 1, 2)).toBe('Unknown perk option');
  });

  it('modifiers apply to the family in hand only: rank damage + chosen perks', () => {
    const m = { rail: { xp: xpForRank(12), perks: [1, 0] } };
    expect(masteryModifiers(m, 'plasma')).toEqual([]);
    const mods = masteryModifiers(m, 'rail');
    expect(mods[0]).toMatchObject({ stat: 'weaponDamageMult', op: 'pct' });
    expect(mods.length).toBe(3);
    expect(mods[1].stat).toBe(perkOptions('rail', 1)[1].stat);
    expect(mods[2].stat).toBe(perkOptions('rail', 2)[0].stat);
    // A chosen perk above the reached tier never applies.
    expect(masteryModifiers({ rail: { xp: xpForRank(6), perks: [0, 0, 0] } }, 'rail').length).toBe(2);
  });

  it('co-op: squad XP +10% per other warden (max +30%), shared family bonus and capped aura', () => {
    expect(squadMasteryMult(1)).toBe(1);
    expect(squadMasteryMult(2)).toBeCloseTo(1.1);
    expect(squadMasteryMult(9)).toBeCloseTo(1.3);
    expect(teamMasteryBonus('plasma', [{ family: 'rail', rank: 50 }])).toBe(0);
    expect(teamMasteryBonus('plasma', [{ family: 'plasma', rank: 0 }])).toBeCloseTo(0.02);
    expect(teamMasteryBonus('plasma', [{ family: 'plasma', rank: 0 }, { family: 'plasma', rank: 0 }, { family: 'plasma', rank: 0 }])).toBeCloseTo(0.04);
    expect(teamMasteryBonus('plasma', [{ family: 'plasma', rank: 50 }, { family: 'plasma', rank: 50 }])).toBeCloseTo(0.03 + 0.03);
    expect(teamMasteryBonus(null, [{ family: 'plasma', rank: 50 }])).toBe(0);
  });

  it('sanitize keeps valid state, clamps XP and drops finishes the rank has not unlocked', () => {
    expect(sanitizeMastery(null)).toBeUndefined();
    const s = sanitizeMastery({ plasma: { xp: 1e30, perks: [0, 1, 7, 'x'], finish: 'ascended' }, rail: { xp: 50, perks: [], finish: 'gilded' }, bogus: { xp: 1 } })!;
    expect(s.plasma!.xp).toBe(xpForRank(MAX_RANK));
    expect(s.plasma!.perks).toEqual([0, 1, -1, -1]);
    expect(s.plasma!.finish).toBe('ascended');
    expect(s.rail!.finish).toBeUndefined();
    expect((s as Record<string, unknown>).bogus).toBeUndefined();
  });
});

describe('mastery banking and loot', () => {
  it('rides the ledger: banked at checkpoints, 25% of the unsecured pool kept on a loss', async () => {
    const { RunLedger } = await import('@riftwarden/rules/progression/run');
    const { createDefaultSave, beginRun, bankRewards, recordRun } = await import('@riftwarden/rules/progression/save');
    const d = createDefaultSave(1);
    beginRun(d, 'rm', 1, 1);
    const run = new RunLedger('rm', 1, 1);
    for (let w = 1; w <= 5; w++) run.waveCleared(w);
    run.collect({ mastery: { plasma: 120 } });
    const moved = run.bank(5)!;
    expect(moved.mastery).toEqual({ plasma: 120 });
    expect(bankRewards(d, 'rm', 5, moved)).toBe(true);
    expect(d.progress.mastery?.plasma?.xp).toBe(120);
    run.collect({ mastery: { plasma: 100, rail: 40 } });
    const res = run.finalize('defeat');
    expect(res.masteryKept).toEqual({ plasma: 25, rail: 10 });
    recordRun(d, res);
    expect(d.progress.mastery?.plasma?.xp).toBe(145);
    expect(d.progress.mastery?.rail?.xp).toBe(10);
  });

  it('weapons never roll components the family has not mastered', async () => {
    const { generateItem } = await import('@riftwarden/rules/loot/generate');
    const locks = componentLocks({});
    let scatter = 0;
    for (let seed = 1; seed < 600; seed++) {
      const it = generateItem({ uid: `m${seed}`, seed, level: 20, rarity: 'legendary', baseId: 'plasma_repeater', source: 't', componentLocks: locks });
      expect(it.build!.mechanism).not.toBe('mc_scatter');
      expect(it.build!.barrel).not.toBe('pb_long');
      expect(it.build!.core).not.toBe('co_prism');
      const free = generateItem({ uid: `m${seed}`, seed, level: 20, rarity: 'legendary', baseId: 'plasma_repeater', source: 't' });
      if (free.build!.mechanism === 'mc_scatter') scatter++;
    }
    expect(scatter).toBeGreaterThan(0);
  });

  it('the server refuses mastery XP beyond the per-wave ceiling', async () => {
    const { checkRunEntry } = await import('@riftwarden/rules/progression/runCheck');
    const { createDefaultSave, beginRun } = await import('@riftwarden/rules/progression/save');
    const d = createDefaultSave(1);
    beginRun(d, 'rc', 1, 1);
    const entry = (plasma: number) => ({ kind: 'bank' as const, runId: 'rc', wave: 5, bosses: 0, loot: [], rewards: { salvage: 0, credits: 0, components: 0, shards: 0, xp: 0, items: [], mastery: { plasma } } });
    expect(checkRunEntry(d, entry(400), 2)).toBeNull();
    expect(checkRunEntry(d, entry(10_000_000), 2)).toMatch(/mastery/);
  });
});
