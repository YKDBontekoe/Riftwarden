import { coolHolstered, type HeatState } from '../combat/heat';
import type { CombatStats } from '../combat/stats';
import type { Weapon } from '../combat/Weapon';
import type { WeaponDef } from '../data/defs';
import { weaponDefFor } from '../loot/equipment';
import type { RunInventory } from '../loot/runInventory';
import type { ItemInstance } from '../loot/types';

export type WeaponSlot = 'weapon' | 'weapon2';

/** What weapon swapping needs from the arena (no Game import). */
export interface WeaponSlotsHost {
  readonly inventory: RunInventory;
  readonly weapon: Weapon;
  readonly stats: CombatStats;
  /** Stats depend on the weapon in hand (only its affixes and modules apply). */
  rebuildStats(): void;
  /** The weapon in hand changed (fx colours, HUD). */
  changed(): void;
}

export const otherSlot = (s: WeaponSlot): WeaponSlot => (s === 'weapon' ? 'weapon2' : 'weapon');

/**
 * Primary + secondary weapon: one is in hand, the other is holstered and keeps its own heat, cooling at full rate
 * while it waits. Swapping is instant (a ~70 ms ready window). Only the weapon in hand contributes its affixes and
 * modules to the stat block, so `inactive` is what stat composition leaves out.
 */
export class WeaponSlots {
  active: WeaponSlot = 'weapon';
  /** Heat of the holstered weapon. */
  private parked: HeatState = { heat: 0, overheated: false };

  constructor(private h: WeaponSlotsHost) {}

  /** Slot whose item is left out of the stat block (the holstered weapon). */
  get inactive(): WeaponSlot {
    return otherSlot(this.active);
  }

  item(slot: WeaponSlot = this.active): ItemInstance | null {
    return this.h.inventory.equipped(slot);
  }

  get hasSecondary(): boolean {
    return !!weaponDefFor(this.item(this.inactive));
  }

  /** Heat of the holstered weapon (HUD). */
  get parkedHeat(): HeatState {
    return this.parked;
  }

  reset(): void {
    this.active = 'weapon';
    this.parked = { heat: 0, overheated: false };
  }

  /** Switch to `slot` (or the other one). Returns false when there is nothing to switch to. */
  swap(slot: WeaponSlot = this.inactive): boolean {
    if (slot === this.active) return false;
    const item = this.item(slot);
    const def = weaponDefFor(item);
    if (!def) return false;
    const w = this.h.weapon;
    const held = w.heatState();
    this.active = slot;
    this.h.rebuildStats();
    w.setItem(item, def, false, true);
    w.restoreHeat(this.parked);
    this.parked = held;
    this.h.changed();
    return true;
  }

  /**
   * Equipment changed: keep the active slot if it still holds a weapon, else fall back to the primary. Returns the
   * weapon in hand (the caller rebuilds the viewmodel).
   */
  sync(): { item: ItemInstance | null; def: WeaponDef | null } {
    if (this.active === 'weapon2' && !weaponDefFor(this.item('weapon2'))) {
      this.active = 'weapon';
      this.parked = { heat: 0, overheated: false };
    }
    const item = this.item();
    return { item, def: weaponDefFor(item) };
  }

  /** The holstered weapon vents (real time). */
  update(dt: number): void {
    if (this.parked.heat <= 0 && !this.parked.overheated) return;
    const def = weaponDefFor(this.item(this.inactive));
    if (!def) {
      this.parked = { heat: 0, overheated: false };
      return;
    }
    this.parked = coolHolstered(this.parked, def, this.h.stats.coolRateMult, dt);
  }
}
