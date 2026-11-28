// Window-level conveniences that follow the HUD and settings: the tab title shows where a run stands (useful with the
// game in a background tab), and audio fades out while the window is hidden or unfocused.
import { sfx } from '@riftwarden/game/audio/Sfx';
import { hudStore, type HudState } from '@riftwarden/game/ui/store';
import type { Settings } from '@riftwarden/game/core/settings';

const BASE = 'Riftwarden';

/** Tab title for a HUD state (pure): "Wave 7 · RL 3 · Riftwarden", "Paused · Wave 7 · ...", HQ and menus plain. */
export function windowTitle(h: Pick<HudState, 'screen' | 'location' | 'wave' | 'phase' | 'run'>): string {
  if (h.location !== 'arena' || !h.run || h.screen === 'transit' || h.screen === 'loading') return BASE;
  const parts: string[] = [];
  if (h.screen === 'paused') parts.push('Paused');
  else if (h.screen === 'defeat') parts.push('Reactor lost');
  else if (h.screen === 'checkpoint' || h.run.checkpointOpen) parts.push('Checkpoint');
  else if (h.phase === 'prep') parts.push('Preparing');
  if (h.wave > 0) parts.push(`Wave ${h.wave}`);
  parts.push(`RL ${h.run.tier}`, BASE);
  return parts.join(' · ');
}

/** Whether the background fade applies (pure): only with the setting on and the window out of view or focus. */
export function backgroundMuted(pref: boolean, hidden: boolean, focused: boolean): boolean {
  return pref && (hidden || !focused);
}

/** Install the title and background-audio watchers once; `settings` reads the live settings. */
export function watchWindow(settings: () => Settings): void {
  if (typeof document === 'undefined') return;
  let title = document.title;
  hudStore.subscribe(() => {
    const next = windowTitle(hudStore.get());
    if (next !== title) document.title = title = next;
  });
  // Focus starts unknown in automation (headless pages report no focus): only an actual blur counts as unfocused.
  let focused = true;
  const update = () => sfx.setBackground(backgroundMuted(settings().muteInBackground, document.hidden, focused));
  document.addEventListener('visibilitychange', update);
  window.addEventListener('blur', () => {
    focused = false;
    update();
  });
  window.addEventListener('focus', () => {
    focused = true;
    update();
  });
  refreshBackground = update;
}

let refreshBackground: () => void = () => {};

/** Settings changed: re-evaluate the background fade (turning the option off unmutes right away). */
export function applyWindowSettings(s: Settings): void {
  sfx.setMuted(s.muted);
  refreshBackground();
}
