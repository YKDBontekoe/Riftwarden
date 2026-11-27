import { describe, expect, it } from 'vitest';
import { machineRoofSlots } from '@riftwarden/game/visuals/machineModel';

describe('machinery bank', () => {
  it('places one roof vessel per gameplay collider, evenly inside the run', () => {
    for (const run of [6, 9.5, 14]) {
      const s = machineRoofSlots(run);
      expect(s).toHaveLength(3);
      for (const a of s) expect(Math.abs(a)).toBeLessThan(run / 2);
      expect(s[1]).toBeCloseTo(0, 10);
      expect(s[2] - s[1]).toBeCloseTo(s[1] - s[0], 10);
    }
  });
});
