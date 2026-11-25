import { Store } from '../ui/store';
import type { CoopTunnel } from './SessionClient';
import { decodeServer, encodeClient } from '@riftwarden/protocol/codec';
import { type ActMsg, type ClientMsg, type LobbyState, PROTOCOL_VERSION, type RunStart, type ServerMsg, type TradeView } from '@riftwarden/protocol/protocol';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface NetState {
  status: NetStatus;
  error: string;
  playerId: string;
  name: string;
  lobby: LobbyState | null;
  /** Trade window with another lobby member (null = not trading). */
  trade: TradeView | null;
  rtt: number;
  /** Host HQ layout while visiting (owner id + base data). */
  hostHq: { owner: string; base: unknown } | null;
  presence: { id: string; name: string; p: [number, number, number]; yaw: number }[];
}

export interface NetHandlers {
  welcome?(m: Extract<ServerMsg, { t: 'welcome' }>): void;
  runStart?(run: RunStart): void;
  snap?(s: Record<string, unknown>): void;
  events?(e: unknown[][]): void;
  runEnd?(result: unknown): void;
  lost?(): void;
  hostHq?(): void;
  error?(code: string, msg: string): void;
}

/**
 * Co-op session over the account's session socket (the gateway routes the frames to the sim worker holding the
 * player's room). The player is their account; when the socket drops and comes back the client says hello
 * again and the worker puts it back into its room (and running operation) within the reconnect window.
 */
export class NetClient {
  readonly store = new Store<NetState>({ status: 'offline', error: '', playerId: '', name: '', lobby: null, trade: null, rtt: 0, hostHq: null, presence: [] });
  private wantOpen = false;
  private welcomed = false;
  private actSeq = 1;
  private pending = new Map<number, (r: { ok: boolean; reason?: string }) => void>();
  private pingT: ReturnType<typeof setInterval> | null = null;
  private unlisten: (() => void) | null = null;
  private hello: ((ok: boolean) => void) | null = null;
  handlers: NetHandlers = {};
  rtt = 0;
  bytesIn = 0;

  constructor(readonly tunnel: CoopTunnel) {}

  get state(): NetState {
    return this.store.get();
  }

  get name(): string {
    return this.store.get().name;
  }

  /** Say hello through the session socket; resolves once the sim worker welcomes the player. */
  connect(): Promise<boolean> {
    this.wantOpen = true;
    this.unlisten ??= this.tunnel.listen({
      frame: (b) => this.onFrame(b),
      open: () => {
        if (this.wantOpen) this.sayHello();
      },
      close: () => this.onClose(),
    });
    this.pingT ??= setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    return new Promise((resolve) => {
      this.hello?.(false);
      this.hello = resolve;
      this.store.set({ status: 'connecting', error: '' });
      if (this.tunnel.connected) this.sayHello();
      setTimeout(() => {
        if (this.hello !== resolve) return;
        this.hello = null;
        if (!this.welcomed) this.store.set({ status: 'error', error: 'Co-op server unreachable' });
        resolve(this.welcomed);
      }, 10_000);
    });
  }

  private sayHello(): void {
    this.tunnel.send(encodeClient({ t: 'hello', v: PROTOCOL_VERSION }));
  }

  private onFrame(bytes: Uint8Array): void {
    this.bytesIn += bytes.byteLength;
    const m = decodeServer(bytes);
    if (!m) return;
    if (m.t === 'welcome') {
      this.welcomed = true;
      this.store.set({ status: 'online', playerId: m.playerId, name: m.name, error: '' });
      this.handlers.welcome?.(m);
      this.hello?.(true);
      this.hello = null;
    }
    this.dispatch(m);
  }

  private onClose(): void {
    for (const r of this.pending.values()) r({ ok: false, reason: 'Connection lost' });
    this.pending.clear();
    if (!this.wantOpen) return;
    if (this.welcomed) this.handlers.lost?.();
    this.store.set({ status: 'reconnecting', error: 'Connection lost · reconnecting…' });
  }

  private dispatch(m: ServerMsg): void {
    switch (m.t) {
      case 'error':
        this.store.set({ error: m.msg, ...(m.code === 'version' ? { status: 'error' as const } : {}) });
        if (m.code === 'version' || m.code === 'replaced') {
          this.wantOpen = false;
          this.welcomed = false;
          this.store.set({ status: 'error' });
        }
        if (!this.welcomed && this.hello && m.code !== 'malformed') {
          this.store.set({ status: 'error' });
          this.hello(false);
          this.hello = null;
        }
        this.handlers.error?.(m.code, m.msg);
        return;
      case 'lobby':
        this.store.set({ lobby: m.lobby, ...(m.lobby ? {} : { trade: null }) });
        return;
      case 'trade':
        this.store.set({ trade: m.trade });
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
        this.handlers.runEnd?.(m.result);
        return;
      case 'pong':
        this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - m.c) * 0.3 : performance.now() - m.c;
        this.store.set({ rtt: Math.round(this.rtt) });
        return;
    }
  }

  send(msg: ClientMsg): void {
    if (this.welcomed || msg.t === 'hello') this.tunnel.send(encodeClient(msg));
  }

  act(a: ActMsg): Promise<{ ok: boolean; reason?: string }> {
    if (!this.tunnel.connected || !this.welcomed) return Promise.resolve({ ok: false, reason: 'Not connected' });
    const id = this.actSeq++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ t: 'act', id, ...a });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve({ ok: false, reason: 'No answer from the server' });
      }, 8000);
    });
  }

  /** Leave co-op (the account's session socket stays open for sync). */
  close(): void {
    if (this.welcomed && this.store.get().lobby) this.send({ t: 'leave' });
    this.wantOpen = false;
    this.welcomed = false;
    this.unlisten?.();
    this.unlisten = null;
    if (this.pingT) clearInterval(this.pingT);
    this.pingT = null;
    this.store.set({ status: 'offline', lobby: null, trade: null, hostHq: null, presence: [] });
  }
}
