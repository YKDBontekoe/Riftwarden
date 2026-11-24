// Item sets: seed-decided membership, 2 / 4 piece bonuses through the real stat pipeline, persistence rules.
import { describe, expect, it } from 'vitest';
import { computeStats } from '@riftwarden/rules/combat/stats';
import { equipmentModifiers } from '@riftwarden/rules/loot/equipment';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { RARITIES } from '@riftwarden/rules/loot/rarity';
import { activeSetBonuses, SET_CATEGORIES, SET_CHANCE, SET_IDS, setBonusModifiers, setCounts, setFor, SETS } from '@riftwarden/rules/loot/sets';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { generateUnique, UNIQUES } from '@riftwarden/rules/loot/uniques';
import { sanitizeItem } from '@riftwarden/rules/progression/save';

const piece = (uid: string, set: ItemInstance['set'], category: ItemInstance['category'] = 'armor'): ItemInstance => ({ ...generateItem({ uid, seed: 11, level: 10, rarity: 'rare', category, source: 'test', now: 1 }), set });

describe('item sets', () => {
  it('membership is seed-decided: rare+ gear only, about one in five, every set appears', () => {
    const seen = new Map<string, number>();
    let hits = 0;
    const N = 4000;
    for (let s = 1; s <= N; s++) {
      const id = setFor(s, 3, 'processor');
      expect(setFor(s, 3, 'processor')).toBe(id);
      expect(setFor(s, 1, 'processor')).toBeNull();
      expect(setFor(s, 5, 'weapon')).toBeNull();
      expect(setFor(s, 5, 'module')).toBeNull();
      if (id) {
        hits++;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    expect(Math.abs(hits / N - SET_CHANCE)).toBeLessThan(0.03);
    expect([...seen.keys()].sort()).toEqual([...SET_IDS].sort());
  });

  it('generated items carry the seed-decided set; starter-grade rolls and uniques never do', () => {
    let withSet = 0;
    for (let s = 1; s < 400; s++) {
      for (const category of SET_CATEGORIES) {
        const it = generateItem({ uid: `g${s}${category}`, seed: s, level: 20, rarity: 'epic', category, source: 'test', now: 1 });
        expect(it.set ?? null).toBe(setFor(s, RARITIES.findIndex((r) => r.id === 'epic'), category));
        if (it.set) withSet++;
      }
    }
    expect(withSet).toBeGreaterThan(100);
    const fixed = generateItem({ uid: 'fx', seed: 3, level: 5, rarity: 'legendary', category: 'armor', source: 'test', now: 1, fixedRoll: 0.5 });
    expect(fixed.set).toBeUndefined();
    for (const u of UNIQUES) for (let s = 1; s < 40; s++) expect(generateUnique(u, { uid: `u${s}`, seed: s, level: 20, source: 'test' }).set).toBeUndefined();
  });

  it('two and four pieces turn on their bonuses through the equipment stat block; one item counts once', () => {
    const a = piece('a', 'bastion', 'armor');
    const b = piece('b', 'bastion', 'shield');
    const c = piece('c', 'bastion', 'reactor');
    const d = piece('d', 'bastion', 'accessory');
    expect(setBonusModifiers([a])).toEqual([]);
    expect(setBonusModifiers([a, b]).map((m) => m.stat)).toEqual(['maxHealthMult']);
    expect(setBonusModifiers([a, b, c, d]).map((m) => m.stat).sort()).toEqual(['damageResist', 'maxHealthMult', 'shieldCapacity']);
    expect(setCounts([a, a, b]).get('bastion')).toBe(2);
    const base = computeStats(equipmentModifiers([{ ...a, set: undefined }, { ...b, set: undefined }]));
    const set2 = computeStats(equipmentModifiers([a, b]));
    expect(set2.maxHealthMult).toBeGreaterThan(base.maxHealthMult);
    const full = activeSetBonuses([a, b, c, d])[0];
    expect(full.set.id).toBe('bastion');
    expect(full.bonuses.length).toBe(2);
    // Mixed sets: each counts on its own.
    expect(activeSetBonuses([a, b, piece('e', 'deadeye', 'processor')]).map((x) => [x.set.id, x.bonuses.length])).toEqual([['bastion', 1], ['deadeye', 0]]);
    for (const s of SET_IDS) expect(SETS[s].bonuses.map((x) => x.pieces)).toEqual([2, 4]);
  });

  it('sanitize keeps a valid set on set gear and drops it elsewhere', () => {
    const a = piece('s1', 'conflux', 'processor');
    expect(sanitizeItem(JSON.parse(JSON.stringify(a)))!.set).toBe('conflux');
    expect(sanitizeItem({ ...JSON.parse(JSON.stringify(a)), set: 'bogus' })!.set).toBeUndefined();
    const w = { ...generateItem({ uid: 'w1', seed: 4, level: 10, rarity: 'rare', category: 'weapon', source: 'test', now: 1 }), set: 'deadeye' };
    expect(sanitizeItem(JSON.parse(JSON.stringify(w)))!.set).toBeUndefined();
  });
});

describe('set target farming', () => {
  it('favoured sources drop their set far more often; other sources keep the plain odds', async () => {
    const { DROP_SOURCES } = await import('@riftwarden/rules/loot/drops');
    const { favouredSet, SET_SOURCES } = await import('@riftwarden/rules/loot/sets');
    for (const id of SET_IDS) for (const src of SET_SOURCES[id]) {
      expect(src in DROP_SOURCES, src).toBe(true);
      expect(favouredSet(src)).toBe(id);
    }
    const N = 4000;
    const count = (source: string | undefined, set: string) => {
      let n = 0;
      for (let s = 1; s <= N; s++) if (setFor(s, 3, 'armor', source) === set) n++;
      return n / N;
    };
    // Unfavoured sources: unchanged from the plain roll (no shift for existing seeds).
    for (let s = 1; s <= 500; s++) expect(setFor(s, 3, 'armor', 'walker')).toBe(setFor(s, 3, 'armor'));
    expect(count('bulwark', 'bastion')).toBeGreaterThan(count(undefined, 'bastion') * 4);
    expect(count('marksman', 'deadeye')).toBeGreaterThan(0.25);
    // Generated items carry it through the drop source.
    const it = (s: number) => generateItem({ uid: `f${s}`, seed: s, level: 20, rarity: 'epic', category: 'armor', source: 'run', dropSource: 'enforcer', now: 1 });
    let bastion = 0;
    for (let s = 1; s < 300; s++) if (it(s).set === 'bastion') bastion++;
    expect(bastion).toBeGreaterThan(60);
  });
});
