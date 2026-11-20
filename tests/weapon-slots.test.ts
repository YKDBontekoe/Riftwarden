// Primary + secondary weapon: slot rules, save v9, holstered cooling, swap state, loadout scoring.
import { describe, expect, it } from 'vitest';
import { otherSlot, WeaponSlots, type WeaponSlotsHost } from '../src/arena/WeaponSlots';
import { coolHolstered, HEAT_PACE } from '../src/combat/heat';
import { BASE_STATS } from '../src/combat/stats';
import { equipmentModifiers, weaponDefFor } from '../src/loot/equipment';
import { generateItem, starterWeapon } from '../src/loot/generate';
import { loadoutScore, swapped } from '../src/loot/loadoutScore';
import { RunInventory } from '../src/loot/runInventory';
import type { ItemInstance } from '../src/loot/types';
import { defaultSlot, fitsSlot, getSlot } from '../src/progression/items';
import { RunLedger } from '../src/progression/run';
import { createDefaultSave, equipFromStorage, migrate, MIGRATIONS, SAVE_VERSION, sanitizeSave } from '../src/progression/save';

const gen = (seed: number, o: Partial<Parameters<typeof generateItem>[0]> = {}): ItemInstance =>
  generateItem({ uid: `u${seed}`, seed, level: 10, rarity: 'rare', category: 'weapon', source: 'test', now: 1, ...o });

describe('weapon slots', () => {
  it('the secondary slot takes weapons, is optional, and weapons default to the primary', () => {
    const w = gen(1);
    expect(fitsSlot(w, 'weapon2')).toBe(true);
    expect(fitsSlot(gen(2, { category: 'armor' }), 'weapon2')).toBe(false);
    expect(getSlot('weapon2').required).toBe(false);
    expect(defaultSlot('weapon', { weapon: 'x', weapon2: null })).toBe('weapon');
    expect(defaultSlot('accessory', { accessory: 'x', accessory2: null })).toBe('accessory2');
    expect(otherSlot('weapon')).toBe('weapon2');
  });

  it('v8 saves gain an empty secondary slot in the loadout and every preset', () => {
    const v8 = JSON.parse(JSON.stringify(createDefaultSave(0))) as Record<string, unknown>;
    v8.version = 8;
    delete (v8.loadout as Record<string, unknown>).weapon2;
    for (const p of v8.presets as { slots: Record<string, unknown> }[]) delete p.slots.weapon2;
    const m = migrate(v8, 8);
    expect(m.ok).toBe(true);
    expect(MIGRATIONS[8]).toBeTypeOf('function');
    const { data } = sanitizeSave(m.data);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.loadout.weapon2).toBeNull();
    expect(data.presets.every((p) => p.slots.weapon2 === null)).toBe(true);
  });

  it('a secondary can be equipped from storage, and is promoted when the primary is missing', () => {
    const d = createDefaultSave(0);
    const w = gen(3);
    d.items.push(w);
    d.storage.uids.push(w.uid);
    expect(equipFromStorage(d, w.uid, 'weapon2')).toBe(true);
    expect(d.loadout.weapon2).toBe(w.uid);
    const primary = d.loadout.weapon!;
    d.items = d.items.filter((i) => i.uid !== primary);
    d.loadout.weapon = null;
    const { data } = sanitizeSave(JSON.parse(JSON.stringify(d)));
    expect(data.loadout.weapon).toBe(w.uid);
    expect(data.loadout.weapon2).toBeNull();
  });

  it('a holstered weapon cools at full rate with no delay and clears its lockout at the recover threshold', () => {
    const def = weaponDefFor(starterWeapon('s', 1))!;
    const a = coolHolstered({ heat: 100, overheated: true }, def, 1, 0.5);
    expect(a.heat).toBeCloseTo(100 - def.coolRate * HEAT_PACE.cool * 0.5, 6);
    expect(a.overheated).toBe(a.heat > def.overheatRecover);
    let s = { heat: 100, overheated: true };
    for (let i = 0; i < 600; i++) s = coolHolstered(s, def, 1, 1 / 60);
    expect(s).toEqual({ heat: 0, overheated: false });
  });

  it('stat composition leaves the holstered weapon out', () => {
    const p = gen(4);
    const s = gen(5, { baseId: 'rail_lancer' });
    const inv = new RunInventory({ weapon: p, weapon2: s }, new RunLedger('r', 1, 1));
    expect(inv.equippedItems('weapon2').map((i) => i.uid)).toEqual([p.uid]);
    expect(inv.equippedItems('weapon').map((i) => i.uid)).toEqual([s.uid]);
    expect(equipmentModifiers(inv.equippedItems('weapon2'))).toEqual(equipmentModifiers([p]));
  });
});

describe('weapon swap state', () => {
  function rig(loadout: Record<string, ItemInstance | null>) {
    const calls = { rebuild: 0, changed: 0, set: [] as string[] };
    const weapon = {
      heat: 0,
      overheated: false,
      heatState() { return { heat: this.heat, overheated: this.overheated }; }, // prettier-ignore
      restoreHeat(s: { heat: number; overheated: boolean }) { this.heat = s.heat; this.overheated = s.overheated; }, // prettier-ignore
      setItem(item: ItemInstance | null) { calls.set.push(item?.uid ?? '-'); }, // prettier-ignore
    };
    const host = {
      inventory: new RunInventory(loadout, new RunLedger('r', 1, 1)),
      weapon,
      stats: { ...BASE_STATS },
      rebuildStats: () => calls.rebuild++,
      changed: () => calls.changed++,
    } as unknown as WeaponSlotsHost;
    return { slots: new WeaponSlots(host), weapon, calls, host };
  }

  it('swapping parks the heat of the weapon in hand and restores the other one', () => {
    const p = gen(6);
    const s = gen(7, { baseId: 'beam_prism' });
    const { slots, weapon, calls } = rig({ weapon: p, weapon2: s });
    expect(slots.hasSecondary).toBe(true);
    weapon.heat = 80;
    weapon.overheated = true;
    expect(slots.swap()).toBe(true);
    expect(slots.active).toBe('weapon2');
    expect(slots.inactive).toBe('weapon');
    expect(weapon.heat).toBe(0);
    expect(slots.parkedHeat).toEqual({ heat: 80, overheated: true });
    expect(calls.set).toEqual([s.uid]);
    expect(calls.rebuild).toBe(1);
    slots.update(10);
    expect(slots.parkedHeat).toEqual({ heat: 0, overheated: false });
    expect(slots.swap('weapon2')).toBe(false);
    expect(slots.swap('weapon')).toBe(true);
    expect(calls.set).toEqual([s.uid, p.uid]);
  });

  it('without a secondary there is nothing to swap to; losing the secondary falls back to the primary', () => {
    const p = gen(8);
    const s = gen(9);
    const none = rig({ weapon: p });
    expect(none.slots.hasSecondary).toBe(false);
    expect(none.slots.swap()).toBe(false);
    const two = rig({ weapon: p, weapon2: s });
    two.slots.swap();
    expect(two.host.inventory.unequip('weapon2', true)).toBe('ok');
    expect(two.slots.sync().item?.uid).toBe(p.uid);
    expect(two.slots.active).toBe('weapon');
  });
});

describe('two-weapon loadout score', () => {
  it('firepower is the better weapon; the secondary never changes survivability', () => {
    const starter = starterWeapon('s', 1);
    const strong = gen(10, { level: 40, baseId: 'plasma_repeater', rarity: 'epic' });
    const one = loadoutScore([starter]);
    const two = loadoutScore([starter, strong]);
    expect(two.dps).toBeGreaterThan(one.dps);
    expect(two.dps).toBeCloseTo(loadoutScore([strong]).dps, 6);
    expect(two.ehp).toBeCloseTo(one.ehp, 6);
    expect(two.mobility).toBeCloseTo(one.mobility, 6);
  });

  it('a replacement keeps the replaced item position (primary stays first)', () => {
    const a = gen(11);
    const b = gen(12);
    const c = gen(13);
    expect(swapped([a, b], c, a).map((i) => i.uid)).toEqual([c.uid, b.uid]);
    expect(swapped([a, null], c, null).map((i) => i.uid)).toEqual([a.uid, c.uid]);
    expect(swapped([a, b], null, b).map((i) => i.uid)).toEqual([a.uid]);
  });
});
