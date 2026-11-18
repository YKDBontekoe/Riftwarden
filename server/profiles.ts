import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOp, type OpResult } from '../src/progression/ops';
import { createDefaultSave, type KeyValueStorage, loadSave, resolveInterruptedRun, type SaveData, sanitizeSave, SAVE_KEY, writeSave } from '../src/progression/save';

/**
 * Online profiles (server-owned SaveData, one per guest identity).
 *
 * Identity: the client keeps a random secret; the server only stores sha256(secret), so a
 * player id cannot be used to impersonate anyone. Each profile lives in its own directory and
 * goes through the same versioned/checksummed save format as single-player (backup rotation,
 * migrations, sanitising). Writes are atomic (temp file + rename).
 */
export const playerIdFor = (secret: string): string => createHash('sha256').update(`riftwarden:${secret}`).digest('hex').slice(0, 20);

class FileKV implements KeyValueStorage {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private path(k: string): string {
    return join(this.dir, `${k.replace(/[^a-z0-9._-]/gi, '_')}.json`);
  }
  getItem(k: string): string | null {
    const p = this.path(k);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }
  setItem(k: string, v: string): void {
    const p = this.path(k);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, v);
    renameSync(tmp, p);
  }
}

export interface OnlineProfile {
  id: string;
  data: SaveData;
  kv: FileKV;
  /** Set while the player takes part in a co-op operation (HQ operations are blocked). */
  inRun: string | null;
}

export class ProfileStore {
  private cache = new Map<string, OnlineProfile>();
  writes = 0;
  failWrites = false;

  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
  }

  exists(id: string): boolean {
    return this.cache.has(id) || existsSync(join(this.root, id, `${SAVE_KEY}.json`));
  }

  /** Load (cached). A save still marked mid-run when the server starts is recorded as interrupted once. */
  get(id: string): OnlineProfile | null {
    const c = this.cache.get(id);
    if (c) return c;
    if (!this.exists(id)) return null;
    const kv = new FileKV(join(this.root, id));
    const r = loadSave(kv);
    const p: OnlineProfile = { id, data: r.data, kv, inRun: null };
    if (resolveInterruptedRun(p.data) !== null) this.persist(p);
    this.cache.set(id, p);
    return p;
  }

  /**
   * Create the online profile once: either fresh or imported from the player's single-player
   * save (sanitised: invalid items/values are repaired, an active run is resolved as interrupted).
   * The local save is never modified by this.
   */
  create(id: string, mode: 'import' | 'fresh', save: unknown, name: string): OnlineProfile | null {
    if (this.exists(id)) return null;
    let data: SaveData;
    if (mode === 'import' && save && typeof save === 'object') {
      data = sanitizeSave(save).data;
      resolveInterruptedRun(data);
    } else data = createDefaultSave();
    data.profile.callsign = name || data.profile.callsign;
    const kv = new FileKV(join(this.root, id));
    const p: OnlineProfile = { id, data, kv, inRun: null };
    if (!this.persist(p)) return null;
    this.cache.set(id, p);
    return p;
  }

  persist(p: OnlineProfile): boolean {
    this.writes++;
    if (this.failWrites) return false;
    return writeSave(p.kv, p.data);
  }

  /**
   * Run a named operation for this player. Validate + apply + persist; on a failed write the
   * in-memory profile is restored (same contract as Profile.transact). HQ operations are
   * refused while the player is deployed in a co-op run.
   */
  op(p: OnlineProfile, name: string, args: unknown[], txId: string): OpResult {
    if (p.inRun) return { ok: false, reason: 'Unavailable during an operation' };
    const before = JSON.stringify(p.data);
    let res: OpResult;
    try {
      res = runOp(p.data, name, args, txId);
    } catch (e) {
      res = { ok: false, reason: `Operation error: ${(e as Error).message}` };
    }
    if (!res.ok) {
      if (JSON.stringify(p.data) !== before) p.data = JSON.parse(before) as SaveData;
      return res;
    }
    if (!this.persist(p)) {
      p.data = JSON.parse(before) as SaveData;
      return { ok: false, reason: 'Server save failed: rolled back' };
    }
    return res;
  }

  /** Apply a server-side rule (banking, run records) and persist. Returns false (and restores) on failure. */
  mutate(p: OnlineProfile, rule: (d: SaveData) => boolean | void): boolean {
    const before = JSON.stringify(p.data);
    let changed: boolean;
    try {
      changed = rule(p.data) !== false;
    } catch {
      p.data = JSON.parse(before) as SaveData;
      return false;
    }
    if (!changed) return false;
    if (!this.persist(p)) {
      p.data = JSON.parse(before) as SaveData;
      return false;
    }
    return true;
  }
}
