import { fitsSlot, getSlot, type SlotId, SLOT_IDS, defaultSlot } from '../progression/items';
import type { RunLedger } from '../progression/run';
import type { ItemInstance } from './types';

/**
 * Run-side inventory and loadout (pure).
 *
 * Ownership is decided by the ledger, never by equipment slots:
 *  - carried:   equipped when the run started (owned by the profile; can never be lost)
 *  - secured:   collected this run and banked at a checkpoint (now in the profile)
 *  - unsecured: collected this run, not yet banked (lost on defeat / abandon / interruption)
 * Equipping an unsecured item only changes the run loadout; at run end the profile
 * adopts the run loadout only for items it actually owns, so a lost item can never stay
 * equipped and the slot falls back to the previously secured gear.
 */
export type ItemStatus = 'carried' | 'secured' | 'unsecured';

/** Unsecured items the drone can hold at once (banking at a checkpoint empties the hold). */
export const RUN_CARGO_CAPACITY = 20;

export interface RunEntry {
  item: ItemInstance;
  status: ItemStatus;
  equippedIn: SlotId | null;
}

export type EquipResult = 'ok' | 'locked' | 'missing' | 'incompatible' | 'required' | 'module';

export class RunInventory {
  readonly loadout: Record<SlotId, string | null>;
  private readonly carried = new Map<string, ItemInstance>();

  constructor(
    carriedLoadout: Partial<Record<SlotId, ItemInstance | null>>,
    readonly ledger: RunLedger,
    readonly cargoCapacity = RUN_CARGO_CAPACITY,
  ) {
    this.loadout = Object.fromEntries(SLOT_IDS.map((s) => [s, null])) as Record<SlotId, string | null>;
    for (const s of SLOT_IDS) {
      const it = carriedLoadout[s];
      if (it) {
        this.carried.set(it.uid, it);
        this.loadout[s] = it.uid;
      }
    }
  }

  /** Run map: take over the previous node's run loadout (uids that this run still holds; others stay as they are). */
  adoptLoadout(loadout: Partial<Record<string, string | null>>): void {
    for (const s of SLOT_IDS) {
      if (!(s in loadout)) continue;
      const uid = loadout[s];
      if (uid === null) {
        if (!getSlot(s).required) this.loadout[s] = null;
        continue;
      }
      const it = uid ? this.find(uid) : null;
      if (it && fitsSlot(it, s)) this.loadout[s] = uid!;
    }
  }

  get cargoUsed(): number {
    return this.ledger.unsecured.items.length;
  }

  get cargoFull(): boolean {
    return this.cargoUsed >= this.cargoCapacity;
  }

  find(uid: string): ItemInstance | null {
    return this.carried.get(uid) ?? this.ledger.unsecured.items.find((i) => i.uid === uid) ?? this.ledger.secured.items.find((i) => i.uid === uid) ?? null;
  }

  status(uid: string): ItemStatus | null {
    if (this.carried.has(uid)) return 'carried';
    if (this.ledger.isSecured(uid)) return 'secured';
    if (this.ledger.unsecured.items.some((i) => i.uid === uid)) return 'unsecured';
    return null;
  }

  /** Pick up an item. Returns false when the hold is full (the item stays in the world). */
  collect(item: ItemInstance): boolean {
    if (this.ledger.ended || this.cargoFull) return false;
    return this.ledger.collect({ items: [item] }) || this.ledger.has(item.uid);
  }

  equipped(slot: SlotId): ItemInstance | null {
    const uid = this.loadout[slot];
    return uid ? this.find(uid) : null;
  }

  /** Equipped items in slot order; `except` leaves one slot out (the holstered weapon in the arena). */
  equippedItems(except?: SlotId): ItemInstance[] {
    return SLOT_IDS.filter((s) => s !== except).map((s) => this.equipped(s)).filter((i): i is ItemInstance => !!i);
  }

  slotOf(uid: string): SlotId | null {
    return SLOT_IDS.find((s) => this.loadout[s] === uid) ?? null;
  }

  /** Slots the warden has not unlocked yet (staged unlocks): never targeted, equips refused. */
  lockedSlots: readonly SlotId[] = [];

  /** Default target slot (`defaultSlot`: weapons -> primary, others -> first empty compatible slot). */
  targetSlot(item: ItemInstance): SlotId | null {
    return defaultSlot(item.category, this.loadout, this.lockedSlots);
  }

  /** Equip from the run inventory. `allowed` = equipment changes are permitted right now. */
  equip(uid: string, allowed: boolean, slot?: SlotId): EquipResult {
    if (!allowed || this.ledger.ended) return 'locked';
    const item = this.find(uid);
    if (!item) return 'missing';
    if (item.category === 'module') return 'module';
    const target = slot ?? this.targetSlot(item);
    if (!target || !fitsSlot(item, target) || this.lockedSlots.includes(target)) return 'incompatible';
    const prevSlot = this.slotOf(uid);
    if (prevSlot === target) return 'ok';
    if (prevSlot) this.loadout[prevSlot] = this.loadout[target]; // swap between accessory slots
    this.loadout[target] = uid;
    return 'ok';
  }

  unequip(slot: SlotId, allowed: boolean): EquipResult {
    if (!allowed || this.ledger.ended) return 'locked';
    if (getSlot(slot).required) return 'required';
    if (!this.loadout[slot]) return 'missing';
    this.loadout[slot] = null;
    return 'ok';
  }

  /** Discard an unsecured, unequipped item (prep phase only). */
  discard(uid: string, allowed: boolean): boolean {
    if (!allowed || this.slotOf(uid) || this.status(uid) !== 'unsecured') return false;
    return this.ledger.discard(uid) !== null;
  }

  entries(): RunEntry[] {
    const out: RunEntry[] = [];
    const push = (item: ItemInstance, status: ItemStatus) => out.push({ item, status, equippedIn: this.slotOf(item.uid) });
    for (const it of this.carried.values()) push(it, 'carried');
    for (const it of this.ledger.secured.items) push(it, 'secured');
    for (const it of this.ledger.unsecured.items) push(it, 'unsecured');
    return out;
  }

  /**
   * The run loadout restricted to items the profile owns (carried or secured). Slots
   * holding an unsecured item are omitted, so the profile keeps its previous gear there.
   */
  ownedLoadout(): Partial<Record<SlotId, string | null>> {
    const out: Partial<Record<SlotId, string | null>> = {};
    for (const s of SLOT_IDS) {
      const uid = this.loadout[s];
      if (uid === null) out[s] = null;
      else if (this.status(uid) === 'carried' || this.status(uid) === 'secured') out[s] = uid;
    }
    return out;
  }
}
