// Progressive web app glue (loaded by the shell, before the game chunk, so the install event is never missed):
// service worker registration with a user-confirmed update, and the install prompt.

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** A newer build is installed and waiting: reload to apply. */
  update: boolean;
  /** The browser offered installation (Android / desktop Chromium). */
  canInstall: boolean;
  /** iOS Safari: installation goes through Share > Add to Home Screen. */
  iosHint: boolean;
  /** Running as an installed app. */
  installed: boolean;
}

const subs = new Set<() => void>();
let state: PwaState = { update: false, canInstall: false, iosHint: false, installed: false };
let deferred: InstallEvent | null = null;
let waiting: ServiceWorker | null = null;

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  for (const fn of subs) fn();
}

export const pwaStore = {
  get: (): PwaState => state,
  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

const standalone = (): boolean =>
  (typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone / iPad Safari (iPadOS reports a Mac with touch). */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function initPwa(opts: { register: boolean }): void {
  set({ installed: standalone(), iosHint: !standalone() && isIos() });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ canInstall: false, installed: true, iosHint: false });
  });
  if (!opts.register || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          const check = () => {
            // An installed worker while another controls the page = an update (the first install has no controller).
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              waiting = w;
              set({ update: true });
            }
          };
          check();
          w.addEventListener('statechange', check);
        };
        track(reg.waiting);
        reg.addEventListener('updatefound', () => track(reg.installing));
        // Long sessions: look for a new build every 30 minutes.
        setInterval(() => void reg.update().catch(() => {}), 30 * 60 * 1000);
      })
      .catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waiting) return;
      reloading = true;
      location.reload();
    });
  });
}

/** Activate the waiting build (the page reloads when it takes control). */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage({ type: 'skip-waiting' });
  else location.reload();
}

export function dismissUpdate(): void {
  set({ update: false });
}

/** Show the browser's install dialog (only after beforeinstallprompt). */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  set({ canInstall: false });
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  return choice.outcome === 'accepted';
}

/** Test hook: pretend a new build is waiting / installation is offered. */
export function simulatePwa(patch: Partial<PwaState>): void {
  set(patch);
}
