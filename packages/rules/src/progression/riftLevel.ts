// Rift Level readiness (pure): how a loadout compares to a level's machines, the recommended level, and what a level
// drops (item levels, rarity gates). Used by the deploy terminal, the co-op lobby and the pacing simulation.
import { flatScale } from '../loot/generate';
import { gatedOdds, RARITIES, RARITY_UNLOCK, rarity, rarityCeiling, type RarityId } from '../loot/rarity';
import type { ItemInstance } from '../loot/types';
import { checkpointsToUnlock, getTier, levelBase, lootLevel } from './tiers';

/** Combat value of one item: flat stat growth at its level x its rarity's base multiplier and affix depth. */
export function itemPower(it: Pick<ItemInstance, 'level' | 'rarity'>): number {
  const r = rarity(it.rarity);
  return flatScale(it.level) * r.baseMult * (1 + 0.05 * r.index);
}

/** Gear slots that carry the loadout's power (abilities scale but do not make a drone sturdier). */
export const POWER_SLOTS = 7;

/** Average power of the equipped gear (empty slots count as a level-1 common). */
export function gearPower(items: readonly (Pick<ItemInstance, 'level' | 'rarity'> | null | undefined)[]): number {
  const base = itemPower({ level: 1, rarity: 'common' });
  const vals = items.filter((x): x is Pick<ItemInstance, 'level' | 'rarity'> => !!x).map(itemPower).sort((a, b) => b - a).slice(0, POWER_SLOTS);
  while (vals.length < POWER_SLOTS) vals.push(base);
  return vals.reduce((a, b) => a + b, 0) / POWER_SLOTS;
}

/** What a level asks of the loadout: machine hull x damage (gear power squared is damage x toughness). */
export const levelThreat = (rl: number): number => {
  const t = getTier(rl);
  return Math.sqrt(t.hpMult * t.damageMult);
};

export type Readiness = 'easy' | 'fair' | 'hard' | 'deadly';

/** Gear power over the level's threat (1 = matched; the tree, run upgrades and skill carry the rest). */
export const readinessRatio = (power: number, rl: number): number => power / (levelThreat(rl) * 0.9);

export function readiness(power: number, rl: number): Readiness {
  const r = readinessRatio(power, rl);
  return r >= 1.2 ? 'easy' : r >= 0.95 ? 'fair' : r >= 0.78 ? 'hard' : 'deadly';
}

/** Highest unlocked level the loadout matches (at least RL 1). */
export function recommendedLevel(power: number, unlocked: number): number {
  let best = 1;
  for (let rl = 1; rl <= unlocked; rl++) if (readinessRatio(power, rl) >= 0.95) best = rl;
  return best;
}

export interface LevelLoot {
  /** Item levels of ordinary drops (wave 1 .. deep waves). */
  levels: [number, number];
  /** Highest rarity an ordinary drop can have. */
  ceiling: RarityId;
  /** Odds per ordinary drop of epic, legendary, exotic. */
  odds: { epic: number; legendary: number; exotic: number };
  /** Next rarity that opens at a higher level, if any. */
  next: { rarity: RarityId; at: number } | null;
}

export function levelLoot(rl: number): LevelLoot {
  const t = getTier(rl);
  const o = gatedOdds(rl);
  const ceiling = rarityCeiling(rl);
  const nxt = RARITIES.find((r) => r.weight > 0 && RARITY_UNLOCK[r.id] > rl);
  return {
    levels: [levelBase(rl), lootLevel(t, 1e6)],
    ceiling,
    odds: { epic: o.epic, legendary: o.legendary, exotic: o.exotic },
    next: nxt ? { rarity: nxt.id, at: RARITY_UNLOCK[nxt.id] } : null,
  };
}

/** Progress toward unlocking the level above `unlocked` (checkpoints secured on `unlocked`). */
export function unlockProgress(records: Record<string, { checkpoints: number } | undefined>, unlocked: number): { level: number; have: number; need: number } {
  const need = checkpointsToUnlock(unlocked);
  return { level: unlocked + 1, have: Math.min(need, records[String(unlocked)]?.checkpoints ?? 0), need };
}
