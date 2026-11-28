import { type StationPose, type Structure } from '../../home/build/model';
import { type Placeable } from '../../home/placeables';
import { type ItemInstance, type SlotId } from '../items';
import type { RunOutcome } from '../run';
import { type MarketState } from '../../economy/market';
import type { RunMapState } from '../../runmap/state';

export const SAVE_VERSION = 11;
export const SAVE_KEY = 'riftwarden.save';
export const BACKUP_KEY = 'riftwarden.save.bak';
export const CORRUPT_KEY = 'riftwarden.save.corrupt';
export const HISTORY_LIMIT = 12;
export const STORAGE_CAPACITY = 50;
/** M7: bays added by each Storage Annex facility. */
export const ANNEX_BAYS = 10;
export const PRESET_COUNT = 3;
/** Numeric safety bound for stored XP. */
export const MAX_XP = 1e12;

export interface TierRecord {
  /** Highest wave cleared. */
  bestWave: number;
  bestKills: number;
  runs: number;
  checkpoints: number;
  salvageSecured: number;
  longestRun: number;
  lastPlayedAt: number;
  // ---- M6 survival records (per tier)
  /** Highest wave reached (in progress when the run ended). */
  highestWave: number;
  bossesDefeated: number;
  elitesDefeated: number;
  /** Most bosses destroyed in a single run. */
  bestBossesRun: number;
  /** Most player damage dealt in a single run. */
  bestPlayerDamage: number;
  /** Most tower damage dealt in a single run. */
  bestTowerDamage: number;
  deaths: number;
  itemsBanked: number;
  // ---- run map (absent in older saves = 0; sanitize fills it)
  /** Deepest act reached. */
  deepestAct: number;
  /** Most map nodes completed in a single run. */
  bestNodes: number;
  /** Act bosses defeated (all runs). */
  actsCleared: number;
  // ---- survival mode (no towers, hunted, one life)
  survivalRuns: number;
  /** Most waves cleared in one survival run. */
  survivalBestWave: number;
  /** Most map nodes completed in one survival run. */
  survivalBestNodes: number;
}

export type HistoryOutcome = RunOutcome | 'interrupted';

export interface RunHistoryEntry {
  id: string;
  tier: number;
  outcome: HistoryOutcome;
  finalWave: number;
  wavesCleared: number;
  kills: number;
  duration: number;
  salvageSecured: number;
  salvageLost: number;
  itemsSecured: number;
  itemsLost: number;
  endedAt: number;
  newRecord: boolean;
  /** M4 */
  creditsSecured: number;
  componentsSecured: number;
  // ---- M6
  bosses: string[];
  elites: number;
  deaths: number;
  reactorDamage: number;
  playerDamage: number;
  towerDamage: number;
  itemsCollected: number;
  events: number;
  milestones: string[];
  /** Personal records broken (labels). */
  records: string[];
  /** Development session (not record eligible). */
  dev: boolean;
  /** Survival mode run (absent = defense). */
  mode?: 'survival';
  /** Staged-unlock loot locks at the start of the run (absent = none locked). */
  locks?: string[];
  /** A pinnacle run (a key was spent; the pinnacle boss leads wave 1). */
  pinnacle?: true;
  /** Run map: act reached, nodes completed and the compact path (e.g. "1C", "1E", "1B*"). */
  act?: number;
  nodes?: number;
  path?: string[];
}

export interface ActiveRun {
  id: string;
  tier: number;
  startedAt: number;
  /** Highest checkpoint wave already committed to this save (duplicate guard). */
  bankedThroughWave: number;
  salvageSecured: number;
  itemsSecured: number;
  creditsSecured: number;
  componentsSecured: number;
  /** Run map progress (map-mode runs only). */
  map?: RunMapState | null;
  /** Hub-node banking guard: nodes whose extra rewards were committed. */
  nodeBank?: number;
  /** Survival mode run (absent = defense). */
  mode?: 'survival';
  /** Staged-unlock loot locks at the start of the run (absent = none locked). */
  locks?: string[];
  /** A pinnacle run (a key was spent; the pinnacle boss leads wave 1). */
  pinnacle?: true;
}

export interface LoadoutPreset {
  name: string;
  slots: Record<SlotId, string | null>;
}

export interface SaveData {
  version: number;
  /** Settings and UI choices synced with the profile (progression/prefs.ts); absent until first changed. */
  prefs?: import('../prefs').SyncedPrefs;
  profile: { id: string; callsign: string; createdAt: number; lastSavedAt: number };
  /** Persistent resources (M4: credits = trade currency, components = advanced components). */
  /** shards: rift shards (Ascended crafting); absent in older saves = 0 (sanitize fills it, no version bump). */
  resources: { salvage: number; credits: number; components: number; shards: number };
  /** Every owned item. Each uid is either equipped (loadout) or in storage, never both. */
  items: ItemInstance[];
  /** Storage holds every owned item that is not equipped. `expansions` were bought with salvage. */
  storage: { capacity: number; expansions: number; uids: string[] };
  loadout: Record<SlotId, string | null>;
  /** Saved drone configurations (references into the same owned items). */
  presets: LoadoutPreset[];
  threat: { selected: number; unlocked: number };
  records: Record<string, TierRecord>;
  totals: {
    runs: number;
    returned: number;
    defeated: number;
    abandoned: number;
    interrupted: number;
    kills: number;
    salvageSecured: number;
    itemsSecured: number;
    itemsLost: number;
    itemsScrapped: number;
    /** Best rarity index ever secured (-1 = none). */
    bestRarity: number;
    // ---- M6
    bossesDefeated: number;
    elitesDefeated: number;
    deaths: number;
    playerDamage: number;
    towerDamage: number;
    reactorDamage: number;
    devRuns: number;
    /** Run map nodes completed / act bosses defeated (all runs). */
    nodesCleared: number;
    actsCleared: number;
  };
  /** M6: survival milestones reached (ids, see survival/records.ts). Development sessions never add to it. */
  milestones: string[];
  history: RunHistoryEntry[];
  activeRun: ActiveRun | null;
  base: {
    layoutVersion: number;
    placeables: Placeable[];
    facilities: string[];
    /** M7: snapped expansion modules (floors, walls, ceilings, pillars) on the 5 m grid. */
    structure: Structure;
    /** M7: relocated stations (absent = original position). */
    stations: Record<string, StationPose>;
    /** M7: blueprints bought from the architect (progression unlocks are derived from records/milestones). */
    blueprints: string[];
    /** M7: owned special pieces not bought with resources (crafted machinery) that are not placed. */
    owned: Record<string, number>;
  };
  /** M7: onboarding steps completed (or skipped). */
  tutorial: { done: string[]; skipped: boolean };
  /** M4: merchant stock (persisted: reopening a terminal never rerolls it). */
  market: MarketState;
  /** M4: transaction guard, deterministic crafting counter and economy statistics. */
  economy: EconomyState;
  /** M5: researched tower blueprints (`slot:id`; starter parts are implicit). Deployed towers and run upgrades are never saved. */
  towers: { unlocked: string[] };
  /** Warden levels and the procedural skill tree (level and points are derived from xp). */
  progress: ProgressState;
  /** Codex entries found (progression/spikes CODEX ids; optional). */
  codex?: string[];
  /** Rift Levels whose breakthrough (every 5th level cleared) was granted. */
  breakthroughs?: number[];
  /** Pinnacle keys held and pinnacle runs started. */
  pinnacle?: { keys: number; runs: number };
  /** Rift War: regions this warden secured sectors in, and regions whose victory cache was claimed. */
  war?: { fought: number[]; claimed: number[] };
  /** Seasonal profiles only: the season this document belongs to (absent = the permanent profile). */
  seasonId?: number;
  /** The permanent profile's running seasonal profile (a full document; entries tagged with its season apply to it). */
  seasonal?: { id: number; doc: SaveData };
  /** Finished seasons (what each one reached; titles are cosmetic). */
  seasonsDone?: import('../seasons').SeasonArchive[];
  /** Leaderboard summary kept by the rules when checkpoints bank (boards read it from server documents). */
  board?: import('../seasons').BoardSummary;
  /** Set when a migration restarted progression (v11 Rift Levels): the HQ shows a one-time notice. */
  wiped?: { from: number; at: number };
}

export interface ProgressState {
  /** Total secured XP (never decreases). */
  xp: number;
  /** Skill tree: seed (derived from the profile id once) and allocated node ids. */
  tree: { seed: number; allocated: string[] };
  /** Paid respecs so far (respec cost escalates). */
  respecs: number;
  /** Weapon-family mastery (optional: absent = nothing mastered yet). */
  mastery?: import('../mastery').MasteryState;
}

/** Stable 32-bit seed for a profile's skill tree. */
export function treeSeedFor(profileId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < profileId.length; i++) h = Math.imul(h ^ profileId.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const emptyProgress = (profileId: string, xp = 0): ProgressState => ({ xp: Math.max(0, Math.floor(xp)), tree: { seed: treeSeedFor(profileId), allocated: [] }, respecs: 0 });

export interface EconomyStats {
  creditsEarned: number;
  creditsSpent: number;
  itemsBought: number;
  itemsSold: number;
  itemsDismantled: number;
  itemsCrafted: number;
  rerolls: number;
  enhancements: number;
  componentSwaps: number;
}

export interface EconomyState {
  /** Recently committed transaction ids (repeat submissions with the same id are rejected). */
  tx: string[];
  /** Fabrication counter (deterministic crafting seeds). */
  crafts: number;
  /** Superior-or-better crafts in a market rotation (cost escalation; optional, absent = none). */
  heavy?: { rotation: number; n: number };
  stats: EconomyStats;
}

export const TX_HISTORY = 40;

export const emptyEconomy = (): EconomyState => ({
  tx: [],
  crafts: 0,
  stats: { creditsEarned: 0, creditsSpent: 0, itemsBought: 0, itemsSold: 0, itemsDismantled: 0, itemsCrafted: 0, rerolls: 0, enhancements: 0, componentSwaps: 0 },
});

