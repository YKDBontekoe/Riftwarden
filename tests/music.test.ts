import { describe, expect, it } from 'vitest';
import { ease, MUSIC_TRACKS, musicIntensity, musicTarget, rootHz, stepPattern } from '@riftwarden/game/audio/musicPlan';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@riftwarden/game/core/settings';

const combat = { scene: 'arena' as const, phase: 'combat', alive: 10, aliveCap: 42, reactorFrac: 1 };

describe('adaptive music plan', () => {
  it('plays exactly one track per state, the boss loop winning in a boss fight', () => {
    const sum = (t: ReturnType<typeof musicTarget>) => MUSIC_TRACKS.reduce((s, k) => s + t.tracks[k], 0);
    expect(musicTarget({ scene: 'hq' }).tracks.hq).toBe(1);
    expect(musicTarget({ scene: 'arena', phase: 'prep' }).tracks.prep).toBe(1);
    expect(musicTarget(combat).tracks.combat).toBe(1);
    expect(musicTarget({ ...combat, boss: true }).tracks.boss).toBe(1);
    for (const i of [{ scene: 'hq' as const }, { scene: 'arena' as const, phase: 'cleared' }, combat, { ...combat, boss: true }]) expect(sum(musicTarget(i))).toBe(1);
  });

  it('keeps the HQ calm: no procedural layers', () => {
    expect(musicTarget({ scene: 'hq' }).layers).toEqual({ pulse: 0, drums: 0, riser: 0 });
  });

  it('builds with the fight: intensity monotone in enemies, danger, chain and boss', () => {
    let last = -1;
    for (const alive of [0, 10, 20, 30, 42]) {
      const v = musicIntensity({ ...combat, alive });
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(musicIntensity({ ...combat, reactorFrac: 0.2 })).toBeGreaterThan(musicIntensity(combat));
    expect(musicIntensity({ ...combat, chain: 6 })).toBeGreaterThan(musicIntensity(combat));
    expect(musicIntensity({ ...combat, boss: true })).toBeGreaterThan(musicIntensity(combat));
    expect(musicTarget({ ...combat, alive: 40, boss: true }).layers.drums).toBeGreaterThan(musicTarget({ ...combat, alive: 0 }).layers.drums);
    expect(musicIntensity({ scene: 'arena', phase: 'prep', alive: 40 })).toBe(0);
  });

  it('is deterministic per seed and frame-rate independent', () => {
    const groove = (seed: number) => Array.from({ length: 16 }, (_, s) => stepPattern('bass', s, seed));
    expect(groove(7)).toEqual(groove(7));
    expect(stepPattern('kick', 0, 3).v).toBe(1);
    expect(rootHz(1)).toBeGreaterThan(50);
    // Two half steps land where one full step does.
    expect(ease(ease(0, 1, 0.05, 2), 1, 0.05, 2)).toBeCloseTo(ease(0, 1, 0.1, 2), 10);
  });

  it('stores the music volume as an optional, clamped setting', () => {
    expect(DEFAULT_SETTINGS.musicVolume).toBe(0.6);
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, musicVolume: 3 }).musicVolume).toBe(1);
    const { musicVolume: _drop, ...old } = DEFAULT_SETTINGS;
    void _drop;
    expect(sanitizeSettings(old).musicVolume).toBe(0.6);
  });
});
