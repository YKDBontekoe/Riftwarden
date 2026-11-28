// Hold-to-collect: drops within reach, best rarity first, then level, then nearest.
import { describe, expect, it } from 'vitest';
import { SWEEP_HOLD, sweepOrder } from '@riftwarden/rules/loot/sweep';

describe('sweepOrder', () => {
  const c = (id: number, x: number, rarityIndex: number, level = 1) => ({ id, x, z: 0, rarityIndex, level });
  it('takes only drops within reach', () => {
    expect(sweepOrder([c(1, 1, 0), c(2, 5, 4)], 0, 0, 3.4)).toEqual([1]);
  });
  it('orders by rarity, then level, then distance', () => {
    expect(sweepOrder([c(1, 1, 0), c(2, 2, 3), c(3, 3, 3, 9), c(4, 0.5, 0)], 0, 0, 3.4)).toEqual([3, 2, 4, 1]);
  });
  it('a tap is shorter than the hold', () => {
    expect(SWEEP_HOLD).toBeGreaterThan(0.2);
  });
});
