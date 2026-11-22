// Abilities: definitions, scaling rules, loot integration, save v10 and the arena runtime (with fakes, no scene).
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ABILITIES, ABILITY_KINDS, abilityCooldown, abilityPower, abilityRadius, blinkDistance, BLINK_MARGIN, THROW, ultChargeNeeded, ultGain } from '@riftwarden/rules/abilities/defs';
import { Abilities, type AbilityHost } from '@riftwarden/game/arena/Abilities';
import { BASE_STATS, computeStats, STAT_KEYS } from '@riftwarden/rules/combat/stats';
import { itemModifiers } from '@riftwarden/rules/loot/equipment';
import { BASES } from '@riftwarden/rules/loot/bases';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { RunInventory } from '@riftwarden/rules/loot/runInventory';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { fitsSlot } from '@riftwarden/rules/progression/items';
import { RunLedger } from '@riftwarden/rules/progression/run';
import { createDefaultSave, migrate, SAVE_VERSION, sanitizeSave } from '@riftwarden/rules/progression/save';
import { STAT_HELP } from '@riftwarden/client/ui/statHelp';

const gen = (baseId: string, o: Partial<Parameters<typeof generateItem>[0]> = {}): ItemInstance =>
  generateItem({ uid: `u_${baseId}_${o.seed ?? 1}`, seed: o.seed ?? 1, level: 10, rarity: 'rare', baseId, source: 'test', now: 1, ...o });

describe('ability definitions and loot', () => {
  it('every ability kind has exactly one base of the matching category, and bases only grant known kinds', () => {
    for (const k of ABILITY_KINDS) {
      const bases = BASES.filter((b) => b.ability === k);
      expect(bases.length, k).toBe(1);
      expect(bases[0].category, k).toBe(ABILITIES[k].category);
    }
    for (const b of BASES) if (b.category === 'ability' || b.category === 'ultimate') expect(b.ability, b.id).toBeDefined();
  });

  it('ability items generate with affixes on real stats, fit only their slots and have help text', () => {
    const frag = gen('frag_charge', { rarity: 'epic' });
    const lance = gen('orbital_lance', { rarity: 'epic' });
    expect(frag.category).toBe('ability');
    expect(frag.affixes.length).toBeGreaterThan(0);
    expect(fitsSlot(frag, 'ability') && fitsSlot(frag, 'ability2') && !fitsSlot(frag, 'ultimate')).toBe(true);
    expect(fitsSlot(lance, 'ultimate') && !fitsSlot(lance, 'ability')).toBe(true);
    for (const m of [...itemModifiers(frag), ...itemModifiers(lance)]) expect(STAT_KEYS).toContain(m.stat);
    for (const k of ['abilityPowerMult', 'abilityCooldownMult', 'abilityRadiusMult', 'ultChargeMult'] as const) expect(STAT_HELP[k]).toBeTruthy();
  });

  it('power grows with level and rarity and the power stat; cooldown and radius follow their stats', () => {
    const d = ABILITIES.frag;
    const low = abilityPower(d, { level: 1, rarity: 'common' }, BASE_STATS);
    const high = abilityPower(d, { level: 40, rarity: 'legendary' }, BASE_STATS);
    expect(low).toBeCloseTo(d.power, 6);
    expect(high).toBeGreaterThan(low * 3);
    const st = computeStats([{ stat: 'abilityPowerMult', op: 'pct', value: 0.5 }, { stat: 'abilityCooldownMult', op: 'pct', value: -0.2 }, { stat: 'abilityRadiusMult', op: 'pct', value: 0.25 }]);
    expect(abilityPower(d, { level: 1, rarity: 'common' }, st)).toBeCloseTo(d.power * 1.5, 6);
    expect(abilityCooldown(d, st)).toBeCloseTo(d.cooldown * 0.8, 6);
    expect(abilityRadius(d, st)).toBeCloseTo(d.radius * 1.25, 6);
    // Overdrive is a duration: rarity only, never the level.
    expect(abilityPower(ABILITIES.overdrive, { level: 200, rarity: 'common' }, BASE_STATS)).toBeCloseTo(ABILITIES.overdrive.power, 6);
  });

  it('ultimate charge needs more damage at higher item levels; the charge stat speeds it up', () => {
    const d = ABILITIES.orbital;
    expect(ultChargeNeeded(d, { level: 30 })).toBeGreaterThan(ultChargeNeeded(d, { level: 1 }));
    const need = ultChargeNeeded(d, { level: 1 });
    expect(ultGain(need, need, BASE_STATS)).toBeCloseTo(1, 6);
    expect(ultGain(need / 2, need, computeStats([{ stat: 'ultChargeMult', op: 'pct', value: 1 }]))).toBeCloseTo(1, 6);
    expect(ultGain(Number.NaN, need, BASE_STATS)).toBe(0);
  });

  it('blink stops short of walls and never goes backwards', () => {
    expect(blinkDistance(10, null)).toBe(10);
    expect(blinkDistance(10, 6)).toBeCloseTo(6 - BLINK_MARGIN, 6);
    expect(blinkDistance(10, 0.3)).toBe(0);
  });

  it('v9 saves gain empty ability and ultimate slots', () => {
    const v9 = JSON.parse(JSON.stringify(createDefaultSave(0))) as Record<string, unknown>;
    v9.version = 9;
    const lo = v9.loadout as Record<string, unknown>;
    delete lo.ability;
    delete lo.ability2;
    delete lo.ultimate;
    const m = migrate(v9, 9);
    expect(m.ok).toBe(true);
    const { data } = sanitizeSave(m.data);
    expect(data.version).toBe(SAVE_VERSION);
    expect([data.loadout.ability, data.loadout.ability2, data.loadout.ultimate]).toEqual([null, null, null]);
    expect(data.presets.every((p) => p.slots.ultimate === null)).toBe(true);
  });
});

describe('ability runtime', () => {
  let engine: NullEngine;
  let scene: Scene;
  beforeAll(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterAll(() => {
    scene.dispose();
    engine.dispose();
  });

  function rig(loadout: Record<string, ItemInstance | null>) {
    const fx = new Proxy({}, { get: () => () => 0 });
    const pos = new Vector3(0, 1, 0);
    const player = {
      position: pos,
      eye: new Vector3(0, 1.6, 0),
      alive: true,
      shield: 0,
      maxShield: 0,
      forward: (o = new Vector3()) => o.set(0, 0, 1),
      controller: { setPosition: vi.fn((p: Vector3) => pos.copyFrom(p)) },
      punch: vi.fn(),
    };
    const director = {
      blast: vi.fn(() => 1),
      deal: vi.fn(),
      enemiesNear: () => [],
      addBuff: vi.fn(),
      bus: { newChain: () => ({ id: 1, depth: 0 }) },
    };
    const weapon = { heat: 80, overheated: true };
    const host = {
      scene,
      player,
      director,
      enemies: { active: [] },
      fx,
      wfx: fx,
      weapon,
      inventory: new RunInventory(loadout, new RunLedger('r', 1, 1)),
      stats: { ...BASE_STATS },
      canAct: () => true,
    } as unknown as AbilityHost;
    return { ab: new Abilities(host), director, player, weapon };
  }

  it('a thrown frag charge flies, lands and blasts through the director; then the slot cools down', () => {
    const { ab, director } = rig({ ability: gen('frag_charge') });
    expect(ab.use('ability')).toBe(true);
    expect(ab.blocked('ability')).toBe('Still on cooldown');
    for (let i = 0; i < 120 && !director.blast.mock.calls.length; i++) ab.update(1 / 60);
    expect(director.blast).toHaveBeenCalledTimes(1);
    const [, radius, amount, element, src] = director.blast.mock.calls[0] as unknown as [Vector3, number, number, string, { id: string }];
    expect(radius).toBeCloseTo(ABILITIES.frag.radius, 6);
    expect(amount).toBeGreaterThan(ABILITIES.frag.power);
    expect(element).toBe('thermal');
    expect(src.id).toBe('ability:frag');
    for (let i = 0; i < 60 * (ABILITIES.frag.cooldown + 0.1); i++) ab.update(1 / 60);
    expect(ab.blocked('ability')).toBeNull();
    expect(THROW.fuse).toBeGreaterThan(0);
  });

  it('empty slots and an uncharged ultimate refuse; damage charges the ultimate to ready', () => {
    const { ab } = rig({ ultimate: gen('orbital_lance', { level: 1 }) });
    expect(ab.blocked('ability')).toMatch(/No ability/);
    expect(ab.use('ultimate')).toBe(false);
    ab.charge(ultChargeNeeded(ABILITIES.orbital, { level: 1 }) * 0.5);
    expect(ab.ult).toBeCloseTo(0.5, 6);
    ab.charge(1e9);
    expect(ab.ult).toBe(1);
    expect(ab.use('ultimate')).toBe(true);
    expect(ab.ult).toBe(0);
  });

  it('blink moves the drone along the aim; overdrive suppresses heat while it lasts', () => {
    const { ab, player, weapon, director } = rig({ ability2: gen('blink_drive'), ultimate: gen('overdrive_core') });
    expect(ab.use('ability2')).toBe(true);
    expect(player.position.z).toBeCloseTo(ABILITIES.blink.power, 4);
    ab.charge(1e9);
    expect(ab.use('ultimate')).toBe(true);
    expect(director.addBuff).toHaveBeenCalled();
    ab.update(0.1);
    expect(weapon.heat).toBe(0);
    expect(weapon.overheated).toBe(false);
  });

  it('a co-op replica mirrors cooldowns without running the effect', () => {
    const { ab, director } = rig({ ability: gen('frag_charge') });
    ab.mirrorUse('ability');
    expect(ab.blocked('ability')).toBe('Still on cooldown');
    for (let i = 0; i < 300; i++) ab.update(1 / 60);
    expect(director.blast).not.toHaveBeenCalled();
  });
});

describe('deployables and ability modifiers', () => {
  it('every deployable kind has a base, a positive cooldown and finite power', async () => {
    const { ABILITIES, DEPLOYABLE_KINDS, abilityPower, deployDistance } = await import('@riftwarden/rules/abilities/defs');
    const { BASES } = await import('@riftwarden/rules/loot/bases');
    const { BASE_STATS } = await import('@riftwarden/rules/combat/stats');
    for (const k of DEPLOYABLE_KINDS) {
      expect(BASES.some((b) => b.ability === k)).toBe(true);
      expect(ABILITIES[k].cooldown).toBeGreaterThan(0);
      for (const rarity of ['common', 'legendary'] as const) {
        const p = abilityPower(ABILITIES[k], { level: 40, rarity }, BASE_STATS);
        expect(Number.isFinite(p) && p > 0).toBe(true);
      }
    }
    // Durations do not grow with item level (wall, sentry); the decoy's hit points do.
    expect(abilityPower(ABILITIES.wall, { level: 1, rarity: 'rare' }, BASE_STATS)).toBe(abilityPower(ABILITIES.wall, { level: 90, rarity: 'rare' }, BASE_STATS));
    expect(abilityPower(ABILITIES.decoy, { level: 90, rarity: 'rare' }, BASE_STATS)).toBeGreaterThan(abilityPower(ABILITIES.decoy, { level: 1, rarity: 'rare' }, BASE_STATS));
    // Placement: full range in the open, short of a wall, never at the drone's feet.
    expect(deployDistance(16, null)).toBe(16);
    expect(deployDistance(16, 6)).toBeCloseTo(5.2);
    expect(deployDistance(16, 0.5)).toBe(1.5);
  });

  it('ability run upgrades are offered only with an ability equipped', async () => {
    const { RunBuild, UPGRADES } = await import('@riftwarden/rules/roguelite/upgrades');
    const ids = new Set(UPGRADES.filter((u) => u.needs?.abilities).map((u) => u.id));
    expect(ids.size).toBeGreaterThanOrEqual(3);
    const seen = (abilities: number) => {
      const found = new Set<string>();
      for (let s = 1; s < 60; s++) {
        const b = new RunBuild(s);
        for (let i = 0; i < 4; i++) for (const u of b.roll({ wave: 6, family: 'plasma', towers: 2, towerArchetypes: ['ballistic'], abilities }, i)) found.add(u.id);
      }
      return [...found].filter((id) => ids.has(id));
    };
    expect(seen(0)).toHaveLength(0);
    expect(seen(2).length).toBeGreaterThan(0);
  });
});
