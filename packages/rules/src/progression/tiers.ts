/**
 * Threat tiers: configurable difficulty multipliers layered on top of the wave
 * generator. Higher tiers are unlocked by securing a checkpoint on the tier below.
 * Loot: `lootLevelBonus` raises every item level (a tier-II wave beats the same tier-I
 * wave) and `lootLuck` improves rarity odds; `salvageMult` scales salvage rewards.
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
  /** Added to every dropped item level. */
  lootLevelBonus: number;
  /** Rarity luck multiplier for every drop. */
  lootLuck: number;
  // ---- M6 survival director parameters
  /** Encounter budget multiplier (more and heavier enemies per wave). */
  budgetMult: number;
  /** Elite frequency multiplier. */
  eliteRate: number;
  /** Most elite modifiers one enemy may carry on this tier. */
  maxMods: number;
  /** Dynamic event frequency multiplier. */
  eventRate: number;
  /** Earliest wave a boss can be scheduled. */
  bossFirstWave: number;
  /** Boss health/damage multiplier on top of hpMult/damageMult (bosses already inherit those). */
  bossPower: number;
  /** Waves at which new enemy archetypes appear are pulled earlier by this many waves. */
  unlockShift: number;
  /** Unlock rule for the NEXT tier: clear `wave` on this tier (banked), optionally having destroyed a boss in that run. */
  unlockNext: { wave: number; boss: boolean } | null;
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
    lootLevelBonus: 0,
    lootLuck: 1,
    budgetMult: 1,
    eliteRate: 1,
    maxMods: 2,
    eventRate: 1,
    bossFirstWave: 10,
    bossPower: 1,
    unlockShift: 0,
    unlockNext: { wave: 5, boss: false },
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
    lootLevelBonus: 8,
    lootLuck: 1.35,
    budgetMult: 1.15,
    eliteRate: 1.35,
    maxMods: 2,
    eventRate: 1.15,
    bossFirstWave: 9,
    bossPower: 1.1,
    unlockShift: 1,
    unlockNext: { wave: 5, boss: false },
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
    lootLevelBonus: 18,
    lootLuck: 1.8,
    budgetMult: 1.3,
    eliteRate: 1.8,
    maxMods: 3,
    eventRate: 1.3,
    bossFirstWave: 8,
    bossPower: 1.2,
    unlockShift: 2,
    unlockNext: { wave: 15, boss: false },
  },
  {
    id: 4,
    name: 'NIGHTMARE',
    roman: 'IV',
    blurb: 'Elite-saturated assault groups and early command machines. Built for veteran drones.',
    hpMult: 3.4,
    damageMult: 2.1,
    speedMult: 1.16,
    countMult: 1.5,
    salvageMult: 3.6,
    lootLevelBonus: 32,
    lootLuck: 2.4,
    budgetMult: 1.45,
    eliteRate: 2.5,
    maxMods: 3,
    eventRate: 1.5,
    bossFirstWave: 7,
    bossPower: 1.35,
    unlockShift: 3,
    unlockNext: { wave: 20, boss: true },
  },
  {
    id: 5,
    name: 'APEX',
    roman: 'V',
    blurb: 'The rift at full aperture. Every wave carries elites, bosses return sooner and stronger.',
    hpMult: 5.6,
    damageMult: 2.7,
    speedMult: 1.2,
    countMult: 1.6,
    salvageMult: 5.2,
    lootLevelBonus: 50,
    lootLuck: 3.2,
    budgetMult: 1.6,
    eliteRate: 3.4,
    maxMods: 3,
    eventRate: 1.7,
    bossFirstWave: 6,
    bossPower: 1.55,
    unlockShift: 4,
    unlockNext: null,
  },
];

/**
 * Does banking `wave` on `tier` (with `bosses` bosses destroyed this run) unlock the next tier?
 * Configurable per tier (`unlockNext`).
 */
export function unlocksNextTier(tierId: number, wave: number, bosses: number): boolean {
  const rule = getTier(tierId).unlockNext;
  if (!rule || tierId >= THREAT_TIERS.length) return false;
  return wave >= rule.wave && (!rule.boss || bosses > 0);
}

/** Human-readable unlock requirement for tier `id` (shown on locked tier cards). */
export function unlockText(id: number): string {
  const prev = THREAT_TIERS[id - 2];
  if (!prev?.unlockNext) return '';
  const r = prev.unlockNext;
  return `Secure the wave-${r.wave} checkpoint on Tier ${prev.roman}${r.boss ? ' and destroy a boss in that run' : ''} to unlock.`;
}

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
