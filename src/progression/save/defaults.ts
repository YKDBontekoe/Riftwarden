import { emptyStructure } from '../../home/build/model';
import { DEFAULT_PLACEABLES } from '../../home/placeables';
import { starterWeapon } from '../../loot/generate';
import { newUid, SLOT_IDS, type SlotId } from '../items';
import { STARTING_CREDITS } from '../../economy/config';
import { generateMarket, progressLevel } from '../../economy/market';
import { LoadoutPreset, PRESET_COUNT, SAVE_VERSION, STORAGE_CAPACITY, SaveData, TierRecord, emptyEconomy, emptyProgress } from './types';

export const DEFAULT_FACILITIES = ['command', 'deployment', 'configuration', 'storage', 'workshop', 'merchant', 'modules', 'salvage', 'fabricate'];

export const emptyLoadout = (): Record<SlotId, string | null> => Object.fromEntries(SLOT_IDS.map((s) => [s, null])) as Record<SlotId, string | null>;

export const emptyRecord = (): TierRecord => ({ bestWave: 0, bestKills: 0, runs: 0, checkpoints: 0, salvageSecured: 0, longestRun: 0, lastPlayedAt: 0, highestWave: 0, bossesDefeated: 0, elitesDefeated: 0, bestBossesRun: 0, bestPlayerDamage: 0, bestTowerDamage: 0, deaths: 0, itemsBanked: 0 });

const emptyTotals = (): SaveData['totals'] => ({ runs: 0, returned: 0, defeated: 0, abandoned: 0, interrupted: 0, kills: 0, salvageSecured: 0, itemsSecured: 0, itemsLost: 0, itemsScrapped: 0, bestRarity: -1, bossesDefeated: 0, elitesDefeated: 0, deaths: 0, playerDamage: 0, towerDamage: 0, reactorDamage: 0, devRuns: 0 });

export const defaultPresets = (): LoadoutPreset[] => Array.from({ length: PRESET_COUNT }, (_, i) => ({ name: `CONFIG ${String.fromCharCode(65 + i)}`, slots: emptyLoadout() }));

export function createDefaultSave(now = Date.now()): SaveData {
  const starter = starterWeapon(newUid('it'), now);
  const loadout = emptyLoadout();
  loadout.weapon = starter.uid;
  const profileId = newUid('pf');
  return {
    version: SAVE_VERSION,
    profile: { id: profileId, callsign: 'WARDEN', createdAt: now, lastSavedAt: now },
    resources: { salvage: 0, credits: STARTING_CREDITS, components: 0 },
    items: [starter],
    storage: { capacity: STORAGE_CAPACITY, expansions: 0, uids: [] },
    loadout,
    presets: defaultPresets(),
    threat: { selected: 1, unlocked: 1 },
    records: {},
    totals: emptyTotals(),
    milestones: [],
    history: [],
    activeRun: null,
    base: { layoutVersion: 2, placeables: DEFAULT_PLACEABLES.map((p) => structuredCloneSafe(p)), facilities: [...DEFAULT_FACILITIES], structure: emptyStructure(), stations: {}, blueprints: [], owned: {} },
    tutorial: { done: [], skipped: false },
    market: generateMarket(profileId, 0, { level: 1, tier: 1 }, now),
    economy: emptyEconomy(),
    towers: { unlocked: [] },
    progress: emptyProgress(profileId),
  };
}

/** Progress inputs for merchant stock and fabrication (best loot level reached, unlocked tier). */
export function marketProgress(data: Pick<SaveData, 'records' | 'threat'> & { base?: SaveData['base'] }): { level: number; tier: number; extra: number } {
  return { level: progressLevel(data.records, data.threat.unlocked), tier: data.threat.unlocked, extra: facilityCount(data, 'marketUplink') * 2 };
}

/** M7: number of a functional facility placed in the HQ. */
export function facilityCount(data: { base?: SaveData['base'] }, type: string): number {
  return data.base?.placeables.filter((p) => p.type === type).length ?? 0;
}

/** Replace the stock with the next rotation (free after a completed run; paid refreshes count separately). */
export function rotateMarket(data: SaveData, now = Date.now(), refreshes = 0): void {
  data.market = generateMarket(data.profile.id, data.market.rotation + 1, marketProgress(data), now);
  data.market.refreshes = refreshes;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

