import { describe, expect, it } from 'vitest';
import { applyDamage, mulberry32 } from '@riftwarden/rules/combat/damage';
import {
  AFFINITY_MAX, AFFINITY_MIN, ELEMENTS, FACTION_AFFINITY, RESIST, WEAK,
  affinity, affinitySign, elementPayload, procWeight, rollElement, sectorAffinity,
} from '@riftwarden/rules/combat/elements';
import { applyCorrode, CORRODE_SHRED, CORRODE_TIME, hasAnyStatus, MAX_CORRODE, newStatus, tickStatus, vulnerability } from '@riftwarden/rules/combat/status';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { weaponDefFor } from '@riftwarden/rules/loot/equipment';
import { sanitizeItem } from '@riftwarden/rules/progression/save/sanitize';
import { composeTower } from '@riftwarden/rules/towers/components';
import { BIOMES } from '@riftwarden/rules/world/biomes';

const walker = { kind: 'walker' as const, mods: [] };

describe('element affinities', () => {
  it('every faction exists in the biome table and every element is a weakness once and a resistance once', () => {
    const ids = Object.values(BIOMES).map((b) => b.faction.id).sort();
    expect(Object.keys(FACTION_AFFINITY).sort()).toEqual(ids);
    for (const el of ELEMENTS) {
      const weak = Object.values(FACTION_AFFINITY).filter((r) => r.weak.includes(el)).length;
      const resist = Object.values(FACTION_AFFINITY).filter((r) => r.resist.includes(el)).length;
      expect([el, weak, resist]).toEqual([el, 1, 1]);
    }
    for (const r of Object.values(FACTION_AFFINITY)) expect(r.weak.some((e) => r.resist.includes(e))).toBe(false);
  });

  it('applies faction rows, neutral without a faction, untyped damage is never scaled', () => {
    expect(affinity('thermal', walker, 'rime')).toBe(WEAK);
    expect(affinity('cryo', walker, 'rime')).toBe(RESIST);
    expect(affinity('void', walker, 'rime')).toBe(1);
    expect(affinity('thermal', walker, null)).toBe(1);
    expect(affinity('none', walker, 'rime')).toBe(1);
    expect(sectorAffinity('electric', 'scrap')).toBe(1);
    expect(sectorAffinity('kinetic', 'scrap')).toBe(-1);
    expect(sectorAffinity('kinetic', null)).toBe(0);
  });

  it('archetype / mutation overrides stack and stay clamped; bosses use their own row', () => {
    expect(affinity('corrosive', { kind: 'bulwark', mods: [] }, null)).toBeCloseTo(1.25);
    expect(affinity('corrosive', { kind: 'bulwark', mods: [] }, 'rime')).toBeCloseTo(WEAK * 1.25);
    expect(affinity('cryo', { kind: 'walker', mods: ['frostbound'] }, 'rime')).toBe(AFFINITY_MIN); // 0.65 x 0.6 clamps
    expect(affinity('thermal', { kind: 'walker', mods: ['molten'] }, 'crucible')).toBeGreaterThanOrEqual(AFFINITY_MIN);
    // Colossus ignores the faction: kinetic is resisted even where the faction is weak to it.
    expect(affinity('kinetic', { kind: 'colossus', mods: [] }, 'crucible')).toBe(RESIST);
    expect(affinity('void', { kind: 'overseer', mods: [] }, 'crucible')).toBe(WEAK);
    for (const el of ELEMENTS) for (const f of [null, 'scrap', 'rime', 'crucible']) for (const kind of ['walker', 'bulwark', 'colossus'] as const) {
      const m = affinity(el, { kind, mods: ['armored', 'frostbound', 'molten', 'shielded'] }, f);
      expect(m).toBeGreaterThanOrEqual(AFFINITY_MIN);
      expect(m).toBeLessThanOrEqual(AFFINITY_MAX);
    }
    expect(affinitySign(WEAK)).toBe(1);
    expect(affinitySign(RESIST)).toBe(-1);
    expect(affinitySign(1)).toBe(0);
  });
});

describe('weapon element rolls', () => {
  it('is deterministic, covers every element and leans elemental with rarity', () => {
    expect(rollElement('plasma', 2, mulberry32(7))).toBe(rollElement('plasma', 2, mulberry32(7)));
    const count = (rarity: number, family: 'plasma' | 'rail' | 'beam') => {
      const n: Record<string, number> = {};
      const r = mulberry32(99 + rarity);
      for (let i = 0; i < 4000; i++) {
        const e = rollElement(family, rarity, r);
        n[e] = (n[e] ?? 0) + 1;
      }
      return n;
    };
    const common = count(0, 'plasma');
    const exotic = count(5, 'plasma');
    expect(Object.keys(common).sort()).toEqual([...ELEMENTS].sort());
    expect(common.kinetic).toBeGreaterThan(exotic.kinetic * 2);
    const rail = count(3, 'rail');
    const beam = count(3, 'beam');
    expect(rail.void).toBeGreaterThan(beam.void);
    expect(beam.thermal).toBeGreaterThan(rail.thermal);
  });

  it('generated weapons store their element; starter kit is kinetic; the def carries it', () => {
    let elemental = 0;
    for (let s = 1; s <= 60; s++) {
      const it = generateItem({ uid: `w${s}`, seed: s * 7919, level: 10, rarity: 'epic', category: 'weapon', source: 'drop' });
      expect(ELEMENTS).toContain(it.weapon!.element);
      expect(weaponDefFor(it)!.element).toBe(it.weapon!.element);
      if (it.weapon!.element !== 'kinetic') elemental++;
      const again = generateItem({ uid: `w${s}`, seed: s * 7919, level: 10, rarity: 'epic', category: 'weapon', source: 'drop', now: it.acquiredAt });
      expect(again).toEqual(it);
    }
    expect(elemental).toBeGreaterThan(20);
    const starter = generateItem({ uid: 's', seed: 1, level: 1, rarity: 'common', baseId: 'plasma_repeater', source: 'starter', fixedRoll: 0.5 });
    expect(starter.weapon!.element).toBe('kinetic');
  });

  it('pre-element weapons are kinetic; sanitize keeps valid elements and drops junk', () => {
    const it = generateItem({ uid: 'x', seed: 4242, level: 5, rarity: 'rare', baseId: 'rail_lancer', source: 'drop' });
    const old = structuredClone(it);
    delete old.weapon!.element;
    expect(weaponDefFor(old)!.element).toBe('kinetic');
    const keep = sanitizeItem({ ...structuredClone(it), weapon: { ...it.weapon, element: 'void' } })!;
    expect(keep.weapon!.element).toBe('void');
    const junk = sanitizeItem({ ...structuredClone(it), weapon: { ...it.weapon, element: 'plasma-death' } })!;
    expect(junk.weapon!.element).toBeUndefined();
    expect(weaponDefFor(junk)!.element).toBe('kinetic');
  });
});

describe('element statuses', () => {
  it('payloads per element, weighted by hits per second', () => {
    expect(procWeight(8)).toBe(1);
    expect(procWeight(1)).toBe(4);
    expect(procWeight(1000)).toBe(0.25);
    expect(elementPayload('kinetic', 100, 1, 0)).toBeUndefined();
    expect(elementPayload('void', 100, 1, 0)).toBeUndefined();
    expect(elementPayload('thermal', 100, 1, 0)!.burn).toBeGreaterThan(0);
    expect(elementPayload('cryo', 10, 4, 0)!.chill).toBeGreaterThan(elementPayload('cryo', 10, 0.5, 0)!.chill!);
    expect(elementPayload('electric', 10, 1, 0.01)!.shock).toBe(true);
    expect(elementPayload('electric', 10, 1, 0.99)).toBeUndefined();
    expect(elementPayload('corrosive', 100, 1, 0)!.corrode).toBeGreaterThan(0);
  });

  it('corrode stacks to the cap, shreds armour, ticks damage and expires', () => {
    const s = newStatus();
    for (let i = 0; i < 10; i++) applyCorrode(s, 4);
    expect(s.corrodeStacks).toBe(MAX_CORRODE);
    expect(hasAnyStatus(s)).toBe(true);
    expect(vulnerability(s)).toBeCloseTo(1 + MAX_CORRODE * CORRODE_SHRED);
    let dealt = 0;
    const expired: string[] = [];
    for (let t = 0; t < CORRODE_TIME + 1; t += 0.1) tickStatus(s, 0.1, { burn: () => {}, corrode: (d) => (dealt += d), expire: (k) => expired.push(k) });
    expect(dealt).toBeGreaterThan(4 * MAX_CORRODE * (CORRODE_TIME - 0.6));
    expect(expired).toContain('corrode');
    expect(s.corrodeStacks).toBe(0);
    expect(vulnerability(s)).toBe(1);
  });

  it('void pierces shields, electric is strong against them', () => {
    const h = { hp: 100, maxHp: 100, shield: 50, maxShield: 50 };
    const r = applyDamage(h, 30, 'kinetic', true);
    expect(r.toShield).toBe(0);
    expect(h.hp).toBe(70);
    expect(h.shield).toBe(50);
    const h2 = { hp: 100, maxHp: 100, shield: 50, maxShield: 50 };
    applyDamage(h2, 20, 'energy');
    expect(h2.shield).toBe(20);
  });
});

describe('tower elements', () => {
  it('ballistic / missile weapons take the core element, kinetic by default; arc and cryo keep theirs', () => {
    expect(composeTower({ base: 'standard', weapon: 'autocannon', core: 'standard_core', modifier: 'none' }, 1).element).toBe('kinetic');
    expect(composeTower({ base: 'standard', weapon: 'autocannon', core: 'thermal_core', modifier: 'none' }, 1).element).toBe('thermal');
    const cor = composeTower({ base: 'standard', weapon: 'missile_battery', core: 'corrosive_core', modifier: 'none' }, 1);
    expect(cor.element).toBe('corrosive');
    expect(cor.corrodeFrac).toBeGreaterThan(0);
    expect(composeTower({ base: 'standard', weapon: 'marksman', core: 'void_core', modifier: 'none' }, 1).element).toBe('void');
    expect(composeTower({ base: 'standard', weapon: 'chain_emitter', core: 'void_core', modifier: 'none' }, 1).element).toBe('electric');
    expect(composeTower({ base: 'standard', weapon: 'frost_projector', core: 'standard_core', modifier: 'none' }, 1).element).toBe('cryo');
  });
});
