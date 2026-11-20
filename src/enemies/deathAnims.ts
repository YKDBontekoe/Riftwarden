import { smoothstep } from '../visuals/anim';
import type { EnemyKind } from '../data/defs';
import type { ExplosionStyle } from '../fx/explosionStyles';

/**
 * Seconds a destroyed enemy stays as a collapsing wreck before it bursts (kinds absent here burst at once).
 * Short on purpose: the kill pops immediately (sparks, debris, knock-back) and the wreck clears out of a fast fight.
 */
export const DEATH_TIME: Partial<Record<EnemyKind, number>> = {
  walker: 0.55,
  bulwark: 0.7,
  rusher: 0.4,
  enforcer: 0.65,
  artillery: 0.65,
  engineer: 0.55,
  jammer: 0.4,
  sapper: 0.45,
  skimmer: 0.3,
  marksman: 0.6,
  burrower: 0.6,
};

/** Initial knock-back speed (m/s) of a wreck away from the killing shot; it bleeds off at `WRECK_DRAG` per second. */
export function wreckKnock(kind: EnemyKind, scale: number, flying: boolean): number {
  if (kind === 'bulwark' || kind === 'enforcer') return 3.2;
  return (flying ? 8.5 : 6) / Math.max(0.6, scale);
}
export const WRECK_DRAG = 5;

export interface DeathPose {
  /** Forward pitch (rad), sideways roll (rad), sink (m) and flash strength 0..1. */
  pitch: number;
  roll: number;
  sink: number;
  flash: number;
}

/**
 * Pure death pose for progress k in 0..1. Walkers buckle forward and sink; flying drones roll
 * faster and drop with an accelerating fall. `seed` varies the roll direction per enemy.
 */
export function deathPose(flying: boolean, k: number, seed: number, out: DeathPose = { pitch: 0, roll: 0, sink: 0, flash: 0 }): DeathPose {
  const p = k < 0 ? 0 : k > 1 ? 1 : k;
  const side = seed % 2 === 0 ? 1 : -1;
  if (flying) {
    out.pitch = smoothstep(p) * 0.7;
    out.roll = side * p * p * 5.5;
    out.sink = p * p * 1.3;
  } else {
    out.pitch = smoothstep(p * 1.1) * 0.55;
    out.roll = side * smoothstep(p) * 0.18;
    out.sink = smoothstep(p) * smoothstep(p) * 0.55;
  }
  // Rapid flicker that gets faster toward the end.
  out.flash = 0.35 + 0.65 * Math.abs(Math.sin(p * p * 38));
  return out;
}

/** Kinds that hover (they spiral down instead of buckling). */
export const FLYERS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['rusher', 'jammer', 'artillery']);

/** Death blast per kind: [scale, debris, sound pitch, style]. */
export const BLAST: Partial<Record<EnemyKind, [number, number, number, ExplosionStyle?]>> = {
  rusher: [0.8, 6, 1.4, 'plasma'],
  walker: [1, 12, 1],
  bulwark: [1.6, 18, 0.75, 'heavy'],
  enforcer: [1.7, 20, 0.7, 'heavy'],
  artillery: [1.4, 14, 0.85],
  engineer: [1.2, 12, 1.1, 'electric'],
  courier: [2.4, 26, 0.6, 'plasma'],
  jammer: [1.0, 10, 1.3, 'electric'],
  crawler: [1.9, 20, 0.6, 'heavy'],
  sapper: [1.3, 10, 1, 'heavy'],
  skimmer: [0.55, 4, 1.6, 'plasma'],
  marksman: [1.1, 12, 1, 'electric'],
  burrower: [1.6, 16, 0.8],
};

/** Death blast identity: mutations override the archetype (frostbound shatters in ice, molten cooks off). */
export function deathStyle(kind: EnemyKind, mods: readonly string[], detonated: boolean): ExplosionStyle | undefined {
  if (mods.includes('frostbound')) return 'cryo';
  if (mods.includes('molten') || mods.includes('volatile') || detonated) return 'heavy';
  return BLAST[kind]?.[3];
}
