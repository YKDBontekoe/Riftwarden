// The sim role of the worker (architecture v2 step 7): co-op lobbies (Room) and operations (CoopSim) for the
// players the gateway routes here. The gateway authenticates, so a player is their account; their frames arrive
// as SimInput, everything for them leaves as SimOutput. Profiles come from the gateway (SimAttach/SimProfile)
// and change only through run entries streamed back (SimEntries).
import './headless';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { decodeClient, encodeServer } from '@riftwarden/protocol/codec';
import { type SimDown, SimDownSchema, SimUpSchema } from '@riftwarden/protocol/gen/riftwarden/v1/sim_pb';
import { GameMode } from '@riftwarden/protocol/gen/riftwarden/v1/common_pb';
import { type ClientMsg, normalizeCode, parseClientMsg, PROTOCOL_VERSION, RateLimiter, type ServerMsg } from '@riftwarden/protocol/protocol';
import { fromDoc, toDoc } from '@riftwarden/protocol/value';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { openDoc } from '@riftwarden/rules/progression/sync';
import { newWar, sanitizeWar } from '@riftwarden/rules/war/state';
import { CoopSim, loadHavok } from './coopSim';
import { type Peer, Room } from './room';
import { RemoteStore } from './store';
import { RemoteWar } from './war';

type Up = Parameters<typeof create<typeof SimUpSchema>>[1];

interface Player extends Peer {
  limiter: RateLimiter;
  strikes: number;
  attached: boolean;
}

export class SimHost {
  private readonly rooms = new Map<string, Room>();
  private readonly players = new Map<string, Player>();
  private readonly store: RemoteStore;
  private readonly war: RemoteWar;
  private havok: unknown = null;
  private bound = new Map<string, string>();
  draining = false;
  /** Operations this worker runs at most (RIFT_SIM_CAPACITY). */
  private capacity = 6;
  private timers: NodeJS.Timeout[] = [];

  constructor(private send: (up: Uint8Array) => void, private log: (m: string) => void) {
    this.store = new RemoteStore((account, device, entries) => this.up({ msg: { case: 'entries', value: { account, device, entries: entries.map((e) => ({ seq: BigInt(e.seq), at: e.at, body: toDoc({ run: e.run, op: e.op }) })) } } }));
    this.war = new RemoteWar(newWar(1, Date.now()), (rep) => this.up({ msg: { case: 'report', value: { node: rep.node, mode: rep.mode, players: rep.players, trusted: true } } }));
  }

  async start(): Promise<void> {
    this.havok = await loadHavok();
    // Housekeeping: reconnect windows, empty rooms, room directory (1 s); lobby presence (10 Hz).
    this.timers.push(setInterval(() => this.housekeeping(), 1000));
    this.timers.push(setInterval(() => this.presence(), 100));
  }

  private up(init: Up): void {
    this.send(toBinary(SimUpSchema, create(SimUpSchema, init)));
  }

  /** A gateway (re)connected: introduce the worker and tell it which rooms and players live here (a restarted
   * gateway knows nothing, and players reconnecting into a running operation must be routed back here). */
  hello(build: string, capacity: number): void {
    this.capacity = capacity;
    this.up({ msg: { case: 'hello', value: { build, capacity } } });
    this.bound.clear();
    for (const p of this.players.values()) this.syncBinding(p);
    this.reportLoad(true);
  }

  /** One message from the gateway. */
  async onDown(bytes: Uint8Array): Promise<void> {
    let m: SimDown;
    try {
      m = fromBinary(SimDownSchema, bytes);
    } catch {
      return;
    }
    switch (m.msg.case) {
      case 'attach': {
        const a = m.msg.value;
        // A reconnect during an operation keeps the worker's copy (its own entries are what change it then).
        const held = this.store.get(a.account);
        if (!held?.inRun) this.store.put(a.account, openDoc(fromDoc(a.profile)) as SaveData);
        const p = this.players.get(a.account);
        if (p) {
          p.name = a.name;
          p.attached = true;
        } else this.players.set(a.account, this.newPlayer(a.account, a.name));
        return;
      }
      case 'input':
        return this.onInput(m.msg.value.account, m.msg.value.frame);
      case 'detach': {
        const p = this.players.get(m.msg.value);
        if (!p) return;
        p.attached = false;
        if (p.room) p.room.disconnected(p.id);
        return;
      }
      case 'profile': {
        // Changes outside the worker (another device). Ignored while the player is in an operation here:
        // the operation's own entries are what changes the profile then.
        const id = m.msg.value.account;
        const prof = this.store.get(id);
        if (!prof || prof.inRun) return;
        this.store.put(id, openDoc(fromDoc(m.msg.value.profile)) as SaveData);
        // A lobby host changed their HQ: guests visiting it see the new layout live.
        for (const r of this.rooms.values()) {
          if (r.hostId !== id || r.state !== 'lobby') continue;
          const base = this.store.get(id)!.data.base;
          for (const mem of r.connected) if (mem.peer?.visiting && mem.id !== id) mem.peer.send({ t: 'hostHq', owner: id, base });
        }
        return;
      }
      case 'war': {
        const w = sanitizeWar((fromDoc(m.msg.value) as { war?: unknown } | null)?.war ?? fromDoc(m.msg.value));
        if (w) this.war.state = w;
        return;
      }
      case 'drain':
        this.draining = m.msg.value;
        return;
    }
  }

  private newPlayer(id: string, name: string): Player {
    const p: Player = {
      id,
      name,
      profile: null,
      room: null,
      presence: null,
      visiting: false,
      attached: true,
      limiter: new RateLimiter(90, 180),
      strikes: 0,
      send: (msg: ServerMsg) => {
        if (!p.attached) return 0;
        const frame = encodeServer(msg);
        this.up({ msg: { case: 'output', value: { accounts: [id], frame } } });
        return frame.length;
      },
    };
    return p;
  }

  private async onInput(account: string, frame: Uint8Array): Promise<void> {
    const me = this.players.get(account);
    if (!me) return;
    const fail = (code: string, msg: string): void => void me.send({ t: 'error', code, msg });
    if (!me.limiter.take()) return;
    const raw = decodeClient(frame);
    const msg = raw === null ? null : parseClientMsg(raw);
    if (!msg) {
      if (++me.strikes > 50) me.attached = false;
      return fail('malformed', raw === null ? 'Unreadable message' : 'Invalid message');
    }
    try {
      await this.handle(me, msg);
    } catch (e) {
      this.log(`handler error (${msg.t}): ${(e as Error).stack}`);
      fail('server', 'Server error');
    }
    this.syncBinding(me);
  }

  private deps() {
    return { store: this.store, log: this.log, createSim: (room: Room) => CoopSim.create(room, this.store, this.havok, this.log, this.war) };
  }

  private async handle(me: Player, msg: ClientMsg): Promise<void> {
    const fail = (code: string, m: string): void => void me.send({ t: 'error', code, msg: m });
    me.profile = this.store.get(me.id);
    switch (msg.t) {
      case 'ping':
        me.send({ t: 'pong', c: msg.c, s: Date.now() });
        return;
      case 'hello': {
        if (msg.v !== PROTOCOL_VERSION) return fail('version', `Protocol mismatch: server v${PROTOCOL_VERSION}, client v${msg.v}. Reload the page.`);
        me.send({ t: 'welcome', v: PROTOCOL_VERSION, playerId: me.id, name: me.name });
        // Reconnect into a session (and a running operation) this player still belongs to.
        for (const r of this.rooms.values()) {
          if (r.members.has(me.id)) {
            r.add(me);
            r.broadcastLobby();
            r.sim?.playerReconnected(me.id, me);
            break;
          }
        }
        return;
      }
    }
    if (!me.profile) return fail('profile', 'Your profile has not synced yet');
    if (me.room?.state === 'deploying' && (msg.t === 'leave' || msg.t === 'create' || msg.t === 'join')) return fail('deploying', 'Wait for the operation to finish deploying');
    switch (msg.t) {
      case 'create': {
        if (this.draining) return fail('draining', 'This server is restarting: try again in a moment');
        if (me.room) me.room.leave(me.id);
        const code = Room.newCode((c) => this.rooms.has(c));
        const room = new Room(code, me, msg.tier, this.deps());
        this.rooms.set(code, room);
        this.log(`room ${code} created by ${me.name}`);
        this.reportLoad();
        return room.broadcastLobby();
      }
      case 'join': {
        const room = this.rooms.get(normalizeCode(msg.code));
        if (!room) return fail('join', 'No session with that code');
        if (me.room && me.room !== room) me.room.leave(me.id);
        const why = room.add(me);
        if (why) return fail('join', why);
        this.log(`room ${room.code}: ${me.name} joined`);
        return room.broadcastLobby();
      }
      case 'leave':
        if (me.room) {
          me.room.leave(me.id);
          me.room = null;
          me.send({ t: 'lobby', lobby: null });
        }
        return;
      case 'ready':
        return me.room?.setReady(me.id, msg.ready);
      case 'tier': {
        const why = me.room?.setTier(me.id, msg.tier);
        if (why) fail('tier', why);
        return;
      }
      case 'mode': {
        const why = me.room?.setMode(me.id, msg.mode);
        if (why) fail('mode', why);
        return;
      }
      case 'node': {
        const why = me.room?.setNode(me.id, msg.node);
        if (why) fail('node', why);
        return;
      }
      case 'listed': {
        const why = me.room?.setListed(me.id, msg.listed);
        if (why) fail('listed', why);
        this.reportLoad();
        return;
      }
      case 'start': {
        if (!me.room) return fail('start', 'Not in a session');
        if (!me.room.sim && [...this.rooms.values()].filter((r) => r.sim).length >= this.capacity) {
          return fail('full', 'Co-op servers are full right now: try again in a few minutes (solo play is unaffected)');
        }
        const why = await me.room.start(me.id);
        if (why) fail('start', why);
        this.reportLoad();
        return;
      }
      case 'presence':
        me.presence = { p: msg.p, yaw: msg.yaw };
        return;
      case 'visit':
        me.visiting = msg.on;
        if (msg.on && me.room) {
          const host = this.store.get(me.room.hostId);
          if (host) me.send({ t: 'hostHq', owner: me.room.hostId, base: host.data.base });
        }
        return;
      case 'input':
      case 'act':
        me.room?.sim?.onMessage(me.id, msg);
        return;
    }
  }

  /** Tell the gateway which room each player is in (it routes them here while they are). */
  private syncBinding(p: Player): void {
    const code = p.room?.code ?? '';
    if ((this.bound.get(p.id) ?? '') === code) return;
    this.bound.set(p.id, code);
    this.up({ msg: { case: 'bind', value: { account: p.id, code } } });
  }

  private lastLoad = '';

  /** Rooms and running operations (the gateway routes and drains by them); sent when they change. */
  private reportLoad(force = false): void {
    const running = [...this.rooms.values()].filter((r) => r.sim).length;
    const codes = [...this.rooms.keys()];
    const listed = [...this.rooms.values()].flatMap((r) => r.listing() ?? []);
    const key = `${running}|${codes.join(',')}|${JSON.stringify(listed)}`;
    if (!force && key === this.lastLoad) return;
    this.lastLoad = key;
    this.up({ msg: { case: 'load', value: { codes, running, listed: listed.map((l) => ({ ...l, mode: l.mode === 'survival' ? GameMode.SURVIVAL : GameMode.DEFENSE })) } } });
  }

  private housekeeping(): void {
    for (const [code, r] of this.rooms) {
      r.tick();
      if (r.empty) {
        this.rooms.delete(code);
        this.log(`room ${code} closed`);
      }
    }
    for (const p of this.players.values()) this.syncBinding(p);
    this.reportLoad();
    // Forget players who are in no room and no longer connected.
    for (const [id, p] of this.players) if (!p.attached && !p.room) this.players.delete(id);
  }

  private presence(): void {
    for (const r of this.rooms.values()) {
      if (r.state !== 'lobby') continue;
      const players = r.connected
        .filter((m) => m.peer?.presence && (m.peer.visiting || m.id === r.hostId))
        .map((m) => ({ id: m.id, name: m.name, p: m.peer!.presence!.p, yaw: m.peer!.presence!.yaw }));
      for (const m of r.connected) m.peer!.send({ t: 'presence', players: players.filter((x) => x.id !== m.id) });
    }
  }

  /** Finish every operation (secured rewards stay, unsecured are lost) and stop. */
  async shutdown(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    await Promise.allSettled([...this.rooms.values()].flatMap((r) => (r.sim ? [r.sim.shutdown()] : [])));
    for (const p of this.players.values()) p.send({ t: 'error', code: 'shutdown', msg: 'The server is shutting down' });
  }
}
