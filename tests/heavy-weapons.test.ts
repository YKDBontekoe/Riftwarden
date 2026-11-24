// Launcher and Flamer families: generation, components, stat composition, refits, persistence and progression.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { rollElement } from '@riftwarden/rules/combat/elements';
import { swapComponent } from '@riftwarden/rules/economy/engineering';
import { recipeBases, recipeDef } from '@riftwarden/rules/economy/recipes';
import { weaponDefFor, weaponSummary, compareItems } from '@riftwarden/rules/loot/equipment';
import { generateItem, isValidItem } from '@riftwarden/rules/loot/generate';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { COMPONENT_RANKS, MASTERY_FAMILIES } from '@riftwarden/rules/progression/mastery';
import { sanitizeItem } from '@riftwarden/rules/progression/save';
import { lockedFamilies } from '@riftwarden/rules/progression/unlocks';
import { xpForLevel } from '@riftwarden/rules/progression/level';
import { buildMechanism, FAMILIES, isValidBuild } from '@riftwarden/rules/weapons/build';
import { componentsFor } from '@riftwarden/rules/weapons/components';

let n = 0;
const gen = (baseId: string, o: Partial<{ rarity: ItemInstance['rarity']; seed: number }> = {}) =>
  generateItem({ uid: `hv${++n}`, seed: o.seed ?? 4100 + n * 31, level: 20, rarity: o.rarity ?? 'rare', baseId, source: 'test', now: 1 });

const LAUNCHERS = ['launcher_tube', 'launcher_siege', 'launcher_hornet'];
const FLAMERS = ['flamer_torch', 'flamer_inferno', 'flamer_needle'];

describe('Launcher family', () => {
  it('every chassis generates valid, deterministic launchers with a blast radius and rocket mechanisms', () => {
    for (const id of LAUNCHERS) {
      for (let i = 0; i < 12; i++) {
        const it = gen(id, { seed: 700 + i * 13 });
        expect(isValidItem(it), id).toBe(true);
        expect(it.build?.family).toBe('launcher');
        expect(isValidBuild(it.build!)).toBe(true);
        expect(['rocket', 'cluster']).toContain(buildMechanism(it.build));
        expect(it.weapon!.splash!).toBeGreaterThan(2);
        expect(it.weapon!.splash!).toBeLessThan(6);
        expect(gen(id, { seed: 700 + i * 13 }).weapon).toEqual(it.weapon);
      }
    }
    const def = weaponDefFor(gen('launcher_tube'))!;
    expect(def.family).toBe('launcher');
    expect(weaponSummary(def).splash).toBe(def.splash);
    expect(weaponSummary(def).targets).toBe(0);
  });

  it('barrels and payloads change the blast: thermobaric widens it, a refit rescales the stored radius', () => {
    const it = gen('launcher_tube', { seed: 91 });
    const tube = { ...it, build: { ...it.build!, barrel: 'ln_tube', mechanism: 'mc_rocket' } };
    const wide = swapComponent(tube as ItemInstance, 'barrel', 'ln_wide');
    expect(wide).not.toBeNull();
    const from = swapComponent(tube as ItemInstance, 'barrel', 'ln_tube')?.weapon.splash ?? it.weapon!.splash!;
    expect(wide!.weapon.splash! / from).toBeCloseTo(1.35, 1);
    expect(componentsFor('mechanism', 'launcher').map((c) => c.id).sort()).toEqual(['mc_cluster', 'mc_rocket']);
    expect(componentsFor('barrel', 'launcher').every((c) => c.families.includes('launcher'))).toBe(true);
  });
});

describe('Flamer family', () => {
  it('every chassis generates valid flamers with a spray cone and several targets per tick, never kinetic', () => {
    for (const id of FLAMERS) {
      for (let i = 0; i < 12; i++) {
        const it = gen(id, { seed: 300 + i * 7, rarity: i % 2 ? 'common' : 'epic' });
        expect(isValidItem(it), id).toBe(true);
        expect(['spray', 'jet']).toContain(buildMechanism(it.build));
        expect(it.weapon!.spray!).toBeGreaterThan(0.05);
        expect(it.weapon!.targets!).toBeGreaterThanOrEqual(1);
        expect(it.weapon!.element).not.toBe('kinetic');
      }
    }
    // The kinetic draw is still consumed: the stream after it is the same as for other families.
    for (let s = 1; s < 200; s++) expect(rollElement('flamer', 0, mulberry32(s))).not.toBe('kinetic');
    const s = weaponSummary(weaponDefFor(gen('flamer_torch'))!);
    expect(s.sprayCone).toBeGreaterThan(5);
    expect(s.targets).toBeGreaterThanOrEqual(1);
  });

  it('the jet valve narrows the cone to fewer machines; a fan manifold reaches one more', () => {
    const it = gen('flamer_torch', { seed: 55 });
    const base = { ...it, build: { ...it.build!, barrel: 'fl_nozzle', mechanism: 'mc_spray' } } as ItemInstance;
    const spray = swapComponent(base, 'barrel', 'fl_nozzle')?.weapon ?? it.weapon!;
    const fan = swapComponent(base, 'barrel', 'fl_fan')!.weapon;
    expect(fan.targets! - (spray.targets ?? 4)).toBe(1);
    expect(fan.spray! / spray.spray!).toBeCloseTo(1.4, 1);
    const jet = swapComponent(base, 'mechanism', 'mc_jet')!.weapon;
    expect(jet.targets).toBe(Math.max(1, (spray.targets ?? 4) - 2));
    expect(jet.range!).toBeGreaterThan(spray.range!);
  });
});

describe('Launcher + Flamer around the game', () => {
  it('sanitize keeps the new parameters and clamps broken ones', () => {
    const it = gen('flamer_inferno');
    const back = sanitizeItem(JSON.parse(JSON.stringify(it)))!;
    expect(back.weapon).toEqual(it.weapon);
    const bad = JSON.parse(JSON.stringify(gen('launcher_siege')));
    bad.weapon.splash = 99;
    bad.weapon.targets = -3;
    const fixed = sanitizeItem(bad)!;
    expect(fixed.weapon!.splash).toBeUndefined();
    expect(fixed.weapon!.targets).toBeUndefined();
    expect(weaponDefFor(fixed)!.splash).toBe(FAMILIES.launcher.template.splash);
  });

  it('recipes, mastery, unlock track and comparison rows know both families', () => {
    for (const f of ['launcher', 'flamer'] as const) {
      expect(recipeDef(`w_${f}`)).toBeTruthy();
      expect(recipeBases(recipeDef(`w_${f}`)!).length).toBe(3);
      expect(MASTERY_FAMILIES).toContain(f);
      expect(COMPONENT_RANKS[f].length).toBe(3);
    }
    const at = (level: number) => ({ progress: { xp: xpForLevel(level) }, threat: { unlocked: 1 } });
    expect(lockedFamilies(at(8))).toContain('launcher');
    expect(lockedFamilies(at(9))).not.toContain('launcher');
    expect(lockedFamilies(at(10))).toContain('flamer');
    expect(lockedFamilies(at(11))).not.toContain('flamer');
    const rows = compareItems(gen('launcher_tube'), gen('launcher_hornet')).map((r) => r.key);
    expect(rows).toContain('w.splash');
    const frows = compareItems(gen('flamer_torch'), gen('flamer_needle')).map((r) => r.key);
    expect(frows).toEqual(expect.arrayContaining(['w.targets', 'w.spray']));
  });
});
