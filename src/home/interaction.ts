/**
 * Interaction targeting (pure). The player interacts with whatever candidate is
 * closest to the centre of view, within its range, inside a view cone that widens a
 * little up close, and not occluded by level geometry. Exactly one target (or none).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface InteractCandidate {
  id: string;
  point: Vec3;
  range: number;
  enabled?: boolean;
}

export interface PickOptions {
  /** Half-angle of the view cone at range (radians). */
  maxAngle: number;
  /** Physical radius of the target used to widen the cone up close (metres). */
  targetRadius: number;
}

export const DEFAULT_PICK: PickOptions = { maxAngle: 0.38, targetRadius: 0.7 };

export function pickInteractable<C extends InteractCandidate>(
  candidates: readonly C[],
  eye: Vec3,
  dir: Vec3,
  opts: PickOptions = DEFAULT_PICK,
  occluded: (c: C) => boolean = () => false,
): C | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const scored: { c: C; angle: number }[] = [];
  for (const c of candidates) {
    if (c.enabled === false) continue;
    const dx = c.point.x - eye.x;
    const dy = c.point.y - eye.y;
    const dz = c.point.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > c.range) continue;
    if (dist < 1e-4) {
      scored.push({ c, angle: 0 });
      continue;
    }
    const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / (dist * dl);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    const allowed = opts.maxAngle + Math.atan(opts.targetRadius / dist);
    if (angle <= allowed) scored.push({ c, angle });
  }
  scored.sort((a, b) => a.angle - b.angle);
  for (const s of scored) if (!occluded(s.c)) return s.c;
  return null;
}
