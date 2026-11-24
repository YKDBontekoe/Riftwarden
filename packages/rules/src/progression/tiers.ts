/**
 * Rift Levels (formerly threat tiers): endless difficulty the player picks. RL 1-5 are the hand-tuned
 * Standard..Apex tiers, every level above is generated (`getTier`). A level unlocks by banking the
 * unlock checkpoint on the level below (`unlocksNextTier`). Loot: the level sets the item level
 * (`levelBase`, `lootLevel`) and gates rarity (loot/rarity `rarityWeights`); `salvageMult` scales salvage.
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
  /** Item level at wave 1 of this Rift Level (`levelBase`): drops add up to +9 by wave (`lootLevel`). */
  lootLevelBonus: number;
  /** Rarity luck multiplier for every drop (1 on every level: rarity is gated by the level itself; node, act and mode effects move it). */
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
}

/** Growth of flat item stats with item level (mirrors loot/generate `flatScale`; a test pins them equal). */
export function itemScale(level: number): number {
  const l = Math.max(1, level) - 1;
  return 1 + 0.08 * l + 0.0009 * l * l;
}

/** Item level at wave 1 of Rift Level `rl`: 10 per level (see `lootLevel`). */
export function levelBase(rl: number): number {
  return 10 * (Math.max(1, Math.floor(rl)) - 1) + 1;
}

/**
 * Hostile hull and damage per Rift Level: they follow the item power curve of the level's drops
 * (`itemScale(levelBase)`, the growth of flat item stats) plus 5% / 3% per level. Gear of the level keeps pace;
 * the compounding extra is the soft wall that rarity, uniques, enhancement, mastery and the tree close.
 */
export function hullCurve(rl: number): number {
  return itemScale(levelBase(rl)) * Math.pow(1.05, Math.max(1, rl) - 1);
}
export function damageCurve(rl: number): number {
  return itemScale(levelBase(rl)) * Math.pow(1.03, Math.max(1, rl) - 1);
}

export const THREAT_TIERS: readonly ThreatTier[] = [
  {
    id: 1,
    name: 'STANDARD',
    roman: 'I',
    blurb: 'Baseline rift incursion. Machines arrive at documented strength.',
    hpMult: hullCurve(1),
    damageMult: damageCurve(1),
    speedMult: 1,
    countMult: 1,
    salvageMult: 1,
    lootLevelBonus: 1,
    lootLuck: 1,
    budgetMult: 1,
    eliteRate: 1,
    maxMods: 2,
    eventRate: 1,
    bossFirstWave: 10,
    bossPower: 1,
    unlockShift: 0,
  },
  {
    id: 2,
    name: 'ADVANCED',
    roman: 'II',
    blurb: 'Hardened chassis and denser assault groups. Turret coverage is mandatory.',
    hpMult: hullCurve(2),
    damageMult: damageCurve(2),
    speedMult: 1.06,
    countMult: 1.2,
    salvageMult: 1.6,
    lootLevelBonus: 11,
    lootLuck: 1,
    budgetMult: 1.15,
    eliteRate: 1.35,
    maxMods: 2,
    eventRate: 1.15,
    bossFirstWave: 9,
    bossPower: 1.1,
    unlockShift: 1,
  },
  {
    id: 3,
    name: 'EXTREME',
    roman: 'III',
    blurb: 'Overclocked machines in overwhelming numbers. Every mistake reaches the reactor.',
    hpMult: hullCurve(3),
    damageMult: damageCurve(3),
    speedMult: 1.12,
    countMult: 1.4,
    salvageMult: 2.4,
    lootLevelBonus: 21,
    lootLuck: 1,
    budgetMult: 1.3,
    eliteRate: 1.8,
    maxMods: 3,
    eventRate: 1.3,
    bossFirstWave: 8,
    bossPower: 1.2,
    unlockShift: 2,
  },
  {
    id: 4,
    name: 'NIGHTMARE',
    roman: 'IV',
    blurb: 'Elite-saturated assault groups and early command machines. Built for veteran drones.',
    hpMult: hullCurve(4),
    damageMult: damageCurve(4),
    speedMult: 1.16,
    countMult: 1.5,
    salvageMult: 3.6,
    lootLevelBonus: 31,
    lootLuck: 1,
    budgetMult: 1.45,
    eliteRate: 2.5,
    maxMods: 3,
    eventRate: 1.5,
    bossFirstWave: 7,
    bossPower: 1.35,
    unlockShift: 3,
  },
  {
    id: 5,
    name: 'APEX',
    roman: 'V',
    blurb: 'The rift at full aperture. Every wave carries elites, bosses return sooner and stronger.',
    hpMult: hullCurve(5),
    damageMult: damageCurve(5),
    speedMult: 1.2,
    countMult: 1.6,
    salvageMult: 5.2,
    lootLevelBonus: 41,
    lootLuck: 1,
    budgetMult: 1.6,
    eliteRate: 3.4,
    maxMods: 3,
    eventRate: 1.7,
    bossFirstWave: 6,
    bossPower: 1.55,
    unlockShift: 4,
  },
];

/** Rift Levels have no cap; this is only a numeric safety bound for stored values. */
export const MAX_RIFT_LEVEL = 999;

/** Named labels for the first five Rift Levels (the original threat tiers). */
export const NAMED_LEVELS = THREAT_TIERS.length;


/** Item level of drops at a wave of a Rift Level (before the source bonus and jitter). */
export function lootLevel(tier: Pick<ThreatTier, 'lootLevelBonus'>, wave: number): number {
  return tier.lootLevelBonus + Math.min(9, Math.floor(Math.max(0, wave - 1) / 2));
}

const roman = (n: number): string => {
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; } // prettier-ignore
  return out;
};

/** Short label: "RL 7". The first five also carry their tier name (STANDARD ... APEX). */
export const rlLabel = (id: number): string => `RL ${id}`;

const RL_WORDS = ['BREACH', 'FRACTURE', 'TORRENT', 'MAELSTROM', 'CATACLYSM', 'OBLIVION'];

const memo = new Map<number, ThreatTier>();

/**
 * Rift Level `id` (endless). RL 1-5 are the named tiers; every level above is generated with hull/damage on the
 * shared curve (`hullCurve`, `damageCurve`), encounter budget +3%, elite rate +4%, bosses +5% power per level and four
 * elite modifiers from RL 15. Rarity is gated by the level (loot/rarity `gatedWeights`), so
 * `lootLuck` stays 1 and only node/act/mode effects move it.
 */
function generate(id: number): ThreatTier {
  const top = THREAT_TIERS[THREAT_TIERS.length - 1];
  const k = id - top.id;
  const word = RL_WORDS[Math.min(RL_WORDS.length - 1, Math.floor((id - 6) / 5))];
  return {
    ...top,
    id,
    name: `${word} ${roman(id)}`,
    roman: roman(id),
    blurb: `Rift Level ${id}: beyond Apex. Machine hulls x${(hullCurve(id) / hullCurve(top.id)).toFixed(1)} of Apex; drops start at item level ${levelBase(id)}.`,
    hpMult: hullCurve(id),
    damageMult: damageCurve(id),
    speedMult: Math.min(1.35, top.speedMult + 0.01 * k),
    countMult: top.countMult,
    salvageMult: top.salvageMult * (1 + 0.12 * k),
    lootLevelBonus: levelBase(id),
    lootLuck: 1,
    budgetMult: top.budgetMult * (1 + 0.03 * k),
    eliteRate: top.eliteRate * (1 + 0.04 * k),
    maxMods: id >= 15 ? 4 : 3,
    eventRate: top.eventRate,
    bossFirstWave: top.bossFirstWave,
    bossPower: top.bossPower * (1 + 0.05 * k),
    unlockShift: top.unlockShift,
  };
}

/**
 * Checkpoints a player must secure on Rift Level `rl` to unlock the next one (a visible progress bar):
 * 1 on RL 1, 2 on RL 2-3, rising by one every two levels to 8 from RL 14. Checkpoints count on the level the run
 * played at when banking (deploy level + Rift Surges).
 */
export function checkpointsToUnlock(rl: number): number {
  return Math.min(8, 1 + Math.floor(Math.max(1, rl) / 2));
}

/** Does `checkpoints` secured on `rl` unlock the next level? */
export function unlocksNextTier(rl: number, checkpoints: number): boolean {
  return rl >= 1 && rl < MAX_RIFT_LEVEL && checkpoints >= checkpointsToUnlock(rl);
}

/** Human-readable unlock requirement for Rift Level `id` (shown on locked level cards). */
export function unlockText(id: number, have = 0): string {
  if (id <= 1) return '';
  const need = checkpointsToUnlock(id - 1);
  return `Secure ${need} checkpoint${need === 1 ? '' : 's'} on RL ${id - 1} to unlock (${Math.min(have, need)}/${need}).`;
}

export const NO_SCALING: WaveScaling = { hpMult: 1, damageMult: 1, speedMult: 1, countMult: 1 };

/** Rift Level `id` (1..MAX_RIFT_LEVEL); anything invalid is RL 1. */
export function getTier(id: number): ThreatTier {
  if (!Number.isInteger(id) || id < 1 || id > MAX_RIFT_LEVEL) return THREAT_TIERS[0];
  if (id <= THREAT_TIERS.length) return THREAT_TIERS[id - 1];
  let t = memo.get(id);
  if (!t) memo.set(id, (t = generate(id)));
  return t;
}

/** Wave interval between checkpoints (bank + return-home opportunity). */
export const CHECKPOINT_INTERVAL = 5;

export function isCheckpointWave(wave: number): boolean {
  return wave > 0 && wave % CHECKPOINT_INTERVAL === 0;
}

export function nextCheckpoint(wave: number): number {
  return Math.ceil(Math.max(1, wave) / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;
}
