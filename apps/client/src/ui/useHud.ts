import { useSyncExternalStore } from 'react';
import { type HudState, hudStore } from '@riftwarden/game/ui/store';

/** React binding of the HUD snapshot store (the store itself lives in the game package, free of React). */
export function useHud<S>(select: (s: HudState) => S): S {
  return useSyncExternalStore(hudStore.subscribe, () => select(hudStore.get()));
}
