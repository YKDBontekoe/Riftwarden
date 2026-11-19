import type { StatKey } from '../combat/stats';

/**
 * What every stat does in play (pure). Shown as tooltips wherever a stat appears
 * (item details, comparisons, drone configuration). One sentence each, written against
 * the actual systems that read the stat.
 */
export const STAT_HELP: Readonly<Record<StatKey, string>> = {
  weaponDamageMult: 'Multiplies the damage of every weapon shot, tick and pellet.',
  fireRateMult: 'Multiplies shots (or beam ticks) per second. Heat per shot is unchanged, so faster fire overheats sooner.',
  critChance: 'Chance for a body hit to crit. Weakpoint hits always crit.',
  critMultiplier: 'Damage multiplier of a critical hit.',
  heatEfficiency: 'Divides the heat each shot generates: more shots before overheating.',
  coolRateMult: 'Multiplies how fast the weapon sheds heat once you stop firing.',
  moveSpeedMult: 'Multiplies run and sprint speed of the drone.',
  dashRechargeMult: 'Multiplies how fast dash charges refill.',
  maxHealthBonus: 'Flat hull points added before hull multipliers.',
  maxHealthMult: 'Multiplies total hull integrity.',
  armor: 'Reduces incoming damage; its value is measured against the enemy level, so it keeps pace with deeper waves.',
  damageResist: 'Flat share of incoming damage removed after armor (combined reduction capped at 80%).',
  shieldCapacity: 'Shield points absorbed before the hull takes damage.',
  shieldRegen: 'Shield points restored per second once the regen delay has passed.',
  shieldDelay: 'Seconds without taking damage before the shield starts regenerating.',
  turretDamageMult: 'Multiplies the damage of every deployed tower.',
  turretFireRateMult: 'Multiplies the attack rate of every deployed tower.',
  turretRangeMult: 'Multiplies the targeting range of every deployed tower.',
  buildCostMult: 'Multiplies the core cost of building and refitting towers (lower is better).',
  tacticalRechargeMult: 'Multiplies how fast tactical energy (time dilation) refills.',
  projectiles: 'Extra projectiles per shot, each dealing full damage (scatter adds 2 pellets per projectile).',
  spreadMult: 'Multiplies spread and recoil (lower is tighter).',
  chargeRateMult: 'Speeds up rail charge time and beam damage ramp.',
  arcChance: 'Chance per hit to arc lightning to a nearby enemy.',
  arcDamage: 'Damage of the arc as a share of the hit that caused it.',
  heatDamage: 'Bonus damage that scales with current heat, reaching this value at full heat.',
  pierce: 'Extra enemies a shot passes through (−15% damage per enemy).',
  rangeMult: 'Multiplies weapon range.',
  coreIncomeMult: 'Multiplies cores earned from kills and wave clears in the arena.',
  elementalPower: 'Multiplies elemental status strength (burn, shock, chill) and reaction damage.',
  eliteDamageMult: 'Multiplies damage against elites, bosses and high-value targets.',
};
