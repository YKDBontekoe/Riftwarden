import { describe, expect, it } from 'vitest';
import { BASE_FOG, blendMood, calmMood, moodFor, type MoodInput } from '@riftwarden/game/visuals/mood';

const base: MoodInput = { tier: 1, boss: false, event: null, reactorFrac: 1, time: 0 };
const finite = (m: ReturnType<typeof moodFor>) => [...m.fog, ...m.sunTint, m.fogMul, m.exposureAdd, m.contrastAdd, m.vignetteAdd, m.tension, m.flicker].every(Number.isFinite);

describe('mood director', () => {
  it('tier I calm is the existing look', () => {
    const m = moodFor(base);
    expect(m.fog).toEqual(BASE_FOG);
    expect(m.fogMul).toBe(1);
    expect(m.tension).toBe(0);
  });
  it('every situation is finite and bounded', () => {
    for (const tier of [0, 1, 3, 5, 99, NaN]) {
      for (const event of [null, 'swarm', 'eliteAssault', 'instability', 'hvt'] as const) {
        for (const boss of [false, true]) {
          for (const reactorFrac of [-1, 0, 0.2, 1, 5]) {
            const m = moodFor({ tier, boss, event, reactorFrac, time: 12.3 });
            expect(finite(m)).toBe(true);
            expect(m.tension).toBeGreaterThanOrEqual(0);
            expect(m.tension).toBeLessThanOrEqual(1);
            expect(m.fogMul).toBeGreaterThan(0.5);
            expect(m.fogMul).toBeLessThan(3);
          }
        }
      }
    }
  });
  it('boss waves are darker, redder and tenser than calm', () => {
    const calm = moodFor(base);
    const boss = moodFor({ ...base, boss: true });
    const lum = (f: number[]) => f[0] + f[1] + f[2];
    expect(lum(boss.fog)).toBeLessThan(lum(calm.fog));
    expect(boss.fog[0]).toBeGreaterThan(boss.fog[2]);
    expect(boss.exposureAdd).toBeLessThan(0);
    expect(boss.tension).toBeGreaterThan(calm.tension);
  });
  it('higher tiers are denser; low reactor raises tension', () => {
    expect(moodFor({ ...base, tier: 5 }).fogMul).toBeGreaterThan(moodFor(base).fogMul);
    expect(moodFor({ ...base, reactorFrac: 0.1 }).tension).toBeGreaterThan(0.6);
  });
  it('blend converges and recovers after the boss is gone', () => {
    const cur = calmMood();
    const boss = moodFor({ ...base, boss: true });
    for (let i = 0; i < 300; i++) blendMood(cur, boss, 1 / 60);
    expect(cur.fogMul).toBeCloseTo(boss.fogMul, 2);
    for (let i = 0; i < 600; i++) blendMood(cur, moodFor(base), 1 / 60);
    expect(cur.fogMul).toBeCloseTo(1, 2);
    expect(cur.fog[2]).toBeCloseTo(BASE_FOG[2], 2);
  });
});
