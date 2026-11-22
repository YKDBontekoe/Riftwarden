// The gateway session socket (proto/riftwarden/v1/session.proto): calls with ids, pushed profile-change
// notices, reconnect with backoff. `sync` sends the profile's pending log and rebases the local copy on the
// server's answer (architecture v2 section 7).
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { SessionClientFrameSchema, type SessionResponse, SessionServerFrameSchema, type SyncResult } from '@riftwarden/protocol/gen/riftwarden/v1/session_pb';
import { fromDoc, toDoc } from '@riftwarden/protocol/value';
import type { Profile } from '../progression/Profile';
import { Store } from '../ui/store';

export interface SyncStatus {
  state: 'offline' | 'connecting' | 'idle' | 'syncing' | 'error';
  rev: number;
  pending: number;
  /** Entries the server refused in the last sync (reason per entry). */
  rejected: { seq: number; reason: string }[];
  claimed: boolean;
  error: string;
}

/** Co-op frames tunnelled on the session socket (NetClient speaks the co-op protocol over it). */
export interface CoopTunnel {
  readonly connected: boolean;
  send(frame: Uint8Array): boolean;
  /** Frames, socket open and close; returns the unsubscribe function. */
  listen(h: TunnelListener): () => void;
}

export interface TunnelListener {
  frame(bytes: Uint8Array): void;
  open(): void;
  close(): void;
}

export class SessionClient implements CoopTunnel {
  readonly status = new Store<SyncStatus>({ state: 'offline', rev: 0, pending: 0, rejected: [], claimed: false, error: '' });
  private ws: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, (r: SessionResponse) => void>();
  private retry = 0;
  private closed = false;
  private syncing: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners = new Set<TunnelListener>();

  /** Off until the owner has set the profile up for this account (a guest upload must come first). */
  autoSync = false;

  constructor(private url: string, private profile: Profile) {}

  open(): void {
    this.closed = false;
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.ws?.close();
    this.ws = null;
    this.status.set({ state: 'offline' });
  }

  private connect(): void {
    if (this.closed) return;
    this.status.set({ state: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.scheduleReconnect();
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.status.set({ state: 'idle', error: '' });
      void this.sync();
      for (const l of [...this.listeners]) l.open();
    };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      let f;
      try {
        f = fromBinary(SessionServerFrameSchema, new Uint8Array(ev.data));
      } catch {
        return;
      }
      if (f.msg.case === 'response') {
        const done = this.waiting.get(f.msg.value.id);
        this.waiting.delete(f.msg.value.id);
        done?.(f.msg.value);
      } else if (f.msg.case === 'changed') {
        // Another device changed the profile: pull the new copy.
        if (BigInt(this.status.get().rev) < f.msg.value.rev) void this.sync();
      } else if (f.msg.case === 'coop') {
        for (const l of [...this.listeners]) l.frame(f.msg.value);
      } else if (f.msg.case === 'error') {
        this.status.set({ error: f.msg.value.msg });
      }
    };
    ws.onclose = () => {
      this.ws = null;
      for (const [, done] of this.waiting) done({ id: 0, error: { code: 'offline', msg: 'Connection lost' } } as SessionResponse);
      this.waiting.clear();
      this.status.set({ state: 'offline' });
      for (const l of [...this.listeners]) l.close();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  send(frame: Uint8Array): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(toBinary(SessionClientFrameSchema, create(SessionClientFrameSchema, { call: { case: 'coop', value: frame } })));
    return true;
  }

  listen(h: TunnelListener): () => void {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  private call(init: Parameters<typeof create<typeof SessionClientFrameSchema>>[1], timeoutMs = 30_000): Promise<SessionResponse> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('offline'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.waiting.set(id, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      ws.send(toBinary(SessionClientFrameSchema, create(SessionClientFrameSchema, { ...init, id })));
    });
  }

  /** Raw sync call (pending entries of `device`, optionally a guest genesis to adopt). */
  async syncCall(device: string, entries: { seq: number; at: number; body: unknown }[], genesis?: unknown): Promise<SyncResult> {
    const r = await this.call({
      call: {
        case: 'sync',
        value: { device, entries: entries.map((e) => ({ seq: BigInt(e.seq), at: e.at, body: toDoc(e.body) })), genesis: genesis === undefined ? undefined : toDoc(genesis) },
      },
    });
    if (r.error) throw new Error(r.error.msg || r.error.code);
    if (r.result.case !== 'sync') throw new Error('unexpected answer');
    return r.result.value;
  }

  /** Send the profile's pending entries and adopt the server's copy (coalesces concurrent requests). */
  sync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.again = false;
        if (!this.autoSync || !this.connected) break;
        const j = this.profile.journal;
        const pending = j.pending.slice();
        const upTo = pending.reduce((m, e) => Math.max(m, e.seq), 0);
        this.status.set({ state: 'syncing', pending: pending.length });
        try {
          const r = await this.syncCall(
            j.state.device,
            pending.map((e) => ({ seq: e.seq, at: e.at, body: { op: e.op, run: e.run } })),
          );
          this.profile.adoptServer(fromDoc(r.doc), Number(r.rev), upTo, r.results.map((x) => ({ seq: Number(x.seq), ok: x.ok, reason: x.reason })));
          this.status.set({
            state: 'idle',
            rev: Number(r.rev),
            pending: this.profile.journal.pending.length,
            rejected: this.profile.journal.lastRejected.map((x) => ({ seq: x.seq, reason: x.reason ?? 'rejected' })),
            error: '',
          });
        } catch (e) {
          this.status.set({ state: this.connected ? 'error' : 'offline', error: (e as Error).message });
          break;
        }
      } while (this.again);
    })().finally(() => (this.syncing = null));
    return this.syncing;
  }

  /** Debounced sync after local changes. */
  nudge(): void {
    this.status.set({ pending: this.profile.journal.pending.length });
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => void this.sync(), 250);
  }
}
