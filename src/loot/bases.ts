import type { StatKey, StatOp } from '../combat/stats';
import { PLASMA_REPEATER, type WeaponDef } from '../data/defs';
import type { Scaling } from './affixes';
import type { Category } from './types';

/**
 * Base item definitions (pure data). A base describes what a family of items is; the
 * generator turns it into unique instances. One base supports unlimited instances.
 */
export interface BaseStatDef {
  stat: StatKey;
  op: StatOp;
  range: [number, number];
  scaling: Scaling;
}

export interface WeaponBase {
  template: WeaponDef;
  /** Level-1 roll ranges; damage scales with item level ('flat'). */
  damage: [number, number];
  fireRate: [number, number];
  heatPerShot: [number, number];
  coolRate: [number, number];
}

export type IconKind = 'rifle' | 'plate' | 'ring' | 'core' | 'chip' | 'gem' | 'cube';

export interface BaseDef {
  id: string;
  category: Category;
  /** Noun phrase used by the name generator, e.g. "Plasma Repeater". */
  name: string;
  /** Short description of the base's identity (no unimplemented effects). */
  blurb: string;
  /** Relative weight when a drop picks a base inside its category. */
  weight: number;
  /** Only dropped by sources that list it in `exclusive` (target farming). */
  exclusive?: boolean;
  implicit: BaseStatDef[];
  weapon?: WeaponBase;
  module?: { type: string; compatible: Category[]; socketCost: number };
  /** Restrict the affix pool (ids). Defaults to every affix compatible with the category. */
  affixes?: string[];
  icon: IconKind;
}

export const BASES: readonly BaseDef[] = [
  // ---------------------------------------------------------------- weapons (one family: plasma repeater)
  {
    id: 'plasma_repeater',
    category: 'weapon',
    name: 'Plasma Repeater',
    blurb: 'Standard-issue hitscan repeater. Sustained fire builds heat; weakpoint hits always crit.',
    weight: 10,
    implicit: [],
    weapon: { template: PLASMA_REPEATER, damage: [12, 14], fireRate: [9.2, 9.8], heatPerShot: [6.0, 6.4], coolRate: [52, 58] },
    icon: 'rifle',
  },
  {
    id: 'heavy_repeater',
    category: 'weapon',
    name: 'Heavy Repeater',
    blurb: 'Repeater frame with a dense plasma chamber: hits much harder, cycles slower and runs hot.',
    weight: 6,
    implicit: [{ stat: 'critMultiplier', op: 'add', range: [0.15, 0.25], scaling: 'none' }],
    weapon: { template: PLASMA_REPEATER, damage: [20, 24], fireRate: [6.0, 6.6], heatPerShot: [8.6, 9.4], coolRate: [50, 56] },
    icon: 'rifle',
  },
  {
    id: 'light_repeater',
    category: 'weapon',
    name: 'Light Repeater',
    blurb: 'Light repeater frame: high cycle rate and efficient cooling at the cost of per-shot damage.',
    weight: 6,
    implicit: [{ stat: 'coolRateMult', op: 'pct', range: [0.08, 0.14], scaling: 'none' }],
    weapon: { template: PLASMA_REPEATER, damage: [8.4, 9.6], fireRate: [12.6, 13.6], heatPerShot: [4.4, 4.8], coolRate: [58, 64] },
    icon: 'rifle',
  },
  // ---------------------------------------------------------------- armor
  {
    id: 'kinetic_plating',
    category: 'armor',
    name: 'Kinetic Plating',
    blurb: 'Layered ablative plates. Armor rating reduces every hit taken.',
    weight: 10,
    implicit: [
      { stat: 'armor', op: 'add', range: [14, 20], scaling: 'flat' },
      { stat: 'maxHealthBonus', op: 'add', range: [6, 10], scaling: 'flat' },
    ],
    icon: 'plate',
  },
  {
    id: 'composite_armor',
    category: 'armor',
    name: 'Composite Armor',
    blurb: 'Lightweight composite weave: flat resistance and a sturdier hull, little bulk.',
    weight: 8,
    implicit: [
      { stat: 'damageResist', op: 'add', range: [0.04, 0.06], scaling: 'none' },
      { stat: 'maxHealthBonus', op: 'add', range: [12, 18], scaling: 'flat' },
    ],
    icon: 'plate',
  },
  {
    id: 'bulwark_plating',
    category: 'armor',
    name: 'Bulwark Plating',
    blurb: 'Salvaged from Bulwark elites. Massive armor and hull, but the extra mass slows the drone.',
    weight: 4,
    exclusive: true,
    implicit: [
      { stat: 'armor', op: 'add', range: [28, 36], scaling: 'flat' },
      { stat: 'maxHealthBonus', op: 'add', range: [16, 22], scaling: 'flat' },
      { stat: 'moveSpeedMult', op: 'pct', range: [-0.05, -0.04], scaling: 'none' },
    ],
    icon: 'plate',
  },
  // ---------------------------------------------------------------- shields
  {
    id: 'shield_matrix',
    category: 'shield',
    name: 'Shield Matrix',
    blurb: 'Projected energy barrier. Absorbs damage before the hull and recharges after a short delay.',
    weight: 10,
    implicit: [
      { stat: 'shieldCapacity', op: 'add', range: [24, 32], scaling: 'flat' },
      { stat: 'shieldRegen', op: 'add', range: [7, 9], scaling: 'flat' },
    ],
    icon: 'ring',
  },
  {
    id: 'barrier_lattice',
    category: 'shield',
    name: 'Barrier Lattice',
    blurb: 'Dense lattice emitter: a much larger barrier that is slower to start recharging.',
    weight: 7,
    implicit: [
      { stat: 'shieldCapacity', op: 'add', range: [40, 50], scaling: 'flat' },
      { stat: 'shieldRegen', op: 'add', range: [6, 8], scaling: 'flat' },
      { stat: 'shieldDelay', op: 'pct', range: [0.25, 0.35], scaling: 'none' },
    ],
    icon: 'ring',
  },
  // ---------------------------------------------------------------- reactors
  {
    id: 'reactor_core',
    category: 'reactor',
    name: 'Reactor Core',
    blurb: 'Drone power plant. Faster weapon cooling and tactical energy recharge.',
    weight: 10,
    implicit: [
      { stat: 'coolRateMult', op: 'pct', range: [0.1, 0.16], scaling: 'none' },
      { stat: 'tacticalRechargeMult', op: 'pct', range: [0.1, 0.18], scaling: 'none' },
    ],
    icon: 'core',
  },
  {
    id: 'fusion_cell',
    category: 'reactor',
    name: 'Fusion Cell',
    blurb: 'Compact cell that feeds the weapon cleaner plasma: less heat per shot, some shield power.',
    weight: 8,
    implicit: [
      { stat: 'heatEfficiency', op: 'pct', range: [0.1, 0.16], scaling: 'none' },
      { stat: 'shieldCapacity', op: 'add', range: [6, 10], scaling: 'flat' },
    ],
    icon: 'core',
  },
  // ---------------------------------------------------------------- processors
  {
    id: 'combat_processor',
    category: 'processor',
    name: 'Combat Processor',
    blurb: 'Targeting co-processor. Improves critical hit chance and damage.',
    weight: 10,
    implicit: [
      { stat: 'critChance', op: 'add', range: [0.025, 0.04], scaling: 'none' },
      { stat: 'critMultiplier', op: 'add', range: [0.08, 0.14], scaling: 'none' },
    ],
    icon: 'chip',
  },
  {
    id: 'tactical_processor',
    category: 'processor',
    name: 'Tactical Processor',
    blurb: 'Networks with deployed Sentinels: stronger turret fire and wider coverage.',
    weight: 8,
    implicit: [
      { stat: 'turretDamageMult', op: 'pct', range: [0.08, 0.14], scaling: 'pct' },
      { stat: 'turretRangeMult', op: 'pct', range: [0.04, 0.07], scaling: 'none' },
    ],
    icon: 'chip',
  },
  // ---------------------------------------------------------------- accessories
  {
    id: 'servo_booster',
    category: 'accessory',
    name: 'Servo Booster',
    blurb: 'Thruster servo upgrade: faster movement and dash recharge.',
    weight: 10,
    implicit: [
      { stat: 'moveSpeedMult', op: 'pct', range: [0.04, 0.06], scaling: 'none' },
      { stat: 'dashRechargeMult', op: 'pct', range: [0.08, 0.14], scaling: 'none' },
    ],
    icon: 'gem',
  },
  {
    id: 'field_uplink',
    category: 'accessory',
    name: 'Field Uplink',
    blurb: 'Fabrication uplink: Sentinels cost fewer cores and fire faster.',
    weight: 8,
    implicit: [
      { stat: 'buildCostMult', op: 'pct', range: [-0.06, -0.1], scaling: 'none' },
      { stat: 'turretFireRateMult', op: 'pct', range: [0.04, 0.07], scaling: 'none' },
    ],
    icon: 'gem',
  },
  {
    id: 'targeting_lens',
    category: 'accessory',
    name: 'Targeting Lens',
    blurb: 'Optical lens array: critical hits land harder.',
    weight: 8,
    implicit: [{ stat: 'critMultiplier', op: 'add', range: [0.12, 0.2], scaling: 'none' }],
    icon: 'gem',
  },
  // ---------------------------------------------------------------- upgrade modules (stored only in M2)
  {
    id: 'barrel_module',
    category: 'module',
    name: 'Barrel Module',
    blurb: 'Weapon barrel insert. Installable once weapon engineering is available.',
    weight: 10,
    implicit: [],
    module: { type: 'barrel', compatible: ['weapon'], socketCost: 1 },
    affixes: ['dmg', 'rate', 'crit', 'critdmg'],
    icon: 'cube',
  },
  {
    id: 'coolant_module',
    category: 'module',
    name: 'Coolant Module',
    blurb: 'Thermal regulation insert for weapons and reactors. Installable once engineering is available.',
    weight: 8,
    implicit: [],
    module: { type: 'coolant', compatible: ['weapon', 'reactor'], socketCost: 1 },
    affixes: ['heat', 'cool', 'rate'],
    icon: 'cube',
  },
  {
    id: 'capacitor_module',
    category: 'module',
    name: 'Capacitor Module',
    blurb: 'Energy storage insert for weapons and shields. Installable once engineering is available.',
    weight: 7,
    implicit: [],
    module: { type: 'capacitor', compatible: ['weapon', 'shield'], socketCost: 1 },
    affixes: ['dmg', 'shieldcap', 'shieldregen'],
    icon: 'cube',
  },
  {
    id: 'arc_module',
    category: 'module',
    name: 'Arc Module',
    blurb: 'Arc-stabilised energy insert with high socket cost. Installable once engineering is available.',
    weight: 4,
    implicit: [],
    module: { type: 'arc', compatible: ['weapon'], socketCost: 2 },
    affixes: ['dmg', 'critdmg', 'crit', 'heat'],
    icon: 'cube',
  },
];

const BY_ID = new Map(BASES.map((b) => [b.id, b]));

export function baseDef(id: string | undefined): BaseDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Bases that may drop for a category (exclusive ones only when explicitly allowed). */
export function basesFor(category: Category, allowExclusive: readonly string[] = []): BaseDef[] {
  return BASES.filter((b) => b.category === category && (!b.exclusive || allowExclusive.includes(b.id)));
}
