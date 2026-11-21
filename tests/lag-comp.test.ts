import { describe, expect, it } from 'vitest';
import { blendStep, BLEND_S, PositionTrail, REWIND_S } from '@riftwarden/rules/net/lagComp';

describe('lag compensation trail', () => {
  it('matches a claim against where a moving target was, not only where it is', () => {
    const trail = new PositionTrail();
    // Target runs along +x at 14 m/s (a rush drone), sampled at 20 Hz.
    for (let i = 0; i <= 10; i++) trail.push(i * 0.05, i * 0.7, 1, 0);
    const now: [number, number, number] = [7.7, 1, 0];
    expect(trail.distance(3.5, 1, 0, now)).toBeCloseTo(0, 5); // seen ~300 ms ago
    expect(trail.distance(3.85, 1.2, 0, now)).toBeCloseTo(0.2, 5); // between samples
    expect(trail.distance(7.7, 1, 0, now)).toBe(0);
  });

  it('forgets positions older than the rewind window', () => {
    const trail = new PositionTrail();
    for (let i = 0; i <= 40; i++) trail.push(i * 0.05, i, 0, 0);
    expect(trail.size).toBeLessThanOrEqual(Math.ceil(REWIND_S / 0.05) + 2);
    // 2 s ago the target was at x = 0: no longer claimable.
    expect(trail.distance(0, 0, 0, [40, 0, 0])).toBeGreaterThan(25);
  });

  it('blends a correction completely over the blend time at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      let left = BLEND_S;
      let applied = 0;
      let remaining = 1;
      while (left > 0) {
        const k = blendStep(dt, left);
        applied += remaining * k;
        remaining -= remaining * k;
        left -= dt;
      }
      expect(applied).toBeCloseTo(1, 6);
    }
  });
});
