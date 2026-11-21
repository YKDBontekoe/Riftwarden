import { describe, expect, it } from 'vitest';
import { MAX_FRAGMENT, MIN_FRAGMENT, pickFragments } from '@riftwarden/game/fx/fragmentPlan';
import { STYLES, styleMix } from '@riftwarden/game/fx/explosionStyles';
import { SEV_FIRE, SEV_SPARKS, WOUND, woundSeverity } from '@riftwarden/game/fx/wounds';
import { HitLean, hitImpulse, LEAN } from '@riftwarden/game/enemies/hitReact';
import { assemblyPose } from '@riftwarden/game/towers/assembly';
import { BLAST, deathStyle } from '@riftwarden/game/enemies/deathAnims';
import { ENEMIES } from '@riftwarden/rules/data/defs';

describe('mechanical fragmentation plan', () => {
  const c = (id: string, sx: number, sy: number, sz: number) => ({ item: id, sx, sy, sz });
  it('keeps the most visible parts, skipping greebles and whole hulls', () => {
    const picked = pickFragments([c('bolt', 0.03, 0.03, 0.05), c('hull', 5, 3, 5), c('plate', 0.9, 0.08, 0.7), c('leg', 0.25, 1.2, 0.25), c('head', 0.5, 0.4, 0.5)], 2);
    expect(picked.map((p) => p.item)).toEqual(['plate', 'leg']);
  });
  it('respects max and thresholds', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`p${i}`, 0.2 + i * 0.01, 0.3, 0.2));
    expect(pickFragments(many, 7)).toHaveLength(7);
    expect(pickFragments(many, 0)).toHaveLength(0);
    expect(pickFragments([c('a', MIN_FRAGMENT * 0.9, 0.01, 0.01), c('b', MAX_FRAGMENT * 1.1, 1, 1)], 5)).toHaveLength(0);
    expect(pickFragments([c('nan', Number.NaN, 1, 1)], 5)).toHaveLength(0);
  });
});

describe('explosion styles', () => {
  it('every style is finite and distinct from fire', () => {
    for (const [id, s] of Object.entries(STYLES)) {
      for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v) && v >= 0, id).toBe(true);
      if (id !== 'fire') expect(s, id).not.toEqual(STYLES.fire);
    }
    expect(styleMix(undefined)).toBe(STYLES.fire);
    expect(STYLES.cryo.fire).toBe(0);
    expect(STYLES.cryo.scorch).toBe(false);
    expect(STYLES.heavy.secondaries).toBeGreaterThan(0);
  });
  it('death styles: mutations override the archetype, every blast kind is a real enemy', () => {
    for (const k of Object.keys(BLAST)) expect(ENEMIES[k as keyof typeof ENEMIES], k).toBeTruthy();
    expect(deathStyle('walker', ['frostbound'], false)).toBe('cryo');
    expect(deathStyle('rusher', ['molten'], false)).toBe('heavy');
    expect(deathStyle('rusher', [], false)).toBe('plasma');
    expect(deathStyle('walker', [], true)).toBe('heavy');
    expect(deathStyle('walker', [], false)).toBeUndefined();
  });
});

describe('damage states', () => {
  it('no wound above the smoke threshold, rising severity below it', () => {
    expect(woundSeverity(100, 100)).toBe(0);
    expect(woundSeverity(100 * (1 - WOUND.smoke) + 1, 100)).toBe(0);
    let prev = 0;
    for (let hp = 54; hp >= 0; hp -= 3) {
      const s = woundSeverity(hp, 100);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
    expect(woundSeverity(5, 0)).toBe(0);
    expect(woundSeverity(Number.NaN, 100)).toBe(0);
    expect(SEV_SPARKS).toBeGreaterThan(0);
    expect(SEV_FIRE).toBeGreaterThan(SEV_SPARKS);
  });
});

describe('directional hit reaction', () => {
  it('leans away from the source and settles back', () => {
    const l = new HitLean();
    // Facing +z (yaw 0), shot from behind (-z): pushed forward = positive pitch.
    l.kick(0, 1, 0, hitImpulse(0.2));
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      l.step(1 / 60);
      peak = Math.max(peak, l.pitch);
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThanOrEqual(LEAN.maxAngle);
    for (let i = 0; i < 120; i++) l.step(1 / 60);
    expect(l.active).toBe(false);
    // Pushed to its right (+x when facing +z) tips the top toward +x: negative roll.
    l.kick(1, 0, 0, 3);
    l.step(1 / 60);
    expect(l.roll).toBeLessThan(0);
  });
  it('impulse grows with the damage share and stays bounded', () => {
    expect(hitImpulse(0.5)).toBeGreaterThan(hitImpulse(0.05));
    expect(hitImpulse(100)).toBe(hitImpulse(1));
    expect(Number.isFinite(hitImpulse(Number.NaN))).toBe(true);
  });
});

describe('tower assembly', () => {
  it('starts sunk, ends exactly at rest', () => {
    const a = assemblyPose(0);
    expect(a.sink).toBeGreaterThan(1);
    expect(a.headLift).toBeGreaterThan(1);
    expect(a.glow).toBe(0);
    const z = assemblyPose(1);
    expect(z.sink).toBeCloseTo(0, 6);
    expect(z.stretch).toBeCloseTo(1, 6);
    expect(z.headLift).toBeCloseTo(0, 6);
    expect(z.headSpin).toBeCloseTo(0, 6);
    expect(z.glow).toBeCloseTo(1, 6);
    expect(z.stage).toBe(2);
  });
  it('stages advance monotonically', () => {
    let last = 0;
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const p = assemblyPose(f);
      expect(p.stage).toBeGreaterThanOrEqual(last);
      last = p.stage;
      expect(Number.isFinite(p.headLift + p.sink + p.glow)).toBe(true);
    }
  });
});
