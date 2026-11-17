import { TECH_LIST, techKey } from '../towers/components';
import { ACCENTS, DEFAULT_PLACEABLES, type Placeable, PLACEABLE_BOUNDS, PROP_TYPES, type PropType, type PropValue } from '../home/placeables';
import { isStatKey, type StatOp } from '../combat/stats';
import { affixDef } from '../loot/affixes';
import { baseDef } from '../loot/bases';
import { storageExpansionCost, STORAGE_EXPANSION } from '../loot/economy';
import { clampLevel, generateItem, hashSeed, starterWeapon } from '../loot/generate';
import { isRarity, rarity } from '../loot/rarity';
import { CATEGORIES, type Category, type RolledAffix, type RolledStat } from '../loot/types';
import { fitsSlot, getSlot, type ItemInstance, isSlotId, newUid, SLOT_IDS, type SlotId, slotsFor } from './items';
import type { Rewards, RunOutcome, RunResult } from './run';
import { CHECKPOINT_INTERVAL, THREAT_TIERS, unlocksNextTier } from './tiers';
import { defaultBuild, FAMILIES, isValidBuild, socketKinds, type Finish, type SocketKind, type WeaponBuild } from '../weapons/build';
import { canInstall, removalCost } from '../weapons/modules';
import type { WeaponFamily } from '../data/defs';
import { dismantleYield, MAX_BALANCE, MAX_ENHANCE_ANY, MARKET, STARTING_CREDITS } from '../economy/config';
import { generateMarket, type MarketEntry, type MarketState, progressLevel } from '../economy/market';

/**
 * Persistent player state (pure module; storage is injected).
 *
 * Format in storage: JSON `{ v: <schema version>, sum: <fnv1a of data json>, data }`.
 * - Unknown/missing fields fall back to safe defaults (sanitizeSave).
 * - A checksum mismatch or unparsable text counts as corrupt: the raw text is kept
 *   under CORRUPT_KEY and the last good backup (BACKUP_KEY) or a fresh save is used.
 * - Older versions are upgraded by MIGRATIONS; newer versions are never downgraded.
 */
export const SAVE_VERSION = 5;
export const SAVE_KEY = 'riftwarden.save';
export const BACKUP_KEY = 'riftwarden.save.bak';
export const CORRUPT_KEY = 'riftwarden.save.corrupt';
export const HISTORY_LIMIT = 12;
export const STORAGE_CAPACITY = 50;
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
  };
  history: RunHistoryEntry[];
  activeRun: ActiveRun | null;
  base: { layoutVersion: number; placeables: Placeable[]; facilities: string[] };
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

export const DEFAULT_FACILITIES = ['command', 'deployment', 'configuration', 'storage', 'workshop', 'merchant', 'modules', 'salvage', 'fabricate'];

const emptyLoadout = (): Record<SlotId, string | null> => Object.fromEntries(SLOT_IDS.map((s) => [s, null])) as Record<SlotId, string | null>;

export const emptyRecord = (): TierRecord => ({ bestWave: 0, bestKills: 0, runs: 0, checkpoints: 0, salvageSecured: 0, longestRun: 0, lastPlayedAt: 0 });

const emptyTotals = (): SaveData['totals'] => ({ runs: 0, returned: 0, defeated: 0, abandoned: 0, interrupted: 0, kills: 0, salvageSecured: 0, itemsSecured: 0, itemsLost: 0, itemsScrapped: 0, bestRarity: -1 });

const defaultPresets = (): LoadoutPreset[] => Array.from({ length: PRESET_COUNT }, (_, i) => ({ name: `CONFIG ${String.fromCharCode(65 + i)}`, slots: emptyLoadout() }));

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
    history: [],
    activeRun: null,
    base: { layoutVersion: 1, placeables: DEFAULT_PLACEABLES.map((p) => structuredCloneSafe(p)), facilities: [...DEFAULT_FACILITIES] },
    market: generateMarket(profileId, 0, { level: 1, tier: 1 }, now),
    economy: emptyEconomy(),
    towers: { unlocked: [] },
  };
}

/** Progress inputs for merchant stock and fabrication (best loot level reached, unlocked tier). */
export function marketProgress(data: Pick<SaveData, 'records' | 'threat'>): { level: number; tier: number } {
  return { level: progressLevel(data.records, data.threat.unlocked), tier: data.threat.unlocked };
}

/** Replace the stock with the next rotation (free after a completed run; paid refreshes count separately). */
export function rotateMarket(data: SaveData, now = Date.now(), refreshes = 0): void {
  data.market = generateMarket(data.profile.id, data.market.rotation + 1, marketProgress(data), now);
  data.market.refreshes = refreshes;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ------------------------------------------------------------------ validation

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const int = (v: unknown, fallback: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number => Math.floor(num(v, fallback, lo, hi));
const str = (v: unknown, fallback: string, max = 64): string => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : fallback);
const MAX_TIER = THREAT_TIERS.length;

function sanitizeRecord(v: unknown): TierRecord {
  const r = obj(v);
  return {
    bestWave: int(r.bestWave, 0),
    bestKills: int(r.bestKills, 0),
    runs: int(r.runs, 0),
    checkpoints: int(r.checkpoints, 0),
    salvageSecured: int(r.salvageSecured, 0),
    longestRun: num(r.longestRun, 0, 0),
    lastPlayedAt: num(r.lastPlayedAt, 0, 0),
  };
}

function sanitizePlaceable(v: unknown): Placeable | null {
  const r = obj(v);
  if (!PROP_TYPES.includes(r.type as PropType)) return null;
  const pos = arr(r.position);
  const B = PLACEABLE_BOUNDS;
  const props: Record<string, PropValue> = {};
  for (const [k, val] of Object.entries(obj(r.props))) {
    if (typeof val === 'string' || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val))) props[k.slice(0, 32)] = typeof val === 'string' ? val.slice(0, 64) : val;
  }
  if (props.accent !== undefined && !ACCENTS.includes(props.accent as (typeof ACCENTS)[number])) delete props.accent;
  return {
    uid: str(r.uid, newUid('pl')),
    type: r.type as PropType,
    position: [num(pos[0], 0, B.minX, B.maxX), num(pos[1], 0, 0, B.maxY), num(pos[2], 0, B.minZ, B.maxZ)],
    rotationY: num(r.rotationY, 0, -Math.PI * 4, Math.PI * 4),
    scale: num(r.scale, 1, 0.25, 3),
    props,
  };
}

function sanitizeStat(v: unknown): RolledStat | null {
  const r = obj(v);
  if (!isStatKey(r.stat) || !['add', 'pct', 'mul'].includes(r.op as string) || typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  return { stat: r.stat, op: r.op as StatOp, value: Math.max(-1e15, Math.min(1e15, r.value)) };
}

const FINISH_IDS: Finish[] = ['arctic', 'gunmetal', 'sand', 'slate', 'gilded', 'iridescent'];
const SOCKET_IDS: SocketKind[] = ['barrel', 'power', 'system'];

/** Validate a stored weapon build (null if missing or invalid: the caller assigns the default). */
function sanitizeBuild(v: unknown, chassis: string, family: WeaponFamily, sockets: number): WeaponBuild | null {
  const r = obj(v);
  if (!Object.keys(r).length) return null;
  const p = obj(r.params);
  const unit = (x: unknown) => num(x, 0.5, 0, 1);
  const kinds = arr(r.sockets).filter((k): k is SocketKind => SOCKET_IDS.includes(k as SocketKind)).slice(0, 8);
  const b: WeaponBuild = {
    v: int(r.v, 1, 1, 1000),
    family,
    chassis,
    barrel: str(r.barrel, '', 32),
    core: str(r.core, '', 32),
    cooling: str(r.cooling, '', 32),
    mechanism: str(r.mechanism, '', 32),
    attachments: arr(r.attachments).filter((a): a is string => typeof a === 'string').slice(0, 4),
    finish: FINISH_IDS.includes(r.finish as Finish) ? (r.finish as Finish) : 'arctic',
    params: { length: unit(p.length), bulk: unit(p.bulk), hue: unit(p.hue) },
    sockets: kinds.length === sockets ? kinds : socketKinds(family, sockets),
  };
  if (r.family !== family || !FAMILIES[family] || !isValidBuild(b)) return null;
  return b;
}

/**
 * Validate a stored item. Stored rolls are authoritative (never rerolled). Items in the
 * pre-M2 shape (no level/rarity) are upgraded to the deterministic level-1 common roll
 * of their base. Items whose base definition no longer exists are kept (inert, cannot be
 * equipped) rather than deleted. Installed modules that no longer fit their socket are
 * pushed to `evicted` (the caller returns them to storage) instead of being dropped.
 */
export function sanitizeItem(v: unknown, repairs: string[] = [], nested = false, evicted: ItemInstance[] = []): ItemInstance | null {
  const r = obj(v);
  if (typeof r.uid !== 'string' || !r.uid || typeof r.defId !== 'string' || !r.defId) return null;
  const uid = r.uid.slice(0, 64);
  const defId = r.defId.slice(0, 64);
  const acquiredAt = num(r.acquiredAt, 0, 0);
  const source = str(r.source, 'unknown');
  const base = baseDef(defId);
  if (typeof r.level !== 'number' || !isRarity(r.rarity)) {
    // Legacy (M1) item: regenerate its deterministic starter-grade roll.
    if (!base) repairs.push(`legacy item ${uid} has unknown base ${defId}`);
    const it = generateItem({ uid, seed: hashSeed(uid), level: 1, rarity: 'common', baseId: base ? defId : 'plasma_repeater', source, now: acquiredAt, fixedRoll: 0.5 });
    if (!base) it.defId = defId; // keep the original id: shown as unknown, never equipped
    repairs.push('upgraded legacy item');
    return it;
  }
  const category: Category = base?.category ?? (CATEGORIES.includes(r.category as Category) ? (r.category as Category) : 'module');
  const stats = arr(r.base).map(sanitizeStat).filter((x): x is RolledStat => !!x);
  const affixes: RolledAffix[] = [];
  for (const a of arr(r.affixes)) {
    const st = sanitizeStat(a);
    const ar = obj(a);
    if (!st) {
      repairs.push('dropped invalid affix');
      continue;
    }
    const af: RolledAffix = { ...st, id: typeof ar.id === 'string' && affixDef(ar.id) ? ar.id : 'unknown', tier: int(ar.tier, 1, 1, 5), roll: num(ar.roll, 0.5, 0, 1) };
    if (ar.locked === true) af.locked = true;
    affixes.push(af);
  }
  const item: ItemInstance = {
    uid,
    defId,
    acquiredAt,
    source,
    category,
    level: clampLevel(num(r.level, 1)),
    rarity: r.rarity,
    name: str(r.name, base?.name ?? 'Unknown equipment', 96),
    base: stats,
    affixes,
    // Only weapons have sockets (M3); the count is bounded by the build's socket list below.
    sockets: category === 'weapon' ? int(r.sockets, rarity(r.rarity).sockets, 0, 8) : 0,
    socketed: [],
    signature: typeof r.signature === 'string' ? r.signature.slice(0, 64) : null,
    seed: int(r.seed, 0, 0, 0xffffffff),
    gen: int(r.gen, 1, 0, 1000),
  };
  // M4 engineering state (only stored when set).
  if (r.locked === true) item.locked = true;
  const enh = int(r.enhance, 0, 0, MAX_ENHANCE_ANY);
  if (enh > 0) item.enhance = Math.min(enh, [4, 6, 8, 10, 12, 15][rarity(item.rarity).index]);
  const rr = int(r.rerolls, 0, 0, 1e6);
  if (rr > 0) item.rerolls = rr;
  const md = int(r.mods, 0, 0, 1e6);
  if (md > 0) item.mods = md;
  // Locks never cover every affix (at least one always rerolls).
  while (affixes.filter((a) => a.locked).length > Math.max(0, affixes.length - 1)) delete affixes.filter((a) => a.locked).pop()!.locked;
  const w = obj(r.weapon);
  const posNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  if (category === 'weapon') {
    if (posNum(w.damage) && posNum(w.fireRate) && posNum(w.heatPerShot) && posNum(w.coolRate)) {
      item.weapon = { damage: Math.min(1e15, w.damage as number), fireRate: Math.min(60, w.fireRate as number), heatPerShot: Math.min(100, w.heatPerShot as number), coolRate: Math.min(1000, w.coolRate as number) };
    } else if (base?.weapon) {
      // Damaged weapon block: restore the base's mid roll at the stored level (keeps the item usable).
      const fresh = generateItem({ uid, seed: item.seed, level: item.level, rarity: item.rarity, baseId: defId, source, fixedRoll: 0.5 });
      item.weapon = fresh.weapon;
      repairs.push('repaired weapon parameters');
    }
    if (item.weapon) {
      // M3 family parameters: optional, bounded.
      const opt = (k: keyof NonNullable<ItemInstance['weapon']>, lo: number, hi: number) => {
        const x = w[k];
        if (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi) (item.weapon as unknown as Record<string, number>)[k] = x;
      };
      opt('range', 5, 1000);
      opt('accuracy', 0.05, 5);
      opt('pierce', 0, 10);
      opt('chargeTime', 0.05, 10);
      opt('beamWidth', 0, 5);
      opt('rampMax', 1, 10);
    }
    const family: WeaponFamily = base?.weapon?.family ?? 'plasma';
    const b = sanitizeBuild(r.build, defId, family, item.sockets);
    if (!b) repairs.push('assigned default weapon build');
    item.build = b ?? defaultBuild(defId, family, item.sockets);
    // Socket list and installed modules (one level deep, each validated against its socket).
    item.sockets = item.build.sockets.length;
    const inst = arr(r.socketed);
    item.socketed = item.build.sockets.map(() => null);
    if (!nested) {
      inst.slice(0, item.sockets).forEach((mv, i) => {
        if (!mv) return;
        const m = sanitizeItem(mv, repairs, true);
        if (!m || m.category !== 'module') {
          repairs.push('dropped invalid installed module');
          return;
        }
        const check = canInstall(item, i, m);
        if (!check.ok) {
          // Never destroy a module: the caller moves it back to storage.
          evicted.push(m);
          repairs.push(`evicted incompatible module from ${uid}`);
          return;
        }
        item.socketed[i] = m;
      });
    }
  }
  const m = obj(r.module);
  if (category === 'module') {
    const compat = arr(m.compatible).filter((c): c is Category => CATEGORIES.includes(c as Category) && c !== 'module');
    // Since M3 every module installs into weapons and occupies exactly one socket.
    void compat;
    item.module = { type: str(m.type, base?.module?.type ?? 'unknown', 32), compatible: ['weapon'], socketCost: 1 };
  }
  return item;
}

function sanitizeHistory(v: unknown): RunHistoryEntry | null {
  const r = obj(v);
  if (typeof r.id !== 'string') return null;
  const outcomes: HistoryOutcome[] = ['returned', 'defeat', 'abandoned', 'interrupted'];
  return {
    id: r.id.slice(0, 64),
    tier: int(r.tier, 1, 1, MAX_TIER),
    outcome: outcomes.includes(r.outcome as HistoryOutcome) ? (r.outcome as HistoryOutcome) : 'interrupted',
    finalWave: int(r.finalWave, 1, 1),
    wavesCleared: int(r.wavesCleared, 0),
    kills: int(r.kills, 0),
    duration: num(r.duration, 0, 0),
    salvageSecured: int(r.salvageSecured, 0),
    salvageLost: int(r.salvageLost, 0),
    itemsSecured: int(r.itemsSecured, 0),
    itemsLost: int(r.itemsLost, 0),
    endedAt: num(r.endedAt, 0, 0),
    newRecord: r.newRecord === true,
    creditsSecured: int(r.creditsSecured, 0),
    componentsSecured: int(r.componentsSecured, 0),
  };
}

function sanitizeMarket(v: unknown, data: SaveData, owned: Set<string>, repairs: string[], now: number): MarketState {
  const r = obj(v);
  const rotation = int(r.rotation, 0, 0, 1e9);
  const entries = (list: unknown, prefix: string, kind: 'equipment' | 'modules'): MarketEntry[] | null => {
    if (!Array.isArray(list)) return null;
    const out: MarketEntry[] = [];
    for (const ev of list.slice(0, 16)) {
      const e = obj(ev);
      const it = sanitizeItem(e.item, repairs, true);
      if (typeof e.id !== 'string' || !e.id.startsWith(prefix) || !it) continue;
      if (kind === 'modules' ? it.category !== 'module' : it.category === 'module') continue;
      it.socketed = it.socketed.map(() => null);
      delete it.locked;
      // A stock item whose uid is already owned was bought: it can never be sold twice.
      out.push({ id: e.id.slice(0, 32), item: it, sold: e.sold === true || owned.has(it.uid), featured: e.featured === true });
    }
    return out;
  };
  const eq = entries(r.equipment, 'mk', 'equipment');
  const mo = entries(r.modules, 'mk', 'modules');
  if (!eq || !mo || (!eq.length && !mo.length)) {
    repairs.push('regenerated merchant stock');
    return generateMarket(data.profile.id, rotation, marketProgress(data), now);
  }
  const exchange = MARKET.exchange.map((o) => {
    const found = arr(r.exchange).map(obj).find((x) => x.id === o.id);
    return { id: o.id, left: int(found?.left, o.stock, 0, o.stock + 4) };
  });
  return { rotation, generatedAt: num(r.generatedAt, now, 0), refreshes: int(r.refreshes, 0, 0, 1000), equipment: eq, modules: mo, exchange };
}

function sanitizeEconomy(v: unknown): EconomyState {
  const r = obj(v);
  const e = emptyEconomy();
  e.tx = arr(r.tx).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 64)).slice(-TX_HISTORY);
  e.crafts = int(r.crafts, 0);
  const st = obj(r.stats);
  for (const k of Object.keys(e.stats) as (keyof EconomyStats)[]) e.stats[k] = int(st[k], 0);
  return e;
}

/**
 * Validate an arbitrary object into a consistent SaveData. Never throws.
 * `repairs` lists the fixes applied (useful for diagnostics/tests).
 */
export function sanitizeSave(raw: unknown, now = Date.now()): { data: SaveData; repairs: string[] } {
  const repairs: string[] = [];
  const r = obj(raw);
  const def = createDefaultSave(now);
  const profile = obj(r.profile);
  const data: SaveData = {
    version: SAVE_VERSION,
    profile: {
      id: str(profile.id, def.profile.id),
      callsign: str(profile.callsign, 'WARDEN', 16),
      createdAt: num(profile.createdAt, now, 0),
      lastSavedAt: num(profile.lastSavedAt, now, 0),
    },
    resources: {
      salvage: int(obj(r.resources).salvage, 0, 0, MAX_BALANCE),
      credits: int(obj(r.resources).credits, 0, 0, MAX_BALANCE),
      components: int(obj(r.resources).components, 0, 0, MAX_BALANCE),
    },
    items: [],
    storage: { capacity: STORAGE_CAPACITY, expansions: int(obj(r.storage).expansions, 0, 0, 1000), uids: [] },
    loadout: emptyLoadout(),
    presets: defaultPresets(),
    threat: { selected: 1, unlocked: 1 },
    records: {},
    totals: { ...def.totals },
    history: [],
    activeRun: null,
    base: { layoutVersion: 1, placeables: [], facilities: [] },
    market: def.market,
    economy: emptyEconomy(),
    towers: { unlocked: sanitizeTowerTech(obj(r.towers).unlocked) },
  };

  // Capacity is derived from purchased expansions (cannot be edited independently).
  data.storage.capacity = STORAGE_CAPACITY + data.storage.expansions * STORAGE_EXPANSION;
  // Items: unique uids only.
  const seen = new Set<string>();
  const evicted: ItemInstance[] = [];
  for (const v of arr(r.items)) {
    const it = sanitizeItem(v, repairs, false, evicted);
    if (!it || seen.has(it.uid)) {
      repairs.push('dropped invalid/duplicate item');
      continue;
    }
    seen.add(it.uid);
    data.items.push(it);
  }
  // Installed modules share the uid space: a uid may exist exactly once (loose or installed).
  for (const it of data.items) {
    it.socketed = it.socketed.map((m) => {
      if (!m) return null;
      if (seen.has(m.uid)) {
        repairs.push('removed duplicated installed module');
        return null;
      }
      seen.add(m.uid);
      return m;
    });
  }
  for (const m of evicted) {
    if (seen.has(m.uid)) continue;
    seen.add(m.uid);
    data.items.push(m);
  }
  const byUid = new Map(data.items.map((i) => [i.uid, i]));
  const placed = new Set<string>();

  // Loadout: item must exist, fit the slot, and not be equipped twice.
  const lo = obj(r.loadout);
  for (const slot of SLOT_IDS) {
    const uid = lo[slot];
    if (typeof uid !== 'string') continue;
    const it = byUid.get(uid);
    if (!it || placed.has(uid) || !fitsSlot(it, slot)) {
      repairs.push(`cleared invalid ${slot} slot`);
      continue;
    }
    data.loadout[slot] = uid;
    placed.add(uid);
  }
  // Storage: existing, not equipped, unique.
  for (const uid of arr(obj(r.storage).uids)) {
    if (typeof uid !== 'string' || !byUid.has(uid) || placed.has(uid)) {
      if (typeof uid === 'string' && placed.has(uid)) repairs.push('removed equipped item from storage');
      continue;
    }
    data.storage.uids.push(uid);
    placed.add(uid);
  }
  // Orphaned items are never deleted: they go to storage.
  for (const it of data.items) {
    if (!placed.has(it.uid)) {
      data.storage.uids.push(it.uid);
      placed.add(it.uid);
      repairs.push('moved orphaned item to storage');
    }
  }
  // A run needs a weapon: equip a stored one or issue the starter.
  if (!data.loadout.weapon) {
    const idx = data.storage.uids.findIndex((u) => fitsSlot(byUid.get(u), 'weapon'));
    if (idx >= 0) data.loadout.weapon = data.storage.uids.splice(idx, 1)[0];
    else {
      const starter = starterWeapon(newUid('it'), now);
      data.items.push(starter);
      data.loadout.weapon = starter.uid;
    }
    repairs.push('re-equipped weapon');
  }

  // Presets: references must be owned and fit their slot (shared references are fine).
  arr(r.presets)
    .slice(0, PRESET_COUNT)
    .forEach((pv, i) => {
      const p = obj(pv);
      const slots = obj(p.slots);
      const preset = data.presets[i];
      preset.name = str(p.name, preset.name, 20);
      const used = new Set<string>();
      for (const slot of SLOT_IDS) {
        const uid = slots[slot];
        if (typeof uid === 'string' && fitsSlot(byUid.get(uid), slot) && !used.has(uid)) {
          preset.slots[slot] = uid;
          used.add(uid);
        }
      }
    });

  const th = obj(r.threat);
  data.threat.unlocked = int(th.unlocked, 1, 1, MAX_TIER);
  data.threat.selected = Math.min(data.threat.unlocked, int(th.selected, 1, 1, MAX_TIER));

  for (const [k, v] of Object.entries(obj(r.records))) {
    const id = Number(k);
    if (Number.isInteger(id) && id >= 1 && id <= MAX_TIER) data.records[String(id)] = sanitizeRecord(v);
  }
  const t = obj(r.totals);
  for (const k of Object.keys(data.totals) as (keyof SaveData['totals'])[]) data.totals[k] = k === 'bestRarity' ? int(t[k], -1, -1, 5) : int(t[k], 0);
  for (const v of arr(r.history)) {
    const h = sanitizeHistory(v);
    if (h) data.history.push(h);
  }
  data.history = data.history.slice(0, HISTORY_LIMIT);

  const ar = obj(r.activeRun);
  if (typeof ar.id === 'string') {
    data.activeRun = {
      id: ar.id.slice(0, 64),
      tier: int(ar.tier, 1, 1, MAX_TIER),
      startedAt: num(ar.startedAt, now, 0),
      bankedThroughWave: int(ar.bankedThroughWave, 0),
      salvageSecured: int(ar.salvageSecured, 0),
      itemsSecured: int(ar.itemsSecured, 0),
      creditsSecured: int(ar.creditsSecured, 0),
      componentsSecured: int(ar.componentsSecured, 0),
    };
  }

  const base = obj(r.base);
  if (Array.isArray(base.placeables)) {
    const uids = new Set<string>();
    for (const v of base.placeables) {
      const pl = sanitizePlaceable(v);
      if (!pl || uids.has(pl.uid)) continue;
      uids.add(pl.uid);
      data.base.placeables.push(pl);
    }
  } else data.base.placeables = def.base.placeables;
  data.base.layoutVersion = int(base.layoutVersion, 1, 1);
  const fac = arr(base.facilities).filter((f): f is string => typeof f === 'string');
  data.base.facilities = fac.length ? [...new Set([...DEFAULT_FACILITIES, ...fac])] : [...DEFAULT_FACILITIES];

  data.market = sanitizeMarket(r.market, data, new Set(allOwnedUids(data)), repairs, now);
  data.economy = sanitizeEconomy(r.economy);

  return { data, repairs };
}

/** Keep only known, researchable blueprints (unknown ids are dropped, duplicates removed). */
export function sanitizeTowerTech(v: unknown): string[] {
  const valid = new Set(TECH_LIST.map((t) => techKey(t.slot, t.id)));
  const out: string[] = [];
  for (const k of arr(v)) if (typeof k === 'string' && valid.has(k) && !out.includes(k)) out.push(k);
  return out;
}

// ------------------------------------------------------------------ migrations

/**
 * MIGRATIONS[n] upgrades a raw version-n payload to version n+1. Add an entry here
 * (and bump SAVE_VERSION) whenever the stored shape changes incompatibly.
 */
export const MIGRATIONS: Record<number, (data: Obj) => Obj> = {
  /**
   * v1 (M1) -> v2 (M2): items gain generated stats (sanitizeItem upgrades the legacy
   * shape deterministically), the unused 'module' slot is removed (its item, if any, goes
   * to storage), storage capacity becomes STORAGE_CAPACITY + purchased expansions, and
   * loadout presets are introduced.
   */
  1: (d) => {
    const out: Obj = { ...d };
    const lo = { ...obj(d.loadout) };
    const storage = { ...obj(d.storage) };
    const uids = arr(storage.uids).filter((u): u is string => typeof u === 'string');
    if (typeof lo.module === 'string') uids.push(lo.module);
    delete lo.module;
    out.loadout = lo;
    out.storage = { expansions: 0, uids };
    out.presets = [];
    return out;
  },
  /**
   * v2 (M2) -> v3 (M3): weapons gain a default component build (stats untouched) and the
   * M3 socket count of their rarity; other categories lose their (never functional)
   * sockets; the unused `modules` uid list becomes `socketed` (all empty).
   */
  2: (d) => {
    const out: Obj = { ...d };
    out.items = arr(d.items).map((v) => {
      const it = { ...obj(v) };
      const isWeapon = it.category === 'weapon' || baseDef(typeof it.defId === 'string' ? it.defId : '')?.category === 'weapon';
      it.sockets = isWeapon && isRarity(it.rarity) ? rarity(it.rarity).sockets : 0;
      delete it.modules;
      it.socketed = [];
      return it;
    });
    return out;
  },
  /**
   * v3 (M3) -> v4 (M4): persistent economy. Adds credits (with the commissioning stipend)
   * and advanced components; merchant stock and economy state are generated by sanitize.
   * Items are untouched (engineering fields default to "none").
   */
  3: (d) => {
    const out: Obj = { ...d };
    const res = obj(d.resources);
    out.resources = { salvage: res.salvage, credits: STARTING_CREDITS, components: 0 };
    delete out.market;
    delete out.economy;
    return out;
  },
  /**
   * v4 (M4) -> v5 (M5): permanent tower blueprints. Nothing is rerolled or removed; the player starts
   * with only the starter parts researched (towers.unlocked is empty).
   */
  4: (d) => ({ ...d, towers: { unlocked: [] } }),
};

export function migrate(data: unknown, fromVersion: number): { data: unknown; ok: boolean } {
  if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion > SAVE_VERSION) return { data, ok: false };
  let cur = obj(data);
  for (let v = fromVersion; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { data, ok: false };
    cur = step(cur);
  }
  return { data: cur, ok: true };
}

// ------------------------------------------------------------------ (de)serialisation

/** FNV-1a 32-bit, hex. Detects truncation and accidental edits, not tampering. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function serializeSave(data: SaveData): string {
  const body = JSON.stringify(data);
  return `{"v":${SAVE_VERSION},"sum":"${checksum(body)}","data":${body}}`;
}

export type ParseResult = { ok: true; data: SaveData; repairs: string[]; migratedFrom?: number } | { ok: false; reason: string };

export function parseSave(text: string, now = Date.now()): ParseResult {
  let env: Obj;
  try {
    env = obj(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  const v = env.v;
  if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: 'missing version' };
  if (v > SAVE_VERSION) return { ok: false, reason: `save is from a newer version (${v})` };
  if (!env.data || typeof env.data !== 'object') return { ok: false, reason: 'missing data' };
  // Verify against the exact stored text of `data`.
  const idx = text.indexOf('"data":');
  if (typeof env.sum !== 'string' || idx < 0 || checksum(text.slice(idx + 7, text.length - 1)) !== env.sum) return { ok: false, reason: 'checksum mismatch' };
  const m = migrate(env.data, v);
  if (!m.ok) return { ok: false, reason: `no migration from version ${v}` };
  const { data, repairs } = sanitizeSave(m.data, now);
  return { ok: true, data, repairs, migratedFrom: v < SAVE_VERSION ? v : undefined };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LoadStatus = 'new' | 'loaded' | 'restored-backup' | 'reset-corrupt';

export interface LoadResult {
  data: SaveData;
  status: LoadStatus;
  notes: string[];
}

export function loadSave(storage: KeyValueStorage | null, now = Date.now()): LoadResult {
  if (!storage) return { data: createDefaultSave(now), status: 'new', notes: ['storage unavailable'] };
  let text: string | null = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { data: createDefaultSave(now), status: 'new', notes: ['storage unavailable'] };
  }
  if (text === null) return { data: createDefaultSave(now), status: 'new', notes: [] };
  const primary = parseSave(text, now);
  if (primary.ok) return { data: primary.data, status: 'loaded', notes: primary.repairs };
  const notes = [`primary save rejected: ${primary.reason}`];
  try {
    storage.setItem(CORRUPT_KEY, text);
  } catch {
    /* best effort */
  }
  const bak = safeGet(storage, BACKUP_KEY);
  if (bak) {
    const b = parseSave(bak, now);
    if (b.ok) return { data: b.data, status: 'restored-backup', notes: [...notes, ...b.repairs] };
    notes.push(`backup rejected: ${b.reason}`);
  }
  return { data: createDefaultSave(now), status: 'reset-corrupt', notes };
}

function safeGet(s: KeyValueStorage, k: string): string | null {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}

/** Write the save, rotating the previous valid save into the backup slot. */
export function writeSave(storage: KeyValueStorage | null, data: SaveData, now = Date.now()): boolean {
  if (!storage) return false;
  data.profile.lastSavedAt = now;
  const text = serializeSave(data);
  try {
    const prev = storage.getItem(SAVE_KEY);
    if (prev && prev !== text && parseSave(prev, now).ok) storage.setItem(BACKUP_KEY, prev);
    storage.setItem(SAVE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ mutations (game rules)

export function selectTier(data: SaveData, tier: number): boolean {
  if (!Number.isInteger(tier) || tier < 1 || tier > data.threat.unlocked) return false;
  data.threat.selected = tier;
  return true;
}

function record(data: SaveData, tier: number): TierRecord {
  const k = String(tier);
  return (data.records[k] ??= emptyRecord());
}

/** Turn a dangling active run (tab closed mid-run) into an 'interrupted' history entry. */
export function resolveInterruptedRun(data: SaveData, now = Date.now()): RunHistoryEntry | null {
  const a = data.activeRun;
  if (!a) return null;
  const entry: RunHistoryEntry = {
    id: a.id,
    tier: a.tier,
    outcome: 'interrupted',
    finalWave: Math.max(1, a.bankedThroughWave),
    wavesCleared: a.bankedThroughWave,
    kills: 0,
    duration: 0,
    salvageSecured: a.salvageSecured,
    salvageLost: 0,
    itemsSecured: a.itemsSecured,
    itemsLost: 0,
    endedAt: now,
    newRecord: false,
    creditsSecured: a.creditsSecured,
    componentsSecured: a.componentsSecured,
  };
  const rec = record(data, a.tier);
  rec.runs++;
  rec.lastPlayedAt = now;
  data.totals.runs++;
  data.totals.interrupted++;
  data.history.unshift(entry);
  data.history = data.history.slice(0, HISTORY_LIMIT);
  data.activeRun = null;
  rotateMarket(data, now);
  return entry;
}

export function beginRun(data: SaveData, runId: string, tier: number, now = Date.now()): void {
  resolveInterruptedRun(data, now);
  data.activeRun = { id: runId, tier, startedAt: now, bankedThroughWave: 0, salvageSecured: 0, itemsSecured: 0, creditsSecured: 0, componentsSecured: 0 };
}

/**
 * Commit rewards banked at a checkpoint. Guarded so the same checkpoint can never be
 * applied twice (repeated calls, double clicks, re-entrant events). Also unlocks the
 * next threat tier at the first checkpoint of the current one.
 */
export function bankRewards(data: SaveData, runId: string, wave: number, rewards: Pick<Rewards, 'salvage' | 'items'> & Partial<Rewards>, opts: { bosses?: number } = {}): boolean {
  const a = data.activeRun;
  if (!a || a.id !== runId || wave <= a.bankedThroughWave || wave % CHECKPOINT_INTERVAL !== 0) return false;
  // Validate everything first, then apply in one step (application-level atomicity).
  const known = new Set(allOwnedUids(data));
  const incoming: ItemInstance[] = [];
  for (const raw of rewards.items) {
    const it = sanitizeItem(JSON.parse(JSON.stringify(raw)));
    if (!it || known.has(it.uid)) continue;
    known.add(it.uid);
    incoming.push(it);
  }
  a.bankedThroughWave = wave;
  const s = Math.max(0, Math.floor(rewards.salvage));
  const cr = Math.max(0, Math.floor(rewards.credits ?? 0));
  const co = Math.max(0, Math.floor(rewards.components ?? 0));
  a.salvageSecured += s;
  a.itemsSecured += incoming.length;
  a.creditsSecured += cr;
  a.componentsSecured += co;
  data.resources.salvage = Math.min(MAX_BALANCE, data.resources.salvage + s);
  data.resources.credits = Math.min(MAX_BALANCE, data.resources.credits + cr);
  data.resources.components = Math.min(MAX_BALANCE, data.resources.components + co);
  data.economy.stats.creditsEarned += cr;
  data.totals.salvageSecured += s;
  data.totals.itemsSecured += incoming.length;
  // Banking never discards items: storage may exceed capacity (deployment is then blocked).
  data.items.push(...incoming);
  data.storage.uids.push(...incoming.map((i) => i.uid));
  for (const it of incoming) data.totals.bestRarity = Math.max(data.totals.bestRarity, rarity(it.rarity).index);
  const rec = record(data, a.tier);
  rec.checkpoints++;
  rec.salvageSecured += s;
  if (unlocksNextTier(a.tier, wave, opts.bosses ?? 0) && data.threat.unlocked < a.tier + 1) data.threat.unlocked = a.tier + 1;
  return true;
}

/** Record a finished run once. Returns false if it was already recorded. */
export function recordRun(data: SaveData, result: RunResult): boolean {
  if (data.history.some((h) => h.id === result.id)) return false;
  if (data.activeRun && data.activeRun.id !== result.id) return false;
  const rec = record(data, result.tier);
  const newRecord = result.wavesCleared > rec.bestWave;
  rec.bestWave = Math.max(rec.bestWave, result.wavesCleared);
  rec.bestKills = Math.max(rec.bestKills, result.kills);
  rec.runs++;
  rec.longestRun = Math.max(rec.longestRun, result.duration);
  rec.lastPlayedAt = result.endedAt;
  data.totals.runs++;
  data.totals.kills += result.kills;
  data.totals.itemsLost += result.itemsLost;
  if (result.outcome === 'returned') data.totals.returned++;
  else if (result.outcome === 'defeat') data.totals.defeated++;
  else data.totals.abandoned++;
  result.newRecord = newRecord;
  data.history.unshift({
    id: result.id,
    tier: result.tier,
    outcome: result.outcome,
    finalWave: result.finalWave,
    wavesCleared: result.wavesCleared,
    kills: result.kills,
    duration: result.duration,
    salvageSecured: result.salvageSecured,
    salvageLost: result.salvageLost,
    itemsSecured: result.itemsSecured,
    itemsLost: result.itemsLost,
    endedAt: result.endedAt,
    newRecord,
    creditsSecured: result.creditsSecured ?? 0,
    componentsSecured: result.componentsSecured ?? 0,
  });
  data.history = data.history.slice(0, HISTORY_LIMIT);
  data.activeRun = null;
  // Merchants restock after every completed operation.
  rotateMarket(data, result.endedAt);
  return true;
}

export function equippedItem(data: SaveData, slot: SlotId): ItemInstance | null {
  const uid = data.loadout[slot];
  return uid ? (data.items.find((i) => i.uid === uid) ?? null) : null;
}

export function storedItems(data: SaveData): ItemInstance[] {
  const byUid = new Map(data.items.map((i) => [i.uid, i]));
  return data.storage.uids.map((u) => byUid.get(u)!).filter(Boolean);
}

export function itemByUid(data: SaveData, uid: string | null | undefined): ItemInstance | null {
  return uid ? (data.items.find((i) => i.uid === uid) ?? null) : null;
}

export function equippedItems(data: SaveData): ItemInstance[] {
  return SLOT_IDS.map((s) => equippedItem(data, s)).filter((i): i is ItemInstance => !!i);
}

export function slotOf(data: SaveData, uid: string): SlotId | null {
  return SLOT_IDS.find((s) => data.loadout[s] === uid) ?? null;
}

export function storageOverCapacity(data: SaveData): boolean {
  return data.storage.uids.length > data.storage.capacity;
}

/** Deployment rules: a weapon equipped and storage within capacity. */
export function deployBlocker(data: SaveData): string | null {
  if (!fitsSlot(equippedItem(data, 'weapon'), 'weapon')) return 'No primary weapon equipped';
  if (storageOverCapacity(data)) return `Storage over capacity (${data.storage.uids.length}/${data.storage.capacity}): scrap items or expand storage`;
  return null;
}

/**
 * Equip a stored item (HQ only). The target slot defaults to an empty compatible slot;
 * the item it replaces goes to storage, so the item count in storage never grows.
 */
export function equipFromStorage(data: SaveData, uid: string, slot?: SlotId): boolean {
  if (data.activeRun) return false;
  const idx = data.storage.uids.indexOf(uid);
  const item = itemByUid(data, uid);
  if (idx < 0 || !item) return false;
  const target = slot ?? slotsFor(item.category).find((s) => !data.loadout[s]) ?? slotsFor(item.category)[0];
  if (!target || !fitsSlot(item, target)) return false;
  data.storage.uids.splice(idx, 1);
  const prev = data.loadout[target];
  if (prev) data.storage.uids.push(prev);
  data.loadout[target] = uid;
  return true;
}

/** Move an equipped item to storage (not allowed for required slots or a full store). */
export function unequipToStorage(data: SaveData, slot: SlotId): boolean {
  const uid = data.loadout[slot];
  if (data.activeRun || !uid || getSlot(slot).required || data.storage.uids.length >= data.storage.capacity) return false;
  data.loadout[slot] = null;
  data.storage.uids.push(uid);
  return true;
}

/**
 * Make the loadout match `slots` as far as the profile owns the items. Slots that are
 * absent are left alone; items that are not owned or do not fit are skipped. Displaced
 * items return to storage; an item is never in two places. Returns true if anything moved.
 */
export function applyLoadout(data: SaveData, slots: Partial<Record<SlotId, string | null>>, opts: { ignoreActiveRun?: boolean } = {}): boolean {
  if (data.activeRun && !opts.ignoreActiveRun) return false;
  let changed = false;
  const owned = new Set(data.items.map((i) => i.uid));
  for (const slot of SLOT_IDS) {
    if (!(slot in slots)) continue;
    const want = slots[slot] ?? null;
    if (data.loadout[slot] === want) continue;
    if (want === null) {
      if (getSlot(slot).required) continue;
      const cur = data.loadout[slot];
      if (cur) {
        data.storage.uids.push(cur);
        data.loadout[slot] = null;
        changed = true;
      }
      continue;
    }
    if (!owned.has(want) || !fitsSlot(itemByUid(data, want), slot)) continue;
    // Take it from wherever it is now (storage or another slot).
    const si = data.storage.uids.indexOf(want);
    if (si >= 0) data.storage.uids.splice(si, 1);
    const otherSlot = slotOf(data, want);
    if (otherSlot) data.loadout[otherSlot] = null;
    const cur = data.loadout[slot];
    if (cur) data.storage.uids.push(cur);
    data.loadout[slot] = want;
    changed = true;
  }
  return changed;
}

/** Store the current loadout in a preset. */
export function savePreset(data: SaveData, index: number, name?: string): boolean {
  const p = data.presets[index];
  if (!p || data.activeRun) return false;
  p.slots = { ...data.loadout };
  if (name) p.name = name.slice(0, 20);
  return true;
}

/** Equip a preset. Items it references that are no longer owned are skipped. */
export function loadPreset(data: SaveData, index: number): boolean {
  const p = data.presets[index];
  if (!p || data.activeRun) return false;
  if (!Object.values(p.slots).some(Boolean)) return false;
  return applyLoadout(data, p.slots);
}

/**
 * Dismantle a stored (not equipped) item for salvage. Presets referencing it are cleared.
 * Modules installed in a scrapped weapon are returned to storage (never destroyed).
 */
export function scrapItem(data: SaveData, uid: string): number {
  if (data.activeRun) return 0;
  const idx = data.storage.uids.indexOf(uid);
  const item = itemByUid(data, uid);
  if (idx < 0 || !item || slotOf(data, uid) || item.locked) return 0;
  const y = dismantleYield(item);
  const value = y.salvage;
  data.resources.components += y.components;
  data.economy.stats.itemsDismantled++;
  data.storage.uids.splice(idx, 1);
  data.items = data.items.filter((i) => i.uid !== uid);
  for (const m of item.socketed ?? []) {
    if (!m) continue;
    data.items.push(m);
    data.storage.uids.push(m.uid);
  }
  for (const p of data.presets) for (const s of SLOT_IDS) if (p.slots[s] === uid) p.slots[s] = null;
  data.resources.salvage += value;
  data.totals.itemsScrapped++;
  return value;
}

/** Buy more storage bays with salvage (first salvage sink). */
export function expandStorage(data: SaveData): boolean {
  const cost = storageExpansionCost(data.storage.expansions);
  if (data.activeRun || data.resources.salvage < cost) return false;
  data.resources.salvage -= cost;
  data.storage.expansions++;
  data.storage.capacity = STORAGE_CAPACITY + data.storage.expansions * STORAGE_EXPANSION;
  return true;
}

// ------------------------------------------------------------------ weapon engineering (M3)

export type EngineeringResult = { ok: true; cost: number } | { ok: false; reason: string };

/** An owned weapon (equipped or stored). Engineering never touches run cargo. */
function ownedWeapon(data: SaveData, uid: string): ItemInstance | null {
  const it = itemByUid(data, uid);
  return it && it.category === 'weapon' && (data.storage.uids.includes(uid) || slotOf(data, uid)) ? it : null;
}

/**
 * Install a stored module into a socket of an owned weapon (HQ only, free). The module
 * leaves storage and the item list and lives inside the weapon from then on. Everything
 * is validated before anything changes.
 */
export function installModule(data: SaveData, weaponUid: string, socket: number, moduleUid: string): EngineeringResult {
  if (data.activeRun) return { ok: false, reason: 'Engineering is only available at HQ between runs' };
  const weapon = ownedWeapon(data, weaponUid);
  if (!weapon) return { ok: false, reason: 'Weapon not owned' };
  const mi = data.storage.uids.indexOf(moduleUid);
  const module = itemByUid(data, moduleUid);
  if (mi < 0 || !module) return { ok: false, reason: 'Module not in storage' };
  const check = canInstall(weapon, socket, module);
  if (!check.ok) return check;
  data.storage.uids.splice(mi, 1);
  data.items = data.items.filter((i) => i.uid !== moduleUid);
  weapon.socketed[socket] = module;
  return { ok: true, cost: 0 };
}

/** Salvage cost of removing the module in a socket (null when the socket is empty). */
export function moduleRemovalCost(data: SaveData, weaponUid: string, socket: number): number | null {
  const m = itemByUid(data, weaponUid)?.socketed?.[socket];
  return m ? removalCost(m) : null;
}

/** Pull an installed module back into storage for salvage (needs a free storage bay). */
export function uninstallModule(data: SaveData, weaponUid: string, socket: number): EngineeringResult {
  if (data.activeRun) return { ok: false, reason: 'Engineering is only available at HQ between runs' };
  const weapon = ownedWeapon(data, weaponUid);
  const m = weapon?.socketed?.[socket];
  if (!weapon || !m) return { ok: false, reason: 'Socket is empty' };
  const cost = removalCost(m);
  if (data.resources.salvage < cost) return { ok: false, reason: `Needs ${cost} salvage` };
  if (data.storage.uids.length >= data.storage.capacity) return { ok: false, reason: 'Storage full' };
  if (data.items.some((i) => i.uid === m.uid)) return { ok: false, reason: 'Duplicate module id' };
  data.resources.salvage -= cost;
  weapon.socketed[socket] = null;
  data.items.push(m);
  data.storage.uids.push(m.uid);
  return { ok: true, cost };
}

/**
 * Move an installed module straight into a socket of another (or the same) owned weapon.
 * Costs the same as a removal; needs no free storage bay. Validated before any change.
 */
export function transferModule(data: SaveData, fromUid: string, fromSocket: number, toUid: string, toSocket: number): EngineeringResult {
  if (data.activeRun) return { ok: false, reason: 'Engineering is only available at HQ between runs' };
  const from = ownedWeapon(data, fromUid);
  const to = ownedWeapon(data, toUid);
  const m = from?.socketed?.[fromSocket];
  if (!from || !to || !m) return { ok: false, reason: 'Nothing to transfer' };
  if (from === to && fromSocket === toSocket) return { ok: false, reason: 'Same socket' };
  // Check against the target as if the module had already left its socket.
  const probe: ItemInstance = { ...to, socketed: to.socketed.map((x) => (x?.uid === m.uid ? null : x)) };
  const check = canInstall(probe, toSocket, m);
  if (!check.ok) return check;
  const cost = removalCost(m);
  if (data.resources.salvage < cost) return { ok: false, reason: `Needs ${cost} salvage` };
  data.resources.salvage -= cost;
  from.socketed[fromSocket] = null;
  to.socketed[toSocket] = m;
  return { ok: true, cost };
}

/** Every uid owned by the profile, including installed modules (duplicate detection). */
export function allOwnedUids(data: SaveData): string[] {
  const out: string[] = [];
  for (const it of data.items) {
    out.push(it.uid);
    for (const m of it.socketed ?? []) if (m) out.push(m.uid);
  }
  return out;
}

export { isSlotId };
