import { type BaseDef, baseDef } from '../loot/bases';
import type { Category, ItemInstance } from '../loot/types';

export type { ItemInstance } from '../loot/types';

/**
 * Equipment slots (structured definitions). Each slot accepts one category; the two
 * accessory slots share the accessory category. Upgrade modules have no slot: they are
 * stored until module installation (engineering) exists.
 */
export type SlotId = 'weapon' | 'armor' | 'shield' | 'reactor' | 'processor' | 'accessory' | 'accessory2';

export interface SlotDef {
  id: SlotId;
  label: string;
  accepts: Category;
  /** A run cannot start with this slot empty. */
  required: boolean;
}

export const SLOTS: readonly SlotDef[] = [
  { id: 'weapon', label: 'PRIMARY WEAPON', accepts: 'weapon', required: true },
  { id: 'armor', label: 'ARMOR', accepts: 'armor', required: false },
  { id: 'shield', label: 'SHIELD', accepts: 'shield', required: false },
  { id: 'reactor', label: 'REACTOR', accepts: 'reactor', required: false },
  { id: 'processor', label: 'PROCESSOR', accepts: 'processor', required: false },
  { id: 'accessory', label: 'ACCESSORY I', accepts: 'accessory', required: false },
  { id: 'accessory2', label: 'ACCESSORY II', accepts: 'accessory', required: false },
];

export const SLOT_IDS: readonly SlotId[] = SLOTS.map((s) => s.id);

export function getSlot(id: SlotId): SlotDef {
  return SLOTS.find((s) => s.id === id)!;
}

export function isSlotId(v: unknown): v is SlotId {
  return typeof v === 'string' && (SLOT_IDS as readonly string[]).includes(v);
}

/** Slots an item category may occupy. */
export function slotsFor(category: Category): SlotId[] {
  return SLOTS.filter((s) => s.accepts === category).map((s) => s.id);
}

/** Can this item be equipped in this slot? (definition must still exist) */
export function fitsSlot(item: ItemInstance | null | undefined, slot: SlotId): boolean {
  return !!item && !!baseDef(item.defId) && getSlot(slot).accepts === item.category;
}

/** Base definition of an owned item (null when the definition no longer exists). */
export function itemDef(item: ItemInstance | null | undefined): BaseDef | null {
  return item ? (baseDef(item.defId) ?? null) : null;
}

let uidCounter = 0;
export function newUid(prefix = 'it'): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
