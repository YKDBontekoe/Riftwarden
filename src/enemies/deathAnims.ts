import { smoothstep } from '../visuals/anim';
import type { EnemyKind } from '../data/defs';

/** Seconds a destroyed enemy stays as a collapsing wreck before it bursts (kinds absent here burst at once). */
export const DEATH_TIME: Partial<Record<EnemyKind, number>> = {
  walker: 0.8,
  bulwark: 1.0,
  rusher: 0.6,
  enforcer: 0.9,
  artillery: 0.9,
  engineer: 0.8,
  jammer: 0.6,
};

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
