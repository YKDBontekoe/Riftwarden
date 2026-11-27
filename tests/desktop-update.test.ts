import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const check = vi.fn();
const relaunch = vi.fn();
vi.mock('../apps/client/node_modules/@tauri-apps/plugin-updater/dist-js/index.js', () => ({ check }));
vi.mock('../apps/client/node_modules/@tauri-apps/plugin-process/dist-js/index.js', () => ({ relaunch }));

async function settle(): Promise<void> {
  await vi.waitFor(() => expect(check).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('desktop updates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, setInterval: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('downloads an update and waits for the player to restart', async () => {
    const download = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({ download, install });
    const { desktopUpdate, initDesktopUpdates } = await import('../apps/client/src/desktop/update');
    initDesktopUpdates();
    await settle();
    expect(download).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(desktopUpdate.get()).toBe('ready');
    await desktopUpdate.install();
    expect(install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('keeps the current build usable when the download fails', async () => {
    const install = vi.fn();
    check.mockResolvedValue({ download: vi.fn().mockRejectedValue(new Error('offline')), install });
    const { desktopUpdate, initDesktopUpdates } = await import('../apps/client/src/desktop/update');
    initDesktopUpdates();
    await settle();
    expect(desktopUpdate.get()).toBe('error');
    await desktopUpdate.install();
    expect(install).not.toHaveBeenCalled();
  });
});
