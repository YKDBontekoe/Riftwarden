// Minimap toggle (the final HUD design uses the compass; the top-down radar is optional, kept per device).
import { Store } from '@riftwarden/game/ui/store';

const KEY = 'riftwarden.minimap';
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export const minimapStore = new Store<{ on: boolean }>({ on: typeof localStorage === 'undefined' ? false : read() });

export function setMinimap(on: boolean): void {
  minimapStore.set({ on });
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: session only */
  }
}
