import { type AbstractMesh, type PickingInfo, Ray, type Scene, Vector3 } from '@babylonjs/core';
import type { Enemy, EnemyHitboxMeta } from '../enemies/EnemyManager';
import type { ShotRequest } from '../combat/Weapon';

/** One enemy struck by a shot, in ray order. */
export interface ShotStrike {
  enemy: Enemy;
  point: Vector3;
  weak: boolean;
  /** Found by the beam aim-assist radius rather than a hitbox pick. */
  assisted: boolean;
}

export interface ShotTrace {
  /** Enemies struck in order (at most `pierce + 1`). */
  struck: ShotStrike[];
  /** First level surface on the ray (stops the shot), or null. */
  wall: PickingInfo | null;
}

const TMP = new Vector3();
const RAY = new Ray(Vector3.Zero(), Vector3.Forward(), 1);

/**
 * Player hitscan geometry shared by the authoritative game and the co-op replica: level surfaces and enemy hitboxes
 * (turrets are see-through). Rail slugs continue through `pierce` further enemies until a surface stops them; beams
 * get an aim-assist radius (`width`) around their axis when no hitbox was picked. No damage is applied here.
 */
export function traceShot(scene: Scene, enemies: readonly Enemy[], r: ShotRequest, accept: (e: Enemy) => boolean = () => true): ShotTrace {
  // Hitboxes must reflect this frame's enemy poses, not last frame's render.
  for (const e of enemies) {
    e.root.computeWorldMatrix(true);
    for (const h of e.hitboxes) h.computeWorldMatrix(true);
  }
  RAY.origin.copyFrom(r.origin);
  RAY.direction.copyFrom(r.dir);
  RAY.length = r.range;
  const hits = scene.multiPickWithRay(RAY, (m: AbstractMesh) => (!!m.metadata?.surface || !!m.metadata?.enemy) && m.isEnabled()) ?? [];
  hits.sort((a, b) => a.distance - b.distance);
  const wall = hits.find((h) => !!(h.pickedMesh!.metadata as { surface?: string }).surface) ?? null;
  const maxDist = wall ? wall.distance : r.range;
  const struck: ShotStrike[] = [];
  for (const h of hits) {
    if (h.distance > maxDist) break;
    const meta = h.pickedMesh!.metadata as Partial<EnemyHitboxMeta>;
    const e = meta.enemy;
    if (!e || !e.alive || struck.some((s) => s.enemy === e) || !accept(e)) continue;
    let weak = !!meta.weak;
    if (!weak) {
      // A weakpoint overlapping the body sphere still counts if the ray passes through it.
      const w = hits.find((x) => (x.pickedMesh!.metadata as EnemyHitboxMeta | null)?.enemy === e && (x.pickedMesh!.metadata as EnemyHitboxMeta).weak);
      if (w && w.distance - h.distance < 0.6) weak = true;
    }
    struck.push({ enemy: e, point: h.pickedPoint!.clone(), weak, assisted: false });
    if (struck.length > r.pierce) break;
  }
  if (!struck.length && r.width > 0) {
    const a = beamAssist(enemies, r, maxDist, accept);
    if (a) struck.push(a);
  }
  return { struck, wall };
}

/** Nearest enemy body within `width` of the beam axis, in front of the wall. */
function beamAssist(enemies: readonly Enemy[], r: ShotRequest, maxDist: number, accept: (e: Enemy) => boolean): ShotStrike | null {
  let best: Enemy | null = null;
  let bestT = Infinity;
  for (const e of enemies) {
    if (!e.alive || !accept(e)) continue;
    const c = e.center(TMP);
    const t = (c.x - r.origin.x) * r.dir.x + (c.y - r.origin.y) * r.dir.y + (c.z - r.origin.z) * r.dir.z;
    if (t <= 0 || t > maxDist || t >= bestT) continue;
    const px = r.origin.x + r.dir.x * t - c.x;
    const py = r.origin.y + r.dir.y * t - c.y;
    const pz = r.origin.z + r.dir.z * t - c.z;
    const rr = e.def.bodyR * e.def.scale + r.width;
    if (px * px + py * py + pz * pz <= rr * rr) {
      best = e;
      bestT = t;
    }
  }
  if (!best) return null;
  return { enemy: best, point: r.origin.add(r.dir.scale(bestT - best.def.bodyR * 0.6)), weak: false, assisted: true };
}
