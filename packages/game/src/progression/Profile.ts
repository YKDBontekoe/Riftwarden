import { Store } from '../ui/store';
import { type KeyValueStorage, type LoadStatus, loadSave, type SaveData, writeSave } from '@riftwarden/rules/progression/save';
import { type OpResult, runOp } from '@riftwarden/rules/progression/ops';
import { applyRunEntry, type RunEntry } from '@riftwarden/rules/progression/runRules';
import { type LogEntry, openDoc, replay } from '@riftwarden/rules/progression/sync';
import { namespaced, SyncJournal } from './SyncJournal';
import { newUid } from '@riftwarden/rules/progression/items';

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

  /** The offline-first log of this namespace (see SyncJournal). */
  journal: SyncJournal;
  /** Account namespace (null = the guest profile on this device). */
  namespace: string | null = null;
  /** Called after every journaled change (the session client sends it when online). */
  onEntry: ((e: LogEntry) => void) | null = null;
  /**
   * Playing the seasonal profile (`SaveData.seasonal.doc`): `save`, rules, ops and run entries act on it, and its
   * journal entries carry the season so the server applies them there too. Remembered per device.
   */
  private seasonMode = readSeasonMode();
  private readonly baseStorage: KeyValueStorage | null;

  constructor(private storage: KeyValueStorage | null = browserStorage()) {
    this.baseStorage = storage;
    const r = loadSave(storage);
    this.data = r.data;
    this.loadStatus = r.status;
    this.loadNotes = r.notes;
    // A brand-new profile starts a complete log from its genesis; older saves have no log (not uploadable).
    this.journal = new SyncJournal(storage, r.status === 'new' ? snapshot(r.data) : null);
    this.store = new Store({ save: snapshot(this.active), savedAt: 0, lastWriteOk: true });
    const dirty = this.closeInterrupted() || r.status !== 'loaded' || r.notes.length > 0;
    if (dirty) this.persist();
  }

  /** A run still marked active means the page closed mid-run: record it once (a paused map run stays). */
  private closeInterrupted(): boolean {
    const e: RunEntry = { kind: 'interrupt', at: Date.now(), keepResumable: true };
    let changed = false;
    if (applyRunEntry(this.data, e)) {
      this.journal.append({ run: e });
      changed = true;
    }
    const s = this.data.seasonal;
    if (s && applyRunEntry(s.doc, e)) {
      this.journal.append({ run: e, season: s.id });
      changed = true;
    }
    return changed;
  }

  private record(body: { op?: { name: string; args: unknown[]; tx?: string }; run?: RunEntry }): void {
    const season = this.seasonActive ? this.data.seasonal!.id : undefined;
    const e = this.journal.append(season === undefined ? body : { ...body, season });
    this.onEntry?.(e);
  }

  /** True while the seasonal profile is the active one. */
  get seasonActive(): boolean {
    return this.seasonMode && !!this.data.seasonal;
  }

  /** The permanent profile (seasons, boards and archives read it while the seasonal profile is active). */
  get permanent(): Readonly<SaveData> {
    return this.data;
  }

  /** The document rules act on right now. */
  private get active(): SaveData {
    return this.seasonActive ? this.data.seasonal!.doc : this.data;
  }

  /** Switch between the permanent and the seasonal profile (not during a run). */
  setSeasonMode(on: boolean): boolean {
    if (this.active.activeRun) return false;
    if (on && !this.data.seasonal) return false;
    this.seasonMode = on;
    writeSeasonMode(on);
    this.persist();
    return true;
  }

  /** Apply a run lifecycle entry (runRules.ts) and log it. Returns true when the save changed. */
  runEntry(e: RunEntry): boolean {
    const changed = this.mutate((d) => applyRunEntry(d, e));
    if (changed) this.record({ run: e });
    return changed;
  }

  /**
   * Switch to an account's copy on this device (null = the guest profile). The copy and its log live in their
   * own storage namespace; the session client then syncs it with the server.
   */
  useNamespace(ns: string | null): void {
    if (ns === this.namespace) return;
    this.namespace = ns;
    this.storage = namespaced(this.baseStorage, ns);
    const r = loadSave(this.storage);
    this.data = r.data;
    this.journal = new SyncJournal(this.storage, ns ? null : r.status === 'new' ? snapshot(r.data) : null);
    if (ns && r.status === 'new') this.journal.reset(null, true);
    this.closeInterrupted();
    this.persist();
  }

  /** Replace the guest profile with a fresh one (after it was uploaded to an account). */
  resetGuest(): void {
    const keep = this.namespace;
    this.useNamespace(null);
    const fresh = loadSave(null).data;
    this.data = fresh;
    this.journal.reset(snapshot(fresh), true);
    this.persist();
    if (keep) this.useNamespace(keep);
  }

  /**
   * Adopt the server's copy (revision `rev`) and re-apply the entries the server has not answered yet, with
   * the same rules, so local = server + pending.
   */
  adoptServer(doc: unknown, rev: number, answeredUpTo: number, results: { seq: number; ok: boolean; reason?: string }[]): void {
    this.journal.acknowledge(answeredUpTo, rev, results);
    const base = openDoc(doc);
    this.data = this.journal.pending.length ? replay(base, this.journal.pending).doc : base;
    this.persist();
  }

  /** Result of the most recent storage write. */
  get lastWriteOk(): boolean {
    return this.store.get().lastWriteOk;
  }

  get save(): Readonly<SaveData> {
    return this.active;
  }

  /** Apply a rule. Persists and publishes only when the rule reports a change. */
  mutate(rule: (d: SaveData) => boolean | void): boolean {
    const changed = rule(this.active) !== false;
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
      res = rule(this.active);
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
      this.store.set({ save: snapshot(this.active), savedAt: this.store.get().savedAt, lastWriteOk: false });
      this.rollbacks++;
      return { ok: false, reason: 'Save failed: the transaction was rolled back, nothing changed' };
    }
    return res;
  }

  /**
   * Run a named operation (progression/ops.ts): validated, persisted, rolled back on a failed write, and
   * journaled for the account sync (the server replays the same operation).
   */
  op(name: string, args: unknown[] = [], txId: string = newUid('tx')): OpResult {
    const r = this.transact((d) => runOp(d, name, args, txId));
    if (r.ok) this.record({ op: { name, args, tx: txId } });
    return r;
  }

  /** An op on the permanent profile whatever is active (starting a season). */
  permanentOp(name: string, args: unknown[] = [], txId: string = newUid('tx')): OpResult {
    const keep = this.seasonMode;
    this.seasonMode = false;
    try {
      return this.op(name, args, txId);
    } finally {
      this.seasonMode = keep;
    }
  }

  rollbacks = 0;
  /** Test hook: make storage writes fail (verifies rollback). */
  failWrites = false;

  persist(): boolean {
    const ok = !this.failWrites && writeSave(this.storage, this.data);
    this.writes++;
    this.store.set({ save: snapshot(this.active), savedAt: Date.now(), lastWriteOk: ok });
    return ok;
  }
}

const SEASON_MODE_KEY = 'riftwarden.seasonMode';
function readSeasonMode(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEASON_MODE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeSeasonMode(on: boolean): void {
  try {
    localStorage.setItem(SEASON_MODE_KEY, on ? '1' : '0');
  } catch {
    // the choice simply resets next session
  }
}

function snapshot(d: SaveData): SaveData {
  return JSON.parse(JSON.stringify(d)) as SaveData;
}
