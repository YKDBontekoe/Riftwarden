// Item sets (M11, pure). Rare+ gear can belong to one of four sets; equipping two or four pieces of the same set
// (distinct items) adds its bonuses to the stat block. Membership is decided by the item seed alone (no draw from the
// generator's stream), so adding sets never shifts the other rolls of a seed.
import type { StatKey, StatModifier, StatOp } from '../combat/stats';
import type { Category, ItemInstance } from './types';

export type SetId = 'bastion' | 'deadeye' | 'conflux' | 'architect';
export const SET_IDS: readonly SetId[] = ['bastion', 'deadeye', 'conflux', 'architect'];

export interface SetBonus {
  pieces: 2 | 4;
  text: string;
  mods: { stat: StatKey; op: StatOp; value: number }[];
}

export interface SetDef {
  id: SetId;
  name: string;
  /** Build it serves (item cards, codex). */
  theme: string;
  blurb: string;
  bonuses: readonly SetBonus[];
}

export const SETS: Readonly<Record<SetId, SetDef>> = {
  bastion: {
    id: 'bastion', name: 'Bastion Protocol', theme: 'Tank', blurb: 'Siege plating standard: hold the line and outlast everything.',
    bonuses: [
      { pieces: 2, text: '+15% hull', mods: [{ stat: 'maxHealthMult', op: 'pct', value: 0.15 }] },
      { pieces: 4, text: '+6% damage resistance, +25% shield capacity', mods: [{ stat: 'damageResist', op: 'add', value: 0.06 }, { stat: 'shieldCapacity', op: 'pct', value: 0.25 }] },
    ],
  },
  deadeye: {
    id: 'deadeye', name: 'Deadeye Array', theme: 'Critical hits', blurb: 'Marksman targeting suite: every shot finds the seam.',
    bonuses: [
      { pieces: 2, text: '+5% critical chance', mods: [{ stat: 'critChance', op: 'add', value: 0.05 }] },
      { pieces: 4, text: '+35% critical damage, +6% weapon damage', mods: [{ stat: 'critMultiplier', op: 'add', value: 0.35 }, { stat: 'weaponDamageMult', op: 'pct', value: 0.06 }] },
    ],
  },
  conflux: {
    id: 'conflux', name: 'Conflux Lattice', theme: 'Elements', blurb: 'Rift-tuned conduits that feed every burn, chill and charge.',
    bonuses: [
      { pieces: 2, text: '+12% elemental power', mods: [{ stat: 'elementalPower', op: 'pct', value: 0.12 }] },
      { pieces: 4, text: '+20% elemental power, +10% heat efficiency', mods: [{ stat: 'elementalPower', op: 'pct', value: 0.2 }, { stat: 'heatEfficiency', op: 'pct', value: 0.1 }] },
    ],
  },
  architect: {
    id: 'architect', name: 'Architect Suite', theme: 'Towers', blurb: 'Field engineering rig: towers built faster, cheaper and meaner.',
    bonuses: [
      { pieces: 2, text: '+12% tower damage', mods: [{ stat: 'turretDamageMult', op: 'pct', value: 0.12 }] },
      { pieces: 4, text: '+15% tower fire rate, −10% construction cost', mods: [{ stat: 'turretFireRateMult', op: 'pct', value: 0.15 }, { stat: 'buildCostMult', op: 'pct', value: -0.1 }] },
    ],
  },
};

/** Gear that can be part of a set (not weapons, modules or abilities). */
export const SET_CATEGORIES: readonly Category[] = ['armor', 'shield', 'reactor', 'processor', 'accessory'];
/** Share of eligible rare+ drops that belong to a set. */
export const SET_CHANCE = 0.2;
/** Lowest rarity index (rare) that can belong to a set. */
export const SET_MIN_RARITY = 2;

export const isSetId = (v: unknown): v is SetId => typeof v === 'string' && (SET_IDS as readonly string[]).includes(v);

function mix(x: number): number {
  let h = (x ^ 0x51ed2701) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Target farming: drop sources (`DROP_SOURCES` ids) that favour a set. A drop from one of them belongs to a set at
 * `SET_FARM_CHANCE`, and to the favoured set `SET_FARM_BIAS` of the time.
 */
export const SET_SOURCES: Readonly<Record<SetId, readonly string[]>> = {
  bastion: ['bulwark', 'enforcer', 'crawler', 'burrower', 'colossus'],
  deadeye: ['marksman', 'artillery', 'skimmer', 'hvt'],
  conflux: ['elite', 'eliteCache', 'jammer', 'overseer'],
  architect: ['engineer', 'sapper', 'checkpoint'],
};
export const SET_FARM_CHANCE = 0.4;
export const SET_FARM_BIAS = 0.7;

/** The set a drop source favours, or null. */
export const favouredSet = (source: string | undefined): SetId | null => (source ? SET_IDS.find((id) => SET_SOURCES[id].includes(source)) ?? null : null);

/** The set an item of this seed / rarity / category (and drop source) belongs to, or null (seed-decided). */
export function setFor(seed: number, rarityIndex: number, category: Category, source?: string): SetId | null {
  if (rarityIndex < SET_MIN_RARITY || !SET_CATEGORIES.includes(category)) return null;
  const h = mix(seed >>> 0);
  const fav = favouredSet(source);
  if (h / 2 ** 32 >= (fav ? SET_FARM_CHANCE : SET_CHANCE)) return null;
  const pick = mix(h);
  if (fav && mix(pick) / 2 ** 32 < SET_FARM_BIAS) return fav;
  return SET_IDS[pick % SET_IDS.length];
}

/** Equipped pieces per set (distinct items). */
export function setCounts(items: readonly (Pick<ItemInstance, 'uid' | 'set'> | null | undefined)[]): Map<SetId, number> {
  const seen = new Set<string>();
  const out = new Map<SetId, number>();
  for (const it of items) {
    if (!it?.set || seen.has(it.uid)) continue;
    seen.add(it.uid);
    out.set(it.set, (out.get(it.set) ?? 0) + 1);
  }
  return out;
}

/** Bonuses that are active for the equipped items, per set. */
export function activeSetBonuses(items: readonly (Pick<ItemInstance, 'uid' | 'set'> | null | undefined)[]): { set: SetDef; pieces: number; bonuses: SetBonus[] }[] {
  const out: { set: SetDef; pieces: number; bonuses: SetBonus[] }[] = [];
  for (const [id, n] of setCounts(items)) out.push({ set: SETS[id], pieces: n, bonuses: SETS[id].bonuses.filter((b) => n >= b.pieces) });
  return out;
}

/** Stat modifiers of every active set bonus (part of the equipment stat block). */
export function setBonusModifiers(items: readonly (Pick<ItemInstance, 'uid' | 'set'> | null | undefined)[]): StatModifier[] {
  const out: StatModifier[] = [];
  for (const a of activeSetBonuses(items)) for (const b of a.bonuses) for (const m of b.mods) out.push({ ...m, source: `set:${a.set.id}` });
  return out;
}
