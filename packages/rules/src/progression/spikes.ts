// Big spikes (docs/design/progression-design.md §7): the codex (first finds, with teasers and a one-time shard bonus),
// Rift Level breakthroughs (a guaranteed cache + title every fifth level), pinnacle keys (RL 8+: a key summons a
// pinnacle boss) and Rift War victory caches (liberated regions pay everyone who fought there). Pure.
import { mulberry32 } from '../combat/damage';
import type { WeaponFamily } from '../data/defs';
import { baseDef } from '../loot/bases';
import { generateItem, hashSeed } from '../loot/generate';
import { RARITIES, RARITY_UNLOCK, rarity, rarityCeiling, type RarityId } from '../loot/rarity';
import type { Category, ItemInstance } from '../loot/types';
import { UNIQUES } from '../loot/uniques';
import { getTier, levelBase } from './tiers';

// ------------------------------------------------------------------ codex

export type CodexKind = 'unique' | 'rarity' | 'family';

export interface CodexEntry {
  id: string;
  kind: CodexKind;
  name: string;
  /** Where it comes from (shown on the teaser before it is found). */
  hint: string;
  /** One-time rift shard bonus for the first find. */
  shards: number;
}

const FAMILY_LABEL: Record<WeaponFamily, string> = { plasma: 'Plasma Repeater', rail: 'Railgun', beam: 'Beam Emitter', swarm: 'Drone Swarm', launcher: 'Launcher', flamer: 'Flamer' };

export const CODEX: readonly CodexEntry[] = [
  ...(['plasma', 'rail', 'beam', 'swarm', 'launcher', 'flamer'] as WeaponFamily[]).map((f) => ({ id: `family:${f}`, kind: 'family' as const, name: FAMILY_LABEL[f], hint: f === 'plasma' ? 'Your starting family.' : 'Opens on the unlock track; then drops anywhere.', shards: 1 })),
  ...RARITIES.filter((r) => r.index >= 2).map((r) => ({
    id: `rarity:${r.id}`,
    kind: 'rarity' as const,
    name: `First ${r.label.toLowerCase()} item`,
    hint: r.id === 'ascended' ? `Exotic drops from RL ${RARITY_UNLOCK.ascended} can be promoted; or ascend one at the workshop.` : `Drops from Rift Level ${RARITY_UNLOCK[r.id as RarityId]}${r.index <= 3 ? ' (one level earlier from bosses and caches)' : ''}.`,
    shards: [0, 0, 0, 1, 2, 3, 10][r.index],
  })),
  ...UNIQUES.map((u) => ({ id: `unique:${u.id}`, kind: 'unique' as const, name: u.name, hint: `${rarity(u.rarity).label} unique · ${u.drops.sources.join(', ')}${u.drops.faction ? ` (${u.drops.faction} sectors)` : ''} · from RL ${RARITY_UNLOCK[u.rarity]}.`, shards: u.rarity === 'exotic' ? 8 : 5 })),
];

const CODEX_IDS = new Set(CODEX.map((c) => c.id));

/** Codex ids an item counts for. */
export function codexIdsOf(it: Pick<ItemInstance, 'rarity' | 'defId' | 'uniqueId' | 'category'>): string[] {
  const out: string[] = [];
  if (rarity(it.rarity).index >= 2) out.push(`rarity:${it.rarity}`);
  const fam = it.category === 'weapon' ? baseDef(it.defId)?.weapon?.family : undefined;
  if (fam) out.push(`family:${fam}`);
  if (it.uniqueId) out.push(`unique:${it.uniqueId}`);
  return out.filter((id) => CODEX_IDS.has(id));
}

/** Entries the items discover that `found` does not have yet (in codex order). */
export function newCodexEntries(found: readonly string[], items: readonly Pick<ItemInstance, 'rarity' | 'defId' | 'uniqueId' | 'category'>[]): CodexEntry[] {
  const have = new Set(found);
  const ids = new Set(items.flatMap(codexIdsOf).filter((id) => !have.has(id)));
  return CODEX.filter((c) => ids.has(c.id));
}

export const sanitizeCodex = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && CODEX_IDS.has(x)))] : []);

// ------------------------------------------------------------------ breakthroughs

export const BREAKTHROUGH_EVERY = 5;

/** A breakthrough happens when RL `n` (a multiple of 5) is cleared, i.e. RL n+1 unlocks. */
export const isBreakthrough = (cleared: number): boolean => cleared >= BREAKTHROUGH_EVERY && cleared % BREAKTHROUGH_EVERY === 0;

const TITLES = ['Rift Breaker', 'Rift Strider', 'Rift Reaver', 'Rift Sovereign', 'Rift Eternal'];
export const breakthroughTitle = (cleared: number): string => {
  const k = Math.floor(cleared / BREAKTHROUGH_EVERY);
  return k <= TITLES.length ? TITLES[k - 1] : `${TITLES[TITLES.length - 1]} ${k - TITLES.length + 1}`;
};

/** Highest breakthrough title earned (null before RL 5 is cleared). */
export function titleOf(breakthroughs: readonly number[]): string | null {
  const top = Math.max(0, ...breakthroughs);
  return top ? breakthroughTitle(top) : null;
}

const CACHE_CATS: Category[] = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory'];

/** One step above what an ordinary drop of the level can be (capped at exotic). */
export function breakthroughRarity(cleared: number): RarityId {
  const ceiling = rarity(rarityCeiling(cleared)).index;
  return RARITIES[Math.min(5, ceiling + 1)].id;
}

/**
 * The breakthrough cache item: deterministic per profile and level (the server and every device grant the same
 * item), top of the cleared level's item range. `locks` keeps locked families and mastery components out.
 */
export function breakthroughItem(profileId: string, cleared: number, locks: { families?: readonly string[]; components?: readonly string[] } = {}): ItemInstance {
  const seed = hashSeed(`breakthrough|${profileId}|${cleared}`);
  const rand = mulberry32(seed);
  const category = CACHE_CATS[Math.floor(rand() * CACHE_CATS.length)];
  return generateItem({
    uid: `bt${cleared}_${profileId.slice(-8)}`,
    seed,
    level: levelBase(cleared) + 9,
    rarity: breakthroughRarity(cleared),
    category,
    source: 'breakthrough',
    excludeFamilies: locks.families,
    componentLocks: locks.components,
    now: 0,
  });
}

export const breakthroughShards = (cleared: number): number => 10 + 2 * Math.floor(cleared / BREAKTHROUGH_EVERY);

// ------------------------------------------------------------------ pinnacle keys and bosses

export const PINNACLE = {
  /** Keys drop and pinnacle runs open from this Rift Level. */
  minRl: 8,
  /** Key chance per elite kill on RL 8+ (plus per modifier). */
  keyChance: (mods: number) => 0.012 + 0.006 * Math.max(0, mods),
  /** Crafting one key at the fabricator (rift shards). */
  craftShards: 20,
  /** The pinnacle boss fights at this many levels above the run. */
  levelBonus: 2,
  maxKeys: 99,
} as const;

/** The pinnacle boss of a run (seed-decided). */
export const pinnacleBoss = (runId: string): 'colossus' | 'overseer' => (hashSeed(`pinnacle|${runId}`) % 2 === 0 ? 'colossus' : 'overseer');

export const pinnacleBlocker = (keys: number, rl: number): string | null =>
  rl < PINNACLE.minRl ? `Pinnacle bosses open at Rift Level ${PINNACLE.minRl}` : keys < 1 ? 'No pinnacle key: elites on RL 8+ drop them, or craft one for rift shards' : null;

// ------------------------------------------------------------------ Rift War victory caches

/** The cache a liberated region pays a warden who secured sectors there (deterministic per profile + region). */
export function warCacheItem(profileId: string, region: number, unlocked: number, locks: { families?: readonly string[]; components?: readonly string[] } = {}): ItemInstance {
  const seed = hashSeed(`warcache|${profileId}|${region}`);
  const rand = mulberry32(seed);
  const rl = Math.max(1, unlocked);
  return generateItem({
    uid: `wc${region}_${profileId.slice(-8)}`,
    seed,
    level: getTier(rl).lootLevelBonus + 9,
    rarity: rarityCeiling(rl, 1),
    category: CACHE_CATS[Math.floor(rand() * CACHE_CATS.length)],
    source: 'warcache',
    excludeFamilies: locks.families,
    componentLocks: locks.components,
    now: 0,
  });
}

export const warCacheShards = (region: number): number => 6 + 2 * Math.max(0, region);
