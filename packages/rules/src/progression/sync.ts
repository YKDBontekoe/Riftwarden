// Offline-first profile sync (architecture v2 section 7). A device applies every change locally and
// appends it to its log: named profile ops (ops.ts) and run entries (runRules.ts). The server's rules worker
// replays the log on the server copy, validating run entries (runCheck.ts); the server copy then replaces the
// device copy. Shared by the device (types) and the worker (replay), so both run the same rule code.
import { type OpResult, runOp } from './ops';
import { checkRunEntry } from './runCheck';
import { applyRunEntry, type RunEntry } from './runRules';
import { createDefaultSave, migrate, sanitizeSave, SAVE_VERSION, type SaveData } from './save';

export interface OpEntry {
  name: string;
  args: unknown[];
  tx?: string;
}

/** One logged change. `seq` is per device and increases by one; `at` is the device clock (ms). */
export interface LogEntry {
  seq: number;
  at: number;
  op?: OpEntry;
  run?: RunEntry;
}

export interface EntryResult {
  seq: number;
  ok: boolean;
  reason?: string;
}

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
};

/** A stored document (any older save version) as a current, sanitized SaveData. */
export function openDoc(raw: unknown, now = Date.now()): SaveData {
  const v = raw && typeof raw === 'object' && Number.isInteger((raw as { version?: unknown }).version) ? (raw as { version: number }).version : SAVE_VERSION;
  const migrated = v < SAVE_VERSION ? migrate(raw, v).data : raw;
  return sanitizeSave(migrated, now).data;
}

/**
 * A device's genesis document must be exactly what createDefaultSave builds for its own ids and time
 * (the log is replayed on top of it, so an edited genesis would smuggle resources or items in).
 */
export function genesisProblem(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return 'missing genesis';
  const d = doc as SaveData;
  const starter = d.items?.[0]?.uid;
  if (typeof d.profile?.id !== 'string' || typeof starter !== 'string' || !Number.isFinite(d.profile?.createdAt)) return 'malformed genesis';
  const expected = createDefaultSave(d.profile.createdAt, { profileId: d.profile.id, starterUid: starter });
  return stable(expected) === stable(doc) ? null : 'genesis is not a fresh profile';
}

/** The run entry kinds an op must not interleave with: HQ ops are refused while a run is active (rules). */
function applyOne(d: SaveData, e: LogEntry, now: number, trusted: boolean): string | null {
  if (e.op) {
    if (typeof e.op.name !== 'string' || !Array.isArray(e.op.args)) return 'malformed op';
    const r: OpResult = runOp(d, e.op.name, e.op.args, e.op.tx);
    return r.ok ? null : ((r as { reason?: string }).reason ?? 'rejected');
  }
  if (e.run) {
    const bad = trusted ? null : checkRunEntry(d, e.run, now);
    if (bad) return bad;
    applyRunEntry(d, e.run);
    return null;
  }
  return 'empty entry';
}

/**
 * Replay entries in order on a copy of `doc`. Each entry is atomic: a rejected or throwing entry leaves the
 * document as it was before that entry. Returns the new document and one result per entry.
 */
export function replay(doc: SaveData, entries: LogEntry[], now = Date.now(), opts: { trusted?: boolean } = {}): { doc: SaveData; results: EntryResult[]; applied: number } {
  let cur = structuredClone(doc);
  const results: EntryResult[] = [];
  let applied = 0;
  for (const e of entries) {
    const before = structuredClone(cur);
    let reason: string | null;
    try {
      reason = applyOne(cur, e, now, !!opts.trusted);
    } catch (err) {
      reason = `error: ${(err as Error).message}`;
    }
    if (reason) {
      cur = before;
      results.push({ seq: e.seq, ok: false, reason });
    } else {
      applied++;
      results.push({ seq: e.seq, ok: true });
    }
  }
  return { doc: cur, results, applied };
}
