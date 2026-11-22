import { describe, expect, it, vi } from 'vitest';
import { BLAST_EDGE_FALLOFF, BLAST_MAX_RISE, type BlastWorld, planBlast } from '@riftwarden/rules/combat/blast';

const C = { x: 0, y: 0, z: 0 };
const world = (over: Partial<BlastWorld> = {}): BlastWorld => ({
  drones: [{ alive: true, pos: { x: 4, y: 1, z: 0 } }],
  clearShot: () => true,
  towers: [],
  reactor: { x: 100, z: 100, radius: 5 },
  ...over,
});

describe('planBlast', () => {
  it('damage falls off linearly to 55% at the edge', () => {
    const at = (d: number) => planBlast(C, 10, { player: 100 }, world({ drones: [{ alive: true, pos: { x: d, y: 1, z: 0 } }] })).droneHits[0]?.amount;
    expect(at(0)).toBeCloseTo(100);
    expect(at(5)).toBeCloseTo(100 * (1 - BLAST_EDGE_FALLOFF * 0.5));
    expect(at(9.99)).toBeCloseTo(55, 0);
    expect(at(10)).toBeUndefined();
  });

  it('cover blocks the drone hit, and the cover test is only asked for drones in range', () => {
    const clearShot = vi.fn(() => false);
    const w = world({ clearShot, drones: [{ alive: true, pos: { x: 3, y: 1, z: 0 } }, { alive: true, pos: { x: 50, y: 1, z: 0 } }] });
    expect(planBlast(C, 10, { player: 50 }, w).droneHits).toEqual([]);
    expect(clearShot).toHaveBeenCalledTimes(1);
    expect(clearShot).toHaveBeenCalledWith(0);
  });

  it('a drone above the blast clears it, dead drones are ignored, every living drone in range is hit (co-op)', () => {
    const w = world({ drones: [
      { alive: true, pos: { x: 1, y: BLAST_MAX_RISE + 0.1, z: 0 } },
      { alive: false, pos: { x: 1, y: 0, z: 0 } },
      { alive: true, pos: { x: 2, y: BLAST_MAX_RISE - 0.1, z: 0 } },
      { alive: true, pos: { x: 0, y: 0, z: 3 } },
    ] });
    expect(planBlast(C, 10, { player: 10 }, w).droneHits.map((h) => h.index)).toEqual([2, 3]);
  });

  it('player damage 0 or negative hits nobody and never asks for cover', () => {
    const clearShot = vi.fn(() => true);
    expect(planBlast(C, 10, { player: 0 }, world({ clearShot })).droneHits).toEqual([]);
    expect(planBlast(C, 10, { player: -5 }, world({ clearShot })).droneHits).toEqual([]);
    expect(clearShot).not.toHaveBeenCalled();
  });

  it('the reactor is hit when the blast overlaps its radius', () => {
    const w = world({ reactor: { x: 12, z: 0, radius: 5 } });
    expect(planBlast(C, 8, { player: 0, reactor: 70 }, w).reactorDamage).toBe(70);
    expect(planBlast(C, 6, { player: 0, reactor: 70 }, w).reactorDamage).toBe(0); // 12 is not < 6 + 5
  });

  it('reactor overlap boundary is exclusive and zero reactor damage never hits', () => {
    const w = world({ reactor: { x: 11, z: 0, radius: 5 } });
    expect(planBlast(C, 6, { player: 0, reactor: 70 }, w).reactorDamage).toBe(0); // 11 == 6 + 5, not <
    expect(planBlast(C, 6.01, { player: 0, reactor: 70 }, w).reactorDamage).toBe(70);
    expect(planBlast(C, 20, { player: 0, reactor: 0 }, w).reactorDamage).toBe(0);
  });

  it('suppresses only towers inside the horizontal radius (height ignored) and reports the duration', () => {
    const w = world({ towers: [{ pos: { x: 3, y: 0, z: 0 } }, { pos: { x: 3, y: 40, z: 0 } }, { pos: { x: 9, y: 0, z: 0 } }, { pos: { x: 0, y: 0, z: -4 } }] });
    const p = planBlast(C, 5, { player: 0, disable: 6 }, w);
    expect(p.disableTowers).toEqual([0, 1, 3]);
    expect(p.disableSeconds).toBe(6);
    expect(planBlast(C, 5, { player: 0 }, w)).toMatchObject({ disableTowers: [], disableSeconds: 0 });
  });

  it('machine damage is passed through only when positive', () => {
    expect(planBlast(C, 5, { player: 0, enemies: 30 }, world()).machineDamage).toBe(30);
    expect(planBlast(C, 5, { player: 0, enemies: 0 }, world()).machineDamage).toBe(0);
  });
});
