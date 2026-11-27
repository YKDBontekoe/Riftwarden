import { describe, expect, it } from 'vitest';
import { generateArena } from '@riftwarden/rules/world/arenaGen';
import { distToPolyline } from '@riftwarden/rules/world/geometry';
import { ARENA } from '@riftwarden/rules/world/layout';
import { PROP_SPECIES, propRadius } from '@riftwarden/rules/world/propCatalog';
import { MAX_ARENA_PROPS, planProps } from '@riftwarden/rules/world/propPlan';
import { planRubble } from '@riftwarden/rules/world/rubblePlan';
import { clutterCandidates, pickClutter } from '@riftwarden/game/home/hqClutter';
import { HQ_PORTALS, HQ_ROOMS, HQ_STATIONS } from '@riftwarden/rules/home/layout';

const layouts = [ARENA, generateArena(2), generateArena(3), generateArena(6)];

describe('arena prop plan', () => {
  it('is deterministic and dense, within the budget', () => {
    for (const L of layouts) {
      const rubble = planRubble(L);
      const props = planProps(L, rubble);
      expect(planProps(L, rubble)).toEqual(props);
      expect(props.length).toBeGreaterThan(20);
      expect(props.length).toBeLessThanOrEqual(MAX_ARENA_PROPS + 8); // rooftop searchlights ride along their unit
    }
  });

  it('keeps floor props off every lane, the reactor and the spawn', () => {
    for (const L of layouts) {
      for (const p of planProps(L, planRubble(L)).filter((q) => q.y === 0 && !PROP_SPECIES[q.species].roles.includes('wall'))) {
        const r = propRadius(p.species, p.scale);
        for (const route of Object.values(L.routes)) expect(distToPolyline(p.x, p.z, route.points)).toBeGreaterThan(L.laneHalfWidth + r);
        expect(Math.hypot(p.x - L.reactor.x, p.z - L.reactor.z)).toBeGreaterThan(L.reactor.radius + 4);
        expect(Math.hypot(p.x - L.playerSpawn.x, p.z - L.playerSpawn.z)).toBeGreaterThan(4);
        expect(Math.abs(p.x)).toBeLessThan(L.half);
        expect(Math.abs(p.z)).toBeLessThan(L.half);
      }
    }
  });

  it('gives each biome its own dressing', () => {
    const species = (seed: number) => new Set(planProps(generateArena(seed), []).map((p) => p.species));
    expect(species(6).has('fire-barrel')).toBe(true); // foundry
    expect(species(3).has('fire-barrel')).toBe(false); // cryo
  });

  it('never shifts the rubble stream', () => {
    const before = planRubble(ARENA);
    planProps(ARENA, before);
    expect(planRubble(ARENA)).toEqual(before);
  });
});

describe('HQ clutter', () => {
  const stations = HQ_STATIONS.map((s) => s.pos);
  const picked = pickClutter(clutterCandidates(stations), () => true);

  it('stays inside its rooms, off the doorways and clear of the consoles', () => {
    expect(picked.length).toBeGreaterThan(10);
    for (const p of picked) {
      expect(HQ_ROOMS.some((r) => p.x > r.min[0] && p.x < r.max[0] && p.z > r.min[1] && p.z < r.max[1])).toBe(true);
      for (const s of stations) expect(Math.hypot(s[0] - p.x, s[1] - p.z)).toBeGreaterThan(2);
      for (const d of HQ_PORTALS) {
        const along = d.axis === 'x' ? p.z : p.x;
        const across = d.axis === 'x' ? p.x : p.z;
        if (along > d.a - 1 && along < d.b + 1) expect(Math.abs(across - d.c)).toBeGreaterThan(2);
      }
    }
  });

  it('drops a cluster the room already occupies and moves aside for relocated consoles', () => {
    expect(pickClutter(clutterCandidates(stations), () => false)).toEqual([]);
    const moved = picked[0];
    const again = pickClutter(clutterCandidates([...stations, [moved.x, moved.z]]), () => true);
    for (const p of again) expect(Math.hypot(p.x - moved.x, p.z - moved.z)).toBeGreaterThan(2);
  });
});

import { placeVignette, VIGNETTES, vignetteExtent } from '@riftwarden/rules/world/propVignettes';
import { PROP_SPECIES as SPECIES } from '@riftwarden/rules/world/propCatalog';

describe('prop vignettes', () => {
  it('lies tipped items on their side and keeps stacks above the floor', () => {
    for (const v of Object.values(VIGNETTES)) {
      const items = placeVignette(v, 0, 0, [1, 0], [0, 1], 0, 0);
      items.forEach((p, i) => {
        expect(p.y).toBeGreaterThanOrEqual(0);
        if (Math.abs(p.tilt ?? 0) > 1.2) expect(p.y).toBeCloseTo(SPECIES[p.species].size[0] / 2 + (v.items[i].y ?? 0), 6);
      });
      const ext = vignetteExtent(v);
      expect(ext.u1).toBeGreaterThan(ext.u0);
      expect(ext.depth).toBeGreaterThan(0);
    }
  });
});
