import { Store } from '../ui/store';
import { type KeyValueStorage, type LoadStatus, loadSave, resolveInterruptedRun, type SaveData, writeSave } from './save';

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Owns the persistent SaveData for the session. All changes go through `mutate`,
 * which applies a rule from save.ts, writes to storage only when something changed,
 * and publishes an immutable snapshot for the UI. Never written per frame.
 */
export class Profile {
  private data: SaveData;
  readonly loadStatus: LoadStatus;
  readonly loadNotes: string[];
  /** Immutable snapshot for React (replaced on every committed change). */
  readonly store: Store<{ save: SaveData; savedAt: number; lastWriteOk: boolean }>;
  writes = 0;

  constructor(private storage: KeyValueStorage | null = browserStorage()) {
    const r = loadSave(storage);
    this.data = r.data;
    this.loadStatus = r.status;
    this.loadNotes = r.notes;
    // A run still marked active means the page closed mid-run: record it once.
    const dirty = resolveInterruptedRun(this.data) !== null || r.status !== 'loaded' || r.notes.length > 0;
    this.store = new Store({ save: snapshot(this.data), savedAt: 0, lastWriteOk: true });
    if (dirty) this.persist();
  }

  /** Result of the most recent storage write. */
  get lastWriteOk(): boolean {
    return this.store.get().lastWriteOk;
  }

  get save(): Readonly<SaveData> {
    return this.data;
  }

  /** Apply a rule. Persists and publishes only when the rule reports a change. */
  mutate(rule: (d: SaveData) => boolean | void): boolean {
    const changed = rule(this.data) !== false;
    if (changed) this.persist();
    return changed;
  }

  /**
   * Apply an economy transaction (see economy/transactions.ts). The rule validates before
   * it mutates; a rejected rule leaves the save untouched (restored defensively). A
   * successful rule is committed to storage, and if that write fails the in-memory state
   * is rolled back, so a transaction is never reported complete without being persisted.
   */
  transact<T extends { ok: boolean }>(rule: (d: SaveData) => T): T | { ok: false; reason: string } {
    const before = JSON.stringify(this.data);
    let res: T;
    try {
      res = rule(this.data);
    } catch (e) {
      this.data = JSON.parse(before) as SaveData;
      return { ok: false, reason: `Transaction error: ${(e as Error).message}` };
    }
    if (!res.ok) {
      if (JSON.stringify(this.data) !== before) this.data = JSON.parse(before) as SaveData;
      return res;
    }
    const written = this.persist();
    if (!written && this.storage) {
      this.data = JSON.parse(before) as SaveData;
      this.store.set({ save: snapshot(this.data), savedAt: this.store.get().savedAt, lastWriteOk: false });
      this.rollbacks++;
      return { ok: false, reason: 'Save failed: the transaction was rolled back, nothing changed' };
    }
    return res;
  }

  rollbacks = 0;
  /** Test hook: make storage writes fail (verifies rollback). */
  failWrites = false;

  persist(): boolean {
    const ok = !this.failWrites && writeSave(this.storage, this.data);
    this.writes++;
    this.store.set({ save: snapshot(this.data), savedAt: Date.now(), lastWriteOk: ok });
    return ok;
  }
}

function snapshot(d: SaveData): SaveData {
  return JSON.parse(JSON.stringify(d)) as SaveData;
}
