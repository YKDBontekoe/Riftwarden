import { describe, expect, it } from 'vitest';
import { openSpans } from '@riftwarden/game/visuals/railing';

describe('deck railing spans', () => {
  it('leaves a gap where a ramp lands and drops slivers', () => {
    expect(openSpans(0, 10, [])).toEqual([[0, 10]]);
    expect(openSpans(0, 10, [[3, 6]])).toEqual([[0, 3], [6, 10]]);
    expect(openSpans(0, 10, [[0.2, 9.7]])).toEqual([]);
    expect(openSpans(0, 10, [[-1, 2], [8, 12]])).toEqual([[2, 8]]);
  });
});
