import type { Box, Vec2 } from './layout';

/** Distance from point to segment in XZ. */
export function distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? ((px - a.x) * vx + (pz - a.z) * vz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}

export function distToPolyline(px: number, pz: number, pts: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(px, pz, pts[i], pts[i + 1]));
  return best;
}

/** XZ distance from a point to a box footprint (0 if inside). */
export function distToBoxXZ(px: number, pz: number, b: Box): number {
  const cx = Math.max(b.min[0], Math.min(px, b.max[0]));
  const cz = Math.max(b.min[2], Math.min(pz, b.max[2]));
  return Math.hypot(px - cx, pz - cz);
}
