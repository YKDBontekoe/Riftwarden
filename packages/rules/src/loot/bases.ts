import type { StatKey, StatOp } from '../combat/stats';
import { BEAM_EMITTER, FLAMER, LAUNCHER, PLASMA_REPEATER, RAILGUN, SWARM_HIVE, type WeaponDef, type WeaponFamily } from '../data/defs';
import type { Scaling } from './affixes';
import type { Category } from './types';
import type { AbilityKind } from '../abilities/defs';

/**
 * Base item definitions (pure data). A base describes what a family of items is; the
 * generator turns it into unique instances. One base supports unlimited instances.
 */
export interface BaseStatDef {
  stat: StatKey;
  op: StatOp;
  range: [number, number];
  scaling: Scaling;
  /** Not multiplied by the rarity base multiplier (counts such as projectiles). */
  exact?: boolean;
}

export interface WeaponBase {
  family: WeaponFamily;
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
  /** Ability / ultimate items: which ability the item grants (numbers in abilities/defs). */
  ability?: AbilityKind;
  /** Restrict the affix pool (ids). Defaults to every affix compatible with the category. */
  affixes?: string[];
  icon: IconKind;
}

export const BASES: readonly BaseDef[] = [
  // ---------------------------------------------------------------- weapons: plasma repeater chassis
  {
    id: 'plasma_repeater',
    category: 'weapon',
    name: 'Plasma Repeater',
    blurb: 'Standard-issue hitscan repeater. Sustained fire builds heat; weakpoint hits always crit.',
    weight: 10,
    implicit: [],
    weapon: { family: 'plasma', template: PLASMA_REPEATER, damage: [12, 14], fireRate: [9.2, 9.8], heatPerShot: [6.0, 6.4], coolRate: [52, 58] },
    icon: 'rifle',
  },
  {
    id: 'heavy_repeater',
    category: 'weapon',
    name: 'Heavy Repeater',
    blurb: 'Repeater frame with a dense plasma chamber: hits much harder, cycles slower and runs hot.',
    weight: 6,
    implicit: [{ stat: 'critMultiplier', op: 'add', range: [0.15, 0.25], scaling: 'none' }],
    weapon: { family: 'plasma', template: PLASMA_REPEATER, damage: [20, 24], fireRate: [6.0, 6.6], heatPerShot: [8.6, 9.4], coolRate: [50, 56] },
    icon: 'rifle',
  },
  {
    id: 'light_repeater',
    category: 'weapon',
    name: 'Light Repeater',
    blurb: 'Light repeater frame: high cycle rate and efficient cooling at the cost of per-shot damage.',
    weight: 6,
    implicit: [{ stat: 'coolRateMult', op: 'pct', range: [0.08, 0.14], scaling: 'none' }],
    weapon: { family: 'plasma', template: PLASMA_REPEATER, damage: [8.4, 9.6], fireRate: [12.6, 13.6], heatPerShot: [4.4, 4.8], coolRate: [58, 64] },
    icon: 'rifle',
  },
  // ---------------------------------------------------------------- weapons: railgun chassis
  {
    id: 'rail_lancer',
    category: 'weapon',
    name: 'Rail Lancer',
    blurb: 'Balanced railgun frame. Charged slugs pierce through targets; heavy heat per shot.',
    weight: 6,
    implicit: [],
    weapon: { family: 'rail', template: RAILGUN, damage: [86, 98], fireRate: [1.5, 1.7], heatPerShot: [24, 28], coolRate: [38, 44] },
    icon: 'rifle',
  },
  {
    id: 'rail_siege',
    category: 'weapon',
    name: 'Siege Rail',
    blurb: 'Long-spine siege accelerator: enormous slugs, slow cycle, crits hit harder.',
    weight: 4,
    implicit: [{ stat: 'critMultiplier', op: 'add', range: [0.2, 0.3], scaling: 'none' }],
    weapon: { family: 'rail', template: RAILGUN, damage: [122, 136], fireRate: [1.1, 1.25], heatPerShot: [32, 36], coolRate: [36, 40] },
    icon: 'rifle',
  },
  {
    id: 'rail_striker',
    category: 'weapon',
    name: 'Striker Rail',
    blurb: 'Short-frame railgun: lighter slugs, fast charge and cycle.',
    weight: 4,
    implicit: [{ stat: 'chargeRateMult', op: 'pct', range: [0.15, 0.25], scaling: 'none' }],
    weapon: { family: 'rail', template: RAILGUN, damage: [62, 70], fireRate: [2.3, 2.6], heatPerShot: [17, 20], coolRate: [44, 50] },
    icon: 'rifle',
  },
  // ---------------------------------------------------------------- weapons: beam emitter chassis
  {
    id: 'beam_prism',
    category: 'weapon',
    name: 'Prism Emitter',
    blurb: 'Standard continuous emitter. Damage ramps up while the beam stays on one target.',
    weight: 6,
    implicit: [],
    weapon: { family: 'beam', template: BEAM_EMITTER, damage: [6.0, 6.8], fireRate: [14.6, 15.4], heatPerShot: [1.38, 1.5], coolRate: [46, 52] },
    icon: 'rifle',
  },
  {
    id: 'beam_lattice',
    category: 'weapon',
    name: 'Lattice Projector',
    blurb: 'Heavy lattice projector: a hotter, harder-hitting beam.',
    weight: 4,
    implicit: [{ stat: 'rangeMult', op: 'pct', range: [0.08, 0.14], scaling: 'none' }],
    weapon: { family: 'beam', template: BEAM_EMITTER, damage: [8.6, 9.6], fireRate: [14.6, 15.4], heatPerShot: [1.9, 2.1], coolRate: [44, 48] },
    icon: 'rifle',
  },
  {
    id: 'beam_focus',
    category: 'weapon',
    name: 'Focus Lance',
    blurb: 'Efficient lance: low heat, reaches full intensity quickly.',
    weight: 4,
    implicit: [{ stat: 'chargeRateMult', op: 'pct', range: [0.2, 0.3], scaling: 'none' }],
    weapon: { family: 'beam', template: BEAM_EMITTER, damage: [5.0, 5.6], fireRate: [14.6, 15.4], heatPerShot: [1.0, 1.1], coolRate: [52, 58] },
    icon: 'rifle',
  },
  // ---------------------------------------------------------------- weapons: drone swarm hives
  {
    id: 'swarm_hive',
    category: 'weapon',
    name: 'Seeker Hive',
    blurb: 'Launches three seeker drones per release; they lock onto machines near the crosshair.',
    weight: 8,
    implicit: [],
    weapon: { family: 'swarm', template: SWARM_HIVE, damage: [9.4, 10.6], fireRate: [3.2, 3.6], heatPerShot: [7.2, 7.8], coolRate: [44, 50] },
    icon: 'rifle',
  },
  {
    id: 'swarm_brood',
    category: 'weapon',
    name: 'Brood Carrier',
    blurb: 'Heavy carrier: slow releases of hard-hitting drones with a wide lock cone.',
    weight: 5,
    implicit: [{ stat: 'critMultiplier', op: 'add', range: [0.1, 0.2], scaling: 'none' }],
    weapon: { family: 'swarm', template: SWARM_HIVE, damage: [15, 17], fireRate: [2.2, 2.5], heatPerShot: [9.5, 10.5], coolRate: [42, 46] },
    icon: 'rifle',
  },
  {
    id: 'swarm_wasp',
    category: 'weapon',
    name: 'Wasp Nest',
    blurb: 'Light nest: rapid releases of small, fast drones that run cool.',
    weight: 5,
    implicit: [{ stat: 'fireRateMult', op: 'pct', range: [0.04, 0.08], scaling: 'none' }],
    weapon: { family: 'swarm', template: SWARM_HIVE, damage: [6.6, 7.4], fireRate: [4.6, 5.0], heatPerShot: [5.2, 5.8], coolRate: [50, 56] },
    icon: 'rifle',
  },
  // ---------------------------------------------------------------- weapons: launchers
  {
    id: 'launcher_tube',
    category: 'weapon',
    name: 'Rocket Launcher',
    blurb: 'Shoulder-mounted tube: rockets detonate on impact and splash everything nearby.',
    weight: 8,
    implicit: [],
    weapon: { family: 'launcher', template: LAUNCHER, damage: [49, 55], fireRate: [1.28, 1.42], heatPerShot: [16, 18], coolRate: [36, 40] },
    icon: 'rifle',
  },
  {
    id: 'launcher_siege',
    category: 'weapon',
    name: 'Siege Mortar',
    blurb: 'Heavy launcher: slow, crushing rockets that hit elites hard.',
    weight: 5,
    implicit: [{ stat: 'eliteDamageMult', op: 'pct', range: [0.06, 0.1], scaling: 'none' }],
    weapon: { family: 'launcher', template: LAUNCHER, damage: [74, 82], fireRate: [0.92, 1.02], heatPerShot: [22, 25], coolRate: [34, 38] },
    icon: 'rifle',
  },
  {
    id: 'launcher_hornet',
    category: 'weapon',
    name: 'Hornet Launcher',
    blurb: 'Light launcher: quick, small rockets that run cool.',
    weight: 5,
    implicit: [{ stat: 'fireRateMult', op: 'pct', range: [0.04, 0.08], scaling: 'none' }],
    weapon: { family: 'launcher', template: LAUNCHER, damage: [33, 37], fireRate: [2.0, 2.2], heatPerShot: [11, 12.5], coolRate: [42, 46] },
    icon: 'rifle',
  },
  // ---------------------------------------------------------------- weapons: flamers
  {
    id: 'flamer_torch',
    category: 'weapon',
    name: 'Flame Projector',
    blurb: 'Pressurised projector: a short cone that reaches four machines at once.',
    weight: 8,
    implicit: [],
    weapon: { family: 'flamer', template: FLAMER, damage: [6.1, 6.9], fireRate: [11.6, 12.4], heatPerShot: [1.0, 1.1], coolRate: [44, 48] },
    icon: 'rifle',
  },
  {
    id: 'flamer_inferno',
    category: 'weapon',
    name: 'Inferno Pack',
    blurb: 'Heavy pack-fed flamer: more fuel per tick and stronger statuses.',
    weight: 5,
    implicit: [{ stat: 'elementalPower', op: 'pct', range: [0.08, 0.14], scaling: 'none' }],
    weapon: { family: 'flamer', template: FLAMER, damage: [8.2, 9.2], fireRate: [10.6, 11.4], heatPerShot: [1.3, 1.45], coolRate: [42, 46] },
    icon: 'rifle',
  },
  {
    id: 'flamer_needle',
    category: 'weapon',
    name: 'Needle Torch',
    blurb: 'Light torch: a quick-cycling stream that sheds heat fast.',
    weight: 5,
    implicit: [{ stat: 'coolRateMult', op: 'pct', range: [0.06, 0.1], scaling: 'none' }],
    weapon: { family: 'flamer', template: FLAMER, damage: [4.8, 5.4], fireRate: [14.5, 15.5], heatPerShot: [0.8, 0.9], coolRate: [50, 56] },
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
  {
    id: 'colossus_plating',
    category: 'armor',
    name: 'Colossus Siege Plating',
    blurb: 'Cut from a destroyed Siege Colossus. Siege-grade armor and hull with damage resistance; heavy but well balanced.',
    weight: 3,
    exclusive: true,
    implicit: [
      { stat: 'armor', op: 'add', range: [34, 44], scaling: 'flat' },
      { stat: 'maxHealthBonus', op: 'add', range: [20, 28], scaling: 'flat' },
      { stat: 'damageResist', op: 'add', range: [0.03, 0.05], scaling: 'none' },
      { stat: 'moveSpeedMult', op: 'pct', range: [-0.03, -0.02], scaling: 'none' },
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
  {
    id: 'overseer_logic',
    category: 'processor',
    name: 'Overseer Logic Core',
    blurb: 'Command processor salvaged from an Overseer Core. Sharpens targeting against elite and boss machines.',
    weight: 3,
    exclusive: true,
    implicit: [
      { stat: 'eliteDamageMult', op: 'pct', range: [0.12, 0.2], scaling: 'none' },
      { stat: 'critChance', op: 'add', range: [0.03, 0.05], scaling: 'none' },
      { stat: 'elementalPower', op: 'pct', range: [0.06, 0.12], scaling: 'none' },
    ],
    icon: 'chip',
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
  // ---------------------------------------------------------------- abilities (two cooldown slots) and ultimates
  { id: 'frag_charge', category: 'ability', name: 'Frag Charge', blurb: 'Lobbed charge: bursts on impact (or after 1.6 s) for heavy thermal blast damage that ignites.', weight: 10, implicit: [], ability: 'frag', icon: 'gem' },
  { id: 'cryo_charge', category: 'ability', name: 'Cryo Charge', blurb: 'Lobbed charge: a frost burst that chills hard (freezes most frames) and deals light damage.', weight: 8, implicit: [], ability: 'cryo', icon: 'gem' },
  { id: 'arc_pulse', category: 'ability', name: 'Arc Pulse', blurb: 'Instant electric pulse around the drone: shocks everything near, triple damage to shields.', weight: 8, implicit: [], ability: 'emp', icon: 'gem' },
  { id: 'blink_drive', category: 'ability', name: 'Blink Drive', blurb: 'Instant jump along your aim (up to 10 m, stops at walls), keeps your momentum.', weight: 7, implicit: [], ability: 'blink', icon: 'gem' },
  { id: 'aegis_cell', category: 'ability', name: 'Aegis Cell', blurb: 'Instant overshield and 50% damage resistance for 4 s.', weight: 7, implicit: [], ability: 'aegis', icon: 'gem' },
  { id: 'shield_wall', category: 'ability', name: 'Shield Wall', blurb: 'Projects a 6 m energy barrier where you aim: blocks enemy fire and line of sight for 6 s; your shots pass through.', weight: 7, implicit: [], ability: 'wall', icon: 'gem' },
  { id: 'holo_decoy', category: 'ability', name: 'Holo Decoy', blurb: 'Drops a holographic drone that draws the fire of every machine within 24 m until it is destroyed (7 s).', weight: 6, implicit: [], ability: 'decoy', icon: 'gem' },
  { id: 'mini_sentry', category: 'ability', name: 'Mini-Sentry', blurb: 'Deploys a free Sentinel turret where you aim for 12 s. It does not block lanes and cannot be refitted.', weight: 6, implicit: [], ability: 'sentry', icon: 'gem' },
  { id: 'orbital_lance', category: 'ultimate', name: 'Orbital Lance', blurb: 'Marks the aim point; 1.2 s later a lance from orbit erases everything in the zone.', weight: 10, implicit: [], ability: 'orbital', icon: 'core' },
  { id: 'overdrive_core', category: 'ultimate', name: 'Overdrive Core', blurb: 'For a few seconds: +60% fire rate, no weapon heat, +20% movement speed.', weight: 8, implicit: [], ability: 'overdrive', icon: 'core' },
  // ---------------------------------------------------------------- weapon upgrade modules (M3)
  // Trade-off ranges are ordered worst -> best roll, so a better roll means a smaller penalty.
  {
    id: 'siege_module', category: 'module', name: 'Siege Capacitor', blurb: 'Colossus power cell (power socket): heavy bonus damage against elites and bosses.', weight: 3, exclusive: true,
    implicit: [
      { stat: 'eliteDamageMult', op: 'pct', range: [0.22, 0.36], scaling: 'none' },
      { stat: 'weaponDamageMult', op: 'pct', range: [0.04, 0.08], scaling: 'pct' },
    ],
    module: { type: 'siege', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'critdmg', 'crit'], icon: 'cube',
  },
  {
    id: 'prism_module', category: 'module', name: 'Overseer Prism Lens', blurb: 'Overseer focusing lens (system socket): stronger elements and arcing hits.', weight: 3, exclusive: true,
    implicit: [
      { stat: 'elementalPower', op: 'pct', range: [0.18, 0.3], scaling: 'none' },
      { stat: 'arcChance', op: 'add', range: [0.08, 0.14], scaling: 'none' },
      { stat: 'arcDamage', op: 'add', range: [0.3, 0.45], scaling: 'none' },
    ],
    module: { type: 'prism', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'crit', 'rate'], icon: 'cube',
  },
  {
    id: 'amp_module', category: 'module', name: 'Damage Amplifier', blurb: 'Power-socket amplifier: raises weapon damage.', weight: 10,
    implicit: [{ stat: 'weaponDamageMult', op: 'pct', range: [0.1, 0.18], scaling: 'pct' }],
    module: { type: 'amp', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'critdmg'], icon: 'cube',
  },
  {
    id: 'cooling_module', category: 'module', name: 'Cooling Matrix', blurb: 'System-socket coolant matrix: faster cooling, less heat per shot.', weight: 9,
    implicit: [
      { stat: 'coolRateMult', op: 'pct', range: [0.15, 0.28], scaling: 'none' },
      { stat: 'heatEfficiency', op: 'pct', range: [0.06, 0.12], scaling: 'none' },
    ],
    module: { type: 'cooling', compatible: ['weapon'], socketCost: 1 }, affixes: ['rate', 'dmg'], icon: 'cube',
  },
  {
    id: 'crit_module', category: 'module', name: 'Critical Processor', blurb: 'System-socket targeting processor: critical chance and damage.', weight: 8,
    implicit: [
      { stat: 'critChance', op: 'add', range: [0.04, 0.07], scaling: 'none' },
      { stat: 'critMultiplier', op: 'add', range: [0.15, 0.3], scaling: 'none' },
    ],
    module: { type: 'crit', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'rate', 'heat'], icon: 'cube',
  },
  {
    id: 'overcharge_module', category: 'module', name: 'Overcharge Capacitor', blurb: 'Power-socket capacitor: big damage boost, worse heat efficiency.', weight: 7,
    implicit: [
      { stat: 'weaponDamageMult', op: 'pct', range: [0.22, 0.36], scaling: 'pct' },
      { stat: 'heatEfficiency', op: 'pct', range: [-0.24, -0.14], scaling: 'none' },
    ],
    module: { type: 'overcharge', compatible: ['weapon'], socketCost: 1 }, affixes: ['crit', 'critdmg', 'rate'], icon: 'cube',
  },
  {
    id: 'splitter_module', category: 'module', name: 'Projectile Splitter', blurb: 'Barrel-socket splitter (plasma only): +1 bolt per shot, weaker bolts, wider spread.', weight: 5,
    implicit: [
      { stat: 'projectiles', op: 'add', range: [1, 1], scaling: 'none', exact: true },
      { stat: 'weaponDamageMult', op: 'pct', range: [-0.36, -0.28], scaling: 'none' },
      { stat: 'spreadMult', op: 'pct', range: [0.7, 0.45], scaling: 'none', exact: true },
    ],
    module: { type: 'splitter', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'crit', 'heat'], icon: 'cube',
  },
  {
    id: 'arc_conductor', category: 'module', name: 'Arc Conductor', blurb: 'Barrel-socket conductor: hits may arc to a nearby enemy. Slightly more heat.', weight: 6,
    implicit: [
      { stat: 'arcChance', op: 'add', range: [0.18, 0.3], scaling: 'none' },
      { stat: 'arcDamage', op: 'add', range: [0.45, 0.75], scaling: 'none' },
      { stat: 'heatEfficiency', op: 'pct', range: [-0.08, -0.04], scaling: 'none' },
    ],
    module: { type: 'arc', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'critdmg'], icon: 'cube',
  },
  {
    id: 'thermal_module', category: 'module', name: 'Thermal Converter', blurb: 'Power-socket converter: damage rises with weapon heat; slower cooling.', weight: 6,
    implicit: [
      { stat: 'heatDamage', op: 'add', range: [0.4, 0.7], scaling: 'none' },
      { stat: 'coolRateMult', op: 'pct', range: [-0.15, -0.08], scaling: 'none' },
    ],
    module: { type: 'thermal', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'heat'], icon: 'cube',
  },
  {
    id: 'stabilizer_module', category: 'module', name: 'Precision Stabilizer', blurb: 'Barrel-socket gyro: less spread and recoil, faster charge and ramp, slightly slower fire.', weight: 8,
    implicit: [
      { stat: 'spreadMult', op: 'pct', range: [-0.25, -0.4], scaling: 'none', exact: true },
      { stat: 'chargeRateMult', op: 'pct', range: [0.15, 0.3], scaling: 'none' },
      { stat: 'fireRateMult', op: 'pct', range: [-0.06, -0.03], scaling: 'none' },
    ],
    module: { type: 'stabilizer', compatible: ['weapon'], socketCost: 1 }, affixes: ['crit', 'critdmg', 'dmg'], icon: 'cube',
  },
  // ---------------------------------------------------------------- M2 modules (no longer drop; owned ones stay installable)
  {
    id: 'barrel_module', category: 'module', name: 'Barrel Module', blurb: 'Early barrel insert (barrel socket). Its rolled affixes apply when installed.', weight: 0,
    implicit: [], module: { type: 'barrel', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'rate', 'crit', 'critdmg'], icon: 'cube',
  },
  {
    id: 'coolant_module', category: 'module', name: 'Coolant Module', blurb: 'Early thermal insert (system socket). Its rolled affixes apply when installed.', weight: 0,
    implicit: [], module: { type: 'coolant', compatible: ['weapon'], socketCost: 1 }, affixes: ['heat', 'cool', 'rate'], icon: 'cube',
  },
  {
    id: 'capacitor_module', category: 'module', name: 'Capacitor Module', blurb: 'Early energy insert (power socket). Its rolled affixes apply when installed.', weight: 0,
    implicit: [], module: { type: 'capacitor', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'shieldcap', 'shieldregen'], icon: 'cube',
  },
  {
    id: 'arc_module', category: 'module', name: 'Arc Module', blurb: 'Early arc-stabilised insert (barrel socket). Its rolled affixes apply when installed.', weight: 0,
    implicit: [], module: { type: 'arc', compatible: ['weapon'], socketCost: 1 }, affixes: ['dmg', 'critdmg', 'crit', 'heat'], icon: 'cube',
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
