import { Store } from '../ui/store';
import { type KeyValueStorage, type LoadStatus, loadSave, type SaveData, sanitizeSave, writeSave } from '@riftwarden/rules/progression/save';
import { type OpResult, runOp } from '@riftwarden/rules/progression/ops';
import { applyRunEntry, type RunEntry } from '@riftwarden/rules/progression/runRules';
import { type LogEntry, openDoc, replay } from '@riftwarden/rules/progression/sync';
import { namespaced, SyncJournal } from './SyncJournal';
import { newUid } from '@riftwarden/rules/progression/items';

/** Online (co-op) backend: operations are mirrored locally and executed authoritatively by the server. */
export interface RemoteProfile {
  send(name: string, args: unknown[], txId: string): void;
  /** Server id shown in the UI. */
  label: string;
}

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
  /** Single-player save kept aside while an online profile is mirrored. */
  private localData: SaveData | null = null;
  private localStorageRef: KeyValueStorage | null = null;
  /** Set while the session mirrors an online (server-owned) profile. */
  remote: RemoteProfile | null = null;
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
  private readonly baseStorage: KeyValueStorage | null;

  constructor(private storage: KeyValueStorage | null = browserStorage()) {
    this.baseStorage = storage;
    const r = loadSave(storage);
    this.data = r.data;
    this.loadStatus = r.status;
    this.loadNotes = r.notes;
    // A brand-new profile starts a complete log from its genesis; older saves have no log (not uploadable).
    this.journal = new SyncJournal(storage, r.status === 'new' ? snapshot(r.data) : null);
    this.store = new Store({ save: snapshot(this.data), savedAt: 0, lastWriteOk: true });
    const dirty = this.closeInterrupted() || r.status !== 'loaded' || r.notes.length > 0;
    if (dirty) this.persist();
  }

  /** A run still marked active means the page closed mid-run: record it once (a paused map run stays). */
  private closeInterrupted(): boolean {
    const e: RunEntry = { kind: 'interrupt', at: Date.now(), keepResumable: true };
    if (!applyRunEntry(this.data, e)) return false;
    this.record({ run: e });
    return true;
  }

  private record(body: { op?: { name: string; args: unknown[]; tx?: string }; run?: RunEntry }): void {
    const e = this.journal.append(body);
    this.onEntry?.(e);
  }

  /** Apply a run lifecycle entry (runRules.ts) and log it. Returns true when the save changed. */
  runEntry(e: RunEntry): boolean {
    const changed = this.mutate((d) => applyRunEntry(d, e));
    if (changed && !this.remote) this.record({ run: e });
    return changed;
  }

  /**
   * Switch to an account's copy on this device (null = the guest profile). The copy and its log live in their
   * own storage namespace; the session client then syncs it with the server.
   */
  useNamespace(ns: string | null): void {
    if (ns === this.namespace || this.remote) return;
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

  /**
   * Run a named operation (progression/ops.ts). Locally: validated, persisted, rolled back on
   * a failed write. Online: applied to the mirror for instant feedback and sent to the server,
   * whose authoritative save replaces the mirror when it answers (`adoptRemote`).
   */
  op(name: string, args: unknown[] = [], txId: string = newUid('tx')): OpResult {
    if (!this.remote) {
      const r = this.transact((d) => runOp(d, name, args, txId));
      if (r.ok) this.record({ op: { name, args, tx: txId } });
      return r;
    }
    const before = JSON.stringify(this.data);
    let res: OpResult;
    try {
      res = runOp(this.data, name, args, txId);
    } catch (e) {
      res = { ok: false, reason: `Operation error: ${(e as Error).message}` };
    }
    if (!res.ok) {
      this.data = JSON.parse(before) as SaveData;
      return res;
    }
    this.remote.send(name, args, txId);
    this.store.set({ save: snapshot(this.data), savedAt: Date.now(), lastWriteOk: true });
    return res;
  }

  /** Switch to mirroring an online profile (the local save is kept aside, untouched). */
  attachRemote(remote: RemoteProfile, save: unknown): void {
    if (!this.remote) {
      this.localData = this.data;
      this.localStorageRef = this.storage;
    }
    this.remote = remote;
    this.storage = null;
    this.adoptRemote(save);
  }

  /** Replace the mirror with the server's authoritative save. */
  adoptRemote(save: unknown): void {
    if (!this.remote) return;
    this.data = sanitizeSave(save).data;
    this.store.set({ save: snapshot(this.data), savedAt: Date.now(), lastWriteOk: true });
  }

  /** Back to the single-player profile. */
  detachRemote(): void {
    if (!this.remote) return;
    this.remote = null;
    this.storage = this.localStorageRef;
    if (this.localData) this.data = this.localData;
    this.localData = null;
    this.store.set({ save: snapshot(this.data), savedAt: Date.now(), lastWriteOk: true });
  }

  get online(): boolean {
    return !!this.remote;
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
