import { describe, expect, it } from 'vitest';
import { STAT_KEYS } from '@riftwarden/rules/combat/stats';
import { generateItem, starterWeapon } from '@riftwarden/rules/loot/generate';
import { impactBetween, loadoutScore, pctText, statSources, swapImpact, swapped } from '@riftwarden/rules/loot/loadoutScore';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { STAT_HELP } from '@riftwarden/client/ui/statHelp';

const gen = (seed: number, o: Partial<Parameters<typeof generateItem>[0]> = {}): ItemInstance =>
  generateItem({ uid: `u${seed}`, seed, level: 10, rarity: 'rare', category: 'weapon', source: 'test', now: 1, ...o });

describe('loadout score', () => {
  const starter = starterWeapon('it_1', 1);

  it('scores a stock drone with only the starter weapon', () => {
    const s = loadoutScore([starter]);
    expect(s.dps).toBeGreaterThan(0);
    expect(s.ehp).toBeCloseTo(100, 5);
    expect(s.mobility).toBeCloseTo(100, 5);
    expect(s.towers).toBeCloseTo(100, 5);
    expect(loadoutScore([]).dps).toBe(0);
  });

  it('ignores loose modules and nulls', () => {
    const mod = gen(5, { category: 'module' });
    expect(loadoutScore([starter, null, mod])).toEqual(loadoutScore([starter]));
  });

  it('a higher-level rare weapon is an upgrade over the starter, and the reverse a downgrade', () => {
    const better = gen(11, { level: 30, baseId: 'plasma_repeater' });
    const up = swapImpact([starter], better, starter);
    expect(up.deltas.find((d) => d.key === 'dps')!.pct).toBeGreaterThan(0);
    expect(up.verdict).toBe('upgrade');
    const down = swapImpact([better], starter, better);
    expect(down.verdict).toBe('downgrade');
  });

  it('armor into an empty slot raises survivability and never changes DPS', () => {
    const armor = gen(21, { category: 'armor' });
    const imp = swapImpact([starter], armor, null);
    expect(imp.deltas.find((d) => d.key === 'ehp')!.pct).toBeGreaterThan(0);
    // dps only changes if the armor rolled an offensive affix
    const st = loadoutScore([starter, armor]).stats;
    if (st.weaponDamageMult === 1 && st.fireRateMult === 1 && st.critChance === 0.05 && st.critMultiplier === 2) expect(imp.deltas.some((d) => d.key === 'dps')).toBe(false);
  });

  it('swapping an item for itself is no change', () => {
    const imp = swapImpact([starter], starter, starter);
    expect(imp.deltas).toEqual([]);
    expect(imp.verdict).toBe('same');
    expect(impactBetween(loadoutScore([starter]), loadoutScore([starter])).verdict).toBe('same');
  });

  it('swapped() replaces exactly one item and never duplicates the candidate', () => {
    const a = gen(31, { category: 'armor' });
    const b = gen(32, { category: 'armor', uid: 'other' });
    expect(swapped([starter, a], b, a).map((i) => i.uid).sort()).toEqual([starter.uid, b.uid].sort());
    expect(swapped([starter, a], a, a).map((i) => i.uid).sort()).toEqual([starter.uid, a.uid].sort());
  });

  it('preserves the primary slot when refitting in place or filling an empty primary slot', () => {
    const secondary = gen(33);
    const refit = { ...starter, enhance: 2 };
    expect(swapped([starter, secondary], refit, starter)).toEqual([refit, secondary]);
    expect(swapped([null, secondary], refit, null, 0)).toEqual([refit, secondary]);
    expect(swapped([starter, null], secondary, null, 1)).toEqual([starter, secondary]);
  });

  it('stays finite at extreme item levels', () => {
    const big = gen(41, { level: 1e6, rarity: 'exotic' });
    const s = loadoutScore([big, gen(42, { level: 1e6, category: 'armor', rarity: 'exotic' }), gen(43, { level: 1e6, category: 'shield', rarity: 'exotic' })]);
    for (const v of [s.dps, s.ehp, s.mobility, s.towers]) expect(Number.isFinite(v)).toBe(true);
  });

  it('statSources lists every contributing item and sums to the modifier total', () => {
    const armor = gen(51, { category: 'armor' });
    const src = statSources([starter, armor], 'armor');
    const flat = armor.base.filter((b) => b.stat === 'armor' && b.op === 'add').reduce((s, b) => s + b.value, 0) + armor.affixes.filter((a) => a.stat === 'armor' && a.op === 'add').reduce((s, a) => s + a.value, 0);
    const got = src.filter((s) => s.op === 'add').reduce((s, x) => s + x.value, 0);
    expect(got).toBeCloseTo(flat, 6);
    expect(src.every((s) => s.uid === armor.uid)).toBe(true);
  });

  it('pure gains are upgrades, pure losses downgrades, mixed small changes sidegrades', () => {
    const b = loadoutScore([starter]);
    const mk = (o: Partial<typeof b>) => ({ ...b, ...o });
    expect(impactBetween(b, mk({ ehp: b.ehp * 1.01 })).verdict).toBe('upgrade');
    expect(impactBetween(b, mk({ mobility: b.mobility * 0.99 })).verdict).toBe('downgrade');
    expect(impactBetween(b, mk({ dps: b.dps * 1.02, ehp: b.ehp * 0.97 })).verdict).toBe('sidegrade');
    expect(impactBetween(b, mk({ dps: b.dps * 1.5, ehp: b.ehp * 0.97 })).verdict).toBe('upgrade');
  });

  it('changes tradeoff verdicts with priority while keeping the same raw deltas', () => {
    const before = loadoutScore([starter]);
    const after = { ...before, dps: before.dps * 1.12, ehp: before.ehp * 0.9 };
    const balanced = impactBetween(before, after, 'balanced');
    const firepower = impactBetween(before, after, 'firepower');
    const survivability = impactBetween(before, after, 'survivability');
    expect(balanced).toEqual(impactBetween(before, after));
    expect(balanced.verdict).toBe('sidegrade');
    expect(balanced.score).toBeCloseTo(0.019);
    expect(firepower.verdict).toBe('upgrade');
    expect(survivability.verdict).toBe('downgrade');
    expect(firepower.deltas).toEqual(balanced.deltas);
    expect(survivability.deltas).toEqual(balanced.deltas);
    expect(impactBetween(before, { ...after, towers: before.towers * 0.88 }, 'towers').verdict).toBe('downgrade');
  });

  it('formats percentages with a sign', () => {
    expect(pctText(0.123)).toBe('+12%');
    expect(pctText(-0.045)).toBe('−4.5%');
  });

  it('every stat has help text', () => {
    for (const k of STAT_KEYS) expect(STAT_HELP[k]?.length ?? 0).toBeGreaterThan(10);
  });
});

describe('HQ room styles', () => {
  it('every HQ room has a distinct accent colour and an in-range light tint', async () => {
    const { roomStyle } = await import('@riftwarden/game/home/roomStyle');
    const { HQ_ROOMS } = await import('@riftwarden/rules/home/layout');
    const seen = new Set<string>();
    for (const r of HQ_ROOMS) {
      const s = roomStyle(r.id);
      seen.add(s.accent.join(','));
      for (const c of s.light) expect(c >= 0 && c <= 1).toBe(true);
    }
    expect(seen.size).toBe(HQ_ROOMS.length);
  });
});
