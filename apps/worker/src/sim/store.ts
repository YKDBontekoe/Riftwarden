// Profiles inside a sim worker (architecture v2 step 7). The gateway sends each player's account profile; an
// operation changes it only through named run entries (rules: runRules.ts), applied to the cached copy here and
// streamed to the gateway, which applies them to the account as trusted entries (the server played the run).
import { applyRunEntry, type RunEntry } from '@riftwarden/rules/progression/runRules';
import { deployBlocker, type SaveData } from '@riftwarden/rules/progression/save';
import type { LogEntry } from '@riftwarden/rules/progression/sync';

export interface OnlineProfile {
  id: string;
  data: SaveData;
  /** Set while the player takes part in an online operation. */
  inRun: string | null;
}

/** What rooms and operations need from profile storage. */
export interface SimStore {
  get(id: string): OnlineProfile | null;
  /** Start an operation for every profile (all or none). */
  startRun(profiles: OnlineProfile[], runId: string, tier: number, mapSeed: number, mode: 'defense' | 'survival'): Promise<boolean>;
  /** Apply a run entry to the player's profile (and persist it through the gateway). */
  run(p: OnlineProfile, entry: RunEntry): Promise<boolean>;
}

export type EntrySink = (account: string, device: string, entries: LogEntry[]) => void;

export class RemoteStore implements SimStore {
  private readonly profiles = new Map<string, OnlineProfile>();
  /** Next entry seq per (account, operation log). */
  private readonly seqs = new Map<string, number>();

  constructor(private sink: EntrySink) {}

  /** The gateway's copy of an account (on attach and when it changes elsewhere). */
  put(id: string, data: SaveData): void {
    const p = this.profiles.get(id);
    if (p) p.data = data;
    else this.profiles.set(id, { id, data, inRun: null });
  }

  get(id: string): OnlineProfile | null {
    return this.profiles.get(id) ?? null;
  }

  async startRun(profiles: OnlineProfile[], runId: string, tier: number, mapSeed: number, mode: 'defense' | 'survival'): Promise<boolean> {
    if (profiles.some((p) => p.inRun || p.data.threat.unlocked < tier || deployBlocker(p.data))) return false;
    for (const p of profiles) {
      await this.run(p, { kind: 'start', runId, tier, at: Date.now(), mapSeed, mode, select: false });
      p.inRun = runId;
    }
    return true;
  }

  async run(p: OnlineProfile, entry: RunEntry): Promise<boolean> {
    const changed = applyRunEntry(p.data, entry);
    if (!changed) return false;
    const runId = 'runId' in entry ? entry.runId : entry.kind === 'end' ? entry.result.id : (p.inRun ?? 'none');
    const device = `op:${runId}`.slice(0, 64);
    const key = `${p.id}|${device}`;
    const seq = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, seq);
    this.sink(p.id, device, [{ seq, at: Date.now(), run: JSON.parse(JSON.stringify(entry)) as RunEntry }]);
    if (entry.kind === 'end' || entry.kind === 'interrupt') p.inRun = null;
    return true;
  }
}
