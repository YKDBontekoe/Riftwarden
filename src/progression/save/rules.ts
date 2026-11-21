import { storageExpansionCost, STORAGE_EXPANSION } from '../../loot/economy';
import { rarity } from '../../loot/rarity';
import { fitsSlot, getSlot, type ItemInstance, SLOT_IDS, type SlotId, defaultSlot } from '../items';
import type { Rewards, RunResult } from '../run';
import { CHECKPOINT_INTERVAL, unlocksNextTier } from '../tiers';
import { dismantleYield, MAX_BALANCE } from '../../economy/config';
import { HISTORY_LIMIT, MAX_XP, RunHistoryEntry, STORAGE_CAPACITY, SaveData, TierRecord } from './types';
import { emptyRecord, rotateMarket } from './defaults';
import { sanitizeItem } from './sanitize';
import { allOwnedUids, equippedItem, itemByUid, slotOf } from './ownership';
import { newMapState, resumable, type RunMapState } from '../../runmap/state';
import { pathCode } from '../../runmap/map';

// ------------------------------------------------------------------ mutations (game rules)

export function selectTier(data: SaveData, tier: number): boolean {
  if (!Number.isInteger(tier) || tier < 1 || tier > data.threat.unlocked) return false;
  data.threat.selected = tier;
  return true;
}

export function record(data: SaveData, tier: number): TierRecord {
  const k = String(tier);
  return (data.records[k] ??= emptyRecord());
}

/** Turn a dangling active run (tab closed mid-run) into an 'interrupted' history entry. */
export function resolveInterruptedRun(data: SaveData, now = Date.now(), opts: { keepResumable?: boolean } = {}): RunHistoryEntry | null {
  const a = data.activeRun;
  if (!a) return null;
  // A map run closed after a completed node waits at the HQ for RESUME (single player only).
  if (opts.keepResumable && resumable(a.map)) return null;
  const entry: RunHistoryEntry = {
    id: a.id,
    tier: a.tier,
    outcome: 'interrupted',
    finalWave: Math.max(1, a.bankedThroughWave),
    wavesCleared: a.bankedThroughWave,
    kills: 0,
    duration: 0,
    salvageSecured: a.salvageSecured,
    salvageLost: 0,
    itemsSecured: a.itemsSecured,
    itemsLost: 0,
    endedAt: now,
    newRecord: false,
    creditsSecured: a.creditsSecured,
    componentsSecured: a.componentsSecured,
    bosses: [],
    elites: 0,
    deaths: 0,
    reactorDamage: 0,
    playerDamage: 0,
    towerDamage: 0,
    itemsCollected: 0,
    events: 0,
    milestones: [],
    records: [],
    dev: false,
    ...(a.mode === 'survival' ? { mode: 'survival' as const } : {}),
    ...(a.map ? { act: a.map.act, nodes: a.map.cleared, path: pathCode(a.map.path, a.map.seed) } : {}),
  };
  const rec = record(data, a.tier);
  if (a.map) noteMap(data, a.tier, { act: a.map.act, nodes: a.map.cleared, actsCleared: a.map.actsCleared });
  rec.runs++;
  rec.lastPlayedAt = now;
  data.totals.runs++;
  data.totals.interrupted++;
  data.history.unshift(entry);
  data.history = data.history.slice(0, HISTORY_LIMIT);
  data.activeRun = null;
  rotateMarket(data, now);
  return entry;
}

export function beginRun(data: SaveData, runId: string, tier: number, now = Date.now(), opts: { mapSeed?: number; mode?: 'defense' | 'survival' } = {}): void {
  resolveInterruptedRun(data, now);
  data.activeRun = { id: runId, tier, startedAt: now, bankedThroughWave: 0, salvageSecured: 0, itemsSecured: 0, creditsSecured: 0, componentsSecured: 0 };
  if (opts.mapSeed) {
    data.activeRun.map = newMapState(opts.mapSeed);
    data.activeRun.nodeBank = 0;
  }
  if (opts.mode === 'survival') data.activeRun.mode = 'survival';
}

/** Store the run map progress (node entered / completed, resume point). Only for the live run. */
export function saveMapProgress(data: SaveData, runId: string, map: RunMapState): boolean {
  const a = data.activeRun;
  if (!a || a.id !== runId || !a.map) return false;
  a.map = JSON.parse(JSON.stringify(map)) as RunMapState;
  return true;
}

/** Map records: deepest act, most nodes in a run, act bosses (all-time). */
function noteMap(data: SaveData, tier: number, m: { act: number; nodes: number; actsCleared: number }): void {
  const rec = record(data, tier);
  rec.deepestAct = Math.max(rec.deepestAct, m.act);
  rec.bestNodes = Math.max(rec.bestNodes, m.nodes);
  rec.actsCleared += m.actsCleared;
  data.totals.nodesCleared += m.nodes;
  data.totals.actsCleared += m.actsCleared;
}

/**
 * Commit rewards found at a map node after its checkpoint (hub visits, loot picked up after the last wave).
 * Guarded by the node step, so the same node can never be banked twice.
 */
export function bankNodeRewards(data: SaveData, runId: string, step: number, rewards: Pick<Rewards, 'salvage' | 'items'> & Partial<Rewards>): boolean {
  const a = data.activeRun;
  if (!a || a.id !== runId || !a.map || step <= (a.nodeBank ?? 0)) return false;
  a.nodeBank = step;
  applyBanked(data, a, rewards);
  return true;
}

/**
 * Commit rewards banked at a checkpoint. Guarded so the same checkpoint can never be
 * applied twice (repeated calls, double clicks, re-entrant events). Also unlocks the
 * next threat tier at the first checkpoint of the current one.
 */
export function bankRewards(data: SaveData, runId: string, wave: number, rewards: Pick<Rewards, 'salvage' | 'items'> & Partial<Rewards>, opts: { bosses?: number } = {}): boolean {
  const a = data.activeRun;
  if (!a || a.id !== runId || wave <= a.bankedThroughWave || wave % CHECKPOINT_INTERVAL !== 0) return false;
  a.bankedThroughWave = wave;
  // Validated in one step (application-level atomicity): applyBanked sanitizes every item first.
  applyBanked(data, a, rewards);
  const rec = record(data, a.tier);
  rec.checkpoints++;
  if (unlocksNextTier(a.tier, wave, opts.bosses ?? 0) && data.threat.unlocked < a.tier + 1) data.threat.unlocked = a.tier + 1;
  return true;
}

/** Apply validated banked rewards to the save (resources, XP, items into storage, records). */
function applyBanked(data: SaveData, a: NonNullable<SaveData['activeRun']>, rewards: Pick<Rewards, 'salvage' | 'items'> & Partial<Rewards>): void {
  const known = new Set(allOwnedUids(data));
  const incoming: ItemInstance[] = [];
  for (const raw of rewards.items) {
    const it = sanitizeItem(JSON.parse(JSON.stringify(raw)));
    if (!it || known.has(it.uid)) continue;
    known.add(it.uid);
    incoming.push(it);
  }
  const s = Math.max(0, Math.floor(rewards.salvage));
  const cr = Math.max(0, Math.floor(rewards.credits ?? 0));
  const co = Math.max(0, Math.floor(rewards.components ?? 0));
  const sh = Math.max(0, Math.floor(rewards.shards ?? 0));
  const xp = Math.max(0, Math.floor(rewards.xp ?? 0));
  a.salvageSecured += s;
  data.progress.xp = Math.min(MAX_XP, data.progress.xp + xp);
  a.itemsSecured += incoming.length;
  a.creditsSecured += cr;
  a.componentsSecured += co;
  data.resources.salvage = Math.min(MAX_BALANCE, data.resources.salvage + s);
  data.resources.credits = Math.min(MAX_BALANCE, data.resources.credits + cr);
  data.resources.components = Math.min(MAX_BALANCE, data.resources.components + co);
  data.resources.shards = Math.min(MAX_BALANCE, data.resources.shards + sh);
  data.economy.stats.creditsEarned += cr;
  data.totals.salvageSecured += s;
  data.totals.itemsSecured += incoming.length;
  // Banking never discards items: storage may exceed capacity (deployment is then blocked).
  data.items.push(...incoming);
  data.storage.uids.push(...incoming.map((i) => i.uid));
  for (const it of incoming) data.totals.bestRarity = Math.max(data.totals.bestRarity, rarity(it.rarity).index);
  const rec = record(data, a.tier);
  rec.salvageSecured += s;
  rec.itemsBanked += incoming.length;
}

/**
 * Record a finished run once. Returns false if it was already recorded.
 * M6: per-tier survival records and milestones come only from real run statistics; development sessions are
 * listed in the history (flagged) but never touch records, totals, milestones or unlocks.
 */
export function recordRun(data: SaveData, result: RunResult): boolean {
  if (data.history.some((h) => h.id === result.id)) return false;
  if (data.activeRun && data.activeRun.id !== result.id) return false;
  const sv = result.survival;
  const dev = !!sv?.dev;
  const broken: string[] = [];
  let newRecord = false;
  if (!dev) {
    const rec = record(data, result.tier);
    const beat = (label: string, cur: number, val: number) => {
      if (val > cur && val > 0) broken.push(label);
      return Math.max(cur, val);
    };
    newRecord = result.wavesCleared > rec.bestWave;
    rec.bestWave = beat('Waves cleared', rec.bestWave, result.wavesCleared);
    rec.highestWave = beat('Highest wave reached', rec.highestWave, result.finalWave);
    rec.bestKills = beat('Hostiles destroyed', rec.bestKills, result.kills);
    rec.runs++;
    rec.longestRun = Math.max(rec.longestRun, result.duration);
    rec.lastPlayedAt = result.endedAt;
    if (sv) {
      rec.bossesDefeated += sv.bossesKilled;
      rec.elitesDefeated += sv.elitesKilled;
      rec.deaths += sv.deaths;
      rec.bestBossesRun = beat('Bosses in one run', rec.bestBossesRun, sv.bossesKilled);
      rec.bestPlayerDamage = beat('Drone damage dealt', rec.bestPlayerDamage, Math.round(sv.playerDamage));
      rec.bestTowerDamage = beat('Tower damage dealt', rec.bestTowerDamage, Math.round(sv.towerDamage));
      const t = data.totals;
      t.bossesDefeated += sv.bossesKilled;
      t.elitesDefeated += sv.elitesKilled;
      t.deaths += sv.deaths;
      t.playerDamage = Math.min(1e300, t.playerDamage + sv.playerDamage);
      t.towerDamage = Math.min(1e300, t.towerDamage + sv.towerDamage);
      t.reactorDamage = Math.min(1e300, t.reactorDamage + sv.reactorDamage);
      for (const m of sv.milestones) if (!data.milestones.includes(m)) data.milestones.push(m);
    }
    if (result.mode === 'survival') {
      const r1 = record(data, result.tier);
      r1.survivalRuns++;
      r1.survivalBestWave = beat('Survival waves', r1.survivalBestWave, result.wavesCleared);
      r1.survivalBestNodes = Math.max(r1.survivalBestNodes, result.map?.nodes ?? 0);
    }
    if (result.map) {
      const r0 = record(data, result.tier);
      if (result.map.act > r0.deepestAct && r0.deepestAct > 0) broken.push('Deepest act');
      if (result.map.nodes > r0.bestNodes && r0.bestNodes > 0) broken.push('Nodes in one run');
      noteMap(data, result.tier, result.map);
    }
    // XP banked at checkpoints is already applied; the end of the run adds what was kept.
    data.progress.xp = Math.min(MAX_XP, data.progress.xp + Math.max(0, Math.floor(result.xpKept ?? 0)));
    data.totals.runs++;
    data.totals.kills += result.kills;
    data.totals.itemsLost += result.itemsLost;
    if (result.outcome === 'returned') data.totals.returned++;
    else if (result.outcome === 'defeat') data.totals.defeated++;
    else data.totals.abandoned++;
  } else data.totals.devRuns++;
  result.newRecord = newRecord;
  result.records = broken;
  data.history.unshift({
    id: result.id,
    tier: result.tier,
    outcome: result.outcome,
    finalWave: result.finalWave,
    wavesCleared: result.wavesCleared,
    kills: result.kills,
    duration: result.duration,
    salvageSecured: result.salvageSecured,
    salvageLost: result.salvageLost,
    itemsSecured: result.itemsSecured,
    itemsLost: result.itemsLost,
    endedAt: result.endedAt,
    newRecord,
    creditsSecured: result.creditsSecured ?? 0,
    componentsSecured: result.componentsSecured ?? 0,
    bosses: [...(sv?.bosses ?? [])],
    elites: sv?.elitesKilled ?? 0,
    deaths: sv?.deaths ?? 0,
    reactorDamage: Math.round(sv?.reactorDamage ?? 0),
    playerDamage: Math.round(sv?.playerDamage ?? 0),
    towerDamage: Math.round(sv?.towerDamage ?? 0),
    itemsCollected: result.itemsCollected ?? 0,
    events: sv?.events.length ?? 0,
    milestones: [...(sv?.milestones ?? [])],
    records: broken,
    dev,
    ...(result.mode === 'survival' ? { mode: 'survival' as const } : {}),
    ...(result.map ? { act: result.map.act, nodes: result.map.nodes, path: [...result.map.path] } : {}),
  });
  data.history = data.history.slice(0, HISTORY_LIMIT);
  data.activeRun = null;
  // Merchants restock after every completed operation.
  rotateMarket(data, result.endedAt);
  return true;
}

export function storageOverCapacity(data: SaveData): boolean {
  return data.storage.uids.length > data.storage.capacity;
}

/** Deployment rules: a weapon equipped and storage within capacity. */
export function deployBlocker(data: SaveData): string | null {
  if (!fitsSlot(equippedItem(data, 'weapon'), 'weapon')) return 'No primary weapon equipped';
  if (storageOverCapacity(data)) return `Storage over capacity (${data.storage.uids.length}/${data.storage.capacity}): scrap items or expand storage`;
  return null;
}

/**
 * Equip a stored item (HQ only). The target slot defaults to an empty compatible slot;
 * the item it replaces goes to storage, so the item count in storage never grows.
 */
export function equipFromStorage(data: SaveData, uid: string, slot?: SlotId): boolean {
  if (data.activeRun) return false;
  const idx = data.storage.uids.indexOf(uid);
  const item = itemByUid(data, uid);
  if (idx < 0 || !item) return false;
  const target = slot ?? defaultSlot(item.category, data.loadout);
  if (!target || !fitsSlot(item, target)) return false;
  data.storage.uids.splice(idx, 1);
  const prev = data.loadout[target];
  if (prev) data.storage.uids.push(prev);
  data.loadout[target] = uid;
  return true;
}

/** Move an equipped item to storage (not allowed for required slots or a full store). */
export function unequipToStorage(data: SaveData, slot: SlotId): boolean {
  const uid = data.loadout[slot];
  if (data.activeRun || !uid || getSlot(slot).required || data.storage.uids.length >= data.storage.capacity) return false;
  data.loadout[slot] = null;
  data.storage.uids.push(uid);
  return true;
}

/**
 * Make the loadout match `slots` as far as the profile owns the items. Slots that are
 * absent are left alone; items that are not owned or do not fit are skipped. Displaced
 * items return to storage; an item is never in two places. Returns true if anything moved.
 */
export function applyLoadout(data: SaveData, slots: Partial<Record<SlotId, string | null>>, opts: { ignoreActiveRun?: boolean } = {}): boolean {
  if (data.activeRun && !opts.ignoreActiveRun) return false;
  let changed = false;
  const owned = new Set(data.items.map((i) => i.uid));
  for (const slot of SLOT_IDS) {
    if (!(slot in slots)) continue;
    const want = slots[slot] ?? null;
    if (data.loadout[slot] === want) continue;
    if (want === null) {
      if (getSlot(slot).required) continue;
      const cur = data.loadout[slot];
      if (cur) {
        data.storage.uids.push(cur);
        data.loadout[slot] = null;
        changed = true;
      }
      continue;
    }
    if (!owned.has(want) || !fitsSlot(itemByUid(data, want), slot)) continue;
    // Take it from wherever it is now (storage or another slot).
    const si = data.storage.uids.indexOf(want);
    if (si >= 0) data.storage.uids.splice(si, 1);
    const otherSlot = slotOf(data, want);
    if (otherSlot) data.loadout[otherSlot] = null;
    const cur = data.loadout[slot];
    if (cur) data.storage.uids.push(cur);
    data.loadout[slot] = want;
    changed = true;
  }
  return changed;
}

/** Store the current loadout in a preset. */
export function savePreset(data: SaveData, index: number, name?: string): boolean {
  const p = data.presets[index];
  if (!p || data.activeRun) return false;
  p.slots = { ...data.loadout };
  if (name) p.name = name.slice(0, 20);
  return true;
}

/** Equip a preset. Items it references that are no longer owned are skipped. */
export function loadPreset(data: SaveData, index: number): boolean {
  const p = data.presets[index];
  if (!p || data.activeRun) return false;
  if (!Object.values(p.slots).some(Boolean)) return false;
  return applyLoadout(data, p.slots);
}

/**
 * Dismantle a stored (not equipped) item for salvage. Presets referencing it are cleared.
 * Modules installed in a scrapped weapon are returned to storage (never destroyed).
 */
export function scrapItem(data: SaveData, uid: string): number {
  if (data.activeRun) return 0;
  const idx = data.storage.uids.indexOf(uid);
  const item = itemByUid(data, uid);
  if (idx < 0 || !item || slotOf(data, uid) || item.locked) return 0;
  const y = dismantleYield(item);
  const value = y.salvage;
  data.resources.components += y.components;
  data.economy.stats.itemsDismantled++;
  data.storage.uids.splice(idx, 1);
  data.items = data.items.filter((i) => i.uid !== uid);
  for (const m of item.socketed ?? []) {
    if (!m) continue;
    data.items.push(m);
    data.storage.uids.push(m.uid);
  }
  for (const p of data.presets) for (const s of SLOT_IDS) if (p.slots[s] === uid) p.slots[s] = null;
  data.resources.salvage += value;
  data.totals.itemsScrapped++;
  return value;
}

/** Buy more storage bays with salvage (first salvage sink). */
export function expandStorage(data: SaveData): boolean {
  const cost = storageExpansionCost(data.storage.expansions);
  if (data.activeRun || data.resources.salvage < cost) return false;
  data.resources.salvage -= cost;
  data.storage.expansions++;
  data.storage.capacity = STORAGE_CAPACITY + data.storage.expansions * STORAGE_EXPANSION;
  return true;
}

