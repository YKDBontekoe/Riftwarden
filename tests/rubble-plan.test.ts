import { describe, expect, it } from 'vitest';
import { ARENA } from '@riftwarden/rules/world/layout';
import { distToPolyline } from '@riftwarden/rules/world/geometry';
import { planRubble, spotBlocked } from '@riftwarden/rules/world/rubblePlan';

describe('arena rubble plan', () => {
  const spots = planRubble(ARENA);

  it('is deterministic and places a real amount of debris of every kind', () => {
    expect(planRubble(ARENA)).toEqual(spots);
    const kinds = new Set(spots.map((s) => s.kind));
    for (const k of ['pile', 'scatter', 'beam', 'barrels', 'slab']) expect(kinds.has(k as never)).toBe(true);
    expect(spots.filter((s) => s.kind === 'pile').length).toBeGreaterThan(15);
  });

  it('never touches enemy lanes, the reactor, the spawn, reserved footprints or vents', () => {
    for (const s of spots) {
      for (const r of Object.values(ARENA.routes)) expect(distToPolyline(s.x, s.z, r.points)).toBeGreaterThan(ARENA.laneHalfWidth + s.r);
      expect(Math.hypot(s.x - ARENA.reactor.x, s.z - ARENA.reactor.z)).toBeGreaterThan(ARENA.reactor.radius + 4);
      expect(Math.hypot(s.x - ARENA.playerSpawn.x, s.z - ARENA.playerSpawn.z)).toBeGreaterThan(4);
      for (const q of ARENA.reserved) expect(s.x > q.x0 - s.r && s.x < q.x1 + s.r && s.z > q.z0 - s.r && s.z < q.z1 + s.r).toBe(false);
      for (const v of ARENA.vents) expect(Math.hypot(s.x - v.x, s.z - v.z)).toBeGreaterThan(v.r);
      expect(spotBlocked(ARENA, s.x, s.z, s.r)).toBe(false);
    }
  });

  it('spots do not overlap each other', () => {
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan((spots[i].r + spots[j].r) * 0.8);
  });
});

describe('build pads', () => {
  it('flank lane bends, never touch a lane, solid, reserved area or each other', async () => {
    const { planPads } = await import('@riftwarden/rules/world/rubblePlan');
    const { distToBoxXZ } = await import('@riftwarden/rules/world/geometry');
    const pads = planPads(ARENA);
    expect(pads.length).toBeGreaterThanOrEqual(8);
    for (const p of pads) {
      const diag = p.half * Math.SQRT2;
      for (const r of Object.values(ARENA.routes)) expect(distToPolyline(p.x, p.z, r.points)).toBeGreaterThan(ARENA.laneHalfWidth + diag);
      for (const b of ARENA.boxes) if (b.kind !== 'reactor') expect(distToBoxXZ(p.x, p.z, b)).toBeGreaterThan(diag);
      for (const q of ARENA.reserved) expect(p.x > q.x0 - diag && p.x < q.x1 + diag && p.z > q.z0 - diag && p.z < q.z1 + diag).toBe(false);
    }
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) expect(Math.hypot(pads[i].x - pads[j].x, pads[i].z - pads[j].z)).toBeGreaterThan(pads[i].half * 2);
  });
});
