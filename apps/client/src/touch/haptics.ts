// Touch haptics: a short vibration when the drone takes a hit (Settings > Controls > Vibration), scaled by how hard
// the hit was and throttled so a stream of small hits does not buzz continuously. Only where the browser supports it.
import { useEffect } from 'react';
import { uiEvents } from '@riftwarden/game/ui/store';

export const PULSE_GAP_MS = 140;

/** Vibration length for a hit (pure): 12 ms for a graze up to 60 ms for a heavy hit; shield hits are lighter. */
export function hurtPulse(severity: number, shield: boolean): number {
  const s = Number.isFinite(severity) ? Math.min(1, Math.max(0, severity)) : 0;
  return Math.round((12 + s * 48) * (shield ? 0.6 : 1));
}

/** Subscribe while `enabled` (touch controls showing and the setting on). */
export function useHurtHaptics(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    let last = 0;
    return uiEvents.on('hurt', (e) => {
      const now = performance.now();
      if (now - last < PULSE_GAP_MS) return;
      last = now;
      navigator.vibrate(hurtPulse(e.severity, e.shield));
    });
  }, [enabled]);
}
