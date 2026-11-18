import { type StationPose, type Structure } from '../../home/build/model';
import { type Placeable } from '../../home/placeables';
import { type ItemInstance, type SlotId } from '../items';
import type { RunOutcome } from '../run';
import { type MarketState } from '../../economy/market';

export const SAVE_VERSION = 7;
export const SAVE_KEY = 'riftwarden.save';
export const BACKUP_KEY = 'riftwarden.save.bak';
export const CORRUPT_KEY = 'riftwarden.save.corrupt';
export const HISTORY_LIMIT = 12;
export const STORAGE_CAPACITY = 50;
/** M7: bays added by each Storage Annex facility. */
export const ANNEX_BAYS = 10;
export const PRESET_COUNT = 3;

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
}

export interface LoadoutPreset {
  name: string;
  slots: Record<SlotId, string | null>;
}

export interface SaveData {
  version: number;
  profile: { id: string; callsign: string; createdAt: number; lastSavedAt: number };
  /** Persistent resources (M4: credits = trade currency, components = advanced components). */
  resources: { salvage: number; credits: number; components: number };
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
}

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
  stats: EconomyStats;
}

export const TX_HISTORY = 40;

export const emptyEconomy = (): EconomyState => ({
  tx: [],
  crafts: 0,
  stats: { creditsEarned: 0, creditsSpent: 0, itemsBought: 0, itemsSold: 0, itemsDismantled: 0, itemsCrafted: 0, rerolls: 0, enhancements: 0, componentSwaps: 0 },
});

