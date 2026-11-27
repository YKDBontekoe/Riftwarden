import { invoke } from '@tauri-apps/api/core';
import type { NativeMouseCapture } from '@riftwarden/game/core/Input';

/** AppKit supplies relative movement when WKWebView cannot lock the pointer. */
export function nativeMouseCapture(): NativeMouseCapture {
  let generation = 0;
  let transition: Promise<unknown> = Promise.resolve();
  const command = <T>(name: string): Promise<T> => {
    const next = transition.catch(() => {}).then(() => invoke<T>(name));
    transition = next;
    return next;
  };
  return {
    async start(move, lost) {
      const current = ++generation;
      try {
        if (!await command<boolean>('desktop_mouse_start')) return false;
        if (generation !== current) {
          await command('desktop_mouse_stop');
          return false;
        }
        const poll = async (): Promise<void> => {
          if (generation !== current) return;
          try {
            const delta = await invoke<{ active: boolean; x: number; y: number; held: number; pressed: number; released: number; wheel: number }>('desktop_mouse_take');
            if (generation !== current) return;
            if (!delta.active) { lost(); return; }
            move(delta.x, delta.y, delta.held, delta.pressed, delta.released, delta.wheel);
            requestAnimationFrame(() => { void poll(); });
          } catch {
            if (generation === current) lost();
          }
        };
        requestAnimationFrame(() => { void poll(); });
        return true;
      } catch (error) {
        console.error('Mouse capture failed', error);
        return false;
      }
    },
    stop() {
      generation++;
      void command('desktop_mouse_stop').catch((error: unknown) => console.error('Mouse release failed', error));
    },
  };
}
