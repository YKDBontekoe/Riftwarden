// Synced preferences: the profile stores a bounded copy of the settings (setPrefs op), the save keeps it, and a client
// merges it over its own settings without touching device-specific options.
import { describe, expect, it } from 'vitest';
import { sanitizePrefs } from '@riftwarden/rules/progression/prefs';
import { runOp } from '@riftwarden/rules/progression/ops';
import { createDefaultSave, sanitizeSave } from '@riftwarden/rules/progression/save';
import { DEFAULT_SETTINGS } from '@riftwarden/game/core/settings';
import { DEVICE_FIELDS, mergeSynced, samePrefs, syncedSettings } from '../apps/client/src/core/prefsSync';

describe('sanitizePrefs', () => {
  it('keeps primitives and key bindings, drops anything else', () => {
    const p = sanitizePrefs({ settings: { fov: 100, invertY: true, reticleColor: 'green', keys: { jump: 'KeyV', bad: 'Key W!' }, nested: { a: 1 }, 'bad key': 1, long: 'x'.repeat(99) }, ui: { minimap: true, junk: [1] }, at: 5 })!;
    expect(p.settings).toEqual({ fov: 100, invertY: true, reticleColor: 'green', keys: { jump: 'KeyV' } });
    expect(p.ui).toEqual({ minimap: true });
    expect(p.at).toBe(5);
  });
  it('rejects empty or malformed values', () => {
    expect(sanitizePrefs(null)).toBeNull();
    expect(sanitizePrefs('x')).toBeNull();
    expect(sanitizePrefs({ settings: {}, ui: {} })).toBeNull();
  });
});

describe('setPrefs op', () => {
  it('stores the prefs stamped with the entry time and survives a save round trip', () => {
    const d = createDefaultSave(1000, { profileId: 'p1', starterUid: 's1' });
    const r = runOp(d, 'setPrefs', [{ settings: { fov: 96 }, ui: { minimap: false } }], undefined, 4242);
    expect(r.ok).toBe(true);
    expect(d.prefs).toEqual({ settings: { fov: 96 }, ui: { minimap: false }, at: 4242 });
    const back = sanitizeSave(JSON.parse(JSON.stringify(d)), 5000).data;
    expect(back.prefs).toEqual(d.prefs);
  });
  it('refuses an empty payload and oversized input', () => {
    const d = createDefaultSave(1000, { profileId: 'p1', starterUid: 's1' });
    expect(runOp(d, 'setPrefs', [{}], undefined, 1).ok).toBe(false);
    expect(runOp(d, 'setPrefs', [{ settings: { s: 'x'.repeat(5000) } }], undefined, 1).ok).toBe(false);
    expect(d.prefs).toBeUndefined();
  });
  it('fits a full settings payload in the op size limit', () => {
    expect(JSON.stringify({ settings: syncedSettings(DEFAULT_SETTINGS), ui: { minimap: true, priority: 'build', invSort: 'rarity' } }).length).toBeLessThan(4000);
  });
});

describe('client merge', () => {
  it('syncs everything except device options', () => {
    const s = syncedSettings(DEFAULT_SETTINGS);
    for (const k of DEVICE_FIELDS) expect(s).not.toHaveProperty(k);
    expect(s).toHaveProperty('fov');
    expect(s).toHaveProperty('keys');
  });
  it('applies synced values over local ones and keeps the device options', () => {
    const local = { ...DEFAULT_SETTINGS, quality: 'low' as const, renderScale: 0.6, renderer: 'webgpu' as const, fov: 90 };
    const remote = syncedSettings({ ...DEFAULT_SETTINGS, quality: 'high', renderScale: 1, fov: 104, keys: { ...DEFAULT_SETTINGS.keys, jump: 'KeyV', dash: 'Space' } });
    const m = mergeSynced(local, remote);
    expect(m.fov).toBe(104);
    expect(m.keys.jump).toBe('KeyV');
    expect(m).toMatchObject({ quality: 'low', renderScale: 0.6, renderer: 'webgpu' });
  });
  it('sanitizes synced values again', () => {
    expect(mergeSynced(DEFAULT_SETTINGS, { fov: 999 }).fov).toBe(110);
  });
  it('compares content regardless of key order', () => {
    expect(samePrefs({ settings: { a: 1, b: 2 }, ui: {} }, { settings: { b: 2, a: 1 }, ui: {} })).toBe(true);
    expect(samePrefs({ settings: { a: 1 }, ui: {} }, { settings: { a: 2 }, ui: {} })).toBe(false);
    expect(samePrefs(undefined, { settings: {}, ui: {} })).toBe(false);
  });
});
