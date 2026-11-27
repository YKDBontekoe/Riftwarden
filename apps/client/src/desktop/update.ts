import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export const isDesktop = (): boolean => '__TAURI_INTERNALS__' in window;

type Status = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
let status: Status = 'idle';
let pending: Update | null = null;
let dismissed = false;
const listeners = new Set<() => void>();

function set(next: Status): void {
  status = next;
  for (const listener of listeners) listener();
}

export const desktopUpdate = {
  get: (): Status => dismissed && status === 'ready' ? 'idle' : status,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  dismiss(): void {
    dismissed = true;
    set(status);
  },
  async install(): Promise<void> {
    if (!pending || status !== 'ready') return;
    try {
      await pending.install();
      await relaunch();
    } catch {
      set('error');
    }
  },
};

async function checkUpdate(): Promise<void> {
  if (status === 'checking' || status === 'downloading' || status === 'ready') return;
  set('checking');
  try {
    const update = await check();
    if (!update) return set('idle');
    pending = update;
    set('downloading');
    await update.download();
    dismissed = false;
    set('ready');
  } catch {
    pending = null;
    set('error');
  }
}

export function initDesktopUpdates(): void {
  if (!isDesktop()) return;
  void checkUpdate();
  window.setInterval(() => void checkUpdate(), 30 * 60 * 1000);
}
