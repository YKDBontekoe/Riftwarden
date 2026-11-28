// Low-hull audio cue: one warning tone when the hull drops into the critical band (the HUD banner's 25%), re-armed
// only once the hull recovers past 40%, so hovering at the threshold does not repeat it.
import { useEffect } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { hudStore } from '@riftwarden/game/ui/store';

export const HULL_CUE_AT = 0.25;
export const HULL_CUE_REARM = 0.4;

/** Next cue state (pure): `play` once on entering the band while armed; dead drones (frac 0) never cue. */
export function hullCue(armed: boolean, frac: number): { armed: boolean; play: boolean } {
  if (armed && frac > 0 && frac < HULL_CUE_AT) return { armed: false, play: true };
  if (!armed && frac >= HULL_CUE_REARM) return { armed: true, play: false };
  return { armed, play: false };
}

/** Arena HUD: play the cue from the 20 Hz snapshot. */
export function useLowHullCue(): void {
  useEffect(() => {
    let armed = true;
    return hudStore.subscribe(() => {
      const s = hudStore.get();
      if (s.respawnIn > 0 || s.playerMax <= 0) return;
      const next = hullCue(armed, s.playerHp / s.playerMax);
      armed = next.armed;
      if (next.play) sfx.play('alarm', { volume: 0.55 });
    });
  }, []);
}
