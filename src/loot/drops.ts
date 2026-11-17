import { clampLevel } from './generate';
import { type RarityId, rollRarity } from './rarity';
import type { Category } from './types';

/**
 * Drop tables (pure data + rolls). A reward source decides how often it drops, which
 * categories it favours, how lucky its rarity rolls are and how far above the wave its
 * item level sits. Sources can list exclusive bases (target farming: Bulwark Plating
 * only drops from Bulwarks). Boss sources are data-only until bosses exist.
 */
export interface DropSource {
  id: string;
  label: string;
  /** Probability that each roll produces an item. */
  chance: number;
  /** Independent rolls per trigger. */
  rolls: number;
  /** Added to the item level. */
  levelBonus: number;
  /** Rarity luck multiplier (see rollRarity). */
  luck: number;
  minRarity?: RarityId;
  categories: Partial<Record<Category, number>>;
  /** Exclusive bases this source can drop and the chance a matching-category drop uses one. */
  exclusive?: { baseId: string; category: Category; chance: number }[];
  /** Waves up to which `chance` is treated as 1 (first-loot guarantee). */
  guaranteedThroughWave?: number;
}

const ALL: Partial<Record<Category, number>> = { weapon: 3, armor: 3, shield: 2.5, reactor: 2, processor: 2, accessory: 2, module: 1.6 };

export const DROP_SOURCES = {
  walker: { id: 'walker', label: 'Strider', chance: 0.085, rolls: 1, levelBonus: 0, luck: 1, categories: ALL },
  rusher: {
    id: 'rusher',
    label: 'Rush Drone',
    chance: 0.05,
    rolls: 1,
    levelBonus: -1,
    luck: 1,
    categories: { accessory: 4, reactor: 3, processor: 2.5, weapon: 2, shield: 1.5, armor: 1, module: 1.6 },
  },
  bulwark: {
    id: 'bulwark',
    label: 'Bulwark (elite)',
    chance: 0.55,
    rolls: 1,
    levelBonus: 2,
    luck: 1.9,
    minRarity: 'uncommon',
    categories: { armor: 5, shield: 4, weapon: 2, reactor: 1.5, processor: 1, accessory: 1, module: 2 },
    exclusive: [{ baseId: 'bulwark_plating', category: 'armor', chance: 0.5 }],
  },
  wave: { id: 'wave', label: 'Wave cleared', chance: 0.4, rolls: 1, levelBonus: 1, luck: 1.25, categories: ALL, guaranteedThroughWave: 1 },
  checkpoint: { id: 'checkpoint', label: 'Checkpoint cache', chance: 1, rolls: 2, levelBonus: 3, luck: 1.6, minRarity: 'rare', categories: ALL },
  boss: { id: 'boss', label: 'Boss', chance: 1, rolls: 3, levelBonus: 5, luck: 2.6, minRarity: 'epic', categories: ALL },
} as const satisfies Record<string, DropSource>;

export type DropSourceId = keyof typeof DROP_SOURCES;

export interface LootContext {
  wave: number;
  /** Threat tier loot parameters. */
  tierLevelBonus: number;
  tierLuck: number;
}

export interface DropSpec {
  source: string;
  category: Category;
  baseId?: string;
  level: number;
  rarity: RarityId;
  seed: number;
}

/** Item level for a drop: wave + tier bonus + source bonus + a small (-1..+2) variation. */
export function itemLevelFor(ctx: LootContext, levelBonus: number, rand: () => number): number {
  const variance = Math.floor(rand() * 4) - 1;
  return clampLevel(Math.max(1, Math.floor(ctx.wave)) + ctx.tierLevelBonus + levelBonus + variance);
}

/** Rarity luck grows gently with waves (+1.2% per wave) on top of tier and source luck. */
export function luckFor(source: DropSource, ctx: LootContext): number {
  return source.luck * ctx.tierLuck * (1 + 0.012 * Math.max(0, ctx.wave - 1));
}

function pickCategory(weights: Partial<Record<Category, number>>, rand: () => number): Category {
  const entries = Object.entries(weights) as [Category, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [c, w] of entries) {
    x -= w;
    if (x < 0) return c;
  }
  return entries[entries.length - 1][0];
}

/** Roll a source's drops. Pure: all randomness comes from `rand`. */
export function rollDrops(source: DropSource, ctx: LootContext, rand: () => number): DropSpec[] {
  const out: DropSpec[] = [];
  const guaranteed = source.guaranteedThroughWave !== undefined && ctx.wave <= source.guaranteedThroughWave;
  for (let i = 0; i < source.rolls; i++) {
    if (!guaranteed && rand() >= source.chance) continue;
    const category = pickCategory(source.categories, rand);
    const ex = source.exclusive?.find((e) => e.category === category);
    const baseId = ex && rand() < ex.chance ? ex.baseId : undefined;
    out.push({
      source: source.id,
      category,
      baseId,
      level: itemLevelFor(ctx, source.levelBonus, rand),
      rarity: rollRarity(rand, luckFor(source, ctx), source.minRarity),
      seed: Math.floor(rand() * 4294967296) >>> 0,
    });
  }
  return out;
}
