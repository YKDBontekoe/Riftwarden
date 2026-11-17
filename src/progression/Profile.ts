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

  persist(): boolean {
    const ok = writeSave(this.storage, this.data);
    this.writes++;
    this.store.set({ save: snapshot(this.data), savedAt: Date.now(), lastWriteOk: ok });
    return ok;
  }
}

function snapshot(d: SaveData): SaveData {
  return JSON.parse(JSON.stringify(d)) as SaveData;
}
