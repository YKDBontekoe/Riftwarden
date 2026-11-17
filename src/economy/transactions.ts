import { hashSeed } from '../loot/generate';
import { mulberry32 } from '../combat/damage';
import type { ItemInstance, RolledAffix } from '../loot/types';
import { newUid, SLOT_IDS, type SlotId } from '../progression/items';
import { allOwnedUids, itemByUid, marketProgress, rotateMarket, type SaveData, slotOf, TX_HISTORY } from '../progression/save';
import type { ComponentSlot } from '../weapons/components';
import { componentDef } from '../weapons/components';
import {
  buyPrice,
  componentSwapCost,
  type Cost,
  dismantleYield,
  enhanceCost,
  enhanceLevel,
  MARKET,
  MAX_BALANCE,
  maxEnhance,
  RESOURCE_KEYS,
  RESOURCE_LABEL,
  rerollCost,
  type RerollMode,
  sellPrice,
  sumCost,
} from './config';
import { checkFullReroll, checkSingleReroll, engineeringRand, maxLocks, rerollAll, rerollSingle, swapComponent } from './engineering';
import { type MerchantId, merchantEntries } from './market';
import { isUnlocked, partDef, STARTER_TECH, techKey, type TowerSlot } from '../towers/components';
import { craftCost, fabricate, qualityDef, recipeDef, unlockedFor } from './recipes';

/**
 * Economy transactions (pure rules over SaveData).
 *
 * Every function follows the same contract:
 *  1. validate EVERYTHING (HQ only, ownership, protection, eligibility, cost, capacity),
 *  2. only then mutate, in one synchronous step (application-level atomicity),
 *  3. return { ok: true, ... } or { ok: false, reason } with the save untouched.
 * Persistence (and rollback when the write fails) is done by Profile.transact. An optional
 * transaction id makes repeated submissions of the same action (double clicks, re-sent
 * requests) no-ops: a committed id is remembered and any repeat is rejected.
 */
export type TxFail = { ok: false; reason: string };
export type TxResult<T extends object = object> = ({ ok: true } & T) | TxFail;

const fail = (reason: string): TxFail => ({ ok: false, reason });

export function canAfford(data: SaveData, cost: Cost): boolean {
  return RESOURCE_KEYS.every((k) => (data.resources[k] ?? 0) >= (cost[k] ?? 0));
}

export function missingText(data: SaveData, cost: Cost): string {
  const miss = RESOURCE_KEYS.filter((k) => (data.resources[k] ?? 0) < (cost[k] ?? 0)).map((k) => `${(cost[k] ?? 0) - data.resources[k]} more ${RESOURCE_LABEL[k].toLowerCase()}`);
  return miss.length ? `Needs ${miss.join(', ')}` : '';
}

function pay(data: SaveData, cost: Cost): void {
  for (const k of RESOURCE_KEYS) {
    const v = Math.max(0, Math.floor(cost[k] ?? 0));
    data.resources[k] -= v;
  }
  data.economy.stats.creditsSpent += Math.max(0, Math.floor(cost.credits ?? 0));
}

function grant(data: SaveData, give: Cost): void {
  for (const k of RESOURCE_KEYS) data.resources[k] = Math.min(MAX_BALANCE, data.resources[k] + Math.max(0, Math.floor(give[k] ?? 0)));
}

/** Run `fn` under a transaction id: a repeated id is rejected, a committed id is remembered. */
export function withTx<T extends object>(data: SaveData, txId: string | undefined, fn: () => TxResult<T>): TxResult<T> {
  if (txId && data.economy.tx.includes(txId)) return fail('Transaction already processed');
  const res = fn();
  if (res.ok && txId) {
    data.economy.tx.push(txId.slice(0, 64));
    if (data.economy.tx.length > TX_HISTORY) data.economy.tx.splice(0, data.economy.tx.length - TX_HISTORY);
  }
  return res;
}

const hqOnly = (data: SaveData): TxFail | null => (data.activeRun ? fail('Only available at HQ between operations') : null);

const freeBays = (data: SaveData) => data.storage.capacity - data.storage.uids.length;

// ------------------------------------------------------------------ ownership

export type Owned =
  | { item: ItemInstance; where: 'stored' }
  | { item: ItemInstance; where: 'equipped'; slot: SlotId }
  | { item: ItemInstance; where: 'installed'; host: ItemInstance; socket: number };

/** Find an item the profile owns: stored, equipped, or installed in an owned weapon. */
export function findOwned(data: SaveData, uid: string): Owned | null {
  const it = itemByUid(data, uid);
  if (it) {
    if (data.storage.uids.includes(uid)) return { item: it, where: 'stored' };
    const slot = slotOf(data, uid);
    if (slot) return { item: it, where: 'equipped', slot };
    return null;
  }
  for (const host of data.items) {
    const i = host.socketed?.findIndex((m) => m?.uid === uid) ?? -1;
    if (i >= 0 && (data.storage.uids.includes(host.uid) || slotOf(data, host.uid))) return { item: host.socketed[i]!, where: 'installed', host, socket: i };
  }
  return null;
}

/** Why an item cannot be sold or dismantled (null = it can). */
export function protectionReason(data: SaveData, uid: string): string | null {
  const o = findOwned(data, uid);
  if (!o) return 'Item is not in your storage';
  if (o.where === 'equipped') return 'Equipped: unequip it first';
  if (o.where === 'installed') return 'Installed in a weapon: remove it first';
  if (o.item.locked) return 'Locked: unlock it first';
  return null;
}

/** Remove stored items (validated by the caller); installed modules return to storage. */
function removeStored(data: SaveData, uids: readonly string[]): ItemInstance[] {
  const set = new Set(uids);
  const removed = data.items.filter((i) => set.has(i.uid));
  data.items = data.items.filter((i) => !set.has(i.uid));
  data.storage.uids = data.storage.uids.filter((u) => !set.has(u));
  for (const it of removed)
    for (const m of it.socketed ?? []) {
      if (!m) continue;
      data.items.push(m);
      data.storage.uids.push(m.uid);
    }
  for (const p of data.presets) for (const s of SLOT_IDS) if (p.slots[s] && set.has(p.slots[s]!)) p.slots[s] = null;
  return removed;
}

function validateDisposal(data: SaveData, uids: readonly string[]): TxFail | string[] {
  const list = [...new Set(uids)];
  if (!list.length) return fail('Nothing selected');
  for (const uid of list) {
    const why = protectionReason(data, uid);
    if (why) return fail(`${itemByUid(data, uid)?.name ?? 'Item'}: ${why}`);
  }
  return list;
}

// ------------------------------------------------------------------ protection

export function setItemLock(data: SaveData, uid: string, locked: boolean): TxResult {
  const o = findOwned(data, uid);
  if (!o) return fail('Item not owned');
  if (!!o.item.locked === locked) return fail(locked ? 'Already locked' : 'Not locked');
  if (locked) o.item.locked = true;
  else delete o.item.locked;
  return { ok: true };
}

export function setAffixLock(data: SaveData, uid: string, index: number, locked: boolean): TxResult {
  const err = hqOnly(data);
  if (err) return err;
  const o = findOwned(data, uid);
  if (!o) return fail('Item not owned');
  const a = o.item.affixes[index];
  if (!a) return fail('No such affix');
  if (!!a.locked === locked) return fail('No change');
  if (locked && o.item.affixes.filter((x) => x.locked).length >= maxLocks(o.item)) return fail(`At most ${maxLocks(o.item)} affix${maxLocks(o.item) === 1 ? '' : 'es'} can be locked on this item`);
  if (locked) a.locked = true;
  else delete a.locked;
  return { ok: true };
}

// ------------------------------------------------------------------ salvage station

export interface DisposalResult {
  count: number;
  salvage: number;
  components: number;
  credits: number;
  modulesReturned: number;
}

/** Aggregate preview of dismantling (no state change). */
export function previewDismantle(data: SaveData, uids: readonly string[]): DisposalResult & { blocked: { uid: string; reason: string }[] } {
  const out = { count: 0, salvage: 0, components: 0, credits: 0, modulesReturned: 0, blocked: [] as { uid: string; reason: string }[] };
  for (const uid of new Set(uids)) {
    const why = protectionReason(data, uid);
    if (why) {
      out.blocked.push({ uid, reason: why });
      continue;
    }
    const it = itemByUid(data, uid)!;
    const y = dismantleYield(it);
    out.count++;
    out.salvage += y.salvage;
    out.components += y.components;
    out.modulesReturned += it.socketed?.filter(Boolean).length ?? 0;
  }
  return out;
}

/** Dismantle one or more stored items. All-or-nothing: one protected item rejects the batch. */
export function dismantleItems(data: SaveData, uids: readonly string[], txId?: string): TxResult<DisposalResult> {
  return withTx(data, txId, () => {
    const err = hqOnly(data);
    if (err) return err;
    const list = validateDisposal(data, uids);
    if (!Array.isArray(list)) return list;
    const p = previewDismantle(data, list);
    removeStored(data, list);
    grant(data, { salvage: p.salvage, components: p.components });
    data.economy.stats.itemsDismantled += p.count;
    data.totals.itemsScrapped += p.count;
    return { ok: true, count: p.count, salvage: p.salvage, components: p.components, credits: 0, modulesReturned: p.modulesReturned };
  });
}

// ------------------------------------------------------------------ merchants

export function sellItems(data: SaveData, uids: readonly string[], txId?: string): TxResult<DisposalResult> {
  return withTx(data, txId, () => {
    const err = hqOnly(data);
    if (err) return err;
    const list = validateDisposal(data, uids);
    if (!Array.isArray(list)) return list;
    let credits = 0;
    let modulesReturned = 0;
    for (const uid of list) {
      const it = itemByUid(data, uid)!;
      credits += sellPrice(it);
      modulesReturned += it.socketed?.filter(Boolean).length ?? 0;
    }
    removeStored(data, list);
    grant(data, { credits });
    data.economy.stats.creditsEarned += credits;
    data.economy.stats.itemsSold += list.length;
    return { ok: true, count: list.length, credits, salvage: 0, components: 0, modulesReturned };
  });
}

export function buyItem(data: SaveData, merchant: MerchantId, entryId: string, txId?: string): TxResult<{ item: ItemInstance; price: number }> {
  return withTx(data, txId, () => {
    const err = hqOnly(data);
    if (err) return err;
    const entry = merchantEntries(data.market, merchant).find((e) => e.id === entryId);
    if (!entry) return fail('This offer is no longer available');
    if (entry.sold) return fail('Already sold');
    const price = buyPrice(entry.item, merchant);
    if (data.resources.credits < price) return fail(`Needs ${price - data.resources.credits} more credits`);
    if (freeBays(data) < 1) return fail('Storage full: free a bay first');
    if (allOwnedUids(data).includes(entry.item.uid)) return fail('Already owned');
    const item: ItemInstance = JSON.parse(JSON.stringify(entry.item));
    item.acquiredAt = Date.now();
    pay(data, { credits: price });
    entry.sold = true;
    data.items.push(item);
    data.storage.uids.push(item.uid);
    data.economy.stats.itemsBought++;
    return { ok: true, item, price };
  });
}

export function buyExchange(data: SaveData, offerId: string, txId?: string): TxResult<{ give: Cost; price: number }> {
  return withTx(data, txId, () => {
    const err = hqOnly(data);
    if (err) return err;
    const def = MARKET.exchange.find((o) => o.id === offerId);
    const st = data.market.exchange.find((o) => o.id === offerId);
    if (!def || !st) return fail('Unknown offer');
    if (st.left <= 0) return fail('Sold out until the next restock');
    if (data.resources.credits < def.price) return fail(`Needs ${def.price - data.resources.credits} more credits`);
    pay(data, { credits: def.price });
    grant(data, def.give);
    st.left--;
    return { ok: true, give: { ...def.give }, price: def.price };
  });
}

export function refreshCost(data: SaveData): number {
  return MARKET.refreshCost(data.market.refreshes);
}

/** Paid manual restock (escalating within a rotation; resets after every run). */
export function refreshMarket(data: SaveData, txId?: string): TxResult<{ price: number; rotation: number }> {
  return withTx(data, txId, () => {
    const err = hqOnly(data);
    if (err) return err;
    const price = refreshCost(data);
    if (data.resources.credits < price) return fail(`Needs ${price - data.resources.credits} more credits`);
    pay(data, { credits: price });
    rotateMarket(data, Date.now(), data.market.refreshes + 1);
    return { ok: true, price, rotation: data.market.rotation };
  });
}

// ------------------------------------------------------------------ affix engineering

export function engineerable(data: SaveData, uid: string): TxFail | Owned {
  const err = hqOnly(data);
  if (err) return err;
  const o = findOwned(data, uid);
  if (!o) return fail('Item not owned');
  return o;
}

export function rerollAffix(data: SaveData, uid: string, index: number, mode: RerollMode, txId?: string): TxResult<{ before: RolledAffix; after: RolledAffix; cost: Cost }> {
  return withTx(data, txId, () => {
    const o = engineerable(data, uid);
    if ('ok' in o) return o;
    const it = o.item;
    const chk = checkSingleReroll(it, index);
    if (!chk.ok) return chk;
    const cost = rerollCost(it, { kind: 'single', mode });
    if (!canAfford(data, cost)) return fail(missingText(data, cost));
    const after = rerollSingle(it, index, mode, engineeringRand(it, `single:${mode}:${index}`));
    if (!after) return fail('No compatible affix available');
    const before = { ...it.affixes[index] };
    pay(data, cost);
    it.affixes[index] = after;
    it.rerolls = (it.rerolls ?? 0) + 1;
    data.economy.stats.rerolls++;
    return { ok: true, before, after, cost };
  });
}

export function rerollUnlocked(data: SaveData, uid: string, txId?: string): TxResult<{ before: RolledAffix[]; after: RolledAffix[]; cost: Cost }> {
  return withTx(data, txId, () => {
    const o = engineerable(data, uid);
    if ('ok' in o) return o;
    const it = o.item;
    const chk = checkFullReroll(it);
    if (!chk.ok) return chk;
    const locks = it.affixes.filter((a) => a.locked).length;
    const cost = rerollCost(it, { kind: 'full', locks });
    if (!canAfford(data, cost)) return fail(missingText(data, cost));
    const after = rerollAll(it, engineeringRand(it, 'full'));
    if (!after) return fail('No compatible affixes available');
    const before = it.affixes.map((a) => ({ ...a }));
    pay(data, cost);
    it.affixes = after;
    it.rerolls = (it.rerolls ?? 0) + 1;
    data.economy.stats.rerolls++;
    return { ok: true, before, after, cost };
  });
}

// ------------------------------------------------------------------ enhancement

export function enhanceItem(data: SaveData, uid: string, txId?: string): TxResult<{ level: number; cost: Cost }> {
  return withTx(data, txId, () => {
    const o = engineerable(data, uid);
    if ('ok' in o) return o;
    const it = o.item;
    if (it.category === 'weapon' && !it.weapon) return fail('This weapon cannot be enhanced');
    const lvl = enhanceLevel(it);
    if (lvl >= maxEnhance(it)) return fail(`Already at the ${it.rarity} limit (+${maxEnhance(it)})`);
    const cost = enhanceCost(it);
    if (!canAfford(data, cost)) return fail(missingText(data, cost));
    pay(data, cost);
    it.enhance = lvl + 1;
    data.economy.stats.enhancements++;
    return { ok: true, level: it.enhance, cost };
  });
}

// ------------------------------------------------------------------ component engineering

export function modifyComponent(data: SaveData, uid: string, slot: ComponentSlot, componentId: string, txId?: string): TxResult<{ cost: Cost }> {
  return withTx(data, txId, () => {
    const o = engineerable(data, uid);
    if ('ok' in o) return o;
    const it = o.item;
    if (o.where === 'installed' || it.category !== 'weapon') return fail('Only weapons have components');
    const res = swapComponent(it, slot, componentId);
    if (!res) return fail('Incompatible component for this weapon');
    const cost = componentSwapCost(it, slot, (componentDef(componentId)?.minRarity ?? 0) > 0);
    if (!canAfford(data, cost)) return fail(missingText(data, cost));
    pay(data, cost);
    it.build = res.build;
    it.weapon = res.weapon;
    it.mods = (it.mods ?? 0) + 1;
    data.economy.stats.componentSwaps++;
    return { ok: true, cost };
  });
}

// ------------------------------------------------------------------ fabrication

export function fabricationLevel(data: SaveData): number {
  return marketProgress(data).level;
}

export function craft(data: SaveData, recipeId: string, qualityId: string | null, txId?: string): TxResult<{ item: ItemInstance | null; give: Cost; cost: Cost }> {
  return withTx(data, txId, () => {
    const err = hqOnly(data);
    if (err) return err;
    const recipe = recipeDef(recipeId);
    if (!recipe) return fail('Unknown recipe');
    const q = recipe.output.kind === 'item' ? qualityDef(qualityId ?? '') : undefined;
    if (recipe.output.kind === 'item' && !q) return fail('Choose a quality grade');
    const unlock = unlockedFor(recipe, q, data.threat.unlocked);
    if (!unlock.ok) return unlock;
    const level = fabricationLevel(data);
    const cost = craftCost(recipe, q, level);
    if (!canAfford(data, cost)) return fail(missingText(data, cost));
    if (recipe.output.kind === 'material') {
      pay(data, cost);
      grant(data, recipe.output.give);
      return { ok: true, item: null, give: { ...recipe.output.give }, cost };
    }
    if (freeBays(data) < recipe.quantity) return fail('Storage full: free a bay first');
    // Deterministic per profile and craft counter (restoring an old save repeats the result).
    const seed = hashSeed(`craft|${data.profile.id}|${data.economy.crafts}`);
    const rand = mulberry32(seed ^ 0x2545f491);
    const owned = new Set(allOwnedUids(data));
    let uid = newUid('cr');
    while (owned.has(uid)) uid = newUid('cr');
    const item = fabricate(recipe, q!, level, seed, uid, rand);
    if (!item) return fail('Fabrication failed: no valid output');
    pay(data, cost);
    data.economy.crafts++;
    data.items.push(item);
    data.storage.uids.push(item.uid);
    data.economy.stats.itemsCrafted++;
    return { ok: true, item, give: {}, cost: sumCost(cost) };
  });
}

// ------------------------------------------------------------------ M5: tower technology

export function bestWaveCleared(data: SaveData): number {
  return Object.values(data.records).reduce((m, r) => Math.max(m, r.bestWave), 0);
}

/** Why a blueprint cannot be researched right now (null = researchable). */
export function researchBlocker(data: SaveData, slot: TowerSlot, id: string): string | null {
  const p = partDef(slot, id);
  if (!p) return 'Unknown blueprint';
  if (!p.tech) return 'Starter blueprint';
  if (isUnlocked(data.towers.unlocked, slot, id)) return 'Already researched';
  if (bestWaveCleared(data) < p.tech.wave) return `Reach wave ${p.tech.wave} (best: ${bestWaveCleared(data)})`;
  const cost = { credits: p.tech.credits, components: p.tech.components };
  if (!canAfford(data, cost)) return missingText(data, cost);
  return null;
}

/**
 * Research a tower blueprint permanently (HQ only): needs a survival milestone plus credits / advanced
 * components. Validate-all-then-apply like every economy transaction; deployed towers are never persisted.
 */
export function researchTower(data: SaveData, slot: TowerSlot, id: string, txId?: string): TxResult<{ key: string }> {
  return withTx(data, txId, () => {
    const hq = hqOnly(data);
    if (hq) return hq;
    const why = researchBlocker(data, slot, id);
    if (why) return fail(why);
    const p = partDef(slot, id)!;
    pay(data, { credits: p.tech!.credits, components: p.tech!.components });
    const key = techKey(slot, id);
    data.towers.unlocked.push(key);
    return { ok: true, key };
  });
}

export const ownedTowerTech = (data: SaveData): string[] => [...STARTER_TECH, ...data.towers.unlocked];
