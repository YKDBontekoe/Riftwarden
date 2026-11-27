// Where the gateway (accounts, profiles, war) lives: `?api=<origin>` > VITE_API_URL (production build) >
// the page's own origin (Vite proxies /auth, /session and /war to the gateway in development).
export function apiBase(): string {
  const desktop = (globalThis as typeof globalThis & { __riftDesktopApi?: string }).__riftDesktopApi;
  if (desktop) return desktop;
  const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('api') : null;
  if (param) return param.replace(/\/$/, '');
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
  return env ? env.replace(/\/$/, '') : '';
}
