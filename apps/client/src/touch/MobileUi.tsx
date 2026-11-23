// Mobile / installed-app chrome: rotate-to-landscape hint, update toast, install button.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isPortrait } from '@riftwarden/game/core/touch';
import { applyUpdate, dismissUpdate, promptInstall, pwaStore } from '../pwa';
import type { Flow } from '../core/Flow';
import { useHud } from '../ui/useHud';
import { enterImmersive, touchStore } from './touchMode';

function usePortrait(): boolean {
  const read = () => isPortrait(window.innerWidth, window.innerHeight);
  const [p, setP] = useState(read);
  useEffect(() => {
    const on = () => setP(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return p;
}

/** Touch screens in portrait: the game wants landscape. Dismissable for the session. */
export function RotateHint() {
  const touch = useSyncExternalStore(touchStore.subscribe, touchStore.get);
  const portrait = usePortrait();
  const screen = useHud((s) => s.screen);
  const [dismissed, setDismissed] = useState(false);
  if (!touch || !portrait || dismissed || screen === 'loading') return null;
  return (
    <div className="rotate-hint" data-testid="rotate-hint" role="dialog" aria-label="Rotate your device">
      <div className="phone" aria-hidden="true" />
      <b>ROTATE TO LANDSCAPE</b>
      <span>Riftwarden plays sideways: the stick sits under your left thumb, aim and fire under your right.</span>
      <button className="primary" onClick={() => enterImmersive()}>FULLSCREEN</button>
      <button className="mini" onClick={() => setDismissed(true)}>CONTINUE IN PORTRAIT</button>
    </div>
  );
}

/** A new build is waiting: reload when convenient (never automatically during an operation). */
export function UpdateToast({ flow }: { flow: Flow | null }) {
  const pwa = useSyncExternalStore(pwaStore.subscribe, pwaStore.get);
  const location = useHud((s) => s.location);
  if (!pwa.update) return null;
  const inRun = location === 'arena' || !!flow?.run;
  return (
    <div className="pwa-toast" role="status" data-testid="pwa-update">
      <span className="pwa-text">
        <b>Update available.</b> {inRun ? 'Reloading now ends the running operation (unsecured cargo is lost): finish or extract first.' : 'Reload to apply it.'}
      </span>
      <button className="primary" data-testid="pwa-reload" onClick={applyUpdate}>RELOAD</button>
      <button className="mini" onClick={dismissUpdate}>LATER</button>
    </div>
  );
}

/** Settings / menu entry: install the app (browser dialog, or iOS instructions). */
export function InstallApp() {
  const pwa = useSyncExternalStore(pwaStore.subscribe, pwaStore.get);
  const [ios, setIos] = useState(false);
  if (pwa.installed) return <div className="text-[13px] text-faint" data-testid="pwa-installed">Running as an installed app.</div>;
  if (!pwa.canInstall && !pwa.iosHint) return null;
  return (
    <div className="grid gap-[6px]" data-testid="pwa-install">
      <button className="mini" onClick={() => (pwa.canInstall ? void promptInstall() : setIos(true))}>
        INSTALL APP
      </button>
      {ios && (
        <div className="text-[13px] leading-[1.4] text-muted">
          In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. The installed app opens fullscreen and plays offline.
        </div>
      )}
    </div>
  );
}
