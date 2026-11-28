// Settings options: vertical look speed, mute, background mute and the frame-rate readout load and clamp safely.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, exportSettings, importSettings, RETICLE_COLORS, RETICLE_HEX, sanitizeSettings, withOsPreferences } from '@riftwarden/game/core/settings';

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

describe('first-start OS preferences', () => {
  it('reduced motion turns off motion effects and shake; more contrast adds the HUD backing', () => {
    expect(withOsPreferences(DEFAULT_SETTINGS, { reducedMotion: false, moreContrast: false })).toEqual(DEFAULT_SETTINGS);
    expect(withOsPreferences(DEFAULT_SETTINGS, { reducedMotion: true, moreContrast: false })).toMatchObject({ reduceMotion: true, shake: 0, hudBacking: false });
    expect(withOsPreferences(DEFAULT_SETTINGS, { reducedMotion: false, moreContrast: true })).toMatchObject({ reduceMotion: false, hudBacking: true });
  });
});

describe('settings copy and paste', () => {
  it('round-trips everything but the device renderer', () => {
    const mine = { ...DEFAULT_SETTINGS, fov: 104, reticleColor: 'green' as const, keys: { ...DEFAULT_SETTINGS.keys, jump: 'KeyV', dash: 'Space' }, renderer: 'webgpu' as const };
    const other = { ...DEFAULT_SETTINGS, renderer: 'webgl' as const };
    const got = importSettings(exportSettings(mine), other)!;
    expect(got).toEqual({ ...mine, renderer: 'webgl' });
  });
  it('refuses anything that is not an exported block', () => {
    expect(importSettings('hello', DEFAULT_SETTINGS)).toBeNull();
    expect(importSettings('{"fov": 100}', DEFAULT_SETTINGS)).toBeNull();
    expect(importSettings('', DEFAULT_SETTINGS)).toBeNull();
  });
  it('sanitizes pasted values', () => {
    const got = importSettings(JSON.stringify({ 'riftwarden-settings': 2, data: { fov: 400, volume: -3 } }), DEFAULT_SETTINGS)!;
    expect(got.fov).toBe(110);
    expect(got.volume).toBe(0);
  });
});

