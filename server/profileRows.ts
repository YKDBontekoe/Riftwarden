import type { ItemInstance, RolledAffix, RolledStat } from '../src/loot/types';
import { emptyLoadout, type SaveData, type TierRecord } from '../src/progression/save';
import type { SlotId } from '../src/progression/items';

const tables = [
  'profile_totals', 'profile_economy_stats', 'profile_tier_records', 'profile_active_runs', 'profile_run_history',
  'profile_items', 'profile_item_stats', 'profile_weapon_rolls', 'profile_weapon_builds', 'profile_item_modules',
  'profile_presets', 'profile_market_exchange', 'profile_hq_placeables', 'profile_hq_placeable_properties',
  'profile_hq_structure', 'profile_hq_stations', 'profile_hq_owned',
] as const;

type Row = Record<string, unknown>;
type Table = typeof tables[number];
type Relations = Record<Table, Row[]>;

type ItemRow = Omit<ItemInstance, 'base' | 'affixes' | 'weapon' | 'build' | 'module' | 'socketed'> & {
  itemKey: string;
  scope: 'owned' | 'equipment' | 'modules' | 'socket';
  parentKey?: string;
  position: number;
  storagePosition?: number;
  equippedSlot?: SlotId;
  offerId?: string;
  sold?: boolean;
  featured?: boolean;
};

type Header = ReturnType<typeof profileHeader> & { revision: number };

export const profileTables = tables;
export const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
const camelCase = (key: string): string => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
// PostgreSQL JSON is row transport only. Numeric SQL columns arrive as JSON numbers (including bigint).
export function encodeRows(rows: Row[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [snakeCase(k), v]))));
}

function columns<T>(raw: Row): T {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'player_id').map(([k, v]) => [camelCase(k), v])) as T;
}

const optional = <T>(value: T | null): T | undefined => value ?? undefined;
const positioned = <T extends { position: number }>(rows: T[]): T[] => rows.sort((a, b) => a.position - b.position);
const structureKinds = ['floors', 'edges', 'ceilings', 'pillars'] as const;

export function profileHeader(d: SaveData) {
  return {
    version: d.version, saveId: d.profile.id, callsign: d.profile.callsign,
    createdAt: d.profile.createdAt, lastSavedAt: d.profile.lastSavedAt,
    ...d.resources, storageCapacity: d.storage.capacity, storageExpansions: d.storage.expansions,
    selectedTier: d.threat.selected, unlockedTier: d.threat.unlocked, layoutVersion: d.base.layoutVersion,
    tutorialSkipped: d.tutorial.skipped, marketRotation: d.market.rotation, marketGeneratedAt: d.market.generatedAt,
    marketRefreshes: d.market.refreshes, crafts: d.economy.crafts,
    milestones: d.milestones, facilities: d.base.facilities, blueprints: d.base.blueprints,
    tutorialSteps: d.tutorial.done, towerUnlocks: d.towers.unlocked, transactionIds: d.economy.tx,
  };
}

export function profileRelations(d: SaveData): Relations {
  const rows: Relations = {
    profile_totals: [d.totals],
    profile_economy_stats: [{ ...d.economy.stats }],
    profile_tier_records: Object.entries(d.records).map(([tier, record]) => ({ tier: Number(tier), ...record })),
    profile_active_runs: d.activeRun ? [{ ...d.activeRun }] : [],
    profile_run_history: d.history.map((entry, position) => ({ ...entry, position })),
    profile_items: [],
    profile_item_stats: [],
    profile_weapon_rolls: [],
    profile_weapon_builds: [],
    profile_item_modules: [],
    profile_presets: d.presets.map(({ name, slots }, position) => ({ position, name, ...slots })),
    profile_market_exchange: d.market.exchange.map(({ id, left }, position) => ({ position, id, quantity: left })),
    profile_hq_placeables: d.base.placeables.map(({ position: [x, y, z], props: _props, ...piece }, position) => ({ ...piece, position, x, y, z })),
    profile_hq_placeable_properties: d.base.placeables.flatMap(({ uid, props }) => Object.entries(props).map(([property, value]) => ({
      uid, property,
      textValue: typeof value === 'string' ? value : null,
      numberValue: typeof value === 'number' ? value : null,
      booleanValue: typeof value === 'boolean' ? value : null,
    }))),
    profile_hq_structure: structureKinds.flatMap((kind) => Object.entries(d.base.structure[kind]).map(([gridKey, piece]) => ({ kind, gridKey, piece }))),
    profile_hq_stations: Object.entries(d.base.stations).map(([station, pose]) => ({ station, ...pose })),
    profile_hq_owned: Object.entries(d.base.owned).map(([piece, quantity]) => ({ piece, quantity })),
  };

  function itemRows(item: ItemInstance, location: Pick<ItemRow, 'scope' | 'position' | 'parentKey' | 'storagePosition' | 'equippedSlot' | 'offerId' | 'sold' | 'featured'>): void {
    const { base, affixes, weapon, build, module, socketed, ...itemColumns } = item;
    const itemKey = `${location.parentKey ?? location.scope}/${location.position}`;
    rows.profile_items.push({ itemKey, ...location, ...itemColumns });
    base.forEach((stat, position) => rows.profile_item_stats.push({ itemKey, position, kind: 'base', ...stat }));
    affixes.forEach((stat, position) => rows.profile_item_stats.push({ itemKey, position, kind: 'affix', ...stat }));
    if (weapon) rows.profile_weapon_rolls.push({ itemKey, ...weapon });
    if (build) {
      const { params, ...fields } = build;
      rows.profile_weapon_builds.push({ itemKey, ...fields, ...params });
    }
    if (module) rows.profile_item_modules.push({ itemKey, ...module });
    socketed.forEach((child, position) => {
      if (child) itemRows(child, { scope: 'socket', parentKey: itemKey, position });
    });
  }

  const storage = new Map(d.storage.uids.map((uid, position) => [uid, position]));
  const equipped = new Map(Object.entries(d.loadout).map(([slot, uid]) => [uid, slot as SlotId]));
  d.items.forEach((item, position) => itemRows(item, {
    scope: 'owned', position, storagePosition: storage.get(item.uid), equippedSlot: equipped.get(item.uid),
  }));
  for (const scope of ['equipment', 'modules'] as const) {
    d.market[scope].forEach(({ id, item, sold, featured }, position) => itemRows(item, { scope, position, offerId: id, sold, featured }));
  }
  return rows;
}

function readItems(rows: Relations) {
  const byKey = new Map<string, ItemInstance>();
  const entries = rows.profile_items.map((row) => columns<ItemRow>(row));
  for (const row of entries) {
    const { uid, defId, acquiredAt, source, category, level, rarity, name, sockets, signature, seed, gen } = row;
    byKey.set(row.itemKey, {
      uid, defId, acquiredAt, source, category, level, rarity, name, sockets, signature, seed, gen,
      locked: optional(row.locked), enhance: optional(row.enhance), rerolls: optional(row.rerolls), mods: optional(row.mods),
      base: [], affixes: [], socketed: Array.from({ length: sockets }, () => null),
    });
  }
  for (const row of positioned(rows.profile_item_stats.map((raw) => columns<RolledAffix & { itemKey: string; position: number; kind: string }>(raw)))) {
    const { stat, op, value } = row;
    const item = byKey.get(row.itemKey)!;
    if (row.kind === 'base') item.base.push({ stat, op, value } satisfies RolledStat);
    else item.affixes.push({ id: row.id, stat, op, value, tier: row.tier, roll: row.roll, locked: optional(row.locked) });
  }
  for (const raw of rows.profile_weapon_rolls) {
    type Weapon = NonNullable<ItemInstance['weapon']>;
    const { itemKey, range, accuracy, pierce, chargeTime, beamWidth, rampMax, ...required } = columns<{ itemKey: string } & Weapon>(raw);
    byKey.get(itemKey)!.weapon = {
      ...required, range: optional(range), accuracy: optional(accuracy), pierce: optional(pierce),
      chargeTime: optional(chargeTime), beamWidth: optional(beamWidth), rampMax: optional(rampMax),
    };
  }
  for (const raw of rows.profile_weapon_builds) {
    type Build = NonNullable<ItemInstance['build']>;
    const { itemKey, length, bulk, hue, ...fields } = columns<Omit<Build, 'params'> & Build['params'] & { itemKey: string }>(raw);
    byKey.get(itemKey)!.build = { ...fields, params: { length, bulk, hue } };
  }
  for (const raw of rows.profile_item_modules) {
    const { itemKey, ...fields } = columns<NonNullable<ItemInstance['module']> & { itemKey: string }>(raw);
    byKey.get(itemKey)!.module = fields;
  }
  const items: ItemInstance[] = [];
  const storage: { uid: string; position: number }[] = [];
  const loadout = emptyLoadout();
  const stock: Pick<SaveData['market'], 'equipment' | 'modules'> = { equipment: [], modules: [] };
  for (const row of positioned(entries)) {
    const item = byKey.get(row.itemKey)!;
    if (row.scope === 'socket') byKey.get(row.parentKey!)!.socketed[row.position] = item;
    else if (row.scope === 'owned') {
      items.push(item);
      if (row.equippedSlot) loadout[row.equippedSlot] = item.uid;
      else storage.push({ uid: item.uid, position: row.storagePosition! });
    } else stock[row.scope].push({ id: row.offerId!, item, sold: row.sold!, featured: row.featured! });
  }
  return { items, loadout, stock, storageUids: positioned(storage).map((row) => row.uid) };
}

export function readProfile(headerColumns: Row, rows: Relations): { data: SaveData; revision: number } {
  const h = columns<Header>(headerColumns);
  const { items, loadout, stock, storageUids } = readItems(rows);
  const structure = { floors: {}, edges: {}, ceilings: {}, pillars: {} } as SaveData['base']['structure'];
  for (const raw of rows.profile_hq_structure) {
    const { kind, gridKey, piece } = columns<{ kind: keyof typeof structure; gridKey: string; piece: string }>(raw);
    structure[kind][gridKey] = piece;
  }
  type Placeable = SaveData['base']['placeables'][number];
  type PropValue = Placeable['props'][string];
  const props = new Map<string, [string, PropValue][]>();
  for (const raw of rows.profile_hq_placeable_properties) {
    const { uid, property, textValue, numberValue, booleanValue } = columns<{
      uid: string; property: string; textValue: string | null; numberValue: number | null; booleanValue: boolean | null;
    }>(raw);
    const entries = props.get(uid) ?? [];
    entries.push([property, (textValue ?? numberValue ?? booleanValue)!]);
    props.set(uid, entries);
  }
  return {
    revision: h.revision,
    data: {
      version: h.version,
      profile: { id: h.saveId, callsign: h.callsign, createdAt: h.createdAt, lastSavedAt: h.lastSavedAt },
      resources: { salvage: h.salvage, credits: h.credits, components: h.components },
      items, loadout,
      storage: { capacity: h.storageCapacity, expansions: h.storageExpansions, uids: storageUids },
      presets: positioned(rows.profile_presets.map((raw) => columns<{ position: number; name: string } & SaveData['loadout']>(raw)))
        .map(({ position: _position, name, ...slots }) => ({ name, slots })),
      threat: { selected: h.selectedTier, unlocked: h.unlockedTier },
      records: Object.fromEntries(rows.profile_tier_records.map((raw) => {
        const { tier, ...record } = columns<TierRecord & { tier: number }>(raw);
        return [tier, record];
      })),
      totals: columns<SaveData['totals']>(rows.profile_totals[0]),
      milestones: h.milestones,
      history: positioned(rows.profile_run_history.map((raw) => columns<SaveData['history'][number] & { position: number }>(raw)))
        .map(({ position: _position, ...entry }) => entry),
      activeRun: rows.profile_active_runs[0] ? columns<SaveData['activeRun']>(rows.profile_active_runs[0]) : null,
      base: {
        layoutVersion: h.layoutVersion, structure, facilities: h.facilities, blueprints: h.blueprints,
        placeables: positioned(rows.profile_hq_placeables.map((raw) => columns<Omit<Placeable, 'position' | 'props'> & { position: number; x: number; y: number; z: number }>(raw)))
          .map(({ position: _position, x, y, z, ...piece }) => ({ ...piece, position: [x, y, z], props: Object.fromEntries(props.get(piece.uid) ?? []) })),
        stations: Object.fromEntries(rows.profile_hq_stations.map((raw) => {
          const { station, ...pose } = columns<SaveData['base']['stations'][string] & { station: string }>(raw);
          return [station, pose];
        })),
        owned: Object.fromEntries(rows.profile_hq_owned.map((raw) => {
          const { piece, quantity } = columns<{ piece: string; quantity: number }>(raw);
          return [piece, quantity];
        })),
      },
      tutorial: { done: h.tutorialSteps, skipped: h.tutorialSkipped },
      market: {
        ...stock, rotation: h.marketRotation, generatedAt: h.marketGeneratedAt, refreshes: h.marketRefreshes,
        exchange: positioned(rows.profile_market_exchange.map((raw) => columns<{ position: number; id: string; quantity: number }>(raw)))
          .map(({ id, quantity }) => ({ id, left: quantity })),
      },
      economy: { tx: h.transactionIds, crafts: h.crafts, stats: columns<SaveData['economy']['stats']>(rows.profile_economy_stats[0]) },
      towers: { unlocked: h.towerUnlocks },
    },
  };
}

export type { Relations, Row };
