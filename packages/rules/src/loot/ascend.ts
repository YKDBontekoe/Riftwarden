import { STAT_DEFS } from '../combat/stats';
import { AFFIXES, affixPool, MAX_TIER } from './affixes';
import { baseDef } from './bases';
import { groupsOfStat, maxTierFor, pickWeighted, rollAffix } from './generate';
import { rarity } from './rarity';
import type { ItemInstance, RolledAffix } from './types';

/**
 * Ascension (pure): the chase tier above Exotic. An Ascended item is an Exotic with one extra affix at the level's
 * top tier and a perfect roll, slightly stronger rarity multipliers and its own finish/visuals. Drops come from
 * promoted exotics (`ascendDrop`); the HQ ascends an owned Exotic for rift shards (`ascendItem`, transaction in
 * economy/transactions.ts). Ascended items will be trade-locked once trading exists.
 */
export const ASCEND = {
  /** Promotion of an exotic drop from Rift Level `minTier`: one in `oneIn(rl)` (by the drop seed): 1/10 at RL 14, 1/5 from RL 19. */
  oneIn: (rl: number) => Math.max(5, 10 - Math.max(0, Math.floor(rl) - 14)),
  minTier: 14,
  /** HQ ascension cost: shards + credits + components (level scaled). */
  shards: (level: number) => 12 + Math.floor(Math.max(1, level) / 10),
  credits: (level: number) => Math.round(600 * (1 + 0.1 * (Math.max(1, level) - 1))),
  components: 10,
} as const;

export const isAscended = (it: Pick<ItemInstance, 'rarity'>): boolean => it.rarity === 'ascended';

/** Deterministic promotion of a rolled exotic drop (seed-based, so no random stream shifts). */
export function ascendDrop(seed: number, _wave: number, tier: number): boolean {
  if (!(tier >= ASCEND.minTier)) return false;
  return (Math.imul(seed >>> 0, 0x9e3779b1) >>> 0) % ASCEND.oneIn(tier) === 0;
}

/** The perfect affix an ascension adds: any compatible affix whose group the item does not use yet. */
export function perfectAffix(item: ItemInstance, rand: () => number): RolledAffix | null {
  const base = baseDef(item.defId);
  const used = new Set<string>([...item.base.flatMap((s) => groupsOfStat(s.stat)), ...item.affixes.map((a) => affixGroup(a.id))]);
  const pool = affixPool(item.category, used, base?.affixes);
  const a = pickWeighted(pool, (x) => x.weights[item.category] ?? 0, rand);
  if (!a) return null;
  return rollAffix(a, Math.min(MAX_TIER, maxTierFor(item.level)), 1, item.level, rarity('ascended'));
}

const affixGroup = (id: string): string => AFFIXES.find((a) => a.id === id)?.group ?? `id:${id}`;

const round = (v: number, flat: boolean) => (flat ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10) : Math.round(v * 1000) / 1000);

/** Why an item cannot be ascended (null = it can). */
export function ascendBlock(item: ItemInstance): string | null {
  if (item.rarity === 'ascended') return 'Already Ascended';
  if (item.rarity !== 'exotic') return 'Only Exotic items can ascend';
  if (item.uniqueId) return 'Unique items keep their identity and cannot ascend';
  return null;
}

/**
 * The ascended copy of an Exotic: rarity multipliers rescaled (exotic -> ascended), a perfect extra affix, the
 * ascended finish on weapons and an "Ascended" name prefix. Signature, sockets, modules and engineering state stay.
 */
export function ascendItem(item: ItemInstance, rand: () => number): ItemInstance | null {
  if (ascendBlock(item)) return null;
  const from = rarity(item.rarity);
  const to = rarity('ascended');
  const kb = to.baseMult / from.baseMult;
  const ka = to.affixMult / from.affixMult;
  const out: ItemInstance = structuredClone(item);
  out.rarity = 'ascended';
  out.base = item.base.map((s) => ({ ...s, value: s.value < 0 ? s.value : round(s.value * kb, STAT_DEFS[s.stat].kind === 'flat') }));
  out.affixes = item.affixes.map((a) => ({ ...a, value: a.value < 0 ? a.value : round(a.value * ka, STAT_DEFS[a.stat].kind === 'flat') }));
  if (out.weapon) out.weapon.damage = round(out.weapon.damage * kb, true);
  if (out.build) out.build.finish = 'ascended';
  const extra = perfectAffix(out, rand);
  if (extra) out.affixes.push(extra);
  if (!out.name.startsWith('Ascended ')) out.name = `Ascended ${out.name}`;
  return out;
}
