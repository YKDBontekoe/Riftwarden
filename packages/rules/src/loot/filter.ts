// Loot filter (Settings > Interface): which drops get an in-world label and go into the hold when holding use sweeps
// a pile. Presentation and convenience only: every drop still lands, and a tap on use still picks up the targeted one.
// Pure: rarity and the verdict flags in, a yes / no out.

export const LOOT_FILTERS = ['all', 'uncommon', 'rare', 'epic', 'upgrades'] as const;
export type LootFilter = (typeof LOOT_FILTERS)[number];

/** Minimum rarity index per threshold filter. */
const MIN_INDEX: Record<Exclude<LootFilter, 'upgrades'>, number> = { all: 0, uncommon: 1, rare: 2, epic: 3 };
/** Legendary and above always pass: they are rare enough to matter whatever the filter. */
const ALWAYS_INDEX = 4;

export interface FilterFlags {
  /** Would raise the build score (loot verdict). */
  upgrade: boolean;
  /** Beats the best owned item of its kind. */
  newBest: boolean;
  /** A hand-made unique. */
  unique: boolean;
}

export function passesLootFilter(filter: LootFilter, rarityIndex: number, f: FilterFlags): boolean {
  if (f.newBest || f.unique || rarityIndex >= ALWAYS_INDEX) return true;
  if (filter === 'upgrades') return f.upgrade;
  return rarityIndex >= MIN_INDEX[filter];
}
