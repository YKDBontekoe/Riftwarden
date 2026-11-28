// UI number and time formatting.
import { describe, expect, it } from 'vitest';
import { fmtTime } from '../apps/client/src/ui/format';

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
