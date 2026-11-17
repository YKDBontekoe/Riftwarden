import { PLASMA_REPEATER, type WeaponDef } from '../data/defs';

/**
 * Equipment foundation. Slot ids cover the long-term loadout; only slots with a
 * real gameplay backend (`functional`) accept equipment. Item definitions point at
 * the existing data that drives gameplay (a weapon item carries its WeaponDef).
 */
export type SlotId = 'weapon' | 'armor' | 'shield' | 'reactor' | 'processor' | 'module' | 'accessory';

export interface SlotDef {
  id: SlotId;
  label: string;
  /** True when equipping into this slot changes gameplay today. */
  functional: boolean;
  /** A run cannot start with this slot empty. */
  required: boolean;
}

export const SLOTS: readonly SlotDef[] = [
  { id: 'weapon', label: 'PRIMARY WEAPON', functional: true, required: true },
  { id: 'armor', label: 'ARMOR', functional: false, required: false },
  { id: 'shield', label: 'SHIELD', functional: false, required: false },
  { id: 'reactor', label: 'REACTOR', functional: false, required: false },
  { id: 'processor', label: 'PROCESSOR', functional: false, required: false },
  { id: 'module', label: 'MODULE', functional: false, required: false },
  { id: 'accessory', label: 'ACCESSORY', functional: false, required: false },
];

export const SLOT_IDS: readonly SlotId[] = SLOTS.map((s) => s.id);

export function getSlot(id: SlotId): SlotDef {
  return SLOTS.find((s) => s.id === id)!;
}

export interface ItemDef {
  id: string;
  name: string;
  slot: SlotId;
  description: string;
  weapon?: WeaponDef;
}

/** Registry of item definitions that exist in the game. */
export const ITEM_DEFS: Readonly<Record<string, ItemDef>> = {
  plasma_repeater: {
    id: 'plasma_repeater',
    name: 'Plasma Repeater',
    slot: 'weapon',
    description: 'Standard-issue hitscan repeater. Sustained fire builds heat; weakpoint hits always crit.',
    weapon: PLASMA_REPEATER,
  },
};

/** An owned piece of equipment. `uid` is unique per save. */
export interface ItemInstance {
  uid: string;
  defId: string;
  acquiredAt: number;
  /** Where it came from: 'starter' kit or a run id. */
  source: string;
}

export function itemDef(item: ItemInstance | null | undefined): ItemDef | null {
  return item ? (ITEM_DEFS[item.defId] ?? null) : null;
}

let uidCounter = 0;
export function newUid(prefix = 'it'): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
