// Settings options: vertical look speed, mute, background mute and the frame-rate readout load and clamp safely.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, RETICLE_COLORS, RETICLE_HEX, sanitizeSettings } from '@riftwarden/game/core/settings';

describe('settings: look, audio and readout options', () => {
  it('defaults keep old saves unchanged', () => {
    const s = sanitizeSettings({}, 2);
    expect(s).toMatchObject({ sensitivityY: 1, muted: false, muteInBackground: true, showFps: false });
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and validates', () => {
    expect(sanitizeSettings({ sensitivityY: 9 }).sensitivityY).toBe(2);
    expect(sanitizeSettings({ sensitivityY: 0.1 }).sensitivityY).toBe(0.5);
    expect(sanitizeSettings({ sensitivityY: 'fast' }).sensitivityY).toBe(1);
    expect(sanitizeSettings({ muted: 'yes', showFps: 1 })).toMatchObject({ muted: false, showFps: false });
    expect(sanitizeSettings({ muted: true, muteInBackground: false, showFps: true })).toMatchObject({ muted: true, muteInBackground: false, showFps: true });
  });
});

describe('settings: reticle, flashing and HUD backing', () => {
  it('defaults and validation', () => {
    expect(sanitizeSettings({})).toMatchObject({ reticleColor: 'white', reticleOpacity: 0.95, reduceFlashing: false, hudBacking: false });
    expect(sanitizeSettings({ reticleColor: 'green', reticleOpacity: 0.1, reduceFlashing: true, hudBacking: true })).toMatchObject({ reticleColor: 'green', reticleOpacity: 0.4, reduceFlashing: true, hudBacking: true });
    expect(sanitizeSettings({ reticleColor: 'plaid', reticleOpacity: 'x' })).toMatchObject({ reticleColor: 'white', reticleOpacity: 0.95 });
  });
  it('every reticle colour has a CSS value', () => {
    for (const c of RETICLE_COLORS) expect(RETICLE_HEX[c]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

