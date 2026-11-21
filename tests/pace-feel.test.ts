import { describe, expect, it } from 'vitest';
import { FrameClock } from '@riftwarden/game/core/frameClock';
import { DEATH_TIME, wreckKnock } from '@riftwarden/game/enemies/deathAnims';
import { ENEMIES } from '@riftwarden/rules/data/defs';
import { HEAT_PACE } from '@riftwarden/rules/combat/heat';
import { weaponSummary } from '@riftwarden/rules/loot/equipment';
import { PLASMA_REPEATER } from '@riftwarden/rules/data/defs';

describe('frame clock', () => {
  it('smooths jitter around a steady rate without losing time', () => {
    const c = new FrameClock();
    let raw = 0;
    let used = 0;
    const out: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 600; i++) {
      const r = 1 / 60 + (rnd() - 0.5) * 0.004;
      raw += r;
      const d = c.next(r);
      used += d;
      if (i > 30) out.push(d);
    }
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    const sd = Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length);
    // Raw jitter has a standard deviation of ~1.15 ms; the filter output is far steadier.
    expect(sd).toBeLessThan(0.0005);
    expect(Math.abs(raw - used)).toBeLessThan(1 / 60);
  });

  it('passes real rate changes and hitches through (clamped)', () => {
    const c = new FrameClock(1 / 20);
    for (let i = 0; i < 60; i++) c.next(1 / 60);
    let last = 0;
    for (let i = 0; i < 20; i++) last = c.next(1 / 120);
    expect(Math.abs(last - 1 / 120)).toBeLessThan(0.001);
    expect(c.next(0.5)).toBeLessThanOrEqual(1 / 20);
    expect(c.next(0)).toBe(0);
    expect(c.next(Number.NaN)).toBe(0);
  });
});

describe('fast-paced tuning', () => {
  it('enemies are fast but the rush drone stays the fastest regular', () => {
    expect(ENEMIES.walker.speed).toBeGreaterThanOrEqual(5.5);
    expect(ENEMIES.rusher.speed).toBeGreaterThan(ENEMIES.walker.speed * 2);
    for (const d of Object.values(ENEMIES)) if (d.role !== 'boss' && d.kind !== 'courier') expect(d.speed).toBeLessThanOrEqual(ENEMIES.rusher.speed);
  });

  it('wrecks clear quickly and are knocked back a bounded distance', () => {
    for (const t of Object.values(DEATH_TIME)) expect(t).toBeLessThanOrEqual(0.75);
    // Travel = v / drag at most.
    for (const kind of ['walker', 'rusher', 'bulwark'] as const) expect(wreckKnock(kind, ENEMIES[kind].scale, kind === 'rusher') / 5).toBeLessThan(2);
  });

  it('heat tempo shows up in the weapon summary', () => {
    const s = weaponSummary(PLASMA_REPEATER);
    expect(s.heat).toBeCloseTo(PLASMA_REPEATER.heatPerShot * HEAT_PACE.gain);
    expect(s.cool).toBeCloseTo(PLASMA_REPEATER.coolRate * HEAT_PACE.cool);
    expect(s.sustain).toBeGreaterThan(2);
  });
});

describe('TTK pass', () => {
  it('the starter repeater kills a basic walker in about 0.3 s (3 bolts) and every family stays fast', async () => {
    const { DAMAGE_PACE } = await import('@riftwarden/rules/combat/heat');
    const { RAILGUN, BEAM_EMITTER } = await import('@riftwarden/rules/data/defs');
    const hp = ENEMIES.walker.hp;
    const shots = Math.ceil(hp / (PLASMA_REPEATER.damage * DAMAGE_PACE));
    expect(shots).toBeLessThanOrEqual(3);
    expect((shots - 1) / PLASMA_REPEATER.fireRate).toBeLessThanOrEqual(0.3);
    // A full rail charge one-shots a walker; the beam (no ramp) needs well under a second.
    expect(RAILGUN.damage * DAMAGE_PACE).toBeGreaterThanOrEqual(hp);
    expect(hp / (BEAM_EMITTER.damage * DAMAGE_PACE * BEAM_EMITTER.fireRate)).toBeLessThan(0.5);
  });
});
