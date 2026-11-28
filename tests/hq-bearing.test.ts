// HQ station list: the arrow beside each station points the way to walk, relative to where the warden faces.
import { describe, expect, it } from 'vitest';
import { bearingArrow } from '../apps/client/src/ui/HomeHud';

describe('bearingArrow', () => {
  it('points relative to the facing direction (facing = (sin yaw, cos yaw), right = +x at yaw 0)', () => {
    expect(bearingArrow(0, 10, 0)).toBe('↑');
    expect(bearingArrow(10, 0, 0)).toBe('→');
    expect(bearingArrow(-10, 0, 0)).toBe('←');
    expect(bearingArrow(0, -10, 0)).toBe('↓');
    expect(bearingArrow(10, 10, 0)).toBe('↗');
  });
  it('turns with the warden', () => {
    expect(bearingArrow(10, 0, Math.PI / 2)).toBe('↑');
    expect(bearingArrow(0, 10, Math.PI / 2)).toBe('←');
    expect(bearingArrow(0, 10, -Math.PI)).toBe('↓');
  });
});
