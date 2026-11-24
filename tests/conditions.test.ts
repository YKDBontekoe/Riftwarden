// Conditional affixes: the condition tracker, the conditional stat filter, item modifiers and expected uptime.
import { describe, expect, it } from 'vitest';
import { ConditionTracker, CONDITIONS, expectedModifiers, hasConditional, LOW_HULL } from '@riftwarden/rules/combat/conditions';
import { computeStats, type StatModifier } from '@riftwarden/rules/combat/stats';
import { AFFIXES } from '@riftwarden/rules/loot/affixes';
import { itemModifiers } from '@riftwarden/rules/loot/equipment';
import { generateItem } from '@riftwarden/rules/loot/generate';

const S = (o: Partial<{ airborne: boolean; hullFrac: number; alive: boolean }> = {}) => ({ airborne: false, hullFrac: 1, alive: true, ...o });

describe('condition tracker', () => {
  it('state conditions follow the drone; event conditions last their window; changes are reported once', () => {
    const t = new ConditionTracker();
    expect(t.update(0, S())).toBe(false);
    expect(t.update(0.1, S({ airborne: true }))).toBe(true);
    expect([...t.active]).toEqual(['airborne']);
    expect(t.update(0.2, S({ airborne: true }))).toBe(false);
    t.note('dash', 1);
    expect(t.update(1, S())).toBe(true);
    expect([...t.active]).toEqual(['dash']);
    expect(t.update(1 + CONDITIONS.dash.window! - 0.01, S())).toBe(false);
    expect(t.update(1 + CONDITIONS.dash.window! + 0.01, S())).toBe(true);
    expect(t.active.size).toBe(0);
    t.note('kill', 5);
    t.note('swap', 5);
    t.update(5.5, S({ hullFrac: LOW_HULL - 0.01 }));
    expect([...t.active].sort()).toEqual(['kill', 'lowhull', 'swap']);
    // A destroyed drone has no conditions.
    expect(t.update(5.6, S({ alive: false, airborne: true }))).toBe(true);
    expect(t.active.size).toBe(0);
    t.reset();
    t.update(5.7, S());
    expect(t.active.size).toBe(0);
  });
});

describe('conditional modifiers', () => {
  const mods: StatModifier[] = [
    { stat: 'weaponDamageMult', op: 'pct', value: 0.1 },
    { stat: 'weaponDamageMult', op: 'pct', value: 0.5, cond: 'airborne' },
  ];
  it('count only while their condition is active', () => {
    expect(computeStats(mods).weaponDamageMult).toBeCloseTo(1.1);
    expect(computeStats(mods, undefined, new Set(['dash'])).weaponDamageMult).toBeCloseTo(1.1);
    expect(computeStats(mods, undefined, new Set(['airborne'])).weaponDamageMult).toBeCloseTo(1.6);
    expect(hasConditional(mods)).toBe(true);
    expect(hasConditional(mods.slice(0, 1))).toBe(false);
  });

  it('expected modifiers scale by uptime and drop the condition (scoring)', () => {
    const e = expectedModifiers(mods);
    expect(e[1].cond).toBeUndefined();
    expect(e[1].value).toBeCloseTo(0.5 * CONDITIONS.airborne.uptime);
    expect(computeStats(e).weaponDamageMult).toBeCloseTo(1.1 + 0.5 * CONDITIONS.airborne.uptime);
  });

  it('conditional affixes roll on items, carry their condition into the stat block and never share an implicit stat', () => {
    const conds = AFFIXES.filter((a) => a.cond).map((a) => a.id);
    expect(conds.length).toBeGreaterThanOrEqual(6);
    const seen = new Set<string>();
    for (let s = 1; s < 1500; s++) {
      for (const category of ['weapon', 'processor', 'accessory', 'armor', 'shield'] as const) {
        const it = generateItem({ uid: `c${s}${category}`, seed: s, level: 30, rarity: 'legendary', category, source: 'test', now: 1 });
        for (const a of it.affixes) {
          const def = AFFIXES.find((x) => x.id === a.id)!;
          if (!def.cond) continue;
          seen.add(def.id);
          expect(it.base.some((b) => b.stat === a.stat), `${it.defId} ${a.id}`).toBe(false);
          const m = itemModifiers(it).find((x) => x.cond === def.cond && x.stat === a.stat);
          expect(m).toBeTruthy();
        }
      }
    }
    expect([...seen].sort()).toEqual([...conds].sort());
  });
});

describe('condition presentation', () => {
  it('HUD rows list the conditions the gear needs and light the active ones', async () => {
    const { condHud, condIdsOf } = await import('@riftwarden/rules/combat/conditions');
    const mods: StatModifier[] = [{ stat: 'critChance', op: 'add', value: 0.1, cond: 'kill' }, { stat: 'moveSpeedMult', op: 'pct', value: 0.1, cond: 'airborne' }, { stat: 'critChance', op: 'add', value: 0.1 }];
    expect(condIdsOf(mods)).toEqual(['airborne', 'kill']);
    expect(condHud(condIdsOf(mods), new Set(['kill'])).map((r) => [r.id, r.on])).toEqual([['airborne', false], ['kill', true]]);
    expect(condIdsOf(mods.slice(2))).toEqual([]);
  });

  it('the comparison table keeps a conditional affix apart from the plain stat and names its condition', async () => {
    const { compareItems } = await import('@riftwarden/rules/loot/equipment');
    const a = generateItem({ uid: 'cmpA', seed: 7, level: 20, rarity: 'rare', category: 'processor', source: 'test', now: 1 });
    const b = generateItem({ uid: 'cmpB', seed: 8, level: 20, rarity: 'rare', category: 'processor', source: 'test', now: 1 });
    a.affixes = [{ id: 'c_airdmg', stat: 'weaponDamageMult', op: 'pct', value: 0.3, tier: 3, roll: 1 }];
    b.affixes = [{ id: 'dmg', stat: 'weaponDamageMult', op: 'pct', value: 0.1, tier: 3, roll: 1 }];
    const rows = compareItems(a, b).filter((r) => r.key.startsWith('weaponDamageMult'));
    expect(rows.length).toBe(2);
    const cond = rows.find((r) => r.label.includes(CONDITIONS.airborne.text))!;
    expect(cond.a).not.toBe('');
    expect(cond.b).toBe('');
  });
});
