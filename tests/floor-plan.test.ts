import { describe, expect, it } from 'vitest';
import { generateArena } from '@riftwarden/rules/world/arenaGen';
import { distToBoxXZ } from '@riftwarden/rules/world/geometry';
import { GroundRelief, SLAB } from '@riftwarden/game/visuals/groundRelief';
import { floorFree, planFloor } from '@riftwarden/game/visuals/floorPlan';
import { GroundSurface } from '@riftwarden/game/visuals/floorDetail';

describe('floor detail plan', () => {
  for (const seed of [2, 3, 6]) {
    const L = generateArena(seed);
    const R = new GroundRelief(L);
    const h = (x: number, z: number) => R.height(x, z);
    const plan = planFloor(L, h);
    const free = floorFree(L);
    it(`keeps every layer off gameplay floor and solids (seed ${seed}, ${L.biome})`, () => {
      for (const s of [...plan.joints, ...plan.paint]) {
        expect(free(s.x0, s.z0)).toBe(true);
        expect(free(s.x1, s.z1)).toBe(true);
      }
      for (const p of [...plan.patches, ...plan.cracks, ...plan.spots]) expect(free(p.x, p.z)).toBe(true);
      const solids = L.boxes.filter((b) => b.min[1] < 0.2);
      for (const p of plan.patches) for (const b of solids) expect(distToBoxXZ(p.x, p.z, b)).toBeGreaterThan(0.12);
      for (const s of plan.joints) expect(Math.abs((s.x0 === s.x1 ? s.x0 : s.z0) % SLAB)).toBeCloseTo(0, 6);
    });
    it(`plans enough detail and is deterministic (seed ${seed})`, () => {
      if (L.biome !== 'cryo') {
        expect(plan.joints.length).toBeGreaterThan(40);
        expect(plan.cracks.length).toBeGreaterThan(5);
        expect(plan.paint.length).toBeGreaterThan(2);
      }
      expect(plan.patches.length).toBeGreaterThan(3);
      expect(planFloor(L, h)).toEqual(plan);
    });
    it(`holds water only inside a dry rim (seed ${seed})`, () => {
      for (const p of plan.pools) {
        expect(h(p.x, p.z)).toBeLessThan(p.level);
        for (let a = 0; a < 20; a++) expect(h(p.x + Math.cos((a / 20) * Math.PI * 2) * p.r, p.z + Math.sin((a / 20) * Math.PI * 2) * p.r)).toBeGreaterThan(p.level);
      }
    });
  }

  it('samples the rendered ground mesh exactly at its lattice vertices', () => {
    const L = generateArena(2);
    const R = new GroundRelief(L);
    const span = 228, sub = 380;
    const g = new GroundSurface(R, span, sub);
    for (const [c, r] of [[10, 10], [200, 150], [377, 3]]) {
      const x = -span / 2 + (c * span) / sub, z = span / 2 - (r * span) / sub;
      expect(g.height(x, z)).toBeCloseTo(R.height(x, z), 9);
    }
  });
});
