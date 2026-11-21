// Frame codec: the game's message objects (protocol.ts) <-> binary protobuf frames (proto/riftwarden/v1).
// The game keeps its message shapes; only the transport edges call encode*/decode*. Decoding returns the
// same objects JSON frames produced, so the structural validators and every handler work unchanged.
import { create, fromBinary, type MessageInitShape, toBinary } from '@bufbuild/protobuf';
import { GameMode } from './gen/riftwarden/v1/common_pb';
import { AbilitySlot, type Act, type ActSchema, TestOp, TowerPart, WeaponSlot } from './gen/riftwarden/v1/coop_pb';
import { type ClientFrame, ClientFrameSchema, type ServerFrame, ServerFrameSchema } from './gen/riftwarden/v1/envelope_pb';
import { LobbyPhase, type LobbyState as LobbyProto } from './gen/riftwarden/v1/lobby_pb';
import type { ReplicatedEvent } from './events';
import { eventFromProto, eventToProto } from './eventCodec';
import type { ActMsg, ClientMsg, LobbyState, RunStart, ServerMsg, V3 } from './protocol';
import { snapshotFromProto, snapshotToProto } from './snapshotCodec';
import { fromDoc, toDoc } from './value';

type ClientInit = MessageInitShape<typeof ClientFrameSchema>;
type ServerInit = MessageInitShape<typeof ServerFrameSchema>;
type ActInit = MessageInitShape<typeof ActSchema>;

const vec = (a: readonly number[]) => ({ x: a[0], y: a[1], z: a[2] });
const unvec = (v: { x: number; y: number; z: number } | undefined): V3 => (v ? [v.x, v.y, v.z] : [0, 0, 0]);
const modeIn = (m: string | undefined) => (m === 'survival' ? GameMode.SURVIVAL : m === 'defense' ? GameMode.DEFENSE : GameMode.UNSPECIFIED);
const modeOut = (m: GameMode): 'defense' | 'survival' | undefined => (m === GameMode.SURVIVAL ? 'survival' : m === GameMode.DEFENSE ? 'defense' : undefined);

const PARTS = { level: TowerPart.LEVEL, weapon: TowerPart.WEAPON, core: TowerPart.CORE, modifier: TowerPart.MODIFIER } as const;
const ABILITY = { ability: AbilitySlot.ABILITY, ability2: AbilitySlot.ABILITY2, ultimate: AbilitySlot.ULTIMATE } as const;
const WEAPON = { weapon: WeaponSlot.PRIMARY, weapon2: WeaponSlot.SECONDARY } as const;
const TESTS = { killAll: TestOp.KILL_ALL, jump: TestOp.JUMP, boss: TestOp.BOSS, clear: TestOp.CLEAR, reactor: TestOp.REACTOR, down: TestOp.DOWN } as const;
const invert = <K extends string, V extends number>(o: Record<K, V>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k])) as Record<number, K>;
const PARTS_OUT = invert(PARTS);
const ABILITY_OUT = invert(ABILITY);
const WEAPON_OUT = invert(WEAPON);
const TESTS_OUT = invert(TESTS);

// ------------------------------------------------------------------ acts

function actToProto(id: number, a: ActMsg): ActInit {
  switch (a.a) {
    case 'place':
      return { id, act: { case: 'place', value: { cfg: a.cfg, p: vec(a.p), yaw: a.yaw } } };
    case 'recycle':
      return { id, act: { case: 'recycle', value: { tower: a.tower } } };
    case 'repair':
      return { id, act: { case: 'repair', value: { tower: a.tower } } };
    case 'modify':
      return { id, act: { case: 'modify', value: { tower: a.tower, what: PARTS[a.what], part: a.part ?? '' } } };
    case 'tactical':
      return { id, act: { case: 'tactical', value: {} } };
    case 'startWave':
      return { id, act: { case: 'startWave', value: {} } };
    case 'collect':
      return { id, act: { case: 'collect', value: { pickup: a.pickup } } };
    case 'upgrade':
      return { id, act: { case: 'upgrade', value: { pick: a.pick } } };
    case 'vote':
      return { id, act: { case: 'vote', value: { home: a.home } } };
    case 'mapVote':
      return { id, act: { case: 'mapVote', value: { choice: a.choice } } };
    case 'station':
      return { id, act: { case: 'station', value: { station: a.station, opt: a.opt } } };
    case 'equip':
      return { id, act: { case: 'equip', value: { uid: a.uid, slot: a.slot ?? '' } } };
    case 'unequip':
      return { id, act: { case: 'unequip', value: { slot: a.slot } } };
    case 'discard':
      return { id, act: { case: 'discard', value: { uid: a.uid } } };
    case 'ability':
      return { id, act: { case: 'ability', value: { slot: ABILITY[a.slot], origin: vec(a.o), dir: vec(a.d) } } };
    case 'swap':
      return { id, act: { case: 'swap', value: { slot: WEAPON[a.slot] } } };
    case 'pound':
      return { id, act: { case: 'pound', value: { p: vec(a.p), fall: a.f } } };
    case 'test':
      return { id, act: { case: 'test', value: { op: TESTS[a.op], n: a.n } } };
  }
}

/** Unknown enum values decode to invalid strings, which the structural validator then rejects. */
function actFromProto(m: Act): Record<string, unknown> | null {
  const base = { t: 'act', id: m.id };
  const a = m.act;
  switch (a.case) {
    case 'place':
      return { ...base, a: 'place', cfg: { base: a.value.cfg?.base ?? '', weapon: a.value.cfg?.weapon ?? '', core: a.value.cfg?.core ?? '', modifier: a.value.cfg?.modifier ?? '' }, p: unvec(a.value.p), yaw: a.value.yaw };
    case 'recycle':
    case 'repair':
      return { ...base, a: a.case, tower: a.value.tower };
    case 'modify':
      return { ...base, a: 'modify', tower: a.value.tower, what: PARTS_OUT[a.value.what] ?? '?', ...(a.value.part ? { part: a.value.part } : {}) };
    case 'tactical':
    case 'startWave':
      return { ...base, a: a.case };
    case 'collect':
      return { ...base, a: 'collect', pickup: a.value.pickup };
    case 'upgrade':
      return { ...base, a: 'upgrade', pick: a.value.pick };
    case 'vote':
      return { ...base, a: 'vote', home: a.value.home };
    case 'mapVote':
      return { ...base, a: 'mapVote', choice: a.value.choice };
    case 'station':
      return { ...base, a: 'station', station: a.value.station, opt: a.value.opt };
    case 'equip':
      return { ...base, a: 'equip', uid: a.value.uid, ...(a.value.slot ? { slot: a.value.slot } : {}) };
    case 'unequip':
      return { ...base, a: 'unequip', slot: a.value.slot };
    case 'discard':
      return { ...base, a: 'discard', uid: a.value.uid };
    case 'ability':
      return { ...base, a: 'ability', slot: ABILITY_OUT[a.value.slot] ?? '?', o: unvec(a.value.origin), d: unvec(a.value.dir) };
    case 'swap':
      return { ...base, a: 'swap', slot: WEAPON_OUT[a.value.slot] ?? '?' };
    case 'pound':
      return { ...base, a: 'pound', p: unvec(a.value.p), f: a.value.fall };
    case 'test':
      return { ...base, a: 'test', op: TESTS_OUT[a.value.op] ?? '?', ...(a.value.n === undefined ? {} : { n: a.value.n }) };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ client -> server

function clientInit(m: ClientMsg): ClientInit {
  switch (m.t) {
    case 'hello':
      return { msg: { case: 'hello', value: { protocol: m.v } } };
    case 'create':
      return { msg: { case: 'create', value: { tier: m.tier } } };
    case 'join':
      return { msg: { case: 'join', value: { code: m.code } } };
    case 'leave':
      return { msg: { case: 'leave', value: {} } };
    case 'ready':
      return { msg: { case: 'ready', value: { ready: m.ready } } };
    case 'tier':
      return { msg: { case: 'tier', value: { tier: m.tier } } };
    case 'mode':
      return { msg: { case: 'mode', value: { mode: modeIn(m.mode) } } };
    case 'node':
      return { msg: { case: 'node', value: { node: m.node ?? '' } } };
    case 'start':
      return { msg: { case: 'start', value: {} } };
    case 'presence':
      return { msg: { case: 'presence', value: { p: vec(m.p), yaw: m.yaw } } };
    case 'visit':
      return { msg: { case: 'visit', value: { on: m.on } } };
    case 'input':
      return {
        msg: {
          case: 'input',
          value: {
            seq: m.seq,
            p: vec(m.p),
            yaw: m.yaw,
            pitch: m.pitch,
            speed: m.sp,
            flags: m.fl,
            heat: m.heat,
            shots: (m.shots ?? []).map((s) => ({ family: s.f, origin: vec(s.o), dir: vec(s.d), power: s.pw, heat: s.h, hits: s.hits.map((h) => ({ enemy: h[0], weak: h[1] === 1, point: { x: h[2], y: h[3], z: h[4] } })) })),
          },
        },
      };
    case 'act': {
      const { t: _t, id, ...act } = m;
      return { msg: { case: 'act', value: actToProto(id, act as ActMsg) } };
    }
    case 'ping':
      return { msg: { case: 'ping', value: { c: m.c } } };
  }
}

export function encodeClient(m: ClientMsg): Uint8Array {
  return toBinary(ClientFrameSchema, create(ClientFrameSchema, clientInit(m)));
}

/** Decode a client frame into the raw message object (validate it with parseClientMsg). Null when unreadable. */
export function decodeClient(bytes: Uint8Array): unknown {
  let f: ClientFrame;
  try {
    f = fromBinary(ClientFrameSchema, bytes);
  } catch {
    return null;
  }
  const m = f.msg;
  switch (m.case) {
    case 'hello':
      return { t: 'hello', v: m.value.protocol };
    case 'create':
      return { t: 'create', tier: m.value.tier };
    case 'join':
      return { t: 'join', code: m.value.code };
    case 'leave':
      return { t: 'leave' };
    case 'ready':
      return { t: 'ready', ready: m.value.ready };
    case 'tier':
      return { t: 'tier', tier: m.value.tier };
    case 'mode':
      return { t: 'mode', mode: modeOut(m.value.mode) ?? '?' };
    case 'node':
      return { t: 'node', node: m.value.node || null };
    case 'start':
      return { t: 'start' };
    case 'presence':
      return { t: 'presence', p: unvec(m.value.p), yaw: m.value.yaw };
    case 'visit':
      return { t: 'visit', on: m.value.on };
    case 'input': {
      const v = m.value;
      const out: Record<string, unknown> = { t: 'input', seq: v.seq, p: unvec(v.p), yaw: v.yaw, pitch: v.pitch, sp: v.speed, fl: v.flags, heat: v.heat };
      if (v.shots.length) {
        out.shots = v.shots.map((s) => ({ f: s.family, o: unvec(s.origin), d: unvec(s.dir), pw: s.power, h: s.heat, hits: s.hits.map((h) => [h.enemy, h.weak ? 1 : 0, ...(h.point ? [h.point.x, h.point.y, h.point.z] : [0, 0, 0])]) }));
      }
      return out;
    }
    case 'act':
      return actFromProto(m.value);
    case 'ping':
      return { t: 'ping', c: m.value.c };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ server -> client

const PHASE = { lobby: LobbyPhase.LOBBY, deploying: LobbyPhase.DEPLOYING, running: LobbyPhase.RUNNING } as const;
const PHASE_OUT = invert(PHASE);

function lobbyToProto(l: LobbyState) {
  return { code: l.code, hostId: l.hostId, tier: l.tier, mode: modeIn(l.mode), node: l.node ?? '', maxTier: l.maxTier, capacity: l.capacity, phase: PHASE[l.state], players: l.players, wave: l.wave };
}

function lobbyFromProto(l: LobbyProto): LobbyState {
  return {
    code: l.code,
    hostId: l.hostId,
    tier: l.tier,
    mode: modeOut(l.mode) ?? 'defense',
    node: l.node || null,
    maxTier: l.maxTier,
    capacity: l.capacity,
    state: PHASE_OUT[l.phase] ?? 'lobby',
    players: l.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, connected: p.connected, host: p.host, weapon: p.weapon, rarity: p.rarity, level: p.level })),
    wave: l.wave,
  };
}

function runStartToProto(r: RunStart) {
  return {
    runId: r.runId,
    tier: r.tier,
    seed: r.seed,
    arena: r.arena,
    you: r.you,
    players: r.players,
    loadout: toDoc(r.loadout),
    towerTech: r.towerTech,
    milestones: r.milestones,
    rejoin: r.rejoin,
    mode: modeIn(r.mode),
    node: r.node ? { id: r.node.id, map: r.node.map, path: r.node.path, cleared: r.node.cleared, acts: r.node.acts, carry: toDoc(r.node.carry) } : undefined,
  };
}

function serverInit(m: ServerMsg): ServerInit {
  switch (m.t) {
    case 'welcome':
      return { msg: { case: 'welcome', value: { protocol: m.v, playerId: m.playerId, name: m.name } } };
    case 'error':
      return { msg: { case: 'error', value: { code: m.code, msg: m.msg } } };
    case 'lobby':
      return { msg: { case: 'lobby', value: { lobby: m.lobby ? lobbyToProto(m.lobby) : undefined } } };
    case 'presence':
      return { msg: { case: 'presence', value: { players: m.players.map((p) => ({ id: p.id, name: p.name, p: vec(p.p), yaw: p.yaw })) } } };
    case 'hostHq':
      return { msg: { case: 'hostHq', value: { owner: m.owner, base: toDoc(m.base) } } };
    case 'runStart':
      return { msg: { case: 'runStart', value: runStartToProto(m.run) } };
    case 'snap':
      return { msg: { case: 'snap', value: snapshotToProto(m.s as Record<string, unknown>) } };
    case 'ev':
      return { msg: { case: 'events', value: { events: (m.e as ReplicatedEvent[]).map(eventToProto) } } };
    case 'actResult':
      return { msg: { case: 'actResult', value: { id: m.id, ok: m.ok, reason: m.reason ?? '' } } };
    case 'runEnd':
      return { msg: { case: 'runEnd', value: { result: toDoc(m.result) } } };
    case 'pong':
      return { msg: { case: 'pong', value: { c: m.c, s: m.s } } };
  }
}

export function encodeServer(m: ServerMsg): Uint8Array {
  return toBinary(ServerFrameSchema, create(ServerFrameSchema, serverInit(m)));
}

/** Decode a server frame into the message object JSON frames used to produce. Null when unreadable. */
export function decodeServer(bytes: Uint8Array): ServerMsg | null {
  let f: ServerFrame;
  try {
    f = fromBinary(ServerFrameSchema, bytes);
  } catch {
    return null;
  }
  const m = f.msg;
  const reason = (r: string) => (r ? { reason: r } : {});
  switch (m.case) {
    case 'welcome':
      return { t: 'welcome', v: m.value.protocol, playerId: m.value.playerId, name: m.value.name };
    case 'error':
      return { t: 'error', code: m.value.code, msg: m.value.msg };
    case 'lobby':
      return { t: 'lobby', lobby: m.value.lobby ? lobbyFromProto(m.value.lobby) : null };
    case 'presence':
      return { t: 'presence', players: m.value.players.map((p) => ({ id: p.id, name: p.name, p: unvec(p.p), yaw: p.yaw })) };
    case 'hostHq':
      return { t: 'hostHq', owner: m.value.owner, base: fromDoc(m.value.base) };
    case 'runStart': {
      const r = m.value;
      const mode = modeOut(r.mode);
      const run: RunStart = {
        runId: r.runId,
        tier: r.tier,
        seed: r.seed,
        arena: r.arena,
        you: r.you,
        players: r.players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })),
        loadout: fromDoc(r.loadout),
        towerTech: [...r.towerTech],
        milestones: [...r.milestones],
        rejoin: r.rejoin,
        ...(mode ? { mode } : {}),
        node: r.node ? { id: r.node.id, map: r.node.map, path: [...r.node.path], cleared: r.node.cleared, acts: r.node.acts, carry: fromDoc(r.node.carry) } : null,
      };
      return { t: 'runStart', run };
    }
    case 'snap':
      return { t: 'snap', s: snapshotFromProto(m.value) };
    case 'events':
      return { t: 'ev', e: m.value.events.map(eventFromProto).filter((e): e is unknown[] => e !== null) };
    case 'actResult':
      return { t: 'actResult', id: m.value.id, ok: m.value.ok, ...reason(m.value.reason) };
    case 'runEnd':
      return { t: 'runEnd', result: fromDoc(m.value.result) };
    case 'pong':
      return { t: 'pong', c: m.value.c, s: m.value.s };
    default:
      return null;
  }
}
