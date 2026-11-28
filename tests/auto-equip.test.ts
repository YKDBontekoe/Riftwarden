// Equip best for the build: greedy swaps that raise the build score, one equip per step.
import { describe, expect, it } from 'vitest';
import { bestLoadoutSteps } from '@riftwarden/rules/loot/autoEquip';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { SLOTS } from '@riftwarden/rules/progression/items';
import type { Category } from '@riftwarden/rules/loot/types';

const make = (uid: string, category: Category, level: number, rarity: 'common' | 'rare' | 'epic' = 'rare', seed = 1) => generateItem({ uid, seed, level, rarity, category, source: 'test' });
const empty = () => SLOTS.map(() => null);

describe('bestLoadoutSteps', () => {
  it('fills an empty slot with the strongest fitting item', () => {
    const steps = bestLoadoutSteps(empty(), [make('weak', 'armor', 1, 'common'), make('strong', 'armor', 40, 'epic', 7)]);
    const armor = steps.find((s) => s.slot === 'armor');
    expect(armor?.uid).toBe('strong');
  });
  it('makes no change when nothing in storage is better', () => {
    const eq: ReturnType<typeof empty> = empty();
    const worn = make('worn', 'armor', 50, 'epic', 3);
    (eq as unknown[])[SLOTS.findIndex((s) => s.id === 'armor')] = worn;
    expect(bestLoadoutSteps(eq, [make('low', 'armor', 1, 'common', 9)]).filter((s) => s.slot === 'armor')).toEqual([]);
  });
  it('skips locked slots and never uses an item twice', () => {
    const items = [make('a1', 'armor', 30), make('a2', 'armor', 31, 'rare', 4), make('s1', 'shield', 30)];
    const steps = bestLoadoutSteps(empty(), items, { locked: ['shield'] });
    expect(steps.some((s) => s.slot === 'shield')).toBe(false);
    expect(new Set(steps.map((s) => s.uid)).size).toBe(steps.length);
  });
  it('stays fast with a full storage', () => {
    const cats: Category[] = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'ability', 'ultimate'];
    const items = Array.from({ length: 80 }, (_, i) => make(`i${i}`, cats[i % cats.length], 5 + (i % 30), i % 3 === 0 ? 'epic' : 'rare', i + 11));
    const t = performance.now();
    const steps = bestLoadoutSteps(empty(), items);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(steps.length).toBeGreaterThan(0);
  });
});
