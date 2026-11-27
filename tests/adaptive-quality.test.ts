// Adaptive quality controller: steps down only under sustained load, back up only with clear headroom, never pumps.
import { describe, expect, it } from 'vitest';
import { ADAPTIVE, AdaptiveQuality, QUALITY_LEVELS } from '@riftwarden/game/core/adaptiveQuality';
import { FrameStats } from '@riftwarden/game/core/frameStats';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@riftwarden/game/core/settings';

/** Feed `seconds` of frames at `ms` each; returns the levels seen at every change. */
function run(q: AdaptiveQuality, ms: number, seconds: number, changes: number[] = []): number[] {
  const n = Math.ceil((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) if (q.sample(ms)) changes.push(q.level);
  return changes;
}

describe('adaptive quality', () => {
  it('stays at full quality while the target is met', () => {
    const q = new AdaptiveQuality(60);
    expect(run(q, 16.6, 60)).toEqual([]);
    expect(q.level).toBe(0);
  });

  it('steps down under sustained overload, one level per cooldown, and stops at the floor', () => {
    const q = new AdaptiveQuality(60);
    const changes = run(q, 30, 60);
    expect(changes).toEqual([1, 2, 3, 4]);
    expect(q.current).toBe(QUALITY_LEVELS[QUALITY_LEVELS.length - 1]);
    // First step only after two overloaded windows.
    const q2 = new AdaptiveQuality(60);
    expect(run(q2, 30, (ADAPTIVE.downAfter - 1) * ADAPTIVE.windowMs / 1000)).toEqual([]);
  });

  it('a short spike or a single slow second does not change quality', () => {
    const q = new AdaptiveQuality(60);
    run(q, 16.6, 5);
    run(q, 40, 1); // one bad second
    run(q, 16.6, 5);
    expect(q.level).toBe(0);
    // Hitches over the ignore threshold (loading, tab switch) are not load.
    for (let i = 0; i < 20; i++) q.sample(900);
    expect(q.level).toBe(0);
  });

  it('recovers only with clear headroom, and does not oscillate around the budget', () => {
    const q = new AdaptiveQuality(60);
    run(q, 30, 10);
    const low = q.level;
    expect(low).toBeGreaterThan(0);
    // Just under budget: neither overloaded nor clear headroom -> holds.
    expect(run(q, 16, 30)).toEqual([]);
    // Clear headroom: climbs back one level at a time.
    const up = run(q, 9, 60);
    expect(up[0]).toBe(low - 1);
    expect(q.level).toBe(0);
  });

  it('judges the window by its slow frames (p90), not the average', () => {
    const q = new AdaptiveQuality(60);
    // 80% fast frames, 20% at 35 ms: average ~20 ms but p90 is 35 ms -> overload.
    for (let s = 0; s < 6; s++) for (let i = 0; i < 50; i++) q.sample(i % 5 === 0 ? 35 : 14);
    expect(q.level).toBeGreaterThan(0);
  });

  it('off returns to full quality', () => {
    const q = new AdaptiveQuality(60);
    run(q, 30, 10);
    q.targetFps = 0;
    expect(q.sample(30)).toBe(true);
    expect(q.level).toBe(0);
    expect(run(q, 50, 10)).toEqual([]);
  });

  it('higher targets demand shorter frames', () => {
    const q = new AdaptiveQuality(144);
    run(q, 10, 10); // 100 FPS: fine for 60, overloaded for 144
    expect(q.level).toBeGreaterThan(0);
  });
});

describe('frame stats (F3 lows)', () => {
  it('reports the slow tail, over a rolling window', () => {
    const f = new FrameStats(1000);
    for (let i = 0; i < 1000; i++) f.push(i % 100 === 0 ? 50 : 10);
    const s = f.summary();
    expect(s.p99).toBe(50);
    expect(s.low1).toBe(20);
    // The window rolls: 1000 smooth frames push the spikes out.
    for (let i = 0; i < 1000; i++) f.push(8);
    expect(f.summary()).toMatchObject({ p99: 8, low1: 125 });
    f.push(Number.NaN);
    f.push(-1);
    expect(f.summary().p99).toBe(8);
  });
});

describe('adaptive quality setting', () => {
  it('defaults to a 60 FPS target and only accepts the offered targets', () => {
    expect(DEFAULT_SETTINGS.adaptiveTarget).toBe(60);
    expect(sanitizeSettings({}, 2).adaptiveTarget).toBe(60);
    expect(sanitizeSettings({ adaptiveTarget: 144 }, 2).adaptiveTarget).toBe(144);
    expect(sanitizeSettings({ adaptiveTarget: 0 }, 2).adaptiveTarget).toBe(0);
    expect(sanitizeSettings({ adaptiveTarget: 75 }, 2).adaptiveTarget).toBe(60);
    expect(sanitizeSettings({ adaptiveTarget: '120' }, 2).adaptiveTarget).toBe(60);
  });
});

