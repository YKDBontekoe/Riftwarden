import type { StatKey, StatOp } from '../combat/stats';
import type { RarityId } from './rarity';

/** Equipment categories. 'module' items are collectible upgrade modules (installation: M3). */
export type Category = 'weapon' | 'armor' | 'shield' | 'reactor' | 'processor' | 'accessory' | 'module';

export const CATEGORIES: readonly Category[] = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module'];

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  weapon: 'Weapon',
  armor: 'Armor',
  shield: 'Shield',
  reactor: 'Reactor',
  processor: 'Processor',
  accessory: 'Accessory',
  module: 'Upgrade module',
};

/** One stat contribution stored on an item (already scaled by level and rarity). */
export interface RolledStat {
  stat: StatKey;
  op: StatOp;
  value: number;
}

export interface RolledAffix extends RolledStat {
  /** Affix definition id (naming/UI); the stored stat/op/value is authoritative. */
  id: string;
  /** 1..5 */
  tier: number;
  /** Position inside the tier's range, 0..1 (for "roll quality" display). */
  roll: number;
}

/** Rolled base parameters of a weapon (applied to its WeaponDef template). */
export interface WeaponRoll {
  damage: number;
  fireRate: number;
  heatPerShot: number;
  coolRate: number;
}

export interface ModuleInfo {
  /** Module family, e.g. 'barrel'. */
  type: string;
  /** Equipment categories it will be installable into. */
  compatible: Category[];
  /** Sockets it occupies when installed (future engineering). */
  socketCost: number;
}

/**
 * A generated, owned item. Everything needed to apply it is stored on the instance, so
 * changing generation formulas later never rerolls existing equipment.
 */
export interface ItemInstance {
  uid: string;
  /** Base item definition id. */
  defId: string;
  acquiredAt: number;
  /** 'starter', 'legacy' or the run id it dropped in. */
  source: string;
  category: Category;
  level: number;
  rarity: RarityId;
  name: string;
  /** Implicit stats of the base, scaled. */
  base: RolledStat[];
  affixes: RolledAffix[];
  weapon?: WeaponRoll;
  module?: ModuleInfo;
  /** Future module socket capacity and installed module uids (always empty in M2). */
  sockets: number;
  modules: string[];
  /** Future legendary signature effect id (none exist yet). */
  signature: string | null;
  /** Generation metadata: seed and generator version. */
  seed: number;
  gen: number;
}
