import { BACKUP_KEY, CORRUPT_KEY, SAVE_KEY, SAVE_VERSION, SaveData } from './types';
import { createDefaultSave } from './defaults';
import { Obj, obj } from './coerce';
import { sanitizeSave } from './sanitize';
import { migrate } from './migrations';

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

/** `upTo` stops the migration chain early (tests of historical migrations; the result is sanitized as current). */
export function parseSave(text: string, now = Date.now(), opts: { upTo?: number } = {}): ParseResult {
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
  const m = migrate(env.data, v, opts.upTo);
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

