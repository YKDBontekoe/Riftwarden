// Staged feature unlocks (docs/progression-design.md §5): a new warden starts with one weapon family, one ability and
// the core stations; families, slots, stations and endgame systems open with Warden level (basics) and the highest
// Rift Level unlocked (endgame). Pure: the HQ unlock track, the op gate, the loot locks and the slot rules read it.
import { RESOURCE_KEYS } from '../economy/config';
import type { ResourceKey } from '../economy/config';
import { ALL_COMPONENT_LOCKS, componentLocks, type MasteryState } from './mastery';
import type { WeaponFamily } from '../data/defs';
import type { Category } from '../loot/types';
import type { SlotId } from './items';
import { levelForXp } from './level';

export type UnlockKind = 'family' | 'slot' | 'station' | 'system';

export interface UnlockDef {
  id: string;
  label: string;
  kind: UnlockKind;
  /** Warden level or highest unlocked Rift Level that opens it. */
  by: { warden: number } | { rl: number };
  blurb: string;
}

/** The track, in the order a typical warden meets it. Ids are stable (persisted nowhere; derived from the save). */
export const UNLOCKS: readonly UnlockDef[] = [
  { id: 'slot:ability2', label: 'Second ability slot', kind: 'slot', by: { warden: 2 }, blurb: 'Carry two abilities: ability I on RMB, ability II on F.' },
  { id: 'station:merchant', label: 'Equipment Exchange', kind: 'station', by: { warden: 2 }, blurb: 'Buy from the rotating stock and sell what you do not need.' },
  { id: 'family:rail', label: 'Railgun family', kind: 'family', by: { warden: 3 }, blurb: 'Charged slugs that pierce. Railguns start dropping and can be crafted.' },
  { id: 'station:salvage', label: 'Reclamation Press', kind: 'station', by: { warden: 3 }, blurb: 'Batch dismantling with yield previews and item locks (storage can always scrap single items).' },
  { id: 'slot:weapon2', label: 'Secondary weapon slot', kind: 'slot', by: { warden: 4 }, blurb: 'Two weapons, instant swap on Z; the holstered one cools.' },
  { id: 'slot:accessory2', label: 'Second accessory slot', kind: 'slot', by: { warden: 5 }, blurb: 'A second accessory for more build room.' },
  { id: 'family:beam', label: 'Beam family', kind: 'family', by: { warden: 6 }, blurb: 'Continuous emitters whose damage ramps on one target.' },
  { id: 'slot:ultimate', label: 'Ultimate slot', kind: 'slot', by: { warden: 7 }, blurb: 'Ultimates (orbital lance, overdrive) start dropping; charge them by dealing damage.' },
  { id: 'seasons', label: 'Seasons', kind: 'system', by: { warden: 6 }, blurb: 'Each month a fresh seasonal warden on a faster ladder with its own rule and leaderboards; its gains move to you when the month ends.' },
  { id: 'station:lattice', label: 'Neural Lattice', kind: 'station', by: { warden: 8 }, blurb: 'Spend skill points on your endless procedural skill tree.' },
  { id: 'family:launcher', label: 'Launcher family', kind: 'family', by: { warden: 9 }, blurb: 'Rockets that detonate on impact and splash everything around the hit.' },
  { id: 'station:fabricate', label: 'Fabricator', kind: 'station', by: { warden: 10 }, blurb: 'Craft the slot and family you want. Higher grades open with Rift Levels.' },
  { id: 'family:swarm', label: 'Drone Swarm family', kind: 'family', by: { warden: 12 }, blurb: 'Hives of seeker drones that lock onto targets around the crosshair.' },
  { id: 'family:flamer', label: 'Flamer family', kind: 'family', by: { warden: 11 }, blurb: 'Short-range streams that sweep several machines at once and stack burn, chill or corrosion.' },
  { id: 'trading', label: 'Trading', kind: 'system', by: { warden: 15 }, blurb: 'Trade items and credits with another warden in your co-op lobby (10% tax on credits; Ascended and pinnacle items stay bound). Accounts must also be 7 days old.' },
  { id: 'station:architect', label: 'HQ construction', kind: 'station', by: { warden: 14 }, blurb: 'Expand and decorate the HQ; facilities give real bonuses.' },
  { id: 'workshop:enhance', label: 'Enhancement', kind: 'system', by: { rl: 2 }, blurb: 'Raise an item\'s power level by level at the workshop.' },
  { id: 'station:modules', label: 'Weapon modules', kind: 'station', by: { rl: 3 }, blurb: 'Modules drop and the Broker opens; install them in weapon sockets.' },
  { id: 'workshop:towers', label: 'Tower research', kind: 'system', by: { rl: 3 }, blurb: 'Research new tower weapons, cores and modifiers.' },
  { id: 'workshop:affixes', label: 'Affix recalibration', kind: 'system', by: { rl: 4 }, blurb: 'Reroll or refine one affix, or every unlocked affix at once.' },
  { id: 'workshop:components', label: 'Component refits', kind: 'system', by: { rl: 5 }, blurb: 'Swap barrels, cores, cooling and mechanisms on your weapons.' },
  { id: 'loot:legendary', label: 'Legendary drops', kind: 'system', by: { rl: 7 }, blurb: 'Legendary gear can drop from RL 7 (and masterwork crafting opens).' },
  { id: 'loot:exotic', label: 'Exotic drops', kind: 'system', by: { rl: 12 }, blurb: 'Exotics can drop from RL 12.' },
  { id: 'pinnacle', label: 'Pinnacle bosses', kind: 'system', by: { rl: 8 }, blurb: 'Elites drop pinnacle keys (or craft one for 20 rift shards); a key summons a pinnacle boss with legendary-floor loot.' },
  { id: 'workshop:ascension', label: 'Ascension', kind: 'system', by: { rl: 14 }, blurb: 'Ascend an exotic with rift shards; ascended drops can appear.' },
];

const BY_ID = new Map(UNLOCKS.map((u) => [u.id, u]));

/** What the unlock rules read from a save. */
export interface UnlockProgress {
  progress: { xp: number; mastery?: MasteryState };
  threat: { unlocked: number };
}

export const wardenLevel = (d: UnlockProgress): number => levelForXp(d.progress.xp);

let unlockAll = false;
/**
 * Automation switch: every feature counts as unlocked (legacy `?test` browser suites start from fresh profiles and
 * exercise late systems). Never set by servers or for players.
 */
export function setUnlockAll(on: boolean): void {
  unlockAll = on;
}
export const unlockAllActive = (): boolean => unlockAll;

export function isUnlocked(d: UnlockProgress, id: string): boolean {
  const u = BY_ID.get(id);
  if (!u || unlockAll) return true;
  return 'warden' in u.by ? wardenLevel(d) >= u.by.warden : d.threat.unlocked >= u.by.rl;
}

export const unlockDef = (id: string): UnlockDef | undefined => BY_ID.get(id);

/** "Warden level 3" / "Rift Level 4". */
export const requirementText = (u: UnlockDef): string => ('warden' in u.by ? `Warden level ${u.by.warden}` : `Rift Level ${u.by.rl}`);

/** Why a feature is locked (null = open). */
export function lockReason(d: UnlockProgress, id: string): string | null {
  const u = BY_ID.get(id);
  if (!u || isUnlocked(d, id)) return null;
  return `${u.label} unlocks at ${requirementText(u)}.`;
}

/** The HQ station an unlock powers up (stations and workshop systems), or null. */
export function stationForUnlock(id: string): string | null {
  for (const [station, feature] of Object.entries(STATION_FEATURE)) if (feature === id) return station;
  return id.startsWith('workshop:') ? 'workshop' : null;
}

/** Unlocks that put each currency to use (credits are used from the start). */
const CURRENCY_FEATURES: Record<ResourceKey, readonly string[]> = {
  credits: [],
  salvage: ['station:salvage', 'station:modules'],
  components: ['station:fabricate', 'station:modules', 'workshop:enhance', 'workshop:towers'],
  shards: ['workshop:ascension', 'pinnacle', 'loot:exotic'],
};

/**
 * Currencies worth showing (resource bars, HQ reserves): credits always; the others once the warden holds any
 * or a system that spends them is open, so a fresh warden is not shown four counters at zero.
 */
export function visibleCurrencies(d: UnlockProgress & { resources: Readonly<Record<ResourceKey, number>> }): ResourceKey[] {
  return RESOURCE_KEYS.filter((k) => k === 'credits' || d.resources[k] > 0 || CURRENCY_FEATURES[k].some((f) => isUnlocked(d, f)));
}

// ------------------------------------------------------------------ what the locks mean for loot, slots and ops

const FAMILY_UNLOCK: Partial<Record<WeaponFamily, string>> = { rail: 'family:rail', beam: 'family:beam', swarm: 'family:swarm', launcher: 'family:launcher', flamer: 'family:flamer' };

/** Weapon families that cannot drop / be crafted / be sold to this warden yet. */
export function lockedFamilies(d: UnlockProgress): WeaponFamily[] {
  return (Object.keys(FAMILY_UNLOCK) as WeaponFamily[]).filter((f) => !isUnlocked(d, FAMILY_UNLOCK[f]!));
}

/** Item categories that cannot drop / be crafted / be sold yet. */
export function lockedCategories(d: UnlockProgress): Category[] {
  const out: Category[] = [];
  if (!isUnlocked(d, 'slot:ultimate')) out.push('ultimate');
  if (!isUnlocked(d, 'station:modules')) out.push('module');
  return out;
}

/** Loot locks as one sorted list (recorded with loot rolls so the server replays the same pool). */
export function lootLocks(d: UnlockProgress): string[] {
  // Mastery components (`comp:<family>:<id>`) stay locked until the family's rank unlocks them.
  return [...lockedCategories(d).map((c) => `cat:${c}`), ...lockedFamilies(d).map((f) => `family:${f}`), ...(unlockAll ? [] : componentLocks(d.progress.mastery))].sort();
}

export const lockedFamiliesOf = (locks: readonly string[] | undefined): WeaponFamily[] => (locks ?? []).filter((l) => l.startsWith('family:')).map((l) => l.slice(7) as WeaponFamily);
export const lockedCategoriesOf = (locks: readonly string[] | undefined): Category[] => (locks ?? []).filter((l) => l.startsWith('cat:')).map((l) => l.slice(4) as Category);

/** Every lock id that can appear in `lootLocks` (server validation of recorded locks). */
export const ALL_LOOT_LOCKS: readonly string[] = ['cat:module', 'cat:ultimate', 'family:beam', 'family:flamer', 'family:launcher', 'family:rail', 'family:swarm', ...ALL_COMPONENT_LOCKS];

const SLOT_UNLOCK: Partial<Record<SlotId, string>> = { ability2: 'slot:ability2', weapon2: 'slot:weapon2', accessory2: 'slot:accessory2', ultimate: 'slot:ultimate' };

export function slotUnlocked(d: UnlockProgress, slot: SlotId): boolean {
  const id = SLOT_UNLOCK[slot];
  return !id || isUnlocked(d, id);
}

export const slotLockReason = (d: UnlockProgress, slot: SlotId): string | null => (SLOT_UNLOCK[slot] ? lockReason(d, SLOT_UNLOCK[slot]!) : null);

/** Slots this warden cannot use yet. */
export function lockedSlots(d: UnlockProgress): SlotId[] {
  return (Object.keys(SLOT_UNLOCK) as SlotId[]).filter((s) => !slotUnlocked(d, s));
}

/** Feature a fabrication recipe needs (its weapon family or category), if any. */
export function recipeFeature(output: { kind: string; category?: Category; family?: WeaponFamily }): string | null {
  if (output.kind !== 'item') return null;
  if (output.family && FAMILY_UNLOCK[output.family]) return FAMILY_UNLOCK[output.family]!;
  if (output.category === 'ultimate') return 'slot:ultimate';
  if (output.category === 'module') return 'station:modules';
  return null;
}

/** Which feature a named profile operation needs (ops.ts refuses it while locked). */
export const OP_FEATURE: Readonly<Record<string, string>> = {
  sellItems: 'station:merchant',
  refreshMarket: 'station:merchant',
  buyExchange: 'station:modules',
  installModule: 'station:modules',
  uninstallModule: 'station:modules',
  transferModule: 'station:modules',
  craft: 'station:fabricate',
  craftKey: 'station:fabricate',
  rerollAffix: 'workshop:affixes',
  rerollUnlocked: 'workshop:affixes',
  enhanceItem: 'workshop:enhance',
  modifyComponent: 'workshop:components',
  researchTower: 'workshop:towers',
  ascendItem: 'workshop:ascension',
  treeAllocate: 'station:lattice',
  treeRespec: 'station:lattice',
};

/** Feature an op needs, including per-argument cases (buying from the module broker). */
export function opFeature(name: string, args: readonly unknown[]): string | null {
  if (name === 'buyItem') return args[0] === 'modules' ? 'station:modules' : 'station:merchant';
  return OP_FEATURE[name] ?? null;
}

/** Station terminals that need a feature (HQ interaction refuses them with the reason). */
export const STATION_FEATURE: Readonly<Record<string, string>> = {
  merchant: 'station:merchant',
  salvage: 'station:salvage',
  modules: 'station:modules',
  fabricate: 'station:fabricate',
  lattice: 'station:lattice',
  architect: 'station:architect',
};

// ------------------------------------------------------------------ the track (HQ UI)

export interface TrackEntry {
  def: UnlockDef;
  open: boolean;
  /** 0..1 progress toward the requirement. */
  progress: number;
  /** "Warden 5/7" / "RL 3/4". */
  status: string;
}

export function unlockTrack(d: UnlockProgress): TrackEntry[] {
  const lvl = wardenLevel(d);
  const rl = d.threat.unlocked;
  return UNLOCKS.map((def) => {
    const need = 'warden' in def.by ? def.by.warden : def.by.rl;
    const have = 'warden' in def.by ? lvl : rl;
    return { def, open: have >= need, progress: Math.min(1, have / need), status: `${'warden' in def.by ? 'Warden' : 'RL'} ${Math.min(have, need)}/${need}` };
  });
}

/** The next `n` locked entries, closest first (HQ strip, command console). */
export function nextUnlocks(d: UnlockProgress, n = 3): TrackEntry[] {
  return unlockTrack(d)
    .filter((e) => !e.open)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, n);
}

/** Features that opened between two snapshots (unlock banners). */
export function newlyUnlocked(before: UnlockProgress, after: UnlockProgress): UnlockDef[] {
  return UNLOCKS.filter((u) => !isUnlocked(before, u.id) && isUnlocked(after, u.id));
}
