// Window state: the tab title follows the run, audio mutes and fades out in the background.
import { describe, expect, it } from 'vitest';
import { Sfx } from '@riftwarden/game/audio/Sfx';
import { backgroundMuted, windowTitle } from '../apps/client/src/core/windowState';

describe('audio mute', () => {
  it('mute and background fade zero the output and keep the volume', () => {
    const s = new Sfx();
    s.setVolume(0.5);
    expect(s.outputLevel).toBe(0.5);
    s.setMuted(true);
    expect(s.outputLevel).toBe(0);
    s.setMuted(false);
    s.setBackground(true);
    expect(s.outputLevel).toBe(0);
    s.setBackground(false);
    expect(s.outputLevel).toBe(0.5);
  });

  it('background fade follows the setting, visibility and focus', () => {
    expect(backgroundMuted(true, true, true)).toBe(true);
    expect(backgroundMuted(true, false, false)).toBe(true);
    expect(backgroundMuted(true, false, true)).toBe(false);
    expect(backgroundMuted(false, true, false)).toBe(false);
  });
});

describe('window title', () => {
  const run = { tier: 3, checkpointOpen: false } as NonNullable<Parameters<typeof windowTitle>[0]['run']>;
  it('is plain outside a run', () => {
    expect(windowTitle({ screen: 'home', location: 'home', wave: 0, phase: 'prep', run: null })).toBe('Riftwarden');
    expect(windowTitle({ screen: 'transit', location: 'arena', wave: 2, phase: 'prep', run })).toBe('Riftwarden');
  });
  it('shows the wave and state of a run', () => {
    expect(windowTitle({ screen: 'playing', location: 'arena', wave: 7, phase: 'combat', run })).toBe('Wave 7 · RL 3 · Riftwarden');
    expect(windowTitle({ screen: 'paused', location: 'arena', wave: 7, phase: 'combat', run })).toBe('Paused · Wave 7 · RL 3 · Riftwarden');
    expect(windowTitle({ screen: 'playing', location: 'arena', wave: 5, phase: 'prep', run: { ...run, checkpointOpen: true } })).toBe('Checkpoint · Wave 5 · RL 3 · Riftwarden');
    expect(windowTitle({ screen: 'playing', location: 'arena', wave: 2, phase: 'prep', run })).toBe('Preparing · Wave 2 · RL 3 · Riftwarden');
    expect(windowTitle({ screen: 'defeat', location: 'arena', wave: 9, phase: 'combat', run })).toBe('Reactor lost · Wave 9 · RL 3 · Riftwarden');
  });
});
