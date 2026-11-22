import '../babylonSideEffects';
import { type PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { Ray } from '@babylonjs/core/Culling/ray.core';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { type Scene } from '@babylonjs/core/scene';
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
  if (r.seek && r.seek > 0) {
    const lock = seekLock(scene, enemies, r, accept);
    if (lock) return { struck: [lock], wall: null };
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

const LOS_RAY = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
const C = new Vector3();

/**
 * Swarm lock: the machines inside the cone around the aim (`seek` = tangent of the half-angle, widened by the
 * body radius), within range and in line of sight of the eye, ordered by angle off the crosshair. Drone `seekIndex`
 * takes candidate `seekIndex % n`, so one launch spreads over the closest few targets. Strikes the body centre
 * (seekers never claim weakpoints).
 */
export function seekLock(scene: Scene, enemies: readonly Enemy[], r: ShotRequest, accept: (e: Enemy) => boolean = () => true, max = 6): ShotStrike | null {
  const cands: { e: Enemy; a: number; t: number }[] = [];
  for (const e of enemies) {
    if (!e.alive || e.hidden || !accept(e)) continue;
    const c = e.center(C);
    const dx = c.x - r.origin.x;
    const dy = c.y - r.origin.y;
    const dz = c.z - r.origin.z;
    const t = dx * r.dir.x + dy * r.dir.y + dz * r.dir.z;
    if (t <= 0.5 || t > r.range) continue;
    const px = dx - r.dir.x * t;
    const py = dy - r.dir.y * t;
    const pz = dz - r.dir.z * t;
    const off = Math.sqrt(px * px + py * py + pz * pz);
    const a = Math.max(0, off - e.def.bodyR * e.def.scale) / t;
    if (a > r.seek!) continue;
    cands.push({ e, a, t });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => x.a - y.a || x.t - y.t);
  const visible: { e: Enemy; t: number }[] = [];
  for (const k of cands) {
    if (visible.length >= max) break;
    const c = k.e.center(new Vector3());
    const d = c.subtract(r.origin);
    const len = d.length();
    LOS_RAY.origin.copyFrom(r.origin);
    LOS_RAY.direction.copyFrom(d.scaleInPlace(1 / len));
    LOS_RAY.length = Math.max(0, len - k.e.def.bodyR * k.e.def.scale);
    const block = scene.pickWithRay(LOS_RAY, (m: AbstractMesh) => !!m.metadata?.surface && m.isEnabled(), true);
    if (block?.hit) continue;
    visible.push(k);
  }
  if (!visible.length) return null;
  const pick = visible[(r.seekIndex ?? 0) % visible.length];
  const centre = pick.e.center(new Vector3());
  // Strike point on the near side of the body (claims are validated against the body).
  const back = centre.subtract(r.origin).normalize().scaleInPlace(pick.e.def.bodyR * pick.e.def.scale * 0.6);
  return { enemy: pick.e, point: centre.subtractInPlace(back), weak: false, assisted: false };
}
