/** Damage-state thresholds (fraction of max HP lost): smoke, then spitting sparks, then flames. */
export const WOUND = { smoke: 0.45, sparks: 0.65, fire: 0.8 } as const;

/** Wound severity 0..1 from remaining HP (0 while above the smoke threshold). */
export function woundSeverity(hp: number, maxHp: number): number {
  if (!(maxHp > 0) || !Number.isFinite(hp)) return 0;
  const lost = 1 - Math.max(0, Math.min(1, hp / maxHp));
  return lost < WOUND.smoke ? 0 : Math.min(1, (lost - WOUND.smoke) / (1 - WOUND.smoke) + 0.05);
}

/** Severities at which spitting sparks and flames start (derived from WOUND, so the thresholds live in one place). */
export const SEV_SPARKS = woundSeverity(1 - WOUND.sparks, 1);
export const SEV_FIRE = woundSeverity(1 - WOUND.fire, 1);
