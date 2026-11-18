import { describe, expect, it } from 'vitest';
import { BASES, canInstall, CORES, DEFAULT_CONFIG, levelCost, MAX_TOWER_LEVEL, MODIFIERS, STARTER_TECH, swapCost, TECH_LIST, type TowerConfig, type TowerSlot, WEAPONS } from '../src/towers/components';
import { planBuildConfig, planRefit, type RefitInput } from '../src/towers/refit';

const ALL_TECH = new Set(TECH_LIST.map((t) => `${t.slot}:${t.id}`));
const NO_TECH = new Set<string>();
const base = (over: Partial<RefitInput> = {}): RefitInput => ({
  phaseBlock: null,
  exists: true,
  building: false,
  config: { ...DEFAULT_CONFIG },
  level: 1,
  what: 'level',
  tech: ALL_TECH,
  cores: 10_000,
  costMult: 1,
  ...over,
});
const fail = (r: ReturnType<typeof planRefit>) => (r.ok ? '' : r.reason);

describe('planRefit', () => {
  it('level-up: cost comes from levelCost, level increases by one, config is unchanged', () => {
    const r = planRefit(base({ level: 2 }));
    expect(r).toEqual({ ok: true, cost: levelCost(DEFAULT_CONFIG, 2, 1), config: DEFAULT_CONFIG, level: 3 });
  });

  it('applies the construction-cost multiplier', () => {
    const cheap = planRefit(base({ costMult: 0.5 }));
    const full = planRefit(base({ costMult: 1 }));
    expect(cheap.ok && full.ok && cheap.cost < full.cost).toBe(true);
  });

  it('refuses beyond the maximum level, whatever the funds', () => {
    expect(fail(planRefit(base({ level: MAX_TOWER_LEVEL })))).toMatch(/maximum level/);
  });

  it('gates on phase, existence and deployment before anything else', () => {
    expect(fail(planRefit(base({ phaseBlock: 'Activate tactical mode', exists: false, building: true })))).toBe('Activate tactical mode');
    expect(fail(planRefit(base({ exists: false, building: true })))).toMatch(/no longer exists/);
    expect(fail(planRefit(base({ building: true })))).toMatch(/still deploying/);
  });

  it('reports the shortfall and spends nothing when cores are insufficient', () => {
    const need = levelCost(DEFAULT_CONFIG, 1, 1);
    expect(fail(planRefit(base({ cores: need - 1 })))).toBe(`Not enough cores (need ${need})`);
    expect(planRefit(base({ cores: need })).ok).toBe(true);
  });

  describe('component swap', () => {
    const swap = (over: Partial<RefitInput>) => planRefit(base({ what: 'weapon', ...over }));

    it('a researched, compatible weapon swaps at swapCost and only changes that slot', () => {
      const r = swap({ id: 'chain_emitter' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.cost).toBe(swapCost(DEFAULT_CONFIG, 'weapon', 'chain_emitter', 1));
        expect(r.config).toEqual({ ...DEFAULT_CONFIG, weapon: 'chain_emitter' });
        expect(r.level).toBe(1);
      }
    });

    it('rejects unresearched blueprints (but starters are always allowed)', () => {
      expect(fail(swap({ id: 'chain_emitter', tech: NO_TECH }))).toMatch(/not researched/);
      for (const key of STARTER_TECH) {
        const [slot, id] = key.split(':') as [TowerSlot, string];
        if (slot === 'base' || id === DEFAULT_CONFIG[slot]) continue;
        const r = planRefit(base({ what: slot, id, tech: NO_TECH }));
        expect(fail(r)).not.toMatch(/not researched/);
      }
    });

    it('rejects unknown, already-installed and base swaps', () => {
      expect(fail(swap({ id: 'nope' }))).toBe('Unknown component');
      expect(fail(swap({ id: undefined }))).toBe('Unknown component');
      expect(fail(swap({ id: DEFAULT_CONFIG.weapon }))).toBe('Already installed');
      expect(fail(planRefit(base({ what: 'base', id: 'bastion' })))).toBe('The base is fixed once built');
    });

    it('uses the compatibility rules (a base that cannot mount the weapon)', () => {
      const bastion: TowerConfig = { ...DEFAULT_CONFIG, base: 'bastion' };
      const r = planRefit(base({ config: bastion, what: 'weapon', id: 'frost_projector' }));
      expect(fail(r)).toBe(canInstall(bastion, 'weapon', 'frost_projector'));
      expect(fail(r)).toMatch(/cannot mount/);
    });

    it('never mutates its input', () => {
      const input = base({ what: 'weapon', id: 'chain_emitter' });
      const frozen = JSON.stringify(input.config);
      Object.freeze(input.config);
      planRefit(input);
      expect(JSON.stringify(input.config)).toBe(frozen);
    });
  });

  it('every accepted swap over the whole catalogue yields a fully compatible configuration', () => {
    let accepted = 0;
    for (const baseId of Object.keys(BASES)) {
      for (const weapon of Object.keys(WEAPONS)) {
        const config: TowerConfig = { base: baseId, weapon, core: 'standard_core', modifier: 'none' };
        if (canInstall(config, 'weapon', weapon)) continue; // not a valid starting tower
        for (const [slot, ids] of [['core', Object.keys(CORES)], ['modifier', Object.keys(MODIFIERS)], ['weapon', Object.keys(WEAPONS)]] as const) {
          for (const id of ids) {
            const r = planRefit(base({ config, what: slot, id }));
            if (!r.ok) continue;
            accepted++;
            for (const s of ['weapon', 'core', 'modifier'] as const) expect(canInstall(r.config, s, r.config[s]), `${baseId}/${weapon} -> ${slot}:${id}`).toBeNull();
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(50);
  });
});

describe('planBuildConfig', () => {
  it('rejects unknown and unresearched parts', () => {
    expect(planBuildConfig(DEFAULT_CONFIG, 'weapon', 'nope', ALL_TECH)).toEqual({ ok: false, reason: 'Unknown component' });
    expect(planBuildConfig(DEFAULT_CONFIG, 'weapon', 'chain_emitter', NO_TECH)).toEqual({ ok: false, reason: 'Blueprint not researched' });
  });

  it('is always valid or refused, for every slot/part/starting template (property sweep)', () => {
    let ok = 0;
    const slots: [TowerSlot, string[]][] = [['base', Object.keys(BASES)], ['weapon', Object.keys(WEAPONS)], ['core', Object.keys(CORES)], ['modifier', Object.keys(MODIFIERS)]];
    for (const baseId of Object.keys(BASES)) {
      for (const weapon of Object.keys(WEAPONS)) {
        const start: TowerConfig = { base: baseId, weapon, core: 'standard_core', modifier: 'none' };
        if (canInstall(start, 'weapon', weapon)) continue;
        for (const [slot, ids] of slots) for (const id of ids) {
          const r = planBuildConfig(start, slot, id, ALL_TECH);
          if (!r.ok) continue;
          ok++;
          expect(r.config[slot]).toBe(id);
          for (const s of ['weapon', 'core', 'modifier'] as const) expect(canInstall(r.config, s, r.config[s]), `${baseId}/${weapon} set ${slot}:${id}`).toBeNull();
        }
      }
    }
    expect(ok).toBeGreaterThan(100);
  });

  it('changing the base repairs incompatible weapon, core and modifier to defaults', () => {
    const spire: TowerConfig = { base: 'spire', weapon: 'frost_projector', core: 'cryo_core', modifier: 'none' };
    const r = planBuildConfig(spire, 'base', 'bastion', ALL_TECH);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config).toEqual({ base: 'bastion', weapon: 'autocannon', core: 'standard_core', modifier: 'none' });
  });
});
