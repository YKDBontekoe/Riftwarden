// Key labels (every physical key gets a readable name), reserved keys and the changed-binding marker.
import { describe, expect, it } from 'vitest';
import { ACTIONS, changedBindings, DEFAULT_SETTINGS, isReservedKey, keyLabel, keyRemap, movementLabel } from '@riftwarden/game/core/settings';

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
