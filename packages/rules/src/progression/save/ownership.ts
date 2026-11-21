import { type ItemInstance, type SlotId, SLOT_IDS } from '../items';
import type { SaveData } from './types';

// Read-only lookups over the owned items (leaf module: shared by rules, engineering and sanitize).
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

/** Every uid owned by the profile, including installed modules (duplicate detection). */
export function allOwnedUids(data: SaveData): string[] {
  const out: string[] = [];
  for (const it of data.items) {
    out.push(it.uid);
    for (const m of it.socketed ?? []) if (m) out.push(m.uid);
  }
  return out;
}
