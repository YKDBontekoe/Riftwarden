import { describe, expect, it } from 'vitest';
import { STAT_DEFS } from '../src/combat/stats';
import {
  buyPrice,
  dismantleYield,
  enhanceCost,
  EXCHANGE_UNIT,
  itemValue,
  MAX_ENHANCE,
  rerollCost,
  sellPrice,
  STARTING_CREDITS,
  componentSwapCost,
} from '../src/economy/config';
import { affixValueRange, rerollPool, swapOptions } from '../src/economy/engineering';
import { generateMarket } from '../src/economy/market';
import { craftCost, QUALITIES, qualityDef, qualityOdds, RECIPES, recipeDef } from '../src/economy/recipes';
import {
  buyExchange,
  buyItem,
  craft,
  dismantleItems,
  enhanceItem,
  findOwned,
  modifyComponent,
  previewDismantle,
  refreshMarket,
  rerollAffix,
  rerollUnlocked,
  sellItems,
  setAffixLock,
  setItemLock,
} from '../src/economy/transactions';
import { affixDef } from '../src/loot/affixes';
import { BASES, baseDef } from '../src/loot/bases';
import { itemModifiers, weaponDefFor } from '../src/loot/equipment';
import { generateItem, isValidItem, maxTierFor, MAX_ITEM_LEVEL } from '../src/loot/generate';
import { RARITIES, rarity, type RarityId } from '../src/loot/rarity';
import type { Category, ItemInstance } from '../src/loot/types';
import { Profile } from '../src/progression/Profile';
import { RunLedger } from '../src/progression/run';
import {
  allOwnedUids,
  bankRewards,
  beginRun,
  checksum,
  createDefaultSave,
  installModule,
  parseSave,
  recordRun,
  type SaveData,
  SAVE_KEY,
  SAVE_VERSION,
  serializeSave,
} from '../src/progression/save';
import { buildMechanism, isValidBuild } from '../src/weapons/build';
import { componentDef } from '../src/weapons/components';

let n = 0;
const gen = (o: { category?: Category; baseId?: string; rarity?: RarityId; level?: number; seed?: number } = {}): ItemInstance =>
  generateItem({ uid: `e${++n}`, seed: o.seed ?? 5000 + n * 31, level: o.level ?? 10, rarity: o.rarity ?? 'rare', category: o.category, baseId: o.baseId, source: 'test', now: 1 });

/** Save with resources and some stored items. */
function setup(stored: ItemInstance[] = [], res: Partial<SaveData['resources']> = {}): SaveData {
  const d = createDefaultSave(1);
  d.items.push(...stored);
  d.storage.uids.push(...stored.map((i) => i.uid));
  d.resources = { salvage: 100000, credits: 100000, components: 1000, ...res };
  return d;
}

const snap = (d: SaveData) => JSON.stringify(d);

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('M4 economy foundation', () => {
  it('fresh profiles have credits, components and generated merchant stock', () => {
    const d = createDefaultSave(1);
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.resources).toEqual({ salvage: 0, credits: STARTING_CREDITS, components: 0 });
    expect(d.market.equipment.length).toBe(8);
    expect(d.market.modules.length).toBe(6);
    for (const e of [...d.market.equipment, ...d.market.modules]) {
      expect(isValidItem(e.item)).toBe(true);
      expect(rarity(e.item.rarity).index).toBeLessThanOrEqual(3); // never above epic
      expect(e.sold).toBe(false);
    }
    expect(d.market.modules.every((e) => e.item.category === 'module')).toBe(true);
    expect(d.market.equipment.every((e) => e.item.category !== 'module')).toBe(true);
  });

  it('stock is deterministic per profile and rotation, and survives save/load unchanged (D)', () => {
    const a = generateMarket('pf_x', 3, { level: 12, tier: 2 }, 1);
    const b = generateMarket('pf_x', 3, { level: 12, tier: 2 }, 1);
    expect(b).toEqual(a);
    expect(generateMarket('pf_x', 4, { level: 12, tier: 2 }, 1).equipment[1].item.uid).not.toBe(a.equipment[1].item.uid);
    const d = createDefaultSave(1);
    const r = parseSave(serializeSave(d));
    expect(r.ok && r.data.market).toEqual(d.market);
  });

  it('a completed run rotates the stock; reopening does not', () => {
    const d = setup();
    const rot = d.market.rotation;
    const first = d.market.equipment.map((e) => e.item.uid);
    beginRun(d, 'run_1', 1, 10);
    const ledger = new RunLedger('run_1', 1, 10);
    ledger.waveCleared(3);
    recordRun(d, ledger.finalize('returned', 20));
    expect(d.market.rotation).toBe(rot + 1);
    expect(d.market.equipment.map((e) => e.item.uid)).not.toEqual(first);
    expect(d.market.refreshes).toBe(0);
  });

  it('v3 save migrates to v4 without rerolling items', () => {
    const d = createDefaultSave(1) as unknown as Record<string, unknown>;
    const w = gen({ baseId: 'rail_lancer', rarity: 'epic' });
    const data = JSON.parse(JSON.stringify(d));
    data.version = 3;
    data.resources = { salvage: 77 };
    delete data.market;
    delete data.economy;
    data.items.push(w);
    data.storage.uids.push(w.uid);
    const body = JSON.stringify(data);
    const r = parseSave(`{"v":3,"sum":"${checksum(body)}","data":${body}}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(3);
    expect(r.data.resources).toEqual({ salvage: 77, credits: STARTING_CREDITS, components: 0 });
    expect(r.data.items.find((i) => i.uid === w.uid)).toEqual(w);
    expect(r.data.market.equipment.length).toBe(8);
    expect(r.data.economy.tx).toEqual([]);
  });

  it('sanitize repairs hostile economy data', () => {
    const d = setup([gen()]);
    const raw = JSON.parse(serializeSave(d)).data;
    raw.resources = { salvage: -5, credits: 'lots', components: Infinity };
    raw.items[1].enhance = 999;
    raw.items[1].affixes.forEach((a: { locked: boolean }) => (a.locked = true));
    raw.market = { rotation: 2, equipment: 'nope' };
    const body = JSON.stringify(raw);
    const r = parseSave(`{"v":${SAVE_VERSION},"sum":"${checksum(body)}","data":${body}}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.resources).toEqual({ salvage: 0, credits: 0, components: 0 });
    const it = r.data.items[1];
    expect(it.enhance).toBe(MAX_ENHANCE[rarity(it.rarity).index]);
    expect(it.affixes.filter((a) => a.locked).length).toBe(it.affixes.length - 1);
    expect(r.data.market.equipment.length).toBe(8);
  });

  it('every formula is finite, non-negative and integral across extreme levels', () => {
    for (const r of RARITIES)
      for (const level of [1, 2, 50, 999, 123456, MAX_ITEM_LEVEL, 1e12, NaN])
        for (const cat of ['weapon', 'armor', 'module'] as Category[]) {
          const it = { level, rarity: r.id, category: cat, affixes: [], enhance: 99, rerolls: 1e9, mods: 1e9 } as unknown as ItemInstance;
          const vals = [
            itemValue(it),
            buyPrice(it),
            sellPrice(it),
            dismantleYield(it).salvage,
            dismantleYield(it).components,
            ...Object.values(enhanceCost(it)),
            ...Object.values(rerollCost(it, { kind: 'single', mode: 'stat' })),
            ...Object.values(rerollCost(it, { kind: 'full', locks: 3 })),
            ...Object.values(componentSwapCost(it, 'barrel', true)),
          ];
          for (const v of vals) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1e13);
          }
        }
  });
});

describe('pricing and exploit invariants (J)', () => {
  it('selling and dismantling a bought item always loses value', () => {
    for (const r of RARITIES.slice(0, 4))
      for (const level of [1, 5, 20, 80, 400, 5000]) {
        for (const cat of ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module'] as Category[]) {
          const it = gen({ category: cat, rarity: r.id, level });
          const buy = buyPrice(it);
          expect(sellPrice(it)).toBeLessThan(buy * 0.2);
          const y = dismantleYield(it);
          // Materials from a bought item are worth far less than its price at exchange rates.
          expect(y.salvage * EXCHANGE_UNIT.salvage + y.components * EXCHANGE_UNIT.components).toBeLessThan(buy * 0.8);
        }
      }
  });

  it('crafting then selling or dismantling never returns the cost', () => {
    for (const recipe of RECIPES.filter((x) => x.output.kind === 'item'))
      for (const q of QUALITIES)
        for (const level of [1, 10, 60, 500]) {
          const cost = craftCost(recipe, q, level);
          const costCredits = (cost.credits ?? 0) + (cost.salvage ?? 0) * EXCHANGE_UNIT.salvage + (cost.components ?? 0) * EXCHANGE_UNIT.components;
          for (const rid of [q.min, q.max]) {
            const o = recipe.output as { category: Category };
            const it = { level, rarity: rid, category: o.category, affixes: [{ tier: 5, roll: 1 }] } as unknown as ItemInstance;
            expect(sellPrice(it)).toBeLessThan(cost.credits ?? 0);
            const y = dismantleYield(it);
            expect(y.salvage).toBeLessThan(cost.salvage ?? 0);
            expect(y.salvage * EXCHANGE_UNIT.salvage + y.components * EXCHANGE_UNIT.components + sellPrice(it)).toBeLessThan(costCredits);
          }
        }
  });

  it('material conversions are lossy in both directions', () => {
    const refine = recipeDef('x_refine')!.output as { take: { salvage: number }; give: { components: number } };
    const reclaim = recipeDef('x_reclaim')!.output as { take: { components: number }; give: { salvage: number } };
    expect(reclaim.give.salvage * refine.give.components).toBeLessThan(refine.take.salvage * reclaim.take.components);
  });
});

describe('A/B: salvage station', () => {
  it('dismantles a stored item: item removed, materials granted', () => {
    const it = gen({ rarity: 'epic', level: 20, category: 'armor' });
    const d = setup([it], { salvage: 0, components: 0 });
    const y = dismantleYield(it);
    expect(y.components).toBeGreaterThan(0);
    const res = dismantleItems(d, [it.uid]);
    expect(res.ok).toBe(true);
    expect(d.items.some((i) => i.uid === it.uid)).toBe(false);
    expect(d.storage.uids).not.toContain(it.uid);
    expect(d.resources.salvage).toBe(y.salvage);
    expect(d.resources.components).toBe(y.components);
  });

  it('higher rarity and level yield more', () => {
    const base = { category: 'armor' as Category, affixes: [], level: 10 };
    const y = (r: RarityId, level = 10) => dismantleYield({ ...base, rarity: r, level } as unknown as ItemInstance);
    expect(y('epic').salvage).toBeGreaterThan(y('rare').salvage);
    expect(y('legendary').components).toBeGreaterThan(y('epic').components);
    expect(y('rare', 60).salvage).toBeGreaterThan(y('rare', 10).salvage);
    expect(y('common').components).toBe(0);
  });

  it('protects equipped, locked and installed items; unknown uids fail; state untouched', () => {
    const locked = gen({ category: 'shield' });
    const w = gen({ baseId: 'plasma_repeater', rarity: 'epic' });
    const m = gen({ baseId: 'amp_module', rarity: 'rare' });
    const d = setup([locked, w, m]);
    expect(setItemLock(d, locked.uid, true).ok).toBe(true);
    const socket = w.build!.sockets.indexOf('power');
    expect(installModule(d, w.uid, socket, m.uid).ok).toBe(true);
    const before = snap(d);
    for (const uid of [d.loadout.weapon!, locked.uid, m.uid, 'ghost_uid']) {
      expect(dismantleItems(d, [uid]).ok).toBe(false);
      expect(sellItems(d, [uid]).ok).toBe(false);
    }
    expect(snap(d)).toBe(before);
    expect(setItemLock(d, locked.uid, false).ok).toBe(true);
    expect(dismantleItems(d, [locked.uid]).ok).toBe(true);
  });

  it('batch dismantle is atomic: one protected item rejects the whole batch', () => {
    const a = gen({ category: 'armor' });
    const b = gen({ category: 'reactor' });
    const c = gen({ category: 'processor' });
    const d = setup([a, b, c]);
    setItemLock(d, c.uid, true);
    const before = snap(d);
    expect(dismantleItems(d, [a.uid, b.uid, c.uid]).ok).toBe(false);
    expect(snap(d)).toBe(before);
    const p = previewDismantle(d, [a.uid, b.uid]);
    const salvage0 = d.resources.salvage;
    const res = dismantleItems(d, [a.uid, b.uid, a.uid]); // duplicates are collapsed
    expect(res.ok && res.count).toBe(2);
    expect(d.resources.salvage - salvage0).toBe(p.salvage);
    // A second submission of the same (now gone) items fails safely.
    expect(dismantleItems(d, [a.uid]).ok).toBe(false);
  });

  it('dismantling a weapon returns its installed modules to storage', () => {
    const w = gen({ baseId: 'rail_lancer', rarity: 'epic' });
    const m = gen({ baseId: 'amp_module' });
    const d = setup([w, m]);
    installModule(d, w.uid, w.build!.sockets.indexOf('power'), m.uid);
    const res = dismantleItems(d, [w.uid]);
    expect(res.ok && res.modulesReturned).toBe(1);
    expect(d.storage.uids).toContain(m.uid);
    expect(new Set(allOwnedUids(d)).size).toBe(allOwnedUids(d).length);
  });

  it('rejects everything during an active run', () => {
    const a = gen({ category: 'armor' });
    const d = setup([a]);
    beginRun(d, 'r', 1, 1);
    const before = snap(d);
    expect(dismantleItems(d, [a.uid]).ok).toBe(false);
    expect(sellItems(d, [a.uid]).ok).toBe(false);
    expect(buyItem(d, 'equipment', d.market.equipment[0].id).ok).toBe(false);
    expect(craft(d, 'd_armor', 'standard').ok).toBe(false);
    expect(enhanceItem(d, a.uid).ok).toBe(false);
    expect(snap(d)).toBe(before);
  });
});

describe('C/D: merchants', () => {
  it('buys a real item: credits deducted, item stored, entry sold, duplicate purchase refused', () => {
    const d = setup([], { credits: 1e6 });
    const e = d.market.equipment[2];
    const price = buyPrice(e.item);
    const res = buyItem(d, 'equipment', e.id);
    expect(res.ok).toBe(true);
    expect(d.resources.credits).toBe(1e6 - price);
    expect(d.storage.uids).toContain(e.item.uid);
    expect(isValidItem(d.items.find((i) => i.uid === e.item.uid)!)).toBe(true);
    expect(e.sold).toBe(true);
    const before = snap(d);
    expect(buyItem(d, 'equipment', e.id).ok).toBe(false);
    expect(snap(d)).toBe(before);
    // Persisted and reloaded: still sold, still owned exactly once.
    const r = parseSave(serializeSave(d));
    expect(r.ok && r.data.market.equipment[2].sold).toBe(true);
    expect(r.ok && r.data.items.filter((i) => i.uid === e.item.uid).length).toBe(1);
  });

  it('refuses purchases without credits or storage space (I)', () => {
    const d = setup([], { credits: 0 });
    const before = snap(d);
    expect(buyItem(d, 'modules', d.market.modules[0].id).ok).toBe(false);
    expect(snap(d)).toBe(before);
    d.resources.credits = 1e6;
    d.storage.capacity = d.storage.uids.length;
    const b2 = snap(d);
    const r = buyItem(d, 'modules', d.market.modules[0].id);
    expect(!r.ok && r.reason).toMatch(/Storage full/);
    expect(snap(d)).toBe(b2);
  });

  it('a repeated transaction id is processed once (J: rapid repeated purchases)', () => {
    const d = setup([], { credits: 1e6 });
    const tx = 'tx_click_1';
    expect(buyItem(d, 'equipment', d.market.equipment[1].id, tx).ok).toBe(true);
    const credits = d.resources.credits;
    expect(buyItem(d, 'equipment', d.market.equipment[3].id, tx).ok).toBe(false);
    expect(d.resources.credits).toBe(credits);
  });

  it('sells items for less than they cost and removes them', () => {
    const it = gen({ category: 'reactor', rarity: 'rare' });
    const d = setup([it], { credits: 0 });
    const res = sellItems(d, [it.uid]);
    expect(res.ok && res.credits).toBe(sellPrice(it));
    expect(d.resources.credits).toBe(sellPrice(it));
    expect(d.items.some((i) => i.uid === it.uid)).toBe(false);
  });

  it('exchange packs are limited per rotation; manual refresh escalates and restocks', () => {
    const d = setup([], { credits: 1e6, salvage: 0 });
    const offer = d.market.exchange.find((o) => o.id === 'salvage_crate')!;
    const left = offer.left;
    for (let i = 0; i < left; i++) expect(buyExchange(d, 'salvage_crate').ok).toBe(true);
    expect(buyExchange(d, 'salvage_crate').ok).toBe(false);
    expect(d.resources.salvage).toBe(60 * left);
    const c0 = d.resources.credits;
    const r1 = refreshMarket(d);
    const r2 = refreshMarket(d);
    expect(r1.ok && r2.ok && r2.price > r1.price).toBe(true);
    expect(c0 - d.resources.credits).toBe((r1.ok ? r1.price : 0) + (r2.ok ? r2.price : 0));
    expect(d.market.exchange.find((o) => o.id === 'salvage_crate')!.left).toBe(left);
  });
});

describe('E/F: affix engineering', () => {
  const rich = () => gen({ category: 'processor', rarity: 'epic', level: 30 });

  it('single stat reroll produces a compatible, unique affix and charges the cost', () => {
    for (let k = 0; k < 40; k++) {
      const it = gen({ category: (['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module'] as Category[])[k % 7], rarity: 'epic', level: 5 + k * 3 });
      const d = setup([it]);
      const idx = k % it.affixes.length;
      const before = { ...d.resources };
      const pool = rerollPool(it, idx).map((a) => a.id);
      const res = rerollAffix(d, it.uid, idx, 'stat');
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      const stored = d.items.find((i) => i.uid === it.uid)!;
      const a = stored.affixes[idx];
      expect(pool).toContain(a.id);
      const def = affixDef(a.id)!;
      expect(def.weights[stored.category] ?? 0).toBeGreaterThan(0);
      expect(a.tier).toBeLessThanOrEqual(maxTierFor(stored.level));
      const groups = stored.affixes.map((x) => affixDef(x.id)!.group);
      expect(new Set(groups).size).toBe(groups.length);
      const [lo, hi] = affixValueRange(stored, def);
      expect(a.value).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(a.value).toBeLessThanOrEqual(hi + 1e-9);
      expect(isValidItem(stored)).toBe(true);
      expect(d.resources.salvage).toBe(before.salvage - (res.cost.salvage ?? 0));
      expect(d.resources.credits).toBe(before.credits - (res.cost.credits ?? 0));
      expect(stored.rerolls).toBe(1);
    }
  });

  it('value refinement keeps the stat; costs escalate with each operation', () => {
    const it = rich();
    const d = setup([it]);
    const id = it.affixes[0].id;
    const c1 = rerollCost(it, { kind: 'single', mode: 'value' });
    const r1 = rerollAffix(d, it.uid, 0, 'value');
    expect(r1.ok && r1.after.id).toBe(id);
    const stored = d.items.find((i) => i.uid === it.uid)!;
    const c2 = rerollCost(stored, { kind: 'single', mode: 'value' });
    expect(c2.salvage!).toBeGreaterThan(c1.salvage!);
    expect(rerollCost({ ...stored, rerolls: 1e6 }, { kind: 'single', mode: 'value' }).salvage!).toBeLessThanOrEqual(c1.salvage! * 10 + 1);
  });

  it('rerolls actually change equipment statistics', () => {
    const it = rich();
    const d = setup([it]);
    const sum = (x: ItemInstance) => JSON.stringify(itemModifiers(x).map((m) => [m.stat, m.value]));
    const before = sum(it);
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
      rerollAffix(d, it.uid, 0, 'stat');
      changed = sum(d.items.find((x) => x.uid === it.uid)!) !== before;
    }
    expect(changed).toBe(true);
  });

  it('locked affixes survive full recalibration exactly; locks cost components and are limited', () => {
    const it = rich();
    expect(it.affixes.length).toBeGreaterThanOrEqual(3);
    const d = setup([it]);
    expect(setAffixLock(d, it.uid, 1, true).ok).toBe(true);
    const keep = JSON.stringify(d.items.find((i) => i.uid === it.uid)!.affixes[1]);
    const free = rerollCost(it, { kind: 'full', locks: 0 });
    const locked = rerollCost(it, { kind: 'full', locks: 1 });
    expect(locked.components!).toBeGreaterThan(free.components ?? 0);
    expect(locked.salvage!).toBeGreaterThan(free.salvage!);
    for (let i = 0; i < 8; i++) {
      const r = rerollUnlocked(d, it.uid);
      expect(r.ok).toBe(true);
      const cur = d.items.find((x) => x.uid === it.uid)!;
      expect(JSON.stringify(cur.affixes[1])).toBe(keep);
      expect(cur.affixes.length).toBe(it.affixes.length);
      const groups = cur.affixes.map((x) => affixDef(x.id)!.group);
      expect(new Set(groups).size).toBe(groups.length);
    }
    // A locked affix cannot be single-rerolled; at least one affix must stay unlocked.
    expect(rerollAffix(d, it.uid, 1, 'stat').ok).toBe(false);
    for (let i = 0; i < it.affixes.length; i++) if (i !== 1) setAffixLock(d, it.uid, i, true);
    expect(d.items.find((x) => x.uid === it.uid)!.affixes.filter((a) => a.locked).length).toBe(it.affixes.length - 1);
  });

  it('ineligible rerolls fail without changes (I)', () => {
    const plain = generateItem({ uid: 'plain', seed: 1, level: 1, rarity: 'common', baseId: 'kinetic_plating', source: 't', now: 1, fixedRoll: 0.5 });
    const d = setup([plain], { salvage: 0, credits: 0, components: 0 });
    const before = snap(d);
    expect(rerollAffix(d, plain.uid, 0, 'stat').ok).toBe(false); // no affixes
    expect(rerollAffix(d, 'nope', 0, 'stat').ok).toBe(false);
    const it = rich();
    d.items.push(it);
    d.storage.uids.push(it.uid);
    const b2 = snap(d);
    expect(rerollAffix(d, it.uid, 0, 'stat').ok).toBe(false); // cannot afford
    expect(rerollAffix(d, it.uid, 99, 'stat').ok).toBe(false);
    expect(snap(d)).toBe(b2);
    void before;
  });

  it('reroll outcomes are deterministic (restoring a backup cannot fish for a better roll)', () => {
    const it = rich();
    const a = setup([JSON.parse(JSON.stringify(it))]);
    const b = setup([JSON.parse(JSON.stringify(it))]);
    const ra = rerollAffix(a, it.uid, 0, 'stat');
    const rb = rerollAffix(b, it.uid, 0, 'stat');
    expect(ra.ok && rb.ok && ra.after).toEqual(rb.ok && rb.after);
  });

  it('legendary signature effects are never touched by rerolls', () => {
    const it = gen({ category: 'accessory', rarity: 'legendary', level: 40 });
    it.signature = 'sig_reserved_test';
    const d = setup([it]);
    rerollAffix(d, it.uid, 0, 'stat');
    rerollUnlocked(d, it.uid);
    expect(d.items.find((x) => x.uid === it.uid)!.signature).toBe('sig_reserved_test');
  });

  it('installed module affixes can be rerolled in place without duplicating the module', () => {
    const w = gen({ baseId: 'beam_prism', rarity: 'epic' });
    const m = gen({ baseId: 'crit_module', rarity: 'epic' });
    const d = setup([w, m]);
    installModule(d, w.uid, w.build!.sockets.indexOf('system'), m.uid);
    expect(findOwned(d, m.uid)?.where).toBe('installed');
    expect(rerollAffix(d, m.uid, 0, 'value').ok).toBe(true);
    expect(enhanceItem(d, m.uid).ok).toBe(true);
    const all = allOwnedUids(d);
    expect(all.filter((u) => u === m.uid).length).toBe(1);
  });
});

describe('G: enhancement', () => {
  it('raises weapon damage (real WeaponDef) and consumes materials', () => {
    const w = gen({ baseId: 'plasma_repeater', rarity: 'rare', level: 12 });
    const d = setup([w]);
    const dmg0 = weaponDefFor(w)!.damage;
    const cost = enhanceCost(w);
    const before = { ...d.resources };
    expect(enhanceItem(d, w.uid).ok).toBe(true);
    const cur = d.items.find((i) => i.uid === w.uid)!;
    expect(cur.enhance).toBe(1);
    expect(weaponDefFor(cur)!.damage).toBeCloseTo(dmg0 * 1.04, 6);
    expect(cur.weapon!.damage).toBe(w.weapon!.damage); // stored roll untouched
    expect(d.resources.salvage).toBe(before.salvage - cost.salvage!);
    expect(d.resources.credits).toBe(before.credits - cost.credits!);
  });

  it('gear enhancement scales beneficial base stats only; modules scale all beneficial stats', () => {
    const armor = gen({ baseId: 'bulwark_plating', rarity: 'epic', level: 20 });
    const mods0 = itemModifiers(armor);
    armor.enhance = 5;
    const mods5 = itemModifiers(armor);
    armor.base.forEach((s, i) => {
      const good = s.value > 0 === (STAT_DEFS[s.stat].better === 'higher');
      expect(mods5[i].value).toBeCloseTo(good ? mods0[i].value * 1.2 : mods0[i].value, 9);
    });
    const oc = gen({ baseId: 'overcharge_module', rarity: 'epic' });
    const heat0 = oc.base.find((s) => s.stat === 'heatEfficiency')!.value;
    oc.enhance = 4;
    const w = gen({ baseId: 'rail_lancer', rarity: 'epic' });
    w.socketed[w.build!.sockets.indexOf('power')] = oc;
    const ms = itemModifiers(w).filter((m) => m.source === oc.uid);
    expect(ms.find((m) => m.stat === 'heatEfficiency')!.value).toBe(heat0); // penalty not amplified
    expect(ms.find((m) => m.stat === 'weaponDamageMult')!.value).toBeCloseTo(oc.base[0].value * 1.2, 9);
  });

  it('respects the rarity cap and escalating costs', () => {
    const it = gen({ category: 'shield', rarity: 'common' });
    const d = setup([it]);
    let last = 0;
    for (let i = 0; i < MAX_ENHANCE[0]; i++) {
      const c = enhanceCost(d.items.find((x) => x.uid === it.uid)!).salvage!;
      expect(c).toBeGreaterThan(last);
      last = c;
      expect(enhanceItem(d, it.uid).ok).toBe(true);
    }
    const before = snap(d);
    expect(enhanceItem(d, it.uid).ok).toBe(false);
    expect(snap(d)).toBe(before);
  });
});

describe('component engineering', () => {
  it('swaps a component within the family rules and rescales the roll', () => {
    const w = gen({ baseId: 'rail_lancer', rarity: 'epic', level: 15, seed: 4242 });
    const d = setup([w]);
    const opts = swapOptions(w, 'mechanism');
    expect(opts.every((o) => o.families.includes('rail'))).toBe(true);
    const target = opts[0];
    const mech0 = buildMechanism(w.build);
    expect(modifyComponent(d, w.uid, 'mechanism', target.id).ok).toBe(true);
    const cur = d.items.find((i) => i.uid === w.uid)!;
    expect(isValidBuild(cur.build!)).toBe(true);
    expect(buildMechanism(cur.build)).toBe(target.mechanism);
    expect(buildMechanism(cur.build)).not.toBe(mech0);
    expect(isValidItem(cur)).toBe(true);
    // A beam mechanism can never go on a railgun; unknown components are rejected.
    const before = snap(d);
    expect(modifyComponent(d, w.uid, 'mechanism', 'mc_beam').ok).toBe(false);
    expect(modifyComponent(d, w.uid, 'barrel', 'pb_twin').ok).toBe(false);
    expect(modifyComponent(d, w.uid, 'core', 'nope').ok).toBe(false);
    expect(snap(d)).toBe(before);
  });

  it('a damage component changes effective damage by its ratio', () => {
    const w = gen({ baseId: 'plasma_repeater', rarity: 'rare', seed: 77 });
    if (w.build!.core === 'co_dense') w.build!.core = 'co_cell';
    const d = setup([w]);
    const dmg0 = w.weapon!.damage;
    const ratio = (componentDef('co_dense')!.effects.damage ?? 1) / (componentDef(w.build!.core)!.effects.damage ?? 1);
    expect(modifyComponent(d, w.uid, 'core', 'co_dense').ok).toBe(true);
    expect(d.items.find((i) => i.uid === w.uid)!.weapon!.damage).toBeCloseTo(dmg0 * ratio, 0);
  });

  it('legendary-grade components are only offered to legendary+ weapons', () => {
    expect(swapOptions(gen({ baseId: 'beam_prism', rarity: 'epic' }), 'core').some((c) => c.id === 'co_prism')).toBe(false);
    expect(swapOptions(gen({ baseId: 'beam_prism', rarity: 'legendary' }), 'core').some((c) => c.id === 'co_prism' || c.id === 'co_cell')).toBe(true);
  });
});

describe('H: fabrication', () => {
  it('crafts a valid item inside the quality window and charges the recipe cost', () => {
    const d = setup([]);
    d.threat.unlocked = 3;
    d.storage.capacity = 500;
    for (const recipe of RECIPES.filter((r) => r.output.kind === 'item'))
      for (const q of QUALITIES) {
        const before = { ...d.resources };
        const res = craft(d, recipe.id, q.id);
        expect(res.ok).toBe(true);
        if (!res.ok || !res.item) continue;
        const it = res.item;
        expect(isValidItem(it)).toBe(true);
        expect(it.source).toBe('crafted');
        const ri = rarity(it.rarity).index;
        expect(ri).toBeGreaterThanOrEqual(rarity(q.min).index);
        expect(ri).toBeLessThanOrEqual(rarity(q.max).index);
        const o = recipe.output as { category: Category; family?: string; moduleBase?: string };
        expect(it.category).toBe(o.category);
        if (o.family) expect(baseDef(it.defId)!.weapon!.family).toBe(o.family);
        if (o.moduleBase) expect(it.defId).toBe(o.moduleBase);
        expect(d.storage.uids).toContain(it.uid);
        for (const k of ['salvage', 'credits', 'components'] as const) expect(d.resources[k]).toBe(before[k] - (res.cost[k] ?? 0));
      }
  });

  it('quality odds sum to 1, exclude exotics and keep legendaries rare', () => {
    for (const q of QUALITIES) {
      const odds = qualityOdds(q);
      expect(odds.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 9);
      expect(odds.some((o) => o.id === 'exotic')).toBe(false);
    }
    const mw = qualityOdds(qualityDef('masterwork')!);
    expect(mw.find((o) => o.id === 'legendary')!.p).toBeLessThan(0.15);
  });

  it('gates grades behind threat tiers and fails safely without resources or space', () => {
    const d = setup([], { salvage: 0, credits: 0, components: 0 });
    const before = snap(d);
    expect(craft(d, 'w_rail', 'superior').ok).toBe(false); // tier II required
    expect(craft(d, 'w_rail', 'standard').ok).toBe(false); // no resources
    expect(craft(d, 'nope', 'standard').ok).toBe(false);
    expect(craft(d, 'w_rail', null).ok).toBe(false);
    expect(snap(d)).toBe(before);
    d.resources = { salvage: 1e5, credits: 1e5, components: 100 };
    d.storage.capacity = d.storage.uids.length;
    expect(craft(d, 'w_rail', 'standard').ok).toBe(false); // storage full
    expect(craft(d, 'x_refine', null).ok).toBe(true); // materials need no bay
  });

  it('crafted items can be equipped and fire like dropped ones', () => {
    const d = setup([]);
    const res = craft(d, 'w_beam', 'refined');
    expect(res.ok).toBe(true);
    const def = res.ok && res.item ? weaponDefFor(res.item) : null;
    expect(def?.family).toBe('beam');
    expect(def!.damage).toBeGreaterThan(0);
  });

  it('crafting levels follow progression', () => {
    const d = setup([]);
    const r1 = craft(d, 'd_armor', 'standard');
    d.records['2'] = { bestWave: 12, bestKills: 0, runs: 1, checkpoints: 2, salvageSecured: 0, longestRun: 0, lastPlayedAt: 0 };
    d.threat.unlocked = 2;
    const r2 = craft(d, 'd_armor', 'standard');
    expect(r1.ok && r1.item!.level).toBe(1);
    expect(r2.ok && r2.item!.level).toBe(20); // 12 + tier II loot bonus 8
  });
});

describe('run income and transaction persistence', () => {
  it('credits and components are banked at checkpoints and lost when unsecured', () => {
    const d = createDefaultSave(1);
    const c0 = d.resources.credits;
    beginRun(d, 'run_e', 1, 1);
    const ledger = new RunLedger('run_e', 1, 1);
    ledger.collect({ credits: 120, components: 2, salvage: 10 });
    ledger.waveCleared(5);
    const banked = ledger.bank(5)!;
    expect(bankRewards(d, 'run_e', 5, banked)).toBe(true);
    expect(bankRewards(d, 'run_e', 5, banked)).toBe(false); // never twice
    expect(d.resources.credits).toBe(c0 + 120);
    expect(d.resources.components).toBe(2);
    ledger.collect({ credits: 50, components: 1 });
    const result = ledger.finalize('defeat');
    expect(result.creditsLost).toBe(50);
    expect(result.componentsLost).toBe(1);
    recordRun(d, result);
    expect(d.resources.credits).toBe(c0 + 120);
  });

  it('Profile.transact persists success and rolls back when the write fails', () => {
    const storage = new MemStorage();
    const p = new Profile(storage);
    p.mutate((d) => {
      d.resources.credits = 5000;
      return true;
    });
    const entry = p.save.market.equipment[1];
    const res = p.transact((d) => buyItem(d, 'equipment', entry.id));
    expect(res.ok).toBe(true);
    const reloaded = new Profile(storage);
    expect(reloaded.save.items.some((i) => i.uid === entry.item.uid)).toBe(true);
    expect(reloaded.save.resources.credits).toBe(5000 - buyPrice(entry.item));
    // Failing write: nothing changes in memory or storage.
    reloaded.failWrites = true;
    const before = JSON.stringify(reloaded.save);
    const stored = storage.getItem(SAVE_KEY);
    const e2 = reloaded.save.market.equipment[2];
    const r2 = reloaded.transact((d) => buyItem(d, 'equipment', e2.id));
    expect(r2.ok).toBe(false);
    expect(JSON.stringify(reloaded.save)).toBe(before);
    expect(storage.getItem(SAVE_KEY)).toBe(stored);
    reloaded.failWrites = false;
    expect(reloaded.transact((d) => buyItem(d, 'equipment', e2.id)).ok).toBe(true);
  });

  it('a rejected rule never leaves partial changes behind', () => {
    const p = new Profile(new MemStorage());
    const before = JSON.stringify(p.save);
    const r = p.transact((d) => {
      d.resources.credits += 999; // a buggy rule that mutates and then fails
      return { ok: false as const, reason: 'nope' };
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(p.save)).toBe(before);
  });

  it('module bases used by merchants and recipes all exist', () => {
    for (const r of RECIPES) if (r.output.kind === 'item' && r.output.moduleBase) expect(baseDef(r.output.moduleBase)?.category).toBe('module');
    expect(BASES.filter((b) => b.category === 'module' && b.weight > 0).length).toBe(RECIPES.filter((r) => r.group === 'modules').length);
  });
});
