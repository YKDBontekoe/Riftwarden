import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { FAMILY_ELEMENTS, rollElement } from '@riftwarden/rules/combat/elements';
import { salvoDrones } from '@riftwarden/game/combat/Weapon';
import { dismantleYield } from '@riftwarden/rules/economy/config';
import { engineeringRand, swapComponent } from '@riftwarden/rules/economy/engineering';
import { ascendCost, ascendOwned, dismantleItems, rerollAffix } from '@riftwarden/rules/economy/transactions';
import { recipeBases, recipeDef } from '@riftwarden/rules/economy/recipes';
import { uniqueHitMult } from '@riftwarden/game/arena/PlayerCombat';
import { ASCEND, ascendBlock, ascendDrop, ascendItem } from '@riftwarden/rules/loot/ascend';
import { DROP_SOURCES, rollDrops } from '@riftwarden/rules/loot/drops';
import { weaponDefFor, weaponSummary } from '@riftwarden/rules/loot/equipment';
import { generateItem, isValidItem, maxTierFor } from '@riftwarden/rules/loot/generate';
import { RARITIES, rarity, rollRarity } from '@riftwarden/rules/loot/rarity';
import { rollLoot } from '@riftwarden/rules/loot/roll';
import { rollSignature, SIGNATURES, signatureDef } from '@riftwarden/rules/loot/signatures';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { gearUniques, generateUnique, isValidUnique, uniqueDef, uniqueForDrop, UNIQUES } from '@riftwarden/rules/loot/uniques';
import { RunLedger } from '@riftwarden/rules/progression/run';
import { bankRewards, beginRun, createDefaultSave, parseSave, sanitizeItem, sanitizeSave, serializeSave, type SaveData } from '@riftwarden/rules/progression/save';
import { isValidBuild } from '@riftwarden/rules/weapons/build';

let n = 0;
const gen = (o: Partial<{ baseId: string; rarity: ItemInstance['rarity']; level: number; seed: number }> = {}) =>
  generateItem({ uid: `ld${++n}`, seed: o.seed ?? 9000 + n * 17, level: o.level ?? 20, rarity: o.rarity ?? 'rare', baseId: o.baseId, category: o.baseId ? undefined : 'weapon', source: 'test', now: 1 });

function setup(stored: ItemInstance[] = [], res: Partial<SaveData['resources']> = {}): SaveData {
  const d = createDefaultSave(1);
  d.items.push(...stored);
  d.storage.uids.push(...stored.map((i) => i.uid));
  d.resources = { salvage: 1e5, credits: 1e5, components: 1000, shards: 0, ...res };
  return d;
}
const snap = (d: SaveData) => JSON.stringify(d);

// ------------------------------------------------------------------ Drone Swarm

describe('Drone Swarm family', () => {
  it('every hive chassis generates valid, deterministic swarm weapons with drones and a lock cone', () => {
    for (const baseId of ['swarm_hive', 'swarm_brood', 'swarm_wasp']) {
      for (const r of RARITIES) {
        const a = gen({ baseId, rarity: r.id, seed: 77 + r.index });
        const b = generateItem({ uid: a.uid, seed: a.seed, level: a.level, rarity: r.id, baseId, source: 'test', now: 1 });
        expect(b).toEqual(a);
        expect(isValidItem(a)).toBe(true);
        expect(a.build!.family).toBe('swarm');
        expect(isValidBuild(a.build!)).toBe(true);
        expect(a.weapon!.drones).toBeGreaterThanOrEqual(3);
        expect(a.weapon!.seekCone).toBeGreaterThan(0);
        const def = weaponDefFor(a)!;
        expect(def.family).toBe('swarm');
        expect(['swarm', 'salvo']).toContain(def.mechanism);
        expect(def.drones).toBe(a.weapon!.drones);
      }
    }
  });

  it('the summary counts drones per launch (a salvo releases 3x at full lock)', () => {
    const it = gen({ baseId: 'swarm_hive', rarity: 'common', seed: 5 });
    const def = { ...weaponDefFor(it)!, mechanism: 'swarm' as const };
    expect(weaponSummary(def).projectiles).toBe(def.drones);
    expect(weaponSummary({ ...def, mechanism: 'salvo' }).projectiles).toBe(def.drones * 3);
    expect(weaponSummary(def).dps).toBeGreaterThan(0);
    expect(salvoDrones(3, 0)).toBe(2);
    expect(salvoDrones(3, 1)).toBe(9);
    expect(salvoDrones(3, Number.NaN)).toBe(2);
  });

  it('leans electric / corrosive and keeps its element through a component refit', () => {
    const w = FAMILY_ELEMENTS.swarm;
    expect(w.electric).toBeGreaterThan(w.cryo);
    expect(w.corrosive).toBeGreaterThan(w.void);
    const counts: Record<string, number> = {};
    const rand = mulberry32(3);
    for (let i = 0; i < 4000; i++) {
      const e = rollElement('swarm', 5, rand);
      counts[e] = (counts[e] ?? 0) + 1;
    }
    expect(counts.electric).toBeGreaterThan(counts.cryo);
    let swapped = false;
    for (let s = 0; s < 40 && !swapped; s++) {
      const it = gen({ baseId: 'swarm_hive', rarity: 'epic', seed: 300 + s });
      if (it.weapon!.element === 'kinetic' || it.build!.barrel === 'sw_hive') continue;
      const res = swapComponent(it, 'barrel', 'sw_hive');
      expect(res).not.toBeNull();
      expect(res!.weapon.element).toBe(it.weapon!.element);
      expect(res!.weapon.drones).toBe(it.weapon!.drones! + 1);
      swapped = true;
    }
    expect(swapped).toBe(true);
  });

  it('sanitize keeps the swarm roll; the fabricator can make hives', () => {
    const it = gen({ baseId: 'swarm_wasp', rarity: 'rare' });
    const back = sanitizeItem(JSON.parse(JSON.stringify(it)))!;
    expect(back.weapon!.drones).toBe(it.weapon!.drones);
    expect(back.weapon!.seekCone).toBe(it.weapon!.seekCone);
    expect(recipeBases(recipeDef('w_swarm')!).map((b) => b.id).sort()).toEqual(['swarm_brood', 'swarm_hive', 'swarm_wasp']);
  });
});

// ------------------------------------------------------------------ Ascended + rift shards

describe('Ascended tier', () => {
  it('is never rolled by weight, even at maximum luck', () => {
    expect(rarity('ascended').weight).toBe(0);
    const rand = mulberry32(11);
    for (let i = 0; i < 20000; i++) expect(rollRarity(rand, 99, 'legendary')).not.toBe('ascended');
  });

  it('promotes about one exotic drop in ten, only on deep waves or tier III+', () => {
    let hits = 0;
    for (let s = 0; s < 5000; s++) {
      expect(ascendDrop(s, 10, 2)).toBe(false);
      if (ascendDrop(s, 15, 1)) hits++;
      expect(ascendDrop(s, 1, 3)).toBe(ascendDrop(s, 40, 1));
    }
    expect(hits / 5000).toBeGreaterThan(0.07);
    expect(hits / 5000).toBeLessThan(0.13);
    // A boss at wave 40 eventually yields one through the real drop roll.
    const rand = mulberry32(9);
    let found = false;
    for (let i = 0; i < 400 && !found; i++) found = rollDrops(DROP_SOURCES.boss, { wave: 40, tier: 5, tierLevelBonus: 18, tierLuck: 2 }, rand).some((d) => d.rarity === 'ascended');
    expect(found).toBe(true);
  });

  it('generates an exotic plus one perfect top-tier affix, the ascended finish and a signature', () => {
    for (let s = 0; s < 20; s++) {
      const a = gen({ baseId: 'rail_lancer', rarity: 'ascended', level: 40, seed: 700 + s });
      const perfect = a.affixes[a.affixes.length - 1];
      expect(perfect.roll).toBe(1);
      expect(perfect.tier).toBe(maxTierFor(40));
      expect(new Set(a.affixes.map((x) => x.id)).size).toBe(a.affixes.length);
      expect(a.name.startsWith('Ascended ')).toBe(true);
      expect(a.build!.finish).toBe('ascended');
      expect(a.signature).not.toBeNull();
      expect(signatureDef(a.signature)!.unique).toBeFalsy();
      expect(isValidItem(a)).toBe(true);
    }
  });

  it('ascends an Exotic deterministically: stronger rolls, one perfect extra affix; others are refused', () => {
    const ex = gen({ baseId: 'beam_prism', rarity: 'exotic', level: 30, seed: 41 });
    const up = ascendItem(ex, mulberry32(1))!;
    expect(up.rarity).toBe('ascended');
    expect(up.affixes.length).toBe(ex.affixes.length + 1);
    expect(up.weapon!.damage).toBeGreaterThan(ex.weapon!.damage);
    ex.affixes.forEach((a, i) => expect(up.affixes[i].value).toBeGreaterThanOrEqual(a.value));
    expect(ascendItem(ex, mulberry32(1))).toEqual(up);
    expect(ascendBlock(up)).toMatch(/Already/);
    expect(ascendBlock(gen({ rarity: 'legendary' }))).toMatch(/Exotic/);
  });

  it('the HQ transaction spends shards, is atomic and matches the preview', () => {
    const ex = gen({ baseId: 'plasma_repeater', rarity: 'exotic', level: 12, seed: 5 });
    const poor = setup([ex]);
    const before = snap(poor);
    const r0 = ascendOwned(poor, ex.uid);
    expect(r0.ok).toBe(false);
    expect(snap(poor)).toBe(before);
    const cost = ascendCost(ex);
    expect(cost.shards).toBe(ASCEND.shards(12));
    const d = setup([structuredClone(ex)], { shards: 50 });
    const r = ascendOwned(d, ex.uid, 'tx1');
    expect(r.ok).toBe(true);
    const owned = d.items.find((i) => i.uid === ex.uid)!;
    expect(owned.rarity).toBe('ascended');
    expect(d.resources.shards).toBe(50 - cost.shards!);
    expect(ascendOwned(d, ex.uid, 'tx1').ok).toBe(false); // repeated tx id
    // The preview the workshop shows equals the committed item.
    const preview = ascendItem(ex, engineeringRand(ex, 'ascend'));
    expect(owned.affixes).toEqual(preview!.affixes);
    // Runs block HQ engineering.
    const live = setup([structuredClone(ex)], { shards: 50 });
    beginRun(live, 'run_x', 1, 1);
    expect(ascendOwned(live, ex.uid).ok).toBe(false);
  });
});

describe('Rift shards', () => {
  it('are unsecured until a checkpoint, lost on defeat, and banked into the profile', () => {
    const l = new RunLedger('r1', 1, 0);
    l.collect({ shards: 3 });
    l.waveCleared(5);
    const moved = l.bank(5)!;
    expect(moved.shards).toBe(3);
    l.collect({ shards: 2 });
    const res = l.finalize('defeat');
    expect(res.shardsSecured).toBe(3);
    expect(res.shardsLost).toBe(2);
    const d = createDefaultSave(1);
    beginRun(d, 'r1', 1, 1);
    expect(bankRewards(d, 'r1', 5, { salvage: 0, items: [], shards: 3 })).toBe(true);
    expect(d.resources.shards).toBe(3);
  });

  it('old saves load with 0 shards; dismantling exotics and ascended items recovers some', () => {
    const d = createDefaultSave(1);
    const raw = JSON.parse(serializeSave(d));
    delete raw.data.resources.shards;
    expect(sanitizeSave(raw.data).data.resources.shards).toBe(0);
    const r = parseSave(serializeSave(sanitizeSave(raw.data).data));
    expect(r.ok && r.data.resources.shards).toBe(0);
    expect(dismantleYield(gen({ rarity: 'exotic' })).shards).toBe(1);
    expect(dismantleYield(gen({ rarity: 'ascended' })).shards).toBe(5);
    expect(dismantleYield(gen({ rarity: 'legendary' })).shards).toBe(0);
    const ex = gen({ rarity: 'exotic' });
    const s = setup([ex]);
    expect(dismantleItems(s, [ex.uid]).ok).toBe(true);
    expect(s.resources.shards).toBe(1);
  });
});

// ------------------------------------------------------------------ uniques

describe('Hand-made uniques', () => {
  it('ships at least 12 valid uniques with distinct ids and names; weapon mechanics are unique-only signatures', () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(UNIQUES.map((u) => u.id)).size).toBe(UNIQUES.length);
    expect(new Set(UNIQUES.map((u) => u.name)).size).toBe(UNIQUES.length);
    for (const u of UNIQUES) {
      expect(isValidUnique(u), u.id).toBe(true);
      if (u.signature) expect(signatureDef(u.signature)?.unique, u.id).toBe(true);
    }
    // Random legendaries/exotics never roll a unique-only signature.
    for (let s = 0; s < 3000; s++) expect(signatureDef(rollSignature({ seed: s, rarity: s % 2 ? 'exotic' : 'legendary', category: 'weapon' }))!.unique).toBeFalsy();
    expect(SIGNATURES.filter((s) => s.unique).length).toBe(UNIQUES.filter((u) => u.signature).length);
  });

  it('generates deterministically with the fixed name, affixes, element and identity', () => {
    for (const u of UNIQUES) {
      const a = generateUnique(u, { uid: `u.${u.id}`, seed: 123, level: 25, source: 'test', now: 1 });
      const b = generateUnique(u, { uid: `u.${u.id}`, seed: 123, level: 25, source: 'test', now: 1 });
      expect(b).toEqual(a);
      expect(a.name).toBe(u.name);
      expect(a.uniqueId).toBe(u.id);
      expect(a.defId).toBe(u.baseId);
      expect(a.affixes.map((x) => x.id)).toEqual(u.affixes);
      expect(a.affixes.every((x) => x.roll >= 0.7 && x.tier === maxTierFor(25))).toBe(true);
      if (u.element) expect(a.weapon!.element).toBe(u.element);
      expect(isValidItem(a)).toBe(true);
      // Survives sanitize (save round trip) with its identity.
      const back = sanitizeItem(JSON.parse(JSON.stringify(a)))!;
      expect(back.uniqueId).toBe(u.id);
      expect(back.signature).toBe(a.signature);
    }
    // A forged unique id on the wrong base is dropped.
    const fake = { ...gen({ baseId: 'plasma_repeater' }), uniqueId: 'heartbreaker' };
    expect(sanitizeItem(JSON.parse(JSON.stringify(fake)))!.uniqueId).toBeUndefined();
  });

  it('target farming: only listed sources (and factions) drop a unique, at about the listed rate', () => {
    for (let s = 0; s < 3000; s++) {
      expect(uniqueForDrop('walker', s, 'rime')).toBeNull();
      const u = uniqueForDrop('elite', s, null);
      if (u) expect(u.drops.faction).toBeUndefined();
      const r = uniqueForDrop('burrower', s, 'crucible');
      expect(r).toBeNull();
    }
    let colossus = 0;
    for (let s = 0; s < 20000; s++) if (uniqueForDrop('colossus', s, null)) colossus++;
    const expected = 1 - UNIQUES.filter((u) => u.drops.sources.includes('colossus')).reduce((p, u) => p * (1 - u.drops.chance), 1);
    expect(colossus / 20000).toBeGreaterThan(expected * 0.8);
    expect(colossus / 20000).toBeLessThan(expected * 1.2);
    // Through the real roll: Colossus kills eventually yield a Colossus unique, at most one per kill.
    const rand = mulberry32(4);
    let got: ItemInstance | null = null;
    for (let i = 0; i < 200 && !got; i++) {
      const items = rollLoot({ source: DROP_SOURCES.colossus, wave: 12, tier: { lootLevelBonus: 8, lootLuck: 1.3 }, rand, nextUid: () => `c${i}.${Math.random()}`, originId: 'run', faction: null });
      expect(items.filter((x) => x.uniqueId).length).toBeLessThanOrEqual(1);
      got = items.find((x) => x.uniqueId) ?? null;
    }
    expect(got).not.toBeNull();
    expect(uniqueDef(got!.uniqueId)!.drops.sources).toContain('colossus');
  });

  it('mechanics: hit multipliers and equipped gear effects', () => {
    const none = new Set<string>();
    expect(uniqueHitMult('u_heartbreaker', none, { weak: true, chilled: false, heat: 0, dist: 5 })).toBeCloseTo(1.7);
    expect(uniqueHitMult('u_heartbreaker', none, { weak: false, chilled: false, heat: 0, dist: 5 })).toBe(1);
    expect(uniqueHitMult('u_rimebreath', none, { weak: false, chilled: true, heat: 0, dist: 5 })).toBeCloseTo(1.4);
    const gear = new Set(['u_reactorheart', 'u_monocle']);
    expect(uniqueHitMult(null, gear, { weak: false, chilled: false, heat: 0.7, dist: 40 })).toBeCloseTo(1.3 * 1.35);
    expect(uniqueHitMult(null, gear, { weak: false, chilled: false, heat: 0.5, dist: 20 })).toBe(1);
    const mantle = generateUnique(uniqueDef('bulwark_mantle')!, { uid: 'm', seed: 1, level: 5, source: 't' });
    const gaze = generateUnique(uniqueDef('prism_gaze')!, { uid: 'g', seed: 1, level: 5, source: 't' });
    expect([...gearUniques([mantle, gaze, gen()])]).toEqual(['u_mantle']);
  });

  it('unique affixes are fixed and uniques cannot ascend', () => {
    const u = generateUnique(uniqueDef('orbital_writ')!, { uid: 'ow', seed: 2, level: 10, source: 't' });
    const d = setup([u]);
    const before = snap(d);
    expect(rerollAffix(d, u.uid, 0, 'value').ok).toBe(false);
    expect(snap(d)).toBe(before);
    expect(ascendBlock(u)).toMatch(/Unique/);
  });
});
