import { Store } from '../ui/store';
import { newWar, sanitizeWar, secureNode, type SecureResult, tickWar, type WarState } from '@riftwarden/rules/war/state';

const LOCAL_KEY = 'riftwarden.war.local';
const SEEN_KEY = 'riftwarden.war.seen';

export interface WarView {
  war: WarState | null;
  /** 'server' = the shared war; 'local' = an offline copy that does not count. */
  source: 'server' | 'local';
  online: number;
  fetchedAt: number;
  /** Time of the newest war log entry the player has seen (reactions show what is newer). */
  seenAt: number;
}

/** HTTP base of the war server: `?server=host:port` or the page's own origin (Vite proxies /war in dev). */
export function defaultWarBase(): string {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('server') : null;
  if (q) return q.startsWith('ws') ? q.replace(/^ws/, 'http').replace(/\/ws$/, '') : `http://${q}`;
  return '';
}

/**
 * The client side of the shared Rift War: fetches GET /war, reports secured sectors (POST /war/report) and falls
 * back to a local war (localStorage, advanced with the same rules) when the server cannot be reached, so the game
 * always has a map. Local progress never counts toward the shared war.
 */
export class WarClient {
  readonly store = new Store<WarView>({ war: null, source: 'local', online: 0, fetchedAt: 0, seenAt: readSeen() });
  /** Null = local only (automation, offline builds). */
  base: string | null = defaultWarBase();
  /** Rate-limit identity sent with reports (the local profile id). */
  reporter = '';
  /** Seed of the local war (stable per browser profile). */
  localSeed = 1;

  get state(): WarState | null {
    return this.store.get().war;
  }

  get source(): 'server' | 'local' {
    return this.store.get().source;
  }

  /** Fetch the shared war (3 s timeout); fall back to the local copy. */
  async refresh(): Promise<WarState> {
    if (this.base !== null && typeof fetch === 'function') {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        const res = await fetch(`${this.base}/war`, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (res.ok) {
          const body = (await res.json()) as { war?: unknown; online?: number };
          const war = sanitizeWar(body.war);
          if (war) {
            this.store.set({ war, source: 'server', online: typeof body.online === 'number' ? body.online : 0, fetchedAt: Date.now() });
            return war;
          }
        }
      } catch {
        /* offline: local war */
      }
    }
    return this.local();
  }

  /** The local war (created on first use, advanced to now). */
  local(now = Date.now()): WarState {
    let war: WarState | null = null;
    try {
      war = sanitizeWar(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'));
    } catch {
      war = null;
    }
    if (!war) war = newWar(this.localSeed, now);
    tickWar(war, now, 1);
    this.saveLocal(war);
    this.store.set({ war, source: 'local', online: 0, fetchedAt: now });
    return war;
  }

  private saveLocal(war: WarState): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(war));
    } catch {
      /* storage blocked: the local war lives for the session */
    }
  }

  /** A sector was secured: the shared war (server) or the local copy. */
  async report(node: string, mode: 'defense' | 'survival'): Promise<SecureResult> {
    if (this.source === 'server' && this.base !== null) {
      try {
        const res = await fetch(`${this.base}/war/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ node, mode, id: this.reporter }) });
        const r = (await res.json()) as SecureResult;
        void this.refresh();
        return r;
      } catch {
        return { ok: false, reason: 'War server unreachable', gain: 0, lib: 0, messages: [] };
      }
    }
    const war = this.state ?? this.local();
    const r = secureNode(war, { node, mode, players: 1 }, Date.now());
    this.saveLocal(war);
    this.store.set({ war: { ...war } });
    return r;
  }

  /** The player looked at the war: reactions only replay what is newer. */
  markSeen(): void {
    const t = this.state?.log[0]?.t ?? 0;
    this.store.set({ seenAt: t });
    try {
      localStorage.setItem(SEEN_KEY, String(t));
    } catch {
      /* ignore */
    }
  }
}

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
