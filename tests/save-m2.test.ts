import { describe, expect, it } from 'vitest';
import { weaponDefFor } from '@riftwarden/rules/loot/equipment';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { RunInventory, RUN_CARGO_CAPACITY } from '@riftwarden/rules/loot/runInventory';
import type { Category, ItemInstance } from '@riftwarden/rules/loot/types';
import { RunLedger } from '@riftwarden/rules/progression/run';
import {
  applyLoadout,
  bankRewards,
  beginRun,
  checksum,
  createDefaultSave,
  deployBlocker,
  equipFromStorage,
  equippedItem,
  expandStorage,
  loadPreset,
  parseSave,
  recordRun,
  type SaveData,
  savePreset,
  scrapItem,
  serializeSave,
  STORAGE_CAPACITY,
  storedItems,
} from '@riftwarden/rules/progression/save';

let n = 0;
const item = (category: Category = 'weapon', rarity: ItemInstance['rarity'] = 'rare', level = 7): ItemInstance =>
  generateItem({ uid: `t${++n}`, seed: 1000 + n, level, rarity, category, source: 'run_x', now: 1 });

/** Exactly what an M1 build wrote (v1 envelope, legacy item shape, 'module' slot). */
function m1SaveText(): string {
  const data = {
    version: 1,
    profile: { id: 'pf_1', callsign: 'WARDEN', createdAt: 1, lastSavedAt: 2 },
    resources: { salvage: 321 },
    items: [
      { uid: 'it_starter', defId: 'plasma_repeater', acquiredAt: 1, source: 'starter' },
      { uid: 'it_extra', defId: 'plasma_repeater', acquiredAt: 5, source: 'run_a' },
    ],
    storage: { capacity: 40, uids: ['it_extra'] },
    loadout: { weapon: 'it_starter', armor: null, shield: null, reactor: null, processor: null, module: null, accessory: null },
    threat: { selected: 2, unlocked: 2 },
    records: { '1': { bestWave: 7, bestKills: 50, runs: 3, checkpoints: 1, salvageSecured: 300, longestRun: 400, lastPlayedAt: 9 } },
    totals: { runs: 3, returned: 1, defeated: 2, abandoned: 0, interrupted: 0, kills: 120, salvageSecured: 321 },
    history: [{ id: 'run_a', tier: 1, outcome: 'returned', finalWave: 6, wavesCleared: 5, kills: 40, duration: 300, salvageSecured: 100, salvageLost: 0, endedAt: 9, newRecord: true }],
    activeRun: null,
    base: { layoutVersion: 1, placeables: [], facilities: ['command'] },
  };
  const body = JSON.stringify(data);
  return `{"v":1,"sum":"${checksum(body)}","data":${body}}`;
}

describe('save v2 (scenario H)', () => {
  it('migrates an M1 save without losing progress or items', () => {
    const r = parseSave(m1SaveText());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(1);
    const d = r.data;
    expect(d.resources.salvage).toBe(321);
    expect(d.threat.unlocked).toBe(2);
    expect(d.records['1'].bestWave).toBe(7);
    expect(d.items.map((i) => i.uid).sort()).toEqual(['it_extra', 'it_starter']);
    const w = equippedItem(d, 'weapon')!;
    expect(w.uid).toBe('it_starter');
    expect(w.level).toBe(1);
    expect(w.rarity).toBe('common');
    expect(weaponDefFor(w)!.damage).toBe(13); // same weapon as M1
    expect(storedItems(d).map((i) => i.uid)).toEqual(['it_extra']);
    expect(d.storage.capacity).toBe(STORAGE_CAPACITY);
    expect('module' in d.loadout).toBe(false);
    expect(d.presets.length).toBe(3);
    // Upgrade is deterministic: loading twice yields identical items.
    const again = parseSave(m1SaveText());
    expect(again.ok && again.data.items).toEqual(d.items);
  });

  it('generated items survive save/load byte-for-byte (no rerolls)', () => {
    const d = createDefaultSave(1);
    beginRun(d, 'r1', 1, 1);
    const loot = [item('weapon', 'legendary', 40), item('armor', 'epic'), item('module', 'rare'), item('shield', 'exotic', 300)];
    expect(bankRewards(d, 'r1', 5, { salvage: 10, items: loot })).toBe(true);
    const text = serializeSave(d);
    const back = parseSave(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    for (const it of loot) expect(back.data.items.find((i) => i.uid === it.uid)).toEqual(it);
    // And again through a second write/read cycle.
    const back2 = parseSave(serializeSave(back.data));
    expect(back2.ok && back2.data.items).toEqual(back.data.items);
  });

  it('keeps items whose base definition disappeared (inert, not equippable)', () => {
    const d = createDefaultSave(1);
    const ghost = { ...item('armor'), defId: 'removed_base_v9' };
    d.items.push(ghost);
    d.storage.uids.push(ghost.uid);
    const back = parseSave(serializeSave(d));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.items.some((i) => i.uid === ghost.uid)).toBe(true);
    expect(equipFromStorage(back.data, ghost.uid)).toBe(false);
  });

  it('rejects invalid numbers without dropping the item', () => {
    const d = createDefaultSave(1);
    const bad = item('reactor') as unknown as Record<string, unknown>;
    (bad.affixes as { value: number }[])[0] && ((bad.affixes as { value: unknown }[])[0].value = 'NaN');
    bad.level = 1e99;
    d.items.push(bad as unknown as ItemInstance);
    d.storage.uids.push(bad.uid as string);
    const back = parseSave(serializeSave(d));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const it = back.data.items.find((i) => i.uid === bad.uid)!;
    expect(it).toBeDefined();
    expect(Number.isFinite(it.level)).toBe(true);
    expect(it.affixes.every((a) => Number.isFinite(a.value))).toBe(true);
  });
});

describe('banking and ownership (scenarios D, E, F)', () => {
  function startRun(d: SaveData, id = 'run1') {
    beginRun(d, id, 1, 1);
    const ledger = new RunLedger(id, 1, 1);
    const inv = new RunInventory({ weapon: equippedItem(d, 'weapon') }, ledger);
    return { ledger, inv };
  }

  it('D: collected items are banked once at the checkpoint and persist', () => {
    const d = createDefaultSave(1);
    const { ledger, inv } = startRun(d);
    const a = item('armor');
    const b = item('weapon');
    expect(inv.collect(a)).toBe(true);
    expect(inv.collect(b)).toBe(true);
    expect(inv.collect(a)).toBe(true); // idempotent pickup
    expect(ledger.unsecured.items.length).toBe(2);
    ledger.waveCleared(5);
    const banked = ledger.bank(5)!;
    expect(bankRewards(d, 'run1', 5, banked)).toBe(true);
    expect(bankRewards(d, 'run1', 5, banked)).toBe(false); // repeated hook: no duplicates
    expect(storedItems(d).map((i) => i.uid)).toEqual([a.uid, b.uid]);
    expect(inv.status(a.uid)).toBe('secured');
    expect(d.totals.itemsSecured).toBe(2);
  });

  it('E: defeat loses only unsecured loot; banked and pre-run gear stay', () => {
    const d = createDefaultSave(1);
    const starter = equippedItem(d, 'weapon')!.uid;
    const { ledger, inv } = startRun(d);
    const early = item('shield');
    inv.collect(early);
    ledger.waveCleared(5);
    bankRewards(d, 'run1', 5, ledger.bank(5)!);
    const late = item('processor', 'legendary');
    inv.collect(late);
    ledger.waveCleared(8);
    const res = ledger.finalize('defeat');
    recordRun(d, res);
    applyLoadout(d, inv.ownedLoadout());
    expect(res.itemsLost).toBe(1);
    expect(res.lostItems![0].uid).toBe(late.uid);
    expect(d.items.some((i) => i.uid === late.uid)).toBe(false);
    expect(d.items.some((i) => i.uid === early.uid)).toBe(true);
    expect(d.loadout.weapon).toBe(starter);
    expect(d.totals.itemsLost).toBe(1);
  });

  it('F: an unbanked item equipped during prep is lost and the loadout reverts', () => {
    const d = createDefaultSave(1);
    const starter = equippedItem(d, 'weapon')!.uid;
    const { ledger, inv } = startRun(d);
    const found = item('weapon', 'exotic', 30);
    const armor = item('armor');
    inv.collect(found);
    inv.collect(armor);
    expect(inv.equip(found.uid, false)).toBe('locked'); // combat: not allowed
    expect(inv.equip(found.uid, true)).toBe('ok');
    expect(inv.equip(armor.uid, true)).toBe('ok');
    expect(inv.equipped('weapon')!.uid).toBe(found.uid);
    expect(inv.status(found.uid)).toBe('unsecured'); // equipping never secures
    // Save is untouched while the run is active.
    expect(d.loadout.weapon).toBe(starter);
    expect(equipFromStorage(d, starter)).toBe(false);
    const res = ledger.finalize('defeat');
    recordRun(d, res);
    applyLoadout(d, inv.ownedLoadout());
    expect(d.loadout.weapon).toBe(starter);
    expect(d.loadout.armor).toBeNull();
    expect(d.items.some((i) => i.uid === found.uid || i.uid === armor.uid)).toBe(false);
    expect(deployBlocker(d)).toBeNull();
  });

  it('secured items equipped during the run stay equipped after extraction', () => {
    const d = createDefaultSave(1);
    const starter = equippedItem(d, 'weapon')!.uid;
    const { ledger, inv } = startRun(d);
    const w = item('weapon');
    inv.collect(w);
    ledger.waveCleared(5);
    bankRewards(d, 'run1', 5, ledger.bank(5)!);
    inv.equip(w.uid, true);
    recordRun(d, ledger.finalize('returned'));
    applyLoadout(d, inv.ownedLoadout());
    expect(d.loadout.weapon).toBe(w.uid);
    expect(d.storage.uids).toContain(starter);
    expect(new Set([...d.storage.uids, ...Object.values(d.loadout).filter(Boolean)]).size).toBe(d.items.length);
  });

  it('cargo capacity, discard rules and module handling', () => {
    const d = createDefaultSave(1);
    const { ledger, inv } = startRun(d);
    for (let i = 0; i < RUN_CARGO_CAPACITY; i++) expect(inv.collect(item('accessory'))).toBe(true);
    const extra = item('accessory');
    expect(inv.collect(extra)).toBe(false); // full: stays in the world, nothing deleted
    const first = ledger.unsecured.items[0];
    expect(inv.discard(first.uid, false)).toBe(false);
    inv.equip(first.uid, true);
    expect(inv.discard(first.uid, true)).toBe(false); // equipped
    inv.unequip('accessory', true);
    expect(inv.discard(first.uid, true)).toBe(true);
    expect(inv.collect(extra)).toBe(true);
    expect(inv.unequip('weapon', true)).toBe('required');
    const mod = item('module');
    ledger.discard(ledger.unsecured.items[0].uid);
    inv.collect(mod);
    expect(inv.equip(mod.uid, true)).toBe('module');
  });
});

describe('HQ management', () => {
  it('presets save and restore configurations; missing items are skipped', () => {
    const d = createDefaultSave(1);
    const a1 = item('armor');
    const s1 = item('shield');
    d.items.push(a1, s1);
    d.storage.uids.push(a1.uid, s1.uid);
    expect(equipFromStorage(d, a1.uid)).toBe(true);
    expect(savePreset(d, 0, 'TANK')).toBe(true);
    expect(equipFromStorage(d, s1.uid)).toBe(true);
    d.loadout.armor && applyLoadout(d, { armor: null });
    expect(d.loadout.armor).toBeNull();
    expect(loadPreset(d, 0)).toBe(true);
    expect(d.loadout.armor).toBe(a1.uid);
    expect(d.loadout.shield).toBeNull();
    expect(d.storage.uids).toContain(s1.uid);
    // Every item is in exactly one place.
    const placed = [...d.storage.uids, ...Object.values(d.loadout).filter(Boolean)];
    expect(placed.length).toBe(d.items.length);
    expect(new Set(placed).size).toBe(d.items.length);
  });

  it('scrap gives salvage, expansion costs salvage, over-capacity blocks deployment', () => {
    const d = createDefaultSave(1);
    for (let i = 0; i < STORAGE_CAPACITY + 2; i++) {
      const it = item('module', 'common', 1);
      d.items.push(it);
      d.storage.uids.push(it.uid);
    }
    expect(deployBlocker(d)).toMatch(/capacity/);
    const before = d.resources.salvage;
    const gained = scrapItem(d, d.storage.uids[0]);
    expect(gained).toBeGreaterThan(0);
    expect(d.resources.salvage).toBe(before + gained);
    expect(scrapItem(d, d.loadout.weapon!)).toBe(0); // equipped: not scrappable
    expect(expandStorage(d)).toBe(false); // too poor
    d.resources.salvage = 1000;
    expect(expandStorage(d)).toBe(true);
    expect(d.storage.capacity).toBe(STORAGE_CAPACITY + 10);
    expect(deployBlocker(d)).toBeNull();
    // Capacity is derived from expansions after a reload.
    const back = parseSave(serializeSave(d));
    expect(back.ok && back.data.storage.capacity).toBe(STORAGE_CAPACITY + 10);
  });
});
