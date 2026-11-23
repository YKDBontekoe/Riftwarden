import { type BaseDef, baseDef } from '../loot/bases';
import type { Category, ItemInstance } from '../loot/types';

export type { ItemInstance } from '../loot/types';

/**
 * Equipment slots (structured definitions). Each slot accepts one category; the two
 * weapon slots share the weapon category (one is active at a time in the arena), as do the
 * two accessory slots. Upgrade modules have no slot: they are
 * stored until module installation (engineering) exists.
 */
export type SlotId = 'weapon' | 'weapon2' | 'armor' | 'shield' | 'reactor' | 'processor' | 'accessory' | 'accessory2' | 'ability' | 'ability2' | 'ultimate';

export interface SlotDef {
  id: SlotId;
  label: string;
  accepts: Category;
  /** A run cannot start with this slot empty. */
  required: boolean;
}

export const SLOTS: readonly SlotDef[] = [
  { id: 'weapon', label: 'PRIMARY WEAPON', accepts: 'weapon', required: true },
  { id: 'weapon2', label: 'SECONDARY WEAPON', accepts: 'weapon', required: false },
  { id: 'armor', label: 'ARMOR', accepts: 'armor', required: false },
  { id: 'shield', label: 'SHIELD', accepts: 'shield', required: false },
  { id: 'reactor', label: 'REACTOR', accepts: 'reactor', required: false },
  { id: 'processor', label: 'PROCESSOR', accepts: 'processor', required: false },
  { id: 'accessory', label: 'ACCESSORY I', accepts: 'accessory', required: false },
  { id: 'accessory2', label: 'ACCESSORY II', accepts: 'accessory', required: false },
  { id: 'ability', label: 'ABILITY I', accepts: 'ability', required: false },
  { id: 'ability2', label: 'ABILITY II', accepts: 'ability', required: false },
  { id: 'ultimate', label: 'ULTIMATE', accepts: 'ultimate', required: false },
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

/**
 * Slot an item goes to when none is named: weapons replace the primary (the secondary is always chosen
 * explicitly), other categories fill the first empty compatible slot, else the first one.
 */
export function defaultSlot(category: Category, loadout: Partial<Record<SlotId, unknown>>, locked: readonly SlotId[] = []): SlotId | null {
  const slots = slotsFor(category).filter((s) => !locked.includes(s));
  if (category === 'weapon') return 'weapon';
  return slots.find((s) => !loadout[s]) ?? slots[0] ?? null;
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
  const rnd = new Uint32Array(2);
  globalThis.crypto.getRandomValues(rnd);
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}_${rnd[0].toString(36)}${rnd[1].toString(36)}`;
}
