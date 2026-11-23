// Server-side validation of synced run entries (architecture v2 step 5). Solo runs are simulated by the
// device, so the rules worker checks what a run claims before applying it:
//   - every banked drop must be an item the run's own loot stream produces (replayLoot re-rolls each
//     recorded roll from the run id + node arena seed, at the recorded stream position);
//   - drop sources are known tables with bounded overrides, tier loot numbers are clamped;
//   - merchant stock (the only items outside the stream) must be a genuine generator output, at most epic;
//   - resources, XP, kills and timing must fit generous per-wave ceilings.
// It cannot stop a client that fishes run ids for a lucky stream, but it rejects edited or invented items and
// edited resource numbers, which is what matters for a loot game. Co-op runs are server-simulated (no check).
import { masteryTotal } from './mastery';
import { mulberry32 } from '../combat/damage';
import { DROP_SOURCES, type DropSource } from '../loot/drops';
import { generateItem, hashSeed } from '../loot/generate';
import { RARITIES, type RarityId } from '../loot/rarity';
import { rollLoot } from '../loot/roll';
import type { ItemInstance } from '../loot/types';
import { getTier, lootLevel, MAX_RIFT_LEVEL } from './tiers';
import { MAX_PITY } from '../loot/roll';
import type { Rewards, RunResult } from './run';
import type { LootRecord, RunEntry } from './runRules';
import { deployBlocker, type SaveData } from './save';
import { regionNode } from '../war/regions';

/** Generous per-wave ceilings (x tier factor): only edited numbers exceed them. */
export const CEILINGS = {
  creditsPerWave: (w: number) => 600 + 60 * w,
  salvagePerWave: (w: number) => 500 + 50 * w,
  componentsPerWave: (w: number) => 8 + Math.floor(w / 5),
  shardsPerWave: 12,
  xpPerWave: (w: number) => 3000 + 300 * w,
  /** Mastery XP per wave (all families together; a boss is worth 300). */
  masteryPerWave: (w: number) => 1500 + 40 * w,
  itemsPerWave: 40,
  killsPerWave: 220,
  /** Fastest plausible wave (seconds). */
  minWaveSeconds: 6,
  /** Highest luck a node can stack on a tier (elite node, survival, acts, orders, blessings). */
  luckFactor: 4,
  maxOverrideRarity: 'epic' as RarityId,
} as const;

/** Reward ceilings grow with the level (salvage x1.12 per level above Apex, so this stays generous). */
const tierFactor = (tier: number) => (1 + 0.75 * Math.max(0, tier - 1)) * Math.max(1, getTier(Math.min(MAX_RIFT_LEVEL, tier)).salvageMult / 5);
const rank = (r: RarityId | undefined) => (r ? RARITIES.findIndex((x) => x.id === r) : -1);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .filter((k) => k !== 'acquiredAt' && (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Same item (every rolled number), ignoring the acquisition timestamp. */
export const sameItem = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

/** A recorded drop source must be a known table with only bounded overrides. */
export function validSource(src: DropSource): string | null {
  const base = DROP_SOURCES[src.id as keyof typeof DROP_SOURCES] as DropSource | undefined;
  if (!base) return `unknown drop source ${src.id}`;
  if (!(src.chance >= 0 && src.chance <= 1)) return 'drop chance out of range';
  if (!(Number.isInteger(src.rolls) && src.rolls >= 1 && src.rolls <= Math.max(3, base.rolls))) return 'too many rolls';
  if (!(src.luck >= 0 && src.luck <= base.luck + 1.5)) return 'drop luck out of range';
  if (src.levelBonus !== base.levelBonus || src.guaranteedThroughWave !== base.guaranteedThroughWave) return 'drop source altered';
  if (JSON.stringify(src.exclusive ?? null) !== JSON.stringify(base.exclusive ?? null)) return 'drop source altered';
  if (src.minRarity !== base.minRarity && rank(src.minRarity) > rank(CEILINGS.maxOverrideRarity)) return 'rarity floor too high';
  const keys = (o: object) => Object.keys(o).sort().join(',');
  if (keys(src.categories) !== keys(base.categories)) return 'drop categories altered';
  return null;
}

function validTier(t: LootRecord['tier'], runTier: number, surge: number): string | null {
  const id = t.id ?? runTier;
  // A map run's Rift Surges raise the level for the rest of the run (at most `surge` levels above the deploy level).
  if (!Number.isInteger(id) || id < runTier || id > runTier + surge) return 'tier mismatch';
  const tier = getTier(id);
  if (t.lootLevelBonus !== tier.lootLevelBonus) return 'loot level altered';
  if (!(t.lootLuck > 0 && t.lootLuck <= tier.lootLuck * CEILINGS.luckFactor)) return 'loot luck out of range';
  return null;
}

/** Node arena seed for a map run's node id (the salt of that node's loot stream). */
function nodeSalt(mapSeed: number, node: string | null): number | null {
  if (node === null) return 0;
  if (!mapSeed) return null;
  return regionNode(mapSeed, node)?.seed ?? null;
}

/** Re-roll every recorded drop; returns the items the run genuinely produced (by uid) or a reason. */
export function replayLoot(runId: string, runTier: number, mapSeed: number, records: LootRecord[], surge = 0, locks: readonly string[] = []): Map<string, ItemInstance> | string {
  const want = [...locks].sort().join(',');
  const out = new Map<string, ItemInstance>();
  if (records.length > 5000) return 'loot journal too long';
  for (const r of records) {
    if (!Number.isInteger(r.draw) || r.draw < 0 || r.draw > 2_000_000 || !Number.isInteger(r.counter) || r.counter < 0) return 'bad loot record';
    if (!Number.isInteger(r.wave) || r.wave < 1 || r.wave > 100_000) return 'bad loot wave';
    if (r.pity !== undefined && !(Number.isInteger(r.pity) && r.pity >= 0 && r.pity <= MAX_PITY)) return 'bad loot record';
    // Locks narrow the loot pool, so they must be exactly the run's own (a client could otherwise target-farm).
    if ((Array.isArray(r.locks) ? [...r.locks].sort().join(',') : '') !== want) return 'loot locks altered';
    const bad = validSource(r.source) ?? validTier(r.tier, runTier, surge);
    if (bad) return bad;
    const salt = nodeSalt(mapSeed, r.node);
    if (salt === null) return `unknown map node ${r.node}`;
    const stream = mulberry32((hashSeed(runId) ^ salt) >>> 0);
    for (let i = 0; i < r.draw; i++) stream();
    let counter = r.counter;
    const items = rollLoot({ source: r.source, wave: r.wave, tier: r.tier, rand: stream, nextUid: () => `${runId}.${++counter}`, originId: runId, faction: r.faction, pity: r.pity ?? 0, locks: r.locks });
    for (const it of items) out.set(it.uid, it);
  }
  return out;
}

/** Merchant stock bought in a hub node: a genuine generator output for its own seed, at most epic. */
function validMerchantItem(runId: string, item: ItemInstance, maxLevel: number): boolean {
  if (!item.uid.startsWith(`${runId}.m`) || rank(item.rarity) > rank('epic') || item.level > maxLevel) return false;
  const again = generateItem({ uid: item.uid, seed: item.seed, level: item.level, rarity: item.rarity, category: item.category, source: runId });
  return sameItem(again, item);
}

function within(name: string, v: number | undefined, max: number): string | null {
  const x = v ?? 0;
  if (!Number.isFinite(x) || x < 0) return `${name} invalid`;
  return x > max ? `${name} above what ${name === 'xp' ? 'the run earned' : 'the waves pay'}` : null;
}

function checkRewards(d: SaveData, runId: string, tier: number, mapSeed: number, rewards: Rewards, loot: LootRecord[], waves: { from: number; to: number }, surge = 0): string | null {
  const locks = d.activeRun?.id === runId ? (d.activeRun.locks ?? []) : [];
  const span = Math.max(1, waves.to - waves.from);
  const f = tierFactor(tier + surge) * span;
  const top = Math.max(1, waves.to);
  const bad =
    within('credits', rewards.credits, CEILINGS.creditsPerWave(top) * f) ??
    within('salvage', rewards.salvage, CEILINGS.salvagePerWave(top) * f) ??
    within('components', rewards.components, CEILINGS.componentsPerWave(top) * f) ??
    within('shards', rewards.shards, CEILINGS.shardsPerWave * f) ??
    within('xp', rewards.xp, CEILINGS.xpPerWave(top) * f) ??
    within('mastery', masteryTotal(rewards.mastery), CEILINGS.masteryPerWave(top) * f);
  if (bad) return bad;
  const items = rewards.items ?? [];
  if (items.length > CEILINGS.itemsPerWave * span) return 'more items than the waves drop';
  if (!items.length) return null;
  const produced = replayLoot(runId, tier, mapSeed, loot, surge, locks);
  if (typeof produced === 'string') return produced;
  const owned = new Set(d.items.map((i) => i.uid));
  const seen = new Set<string>();
  const maxLevel = lootLevel(getTier(tier + surge), top) + 12;
  for (const item of items) {
    if (!item || typeof item.uid !== 'string' || seen.has(item.uid) || owned.has(item.uid)) return 'duplicate item';
    seen.add(item.uid);
    const genuine = produced.get(item.uid);
    if (genuine ? !sameItem(genuine, item) : !validMerchantItem(runId, item, maxLevel)) return `item ${item.uid} was not produced by this run`;
  }
  return null;
}

function checkResult(d: SaveData, r: RunResult): string | null {
  const a = d.activeRun;
  if (!a || a.id !== r.id) return d.history.some((h) => h.id === r.id) ? null : 'no such run';
  const waves = Math.max(0, r.wavesCleared);
  if (!Number.isFinite(r.duration) || r.duration < 0) return 'bad run duration';
  if (waves > 0 && r.duration < waves * CEILINGS.minWaveSeconds) return 'waves cleared faster than possible';
  if (r.kills > (waves + 1) * CEILINGS.killsPerWave) return 'more kills than the waves hold';
  return within('xp', r.xpKept, CEILINGS.xpPerWave(Math.max(1, waves)) * tierFactor(a.tier) * Math.max(1, waves));
}

/** Validate a run entry against the server's copy of the profile. Null = acceptable. */
export function checkRunEntry(d: SaveData, e: RunEntry, now: number): string | null {
  if (!e || typeof e !== 'object') return 'malformed entry';
  const a = d.activeRun;
  switch (e.kind) {
    case 'start':
      if (typeof e.runId !== 'string' || !/^[\w.-]{1,64}$/.test(e.runId)) return 'bad run id';
      if (!Number.isInteger(e.tier) || e.tier < 1 || e.tier > MAX_RIFT_LEVEL || e.tier > d.threat.unlocked) return 'tier locked';
      if (d.history.some((h) => h.id === e.runId) || a?.id === e.runId) return 'run already started';
      if (e.mode !== 'defense' && e.mode !== 'survival') return 'bad mode';
      if (!Number.isInteger(e.mapSeed)) return 'bad map seed';
      if (e.at > now + 10 * 60_000) return 'run starts in the future';
      return deployBlocker(d);
    case 'bank':
      if (!a || a.id !== e.runId) return 'no such run';
      if (!Number.isInteger(e.wave) || e.wave <= a.bankedThroughWave) return 'already banked';
      if (!Number.isInteger(e.bosses) || e.bosses < 0 || e.bosses > e.wave) return 'bad boss count';
      return checkRewards(d, a.id, a.tier, a.map?.seed ?? 0, e.rewards, e.loot ?? [], { from: a.bankedThroughWave, to: e.wave }, a.map?.surge ?? 0);
    case 'nodeBank': {
      if (!a || a.id !== e.runId || !a.map) return 'no such map run';
      const wave = a.map.carry?.wave ?? a.bankedThroughWave;
      return checkRewards(d, a.id, a.tier, a.map.seed, e.rewards, e.loot ?? [], { from: Math.max(0, wave - 5), to: Math.max(1, wave) }, a.map.surge ?? 0);
    }
    case 'map':
      return a && a.id === e.runId && a.map ? null : 'no such map run';
    case 'end':
      return checkResult(d, e.result);
    case 'interrupt':
      return null;
    default:
      return 'unknown run entry';
  }
}

