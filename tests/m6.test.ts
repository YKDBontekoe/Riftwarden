import { describe, expect, it } from 'vitest';
import { THREAT_TIERS, getTier, unlocksNextTier } from '../src/progression/tiers';
import { SurvivalPlanner, waveBudget, spawnCap, MAX_WAVE_SPAWNS, eliteChance, maxModsFor } from '../src/survival/plan';
import { ELITE_IDS, rollMods, validMods } from '../src/survival/elites';
import { bossScaling } from '../src/survival/bosses';
import { mulberry32 } from '../src/combat/damage';
import { ARENA } from '../src/world/layout';
import { distToPolyline } from '../src/world/geometry';
import { validatePlacement } from '../src/defense/placement';
import { WaveManager } from '../src/waves/WaveManager';

const sig = (p: SurvivalPlanner, n: number) => Array.from({ length: n }, (_, i) => { const q = p.plan(i + 1); return `${q.theme}:${q.event ?? '-'}:${q.boss?.id ?? '-'}:${q.evolution ?? '-'}`; }).join('|');

describe('M6 survival director', () => {
  it('same seed + tier reproduces the encounter plan and spawns', () => {
    const a = new SurvivalPlanner(1234, 1);
    const b = new SurvivalPlanner(1234, 1);
    expect(sig(a, 40)).toBe(sig(b, 40));
    expect(JSON.stringify(a.compose(17).spawns)).toBe(JSON.stringify(b.compose(17).spawns));
  });
  it('different seeds give different event/boss sequences', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 12; s++) seen.add(sig(new SurvivalPlanner(s * 7919, 1), 40));
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
  it('waves are varied: several themes, events and both bosses appear over 60 waves', () => {
    const themes = new Set<string>(), events = new Set<string>(), bosses = new Set<string>();
    for (let s = 1; s <= 6; s++) {
      const p = new SurvivalPlanner(s, 2);
      for (let n = 1; n <= 60; n++) {
        const q = p.plan(n);
        themes.add(q.theme);
        if (q.event) events.add(q.event);
        if (q.boss) bosses.add(q.boss.id);
      }
    }
    expect(themes.size).toBeGreaterThanOrEqual(7);
    expect(events).toEqual(new Set(['swarm', 'eliteAssault', 'instability', 'hvt']));
    expect(bosses).toEqual(new Set(['colossus', 'overseer']));
  });
  it('bosses: not before the tier\'s first boss wave, never back to back, never coincide with events or evolutions', () => {
    for (let s = 1; s <= 30; s++) {
      for (const tier of THREAT_TIERS) {
        const p = new SurvivalPlanner(s * 31, tier);
        let last = -99;
        let first = 0;
        for (let n = 1; n <= 80; n++) {
          const q = p.plan(n);
          if (q.event) expect(q.wave >= 4).toBe(true);
          if (!q.boss) continue;
          first ||= n;
          expect(n).toBeGreaterThanOrEqual(tier.bossFirstWave);
          expect(n - last).toBeGreaterThanOrEqual(4);
          expect(q.event).toBeNull();
          expect(q.evolution).toBeNull();
          last = n;
        }
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThanOrEqual(tier.bossFirstWave + 8);
      }
    }
  });
  it('repeat bosses gain variations; events respect cooldowns', () => {
    const p = new SurvivalPlanner(99, 3);
    const enc: Record<string, number[]> = {};
    let lastEvent = -10;
    for (let n = 1; n <= 120; n++) {
      const q = p.plan(n);
      if (q.boss) (enc[q.boss.id] ??= []).push(q.boss.encounter);
      if (q.event) {
        expect(n - lastEvent).toBeGreaterThanOrEqual(2);
        lastEvent = n;
      }
    }
    for (const list of Object.values(enc)) expect(list).toEqual(list.map((_, i) => i + 1));
    expect(bossScaling(3, 1).variant).toBe(2);
    expect(bossScaling(3, 1).cadence).toBeLessThan(bossScaling(1, 1).cadence);
  });
  it('arena evolutions are scheduled in order and add the south gate', () => {
    for (let s = 1; s <= 20; s++) {
      const p = new SurvivalPlanner(s, 1);
      const { routes, instability } = p.evolutionAt;
      expect(routes).toBeGreaterThanOrEqual(5);
      expect(instability).toBeGreaterThan(routes);
      expect(p.plan(routes - 1).gates).not.toContain('south');
      expect(p.plan(routes).gates).toContain('south');
      expect(p.plan(routes).evolution).toBe('routes');
      expect(p.plan(instability).evolved).toEqual(['routes', 'instability']);
    }
  });
  it('compositions use only active gates, eligible kinds and valid elite modifiers', () => {
    for (let s = 1; s <= 8; s++) {
      for (const tier of THREAT_TIERS) {
        const p = new SurvivalPlanner(s * 3, tier);
        for (let n = 1; n <= 45; n++) {
          const w = p.compose(n);
          const q = w.plan!;
          expect(w.spawns.length).toBeGreaterThan(0);
          const bad = w.spawns.filter((e) => !q.gates.includes(e.gate) || (e.mods && (!validMods(e.kind, e.mods) || e.mods.length > Math.max(2, tier.maxMods))) || !Number.isFinite(e.time));
          expect(bad).toEqual([]);
          if (q.boss) expect(w.spawns.filter((e) => e.tag === 'boss').length).toBe(1);
          if (q.event === 'hvt') expect(w.spawns.filter((e) => e.kind === 'courier').length).toBe(1);
          if (q.event === 'eliteAssault') expect(w.spawns.filter((e) => e.tag === 'squad').length).toBeGreaterThanOrEqual(4);
          if (n < 6 && tier.id === 1) expect(w.spawns.some((e) => e.kind === 'enforcer')).toBe(false);
        }
      }
    }
  });
  it('threat tiers make the same wave harder and elite-richer', () => {
    const w1 = new SurvivalPlanner(5, 1).compose(20);
    const w3 = new SurvivalPlanner(5, 3).compose(20);
    expect(w3.hpMult).toBeGreaterThan(w1.hpMult * 1.9);
    expect(waveBudget(20, getTier(3))).toBeGreaterThan(waveBudget(20, getTier(1)));
    expect(eliteChance(20, getTier(5))).toBeGreaterThan(eliteChance(20, getTier(1)));
    expect(maxModsFor(10, getTier(4))).toBeGreaterThan(maxModsFor(10, getTier(1)));
  });
  it('high waves stay finite and bounded (25, 50, 100, 250, 1000, 1e5)', () => {
    for (const n of [25, 50, 100, 250, 1000, 100000]) {
      for (const tier of [getTier(1), getTier(5)]) {
        const p = new SurvivalPlanner(7, tier);
        const w = p.compose(n);
        expect(Number.isFinite(w.hpMult) && w.hpMult > 0).toBe(true);
        expect(Number.isFinite(w.damageMult) && w.damageMult > 0).toBe(true);
        expect(Number.isFinite(w.clearReward)).toBe(true);
        expect(w.spawns.length).toBeLessThanOrEqual(MAX_WAVE_SPAWNS * tier.countMult + 30);
        for (const e of w.spawns) expect(Number.isFinite(e.hpMult ?? 1)).toBe(true);
      }
    }
    expect(spawnCap(1e9)).toBe(MAX_WAVE_SPAWNS);
  });
  it('elite modifier rolls respect compatibility', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const m = rollMods('walker', 3, r);
      expect(validMods('walker', m)).toBe(true);
      expect(m.includes('armored') && m.includes('accelerated')).toBe(false);
    }
    expect(validMods('rusher', ['armored'])).toBe(false);
    expect(validMods('rusher', ['accelerated', 'volatile'])).toBe(true);
    expect(ELITE_IDS.length).toBeGreaterThanOrEqual(4);
  });
  it('tier unlock rules are configurable', () => {
    expect(unlocksNextTier(1, 5, 0)).toBe(true);
    expect(unlocksNextTier(3, 10, 0)).toBe(false);
    expect(unlocksNextTier(3, 15, 0)).toBe(true);
    expect(unlocksNextTier(4, 20, 0)).toBe(false);
    expect(unlocksNextTier(4, 20, 1)).toBe(true);
    expect(unlocksNextTier(5, 100, 9)).toBe(false);
  });
  it('wave manager runs director waves endlessly', () => {
    const p = new SurvivalPlanner(42, 2);
    let alive = 0;
    const wm = new WaveManager({ spawn: () => void alive++, aliveCount: () => alive, onWaveStart() {}, onWaveCleared() {}, onPrepStart() {} }, getTier(2), (n) => p.compose(n));
    wm.reset();
    for (let w = 0; w < 30; w++) {
      wm.startNow();
      for (let i = 0; i < 60 * 600 && wm.phase !== 'cleared'; i++) {
        wm.update(1 / 60, 1 / 60);
        alive = Math.max(0, alive - 4);
      }
      expect(wm.phase).toBe('cleared');
      for (let i = 0; i < 300 && wm.phase !== 'prep'; i++) wm.update(1 / 60, 1 / 60);
    }
    expect(wm.number).toBe(31);
  });
});

describe('M6 arena evolution layout', () => {
  it('south lane, barriers and vents keep their rules', () => {
    const lanes = Object.values(ARENA.routes);
    for (const b of ARENA.barriers) {
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      for (const r of lanes) expect(distToPolyline(cx, cz, r.points)).toBeGreaterThan(ARENA.laneHalfWidth + 1.5);
    }
    for (const v of ARENA.vents) expect(Math.min(...lanes.map((r) => distToPolyline(v.x, v.z, r.points)))).toBeLessThan(1);
    const q = { y: 0, surface: 'floor', normalY: 1, footprintHeights: [0, 0, 0, 0, 0, 0, 0, 0, 0], radius: 1.1, maxRange: 30, cores: 999, cost: 1, towers: [] };
    // The dormant south lane is reserved from the start: no tower may ever block it.
    const sp = ARENA.routes.south.points[3];
    expect(validatePlacement(ARENA, { ...q, x: sp.x, z: sp.z, playerX: sp.x, playerZ: sp.z })).toBe('blocks-route');
    const b = ARENA.barriers[0];
    expect(validatePlacement(ARENA, { ...q, x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2, playerX: -10, playerZ: 0 })).toBe('reserved');
  });
});
