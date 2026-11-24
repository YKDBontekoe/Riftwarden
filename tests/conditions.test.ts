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
