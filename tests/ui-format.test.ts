// UI number and time formatting.
import { describe, expect, it } from 'vitest';
import { fmtTime, plural } from '../apps/client/src/ui/format';
import { spendNote } from '../apps/client/src/ui/economy';

describe('fmtTime', () => {
  it('formats minutes and hours', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(65.9)).toBe('1:05');
    expect(fmtTime(3599)).toBe('59:59');
    expect(fmtTime(3600)).toBe('1:00:00');
    expect(fmtTime(7384)).toBe('2:03:04');
  });
  it('reads bad input as zero', () => {
    expect(fmtTime(-5)).toBe('0:00');
    expect(fmtTime(Number.NaN)).toBe('0:00');
    expect(fmtTime(Infinity)).toBe('0:00');
  });
});

describe('plural', () => {
  it('picks the noun for the count', () => {
    expect(plural(1, 'kill')).toBe('1 kill');
    expect(plural(0, 'kill')).toBe('0 kills');
    expect(plural(2, 'boss', 'bosses')).toBe('2 bosses');
    expect(plural(1, 'boss', 'bosses')).toBe('1 boss');
    expect(plural(12345, 'wave')).toBe((12345).toLocaleString() + ' waves');
  });
});

describe('spendNote', () => {
  it('says what is left or how far short', () => {
    expect(spendNote(1500, 400)).toBe(`${(1100).toLocaleString()} left after this`);
    expect(spendNote(100, 100)).toBe('0 left after this');
    expect(spendNote(100, 2600)).toBe(`Short by ${(2500).toLocaleString()}`);
  });
});

