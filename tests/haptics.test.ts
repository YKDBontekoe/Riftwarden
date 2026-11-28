// Touch haptics: hit pulses scale with severity, shield hits are lighter, and the setting defaults on.
import { describe, expect, it } from 'vitest';
import { hurtPulse } from '../apps/client/src/touch/haptics';
import { sanitizeSettings } from '@riftwarden/game/core/settings';

describe('hurtPulse', () => {
  it('scales with severity and clamps', () => {
    expect(hurtPulse(0, false)).toBe(12);
    expect(hurtPulse(1, false)).toBe(60);
    expect(hurtPulse(5, false)).toBe(60);
    expect(hurtPulse(Number.NaN, false)).toBe(12);
  });
  it('is lighter on the shield', () => {
    expect(hurtPulse(1, true)).toBeLessThan(hurtPulse(1, false));
  });
  it('setting defaults on and can be turned off', () => {
    expect(sanitizeSettings({}).haptics).toBe(true);
    expect(sanitizeSettings({ haptics: false }).haptics).toBe(false);
  });
});
