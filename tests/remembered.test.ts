// Session memory for UI choices: a remembered value is used only while it is still valid.
import { describe, expect, it } from 'vitest';
import { recall } from '../apps/client/src/ui/remembered';

describe('recall', () => {
  it('falls back when nothing or something stale is remembered', () => {
    const m = new Map<string, string>();
    expect(recall('t', 'buy', undefined, m)).toBe('buy');
    m.set('t', 'sell');
    expect(recall('t', 'buy', undefined, m)).toBe('sell');
    expect(recall('t', 'buy', (v) => v !== 'sell', m)).toBe('buy');
  });
});
