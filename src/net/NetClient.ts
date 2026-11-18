import { Store } from '../ui/store';
import { type ActMsg, type LobbyState, PROTOCOL_VERSION, type RunStart, type ServerMsg } from './protocol';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface NetState {
  status: NetStatus;
  error: string;
  playerId: string;
  name: string;
  /** Server has an online profile for this identity. */
  hasProfile: boolean | null;
  lobby: LobbyState | null;
  rtt: number;
  /** Host HQ layout while visiting (owner id + base data). */
  hostHq: { owner: string; base: unknown } | null;
  presence: { id: string; name: string; p: [number, number, number]; yaw: number }[];
}

const IDENTITY_KEY = 'riftwarden.identity';

/** Guest identity: a random secret kept in this browser. The server only ever stores its hash. */
export function loadIdentity(): { secret: string; name: string } {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { secret?: unknown; name?: unknown };
      if (typeof v.secret === 'string' && v.secret.length >= 32) return { secret: v.secret, name: typeof v.name === 'string' ? v.name : 'Warden' };
    }
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const id = { secret: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), name: `Warden-${Math.floor(100 + Math.random() * 900)}` };
  saveIdentity(id);
  return id;
}

export function saveIdentity(id: { secret: string; name: string }): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* private mode: identity lasts for the session */
  }
}

/** Same-origin `/ws` (the Vite dev server proxies it to the co-op server). `?server=host:port` overrides. */
export function defaultServerUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.startsWith('ws') ? q : `ws://${q}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export interface NetHandlers {
  welcome?(m: Extract<ServerMsg, { t: 'welcome' }>): void;
  profile?(save: unknown): void;
  opResult?(m: Extract<ServerMsg, { t: 'opResult' }>): void;
  runStart?(run: RunStart): void;
  snap?(s: Record<string, unknown>): void;
  events?(e: unknown[][]): void;
  runEnd?(result: unknown, save: unknown): void;
  lost?(): void;
  hostHq?(): void;
  error?(code: string, msg: string): void;
}

/**
 * WebSocket session with the co-op server: identity, reconnection with backoff (the server keeps
 * a disconnected player's run slot for RECONNECT_WINDOW), action requests with replies, RTT.
 */
export class NetClient {
  readonly store = new Store<NetState>({ status: 'offline', error: '', playerId: '', name: '', hasProfile: null, lobby: null, rtt: 0, hostHq: null, presence: [] });
  private ws: WebSocket | null = null;
  private wantOpen = false;
  private retry = 0;
  private actSeq = 1;
  private pending = new Map<number, (r: { ok: boolean; reason?: string }) => void>();
  private pingT: ReturnType<typeof setInterval> | null = null;
  handlers: NetHandlers = {};
  rtt = 0;
  bytesIn = 0;

  constructor(
    public url = defaultServerUrl(),
    private identity = loadIdentity(),
  ) {}

  get state(): NetState {
    return this.store.get();
  }

  get name(): string {
    return this.identity.name;
  }

  setName(name: string): void {
    this.identity.name = name.slice(0, 18) || this.identity.name;
    saveIdentity(this.identity);
  }

  connect(): Promise<boolean> {
    this.wantOpen = true;
    return this.open();
  }

  private open(): Promise<boolean> {
    return new Promise((resolve) => {
      this.store.set({ status: this.retry ? 'reconnecting' : 'connecting', error: '' });
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.store.set({ status: 'error', error: `Cannot reach ${this.url}: ${(e as Error).message}` });
        return resolve(false);
      }
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, secret: this.identity.secret, name: this.identity.name }));
      ws.onmessage = (ev) => {
        this.bytesIn += (ev.data as string).length;
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data as string) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          welcomed = true;
          this.retry = 0;
          this.store.set({ status: 'online', playerId: m.playerId, name: m.name, hasProfile: m.hasProfile, error: '' });
          this.handlers.welcome?.(m);
          resolve(true);
        }
        this.dispatch(m);
      };
      ws.onerror = () => {
        if (!welcomed) this.store.set({ status: 'error', error: `Co-op server unreachable (${this.url})` });
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.pingT) clearInterval(this.pingT);
        this.pingT = null;
        for (const r of this.pending.values()) r({ ok: false, reason: 'Connection lost' });
        this.pending.clear();
        if (!welcomed) {
          resolve(false);
          if (this.wantOpen && this.retry > 0 && this.retry < 12) this.scheduleRetry();
          return;
        }
        if (this.wantOpen) {
          this.handlers.lost?.();
          this.scheduleRetry();
        } else this.store.set({ status: 'offline' });
      };
      this.pingT = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    });
  }

  private scheduleRetry(): void {
    this.retry++;
    this.store.set({ status: 'reconnecting', error: 'Connection lost · reconnecting…' });
    setTimeout(() => {
      if (this.wantOpen && !this.ws) void this.open();
    }, Math.min(8000, 500 * 2 ** Math.min(4, this.retry)));
  }

  private dispatch(m: ServerMsg): void {
    switch (m.t) {
      case 'error':
        this.store.set({ error: m.msg, ...(m.code === 'version' ? { status: 'error' as const } : {}) });
        if (m.code === 'version' || m.code === 'replaced') this.wantOpen = false;
        this.handlers.error?.(m.code, m.msg);
        return;
      case 'lobby':
        this.store.set({ lobby: m.lobby });
        return;
      case 'profile':
        this.store.set({ hasProfile: true });
        this.handlers.profile?.(m.save);
        return;
      case 'opResult':
        this.handlers.opResult?.(m);
        return;
      case 'presence':
        this.store.set({ presence: m.players });
        return;
      case 'hostHq':
        this.store.set({ hostHq: { owner: m.owner, base: m.base } });
        this.handlers.hostHq?.();
        return;
      case 'runStart':
        this.handlers.runStart?.(m.run);
        return;
      case 'snap':
        this.handlers.snap?.(m.s as Record<string, unknown>);
        return;
      case 'ev':
        this.handlers.events?.(m.e as unknown[][]);
        return;
      case 'actResult': {
        if (typeof m.id !== 'number') return;
        const r = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (typeof r === 'function') r({ ok: m.ok === true, reason: typeof m.reason === 'string' ? m.reason : undefined });
        return;
      }
      case 'runEnd':
        this.handlers.runEnd?.(m.result, m.save);
        return;
      case 'pong':
        this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - m.c) * 0.3 : performance.now() - m.c;
        this.store.set({ rtt: Math.round(this.rtt) });
        return;
    }
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  act(a: ActMsg): Promise<{ ok: boolean; reason?: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, reason: 'Not connected' });
    const id = this.actSeq++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ t: 'act', id, ...a });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve({ ok: false, reason: 'No answer from the server' });
      }, 8000);
    });
  }

  close(): void {
    this.wantOpen = false;
    this.ws?.close();
    this.ws = null;
    this.store.set({ status: 'offline', lobby: null, hostHq: null, presence: [] });
  }
}
