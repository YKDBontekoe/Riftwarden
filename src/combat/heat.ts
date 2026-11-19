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
