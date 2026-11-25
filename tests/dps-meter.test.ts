import { describe, expect, it } from 'vitest';
import { BURST_WINDOW, DpsMeter } from '@riftwarden/rules/combat/dpsMeter';

describe('firing range DPS meter', () => {
  it('reads zero before any hit and ignores bad samples', () => {
    const m = new DpsMeter();
    m.add(1, NaN);
    m.add(1, -5);
    const r = m.read(2);
    expect(r).toMatchObject({ dps: 0, burst: 0, sustained: 0, total: 0, critRate: 0, hits: 0, elapsed: 0 });
  });

  it('steady fire reads the true rate in every window', () => {
    const m = new DpsMeter();
    for (let t = 0; t <= 20; t += 0.1) m.add(t, 10);
    const r = m.read(20);
    expect(Math.abs(r.dps - 100)).toBeLessThan(4);
    expect(r.sustained).toBeCloseTo(100, -1);
    expect(r.burst).toBeCloseTo(100, -1);
  });

  it('keeps the best burst after the fire stops and the live DPS falls', () => {
    const m = new DpsMeter();
    for (let t = 0; t < BURST_WINDOW; t += 0.1) m.add(t, 30);
    const later = m.read(20);
    expect(later.dps).toBe(0);
    expect(later.burst).toBeGreaterThan(250);
    expect(later.total).toBeCloseTo(900, 0);
  });

  it('a single shot does not read as an infinite rate', () => {
    const m = new DpsMeter();
    m.add(5, 400);
    const r = m.read(5);
    expect(Number.isFinite(r.dps)).toBe(true);
    expect(r.dps).toBeLessThanOrEqual(400);
    expect(r.sustained).toBeLessThanOrEqual(400);
  });

  it('counts the crit rate per hit and resets cleanly', () => {
    const m = new DpsMeter();
    m.hit(true);
    m.hit(false);
    m.hit(false);
    m.hit(true);
    expect(m.read(0).critRate).toBe(0.5);
    m.reset();
    expect(m.read(10)).toMatchObject({ hits: 0, total: 0, burst: 0 });
  });

  it('bounds its history to the sustained window', () => {
    const m = new DpsMeter();
    for (let t = 0; t < 600; t += 0.05) m.add(t, 1);
    expect((m as unknown as { samples: unknown[] }).samples.length).toBeLessThanOrEqual(30 / 0.05 + 2);
  });
});
