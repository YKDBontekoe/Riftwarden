import { describe, expect, it } from 'vitest';
import { computeStats } from '@riftwarden/rules/combat/stats';
import { BASES } from '@riftwarden/rules/loot/bases';
import { equipmentModifiers, itemModifiers, weaponDefFor, weaponStatRows, weaponSummary, withSocket } from '@riftwarden/rules/loot/equipment';
import { generateItem, isValidItem } from '@riftwarden/rules/loot/generate';
import { RARITIES, type RarityId } from '@riftwarden/rules/loot/rarity';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { allOwnedUids, checksum, createDefaultSave, installModule, parseSave, type SaveData, scrapItem, serializeSave, transferModule, uninstallModule } from '@riftwarden/rules/progression/save';
import { buildEffects, FAMILIES, isValidBuild } from '@riftwarden/rules/weapons/build';
import { componentDef, COMPONENTS } from '@riftwarden/rules/weapons/components';
import { canInstall, MODULE_TYPES, moduleTypeDef, removalCost } from '@riftwarden/rules/weapons/modules';

let n = 0;
const gen = (baseId: string, rarity: RarityId = 'epic', seed = 1000 + ++n, level = 8): ItemInstance =>
  generateItem({ uid: `w${++n}`, seed, level, rarity, baseId, source: 'test', now: 1 });
const WEAPON_BASES = BASES.filter((b) => b.category === 'weapon').map((b) => b.id);
const MODULE_BASES = BASES.filter((b) => b.category === 'module' && b.weight > 0).map((b) => b.id);

/** A save holding a weapon (equipped) plus stored weapons/modules and salvage. */
function saveWith(equipped: ItemInstance, stored: ItemInstance[], salvage = 1000): SaveData {
  const d = createDefaultSave(1);
  d.storage.uids.push(d.loadout.weapon!);
  d.items.push(equipped, ...stored);
  d.loadout.weapon = equipped.uid;
  d.storage.uids.push(...stored.map((i) => i.uid));
  d.resources.salvage = salvage;
  return d;
}

describe('B: procedural weapon generation', () => {
  it('every family/base generates valid, deterministic, renderable builds', () => {
    const combos = new Set<string>();
    for (const baseId of WEAPON_BASES) {
      for (const r of RARITIES) {
        for (let s = 0; s < 25; s++) {
          const a = generateItem({ uid: 'x', seed: s * 7919 + 13, level: 12, rarity: r.id, baseId, source: 't', now: 1 });
          const b = generateItem({ uid: 'x', seed: s * 7919 + 13, level: 12, rarity: r.id, baseId, source: 't', now: 1 });
          expect(b).toEqual(a);
          expect(isValidItem(a)).toBe(true);
          expect(a.build && isValidBuild(a.build)).toBe(true);
          expect(a.build!.family).toBe(FAMILIES[a.build!.family].id);
          // Components belong to the family; mechanism is one the family supports.
          for (const id of [a.build!.barrel, a.build!.core, a.build!.cooling, a.build!.mechanism, ...a.build!.attachments]) expect(componentDef(id)!.families).toContain(a.build!.family);
          // Rarity-dependent sockets (configurable table) with typed socket kinds.
          expect(a.sockets).toBe(r.sockets);
          expect(a.build!.sockets.length).toBe(r.sockets);
          expect(a.socketed).toEqual(Array(r.sockets).fill(null));
          // Prism cores only at legendary+.
          if (a.build!.core === 'co_prism') expect(r.index).toBeGreaterThanOrEqual(4);
          const w = weaponDefFor(a)!;
          expect(w.family).toBe(a.build!.family);
          for (const v of [w.damage, w.fireRate, w.heatPerShot, w.coolRate, w.range, w.spreadMin, w.chargeTime, w.rampMax]) expect(Number.isFinite(v) && v >= 0).toBe(true);
          combos.add(`${a.build!.barrel}/${a.build!.core}/${a.build!.cooling}/${a.build!.mechanism}`);
        }
      }
    }
    expect(combos.size).toBeGreaterThan(40);
  });

  it('socket counts follow the configured rarity table 0/1/2/3/4/4', () => {
    expect(RARITIES.map((r) => r.sockets)).toEqual([0, 1, 2, 3, 4, 4, 4]);
  });

  it('component effects are baked into the stored roll (and visible in the def)', () => {
    let found = 0;
    for (let s = 0; s < 200 && found < 3; s++) {
      const it = generateItem({ uid: 'q', seed: s, level: 1, rarity: 'rare', baseId: 'plasma_repeater', source: 't', now: 1 });
      if (it.build!.barrel !== 'pb_long' || it.build!.mechanism === 'mc_scatter') continue;
      found++;
      // Long shroud: +25% range scaled by the length parameter, tighter spread.
      expect(it.weapon!.range).toBeGreaterThan(140);
      expect(weaponDefFor(it)!.spreadMin).toBeLessThan(0.002);
    }
    expect(found).toBeGreaterThan(0);
    const e = buildEffects({ ...gen('rail_lancer').build!, barrel: 'rb_quad' });
    expect(e.pierce).toBe(1);
  });

  it('families play differently: mechanisms, heat profiles and DPS shapes differ', () => {
    const p = weaponDefFor(gen('plasma_repeater', 'common'))!;
    const r = weaponDefFor(gen('rail_lancer', 'common'))!;
    const b = weaponDefFor(gen('beam_prism', 'common'))!;
    expect(['auto', 'burst', 'scatter']).toContain(p.mechanism);
    expect(['charge', 'cycle']).toContain(r.mechanism);
    expect(['beam', 'pulse']).toContain(b.mechanism);
    if (p.mechanism !== 'scatter') {
      expect(r.damage).toBeGreaterThan(p.damage * 3);
      if (b.mechanism === 'beam') expect(b.range).toBeLessThan(p.range);
      expect(r.heatPerShot).toBeGreaterThan(p.heatPerShot * 2);
    }
    expect(r.pierce).toBeGreaterThanOrEqual(1);
    expect(b.rampMax).toBeGreaterThan(1.5);
  });

  it('M7 firing styles: scatter (short-range pellet cone) and pulse (slow detonating pulses) roll and differ', () => {
    const find = (base: string, mech: string) => {
      for (let s = 0; s < 400; s++) {
        const it = generateItem({ uid: 'm', seed: s, level: 5, rarity: 'rare', baseId: base, source: 't', now: 1 });
        if (it.build!.mechanism === mech) return weaponDefFor(it)!;
      }
      return null;
    };
    const sc = find('plasma_repeater', 'mc_scatter');
    const au = find('plasma_repeater', 'mc_auto');
    const pu = find('beam_prism', 'mc_pulse');
    const be = find('beam_prism', 'mc_beam');
    expect(sc && au && pu && be).toBeTruthy();
    expect(sc!.mechanism).toBe('scatter');
    expect(sc!.range).toBeLessThan(au!.range * 0.6);
    expect(sc!.fireRate).toBeLessThan(au!.fireRate * 0.4);
    expect(pu!.mechanism).toBe('pulse');
    expect(pu!.damage).toBeGreaterThan(be!.damage * 5);
    expect(pu!.fireRate).toBeLessThan(be!.fireRate * 0.2);
    const sumSc = weaponSummary(sc!);
    expect(sumSc.projectiles).toBe(7);
  });

  it('starter weapon keeps the M1/M2 numbers with a default build', () => {
    const d = createDefaultSave(1);
    const w = d.items[0];
    expect(w.weapon!.damage).toBe(13);
    expect(w.weapon!.coolRate).toBe(55);
    expect(w.build!.barrel).toBe('pb_single');
    expect(w.sockets).toBe(0);
  });
});

describe('modules: generation and effects', () => {
  it('every module type has a definition, a socket kind and at least one stat', () => {
    for (const id of MODULE_BASES) {
      for (const r of RARITIES) {
        const m = generateItem({ uid: 'm', seed: 99, level: 10, rarity: r.id, baseId: id, source: 't', now: 1 });
        expect(isValidItem(m)).toBe(true);
        expect(m.sockets).toBe(0);
        const def = moduleTypeDef(m.module!.type)!;
        expect(def).toBeTruthy();
        expect(m.base.length + m.affixes.length).toBeGreaterThan(0);
      }
    }
    expect(MODULE_TYPES.filter((t) => !t.legacy).length).toBe(10); // 8 general + 2 boss components (M6)
  });

  it('splitter adds exactly one projectile with weaker bolts; trade-offs are real', () => {
    const s = gen('splitter_module', 'rare');
    const proj = s.base.find((x) => x.stat === 'projectiles')!;
    expect(proj.value).toBe(1);
    const w = gen('plasma_repeater', 'rare');
    const before = computeStats(itemModifiers(w));
    const after = computeStats(itemModifiers(withSocket(w, w.build!.sockets.indexOf('barrel'), s)));
    expect(after.projectiles).toBe(before.projectiles + 1);
    expect(after.weaponDamageMult).toBeLessThan(before.weaponDamageMult);
    expect(after.spreadMult).toBeGreaterThan(before.spreadMult);
    const oc = gen('overcharge_module', 'rare');
    const wp = withSocket(w, w.build!.sockets.indexOf('power'), oc);
    const st = computeStats(itemModifiers(wp));
    expect(st.weaponDamageMult).toBeGreaterThan(before.weaponDamageMult);
    expect(st.heatEfficiency).toBeLessThan(before.heatEfficiency);
  });

  it('installed modules apply exactly once and only via their weapon', () => {
    const w = gen('plasma_repeater', 'epic');
    const amp = gen('amp_module', 'epic');
    const inst = withSocket(w, w.build!.sockets.indexOf('power'), amp);
    const mods = equipmentModifiers([inst]);
    expect(mods.filter((m) => m.source === amp.uid).length).toBe(amp.base.length + amp.affixes.length);
    // A loose module contributes nothing even if passed as "equipped".
    expect(itemModifiers(amp)).toEqual([]);
    const dpsA = weaponStatRows(w).find((r) => r.key === 'dps')!.value;
    const dpsB = weaponStatRows(inst).find((r) => r.key === 'dps')!.value;
    expect(dpsB).toBeGreaterThan(dpsA);
  });

  it('compatibility: socket kind, family, occupancy, non-weapons', () => {
    const plasma = gen('plasma_repeater', 'legendary');
    const rail = gen('rail_lancer', 'legendary');
    const split = gen('splitter_module', 'rare');
    const amp = gen('amp_module', 'rare');
    const barrel = plasma.build!.sockets.indexOf('barrel');
    const power = plasma.build!.sockets.indexOf('power');
    expect(canInstall(plasma, barrel, split).ok).toBe(true);
    expect(canInstall(plasma, power, split).ok).toBe(false); // wrong socket kind
    expect(canInstall(rail, rail.build!.sockets.indexOf('barrel'), split).ok).toBe(false); // plasma only
    expect(canInstall(plasma, power, amp).ok).toBe(true);
    expect(canInstall(plasma, 9, amp).ok).toBe(false);
    expect(canInstall(gen('kinetic_plating'), 0, amp).ok).toBe(false);
    expect(canInstall(withSocket(plasma, power, amp), power, gen('amp_module')).ok).toBe(false); // occupied
    expect(removalCost(amp)).toBeGreaterThan(0);
  });
});

describe('C/D/E: engineering transactions', () => {
  const setup = () => {
    const w = gen('plasma_repeater', 'epic');
    const w2 = gen('rail_lancer', 'legendary');
    const amp = gen('amp_module', 'rare');
    const split = gen('splitter_module', 'rare');
    const d = saveWith(w, [w2, amp, split]);
    return { d, w, w2, amp, split, power: w.build!.sockets.indexOf('power'), barrel: w.build!.sockets.indexOf('barrel') };
  };

  it('C: install moves the module out of storage into the weapon, persists across reload', () => {
    const { d, w, amp, power } = setup();
    const r = installModule(d, w.uid, power, amp.uid);
    expect(r).toEqual({ ok: true, cost: 0 });
    expect(d.storage.uids).not.toContain(amp.uid);
    expect(d.items.some((i) => i.uid === amp.uid)).toBe(false);
    const weapon = d.items.find((i) => i.uid === w.uid)!;
    expect(weapon.socketed[power]!.uid).toBe(amp.uid);
    // No duplicate uids anywhere.
    const all = allOwnedUids(d);
    expect(new Set(all).size).toBe(all.length);
    // Repeating the same install is rejected (module no longer in storage).
    expect(installModule(d, w.uid, power, amp.uid).ok).toBe(false);
    const re = parseSave(serializeSave(d));
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    const w2 = re.data.items.find((i) => i.uid === w.uid)!;
    expect(w2.socketed[power]!.uid).toBe(amp.uid);
    expect(w2.socketed[power]!.base).toEqual(amp.base);
    expect(re.data.storage.uids).not.toContain(amp.uid);
  });

  it('D: removal charges salvage once, returns the module, no duplicates', () => {
    const { d, w, amp, power } = setup();
    installModule(d, w.uid, power, amp.uid);
    const cost = removalCost(amp);
    const s0 = d.resources.salvage;
    const r = uninstallModule(d, w.uid, power);
    expect(r).toEqual({ ok: true, cost });
    expect(d.resources.salvage).toBe(s0 - cost);
    expect(d.storage.uids).toContain(amp.uid);
    expect(d.items.find((i) => i.uid === w.uid)!.socketed[power]).toBeNull();
    expect(uninstallModule(d, w.uid, power).ok).toBe(false); // already empty: nothing charged
    expect(d.resources.salvage).toBe(s0 - cost);
    const all = allOwnedUids(d);
    expect(new Set(all).size).toBe(all.length);
  });

  it('D: removal is refused without salvage or storage space (nothing changes)', () => {
    const { d, w, amp, power } = setup();
    installModule(d, w.uid, power, amp.uid);
    d.resources.salvage = removalCost(amp) - 1;
    const snap = JSON.stringify(d);
    expect(uninstallModule(d, w.uid, power).ok).toBe(false);
    expect(JSON.stringify(d)).toBe(snap);
    d.resources.salvage = 10000;
    d.storage.capacity = d.storage.uids.length;
    const snap2 = JSON.stringify(d);
    expect(uninstallModule(d, w.uid, power).ok).toBe(false);
    expect(JSON.stringify(d)).toBe(snap2);
  });

  it('E: incompatible installs are rejected with no change', () => {
    const { d, w, w2, split, power } = setup();
    const snap = JSON.stringify(d);
    expect(installModule(d, w.uid, power, split.uid).ok).toBe(false); // barrel module in power socket
    expect(installModule(d, w2.uid, w2.build!.sockets.indexOf('barrel'), split.uid).ok).toBe(false); // rail
    expect(installModule(d, w.uid, power, 'nope').ok).toBe(false);
    expect(JSON.stringify(d)).toBe(snap);
  });

  it('transfer moves a module between weapons for the removal cost', () => {
    const { d, w, w2, amp, power } = setup();
    installModule(d, w.uid, power, amp.uid);
    const target = w2.build!.sockets.indexOf('power');
    const s0 = d.resources.salvage;
    expect(transferModule(d, w.uid, power, w2.uid, target).ok).toBe(true);
    expect(d.resources.salvage).toBe(s0 - removalCost(amp));
    expect(d.items.find((i) => i.uid === w.uid)!.socketed[power]).toBeNull();
    expect(d.items.find((i) => i.uid === w2.uid)!.socketed[target]!.uid).toBe(amp.uid);
    const all = allOwnedUids(d);
    expect(new Set(all).size).toBe(all.length);
  });

  it('engineering is refused during an active run', () => {
    const { d, w, amp, power } = setup();
    d.activeRun = { id: 'r', tier: 1, startedAt: 0, bankedThroughWave: 0, salvageSecured: 0, itemsSecured: 0, creditsSecured: 0, componentsSecured: 0 };
    expect(installModule(d, w.uid, power, amp.uid).ok).toBe(false);
  });

  it('scrapping a weapon returns its modules to storage', () => {
    const { d, w2, amp } = setup();
    const p = w2.build!.sockets.indexOf('power');
    expect(installModule(d, w2.uid, p, amp.uid).ok).toBe(true);
    expect(scrapItem(d, w2.uid)).toBeGreaterThan(0);
    expect(d.storage.uids).toContain(amp.uid);
    expect(d.items.some((i) => i.uid === amp.uid)).toBe(true);
  });
});

describe('H: save v2 -> v3 migration and sanitising', () => {
  /** A v2 (M2) save: weapon without build, M2 socket counts, module uid list, M2 modules. */
  function v2Text(): string {
    const w = { uid: 'old_w', defId: 'heavy_repeater', acquiredAt: 1, source: 'run_a', category: 'weapon', level: 9, rarity: 'rare', name: 'KR-2 Heavy Repeater', base: [{ stat: 'critMultiplier', op: 'add', value: 0.2 }], affixes: [{ id: 'dmg', stat: 'weaponDamageMult', op: 'pct', value: 0.1, tier: 2, roll: 0.5 }], weapon: { damage: 31, fireRate: 6.3, heatPerShot: 9, coolRate: 53 }, sockets: 1, modules: [], signature: null, seed: 5, gen: 1 };
    const s = { uid: 'old_s', defId: 'shield_matrix', acquiredAt: 1, source: 'run_a', category: 'shield', level: 3, rarity: 'epic', name: 'Shield Matrix', base: [{ stat: 'shieldCapacity', op: 'add', value: 30 }], affixes: [], sockets: 2, modules: [], signature: null, seed: 6, gen: 1 };
    const m = { uid: 'old_m', defId: 'capacitor_module', acquiredAt: 1, source: 'run_a', category: 'module', level: 4, rarity: 'uncommon', name: 'Capacitor Module', base: [], affixes: [{ id: 'dmg', stat: 'weaponDamageMult', op: 'pct', value: 0.05, tier: 1, roll: 0.4 }], module: { type: 'capacitor', compatible: ['weapon', 'shield'], socketCost: 1 }, sockets: 0, modules: [], signature: null, seed: 7, gen: 1 };
    const data = { ...JSON.parse(JSON.stringify(createDefaultSave(1))), version: 2, items: [w, s, m], loadout: { weapon: 'old_w', armor: null, shield: 'old_s', reactor: null, processor: null, accessory: null, accessory2: null }, storage: { capacity: 50, expansions: 0, uids: ['old_m'] } };
    const body = JSON.stringify(data);
    return `{"v":2,"sum":"${checksum(body)}","data":${body}}`;
  }

  it('keeps every item and stat, adds a default build, sets M3 sockets', () => {
    const r = parseSave(v2Text(), Date.now(), { upTo: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(2);
    const d = r.data;
    expect(d.items.map((i) => i.uid).sort()).toEqual(['old_m', 'old_s', 'old_w']);
    const w = d.items.find((i) => i.uid === 'old_w')!;
    expect(w.weapon).toMatchObject({ damage: 31, fireRate: 6.3, heatPerShot: 9, coolRate: 53 });
    expect(w.affixes[0].value).toBe(0.1);
    expect(w.build && isValidBuild(w.build)).toBe(true);
    expect(w.build!.chassis).toBe('heavy_repeater');
    expect(w.sockets).toBe(2); // rare -> 2 in M3
    expect(w.socketed).toEqual([null, null]);
    expect(weaponDefFor(w)!.damage).toBe(31);
    expect(d.items.find((i) => i.uid === 'old_s')!.sockets).toBe(0);
    const m = d.items.find((i) => i.uid === 'old_m')!;
    expect(m.module!.compatible).toEqual(['weapon']);
    // The old capacitor module is installable into a power socket.
    expect(canInstall(w, w.build!.sockets.indexOf('power'), m).ok).toBe(true);
    expect(installModule(d, 'old_w', w.build!.sockets.indexOf('power'), 'old_m').ok).toBe(true);
  });

  it('sanitize repairs invalid builds, duplicated modules and incompatible sockets without losing items', () => {
    const w = gen('plasma_repeater', 'legendary');
    const amp = gen('amp_module', 'rare');
    const split = gen('splitter_module', 'rare');
    const d = saveWith(w, [amp]);
    // Tamper: amp is both installed and loose; splitter sits in a power socket; garbage build field.
    const weapon = d.items.find((i) => i.uid === w.uid)!;
    weapon.socketed[weapon.build!.sockets.indexOf('power')] = { ...amp };
    weapon.socketed[weapon.build!.sockets.indexOf('system')] = split;
    const r = parseSave(serializeSave(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = allOwnedUids(r.data);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain(amp.uid);
    expect(all).toContain(split.uid); // evicted to storage, not deleted
    expect(r.data.storage.uids).toContain(split.uid);
    // An invalid component id (rail barrel on a plasma weapon) falls back to the default build.
    const tampered = JSON.parse(JSON.stringify(d)) as SaveData;
    tampered.items.find((i) => i.uid === w.uid)!.build!.barrel = 'rb_quad';
    const body = JSON.stringify(tampered);
    const bad = parseSave(`{"v":3,"sum":"${checksum(body)}","data":${body}}`, Date.now(), { upTo: 10 });
    expect(bad.ok).toBe(true);
    if (bad.ok) expect(isValidBuild(bad.data.items.find((i) => i.uid === w.uid)!.build!)).toBe(true);
  });

  it('components table is consistent (every slot has options for every family)', () => {
    for (const f of ['plasma', 'rail', 'beam'] as const)
      for (const slot of ['barrel', 'core', 'cooling', 'mechanism'] as const) expect(COMPONENTS.some((c) => c.slot === slot && c.families.includes(f))).toBe(true);
    const ws = weaponSummary(weaponDefFor(gen('rail_lancer'))!);
    expect(ws.dps).toBeGreaterThan(0);
  });
});
