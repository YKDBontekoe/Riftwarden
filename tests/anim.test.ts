import { describe, expect, it } from 'vitest';
import { Spring, damp, impulse, smoothstep } from '../src/visuals/anim';

describe('anim helpers', () => {
  it('spring settles to target and stays finite for huge dt', () => {
    const s = new Spring(200, 20);
    s.kick(5);
    for (let i = 0; i < 120; i++) s.step(1 / 60, 0);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
    const big = new Spring(300, 10);
    big.kick(10);
    expect(Number.isFinite(big.step(5, 1))).toBe(true);
  });
  it('damp is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 8, 1 / 60);
    const b = damp(0, 1, 8, 1);
    expect(a).toBeCloseTo(b, 6);
  });
  it('smoothstep clamps and impulse is zero before t=0', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(impulse(-1, 90, 13)).toBe(0);
    expect(impulse(0.05, 90, 13)).toBeGreaterThan(0);
  });
});
