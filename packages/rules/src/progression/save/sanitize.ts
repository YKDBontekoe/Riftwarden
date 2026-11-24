import { rolloverSeason } from '../seasons';
import { PINNACLE, sanitizeCodex } from '../spikes';
import { sanitizeMastery } from '../mastery';
import { ALL_LOOT_LOCKS } from '../unlocks';
import { sanitizeMapState } from '../../runmap/state';
import { isDamageElement } from '../../combat/elements';
import { SURVEY_DESK } from '../../home/layout';
import { furnitureOccupied, coreCell, connectedFloors, edgeCells, cellKey, emptyStructure, inBounds, isMovableStation, parseCell, type StationPose, type Structure } from '../../home/build/model';
import { pieceDef } from '../../home/build/catalog';
import { rollSignature, signatureDef } from '../../loot/signatures';
import { TECH_LIST, techKey } from '../../towers/components';
import { ACCENTS, type Placeable, PLACEABLE_BOUNDS, PROP_TYPES, type PropType, type PropValue } from '../../home/placeables';
import { isStatKey, type StatOp } from '../../combat/stats';
import { affixDef } from '../../loot/affixes';
import { baseDef } from '../../loot/bases';
import { STORAGE_EXPANSION } from '../../loot/economy';
import { clampLevel, generateItem, hashSeed, starterWeapon } from '../../loot/generate';
import { isRarity, rarity } from '../../loot/rarity';
import { uniqueDef } from '../../loot/uniques';
import { CATEGORIES, type Category, type RolledAffix, type RolledStat } from '../../loot/types';
import { fitsSlot, type ItemInstance, newUid, SLOT_IDS } from '../items';
import { defaultBuild, FAMILIES, isValidBuild, socketKinds, type Finish, type SocketKind, type WeaponBuild } from '../../weapons/build';
import { canInstall } from '../../weapons/modules';
import type { WeaponFamily } from '../../data/defs';
import { MAX_BALANCE, MAX_ENHANCE_ANY, MARKET } from '../../economy/config';
import { generateMarket, type MarketEntry, type MarketState } from '../../economy/market';
import { ANNEX_BAYS, EconomyState, EconomyStats, HISTORY_LIMIT, HistoryOutcome, PRESET_COUNT, RunHistoryEntry, SAVE_VERSION, STORAGE_CAPACITY, SaveData, TX_HISTORY, TierRecord, emptyEconomy, emptyProgress, MAX_XP, type ProgressState } from './types';
import { levelForXp } from '../level';
import { pruneAllocation } from '../skilltree';

import { DEFAULT_FACILITIES, createDefaultSave, defaultPresets, emptyLoadout, facilityCount, marketProgress } from './defaults';
import { MAX_TIER, arr, int, num, obj, str } from './coerce';
import { allOwnedUids } from './ownership';

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
    // M6 (same key order as emptyRecord, so a reloaded save serializes identically)
    highestWave: int(r.highestWave, int(r.bestWave, 0)),
    bossesDefeated: int(r.bossesDefeated, 0),
    elitesDefeated: int(r.elitesDefeated, 0),
    bestBossesRun: int(r.bestBossesRun, 0),
    bestPlayerDamage: num(r.bestPlayerDamage, 0, 0, 1e300),
    bestTowerDamage: num(r.bestTowerDamage, 0, 0, 1e300),
    deaths: int(r.deaths, 0),
    itemsBanked: int(r.itemsBanked, 0),
    deepestAct: int(r.deepestAct, 0),
    bestNodes: int(r.bestNodes, 0),
    actsCleared: int(r.actsCleared, 0),
    survivalRuns: int(r.survivalRuns, 0),
    survivalBestWave: int(r.survivalBestWave, 0),
    survivalBestNodes: int(r.survivalBestNodes, 0),
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

const FINISH_IDS: Finish[] = ['arctic', 'gunmetal', 'sand', 'slate', 'gilded', 'iridescent', 'ascended'];
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
    signature: typeof r.signature === 'string' && signatureDef(r.signature) ? r.signature : null,
    seed: int(r.seed, 0, 0, 0xffffffff),
    gen: int(r.gen, 1, 0, 1000),
  };
  // Hand-made unique: only a known id on its own base keeps the identity.
  if (typeof r.uniqueId === 'string' && uniqueDef(r.uniqueId)?.baseId === defId) item.uniqueId = r.uniqueId;
  // M4 engineering state (only stored when set).
  if (r.locked === true) item.locked = true;
  const enh = int(r.enhance, 0, 0, MAX_ENHANCE_ANY);
  if (enh > 0) item.enhance = Math.min(enh, [4, 6, 8, 10, 12, 15, 18][rarity(item.rarity).index]);
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
      opt('drones', 1, 12);
      opt('seekCone', 0.02, 1);
      opt('splash', 0.5, 12);
      opt('spray', 0.02, 1);
      opt('targets', 1, 8);
      if (isDamageElement(w.element)) item.weapon.element = w.element;
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
  // M7: legendary/exotic weapons from before signatures receive theirs (deterministic from uid + seed).
  if (!item.signature) item.signature = rollSignature(item);
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
    bosses: arr(r.bosses).filter((x): x is string => typeof x === 'string').slice(0, 64).map((x) => x.slice(0, 40)),
    elites: int(r.elites, 0),
    deaths: int(r.deaths, 0),
    reactorDamage: num(r.reactorDamage, 0, 0, 1e300),
    playerDamage: num(r.playerDamage, 0, 0, 1e300),
    towerDamage: num(r.towerDamage, 0, 0, 1e300),
    itemsCollected: int(r.itemsCollected, 0),
    events: int(r.events, 0),
    milestones: arr(r.milestones).filter((x): x is string => typeof x === 'string').slice(0, 32),
    records: arr(r.records).filter((x): x is string => typeof x === 'string').slice(0, 16),
    dev: r.dev === true,
    ...(r.mode === 'survival' ? { mode: 'survival' as const } : {}),
    // Run map fields only on map-mode runs (older entries serialize unchanged).
    ...(typeof r.act === 'number' && r.act > 0 ? { act: int(r.act, 1, 1), nodes: int(r.nodes, 0), path: arr(r.path).filter((x): x is string => typeof x === 'string').slice(0, 120).map((x) => x.slice(0, 8)) } : {}),
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
  const hv = obj(r.heavy);
  if (typeof hv.rotation === 'number' && typeof hv.n === 'number') e.heavy = { rotation: int(hv.rotation, 0), n: int(hv.n, 0, 0, 1000) };
  const st = obj(r.stats);
  for (const k of Object.keys(e.stats) as (keyof EconomyStats)[]) e.stats[k] = int(st[k], 0);
  return e;
}

/**
 * Validate an arbitrary object into a consistent SaveData. Never throws.
 * `repairs` lists the fixes applied (useful for diagnostics/tests).
 */
export function sanitizeSave(raw: unknown, now = Date.now(), nested = false): { data: SaveData; repairs: string[] } {
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
      shards: int(obj(r.resources).shards, 0, 0, MAX_BALANCE),
    },
    items: [],
    storage: { capacity: STORAGE_CAPACITY, expansions: int(obj(r.storage).expansions, 0, 0, 1000), uids: [] },
    loadout: emptyLoadout(),
    presets: defaultPresets(),
    threat: { selected: 1, unlocked: 1 },
    records: {},
    totals: { ...def.totals },
    milestones: arr(r.milestones).filter((x): x is string => typeof x === 'string').slice(0, 64),
    history: [],
    activeRun: null,
    base: { layoutVersion: 2, placeables: [], facilities: [], structure: emptyStructure(), stations: {}, blueprints: [], owned: {} },
    tutorial: { done: [], skipped: false },
    market: def.market,
    economy: emptyEconomy(),
    towers: { unlocked: sanitizeTowerTech(obj(r.towers).unlocked) },
    progress: emptyProgress(''),
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
  // A run needs a primary weapon: promote the secondary, equip a stored one or issue the starter.
  if (!data.loadout.weapon && data.loadout.weapon2) {
    data.loadout.weapon = data.loadout.weapon2;
    data.loadout.weapon2 = null;
    repairs.push('promoted secondary weapon');
  }
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
  for (const k of Object.keys(data.totals) as (keyof SaveData['totals'])[]) {
    const big = k === 'playerDamage' || k === 'towerDamage' || k === 'reactorDamage';
    data.totals[k] = k === 'bestRarity' ? int(t[k], -1, -1, 5) : big ? num(t[k], 0, 0, 1e300) : int(t[k], 0);
  }
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
    const map = sanitizeMapState(ar.map);
    if (map) {
      data.activeRun.map = map;
      data.activeRun.nodeBank = int(ar.nodeBank, 0);
    }
    if (ar.mode === 'survival') data.activeRun.mode = 'survival';
    const locks = arr(ar.locks).filter((x): x is string => typeof x === 'string' && ALL_LOOT_LOCKS.includes(x));
    if (locks.length) data.activeRun.locks = [...new Set(locks)].sort();
    if (ar.pinnacle === true) data.activeRun.pinnacle = true;
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
  data.base.layoutVersion = 2;
  data.storage.capacity = STORAGE_CAPACITY + data.storage.expansions * STORAGE_EXPANSION + facilityCount(data, 'storageAnnex') * ANNEX_BAYS;
  data.base.structure = sanitizeStructure(base.structure);
  data.base.stations = sanitizeStations(base.stations);
  if (!data.base.stations.command && furnitureOccupied(SURVEY_DESK, data.base.placeables, data.base.stations)) {
    data.base.stations.command = { x: 0, z: 0, yaw: 0 };
  }
  data.base.blueprints = [...new Set(arr(base.blueprints).filter((b): b is string => typeof b === 'string' && pieceDef(b)?.unlock.by === 'merchant'))];
  data.base.owned = {};
  for (const [k, v] of Object.entries(obj(base.owned))) if (pieceDef(k)?.owned) data.base.owned[k] = int(v, 0, 0, 99);
  const tut = obj(r.tutorial);
  data.tutorial = { done: [...new Set(arr(tut.done).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 24)))].slice(0, 40), skipped: tut.skipped === true };
  const fac = arr(base.facilities).filter((f): f is string => typeof f === 'string');
  data.base.facilities = fac.length ? [...new Set([...DEFAULT_FACILITIES, ...fac])] : [...DEFAULT_FACILITIES];

  data.market = sanitizeMarket(r.market, data, new Set(allOwnedUids(data)), repairs, now);
  data.economy = sanitizeEconomy(r.economy);
  data.progress = sanitizeProgress(r.progress, data.profile.id);
  const codex = sanitizeCodex(r.codex);
  if (codex.length) data.codex = codex;
  const bt = arr(r.breakthroughs).filter((x): x is number => Number.isInteger(x) && (x as number) >= 5 && (x as number) % 5 === 0 && (x as number) <= MAX_TIER);
  if (bt.length) data.breakthroughs = [...new Set(bt)].sort((x, y) => x - y);
  const pn = obj(r.pinnacle);
  if (Object.keys(pn).length) data.pinnacle = { keys: int(pn.keys, 0, 0, PINNACLE.maxKeys), runs: int(pn.runs, 0, 0) };
  const war = obj(r.war);
  const ks = (v: unknown) => [...new Set(arr(v).filter((x): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 100_000))].slice(0, 500);
  if (Object.keys(war).length) data.war = { fought: ks(war.fought), claimed: ks(war.claimed) };
  sanitizeSeasons(data, r, now, nested);
  const w = obj(r.wiped);
  if (typeof w.from === 'number' && typeof w.at === 'number') data.wiped = { from: int(w.from, 0, 0, 1000), at: num(w.at, 0, 0) };

  return { data, repairs };
}

/** Keep only known, researchable blueprints (unknown ids are dropped, duplicates removed). */
export function sanitizeTowerTech(v: unknown): string[] {
  const valid = new Set(TECH_LIST.map((t) => techKey(t.slot, t.id)));
  const out: string[] = [];
  for (const k of arr(v)) if (typeof k === 'string' && valid.has(k) && !out.includes(k)) out.push(k);
  return out;
}


/** Structure: known piece ids on valid, in-bounds, non-core keys only (anything else is dropped). */
function sanitizeStructure(v: unknown): Structure {
  const r = obj(v);
  const out = emptyStructure();
  const cellOk = (k: string) => /^-?\d+,-?\d+$/.test(k) && (() => {
    const [i, j] = parseCell(k);
    return inBounds(i, j) && !coreCell(i, j);
  })();
  for (const [k, t] of Object.entries(obj(r.floors))) if (cellOk(k) && pieceDef(t as string)?.kind === 'floor') out.floors[k] = t as string;
  for (const [k, t] of Object.entries(obj(r.ceilings))) if (out.floors[k] && pieceDef(t as string)?.kind === 'ceiling') out.ceilings[k] = t as string;
  for (const [k, t] of Object.entries(obj(r.edges))) {
    if (!/^-?\d+,-?\d+,[ne]$/.test(k) || pieceDef(t as string)?.kind !== 'edge') continue;
    const [a, b] = edgeCells(k);
    if (out.floors[cellKey(...a)] || out.floors[cellKey(...b)]) out.edges[k] = t as string;
  }
  for (const [k, t] of Object.entries(obj(r.pillars))) if (/^-?\d+,-?\d+$/.test(k) && pieceDef(t as string)?.kind === 'pillar') out.pillars[k] = t as string;
  // Floating modules (not connected to a gateway) cannot exist: drop them.
  const conn = connectedFloors(out);
  for (const k of Object.keys(out.floors)) if (!conn.has(k)) delete out.floors[k];
  return out;
}

function sanitizeStations(v: unknown): Record<string, StationPose> {
  const out: Record<string, StationPose> = {};
  for (const [k, p] of Object.entries(obj(v))) {
    if (!isMovableStation(k)) continue;
    const o = obj(p);
    if (typeof o.x !== 'number' || typeof o.z !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    out[k] = { x: num(o.x, 0, -92, 92), z: num(o.z, 0, -50, 50), yaw: num(o.yaw, 0, -Math.PI * 4, Math.PI * 4) };
  }
  return out;
}


/** XP and tree allocation; allocations are de-duplicated and pruned by the tree rules (see skilltree.ts). */
export function sanitizeProgress(raw: unknown, profileId: string): ProgressState {
  const p = obj(raw);
  const tree = obj(p.tree);
  const out = emptyProgress(profileId, int(p.xp, 0, 0, MAX_XP));
  if (typeof tree.seed === 'number' && Number.isInteger(tree.seed) && tree.seed >= 0 && tree.seed <= 0xffffffff) out.tree.seed = tree.seed;
  out.tree.allocated = [...new Set(arr(tree.allocated).filter((x): x is string => typeof x === 'string' && x.length <= 24))].slice(0, 2000);
  out.respecs = int(p.respecs, 0, 0, 10_000);
  out.tree.allocated = pruneAllocation(out.tree.seed, levelForXp(out.xp), out.tree.allocated);
  const mastery = sanitizeMastery(p.mastery);
  if (mastery) out.mastery = mastery;
  return out;
}

/** Seasonal fields: the season marker, the running seasonal document (sanitized as a nested save), archives and the
 * board summary; then the end-of-month rollover (deterministic for `now`). */
function sanitizeSeasons(data: SaveData, r: Record<string, unknown>, now: number, nested: boolean): void {
  if (Number.isInteger(r.seasonId) && (r.seasonId as number) >= 1) data.seasonId = r.seasonId as number;
  const b = obj(r.board);
  if (typeof b.rl === 'number') data.board = { rl: int(b.rl, 1, 1, MAX_TIER), wave: int(b.wave, 0, 0, 1e6), waveRl: int(b.waveRl, 0, 0, MAX_TIER), at: num(b.at, 0, 0) };
  const done = arr(r.seasonsDone).map(obj).filter((x) => Number.isInteger(x.id));
  if (done.length) data.seasonsDone = done.slice(-60).map((x) => ({ id: int(x.id, 1, 1), rl: int(x.rl, 1, 1, MAX_TIER), wave: int(x.wave, 0, 0, 1e6), journey: int(x.journey, 0, 0, 100), title: typeof x.title === 'string' ? x.title.slice(0, 40) : null }));
  if (nested || data.seasonId) return;
  const sz = obj(r.seasonal);
  if (Number.isInteger(sz.id) && (sz.id as number) >= 1 && sz.doc && typeof sz.doc === 'object') {
    const doc = sanitizeSave(sz.doc, now, true).data;
    doc.seasonId = sz.id as number;
    data.seasonal = { id: sz.id as number, doc };
  }
  rolloverSeason(data, now);
}
