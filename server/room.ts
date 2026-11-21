import { CODE_ALPHABET, type LobbyState, MAX_PLAYERS, RECONNECT_WINDOW, type ServerMsg } from '../src/net/protocol';
import { equippedItem, deployBlocker } from '../src/progression/save';
import { THREAT_TIERS } from '../src/progression/tiers';
import type { OnlineProfile, ProfileStore } from './profiles';
import type { CoopSim } from './sim';

export interface Peer {
  id: string;
  name: string;
  send(msg: ServerMsg): void;
  profile: OnlineProfile | null;
  room: Room | null;
  /** Lobby HQ presence (for host-HQ visits). */
  presence: { p: [number, number, number]; yaw: number } | null;
  visiting: boolean;
}

export interface Member {
  id: string;
  name: string;
  peer: Peer | null;
  ready: boolean;
  joinedAt: number;
  disconnectedAt: number;
}

export interface RoomDeps {
  store: ProfileStore;
  log(msg: string): void;
  createSim(room: Room): Promise<CoopSim>;
}

let roomCounter = 0;

/**
 * A private co-op session: lobby (2-4 players, host, tier, ready states) and, once deployed,
 * one authoritative survival run (CoopSim). The lobby host is only a role: if they leave, the
 * longest-present remaining player becomes host and the session (and any run) continues.
 */
export class Room {
  readonly members = new Map<string, Member>();
  hostId: string;
  tier = 1;
  mode: 'defense' | 'survival' = 'defense';
  /** Rift War node the host picked for the deployment (null = the front's landing). */
  node: string | null = null;
  state: LobbyState['state'] = 'lobby';
  sim: CoopSim | null = null;
  readonly serial = ++roomCounter;

  constructor(
    readonly code: string,
    host: Peer,
    tier: number,
    private deps: RoomDeps,
  ) {
    this.hostId = host.id;
    this.add(host);
    this.tier = this.clampTier(tier);
  }

  static newCode(taken: (c: string) => boolean): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!taken(c)) return c;
    }
  }

  /** Highest tier every member has unlocked (the team plays a tier all of them may play). */
  get maxTier(): number {
    let m = THREAT_TIERS.length;
    for (const mem of this.members.values()) {
      const p = this.deps.store.get(mem.id);
      if (p) m = Math.min(m, p.data.threat.unlocked);
    }
    return Math.max(1, m);
  }

  clampTier(t: number): number {
    return Math.max(1, Math.min(this.maxTier, Math.floor(t)));
  }

  get connected(): Member[] {
    return [...this.members.values()].filter((m) => m.peer);
  }

  /** Add (or re-attach) a player. Returns a reason when refused. */
  add(peer: Peer): string | null {
    const existing = this.members.get(peer.id);
    if (existing) {
      existing.peer = peer;
      existing.name = peer.name;
      existing.disconnectedAt = 0;
      peer.room = this;
      return null;
    }
    if (this.state !== 'lobby') return 'This operation is already under way';
    if (this.members.size >= MAX_PLAYERS) return `Session is full (${MAX_PLAYERS} players)`;
    this.members.set(peer.id, { id: peer.id, name: peer.name, peer, ready: false, joinedAt: Date.now(), disconnectedAt: 0 });
    peer.room = this;
    this.tier = this.clampTier(this.tier);
    return null;
  }

  /** A player left on purpose (lobby: removed; run: their run ends with only secured rewards). */
  leave(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (m.peer) m.peer.room = null;
    if (this.sim) this.sim.playerLeft(id, 'left');
    this.members.delete(id);
    this.afterChange();
  }

  /** Connection lost: keep the slot for RECONNECT_WINDOW seconds. */
  disconnected(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    m.peer = null;
    m.disconnectedAt = Date.now();
    m.ready = false;
    if (this.state === 'lobby') this.members.delete(id);
    this.sim?.playerDisconnected(id);
    this.afterChange();
  }

  private afterChange(): void {
    if (!this.members.has(this.hostId) || !this.members.get(this.hostId)!.peer) {
      const next = this.connected.sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        this.hostId = next.id;
        this.deps.log(`room ${this.code}: host -> ${next.name}`);
      }
    }
    this.tier = this.clampTier(this.tier);
    this.broadcastLobby();
  }

  /** Periodic housekeeping: expire reconnect windows. */
  tick(now = Date.now()): void {
    for (const m of [...this.members.values()]) {
      if (!m.peer && m.disconnectedAt && now - m.disconnectedAt > RECONNECT_WINDOW * 1000) {
        this.deps.log(`room ${this.code}: ${m.name} did not reconnect`);
        this.sim?.playerLeft(m.id, 'timeout');
        this.members.delete(m.id);
        this.afterChange();
      }
    }
  }

  get empty(): boolean {
    return this.state === 'lobby' && this.connected.length === 0;
  }

  setReady(id: string, ready: boolean): void {
    const m = this.members.get(id);
    if (!m || this.state !== 'lobby') return;
    m.ready = ready;
    this.broadcastLobby();
  }

  setTier(id: string, tier: number): string | null {
    if (id !== this.hostId) return 'Only the host selects the threat tier';
    if (this.state !== 'lobby') return 'Operation already started';
    const t = this.clampTier(tier);
    if (t !== tier) return 'Every player must have unlocked that tier';
    this.tier = t;
    for (const m of this.members.values()) m.ready = m.id === this.hostId ? m.ready : false;
    this.broadcastLobby();
    return null;
  }

  setMode(id: string, mode: 'defense' | 'survival'): string | null {
    if (id !== this.hostId) return 'Only the host selects the game mode';
    if (this.state !== 'lobby') return 'Operation already started';
    this.mode = mode;
    for (const m of this.members.values()) m.ready = m.id === this.hostId ? m.ready : false;
    this.broadcastLobby();
    return null;
  }

  setNode(id: string, node: string | null): string | null {
    if (id !== this.hostId) return 'Only the host picks the deployment sector';
    if (this.state !== 'lobby') return 'Operation already started';
    this.node = node && /^r\d{1,5}n\d{1,2}$/.test(node) ? node : null;
    this.broadcastLobby();
    return null;
  }

  /** Host starts the operation once everyone connected is ready and can deploy. */
  async start(id: string): Promise<string | null> {
    if (id !== this.hostId) return 'Only the host can deploy the team';
    if (this.state !== 'lobby') return 'Operation already started';
    const conn = this.connected;
    if (conn.length < 1) return 'Nobody to deploy';
    for (const m of conn) {
      if (m.id !== this.hostId && !m.ready) return `${m.name} is not ready`;
      const p = this.deps.store.get(m.id)!;
      const b = deployBlocker(p.data);
      if (b) return `${m.name}: ${b}`;
      if (p.inRun) return `${m.name} is already deployed`;
    }
    this.state = 'deploying';
    this.broadcastLobby();
    try {
      this.sim = await this.deps.createSim(this);
    } catch (e) {
      this.deps.log(`room ${this.code}: sim failed: ${(e as Error).stack}`);
      this.state = 'lobby';
      this.sim = null;
      this.broadcastLobby();
      return 'The server could not start the operation';
    }
    this.state = 'running';
    this.broadcastLobby();
    return null;
  }

  /** The run finished (defeat, extraction or everybody gone): back to the lobby. */
  runEnded(): void {
    this.sim = null;
    this.state = 'lobby';
    for (const m of [...this.members.values()]) {
      m.ready = false;
      if (!m.peer) this.members.delete(m.id);
    }
    this.afterChange();
  }

  lobby(): LobbyState {
    return {
      code: this.code,
      hostId: this.hostId,
      tier: this.tier,
      mode: this.mode,
      node: this.node,
      maxTier: this.maxTier,
      capacity: MAX_PLAYERS,
      state: this.state,
      wave: this.sim?.wave ?? 0,
      players: [...this.members.values()].map((m) => {
        const p = this.deps.store.get(m.id);
        const w = p ? equippedItem(p.data, 'weapon') : null;
        return { id: m.id, name: m.name, ready: m.ready, connected: !!m.peer, host: m.id === this.hostId, weapon: w?.name ?? '—', rarity: w?.rarity ?? 'common', level: w?.level ?? 0 };
      }),
    };
  }

  broadcastLobby(): void {
    const lobby = this.lobby();
    for (const m of this.members.values()) m.peer?.send({ t: 'lobby', lobby });
  }

  broadcast(msg: ServerMsg): void {
    for (const m of this.members.values()) m.peer?.send(msg);
  }
}
