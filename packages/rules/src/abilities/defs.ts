/**
 * Abilities: two cooldown slots (grenades, blink, aegis) and one ultimate charged by damage dealt. The ability
 * itself comes from an equipped item (category 'ability' / 'ultimate'); its strength follows the item's level and
 * rarity (no extra persisted roll), and affixes / the skill tree / run upgrades scale every ability through
 * `abilityPowerMult`, `abilityCooldownMult`, `abilityRadiusMult` and `ultChargeMult`.
 * Pure: numbers and rules only, the arena runtime (`arena/Abilities.ts`) applies them.
 */
import type { CombatStats } from '../combat/stats';
import { flatScale } from '../loot/generate';
import { rarity } from '../loot/rarity';
import type { ItemInstance } from '../loot/types';

export type AbilityKind = 'frag' | 'cryo' | 'emp' | 'blink' | 'aegis' | 'wall' | 'decoy' | 'sentry' | 'orbital' | 'overdrive';
/** Abilities that place something in the world (arena/Deployables). */
export const DEPLOYABLE_KINDS: readonly AbilityKind[] = ['wall', 'decoy', 'sentry'];
export type AbilitySlot = 'ability' | 'ability2' | 'ultimate';
export const ABILITY_SLOTS: readonly AbilitySlot[] = ['ability', 'ability2', 'ultimate'];

export interface AbilityDef {
  kind: AbilityKind;
  name: string;
  /** Which item category carries it. */
  category: 'ability' | 'ultimate';
  /** Seconds between uses (abilities). */
  cooldown: number;
  /** Damage dealt (at item level 1) that fills the ultimate. */
  charge: number;
  /** Level-1 strength: blast damage, shield points or (overdrive) seconds. */
  power: number;
  /** Effect radius (m); 0 = none. */
  radius: number;
  /** Short description for item cards and the HUD. */
  blurb: string;
}

export const ABILITIES: Record<AbilityKind, AbilityDef> = {
  frag: { kind: 'frag', name: 'Frag Charge', category: 'ability', cooldown: 8, charge: 0, power: 70, radius: 5, blurb: 'Lobbed charge: bursts on impact (or after 1.6 s) for heavy thermal blast damage that ignites.' },
  cryo: { kind: 'cryo', name: 'Cryo Charge', category: 'ability', cooldown: 10, charge: 0, power: 28, radius: 6, blurb: 'Lobbed charge: a frost burst that chills hard (freezes most frames) and deals light damage.' },
  emp: { kind: 'emp', name: 'Arc Pulse', category: 'ability', cooldown: 12, charge: 0, power: 34, radius: 7, blurb: 'Instant electric pulse around the drone: shocks everything near, triple damage to shields.' },
  blink: { kind: 'blink', name: 'Blink Drive', category: 'ability', cooldown: 5, charge: 0, power: 10, radius: 0, blurb: 'Instant jump along your aim (up to 10 m, stops at walls), keeps your momentum.' },
  aegis: { kind: 'aegis', name: 'Aegis Cell', category: 'ability', cooldown: 16, charge: 0, power: 60, radius: 0, blurb: 'Instant overshield and 50% damage resistance for 4 s.' },
  wall: { kind: 'wall', name: 'Shield Wall', category: 'ability', cooldown: 14, charge: 0, power: 6, radius: 3, blurb: 'Projects a 6 m energy barrier where you aim: blocks enemy fire and line of sight for 6 s; your shots pass through.' },
  decoy: { kind: 'decoy', name: 'Holo Decoy', category: 'ability', cooldown: 15, charge: 0, power: 160, radius: 24, blurb: 'Drops a holographic drone that draws the fire of every machine within 24 m until it is destroyed (7 s).' },
  sentry: { kind: 'sentry', name: 'Mini-Sentry', category: 'ability', cooldown: 20, charge: 0, power: 12, radius: 0, blurb: 'Deploys a free Sentinel turret where you aim for 12 s. It does not block lanes and cannot be refitted.' },
  orbital: { kind: 'orbital', name: 'Orbital Lance', category: 'ultimate', cooldown: 0, charge: 1400, power: 420, radius: 9, blurb: 'Marks the aim point; 1.2 s later a lance from orbit erases everything in the zone.' },
  overdrive: { kind: 'overdrive', name: 'Overdrive Core', category: 'ultimate', cooldown: 0, charge: 1200, power: 8, radius: 0, blurb: 'For a few seconds: +60% fire rate, no weapon heat, +20% movement speed.' },
};

/** One HUD row per equipped slot. */
export interface AbilityHudRow {
  slot: AbilitySlot;
  name: string;
  kind: string;
  /** Seconds left (abilities) or 0..1 charge (ultimate). */
  cd: number;
  max: number;
  ready: boolean;
  active: number;
}

export const ABILITY_KINDS = Object.keys(ABILITIES) as AbilityKind[];

/** Aegis resistance and duration; Overdrive multipliers. */
export const AEGIS = { resist: 0.5, seconds: 4 } as const;
export const OVERDRIVE = { fireRate: 0.6, move: 0.2 } as const;
/** Blink keeps this much distance from the wall it stops at (m). */
export const BLINK_MARGIN = 0.9;
/** Grenade throw: speed (m/s), upward boost, gravity, fuse (s). */
export const THROW = { speed: 24, lift: 5, gravity: 26, fuse: 1.6 } as const;
/** Deployables: furthest placement along the aim (m), wall height, decoy lifetime (s). */
export const DEPLOY = { range: 16, wallHeight: 3.4, decoySeconds: 7 } as const;

/**
 * Deployable strength. Wall and sentry: seconds (rarity x sqrt(power), like overdrive: a level-scaled duration would
 * grow without bound). Decoy: hit points (level-scaled like flat stats).
 */
export function deployPower(def: AbilityDef, item: Pick<ItemInstance, 'level' | 'rarity'>, stats: Pick<CombatStats, 'abilityPowerMult'>): number {
  if (def.kind === 'decoy') return def.power * itemFactor(item) * stats.abilityPowerMult;
  return def.power * rarity(item.rarity).baseMult * Math.sqrt(stats.abilityPowerMult);
}

/**
 * Where a deployable lands: `range` along the aim, or just short of the first level hit (`hitAt`, metres), never
 * closer than 1.5 m. Returns the distance along the aim; the caller drops the point to the ground.
 */
export function deployDistance(range: number, hitAt: number | null): number {
  const d = hitAt === null ? range : Math.min(range, hitAt - 0.8);
  return Math.max(1.5, d);
}

/** Orbital Lance delay between the mark and the strike (s). */
export const ORBITAL_DELAY = 1.2;

/** Item strength factor: level scaling (as flat stats) x rarity base multiplier. */
export function itemFactor(item: Pick<ItemInstance, 'level' | 'rarity'>): number {
  return flatScale(item.level) * rarity(item.rarity).baseMult;
}

/** Effective strength of an ability item for a stat block. */
export function abilityPower(def: AbilityDef, item: Pick<ItemInstance, 'level' | 'rarity'>, stats: Pick<CombatStats, 'abilityPowerMult'>): number {
  // Overdrive's power is a duration: it grows with rarity only (level would make it permanent).
  if (def.kind === 'overdrive') return def.power * rarity(item.rarity).baseMult * Math.sqrt(stats.abilityPowerMult);
  if (def.kind === 'blink') return def.power;
  if (def.kind === 'wall' || def.kind === 'decoy' || def.kind === 'sentry') return deployPower(def, item, stats);
  return def.power * itemFactor(item) * stats.abilityPowerMult;
}

export function abilityCooldown(def: AbilityDef, stats: Pick<CombatStats, 'abilityCooldownMult'>): number {
  return def.cooldown * stats.abilityCooldownMult;
}

export function abilityRadius(def: AbilityDef, stats: Pick<CombatStats, 'abilityRadiusMult'>): number {
  return def.radius * stats.abilityRadiusMult;
}

/** Damage needed to fill the ultimate (grows with the item level so it keeps pace with enemy health). */
export function ultChargeNeeded(def: AbilityDef, item: Pick<ItemInstance, 'level'>): number {
  return def.charge * flatScale(item.level);
}

/** Charge fraction a hit adds (0..1 of a full bar). */
export function ultGain(damage: number, needed: number, stats: Pick<CombatStats, 'ultChargeMult'>): number {
  if (!(damage > 0) || !(needed > 0)) return 0;
  return (damage * stats.ultChargeMult) / needed;
}

/**
 * Where a blink lands: `dist` along the aim, stopped `BLINK_MARGIN` short of the first wall hit (null = clear).
 * Never negative, never longer than the clear path.
 */
export function blinkDistance(dist: number, wallAt: number | null): number {
  const clear = wallAt === null ? dist : Math.min(dist, wallAt - BLINK_MARGIN);
  return Math.max(0, clear);
}

/** Simple ballistic step for thrown charges (returns the new velocity y). */
export function throwStep(pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, dt: number): void {
  vel.y -= THROW.gravity * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;
}
