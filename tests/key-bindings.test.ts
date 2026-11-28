// Key labels (every physical key gets a readable name), reserved keys and the changed-binding marker.
import { describe, expect, it } from 'vitest';
import { ACTIONS, changedBindings, DEFAULT_SETTINGS, isReservedKey, keyLabel, keyRemap, movementLabel, fixedKeyNote, rebind, sanitizeSettings } from '@riftwarden/game/core/settings';

describe('key labels', () => {
  it('keeps the established labels', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit4')).toBe('4');
    expect(keyLabel('ShiftLeft')).toBe('L-SHIFT');
    expect(keyLabel('ControlLeft')).toBe('L-CTRL');
    expect(keyLabel('Space')).toBe('SPACE');
    expect(keyLabel('F3')).toBe('F3');
    expect(keyLabel(undefined)).toBe('—');
    expect(movementLabel(DEFAULT_SETTINGS.keys)).toBe('WASD');
  });

  it('names keys that used to print their raw code', () => {
    expect(keyLabel('ControlRight')).toBe('R-CTRL');
    expect(keyLabel('AltLeft')).toBe('L-ALT');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Numpad7')).toBe('NUM 7');
    expect(keyLabel('NumpadAdd')).toBe('NUM +');
    expect(keyLabel('Backquote')).toBe('`');
    expect(keyLabel('BracketLeft')).toBe('[');
    expect(keyLabel('CapsLock')).toBe('CAPS');
    expect(keyLabel('KeyQuux')).toBe('KEYQUUX');
  });

  it('arrow keys make a readable movement legend', () => {
    const keys = { ...DEFAULT_SETTINGS.keys, forward: 'ArrowUp', left: 'ArrowLeft', back: 'ArrowDown', right: 'ArrowRight' };
    expect(movementLabel(keys)).toBe('↑←↓→');
  });
});

describe('bindings', () => {
  it('reserves the keys the game always handles', () => {
    for (const k of ['Escape', 'Tab', 'F3', 'F4', 'F10']) expect(isReservedKey(k)).toBe(true);
    for (const k of ['KeyW', 'Space', 'ShiftLeft', 'F5']) expect(isReservedKey(k)).toBe(false);
    // No default binding may sit on a reserved key.
    for (const a of ACTIONS) expect(isReservedKey(a.def)).toBe(false);
  });

  it('lists the changed bindings', () => {
    expect(changedBindings(DEFAULT_SETTINGS.keys).size).toBe(0);
    const keys = { ...DEFAULT_SETTINGS.keys, jump: 'KeyV', use: 'KeyE' };
    expect([...changedBindings(keys)]).toEqual(['jump']);
    expect(keyRemap({ ...DEFAULT_SETTINGS, keys }).get('KeyV')).toBe('Space');
  });
});

describe('alternate bindings', () => {
  const K = DEFAULT_SETTINGS.keys;
  it('an alternate presses the same action as the main key', () => {
    const r = rebind(K, {}, 'jump', true, 'KeyV');
    if ('error' in r) throw new Error(r.error);
    expect(r.keys2).toEqual({ jump: 'KeyV' });
    expect(keyRemap({ ...DEFAULT_SETTINGS, ...r }).get('KeyV')).toBe('Space');
    expect(keyRemap({ ...DEFAULT_SETTINGS, ...r }).get('Space')).toBeUndefined();
  });
  it('refuses another action\'s main key, its own key and reserved keys', () => {
    expect(rebind(K, {}, 'jump', true, 'KeyE')).toHaveProperty('error');
    expect(rebind(K, {}, 'jump', true, 'Space')).toHaveProperty('error');
    expect(rebind(K, {}, 'jump', true, 'Escape')).toHaveProperty('error');
  });
  it('moves an alternate between actions, and a main key takes it over', () => {
    const a = rebind(K, { jump: 'KeyV' }, 'use', true, 'KeyV');
    expect(a).toEqual({ keys: K, keys2: { use: 'KeyV' } });
    const b = rebind(K, { jump: 'KeyV' }, 'dash', false, 'KeyV');
    if ('error' in b) throw new Error(b.error);
    expect(b.keys.dash).toBe('KeyV');
    expect(b.keys2).toEqual({});
  });
  it('a main key that clashes swaps with the other action', () => {
    const r = rebind(K, {}, 'jump', false, 'KeyE');
    if ('error' in r) throw new Error(r.error);
    expect(r.keys.jump).toBe('KeyE');
    expect(r.keys.use).toBe('Space');
  });
  it('sanitize drops alternates that clash with main keys, each other or reserved keys', () => {
    const s = sanitizeSettings({ keys2: { jump: 'KeyV', use: 'KeyV', dash: 'KeyE', slide: 'Tab', grapple: 'KeyN' } });
    expect(s.keys2).toEqual({ jump: 'KeyV', grapple: 'KeyN' });
    expect(sanitizeSettings({}).keys2).toEqual({});
  });
});

describe('fixed arena keys', () => {
  it('warns when a binding hides a fixed shortcut', () => {
    expect(fixedKeyNote('KeyV')).toContain('tower core');
    expect(fixedKeyNote('KeyK')).toBeNull();
    // Rebinding really hides it: the physical key now reaches the game as the action's code.
    expect(keyRemap({ ...DEFAULT_SETTINGS, keys2: { jump: 'KeyV' } }).get('KeyV')).toBe('Space');
  });
});

