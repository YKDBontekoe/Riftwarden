// Upgrade and checkpoint choices: number row and numpad pick the same card.
import { describe, expect, it } from 'vitest';
import { pickIndex } from '../apps/client/src/ui/Roguelite';

describe('pickIndex', () => {
  it('maps the number row and the numpad', () => {
    expect(pickIndex('Digit1')).toBe(0);
    expect(pickIndex('Numpad3')).toBe(2);
    expect(pickIndex('Digit9')).toBe(8);
  });
  it('ignores everything else', () => {
    for (const c of ['Digit0', 'Numpad0', 'KeyA', 'F1', 'NumpadAdd']) expect(pickIndex(c)).toBe(-1);
  });
});
