/**
 * Threat tiers: configurable difficulty multipliers layered on top of the wave
 * generator. Higher tiers are unlocked by securing a checkpoint on the tier below.
 * Loot-table effects belong to M2; `salvageMult` only scales the M1 salvage reward.
 */
export interface WaveScaling {
  /** Enemy health and shield multiplier. */
  hpMult: number;
  /** Damage dealt to the player and the reactor. */
  damageMult: number;
  /** Movement speed multiplier. */
  speedMult: number;
  /** Spawn count multiplier (per spawn group, rounded, at least 1). */
  countMult: number;
}

export interface ThreatTier extends WaveScaling {
  id: number;
  name: string;
  roman: string;
  blurb: string;
  /** Salvage reward multiplier. */
  salvageMult: number;
}

export const THREAT_TIERS: readonly ThreatTier[] = [
  {
    id: 1,
    name: 'STANDARD',
    roman: 'I',
    blurb: 'Baseline rift incursion. Machines arrive at documented strength.',
    hpMult: 1,
    damageMult: 1,
    speedMult: 1,
    countMult: 1,
    salvageMult: 1,
  },
  {
    id: 2,
    name: 'ADVANCED',
    roman: 'II',
    blurb: 'Hardened chassis and denser assault groups. Turret coverage is mandatory.',
    hpMult: 1.45,
    damageMult: 1.3,
    speedMult: 1.06,
    countMult: 1.2,
    salvageMult: 1.6,
  },
  {
    id: 3,
    name: 'EXTREME',
    roman: 'III',
    blurb: 'Overclocked machines in overwhelming numbers. Every mistake reaches the reactor.',
    hpMult: 2.1,
    damageMult: 1.65,
    speedMult: 1.12,
    countMult: 1.4,
    salvageMult: 2.4,
  },
];

export const NO_SCALING: WaveScaling = { hpMult: 1, damageMult: 1, speedMult: 1, countMult: 1 };

export function getTier(id: number): ThreatTier {
  return THREAT_TIERS.find((t) => t.id === id) ?? THREAT_TIERS[0];
}

/** Wave interval between checkpoints (bank + return-home opportunity). */
export const CHECKPOINT_INTERVAL = 5;

export function isCheckpointWave(wave: number): boolean {
  return wave > 0 && wave % CHECKPOINT_INTERVAL === 0;
}

export function nextCheckpoint(wave: number): number {
  return Math.ceil(Math.max(1, wave) / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;
}
