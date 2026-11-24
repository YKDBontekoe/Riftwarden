// Build-aware "is this an upgrade?": the score follows the build around the gear (tree, mastery, sector faction),
// counts conditional affixes at their expected uptime and sees set bonuses.
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '@riftwarden/rules/combat/conditions';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { loadoutScore, swapImpact } from '@riftwarden/rules/loot/loadoutScore';
import type { ItemInstance, RolledAffix } from '@riftwarden/rules/loot/types';

let n = 0;
const make = (o: { baseId?: string; category?: ItemInstance['category']; affixes?: RolledAffix[]; element?: NonNullable<ItemInstance['weapon']>['element']; set?: ItemInstance['set'] }): ItemInstance => {
  const it = generateItem({ uid: `bs${++n}`, seed: 500 + n, level: 20, rarity: 'rare', baseId: o.baseId, category: o.baseId ? undefined : o.category, source: 'test', now: 1 });
  it.affixes = o.affixes ?? [];
  it.base = it.category === 'weapon' ? [] : it.base;
  if (it.weapon && o.element) it.weapon.element = o.element;
  if (o.set) it.set = o.set;
  else delete it.set;
  return it;
};
const aff = (id: string, stat: RolledAffix['stat'], op: RolledAffix['op'], value: number): RolledAffix => ({ id, stat, op, value, tier: 3, roll: 1 });

describe('build-aware score', () => {
  const weapon = make({ baseId: 'plasma_repeater', element: 'kinetic' });

  it('the build around the gear decides between a damage item and a crit item', () => {
    const dmg = make({ category: 'processor', affixes: [aff('dmg', 'weaponDamageMult', 'pct', 0.12)] });
    const crit = make({ category: 'processor', affixes: [aff('crit', 'critChance', 'add', 0.08)] });
    const plain = swapImpact([weapon, dmg], crit, dmg, undefined, 'firepower');
    // A tree that triples critical damage makes the crit item the upgrade.
    const critTree = { extra: [{ stat: 'critMultiplier' as const, op: 'add' as const, value: 2 }] };
    const built = swapImpact([weapon, dmg], crit, dmg, undefined, 'firepower', undefined, critTree);
    expect(plain.verdict).toBe('downgrade');
    expect(built.verdict).toBe('upgrade');
  });

  it('the sector faction weighs the weapon element (weak element beats a resisted one)', () => {
    const thermal = make({ baseId: 'plasma_repeater', element: 'thermal' });
    const cryo = { ...thermal, uid: 'cryo1', weapon: { ...thermal.weapon!, element: 'cryo' as const } };
    // Rime is weak to thermal and resists cryo.
    const rime = { faction: 'rime' };
    expect(loadoutScore([thermal], rime).dps).toBeGreaterThan(loadoutScore([cryo], rime).dps * 1.5);
    expect(swapImpact([cryo], thermal, cryo, undefined, 'firepower', undefined, rime).verdict).toBe('upgrade');
    // Neutral ground: same numbers, same firepower.
    expect(loadoutScore([thermal]).dps).toBeCloseTo(loadoutScore([cryo]).dps, 6);
  });

  it('a conditional affix counts at its expected uptime, set bonuses count when completed', () => {
    const air = make({ category: 'accessory', affixes: [aff('c_airdmg', 'weaponDamageMult', 'pct', 0.5)] });
    const none = make({ category: 'accessory' });
    const ratio = loadoutScore([weapon, air]).dps / loadoutScore([weapon, none]).dps;
    expect(ratio).toBeCloseTo(1 + 0.5 * CONDITIONS.airborne.uptime, 2);
    const a = make({ category: 'armor', set: 'bastion' });
    const b = make({ category: 'shield', set: 'bastion' });
    const bNoSet = { ...b, uid: 'noset', set: undefined };
    expect(loadoutScore([weapon, a, b]).ehp).toBeGreaterThan(loadoutScore([weapon, a, bNoSet]).ehp);
    expect(swapImpact([weapon, a, bNoSet], b, bNoSet, undefined, 'survivability').verdict).toBe('upgrade');
  });

  it('mastery of the family in hand counts toward firepower', () => {
    const rail = make({ baseId: 'rail_lancer', element: 'kinetic' });
    const mastered = { mastery: { rail: { xp: 1e7, perks: [] } } };
    expect(loadoutScore([rail], mastered).dps).toBeGreaterThan(loadoutScore([rail]).dps);
    expect(loadoutScore([weapon], mastered).dps).toBeCloseTo(loadoutScore([weapon]).dps, 6);
  });
});
