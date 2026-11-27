import { describe, expect, it } from 'vitest';
import { generateArena } from '@riftwarden/rules/world/arenaGen';
import { distToBoxXZ } from '@riftwarden/rules/world/geometry';
import { CLEAR, GroundRelief, MAX_RELIEF } from '@riftwarden/game/visuals/groundRelief';

describe('ground relief', () => {
  for (const seed of [2, 3, 6]) {
    const L = generateArena(seed);
    const R = new GroundRelief(L);
    it(`is bounded, has relief, and is flat where gameplay touches the floor (seed ${seed}, ${L.biome})`, () => {
      let max = 0;
      for (let x = -L.half + 1; x < L.half - 1; x += 1.7)
        for (let z = -L.half + 1; z < L.half - 1; z += 1.7) {
          const h = R.height(x, z);
          expect(Math.abs(h)).toBeLessThanOrEqual(MAX_RELIEF + 1e-9);
          max = Math.max(max, Math.abs(h));
          const nearSolid = L.boxes.some((b) => b.min[1] < 0.2 && distToBoxXZ(x, z, b) < CLEAR - 1.05);
          if (nearSolid) expect(Math.abs(h)).toBeLessThan(0.001); // flat to 1 mm (bilinear mask residue)
        }
      expect(max).toBeGreaterThan(0.02);
      for (const r of Object.values(L.routes)) for (const p of r.points) expect(Math.abs(R.height(p.x, p.z))).toBeLessThan(0.001);
      expect(Math.abs(R.height(L.reactor.x, L.reactor.z))).toBeLessThan(0.001);
      expect(Math.abs(R.height(L.playerSpawn.x, L.playerSpawn.z))).toBeLessThan(0.001);
    });
  }
});
