import { describe, expect, it } from 'vitest';
import { applyDamage, mulberry32, rollDamage } from '../src/combat/damage';
import { BASE_STATS, computeStats } from '../src/combat/stats';
import { TacticalEnergy, Wallet } from '../src/core/tactical';
import { FOOTPRINT_SAMPLES, validatePlacement, type PlacementQuery } from '../src/defense/placement';
import { getWave, hpMultiplier, waveThreat } from '../src/waves/waves';
import { distToBoxXZ, distToPolyline } from '../src/world/geometry';
import { ARENA, GATES } from '../src/world/layout';


describe('damage', () => {
  it('weakpoint hits always crit', () => {
    const r = rollDamage(10, { critChance: 0, critMultiplier: 2 }, true, () => 0.99);
    expect(r.crit).toBe(true);
    expect(r.amount).toBe(20);
  });
  it('random crit uses chance', () => {
    expect(rollDamage(10, { critChance: 0.5, critMultiplier: 2 }, false, () => 0.4).crit).toBe(true);
    expect(rollDamage(10, { critChance: 0.5, critMultiplier: 2 }, false, () => 0.6).amount).toBe(10);
  });
  it('shields absorb first and energy is bonus vs shields', () => {
    const h = { hp: 100, maxHp: 100, shield: 30, maxShield: 30 };
    const r = applyDamage(h, 30, 'energy');
    expect(r.toShield).toBe(30);
    expect(r.shieldBroken).toBe(true);
    expect(h.hp).toBe(90);
  });
  it('kills exactly once and never goes negative', () => {
    const h = { hp: 10, maxHp: 10, shield: 0, maxShield: 0 };
    expect(applyDamage(h, 50).killed).toBe(true);
    expect(h.hp).toBe(0);
    expect(applyDamage(h, 50).killed).toBe(false);
  });
  it('prng is deterministic', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('stats', () => {
  it('applies add then mul modifiers', () => {
    const s = computeStats([
      { stat: 'weaponDamageMult', op: 'add', value: 0.5 },
      { stat: 'weaponDamageMult', op: 'mul', value: 1 },
      { stat: 'critChance', op: 'add', value: 5 },
    ]);
    expect(s.weaponDamageMult).toBeCloseTo(3);
    expect(s.critChance).toBe(1);
    expect(BASE_STATS.weaponDamageMult).toBe(1);
  });
});

describe('economy and tactical', () => {
  it('wallet enforces costs', () => {
    const w = new Wallet(150);
    expect(w.spend(100)).toBe(true);
    expect(w.spend(100)).toBe(false);
    expect(w.cores).toBe(50);
    w.earn(60);
    expect(w.canAfford(100)).toBe(true);
    w.reset();
    expect(w.cores).toBe(150);
  });
  it('tactical drains, auto-ends and recharges after delay', () => {
    const t = new TacticalEnergy();
    expect(t.toggle()).toBe(true);
    for (let i = 0; i < 290; i++) t.update(1 / 60);
    expect(t.active).toBe(false);
    expect(t.energy).toBe(0);
    expect(t.toggle()).toBe(false); // below activation threshold
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(t.energy).toBe(0); // still in recharge delay
    for (let i = 0; i < 600; i++) t.update(1 / 60);
    expect(t.energy).toBeGreaterThan(TacticalEnergy.MIN_TO_ACTIVATE);
    expect(t.hostileScale).toBe(1);
  });
  it('slows hostile time while active', () => {
    const t = new TacticalEnergy();
    t.toggle();
    for (let i = 0; i < 30; i++) t.update(1 / 60);
    expect(t.hostileScale).toBeLessThan(0.3);
  });
});

describe('arena layout', () => {
  it('enemy lanes keep clear of every solid', () => {
    for (const g of GATES) {
      const pts = ARENA.routes[g].points;
      for (let i = 0; i < pts.length - 1; i++) {
        for (let s = 0; s <= 20; s++) {
          const f = s / 20;
          const x = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
          const z = pts[i].z + (pts[i + 1].z - pts[i].z) * f;
          for (const b of ARENA.boxes) {
            if (b.kind === 'reactor' && i === pts.length - 2) continue;
            expect(distToBoxXZ(x, z, b), `${g} seg ${i} f ${f} vs ${b.kind}`).toBeGreaterThan(1.6);
          }
        }
      }
    }
  });
  it('routes end near the reactor', () => {
    for (const g of GATES) {
      const end = ARENA.routes[g].points.at(-1)!;
      expect(Math.hypot(end.x, end.z)).toBeLessThan(8);
    }
  });
});

describe('placement', () => {
  const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const base: PlacementQuery = {
    x: -10, y: 0, z: -25, surface: 'floor', normalY: 1, footprintHeights: flat, radius: 1.1,
    playerX: -10, playerZ: -20, maxRange: 30, cores: 150, cost: 100, towers: [],
  };
  it('accepts open floor', () => {
    expect(validatePlacement(ARENA, base)).toBe('ok');
  });
  it('rejects lanes', () => {
    const p = ARENA.routes.north.points[3];
    expect(validatePlacement(ARENA, { ...base, x: p.x, z: p.z, playerX: p.x, playerZ: p.z })).toBe('blocks-route');
  });
  it('rejects overlap, cost and range', () => {
    expect(validatePlacement(ARENA, { ...base, towers: [{ x: -10.5, z: -25, radius: 1.1 }] })).toBe('overlaps-tower');
    expect(validatePlacement(ARENA, { ...base, cores: 99 })).toBe('insufficient-cores');
    expect(validatePlacement(ARENA, { ...base, playerZ: 20 })).toBe('too-far');
  });
  it('rejects near reactor, obstruction, edges and ramps', () => {
    expect(validatePlacement(ARENA, { ...base, x: 0, z: -5, playerX: 0, playerZ: -10 })).toBe('too-close-reactor');
    expect(validatePlacement(ARENA, { ...base, footprintHeights: [0, 0, 6, 0, 0, 0, 0, 0, 0] })).toBe('obstructed');
    expect(validatePlacement(ARENA, { ...base, y: 3, surface: 'platform', footprintHeights: [3, 3, 0, 3, 3, 3, 3, 3, 3] })).toBe('uneven');
    expect(validatePlacement(ARENA, { ...base, surface: 'ramp' })).toBe('bad-surface');
  });
  it('platform tops ignore lane rules', () => {
    expect(validatePlacement(ARENA, { ...base, x: -25, y: 3, z: -30, surface: 'platform', footprintHeights: flat.map(() => 3), playerX: -25, playerZ: -28 })).toBe('ok');
  });
  it('has center plus ring footprint samples', () => {
    expect(FOOTPRINT_SAMPLES.length).toBe(9);
  });
});

describe('waves', () => {
  it('first three waves are hand designed and escalate', () => {
    const t = [1, 2, 3].map((n) => waveThreat(getWave(n)));
    expect(t[1]).toBeGreaterThan(t[0]);
    expect(t[2]).toBeGreaterThan(t[1]);
    expect(getWave(1).spawns.every((s) => s.kind === 'walker')).toBe(true);
  });
  it('generated waves are deterministic and keep escalating', () => {
    expect(getWave(9)).toEqual(getWave(9));
    let prev = waveThreat(getWave(3));
    for (let n = 4; n <= 40; n++) {
      const w = getWave(n);
      expect(w.spawns.length).toBeGreaterThan(0);
      const th = waveThreat(w);
      expect(th, `wave ${n}`).toBeGreaterThan(prev);
      prev = th;
    }
    expect(hpMultiplier(30)).toBeLessThan(8);
  });
  it('introduces elites after the opening', () => {
    expect(getWave(4).spawns.some((s) => s.kind === 'bulwark')).toBe(true);
    expect(getWave(3).spawns.some((s) => s.kind === 'bulwark')).toBe(false);
  });
  it('lanes keep tower-free space', () => {
    for (const g of GATES) expect(distToPolyline(0, -20, ARENA.routes[g].points)).toBeGreaterThan(5);
  });
});
