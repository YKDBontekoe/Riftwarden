// Named run-lifecycle entries (architecture v2 step 5). Every persistent change a run makes to the profile is
// one of these plain-data entries, applied by the same code on the device (immediately, offline-first) and by
// the server's rules worker when the device syncs (after runCheck validated it). See profile ops (ops.ts) for
// the HQ side.
import type { DropSource } from '../loot/drops';
import type { RunMapState } from '../runmap/state';
import type { SlotId } from './items';
import type { Rewards, RunResult } from './run';
import { applyLoadout, bankNodeRewards, bankRewards, beginRun, recordRun, resolveInterruptedRun, type SaveData, saveMapProgress, selectTier } from './save';

/** One roll on the run's loot stream, recorded so the server can replay it (runCheck.replayLoot). */
export interface LootRecord {
  /** Map node the arena played (its arena seed salts the stream); null = classic run. */
  node: string | null;
  /** Values drawn from the node's loot stream before this roll. */
  draw: number;
  /** Item counter before this roll (uids are `<run>.<counter>`). */
  counter: number;
  source: DropSource;
  wave: number;
  tier: { lootLevelBonus: number; lootLuck: number; id?: number };
  faction: string | null;
}

export type RunEntry =
  | { kind: 'start'; runId: string; tier: number; at: number; mapSeed: number; mode: 'defense' | 'survival'; select: boolean }
  | { kind: 'bank'; runId: string; wave: number; rewards: Rewards; bosses: number; loot: LootRecord[] }
  | { kind: 'nodeBank'; runId: string; step: number; rewards: Rewards; loot: LootRecord[] }
  | { kind: 'map'; runId: string; state: RunMapState }
  | { kind: 'end'; result: RunResult; loadout: Partial<Record<SlotId, string | null>> }
  /** A run closed mid-way is recorded as interrupted (`keepResumable`: a map run paused after a node stays). */
  | { kind: 'interrupt'; at: number; keepResumable?: boolean };

export const RUN_ENTRY_KINDS = ['start', 'bank', 'nodeBank', 'map', 'end', 'interrupt'] as const;

/** Apply a run entry to the save. Returns true when the save changed. */
export function applyRunEntry(d: SaveData, e: RunEntry): boolean {
  switch (e.kind) {
    case 'start':
      if (e.select) selectTier(d, e.tier);
      beginRun(d, e.runId, e.tier, e.at, { mapSeed: e.mapSeed, mode: e.mode });
      return true;
    case 'bank':
      return bankRewards(d, e.runId, e.wave, e.rewards, { bosses: e.bosses });
    case 'nodeBank':
      return bankNodeRewards(d, e.runId, e.step, e.rewards);
    case 'map':
      return saveMapProgress(d, e.runId, e.state);
    case 'end': {
      const recorded = recordRun(d, e.result);
      // The profile adopts the run loadout for items it owns (lost items keep the previous secured gear).
      applyLoadout(d, e.loadout, { ignoreActiveRun: true });
      return recorded;
    }
    case 'interrupt':
      return resolveInterruptedRun(d, e.at, { keepResumable: !!e.keepResumable }) !== null;
  }
}
