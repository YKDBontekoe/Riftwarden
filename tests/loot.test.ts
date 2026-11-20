import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/combat/damage';
import { BASE_STATS, computeStats, mitigation, STAT_DEFS } from '../src/combat/stats';
import { AFFIXES, affixDef } from '../src/loot/affixes';
import { BASES, baseDef } from '../src/loot/bases';
import { DROP_SOURCES, itemLevelFor, rollDrops } from '../src/loot/drops';
import { compareItems, equipmentModifiers, itemModifiers, statPreview, weaponDefFor } from '../src/loot/equipment';
import { flatScale, generateItem, isValidItem, MAX_ITEM_LEVEL, maxTierFor, pctScale, starterWeapon } from '../src/loot/generate';
import { RARITIES, rarity, rarityOdds, rollRarity } from '../src/loot/rarity';
import { CATEGORIES, type Category, type ItemInstance } from '../src/loot/types';

const gen = (seed: number, o: Partial<Parameters<typeof generateItem>[0]> = {}) =>
  generateItem({ uid: `u${seed}`, seed, level: 10, rarity: 'rare', category: 'weapon', source: 'test', now: 1, ...o });

describe('item generation (scenario B)', () => {
  it('is reproducible for the same seed and spec', () => {
    for (const cat of CATEGORIES) {
      const a = gen(1234, { category: cat, rarity: 'epic' });
      const b = gen(1234, { category: cat, rarity: 'epic' });
      expect(a).toEqual(b);
    }
  });

  it('produces unique identities and meaningfully varied items', () => {
    const items = Array.from({ length: 400 }, (_, i) => gen(i + 1, { category: CATEGORIES[i % CATEGORIES.length], rarity: RARITIES[i % 6].id }));
    expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
    // Same base + rarity + level: different affix sets and values.
    const weapons = Array.from({ length: 60 }, (_, i) => gen(5000 + i, { baseId: 'plasma_repeater', rarity: 'epic' }));
    const sigs = new Set(weapons.map((w) => w.affixes.map((a) => `${a.id}:${a.value}`).join(',')));
    expect(sigs.size).toBeGreaterThan(50);
    expect(new Set(weapons.map((w) => w.weapon!.damage)).size).toBeGreaterThan(10);
    expect(new Set(weapons.map((w) => w.name)).size).toBeGreaterThan(5);
  });

  it('affixes respect category compatibility, uniqueness and rarity counts', () => {
    for (let i = 0; i < 1500; i++) {
      const cat = CATEGORIES[i % CATEGORIES.length];
      const r = RARITIES[i % RARITIES.length];
      const it = gen(i * 7 + 3, { category: cat, rarity: r.id, level: 1 + (i % 90) });
      const base = baseDef(it.defId)!;
      expect(base.category).toBe(cat);
      expect(it.category).toBe(cat);
      for (const a of it.affixes) {
        const d = affixDef(a.id)!;
        expect(d, a.id).toBeDefined();
        expect(d.weights[cat] ?? 0).toBeGreaterThan(0);
        if (base.affixes) expect(base.affixes).toContain(a.id);
        // Never on the same stat as an implicit.
        expect(base.implicit.some((s) => s.stat === a.stat)).toBe(false);
        expect(a.tier).toBeGreaterThanOrEqual(1);
        expect(a.tier).toBeLessThanOrEqual(maxTierFor(it.level));
      }
      expect(new Set(it.affixes.map((a) => affixDef(a.id)!.group)).size).toBe(it.affixes.length);
      expect(it.affixes.length).toBeLessThanOrEqual(r.affixes[1] + (r.id === 'ascended' ? 1 : 0));
      expect(isValidItem(it)).toBe(true);
    }
  });

  it('weapons always carry valid weapon parameters; modules are inert', () => {
    for (let i = 0; i < 200; i++) {
      const w = gen(i + 900, { category: 'weapon', rarity: RARITIES[i % 6].id });
      const def = weaponDefFor(w)!;
      expect(def.damage).toBeGreaterThan(0);
      expect(def.fireRate).toBeGreaterThan(0);
      const m = gen(i + 1900, { category: 'module', rarity: RARITIES[i % 6].id });
      expect(m.module?.compatible.length).toBeGreaterThan(0);
      expect(itemModifiers(m)).toEqual([]); // not installable yet: no effect
    }
  });

  it('item level scaling is monotonic and stays finite at extreme levels', () => {
    let prev = 0;
    for (const l of [1, 2, 5, 10, 25, 50, 100, 500, 10_000, MAX_ITEM_LEVEL]) {
      const f = flatScale(l);
      expect(f).toBeGreaterThan(prev);
      prev = f;
      expect(Number.isFinite(pctScale(l))).toBe(true);
    }
    for (const lvl of [1e7, 1e300, Infinity, NaN, -5]) {
      const it = gen(77, { level: lvl, rarity: 'exotic', category: 'armor' });
      expect(isValidItem(it)).toBe(true);
      expect(it.level).toBeLessThanOrEqual(MAX_ITEM_LEVEL);
      expect(it.level).toBeGreaterThanOrEqual(1);
      const stats = computeStats(itemModifiers(it));
      for (const k of Object.keys(stats) as (keyof typeof stats)[]) expect(Number.isFinite(stats[k])).toBe(true);
    }
    // Same seed, higher level -> stronger flat stats.
    const lo = gen(31, { baseId: 'kinetic_plating', level: 5, rarity: 'common' });
    const hi = gen(31, { baseId: 'kinetic_plating', level: 40, rarity: 'common' });
    expect(hi.base[0].value).toBeGreaterThan(lo.base[0].value * 3);
    const wlo = gen(32, { baseId: 'plasma_repeater', level: 1 });
    const whi = gen(32, { baseId: 'plasma_repeater', level: 30 });
    expect(whi.weapon!.damage).toBeGreaterThan(wlo.weapon!.damage * 2.5);
  });

  it('rarity is not the only quality factor (rolls and tiers overlap)', () => {
    // Over many samples some rare weapon out-damages some epic weapon of the same level.
    const rares = Array.from({ length: 80 }, (_, i) => gen(10_000 + i, { baseId: 'plasma_repeater', rarity: 'rare', level: 20 }));
    const epics = Array.from({ length: 80 }, (_, i) => gen(20_000 + i, { baseId: 'plasma_repeater', rarity: 'epic', level: 20 }));
    const dmg = (w: ItemInstance) => computeStats(itemModifiers(w)).weaponDamageMult * w.weapon!.damage;
    expect(Math.max(...rares.map(dmg))).toBeGreaterThan(Math.min(...epics.map(dmg)));
  });

  it('starter weapon is deterministic and matches the M0 repeater', () => {
    const s = starterWeapon('it_1', 5);
    expect(s).toEqual(starterWeapon('it_1', 5));
    expect(s.rarity).toBe('common');
    expect(s.affixes).toEqual([]);
    expect(weaponDefFor(s)!.damage).toBe(13);
  });
});

describe('rarity rolls', () => {
  it('distribution follows the configured weights', () => {
    const rand = mulberry32(42);
    const n = 200_000;
    const counts = Object.fromEntries(RARITIES.map((r) => [r.id, 0])) as Record<string, number>;
    for (let i = 0; i < n; i++) counts[rollRarity(rand, 1)]++;
    const odds = rarityOdds(1);
    for (const r of RARITIES) {
      const expected = odds[r.id] * n;
      expect(Math.abs(counts[r.id] - expected)).toBeLessThan(Math.max(60, expected * 0.06));
    }
  });

  it('luck improves high rarities and minimum rarity is honoured', () => {
    expect(rarityOdds(2).legendary).toBeGreaterThan(rarityOdds(1).legendary * 8);
    expect(rarityOdds(1, 'rare').common).toBe(0);
    const rand = mulberry32(1);
    for (let i = 0; i < 2000; i++) expect(rarity(rollRarity(rand, 1, 'epic')).index).toBeGreaterThanOrEqual(3);
  });
});

describe('drop tables', () => {
  const ctx = (wave: number, tier = 1) => ({ wave, tierLevelBonus: [0, 8, 18][tier - 1], tierLuck: [1, 1.35, 1.8][tier - 1] });

  it('elites drop more often and better than standard enemies', () => {
    const rand = mulberry32(9);
    const run = (src: (typeof DROP_SOURCES)[keyof typeof DROP_SOURCES]) => {
      const all = [];
      for (let i = 0; i < 20000; i++) all.push(...rollDrops(src, ctx(10), rand));
      return all;
    };
    const w = run(DROP_SOURCES.walker);
    const b = run(DROP_SOURCES.bulwark);
    expect(b.length).toBeGreaterThan(w.length * 4);
    const avg = (xs: { rarity: string }[]) => xs.reduce((s, x) => s + rarity(x.rarity).index, 0) / xs.length;
    expect(avg(b)).toBeGreaterThan(avg(w) + 0.5);
    expect(b.every((d) => rarity(d.rarity).index >= 1)).toBe(true);
    // Target farming: Bulwark Plating only comes from Bulwarks.
    expect(b.some((d) => d.baseId === 'bulwark_plating')).toBe(true);
    expect(w.some((d) => d.baseId === 'bulwark_plating')).toBe(false);
  });

  it('item levels rise with waves and threat tiers', () => {
    const rand = mulberry32(3);
    const avgLevel = (wave: number, tier: number) => {
      let s = 0;
      for (let i = 0; i < 2000; i++) s += itemLevelFor(ctx(wave, tier), 0, rand);
      return s / 2000;
    };
    expect(avgLevel(10, 1)).toBeGreaterThan(avgLevel(5, 1) + 4);
    expect(avgLevel(10, 2)).toBeGreaterThan(avgLevel(10, 1) + 6);
    expect(avgLevel(10, 3)).toBeGreaterThan(avgLevel(10, 2) + 6);
  });

  it('first wave clear is a guaranteed drop; checkpoint caches are rare+', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 200; i++) expect(rollDrops(DROP_SOURCES.wave, ctx(1), rand).length).toBe(1);
    for (let i = 0; i < 200; i++) {
      const d = rollDrops(DROP_SOURCES.checkpoint, ctx(5), rand);
      expect(d.length).toBe(2);
      expect(d.every((x) => rarity(x.rarity).index >= 2)).toBe(true);
    }
  });
});

describe('equipment stats', () => {
  it('stacking order: flat, then summed percentages, then multiplicative; clamped', () => {
    const s = computeStats([
      { stat: 'weaponDamageMult', op: 'pct', value: 0.1 },
      { stat: 'weaponDamageMult', op: 'pct', value: 0.1 },
      { stat: 'weaponDamageMult', op: 'mul', value: 0.5 },
      { stat: 'maxHealthBonus', op: 'add', value: 20 },
      { stat: 'critChance', op: 'add', value: 5 },
      { stat: 'moveSpeedMult', op: 'pct', value: 9 },
    ]);
    expect(s.weaponDamageMult).toBeCloseTo(1.2 * 1.5);
    expect(s.maxHealthBonus).toBe(20);
    expect(s.critChance).toBe(1);
    expect(s.moveSpeedMult).toBe(STAT_DEFS.moveSpeedMult.max);
  });

  it('same equipment -> same stats; removing an item removes its bonus (no stacking on re-equip)', () => {
    const w = gen(1, { rarity: 'legendary' });
    const armor = gen(2, { category: 'armor', rarity: 'epic' });
    const a = computeStats(equipmentModifiers([w, armor]));
    const b = computeStats(equipmentModifiers([armor, w]));
    expect(a).toEqual(b);
    // Equip/unequip cycles are recomputed from scratch.
    let mods = equipmentModifiers([w, armor]);
    for (let i = 0; i < 5; i++) mods = equipmentModifiers([w, armor]);
    expect(computeStats(mods)).toEqual(a);
    expect(computeStats(equipmentModifiers([w]))).not.toEqual(a);
    expect(computeStats(equipmentModifiers([]))).toEqual({ ...BASE_STATS });
  });

  it('mitigation combines armor and resistance with a cap', () => {
    expect(mitigation({ armor: 0, damageResist: 0 })).toBe(0);
    expect(mitigation({ armor: 120, damageResist: 0 })).toBeCloseTo(0.5);
    expect(mitigation({ armor: 1e9, damageResist: 0.6 })).toBe(0.8);
  });

  it('comparison flags better/worse rows and the stat preview uses the real pipeline', () => {
    const base = gen(11, { baseId: 'plasma_repeater', level: 1, rarity: 'common' });
    const better = gen(11, { baseId: 'plasma_repeater', level: 30, rarity: 'common' });
    const rows = compareItems(better, base);
    expect(rows.find((r) => r.key === 'w.damage')!.verdict).toBe(1);
    const shield = gen(12, { baseId: 'shield_matrix', rarity: 'rare' });
    const prev = statPreview([base], shield, null);
    expect(prev.find((r) => r.stat === 'shieldCapacity')!.verdict).toBe(1);
  });

  it('every base and affix references a real stat', () => {
    for (const a of AFFIXES) expect(STAT_DEFS[a.stat]).toBeDefined();
    for (const b of BASES) for (const s of b.implicit) expect(STAT_DEFS[s.stat]).toBeDefined();
    const cats = new Set<Category>(BASES.map((b) => b.category));
    for (const c of CATEGORIES) expect(cats.has(c)).toBe(true);
  });
});

import { convertsToSalvage, expiresAfterWave, HARD_LIMIT, isExpired, LOW_GRADE_LIMIT } from '../src/loot/lifetime';

describe('physical loot rules (scenario G)', () => {
  it('a drop from wave W survives W, W+1, W+2 and expires when W+2 is cleared', () => {
    expect(expiresAfterWave(4)).toBe(6);
    expect(isExpired(4, 4)).toBe(false);
    expect(isExpired(4, 5)).toBe(false);
    expect(isExpired(4, 6)).toBe(true);
  });

  it('saturation converts only low-grade drops; rare+ always spawn until the hard guard', () => {
    expect(convertsToSalvage(LOW_GRADE_LIMIT - 1, 'common')).toBe(false);
    expect(convertsToSalvage(LOW_GRADE_LIMIT, 'uncommon')).toBe(true);
    expect(convertsToSalvage(LOW_GRADE_LIMIT + 30, 'rare')).toBe(false);
    expect(convertsToSalvage(LOW_GRADE_LIMIT + 30, 'legendary')).toBe(false);
    expect(convertsToSalvage(HARD_LIMIT, 'exotic')).toBe(true);
  });
});
