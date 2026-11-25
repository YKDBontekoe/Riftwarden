import type { SetId } from './sets';
import type { DamageElement } from '../combat/elements';
import type { StatKey, StatOp } from '../combat/stats';
import type { WeaponBuild } from '../weapons/build';
import type { RarityId } from './rarity';

/** Equipment categories. 'module' items are collectible upgrade modules (installation: M3). */
export type Category = 'weapon' | 'armor' | 'shield' | 'reactor' | 'processor' | 'accessory' | 'module' | 'ability' | 'ultimate';

export const CATEGORIES: readonly Category[] = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module', 'ability', 'ultimate'];

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  weapon: 'Weapon',
  armor: 'Armor',
  shield: 'Shield',
  reactor: 'Reactor',
  processor: 'Processor',
  accessory: 'Accessory',
  module: 'Upgrade module',
  ability: 'Ability',
  ultimate: 'Ultimate',
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
  /** M4: protected from full recalibration (affix engineering). */
  locked?: boolean;
}

/** Rolled base parameters of a weapon (applied to its WeaponDef template). */
export interface WeaponRoll {
  damage: number;
  fireRate: number;
  heatPerShot: number;
  coolRate: number;
  /** M3 family parameters (absent on pre-M3 weapons: the family template value applies). */
  range?: number;
  /** Spread multiplier from components (1 = template). */
  accuracy?: number;
  pierce?: number;
  chargeTime?: number;
  beamWidth?: number;
  rampMax?: number;
  /** Swarm: drones per launch and lock cone (absent on other families). */
  drones?: number;
  seekCone?: number;
  /** Launcher: blast radius (m). Flamer: spray cone and machines per tick (absent on other families). */
  splash?: number;
  spray?: number;
  targets?: number;
  /** Damage element (absent on pre-element weapons = kinetic). */
  element?: DamageElement;
}

export interface ModuleInfo {
  /** Module family, e.g. 'barrel'. */
  type: string;
  /** Equipment categories it will be installable into. */
  compatible: Category[];
  /** Sockets it occupies when installed (always 1 since M3). */
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
  /** Weapons: generated component configuration (family, parts, finish, socket kinds). */
  build?: WeaponBuild;
  module?: ModuleInfo;
  /** Module socket capacity (weapons only since M3). */
  sockets: number;
  /**
   * Installed modules, one entry per socket (null = empty). Installed modules live inside
   * the weapon item (not in storage), so a module can never be in two places and always
   * shares its weapon's ownership (carried/secured/unsecured).
   */
  socketed: (ItemInstance | null)[];
  /** Future legendary signature effect id (none exist yet). */
  signature: string | null;
  /** Hand-made unique id (loot/uniques.ts): fixed name, flavour and mechanic. Absent = procedural item. */
  uniqueId?: string;
  /** Trade-locked (pinnacle drops): it never leaves the warden who earned it. Ascended items are always bound. */
  bound?: true;
  /** Item set (loot/sets.ts) of rare+ gear; absent = no set. Decided by the seed at generation. */
  set?: SetId;
  /** Generation metadata: seed and generator version. */
  seed: number;
  gen: number;
  // ---- M4 engineering state (absent = default)
  /** Protected: cannot be sold or dismantled until unlocked. */
  locked?: boolean;
  /** Enhancement level (0..maxEnhance(rarity)). */
  enhance?: number;
  /** Affix engineering operations performed (cost escalation + deterministic reroll stream). */
  rerolls?: number;
  /** Weapon component modifications performed (cost escalation). */
  mods?: number;
}
