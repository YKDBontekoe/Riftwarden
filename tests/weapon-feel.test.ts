import { describe, expect, it } from 'vitest';
import { shotFeel, yawPattern } from '@riftwarden/game/combat/weaponFeel';

describe('shot feel', () => {
  it('heavier shots punch harder, within bounds', () => {
    const low = shotFeel('rail', 'charge', 0.3);
    const full = shotFeel('rail', 'charge', 1);
    expect(full.punchFov).toBeGreaterThan(low.punchFov);
    expect(full.trauma).toBeGreaterThan(low.trauma);
    for (const p of [-5, 0, 1, 3, 1e9, NaN]) {
      const f = shotFeel('plasma', 'auto', p);
      for (const v of [f.punchFov, f.punchRoll, f.trauma, f.light, f.flashTime]) expect(Number.isFinite(v)).toBe(true);
      expect(f.punchFov).toBeLessThan(0.08);
      expect(f.trauma).toBeLessThanOrEqual(1);
    }
  });

  it('family character: rail heaviest, beam almost still, scatter kicks more than auto', () => {
    expect(shotFeel('rail', 'charge').punchFov).toBeGreaterThan(shotFeel('plasma', 'auto').punchFov);
    expect(shotFeel('beam', 'beam').punchFov).toBeLessThan(0.005);
    expect(shotFeel('plasma', 'scatter').punchFov).toBeGreaterThan(shotFeel('plasma', 'auto').punchFov);
    expect(shotFeel('plasma', 'auto').trauma).toBe(0);
    for (const f of [shotFeel('plasma', 'auto'), shotFeel('rail', 'cycle'), shotFeel('beam', 'pulse')]) expect(f.recoverIdle).toBeGreaterThanOrEqual(f.recoverFiring);
  });

  it('sideways pattern is deterministic and drifts right on average', () => {
    const a = Array.from({ length: 200 }, (_, i) => yawPattern(i));
    expect(a).toEqual(Array.from({ length: 200 }, (_, i) => yawPattern(i)));
    const right = a.filter((s) => s > 0).length / a.length;
    expect(right).toBeGreaterThan(0.55);
    expect(right).toBeLessThan(0.85);
  });
});
