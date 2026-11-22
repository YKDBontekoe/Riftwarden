import type { CurrencyKey } from '@riftwarden/rules/economy/currencies';
import type { Category } from '@riftwarden/rules/loot/types';
import type { NodeKind } from '@riftwarden/rules/runmap/defs';
import type { TerminalId } from '@riftwarden/game/ui/store';

const PATHS = {
  balanced: 'M12 3v18M4 7h16M7 7l-4 7h8zM17 7l-4 7h8zM8 21h8',
  firepower: 'M12 2v5m0 10v5M2 12h5m10 0h5M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-7h.01',
  survivability: 'm12 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6zM8 12h8m-4-4v8',
  towers: 'M4 21h16m-12 0 2-6m6 6-2-6M7 15h10l2-4-3-5H8l-3 5zM12 6V3h9',
  mobility: 'm3 7 5 5-5 5m6-10 5 5-5 5m6-10 5 5-5 5',
  boss: 'm3 8 4 3 5-7 5 7 4-3-2 11H5zM8 19v-4m8 4v-4M12 19v-4',
  elite: 'm12 3 8 6-3 9-5 3-5-3-3-9zM7 10l5 4 5-4',
  cache: 'M4 8h16l2 4v8H2v-8zM2 12h20m-12 0v3h4v-3M8 8V5h8v3',
  courier: 'M3 9h4l3 3h4l3-3h4M4 14l5 2h6l5-2M9 12v4m6-4v4m-3 0v4',
  enemy: 'm6 8 3-4h6l3 4v9l-6 3-6-3zM6 11H3m15 0h3M9 12h6m-6 4h6',
  deploy: 'm12 2 5 11-5 3-5-3zm-5 9-4 6 5-1m9-5 4 6-5-1m-6 2-1 4m3-4v4m2-4 1 4',
  command: 'M4 17h16l-3-5H7zm8-5V3M8 6l4-3 4 3M7 20h10',
  drone: 'm3 11 6-3 3 1 3-1 6 3-5 6H8zM9 12h6l-1 2h-4z',
  storage: 'M4 4h16v16H4zm0 5h16M4 15h16M9 7h6m-6 5h6m-6 6h6',
  workshop: 'm6 19 8-8a5 5 0 0 0 6-6l-3 3-2-2 3-3a5 5 0 0 0-6 6l-8 8 2 2z',
  forge: 'M3 9h18v2l-5 4h-2v4h3v2H7v-2h3v-4H8L3 11zm7-3 2-3 2 3',
  merchant: 'M4 4h16l2 6H2zm0 6v10h16V10m-11 10v-6h6v6m-7-8h8',
  modules: 'M6 6h12v12H6zm3 3h6v6H9zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
  salvage: 'm3 14 6-5 5 2 7-5v9l-6 4-6-1-6 2zm6-5V5l5-2 3 4m-3 4v4',
  architect: 'M3 21V3h18v18zm0-8h9V3m0 10h9m-6 0v8',
  lattice: 'm12 3 8 5v8l-8 5-8-5V8zm0 5 4 2v4l-4 2-4-2v-4zm0-5v5m8 0-4 2m4 6-4-2m-4 7v-5m-8 0 4-2M4 8l4 2',
  rest: 'M3 17V7m0 8h18v4H3m3-4v-4h5l3 4m0-4h5l2 4M7 7h5m-2.5-2.5v5',
  anomaly: 'm13 2-8 9h6l-1 11 9-12h-6zm6 1v4m-2-2h4M4 15v4m-2-2h4',
  vault: 'M3 3h18v18H3zm9 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 3v6M9 12h6',
  corrupt: 'm12 2 10 18H2zm0 6v5m0 3h.01',
  credits: 'm12 2 10 10-10 10L2 12zm0 5 5 5-5 5-5-5z',
  shards: 'm13 2 5 7-5 13-6-7zm0 0-1 12 6-5m-6 5 1 8',
  cores: 'm12 2 9 5v10l-9 5-9-5V7zm0 5 5 3v4l-5 3-5-3v-4z',
  xp: 'm4 20 8-8 8 8m-16-8 8-8 8 8',
  tactical: 'M13 2 4 14h7l-1 8 10-13h-7z',
  kinetic: 'm5 16 9-9 5 5-9 9zm3-3 5 5m1-11 5-2 2 2-2 5M3 12l5-5',
  thermal: 'M12 2c2 5 7 7 7 13a7 7 0 1 1-14 0c0-2 1-4 3-6l2 4c3-3 3-6 2-11zm-3 15c0 2 1 4 3 4s3-2 3-4c0-1-1-2-2-3l-1 3-2-1z',
  cryo: 'M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4m13 9-4 1 1 4m-13-5 4 1-1 4m13-9-4-1 1-4',
  corrosive: 'M12 3c3 4 7 8 7 12a7 7 0 1 1-14 0c0-4 4-8 7-12zm-4 12c0 2 1 3 3 4',
  void: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 3l3 3m12 12 3 3',
  briefing: 'M4 3h8l2 2 2-2h4v17h-7l-1 1-1-1H4zm8 2v15M7 8h3m-3 4h3m4-4h3m-3 4h3',
  coop: 'M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm10 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 20v-3a5 5 0 0 1 10 0v3m0 0v-3a5 5 0 0 1 10 0v3',
  settings: 'M5 3v18m7-18v18m7-18v18M2 8h6m1 8h6m1-10h6',
  controls: 'M3 6h18v12H3zm3 4h1m3 0h1m3 0h1m3 0h1M6 14h2m2 0h7',
  wave: 'M2 13h4l3-7 4 12 3-5h6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l4 2',
  pickup: 'M4 14h16v7H4zm8-11v8m-4-4 4 4 4-4',
  accessory: 'm12 3 8 9-8 9-8-9zm-6 9h12m-9 0 3 5 3-5',
} as const;

export type FieldIconName = keyof typeof PATHS;

export const NODE_ICON: Record<NodeKind, FieldIconName> = {
  combat: 'firepower', elite: 'elite', boss: 'boss', merchant: 'merchant', forge: 'forge',
  event: 'anomaly', vault: 'vault', rest: 'rest',
};

export const STATION_ICON: Record<TerminalId, FieldIconName> = {
  deploy: 'deploy', command: 'command', loadout: 'drone', storage: 'storage', workshop: 'workshop',
  fabricate: 'forge', merchant: 'merchant', modules: 'modules', salvage: 'salvage', architect: 'architect', lattice: 'lattice',
};

export const CURRENCY_ICON: Record<CurrencyKey, FieldIconName> = {
  credits: 'credits', salvage: 'salvage', components: 'modules', shards: 'shards', xp: 'xp', cores: 'cores', tactical: 'tactical',
};

export const ITEM_ICON: Record<Category, FieldIconName> = {
  weapon: 'firepower', armor: 'survivability', shield: 'void', reactor: 'cores', processor: 'lattice',
  accessory: 'accessory', module: 'modules', ability: 'anomaly', ultimate: 'deploy',
};

export function itemIcon(category: string): FieldIconName {
  return Object.hasOwn(ITEM_ICON, category) ? ITEM_ICON[category as Category] : 'cache';
}

export function FieldIcon({ name }: { name: FieldIconName }) {
  return <svg className="field-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>;
}
