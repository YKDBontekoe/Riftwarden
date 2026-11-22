import { describe, expect, it } from 'vitest';
import { pickInteractable } from '@riftwarden/game/home/interaction';
import { areaAt, HQ_PORTALS, HQ_ROOMS, HQ_STATIONS, wallSegments } from '@riftwarden/rules/home/layout';
import { DEFAULT_PLACEABLES, PLACEABLE_BOUNDS } from '@riftwarden/rules/home/placeables';

const C = (id: string, x: number, y: number, z: number, range = 4) => ({ id, point: { x, y, z }, range });

describe('interaction targeting', () => {
  const eye = { x: 0, y: 1.5, z: 0 };
  const fwd = { x: 0, y: 0, z: 1 };

  it('selects the candidate nearest the view centre within range', () => {
    const t = pickInteractable([C('a', 0.6, 1.3, 3), C('b', 0, 1.4, 2.5)], eye, fwd);
    expect(t?.id).toBe('b');
  });

  it('ignores targets out of range or behind the player', () => {
    expect(pickInteractable([C('far', 0, 1.5, 9)], eye, fwd)).toBeNull();
    expect(pickInteractable([C('back', 0, 1.5, -2)], eye, fwd)).toBeNull();
    expect(pickInteractable([C('side', 3, 1.5, 0.2)], eye, fwd)).toBeNull();
  });

  it('respects occlusion and disabled candidates, falling back to the next one', () => {
    const cands = [C('a', 0, 1.5, 2), C('b', 0.5, 1.5, 2.5)];
    expect(pickInteractable(cands, eye, fwd, undefined, (c) => c.id === 'a')?.id).toBe('b');
    expect(pickInteractable([{ ...C('a', 0, 1.5, 2), enabled: false }], eye, fwd)).toBeNull();
  });

  it('cone widens up close', () => {
    // 35 degrees off-axis: rejected at 3.5 m, accepted at 1 m.
    const off = (d: number) => C('x', Math.sin(0.61) * d, 1.5, Math.cos(0.61) * d);
    expect(pickInteractable([off(3.5)], eye, fwd)).toBeNull();
    expect(pickInteractable([off(1)], eye, fwd)).not.toBeNull();
  });
});

describe('HQ layout', () => {
  it('generates each wall once and cuts every portal', () => {
    const segs = wallSegments();
    for (const p of HQ_PORTALS) {
      const mid = (p.a + p.b) / 2;
      const solid = segs.filter((s) => s.axis === p.axis && s.c === p.c && s.y0 === 0 && s.a < mid && s.b > mid);
      expect(solid).toEqual([]);
      const lintel = segs.filter((s) => s.axis === p.axis && s.c === p.c && s.y0 === p.height);
      expect(lintel.length).toBeGreaterThan(0);
    }
    // No overlapping full-height pieces on the same line.
    for (const s of segs.filter((x) => x.y0 === 0)) {
      const overlaps = segs.filter((o) => o !== s && o.y0 === 0 && o.axis === s.axis && o.c === s.c && o.a < s.b - 1e-6 && o.b > s.a + 1e-6);
      expect(overlaps).toEqual([]);
    }
  });

  it('stations sit inside rooms and their focus is reachable', () => {
    for (const st of HQ_STATIONS) {
      const [x, z] = st.pos;
      expect(HQ_ROOMS.some((r) => x > r.min[0] && x < r.max[0] && z > r.min[1] && z < r.max[1])).toBe(true);
      expect(st.range).toBeGreaterThan(2);
    }
    expect(areaAt(0, 0)).toBe('COMMAND DECK');
    expect(areaAt(17, -5)).toBe('WORKSHOP');
    expect(areaAt(0, 18)).toBe('LAUNCH BAY');
  });

  it('default placeables are inside the bounds and keep portals clear', () => {
    const B = PLACEABLE_BOUNDS;
    for (const p of DEFAULT_PLACEABLES) {
      expect(p.position[0]).toBeGreaterThanOrEqual(B.minX);
      expect(p.position[0]).toBeLessThanOrEqual(B.maxX);
      expect(p.position[2]).toBeGreaterThanOrEqual(B.minZ);
      expect(p.position[2]).toBeLessThanOrEqual(B.maxZ);
      for (const portal of HQ_PORTALS) {
        const along = portal.axis === 'x' ? p.position[2] : p.position[0];
        const across = portal.axis === 'x' ? p.position[0] : p.position[2];
        const blocks = Math.abs(across - portal.c) < 2 && along > portal.a - 0.5 && along < portal.b + 0.5;
        expect(blocks).toBe(false);
      }
    }
  });
});
