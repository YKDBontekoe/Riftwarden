import { ACCENTS, DEFAULT_PLACEABLES, type Placeable, PLACEABLE_BOUNDS, PROP_TYPES, type PropType, type PropValue } from '../home/placeables';
import { ITEM_DEFS, type ItemInstance, newUid, SLOT_IDS, type SlotId, getSlot } from './items';
import type { Rewards, RunOutcome, RunResult } from './run';
import { CHECKPOINT_INTERVAL, THREAT_TIERS } from './tiers';

/**
 * Persistent player state (pure module; storage is injected).
 *
 * Format in storage: JSON `{ v: <schema version>, sum: <fnv1a of data json>, data }`.
 * - Unknown/missing fields fall back to safe defaults (sanitizeSave).
 * - A checksum mismatch or unparsable text counts as corrupt: the raw text is kept
 *   under CORRUPT_KEY and the last good backup (BACKUP_KEY) or a fresh save is used.
 * - Older versions are upgraded by MIGRATIONS; newer versions are never downgraded.
 */
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'riftwarden.save';
export const BACKUP_KEY = 'riftwarden.save.bak';
export const CORRUPT_KEY = 'riftwarden.save.corrupt';
export const HISTORY_LIMIT = 12;
export const STORAGE_CAPACITY = 40;

export interface TierRecord {
  /** Highest wave cleared. */
  bestWave: number;
  bestKills: number;
  runs: number;
  checkpoints: number;
  salvageSecured: number;
  longestRun: number;
  lastPlayedAt: number;
}

export type HistoryOutcome = RunOutcome | 'interrupted';

export interface RunHistoryEntry {
  id: string;
  tier: number;
  outcome: HistoryOutcome;
  finalWave: number;
  wavesCleared: number;
  kills: number;
  duration: number;
  salvageSecured: number;
  salvageLost: number;
  endedAt: number;
  newRecord: boolean;
}

export interface ActiveRun {
  id: string;
  tier: number;
  startedAt: number;
  /** Highest checkpoint wave already committed to this save (duplicate guard). */
  bankedThroughWave: number;
  salvageSecured: number;
}

export interface SaveData {
  version: number;
  profile: { id: string; callsign: string; createdAt: number; lastSavedAt: number };
  resources: { salvage: number };
  /** Every owned item. Each uid is either equipped (loadout) or in storage, never both. */
  items: ItemInstance[];
  storage: { capacity: number; uids: string[] };
  loadout: Record<SlotId, string | null>;
  threat: { selected: number; unlocked: number };
  records: Record<string, TierRecord>;
  totals: { runs: number; returned: number; defeated: number; abandoned: number; interrupted: number; kills: number; salvageSecured: number };
  history: RunHistoryEntry[];
  activeRun: ActiveRun | null;
  base: { layoutVersion: number; placeables: Placeable[]; facilities: string[] };
}

export const DEFAULT_FACILITIES = ['command', 'deployment', 'configuration', 'storage', 'workshop'];

const emptyLoadout = (): Record<SlotId, string | null> => Object.fromEntries(SLOT_IDS.map((s) => [s, null])) as Record<SlotId, string | null>;

export const emptyRecord = (): TierRecord => ({ bestWave: 0, bestKills: 0, runs: 0, checkpoints: 0, salvageSecured: 0, longestRun: 0, lastPlayedAt: 0 });

export function createDefaultSave(now = Date.now()): SaveData {
  const starter: ItemInstance = { uid: newUid('it'), defId: 'plasma_repeater', acquiredAt: now, source: 'starter' };
  const loadout = emptyLoadout();
  loadout.weapon = starter.uid;
  return {
    version: SAVE_VERSION,
    profile: { id: newUid('pf'), callsign: 'WARDEN', createdAt: now, lastSavedAt: now },
    resources: { salvage: 0 },
    items: [starter],
    storage: { capacity: STORAGE_CAPACITY, uids: [] },
    loadout,
    threat: { selected: 1, unlocked: 1 },
    records: {},
    totals: { runs: 0, returned: 0, defeated: 0, abandoned: 0, interrupted: 0, kills: 0, salvageSecured: 0 },
    history: [],
    activeRun: null,
    base: { layoutVersion: 1, placeables: DEFAULT_PLACEABLES.map((p) => structuredCloneSafe(p)), facilities: [...DEFAULT_FACILITIES] },
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ------------------------------------------------------------------ validation

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const int = (v: unknown, fallback: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number => Math.floor(num(v, fallback, lo, hi));
const str = (v: unknown, fallback: string, max = 64): string => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : fallback);
const MAX_TIER = THREAT_TIERS.length;

function sanitizeRecord(v: unknown): TierRecord {
  const r = obj(v);
  return {
    bestWave: int(r.bestWave, 0),
    bestKills: int(r.bestKills, 0),
    runs: int(r.runs, 0),
    checkpoints: int(r.checkpoints, 0),
    salvageSecured: int(r.salvageSecured, 0),
    longestRun: num(r.longestRun, 0, 0),
    lastPlayedAt: num(r.lastPlayedAt, 0, 0),
  };
}

function sanitizePlaceable(v: unknown): Placeable | null {
  const r = obj(v);
  if (!PROP_TYPES.includes(r.type as PropType)) return null;
  const pos = arr(r.position);
  const B = PLACEABLE_BOUNDS;
  const props: Record<string, PropValue> = {};
  for (const [k, val] of Object.entries(obj(r.props))) {
    if (typeof val === 'string' || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val))) props[k.slice(0, 32)] = typeof val === 'string' ? val.slice(0, 64) : val;
  }
  if (props.accent !== undefined && !ACCENTS.includes(props.accent as (typeof ACCENTS)[number])) delete props.accent;
  return {
    uid: str(r.uid, newUid('pl')),
    type: r.type as PropType,
    position: [num(pos[0], 0, B.minX, B.maxX), num(pos[1], 0, 0, B.maxY), num(pos[2], 0, B.minZ, B.maxZ)],
    rotationY: num(r.rotationY, 0, -Math.PI * 4, Math.PI * 4),
    scale: num(r.scale, 1, 0.25, 3),
    props,
  };
}

function sanitizeItem(v: unknown): ItemInstance | null {
  const r = obj(v);
  if (typeof r.uid !== 'string' || !r.uid || typeof r.defId !== 'string' || !r.defId) return null;
  return { uid: r.uid.slice(0, 64), defId: r.defId.slice(0, 64), acquiredAt: num(r.acquiredAt, 0, 0), source: str(r.source, 'unknown') };
}

function sanitizeHistory(v: unknown): RunHistoryEntry | null {
  const r = obj(v);
  if (typeof r.id !== 'string') return null;
  const outcomes: HistoryOutcome[] = ['returned', 'defeat', 'abandoned', 'interrupted'];
  return {
    id: r.id.slice(0, 64),
    tier: int(r.tier, 1, 1, MAX_TIER),
    outcome: outcomes.includes(r.outcome as HistoryOutcome) ? (r.outcome as HistoryOutcome) : 'interrupted',
    finalWave: int(r.finalWave, 1, 1),
    wavesCleared: int(r.wavesCleared, 0),
    kills: int(r.kills, 0),
    duration: num(r.duration, 0, 0),
    salvageSecured: int(r.salvageSecured, 0),
    salvageLost: int(r.salvageLost, 0),
    endedAt: num(r.endedAt, 0, 0),
    newRecord: r.newRecord === true,
  };
}

/**
 * Validate an arbitrary object into a consistent SaveData. Never throws.
 * `repairs` lists the fixes applied (useful for diagnostics/tests).
 */
export function sanitizeSave(raw: unknown, now = Date.now()): { data: SaveData; repairs: string[] } {
  const repairs: string[] = [];
  const r = obj(raw);
  const def = createDefaultSave(now);
  const profile = obj(r.profile);
  const data: SaveData = {
    version: SAVE_VERSION,
    profile: {
      id: str(profile.id, def.profile.id),
      callsign: str(profile.callsign, 'WARDEN', 16),
      createdAt: num(profile.createdAt, now, 0),
      lastSavedAt: num(profile.lastSavedAt, now, 0),
    },
    resources: { salvage: int(obj(r.resources).salvage, 0) },
    items: [],
    storage: { capacity: int(obj(r.storage).capacity, STORAGE_CAPACITY, 1, 1000), uids: [] },
    loadout: emptyLoadout(),
    threat: { selected: 1, unlocked: 1 },
    records: {},
    totals: { ...def.totals },
    history: [],
    activeRun: null,
    base: { layoutVersion: 1, placeables: [], facilities: [] },
  };

  // Items: unique uids only.
  const seen = new Set<string>();
  for (const v of arr(r.items)) {
    const it = sanitizeItem(v);
    if (!it || seen.has(it.uid)) {
      repairs.push('dropped invalid/duplicate item');
      continue;
    }
    seen.add(it.uid);
    data.items.push(it);
  }
  const byUid = new Map(data.items.map((i) => [i.uid, i]));
  const placed = new Set<string>();

  // Loadout: item must exist, fit the slot, and not be equipped twice.
  const lo = obj(r.loadout);
  for (const slot of SLOT_IDS) {
    const uid = lo[slot];
    if (typeof uid !== 'string') continue;
    const it = byUid.get(uid);
    const d = it ? ITEM_DEFS[it.defId] : undefined;
    if (!it || placed.has(uid) || !d || d.slot !== slot) {
      repairs.push(`cleared invalid ${slot} slot`);
      continue;
    }
    data.loadout[slot] = uid;
    placed.add(uid);
  }
  // Storage: existing, not equipped, unique.
  for (const uid of arr(obj(r.storage).uids)) {
    if (typeof uid !== 'string' || !byUid.has(uid) || placed.has(uid)) {
      if (typeof uid === 'string' && placed.has(uid)) repairs.push('removed equipped item from storage');
      continue;
    }
    data.storage.uids.push(uid);
    placed.add(uid);
  }
  // Orphaned items are never deleted: they go to storage.
  for (const it of data.items) {
    if (!placed.has(it.uid)) {
      data.storage.uids.push(it.uid);
      placed.add(it.uid);
      repairs.push('moved orphaned item to storage');
    }
  }
  // A run needs a weapon: equip a stored one or issue the starter.
  if (!data.loadout.weapon) {
    const idx = data.storage.uids.findIndex((u) => ITEM_DEFS[byUid.get(u)!.defId]?.slot === 'weapon');
    if (idx >= 0) data.loadout.weapon = data.storage.uids.splice(idx, 1)[0];
    else {
      const starter: ItemInstance = { uid: newUid('it'), defId: 'plasma_repeater', acquiredAt: now, source: 'starter' };
      data.items.push(starter);
      data.loadout.weapon = starter.uid;
    }
    repairs.push('re-equipped weapon');
  }

  const th = obj(r.threat);
  data.threat.unlocked = int(th.unlocked, 1, 1, MAX_TIER);
  data.threat.selected = Math.min(data.threat.unlocked, int(th.selected, 1, 1, MAX_TIER));

  for (const [k, v] of Object.entries(obj(r.records))) {
    const id = Number(k);
    if (Number.isInteger(id) && id >= 1 && id <= MAX_TIER) data.records[String(id)] = sanitizeRecord(v);
  }
  const t = obj(r.totals);
  for (const k of Object.keys(data.totals) as (keyof SaveData['totals'])[]) data.totals[k] = int(t[k], 0);
  for (const v of arr(r.history)) {
    const h = sanitizeHistory(v);
    if (h) data.history.push(h);
  }
  data.history = data.history.slice(0, HISTORY_LIMIT);

  const ar = obj(r.activeRun);
  if (typeof ar.id === 'string') {
    data.activeRun = {
      id: ar.id.slice(0, 64),
      tier: int(ar.tier, 1, 1, MAX_TIER),
      startedAt: num(ar.startedAt, now, 0),
      bankedThroughWave: int(ar.bankedThroughWave, 0),
      salvageSecured: int(ar.salvageSecured, 0),
    };
  }

  const base = obj(r.base);
  if (Array.isArray(base.placeables)) {
    const uids = new Set<string>();
    for (const v of base.placeables) {
      const pl = sanitizePlaceable(v);
      if (!pl || uids.has(pl.uid)) continue;
      uids.add(pl.uid);
      data.base.placeables.push(pl);
    }
  } else data.base.placeables = def.base.placeables;
  data.base.layoutVersion = int(base.layoutVersion, 1, 1);
  const fac = arr(base.facilities).filter((f): f is string => typeof f === 'string');
  data.base.facilities = fac.length ? [...new Set([...DEFAULT_FACILITIES, ...fac])] : [...DEFAULT_FACILITIES];

  return { data, repairs };
}

// ------------------------------------------------------------------ migrations

/**
 * MIGRATIONS[n] upgrades a raw version-n payload to version n+1. Add an entry here
 * (and bump SAVE_VERSION) whenever the stored shape changes incompatibly.
 */
export const MIGRATIONS: Record<number, (data: Obj) => Obj> = {};

export function migrate(data: unknown, fromVersion: number): { data: unknown; ok: boolean } {
  if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion > SAVE_VERSION) return { data, ok: false };
  let cur = obj(data);
  for (let v = fromVersion; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { data, ok: false };
    cur = step(cur);
  }
  return { data: cur, ok: true };
}

// ------------------------------------------------------------------ (de)serialisation

/** FNV-1a 32-bit, hex. Detects truncation and accidental edits, not tampering. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function serializeSave(data: SaveData): string {
  const body = JSON.stringify(data);
  return `{"v":${SAVE_VERSION},"sum":"${checksum(body)}","data":${body}}`;
}

export type ParseResult = { ok: true; data: SaveData; repairs: string[]; migratedFrom?: number } | { ok: false; reason: string };

export function parseSave(text: string, now = Date.now()): ParseResult {
  let env: Obj;
  try {
    env = obj(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  const v = env.v;
  if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: 'missing version' };
  if (v > SAVE_VERSION) return { ok: false, reason: `save is from a newer version (${v})` };
  if (!env.data || typeof env.data !== 'object') return { ok: false, reason: 'missing data' };
  // Verify against the exact stored text of `data`.
  const idx = text.indexOf('"data":');
  if (typeof env.sum !== 'string' || idx < 0 || checksum(text.slice(idx + 7, text.length - 1)) !== env.sum) return { ok: false, reason: 'checksum mismatch' };
  const m = migrate(env.data, v);
  if (!m.ok) return { ok: false, reason: `no migration from version ${v}` };
  const { data, repairs } = sanitizeSave(m.data, now);
  return { ok: true, data, repairs, migratedFrom: v < SAVE_VERSION ? v : undefined };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LoadStatus = 'new' | 'loaded' | 'restored-backup' | 'reset-corrupt';

export interface LoadResult {
  data: SaveData;
  status: LoadStatus;
  notes: string[];
}

export function loadSave(storage: KeyValueStorage | null, now = Date.now()): LoadResult {
  if (!storage) return { data: createDefaultSave(now), status: 'new', notes: ['storage unavailable'] };
  let text: string | null = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { data: createDefaultSave(now), status: 'new', notes: ['storage unavailable'] };
  }
  if (text === null) return { data: createDefaultSave(now), status: 'new', notes: [] };
  const primary = parseSave(text, now);
  if (primary.ok) return { data: primary.data, status: 'loaded', notes: primary.repairs };
  const notes = [`primary save rejected: ${primary.reason}`];
  try {
    storage.setItem(CORRUPT_KEY, text);
  } catch {
    /* best effort */
  }
  const bak = safeGet(storage, BACKUP_KEY);
  if (bak) {
    const b = parseSave(bak, now);
    if (b.ok) return { data: b.data, status: 'restored-backup', notes: [...notes, ...b.repairs] };
    notes.push(`backup rejected: ${b.reason}`);
  }
  return { data: createDefaultSave(now), status: 'reset-corrupt', notes };
}

function safeGet(s: KeyValueStorage, k: string): string | null {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}

/** Write the save, rotating the previous valid save into the backup slot. */
export function writeSave(storage: KeyValueStorage | null, data: SaveData, now = Date.now()): boolean {
  if (!storage) return false;
  data.profile.lastSavedAt = now;
  const text = serializeSave(data);
  try {
    const prev = storage.getItem(SAVE_KEY);
    if (prev && prev !== text && parseSave(prev, now).ok) storage.setItem(BACKUP_KEY, prev);
    storage.setItem(SAVE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ mutations (game rules)

export function selectTier(data: SaveData, tier: number): boolean {
  if (!Number.isInteger(tier) || tier < 1 || tier > data.threat.unlocked) return false;
  data.threat.selected = tier;
  return true;
}

function record(data: SaveData, tier: number): TierRecord {
  const k = String(tier);
  return (data.records[k] ??= emptyRecord());
}

/** Turn a dangling active run (tab closed mid-run) into an 'interrupted' history entry. */
export function resolveInterruptedRun(data: SaveData, now = Date.now()): RunHistoryEntry | null {
  const a = data.activeRun;
  if (!a) return null;
  const entry: RunHistoryEntry = {
    id: a.id,
    tier: a.tier,
    outcome: 'interrupted',
    finalWave: Math.max(1, a.bankedThroughWave),
    wavesCleared: a.bankedThroughWave,
    kills: 0,
    duration: 0,
    salvageSecured: a.salvageSecured,
    salvageLost: 0,
    endedAt: now,
    newRecord: false,
  };
  const rec = record(data, a.tier);
  rec.runs++;
  rec.lastPlayedAt = now;
  data.totals.runs++;
  data.totals.interrupted++;
  data.history.unshift(entry);
  data.history = data.history.slice(0, HISTORY_LIMIT);
  data.activeRun = null;
  return entry;
}

export function beginRun(data: SaveData, runId: string, tier: number, now = Date.now()): void {
  resolveInterruptedRun(data, now);
  data.activeRun = { id: runId, tier, startedAt: now, bankedThroughWave: 0, salvageSecured: 0 };
}

/**
 * Commit rewards banked at a checkpoint. Guarded so the same checkpoint can never be
 * applied twice (repeated calls, double clicks, re-entrant events). Also unlocks the
 * next threat tier at the first checkpoint of the current one.
 */
export function bankRewards(data: SaveData, runId: string, wave: number, rewards: Rewards): boolean {
  const a = data.activeRun;
  if (!a || a.id !== runId || wave <= a.bankedThroughWave || wave % CHECKPOINT_INTERVAL !== 0) return false;
  a.bankedThroughWave = wave;
  const s = Math.max(0, Math.floor(rewards.salvage));
  a.salvageSecured += s;
  data.resources.salvage += s;
  data.totals.salvageSecured += s;
  const known = new Set(data.items.map((i) => i.uid));
  for (const it of rewards.items) {
    if (known.has(it.uid)) continue;
    known.add(it.uid);
    data.items.push(it);
    data.storage.uids.push(it.uid);
  }
  const rec = record(data, a.tier);
  rec.checkpoints++;
  rec.salvageSecured += s;
  if (a.tier < THREAT_TIERS.length && data.threat.unlocked < a.tier + 1) data.threat.unlocked = a.tier + 1;
  return true;
}

/** Record a finished run once. Returns false if it was already recorded. */
export function recordRun(data: SaveData, result: RunResult): boolean {
  if (data.history.some((h) => h.id === result.id)) return false;
  if (data.activeRun && data.activeRun.id !== result.id) return false;
  const rec = record(data, result.tier);
  const newRecord = result.wavesCleared > rec.bestWave;
  rec.bestWave = Math.max(rec.bestWave, result.wavesCleared);
  rec.bestKills = Math.max(rec.bestKills, result.kills);
  rec.runs++;
  rec.longestRun = Math.max(rec.longestRun, result.duration);
  rec.lastPlayedAt = result.endedAt;
  data.totals.runs++;
  data.totals.kills += result.kills;
  if (result.outcome === 'returned') data.totals.returned++;
  else if (result.outcome === 'defeat') data.totals.defeated++;
  else data.totals.abandoned++;
  result.newRecord = newRecord;
  data.history.unshift({
    id: result.id,
    tier: result.tier,
    outcome: result.outcome,
    finalWave: result.finalWave,
    wavesCleared: result.wavesCleared,
    kills: result.kills,
    duration: result.duration,
    salvageSecured: result.salvageSecured,
    salvageLost: result.salvageLost,
    endedAt: result.endedAt,
    newRecord,
  });
  data.history = data.history.slice(0, HISTORY_LIMIT);
  data.activeRun = null;
  return true;
}

export function equippedItem(data: SaveData, slot: SlotId): ItemInstance | null {
  const uid = data.loadout[slot];
  return uid ? (data.items.find((i) => i.uid === uid) ?? null) : null;
}

export function storedItems(data: SaveData): ItemInstance[] {
  const byUid = new Map(data.items.map((i) => [i.uid, i]));
  return data.storage.uids.map((u) => byUid.get(u)!).filter(Boolean);
}

/** Equip a stored item into its slot; the previously equipped item goes to storage. */
export function equipFromStorage(data: SaveData, uid: string): boolean {
  if (data.activeRun) return false;
  const idx = data.storage.uids.indexOf(uid);
  const item = data.items.find((i) => i.uid === uid);
  const def = item ? ITEM_DEFS[item.defId] : undefined;
  if (idx < 0 || !def || !getSlot(def.slot).functional) return false;
  data.storage.uids.splice(idx, 1);
  const prev = data.loadout[def.slot];
  if (prev) data.storage.uids.push(prev);
  data.loadout[def.slot] = uid;
  return true;
}

/** Move an equipped item to storage (not allowed for required slots or a full store). */
export function unequipToStorage(data: SaveData, slot: SlotId): boolean {
  const uid = data.loadout[slot];
  if (data.activeRun || !uid || getSlot(slot).required || data.storage.uids.length >= data.storage.capacity) return false;
  data.loadout[slot] = null;
  data.storage.uids.push(uid);
  return true;
}
