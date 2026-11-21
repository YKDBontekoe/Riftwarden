/**
 * Run tempo: one place for the timings that decide how much dead time a run has. The game is tuned to be
 * fast-paced: short preparation phases (the call-in key skips them and pays a small bonus), a brief clear
 * celebration and a compressed spawn schedule, so the next fight is never far away. Pure data + helpers.
 */
export const PACE = {
  /** Preparation before wave 1 (s, real time). Panels (upgrade, checkpoint, towers) freeze the countdown. */
  prepFirst: 20,
  /** Preparation before every later wave (s). */
  prepNext: 12,
  /** "Wave cleared" celebration before the next preparation starts (s). */
  cleared: 1.6,
  /** Spawn schedule compression: every spawn time is multiplied by this (hostile time). */
  spawnTempo: 0.72,
  /** Cores paid per second of preparation skipped by calling the wave in early. */
  earlyCallCores: 2,
};

/** Preparation time for wave n. */
export function prepTime(n: number): number {
  return n <= 1 ? PACE.prepFirst : PACE.prepNext;
}

/** Bonus cores for calling a wave in with `remaining` seconds of preparation left (whole seconds only). */
export function earlyCallBonus(remaining: number): number {
  if (!(remaining > 0)) return 0;
  return Math.floor(remaining) * PACE.earlyCallCores;
}
