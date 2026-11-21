import { createHash } from 'node:crypto';
import { runOp, type OpResult } from '../src/progression/ops';
import { beginRun, createDefaultSave, deployBlocker, resolveInterruptedRun, type SaveData, SAVE_VERSION } from '../src/progression/save';
import { ProfileDatabase, type ProfileWrite } from './profileDatabase';

/** The server persists the derived id. The guest secret stays with the player. */
export const playerIdFor = (secret: string): string => createHash('sha256').update(`riftwarden:${secret}`).digest('hex').slice(0, 20);

export interface OnlineProfile {
  id: string;
  data: SaveData;
  revision: number;
  /** Set while the player takes part in an online operation (HQ operations are blocked). */
  inRun: string | null;
}

export class ProfileStore {
  private readonly cache = new Map<string, OnlineProfile>();
  private readonly db: ProfileDatabase;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly log: (m: string) => void) {
    this.db = new ProfileDatabase((error) => log(`PostgreSQL connection error: ${error.message}`));
  }

  migrate(): Promise<void> {
    return this.db.migrate();
  }

  /** Synchronous lookup for profiles already loaded by the WebSocket handshake. */
  get(id: string): OnlineProfile | null {
    return this.cache.get(id) ?? null;
  }

  load(id: string): Promise<OnlineProfile | null> {
    return this.enqueue(async () => {
      const existing = this.get(id);
      if (existing) {
        if (!existing.inRun) await this.recoverInterruptedRun(existing);
        return existing;
      }
      const row = await this.db.load(id);
      if (!row) return null;
      if (row.data.version !== SAVE_VERSION) throw new Error(`Unsupported database save version ${row.data.version}`);
      const p: OnlineProfile = { id, ...row, inRun: null };
      await this.recoverInterruptedRun(p);
      this.cache.set(id, p);
      return p;
    });
  }

  create(id: string, name: string): Promise<OnlineProfile | null> {
    return this.enqueue(async () => {
      const existing = this.get(id);
      if (existing) return existing;
      const data = createDefaultSave();
      data.profile.callsign = name;
      try {
        await this.db.save([{ id, revision: null, data }]);
      } catch (error) {
        this.log(`Could not create profile: ${(error as Error).message}`);
        return null;
      }
      const p = { id, data, revision: 0, inRun: null };
      this.cache.set(id, p);
      return p;
    });
  }

  op(p: OnlineProfile, name: string, args: unknown[], txId: string): Promise<OpResult> {
    return this.enqueue(async () => {
      if (p.inRun) return { ok: false, reason: 'Unavailable during an operation' };
      const data = structuredClone(p.data);
      resolveInterruptedRun(data);
      let res: OpResult;
      try {
        res = runOp(data, name, args, txId);
      } catch (error) {
        return { ok: false, reason: `Operation error: ${(error as Error).message}` };
      }
      if (res.ok && !await this.tryCommit([{ profile: p, data }])) {
        return { ok: false, reason: 'Server save failed: rolled back' };
      }
      return res;
    });
  }

  /** Reserve and persist the entire operation before sending any run start to players. */
  startRun(profiles: OnlineProfile[], id: string, tier: number, mapSeed = 0, mode: 'defense' | 'survival' = 'defense'): Promise<boolean> {
    return this.enqueue(async () => {
      if (profiles.some((p) => p.inRun || p.data.threat.unlocked < tier || deployBlocker(p.data))) return false;
      const changes = profiles.map((profile) => {
        const data = structuredClone(profile.data);
        beginRun(data, id, tier, Date.now(), { mapSeed, mode });
        return { profile, data };
      });
      if (!await this.tryCommit(changes)) return false;
      for (const p of profiles) p.inRun = id;
      return true;
    });
  }

  /** Apply a rule to a draft, publishing it only after PostgreSQL commits. */
  mutate(p: OnlineProfile, rule: (data: SaveData) => boolean | void): Promise<boolean> {
    return this.enqueue(async () => {
      const data = structuredClone(p.data);
      try {
        if (rule(data) === false) return false;
      } catch (error) {
        this.log(`Profile change failed: ${(error as Error).message}`);
        return false;
      }
      return this.tryCommit([{ profile: p, data }]);
    });
  }

  async close(): Promise<void> {
    await this.pending;
    await this.db.close();
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.pending.then(fn);
    this.pending = job.catch(() => {});
    return job;
  }

  private async tryCommit(changes: { profile: OnlineProfile; data: SaveData }[]): Promise<boolean> {
    try {
      await this.commit(changes);
      return true;
    } catch (error) {
      this.log(`Could not commit profile change: ${(error as Error).message}`);
      return false;
    }
  }

  private async recoverInterruptedRun(profile: OnlineProfile): Promise<void> {
    if (!profile.data.activeRun) return;
    const data = structuredClone(profile.data);
    if (resolveInterruptedRun(data)) await this.commit([{ profile, data }]);
  }

  private async commit(changes: { profile: OnlineProfile; data: SaveData }[]): Promise<void> {
    const now = Date.now();
    const writes: ProfileWrite[] = changes.map(({ profile, data }) => {
      data.profile.lastSavedAt = now;
      return { id: profile.id, before: profile.data, revision: profile.revision, data };
    });
    await this.db.save(writes);
    for (const { profile, data } of changes) {
      profile.data = data;
      profile.revision++;
    }
  }
}
