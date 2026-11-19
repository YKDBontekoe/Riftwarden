import { mulberry32 } from '../combat/damage';
import { distToBoxXZ, distToPolyline } from './geometry';
import type { ArenaLayout } from './layout';

/**
 * Where the arena's rubble and wreckage go (pure). Visual only (no collision), but kept off
 * everything gameplay reads: enemy lanes (with margin), the reactor ring, the drone spawn,
 * reserved machinery footprints, bulkheads, vents, ramps and the inside of solids. Piles lean
 * against wall bases and the corners of blocks/machines; light debris scatters across open deck.
 */
export type RubbleKind = 'pile' | 'scatter' | 'beam' | 'barrels' | 'slab';

export interface RubbleSpot {
  kind: RubbleKind;
  x: number;
  z: number;
  /** Footprint radius (m). */
  r: number;
  /** Facing (radians around y): for wall pieces, the direction from the spot toward the wall. */
  yaw: number;
  seed: number;
}

/** Clearance a spot of radius r needs from gameplay features. */
export function spotBlocked(L: ArenaLayout, x: number, z: number, r: number): boolean {
  const H = L.half;
  if (Math.abs(x) > H - 0.25 - r * 0.3 || Math.abs(z) > H - 0.25 - r * 0.3) return true;
  for (const route of Object.values(L.routes)) if (distToPolyline(x, z, route.points) < L.laneHalfWidth + r + 1.0) return true;
  if (Math.hypot(x - L.reactor.x, z - L.reactor.z) < L.reactor.radius + 5 + r) return true;
  if (Math.hypot(x - L.playerSpawn.x, z - L.playerSpawn.z) < 4.5 + r) return true;
  for (const q of L.reserved) if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) return true;
  for (const v of L.vents) if (Math.hypot(x - v.x, z - v.z) < v.r + 1 + r) return true;
  for (const m of L.ramps) if (x > m.x0 - r - 0.5 && x < m.x1 + r + 0.5 && z > m.z0 - r - 0.5 && z < m.z1 + r + 0.5) return true;
  for (const b of [...L.boxes, ...L.barriers, L.southDoor]) {
    if (b.kind === 'reactor') continue;
    // Piles may lean against a solid, never sit inside one (or on a platform top).
    if (distToBoxXZ(x, z, b) < r * 0.45) return true;
  }
  return false;
}

export function planRubble(L: ArenaLayout, seed = 0x51ab): RubbleSpot[] {
  const rand = mulberry32(seed >>> 0);
  const out: RubbleSpot[] = [];
  const H = L.half;
  const ok = (x: number, z: number, r: number) => !spotBlocked(L, x, z, r) && out.every((s) => Math.hypot(s.x - x, s.z - z) > (s.r + r) * 0.85);
  const push = (kind: RubbleKind, x: number, z: number, r: number, yaw: number) => {
    if (!ok(x, z, r)) return false;
    out.push({ kind, x, z, r, yaw, seed: Math.floor(rand() * 2 ** 31) });
    return true;
  };

  // Wall bases: walk each inner face; piles, plus the odd fallen beam, barrel cluster or slab.
  // along 'x': the wall runs along x at z = at; along 'z': runs along z at x = at.
  const sides: { along: 'x' | 'z'; at: number }[] = [
    { along: 'x', at: -H },
    { along: 'x', at: H },
    { along: 'z', at: -H },
    { along: 'z', at: H },
  ];
  for (const s of sides) {
    for (let t = -H + 3; t < H - 3; t += 4.5 + rand() * 3) {
      const roll = rand();
      const kind: RubbleKind = roll < 0.12 ? 'beam' : roll < 0.24 ? 'barrels' : roll < 0.32 ? 'slab' : 'pile';
      if (roll > 0.78) continue;
      const r = kind === 'beam' ? 2.6 : kind === 'pile' ? 1.2 + rand() * 1.8 : 1.4;
      const off = (s.at > 0 ? -1 : 1) * (r * 0.6 + 0.3);
      const x = s.along === 'x' ? t : s.at + off;
      const z = s.along === 'x' ? s.at + off : t;
      // Yaw convention: direction from the spot toward the wall (sin = x, cos = z).
      const yaw = s.along === 'x' ? (s.at > 0 ? 0 : Math.PI) : s.at > 0 ? Math.PI / 2 : -Math.PI / 2;
      push(kind, x, z, r, yaw + (kind === 'beam' ? (rand() - 0.5) * 0.5 : 0));
    }
  }

  // Corners of blocks and machinery banks.
  for (const b of L.boxes) {
    if (b.kind !== 'block' && b.kind !== 'machine') continue;
    for (const [cx, sx] of [[b.min[0], -1], [b.max[0], 1]] as const)
      for (const [cz, sz] of [[b.min[2], -1], [b.max[2], 1]] as const) {
        if (rand() < 0.45) continue;
        const r = 0.7 + rand() * 0.7;
        push('pile', cx + sx * r * 0.55, cz + sz * r * 0.55, r, Math.atan2(-sx, -sz));
      }
  }

  // Loose debris over open deck.
  for (let i = 0; i < 220; i++) {
    const x = (rand() * 2 - 1) * (H - 1);
    const z = (rand() * 2 - 1) * (H - 1);
    push('scatter', x, z, 0.35 + rand() * 0.5, rand() * Math.PI * 2);
  }
  return out;
}
