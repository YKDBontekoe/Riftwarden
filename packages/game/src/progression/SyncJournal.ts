// The device side of offline-first sync (architecture v2 section 7): every persistent change is applied to the
// local save at once and appended here; the session client sends what the server has not confirmed. Kept next
// to the save in the same storage namespace (guest or one per account).
import type { KeyValueStorage, SaveData } from '@riftwarden/rules/progression/save';
import type { RunEntry } from '@riftwarden/rules/progression/runRules';
import type { EntryResult, LogEntry, OpEntry } from '@riftwarden/rules/progression/sync';

export const JOURNAL_KEY = 'riftwarden.sync';

export interface JournalState {
  v: 1;
  /** Id of this log (entries are de-duplicated per device by seq on the server). */
  device: string;
  /** The profile the log starts from (a fresh default), so a guest profile can be uploaded and verified. */
  genesis: SaveData | null;
  /** The log covers the whole profile (false for saves from before sync existed: they cannot be uploaded). */
  complete: boolean;
  nextSeq: number;
  /** Entries the server has answered (accepted or rejected) are dropped once the profile belongs to an account. */
  entries: LogEntry[];
  /** Server revision of the copy this device holds (0 = never synced). */
  rev: number;
}

const randomId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export class SyncJournal {
  state: JournalState;
  /** Rejections from the last sync (shown to the player). */
  lastRejected: EntryResult[] = [];

  constructor(private storage: KeyValueStorage | null, genesis: SaveData | null) {
    let loaded: JournalState | null = null;
    try {
      const raw = storage?.getItem(JOURNAL_KEY);
      if (raw) loaded = JSON.parse(raw) as JournalState;
    } catch {
      loaded = null;
    }
    this.state =
      loaded && loaded.v === 1 && Array.isArray(loaded.entries)
        ? loaded
        : { v: 1, device: randomId(), genesis, complete: genesis !== null, nextSeq: 1, entries: [], rev: 0 };
    if (!loaded) this.save();
  }

  get pending(): LogEntry[] {
    return this.state.entries;
  }

  append(body: { op?: OpEntry; run?: RunEntry }): LogEntry {
    const e: LogEntry = { seq: this.state.nextSeq++, at: Date.now(), ...JSON.parse(JSON.stringify(body)) };
    this.state.entries.push(e);
    this.save();
    return e;
  }

  /** The server answered entries up to `upTo` and holds revision `rev`. */
  acknowledge(upTo: number, rev: number, results: EntryResult[]): void {
    this.state.entries = this.state.entries.filter((e) => e.seq > upTo);
    this.state.rev = rev;
    this.lastRejected = results.filter((r) => !r.ok && r.reason !== 'already applied');
    this.save();
  }

  /** A fresh log for a new namespace (an account copy synced from the server). */
  reset(genesis: SaveData | null, complete: boolean): void {
    this.state = { v: 1, device: randomId(), genesis, complete, nextSeq: 1, entries: [], rev: 0 };
    this.save();
  }

  save(): void {
    try {
      this.storage?.setItem(JOURNAL_KEY, JSON.stringify(this.state));
    } catch {
      /* storage full or unavailable: the log stays in memory for this session */
    }
  }
}

/** Storage view for an account namespace: `riftwarden.x` -> `riftwarden.acct.<id>.x`. */
export function namespaced(storage: KeyValueStorage | null, ns: string | null): KeyValueStorage | null {
  if (!storage || !ns) return storage;
  const key = (k: string) => k.replace(/^riftwarden\./, `riftwarden.acct.${ns}.`);
  return {
    getItem: (k) => storage.getItem(key(k)),
    setItem: (k, v) => storage.setItem(key(k), v),
  };
}
