/** Data-driven content definitions. */

export type WeaponFamily = 'plasma' | 'rail' | 'beam';
/** How the trigger turns into shots. Each family supports a fixed subset (see weapons/families.ts). */
export type Mechanism = 'auto' | 'burst' | 'charge' | 'cycle' | 'beam' | 'scatter' | 'pulse';

export interface WeaponDef {
  id: string;
  name: string;
  family: WeaponFamily;
  mechanism: Mechanism;
  /** Damage per shot (plasma/rail: full-charge shot; beam: per damage tick). */
  damage: number;
  /** Shots per second (beam: damage ticks per second; burst: average rate). */
  fireRate: number;
  range: number;
  /** Heat per shot / per beam tick (0..100 scale). */
  heatPerShot: number;
  coolRate: number; // heat per second while cooling
  coolDelay: number; // seconds after last shot before cooling starts
  overheatRecover: number; // heat level at which overheat lockout ends
  spreadMin: number; // radians
  spreadMax: number;
  spreadPerShot: number;
  spreadRecover: number; // radians per second
  recoilPitch: number; // radians per shot
  /** Burst: rounds per trigger cycle. */
  burstCount: number;
  /** Charge: seconds to full charge (before chargeRateMult). */
  chargeTime: number;
  /** Rail: enemies a slug passes through after the first. */
  pierce: number;
  /** Beam: aim-assist radius around the beam axis (m). */
  beamWidth: number;
  /** Beam: damage multiplier reached after holding on one target for rampTime. */
  rampMax: number;
  rampTime: number;
  /** Visual speed of plasma bolts (m/s); damage is resolved instantly (hitscan). */
  boltSpeed: number;
}

const WEAPON_DEFAULTS = { burstCount: 3, chargeTime: 0.8, pierce: 0, beamWidth: 0, rampMax: 1, rampTime: 1, boltSpeed: 130 };

export const PLASMA_REPEATER: WeaponDef = {
  ...WEAPON_DEFAULTS,
  id: 'plasma_repeater',
  name: 'PLASMA REPEATER',
  family: 'plasma',
  mechanism: 'auto',
  damage: 13,
  fireRate: 9.5,
  range: 140,
  heatPerShot: 6.2,
  coolRate: 55,
  coolDelay: 0.22,
  overheatRecover: 30,
  spreadMin: 0.002,
  spreadMax: 0.028,
  spreadPerShot: 0.0035,
  spreadRecover: 0.09,
  recoilPitch: 0.0055,
};

/** Precision accelerator: charged slugs that pierce, long cycle, big heat spikes. */
export const RAILGUN: WeaponDef = {
  ...WEAPON_DEFAULTS,
  id: 'railgun',
  name: 'RAILGUN',
  family: 'rail',
  mechanism: 'charge',
  damage: 92,
  fireRate: 1.6,
  range: 240,
  heatPerShot: 26,
  coolRate: 40,
  coolDelay: 0.5,
  overheatRecover: 35,
  spreadMin: 0.0004,
  spreadMax: 0.01,
  spreadPerShot: 0.004,
  spreadRecover: 0.03,
  recoilPitch: 0.034,
  chargeTime: 0.8,
  pierce: 1,
};

/** Continuous emitter: damage ticks that ramp up on a held target, steady heat. */
export const BEAM_EMITTER: WeaponDef = {
  ...WEAPON_DEFAULTS,
  id: 'beam_emitter',
  name: 'BEAM EMITTER',
  family: 'beam',
  mechanism: 'beam',
  damage: 6.4,
  fireRate: 15,
  range: 60,
  heatPerShot: 1.45,
  coolRate: 48,
  coolDelay: 0.3,
  overheatRecover: 25,
  spreadMin: 0,
  spreadMax: 0,
  spreadPerShot: 0,
  spreadRecover: 0,
  recoilPitch: 0.0006,
  beamWidth: 0.35,
  rampMax: 2.2,
  rampTime: 1.6,
};

export type EnemyKind = 'walker' | 'rusher' | 'bulwark' | 'enforcer' | 'artillery' | 'engineer' | 'courier' | 'colossus' | 'overseer' | 'pylon' | 'jammer' | 'crawler';
/** Targeting role: reactor attackers march on the objective, hunters pressure the drone, support buffs allies. */
export type EnemyRole = 'reactor' | 'hunter' | 'support' | 'ranged' | 'hvt' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  shield: number;
  speed: number;
  radius: number;
  /** Body hit sphere: height above ground and radius. */
  bodyY: number;
  bodyR: number;
  /** Weakpoint (critical) hit sphere. */
  weakY: number;
  weakR: number;
  weakForward: number;
  reactorDamage: number;
  attackInterval: number;
  playerDamage: number;
  playerShotInterval: number;
  playerShotRange: number;
  reward: number;
  /** Persistent salvage collected on kill (unsecured until banked). */
  salvage: number;
  scale: number;
  /** M6 */
  role: EnemyRole;
  /** Display name height above the root for health bars / markers (m). */
  topY: number;
  /** Chill/freeze meter gain multiplier (bosses resist crowd control). */
  statusResist: number;
  /** Credits per kill (before tier). */
  credits: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  walker: {
    kind: 'walker',
    name: 'Strider',
    hp: 70,
    shield: 0,
    speed: 3.6,
    radius: 0.8,
    bodyY: 1.55,
    bodyR: 0.82,
    weakY: 2.55,
    weakR: 0.34,
    weakForward: 0.22,
    reactorDamage: 6,
    attackInterval: 1.6,
    playerDamage: 7,
    playerShotInterval: 2.6,
    playerShotRange: 26,
    reward: 7,
    salvage: 2,
    scale: 1,
    role: 'reactor',
    topY: 3.5,
    statusResist: 1,
    credits: 1,
  },
  rusher: {
    kind: 'rusher',
    name: 'Rush Drone',
    hp: 26,
    shield: 0,
    speed: 9.5,
    radius: 0.6,
    bodyY: 1.3,
    bodyR: 0.6,
    weakY: 1.3,
    weakR: 0.28,
    weakForward: 0.5,
    reactorDamage: 28,
    attackInterval: 0,
    playerDamage: 22,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 4,
    salvage: 1,
    scale: 1,
    role: 'hunter',
    topY: 2.1,
    statusResist: 1,
    credits: 0,
  },
  bulwark: {
    kind: 'bulwark',
    name: 'Bulwark',
    hp: 180,
    shield: 90,
    speed: 2.9,
    radius: 1.05,
    bodyY: 2.05,
    bodyR: 1.08,
    weakY: 3.35,
    weakR: 0.42,
    weakForward: 0.3,
    reactorDamage: 12,
    attackInterval: 1.8,
    playerDamage: 14,
    playerShotInterval: 2.2,
    playerShotRange: 30,
    reward: 20,
    salvage: 8,
    scale: 1.32,
    role: 'reactor',
    topY: 4.6,
    statusResist: 1,
    credits: 6,
  },
  /** Heavy chassis with a frontal energy shield; lowers it to slam. Breaks tower lines on its lane. */
  enforcer: {
    kind: 'enforcer',
    name: 'Shielded Enforcer',
    hp: 300,
    shield: 0,
    speed: 2.5,
    radius: 1.2,
    bodyY: 1.75,
    bodyR: 1.15,
    // Weakpoint = rear shield generator (also the chest vent while slamming, see EnemyManager).
    weakY: 2.25,
    weakR: 0.42,
    weakForward: -0.85,
    reactorDamage: 16,
    attackInterval: 2.6,
    playerDamage: 20,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 16,
    salvage: 6,
    scale: 1.2,
    role: 'reactor',
    topY: 4.4,
    statusResist: 0.8,
    credits: 5,
  },
  /** Hover mortar platform: stops at range, charges telegraphed shells at the reactor or exposed towers. */
  artillery: {
    kind: 'artillery',
    name: 'Artillery Drone',
    hp: 120,
    shield: 45,
    speed: 3.4,
    radius: 1.0,
    bodyY: 3.3,
    bodyR: 1.0,
    weakY: 3.05,
    weakR: 0.36,
    weakForward: 0.75,
    reactorDamage: 34,
    attackInterval: 6.5,
    playerDamage: 26,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 12,
    salvage: 5,
    scale: 1,
    role: 'ranged',
    topY: 4.8,
    statusResist: 1,
    credits: 4,
  },
  /** M7: electronic-warfare drone that hunts towers and jams them. Fragile; weak dish in front. */
  jammer: {
    kind: 'jammer',
    name: 'Jammer Drone',
    hp: 95,
    shield: 30,
    speed: 4.6,
    radius: 0.9,
    bodyY: 4.4,
    bodyR: 0.95,
    weakY: 4.75,
    weakR: 0.36,
    weakForward: 0.6,
    reactorDamage: 6,
    attackInterval: 1,
    playerDamage: 0,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 14,
    salvage: 5,
    scale: 1,
    role: 'support',
    topY: 5.3,
    statusResist: 1,
    credits: 5,
  },
  /** M7: six-legged siege breacher with a frontal prow, rear carrier pods and a reactor drill. */
  crawler: {
    kind: 'crawler',
    name: 'Siege Crawler',
    hp: 820,
    shield: 0,
    speed: 1.7,
    radius: 1.7,
    bodyY: 1.35,
    bodyR: 1.45,
    weakY: 1.9,
    weakR: 0.55,
    weakForward: -1.5,
    reactorDamage: 46,
    attackInterval: 2.4,
    playerDamage: 0,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 30,
    salvage: 12,
    scale: 1,
    role: 'reactor',
    topY: 2.9,
    statusResist: 0.9,
    credits: 9,
  },
  /** Support unit: repairs, restores shields and empowers allies from behind the front line. */
  engineer: {
    kind: 'engineer',
    name: 'Support Engineer',
    hp: 150,
    shield: 30,
    speed: 3.3,
    radius: 0.9,
    bodyY: 1.6,
    bodyR: 0.85,
    weakY: 2.35,
    weakR: 0.38,
    weakForward: 0.1,
    reactorDamage: 5,
    attackInterval: 2,
    playerDamage: 0,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 14,
    salvage: 6,
    scale: 1,
    role: 'support',
    topY: 3.7,
    statusResist: 1,
    credits: 5,
  },
  /** High-value target: circles the facility, phase-shields and escapes if not destroyed in time. */
  courier: {
    kind: 'courier',
    name: 'Vault Courier',
    hp: 520,
    shield: 260,
    speed: 7,
    radius: 1.3,
    bodyY: 6.8,
    bodyR: 1.25,
    weakY: 6.35,
    weakR: 0.45,
    weakForward: 1.05,
    reactorDamage: 0,
    attackInterval: 3.4,
    playerDamage: 18,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 60,
    salvage: 30,
    scale: 1,
    role: 'hvt',
    topY: 8.6,
    statusResist: 0.5,
    credits: 40,
  },
  /** Boss: multi-legged siege platform. Numbers are the base for encounter 1 (see survival/bosses.ts). */
  colossus: {
    kind: 'colossus',
    name: 'Siege Colossus',
    hp: 5200,
    shield: 0,
    speed: 1.9,
    radius: 3.8,
    bodyY: 6.1,
    bodyR: 3.6,
    weakY: 4.3,
    weakR: 1.1,
    weakForward: -3.9,
    reactorDamage: 40,
    attackInterval: 3,
    playerDamage: 30,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 250,
    salvage: 120,
    scale: 1,
    role: 'boss',
    topY: 11.5,
    statusResist: 0.3,
    credits: 160,
  },
  /** Overseer shield emitter: orbits its core; while any emitter lives the core is shielded. */
  pylon: {
    kind: 'pylon',
    name: 'Shield Emitter',
    hp: 240,
    shield: 0,
    speed: 0,
    radius: 0.9,
    bodyY: 0,
    bodyR: 0.85,
    weakY: 0,
    weakR: 0.35,
    weakForward: 0.6,
    reactorDamage: 0,
    attackInterval: 0,
    playerDamage: 0,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 10,
    salvage: 0,
    scale: 1,
    role: 'support',
    topY: 1.4,
    statusResist: 0.6,
    credits: 0,
  },
  /** Boss: floating command core behind shield emitters. */
  overseer: {
    kind: 'overseer',
    name: 'Overseer Core',
    hp: 4400,
    shield: 0,
    speed: 6,
    radius: 4,
    bodyY: 0,
    bodyR: 3.0,
    weakY: 0,
    weakR: 0.9,
    weakForward: 1.6,
    reactorDamage: 30,
    attackInterval: 3,
    playerDamage: 24,
    playerShotInterval: 0,
    playerShotRange: 0,
    reward: 250,
    salvage: 120,
    scale: 1,
    role: 'boss',
    topY: 4,
    statusResist: 0.3,
    credits: 160,
  },
};

export interface TowerDef {
  id: string;
  name: string;
  cost: number;
  range: number;
  damage: number;
  fireRate: number;
  turnRate: number; // radians per second
  buildTime: number;
  radius: number;
  refundRatio: number;
}

export const SENTINEL: TowerDef = {
  id: 'sentinel',
  name: 'SENTINEL TURRET',
  cost: 100,
  range: 22,
  damage: 15,
  fireRate: 3.2,
  turnRate: 5,
  buildTime: 0.8,
  radius: 1.1,
  refundRatio: 0.75,
};

/** Sentinel cost after construction-efficiency modifiers. */
export function towerCost(def: TowerDef, costMult: number): number {
  return Math.max(1, Math.round(def.cost * (Number.isFinite(costMult) ? costMult : 1)));
}

export const ECONOMY = {
  startingCores: 150,
  reactorMaxHp: 1000,
  reactorRepairPerWave: 0.06,
  playerMaxHp: 100,
  playerRespawnTime: 4,
  /** Salvage for clearing wave n: base + n * perWave (before tier multiplier). */
  salvageWaveBase: 4,
  salvagePerWave: 1,
};
