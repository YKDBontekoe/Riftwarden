// First load: this shell and the styles (the boot splash in index.html is already on screen). Everything else (the
// engine, the simulation, the React app) is one lazily loaded chunk that starts downloading right away.
import './ui/app.css';
import { initPwa } from './pwa';
import { initDesktopUpdates, isDesktop } from './desktop/update';
import { invoke } from '@tauri-apps/api/core';

// Installable app + offline play: production builds cache the app (apps/client/sw-plugin.ts). Not under automation (?test).
initPwa({ register: import.meta.env.PROD && !('__TAURI_INTERNALS__' in window) && !new URLSearchParams(location.search).has('test') });

initDesktopUpdates();

function fatal(err: unknown): void {
  console.error(err);
  const el = document.getElementById('ui');
  const msg = String((err as Error)?.message ?? err).replace(/[<>&]/g, '');
  if (el) el.innerHTML = `<div class="fatal">Riftwarden failed to start: ${msg}<br/>A browser with WebGL2 is required.</div>`;
}

async function start(): Promise<void> {
  if (isDesktop()) {
    const settings = await invoke<{ base: string; native_mouse: boolean }>('desktop_settings');
    const desktop = globalThis as typeof globalThis & { __riftDesktopApi?: string; __riftNativeMouse?: boolean };
    desktop.__riftDesktopApi = settings.base;
    desktop.__riftNativeMouse = settings.native_mouse;
  }
  const { boot } = await import('./boot');
  await boot();
}
void start().catch(fatal);
