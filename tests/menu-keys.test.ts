// Menu keys: arrows and W/S wrap, Home/End jump, digits run the numbered item on the main menu.
import { describe, expect, it } from 'vitest';
import { menuKey } from '../apps/client/src/ui/FrontEnd';

describe('menuKey', () => {
  it('moves with wrap-around', () => {
    expect(menuKey('ArrowDown', 4, 5)).toEqual({ sel: 0, run: false });
    expect(menuKey('KeyW', 0, 5)).toEqual({ sel: 4, run: false });
    expect(menuKey('KeyS', 1, 5)).toEqual({ sel: 2, run: false });
    expect(menuKey('End', 1, 5)).toEqual({ sel: 4, run: false });
    expect(menuKey('Home', 3, 5)).toEqual({ sel: 0, run: false });
  });
  it('digits run an item only on numbered menus, within range', () => {
    expect(menuKey('Digit3', 0, 5, true)).toEqual({ sel: 2, run: true });
    expect(menuKey('Numpad1', 4, 5, true)).toEqual({ sel: 0, run: true });
    expect(menuKey('Digit6', 0, 5, true)).toBeNull();
    expect(menuKey('Digit3', 0, 5)).toBeNull();
    expect(menuKey('KeyA', 0, 5, true)).toBeNull();
  });
});
