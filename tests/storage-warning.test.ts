// Deploy heads-up: storage within five bays of capacity warns before a run; over capacity is the blocker's job.
import { describe, expect, it } from 'vitest';
import { storageWarning } from '@riftwarden/rules/progression/save';

const st = (used: number, capacity: number) => ({ storage: { uids: Array.from({ length: used }, (_, i) => `u${i}`), capacity } });

describe('storageWarning', () => {
  it('is quiet with room to spare', () => {
    expect(storageWarning(st(10, 40))).toBeNull();
    expect(storageWarning(st(34, 40))).toBeNull();
  });
  it('warns within the margin, including exactly full', () => {
    expect(storageWarning(st(35, 40))).toContain('35/40');
    expect(storageWarning(st(40, 40))).toContain('40/40');
  });
  it('leaves over-capacity to the deploy blocker', () => {
    expect(storageWarning(st(41, 40))).toBeNull();
  });
});
