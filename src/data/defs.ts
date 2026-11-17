/** Data-driven content definitions. */

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  fireRate: number; // shots per second
  range: number;
  heatPerShot: number;
  coolRate: number; // heat per second while cooling
  coolDelay: number; // seconds after last shot before cooling starts
  overheatRecover: number; // heat level at which overheat lockout ends
  spreadMin: number; // radians
  spreadMax: number;
  spreadPerShot: number;
  spreadRecover: number; // radians per second
  recoilPitch: number; // radians per shot
}

export const PLASMA_REPEATER: WeaponDef = {
  id: 'plasma_repeater',
  name: 'PLASMA REPEATER',
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

export type EnemyKind = 'walker' | 'rusher' | 'bulwark';

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
