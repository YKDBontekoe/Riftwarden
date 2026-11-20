/**
 * Global heat tempo, applied at fire time on top of every weapon's stored heat numbers (so existing items get
 * it too). Tuned for fast-paced play: longer bursts before overheating, quicker cool-down and a short lockout.
 * `weaponSummary` uses the same factors, so the item stats shown in terminals match what the trigger does.
 */
export const HEAT_PACE = {
  /** Heat per shot multiplier. */
  gain: 0.75,
  /** Cooling rate multiplier. */
  cool: 1.35,
  /** Delay after the last shot before cooling starts, multiplier. */
  delay: 0.7,
  /** Cooling speed while locked out by an overheat (fraction of the normal rate). */
  lockout: 1,
} as const;

/**
 * Global player weapon damage tempo (TTK pass), applied at fire time like `HEAT_PACE` so stored items keep their
 * rolls: a matched weapon kills a basic walker in ~0.3 s (starter repeater: 3 bolts). Towers are not affected,
 * so the player stays the main source of kills (FPS first).
 */
export const DAMAGE_PACE = 1.9;

/** Heat carried by a weapon that is not in hand. */
export interface HeatState {
  heat: number;
  overheated: boolean;
}

/**
 * A holstered weapon cools at its full rate with no delay (swapping is the way to keep firing while the other
 * one vents) and clears its overheat lockout at the same threshold as in hand.
 */
export function coolHolstered(s: HeatState, def: { coolRate: number; overheatRecover: number }, coolRateMult: number, dt: number): HeatState {
  const heat = Math.max(0, s.heat - def.coolRate * coolRateMult * HEAT_PACE.cool * dt);
  return { heat, overheated: s.overheated && heat > def.overheatRecover };
}
