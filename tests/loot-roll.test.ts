import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../src/combat/damage';
import { DROP_SOURCES, type DropSource, rollDrops } from '../src/loot/drops';
import { generateItem, hashSeed } from '../src/loot/generate';
import { rollLoot, scaleChance } from '../src/loot/roll';

const TIER = { lootLevelBonus: 8, lootLuck: 1.3 };

/** The inline implementation this module replaced (Game.rollItems / ServerGame.rollFor), kept as the reference. */
function reference(src: DropSource, wave: number, rand: () => number, mult: number, origin: string, counter: { n: number }, prefix: string) {
  const table = mult === 1 ? src : { ...src, chance: Math.min(1, src.chance * mult) };
  const ctx = { wave, tierLevelBonus: TIER.lootLevelBonus, tierLuck: TIER.lootLuck };
  return rollDrops(table, ctx, rand).map((d) =>
    generateItem({ uid: `${prefix}.${++counter.n}`, seed: d.seed, level: d.level, rarity: d.rarity, category: d.category, baseId: d.baseId, allowExclusive: d.baseId ? [d.baseId] : [], source: origin }),
  );
}

function viaModule(src: DropSource, wave: number, rand: () => number, mult: number, origin: string, counter: { n: number }, prefix: string) {
  return rollLoot({ source: src, wave, tier: TIER, rand, nextUid: () => `${prefix}.${++counter.n}`, originId: origin, chanceMult: mult });
}

describe('rollLoot', () => {
  const sources: DropSource[] = Object.values(DROP_SOURCES);
  // acquiredAt is a wall-clock stamp; freeze it so equality is about the roll, not the millisecond.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('is identical to the previous inline implementation for every source, wave, seed and chance multiplier', () => {
    let items = 0;
    for (const src of sources) {
      for (const wave of [1, 2, 5, 11, 40]) {
        for (const mult of [1, 3, 100]) {
          const seed = hashSeed(`run.${src.id}.${wave}`);
          const a = { n: 0 };
          const b = { n: 0 };
          const old = reference(src, wave, mulberry32(seed), mult, 'run', a, 'run');
          const now = viaModule(src, wave, mulberry32(seed), mult, 'run', b, 'run');
          expect(now).toEqual(old);
          expect(b.n).toBe(a.n);
          items += now.length;
        }
      }
    }
    expect(items).toBeGreaterThan(200); // the comparison is not vacuous
  });

  it('consumes the stream deterministically across consecutive rolls (state carries over)', () => {
    const src = DROP_SOURCES.checkpoint ?? sources[0];
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    const c1 = { n: 0 };
    const c2 = { n: 0 };
    const seqOld = [1, 2, 3].flatMap((w) => reference(src, w, r1, 1, 'x', c1, 'x'));
    const seqNew = [1, 2, 3].flatMap((w) => viaModule(src, w, r2, 1, 'x', c2, 'x'));
    expect(seqNew.map((i) => i.uid)).toEqual(seqOld.map((i) => i.uid));
    expect(seqNew).toEqual(seqOld);
  });

  it('per-player streams are independent: one player consuming randomness does not change another', () => {
    const src = DROP_SOURCES.wave ?? sources[0];
    const mk = (seed: number) => ({ rand: mulberry32(seed), c: { n: 0 } });
    const solo = viaModule(src, 6, mk(1).rand, 1, 't', { n: 0 }, 't.0');
    const a = mk(1);
    const b = mk(2);
    for (let i = 0; i < 5; i++) viaModule(src, 6, b.rand, 1, 't', b.c, 't.1'); // player B rolls a lot first
    const withNoise = viaModule(src, 6, a.rand, 1, 't', a.c, 't.0');
    expect(withNoise).toEqual(solo);
  });

  it('uids are unique and sequential, and items record their origin', () => {
    const src = sources.find((s) => s.rolls >= 2 && s.chance >= 0.5) ?? sources[0];
    const c = { n: 0 };
    const items = viaModule(src, 10, mulberry32(3), 100, 'origin-1', c, 'origin-1');
    expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
    items.forEach((it, i) => expect(it.uid).toBe(`origin-1.${i + 1}`));
    expect(items.every((it) => JSON.stringify(it).includes('origin-1'))).toBe(true);
  });

  it('scaleChance clamps to 1, leaves 1x untouched and never mutates the table', () => {
    const src = sources[0];
    const before = JSON.stringify(src);
    expect(scaleChance(src, 1)).toBe(src);
    expect(scaleChance(src, 1e6).chance).toBe(1);
    expect(scaleChance(src, 0).chance).toBe(0);
    expect(JSON.stringify(src)).toBe(before);
  });

  it('a zero-chance multiplier drops nothing (outside guaranteed waves)', () => {
    const src = sources.find((s) => s.guaranteedThroughWave === undefined) ?? sources[0];
    const items = viaModule(src, 30, mulberry32(9), 0, 'o', { n: 0 }, 'o');
    expect(items).toEqual([]);
  });
});
