import { describe, expect, it } from 'vitest';
import { canInstall, composeTower, DEFAULT_CONFIG } from '@riftwarden/rules/towers/components';
import { UPGRADES } from '@riftwarden/rules/roguelite/upgrades';
import { ENEMY_COST, ENEMY_UNLOCK, SurvivalPlanner } from '@riftwarden/rules/survival/plan';

describe('missile/support towers, jammer/crawler enemies, new upgrades', () => {
  it('missile and support towers compose valid stats and are compatible where documented', () => {
    const mis = { ...DEFAULT_CONFIG, weapon: 'missile_battery' };
    const sup = { ...DEFAULT_CONFIG, weapon: 'support_amp' };
    expect(canInstall(DEFAULT_CONFIG, 'weapon', 'missile_battery')).toBeNull();
    expect(canInstall(sup, 'modifier', 'multi_target')).not.toBeNull();
    const m = composeTower(mis, 1);
    expect(m.archetype).toBe('missile');
    expect(m.targets).toBe(4);
    expect(m.splash).toBeGreaterThan(3);
    expect(composeTower({ ...mis, modifier: 'multi_target' }, 1).targets).toBe(6);
    const s = composeTower(sup, 1);
    expect(s.damage).toBeCloseTo(0.25);
    expect(composeTower({ ...sup, core: 'capacitor' }, 3).damage).toBeGreaterThan(0.3);
  });
  it('new enemies have costs, unlock waves and appear in compositions', () => {
    expect(ENEMY_COST.jammer).toBeGreaterThan(0);
    expect(ENEMY_COST.crawler).toBeGreaterThan(ENEMY_COST.enforcer);
    expect(ENEMY_UNLOCK.crawler).toBeGreaterThan(ENEMY_UNLOCK.jammer!);
    const p = new SurvivalPlanner(1234, 3);
    const kinds = new Set<string>();
    for (let n = 1; n <= 40; n++) for (const s of p.compose(n).spawns) kinds.add(s.kind);
    expect(kinds.has('jammer')).toBe(true);
    expect(kinds.has('crawler')).toBe(true);
  });
  it('ten new upgrades exist with text', () => {
    const ids = ['w_vent', 'w_exec', 'm_momentum', 't_cluster', 't_overload', 'e_frostbite', 'x_bounty', 'd_rebound', 'l_singularity', 'l_echo'];
    for (const id of ids) {
      const u = UPGRADES.find((x) => x.id === id);
      expect(u, id).toBeTruthy();
      expect(u!.text(1).length).toBeGreaterThan(10);
    }
  });
});
