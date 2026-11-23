// Touch mode: whether the touch overlay drives the game. Auto mode follows the last pointer kind (a tap turns it on,
// a mouse click turns it off); the setting can force it either way. Also fullscreen + landscape lock on engage.
import { nextTouchState, wantsTouch, type TouchPref } from '@riftwarden/game/core/touch';
import type { Flow } from '../core/Flow';

let active = false;
const subs = new Set<() => void>();
let flowRef: Flow | null = null;
/** Automation: count engage requests instead of entering fullscreen (headless fullscreen resizes the page). */
let simulateImmersive = false;
export const immersiveStats = { requests: 0 };

export const touchStore = {
  get: (): boolean => active,
  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

function env() {
  return {
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    touchPoints: navigator.maxTouchPoints ?? 0,
  };
}

/** Touch-capable device (first-start graphics defaults, install hints). */
export function isTouchDevice(): boolean {
  return wantsTouch('auto', env());
}

function setActive(on: boolean): void {
  if (on === active) return;
  active = on;
  const flow = flowRef;
  if (flow) {
    flow.input.touch = on;
    flow.input.clear();
    // Leaving touch without pointer lock: the game is not controllable, show the pause menu (RESUME locks the mouse).
    if (!on && !flow.input.captured) pauseWorld(flow);
  }
  document.documentElement.toggleAttribute('data-touch', on);
  for (const fn of subs) fn();
}

/** Same as Escape: the pause menu of the current world. */
export function pauseWorld(flow: Flow): void {
  if (flow.arena) {
    if (flow.arena.screen === 'playing') flow.arena.setScreen('paused');
  } else if (flow.home && flow.home.screen === 'home') flow.home.setScreen('paused');
  flow.input.clear();
}

export function initTouch(flow: Flow, opts: { force?: boolean; simulate?: boolean } = {}): void {
  flowRef = flow;
  simulateImmersive = !!opts.simulate;
  flow.input.onEngage = enterImmersive;
  setActive(opts.force || wantsTouch(flow.settings.touchControls, env()));
  window.addEventListener(
    'pointerdown',
    (e) => setActive(nextTouchState(flowRef?.settings.touchControls ?? 'auto', active, e.pointerType)),
    { capture: true, passive: true },
  );
}

/** Settings changed: explicit choices apply at once, auto keeps the current state (or turns on for touch screens). */
export function applyTouchPref(pref: TouchPref): void {
  setActive(pref === 'auto' ? active || wantsTouch('auto', env()) : pref === 'on');
}

const standalone = () => typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches);

/** Fullscreen + landscape lock (must run inside a user gesture). Silently does nothing where unsupported (iPhone). */
export function enterImmersive(): void {
  immersiveStats.requests++;
  if (simulateImmersive) return;
  const lock = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
  };
  const el = document.documentElement;
  if (!document.fullscreenElement && !standalone() && typeof el.requestFullscreen === 'function') {
    el.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {});
  } else lock();
}
