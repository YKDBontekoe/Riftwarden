import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Box, Ramp } from '@riftwarden/rules/world/layout';

/**
 * Guard railing around the edge of an elevated deck, as on any real platform: posts every ~1.5 m, a top rail at
 * 1.05 m, a mid rail and a toe board. Edges where a ramp lands stay open (the ramp's end overlaps that edge).
 * Visual only, no collider (the drone flies over decks; towers sit inside the edge).
 */
export interface RailHost {
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface: string | null): Mesh;
}

/** Edge spans [start, end] along each side that are not taken by a landing ramp. Pure. */
export function openSpans(lo: number, hi: number, blocked: readonly [number, number][]): [number, number][] {
  let spans: [number, number][] = [[lo, hi]];
  for (const [b0, b1] of blocked) {
    const next: [number, number][] = [];
    for (const [s, e] of spans) {
      if (b1 <= s || b0 >= e) next.push([s, e]);
      else {
        if (b0 > s) next.push([s, b0]);
        if (b1 < e) next.push([b1, e]);
      }
    }
    spans = next;
  }
  return spans.filter(([s, e]) => e - s > 0.6);
}

export function buildRailings(h: RailHost, b: Box, ramps: readonly Ramp[], mat: Material, toe: Material): void {
  const [x0, , z0] = b.min;
  const [x1, y1, z1] = b.max;
  const top = y1;
  const inset = 0.08;
  const near = (v: number, w: number) => Math.abs(v - w) < 0.6;
  // Ramps landing on the deck: their high end touches one of the four edges.
  const land = (edge: 'x0' | 'x1' | 'z0' | 'z1'): [number, number][] => ramps.filter((r) => Math.abs(Math.max(r.hMin, r.hMax) - top) < 0.6).flatMap((r): [number, number][] => {
    if (r.axis === 'x') {
      const hiEnd = r.hMax >= r.hMin ? r.x1 : r.x0;
      if ((edge === 'x0' && near(hiEnd, x0)) || (edge === 'x1' && near(hiEnd, x1))) return [[r.z0 - 0.3, r.z1 + 0.3]];
    } else {
      const hiEnd = r.hMax >= r.hMin ? r.z1 : r.z0;
      if ((edge === 'z0' && near(hiEnd, z0)) || (edge === 'z1' && near(hiEnd, z1))) return [[r.x0 - 0.3, r.x1 + 0.3]];
    }
    return [];
  });
  const sides: { along: 'x' | 'z'; at: number; edge: 'x0' | 'x1' | 'z0' | 'z1'; lo: number; hi: number; s: number }[] = [
    { along: 'x', at: z0, edge: 'z0', lo: x0, hi: x1, s: 1 },
    { along: 'x', at: z1, edge: 'z1', lo: x0, hi: x1, s: -1 },
    { along: 'z', at: x0, edge: 'x0', lo: z0, hi: z1, s: 1 },
    { along: 'z', at: x1, edge: 'x1', lo: z0, hi: z1, s: -1 },
  ];
  for (const side of sides) {
    const c = side.at + side.s * inset;
    for (const [s0, s1] of openSpans(side.lo + 0.1, side.hi - 0.1, land(side.edge))) {
      const seg = (a0: number, a1: number, y0: number, ya: number, t: number, m: Material) => side.along === 'x'
        ? h.box(a0, top + y0, c - t, a1, top + ya, c + t, m, null)
        : h.box(c - t, top + y0, a0, c + t, top + ya, a1, m, null);
      const posts = Math.max(1, Math.round((s1 - s0) / 1.5));
      for (let k = 0; k <= posts; k++) {
        const a = s0 + ((s1 - s0) * k) / posts;
        seg(a - 0.025, a + 0.025, 0, 1.05, 0.025, mat);
      }
      seg(s0, s1, 1.0, 1.05, 0.03, mat); // top rail
      seg(s0, s1, 0.52, 0.55, 0.018, mat); // mid rail
      seg(s0, s1, 0, 0.12, 0.008, toe); // toe board
    }
  }
}
