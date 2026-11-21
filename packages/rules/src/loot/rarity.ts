/**
 * Rarity configuration (pure data). Rarity shapes an item but never fully determines
 * its quality: affix tiers and rolls overlap between rarities, so a well-rolled Rare
 * can beat a poorly rolled Epic of the same level.
 */
export type RarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'exotic' | 'ascended';

export interface RarityDef {
  id: RarityId;
  /** 0 = common ... 5 = exotic, 6 = ascended. */
  index: number;
  label: string;
  /** Relative drop weight before luck (see rollRarity). */
  weight: number;
  /** Inclusive affix count range. */
  affixes: [number, number];
  /** Raises the floor of every roll inside its range (0 = full range, 0.5 = upper half). */
  quality: number;
  /** Skews affix tiers upward (0 = favours low tiers). */
  tierBias: number;
  /** Guaranteed minimum tier for the best affix (0 = none). */
  minTopTier: number;
  /** Multiplier on base (implicit) stats. */
  baseMult: number;
  /** Multiplier on every affix value ("overclocked" exotics). */
  affixMult: number;
  /** Weapon module sockets (configurable; only weapons have sockets). */
  sockets: number;
  /** UI / world colours. */
  color: string;
  /** Linear RGB glow for unlit materials (values > 1 bloom). */
  glow: [number, number, number];
  /** Pickup beam height in metres (0 = no beam). */
  beam: number;
}

export const RARITIES: readonly RarityDef[] = [
  { id: 'common', index: 0, label: 'Common', weight: 620, affixes: [0, 1], quality: 0, tierBias: 0, minTopTier: 0, baseMult: 1, affixMult: 1, sockets: 0, color: '#c4d0d6', glow: [0.9, 1.0, 1.05], beam: 0 },
  { id: 'uncommon', index: 1, label: 'Uncommon', weight: 260, affixes: [1, 2], quality: 0.08, tierBias: 0.25, minTopTier: 0, baseMult: 1.04, affixMult: 1, sockets: 1, color: '#5fe07a', glow: [0.35, 2.2, 0.55], beam: 2.2 },
  { id: 'rare', index: 2, label: 'Rare', weight: 95, affixes: [2, 3], quality: 0.16, tierBias: 0.55, minTopTier: 2, baseMult: 1.08, affixMult: 1, sockets: 2, color: '#46a8ff', glow: [0.4, 1.3, 3.2], beam: 4 },
  { id: 'epic', index: 3, label: 'Epic', weight: 28, affixes: [3, 4], quality: 0.24, tierBias: 0.9, minTopTier: 3, baseMult: 1.12, affixMult: 1, sockets: 3, color: '#b866ff', glow: [1.9, 0.6, 3.6], beam: 6 },
  { id: 'legendary', index: 4, label: 'Legendary', weight: 6, affixes: [4, 4], quality: 0.32, tierBias: 1.4, minTopTier: 4, baseMult: 1.16, affixMult: 1.05, sockets: 4, color: '#ffc23d', glow: [4.2, 2.4, 0.35], beam: 9 },
  { id: 'exotic', index: 5, label: 'Exotic', weight: 1.2, affixes: [4, 5], quality: 0.4, tierBias: 2, minTopTier: 5, baseMult: 1.2, affixMult: 1.15, sockets: 4, color: '#ff4f86', glow: [4.6, 0.7, 2.2], beam: 12 },
  /**
   * Chase tier above Exotic: never rolled by weight (0). An exotic drop is promoted (see `ascendDrop` in drops.ts:
   * deep waves / high tiers only, ~1 in 10 exotics) or an Exotic is ascended at the HQ for rift shards. Exotic rolls
   * plus one extra affix at the level's top tier with a perfect roll (`generateItem` / `ascendItem`).
   */
  { id: 'ascended', index: 6, label: 'Ascended', weight: 0, affixes: [4, 5], quality: 0.46, tierBias: 2.4, minTopTier: 5, baseMult: 1.24, affixMult: 1.18, sockets: 4, color: '#7ef9ff', glow: [2.6, 4.8, 5.4], beam: 16 },
];

export const RARITY_IDS: readonly RarityId[] = RARITIES.map((r) => r.id);

const BY_ID = new Map(RARITIES.map((r) => [r.id, r]));

/** M7 colour accessibility: rarity colours swapped in place (UI and world glows read them on use). */
const ORIGINAL = RARITIES.map((r) => ({ color: r.color, glow: [...r.glow] }));
const CB: Record<'deuteranopia' | 'tritanopia', { color: string; glow: [number, number, number] }[]> = {
  deuteranopia: [
    { color: '#c4d0d6', glow: [0.9, 1.0, 1.05] },
    { color: '#3fd6e0', glow: [0.3, 2.0, 2.2] },
    { color: '#3b6dff', glow: [0.4, 0.8, 3.6] },
    { color: '#c58cff', glow: [1.9, 0.8, 3.6] },
    { color: '#ffd23d', glow: [4.2, 3.0, 0.35] },
    { color: '#ff7a2e', glow: [4.6, 1.6, 0.3] },
    { color: '#f4f4ff', glow: [4.4, 4.4, 5.2] },
  ],
  tritanopia: [
    { color: '#c4d0d6', glow: [0.9, 1.0, 1.05] },
    { color: '#5fe07a', glow: [0.35, 2.2, 0.55] },
    { color: '#2ec4ff', glow: [0.3, 1.8, 3.2] },
    { color: '#ff6fd8', glow: [3.2, 0.7, 2.6] },
    { color: '#ff5a3d', glow: [4.4, 1.0, 0.5] },
    { color: '#ffffff', glow: [3.6, 3.6, 3.6] },
    { color: '#ffe14d', glow: [4.8, 4.0, 0.6] },
  ],
};
export function setRarityPalette(mode: 'off' | 'deuteranopia' | 'tritanopia'): void {
  const src = mode === 'off' ? ORIGINAL : CB[mode];
  RARITIES.forEach((r, i) => {
    (r as { color: string }).color = src[i].color;
    (r as { glow: [number, number, number] }).glow = [...src[i].glow] as [number, number, number];
  });
}

export function rarity(id: RarityId | string | undefined): RarityDef {
  return BY_ID.get(id as RarityId) ?? RARITIES[0];
}

export function isRarity(id: unknown): id is RarityId {
  return typeof id === 'string' && BY_ID.has(id as RarityId);
}

/** Luck never pushes weights beyond this factor per rarity step (keeps exotics exotic). */
export const MAX_LUCK = 4;

/**
 * Weighted rarity roll. `luck` (>= 1 improves odds) multiplies the weight of rarity i by
 * luck^i, so high rarities gain the most. `min` excludes rarities below it.
 */
export function rollRarity(rand: () => number, luck = 1, min: RarityId = 'common'): RarityId {
  const l = Math.min(MAX_LUCK, Math.max(0.25, Number.isFinite(luck) ? luck : 1));
  const lo = rarity(min).index;
  let total = 0;
  const w: number[] = [];
  for (const r of RARITIES) {
    const v = r.index < lo ? 0 : r.weight * Math.pow(l, r.index);
    w.push(v);
    total += v;
  }
  let x = rand() * total;
  for (let i = 0; i < w.length; i++) {
    x -= w[i];
    if (x < 0) return RARITIES[i].id;
  }
  // Float leftovers land on the highest rarity that can roll by weight (never a weight-0 tier).
  for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return RARITIES[i].id;
  return RARITIES[0].id;
}

/** Exact probability of each rarity for a given luck (tests and the codex UI). */
export function rarityOdds(luck = 1, min: RarityId = 'common'): Record<RarityId, number> {
  const l = Math.min(MAX_LUCK, Math.max(0.25, luck));
  const lo = rarity(min).index;
  const w = RARITIES.map((r) => (r.index < lo ? 0 : r.weight * Math.pow(l, r.index)));
  const total = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(RARITIES.map((r, i) => [r.id, w[i] / total])) as Record<RarityId, number>;
}
