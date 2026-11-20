/**
 * Riftwarden co-op protocol (M7). Shared by the browser client and the Node server.
 *
 * Transport: one WebSocket per player, JSON text frames. Every message is `{ t: <type>, ... }`.
 * The server is authoritative for everything shared (enemies, waves, reactor, towers, loot,
 * rewards, online profiles); clients send intents (movement state, shot claims, actions) which
 * the server validates. Messages are validated structurally here before any game code sees them.
 */
export const PROTOCOL_VERSION = 11;
export const MAX_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Authoritative simulation and snapshot rates (Hz). */
export const SIM_HZ = 60;
export const SNAP_HZ = 20;
export const INPUT_HZ = 30;
/** Seconds a disconnected player keeps their run slot (and their unsecured rewards). */
export const RECONNECT_WINDOW = 120;
export const DEFAULT_PORT = 8787;

export type V3 = [number, number, number];

// ------------------------------------------------------------------ client -> server

export type ActMsg =
  | { a: 'place'; cfg: { base: string; weapon: string; core: string; modifier: string }; p: V3; yaw: number }
  | { a: 'recycle'; tower: number }
  | { a: 'repair'; tower: number }
  | { a: 'modify'; tower: number; what: 'level' | 'weapon' | 'core' | 'modifier'; part?: string }
  | { a: 'tactical' }
  | { a: 'startWave' }
  | { a: 'collect'; pickup: number }
  | { a: 'upgrade'; pick: string }
  | { a: 'vote'; home: boolean }
  | { a: 'mapVote'; choice: string }
  | { a: 'station'; station: string; opt: string }
  | { a: 'equip'; uid: string; slot?: string }
  | { a: 'unequip'; slot: string }
  | { a: 'discard'; uid: string }
  /** Use ability I / II or the ultimate from the drone's eye `o` along `d`. */
  | { a: 'ability'; slot: 'ability' | 'ability2' | 'ultimate'; o: V3; d: V3 }
  /** Put the primary ('weapon') or secondary ('weapon2') weapon in hand. */
  | { a: 'swap'; slot: 'weapon' | 'weapon2' }
  /** A ground pound landed at `p` after a fall of `f` metres (the server checks position + cooldown, applies the blast). */
  | { a: 'pound'; p: V3; f: number }
  /** Test servers only (RIFT_TEST=1): drive the run quickly through the real pipelines. */
  | { a: 'test'; op: 'killAll' | 'jump' | 'boss' | 'clear' | 'reactor'; n?: number };

/** Act messages are sent as `{ t: 'act', id: <request id>, ...act }`: no variant may use `id` or `t` (compile-time check). */
type ClashingAct = Extract<ActMsg, { id: unknown } | { t: unknown }>;
export const ACT_FIELDS_OK: [ClashingAct] extends [never] ? true : never = true;

export interface ShotClaim {
  /** Family of the firing weapon (must match the server's view of the loadout). */
  f: string;
  /** Eye/muzzle origin and normalised direction. */
  o: V3;
  d: V3;
  /** Charge power (rail) 0..1, beam tick = 1. */
  pw: number;
  /** Weapon heat 0..1 when fired (thermal damage stat). */
  h: number;
  /** Claimed enemy hits in order: [enemyNetId, weak 0/1, x, y, z]. */
  hits: [number, number, number, number, number][];
}

export interface InputMsg {
  t: 'input';
  seq: number;
  p: V3;
  yaw: number;
  pitch: number;
  /** Horizontal speed (m/s) and flags: 1 dashing, 2 sprinting, 4 firing, 8 build mode. */
  sp: number;
  fl: number;
  heat: number;
  shots?: ShotClaim[];
}

export type ClientMsg =
  | { t: 'hello'; v: number; secret: string; name: string }
  | { t: 'create'; tier: number }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'ready'; ready: boolean }
  | { t: 'tier'; tier: number }
  | { t: 'start' }
  | { t: 'profileInit' }
  | { t: 'op'; name: string; args: unknown[]; tx: string }
  | { t: 'presence'; p: V3; yaw: number }
  | { t: 'visit'; on: boolean }
  | InputMsg
  | ({ t: 'act'; id: number } & ActMsg)
  | { t: 'ping'; c: number };

// ------------------------------------------------------------------ server -> client

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  /** Short loadout summary: weapon name + rarity. */
  weapon: string;
  rarity: string;
  level: number;
}

export interface LobbyState {
  code: string;
  hostId: string;
  tier: number;
  maxTier: number;
  capacity: number;
  state: 'lobby' | 'deploying' | 'running';
  players: LobbyPlayer[];
  /** Run in progress (wave) for joiners/rejoiners. */
  wave: number;
}

export type ServerMsg =
  | { t: 'welcome'; v: number; playerId: string; name: string; hasProfile: boolean; profile: unknown | null }
  | { t: 'error'; code: string; msg: string }
  | { t: 'lobby'; lobby: LobbyState | null }
  | { t: 'profile'; save: unknown }
  | { t: 'opResult'; tx: string; ok: boolean; reason?: string }
  | { t: 'presence'; players: { id: string; name: string; p: V3; yaw: number }[] }
  | { t: 'hostHq'; owner: string; base: unknown }
  | { t: 'runStart'; run: RunStart }
  | { t: 'snap'; s: unknown }
  | { t: 'ev'; e: unknown[] }
  | { t: 'actResult'; id: number; ok: boolean; reason?: string }
  | { t: 'runEnd'; result: unknown; save: unknown }
  | { t: 'pong'; c: number; s: number };

export interface RunStart {
  runId: string;
  tier: number;
  seed: number;
  /** Procedural arena seed (0 = the classic arena). Server and clients generate the same layout from it. */
  arena: number;
  you: string;
  players: { id: string; name: string; slot: number }[];
  loadout: unknown;
  towerTech: string[];
  milestones: string[];
  /** Present when rejoining an operation in progress. */
  rejoin: boolean;
  /** Run map: the node this arena plays (map seed, path so far, the carry it was entered with). */
  node?: { id: string; map: number; path: string[]; cleared: number; acts: number; carry: unknown } | null;
}

// ------------------------------------------------------------------ validation

const isNum = (v: unknown, lim = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const isInt = (v: unknown, lim = 1e9): v is number => Number.isInteger(v) && Math.abs(v as number) <= lim;
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isV3 = (v: unknown, lim = 1e4): v is V3 => Array.isArray(v) && v.length === 3 && v.every((x) => isNum(x, lim));
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function validShot(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  if (!isStr(o.f, 16) || !isV3(o.o) || !isV3(o.d, 2) || !isNum(o.pw, 2) || !isNum(o.h, 2)) return false;
  if (!Array.isArray(o.hits) || o.hits.length > 12) return false;
  return o.hits.every((h) => Array.isArray(h) && h.length === 5 && isInt(h[0]) && (h[1] === 0 || h[1] === 1) && isNum(h[2], 1e4) && isNum(h[3], 1e4) && isNum(h[4], 1e4));
}

function validAct(o: Record<string, unknown>): boolean {
  if (!isInt(o.id)) return false;
  switch (o.a) {
    case 'place': {
      const c = o.cfg as Record<string, unknown> | undefined;
      return !!c && typeof c === 'object' && isStr(c.base, 32) && isStr(c.weapon, 32) && isStr(c.core, 32) && isStr(c.modifier, 32) && isV3(o.p) && isNum(o.yaw, 100);
    }
    case 'recycle':
    case 'repair':
      return isInt(o.tower);
    case 'modify':
      return isInt(o.tower) && (o.what === 'level' || o.what === 'weapon' || o.what === 'core' || o.what === 'modifier') && (o.part === undefined || isStr(o.part, 32));
    case 'tactical':
    case 'startWave':
      return true;
    case 'collect':
      return isInt(o.pickup);
    case 'upgrade':
      return isStr(o.pick, 48);
    case 'vote':
      return isBool(o.home);
    case 'mapVote':
      return isStr(o.choice, 24);
    case 'station':
      return isStr(o.station, 16) && isStr(o.opt, 32);
    case 'equip':
      return isStr(o.uid, 120) && (o.slot === undefined || isStr(o.slot, 24));
    case 'unequip':
      return isStr(o.slot, 24);
    case 'discard':
      return isStr(o.uid, 120);
    case 'swap':
      return o.slot === 'weapon' || o.slot === 'weapon2';
    case 'pound':
      return isV3(o.p) && isNum(o.f, 1000);
    case 'ability':
      return (o.slot === 'ability' || o.slot === 'ability2' || o.slot === 'ultimate') && isV3(o.o) && isV3(o.d);
    case 'test':
      return (o.op === 'killAll' || o.op === 'jump' || o.op === 'boss' || o.op === 'clear' || o.op === 'reactor') && (o.n === undefined || isNum(o.n, 1e6));
    default:
      return false;
  }
}

/** Structural validation of a decoded client message. Returns null when invalid. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      return isInt(o.v) && isStr(o.secret, 128) && (o.secret as string).length >= 16 && isStr(o.name, 40) ? (o as ClientMsg) : null;
    case 'create':
      return isInt(o.tier, 10) ? (o as ClientMsg) : null;
    case 'join':
      return isStr(o.code, 12) ? (o as ClientMsg) : null;
    case 'leave':
    case 'start':
      return o as ClientMsg;
    case 'ready':
      return isBool(o.ready) ? (o as ClientMsg) : null;
    case 'tier':
      return isInt(o.tier, 10) ? (o as ClientMsg) : null;
    case 'profileInit':
      return Object.keys(o).length === 1 ? { t: 'profileInit' } : null;
    case 'op':
      return isStr(o.name, 40) && Array.isArray(o.args) && isStr(o.tx, 80) ? (o as ClientMsg) : null;
    case 'presence':
      return isV3(o.p) && isNum(o.yaw, 100) ? (o as ClientMsg) : null;
    case 'visit':
      return isBool(o.on) ? (o as ClientMsg) : null;
    case 'input':
      if (!isInt(o.seq) || !isV3(o.p) || !isNum(o.yaw, 1e4) || !isNum(o.pitch, 4) || !isNum(o.sp, 200) || !isInt(o.fl, 1024) || !isNum(o.heat, 2)) return null;
      if (o.shots !== undefined && (!Array.isArray(o.shots) || o.shots.length > 24 || !o.shots.every(validShot))) return null;
      return o as ClientMsg;
    case 'act':
      return validAct(o) ? (o as ClientMsg) : null;
    case 'ping':
      return isNum(o.c, 1e15) ? (o as ClientMsg) : null;
    default:
      return null;
  }
}

/** Short human join codes (no ambiguous characters). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/** Token bucket: `rate` messages per second, `burst` at most. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  constructor(
    private rate: number,
    private burst: number,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }
  take(now = Date.now(), n = 1): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

// ------------------------------------------------------------------ compact numbers

/** Round to centimetres / milliradians for snapshots (keeps JSON small). */
export const q2 = (v: number): number => Math.round(v * 100) / 100;
export const q3 = (v: number): number => Math.round(v * 1000) / 1000;
