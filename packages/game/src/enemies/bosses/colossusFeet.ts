import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { COLOSSUS_HIP_Y, COLOSSUS_SCALE, type ColossusLeg } from '../../visuals/bossModels';
import type { Box } from '@riftwarden/rules/world/layout';

const POINT = new Vector3();
const FOOT = new Vector3(0, -2.75, 0);
const SHIN = new Vector3(0, -1.55, 0);
// Small changes first, then sweep the foot toward the chassis and away from the corner.
const POSES = [
  [0, 0], [0.16, 0], [0.30, 0], [0.30, 0.18], [0.30, -0.18],
  [0.46, 0], [0.46, 0.26], [0.46, -0.26], [0.62, 0.37], [0.62, -0.37],
];

function penetration(point: Vector3, radius: number, halfHeight: number, boxes: readonly Box[]): number {
  let total = 0;
  for (const { min, max } of boxes) {
    if (point.y + halfHeight <= min[1] || point.y - halfHeight >= max[1]) continue;
    const dx = Math.max(min[0] - point.x, 0, point.x - max[0]);
    const dz = Math.max(min[2] - point.z, 0, point.z - max[2]);
    const distance = Math.hypot(dx, dz);
    if (distance > 0) total += Math.max(0, radius - distance);
    else total += radius + Math.min(point.x - min[0], max[0] - point.x, point.z - min[2], max[2] - point.z);
  }
  return total;
}

/** Fit the animated feet around cover while leaving the walker route and body hitboxes alone. */
export function poseColossusLeg(leg: ColossusLeg, swing: number, roll: number, boxes: readonly Box[]): void {
  let best = Infinity;
  let bestSwing = swing;
  let bestRoll = roll;
  let bestHeight = COLOSSUS_HIP_Y;
  let stepY = 0;
  for (const [tuck, sweep] of POSES) {
    leg.hip.position.y = COLOSSUS_HIP_Y;
    leg.hip.rotation.x = swing + sweep;
    leg.hip.rotation.z = roll - leg.side * tuck;
    let shin = leg.knee.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(FOOT, shin, POINT);
    if (!tuck) stepY = POINT.y;
    else if (POINT.y < stepY) {
      // Tucking an extended shin can lower its toe. Lift the hip so the pad keeps its step height.
      const verticalScale = leg.hip.parent!.getWorldMatrix().m[5];
      leg.hip.position.y += (stepY - POINT.y) / Math.max(0.5, verticalScale);
      shin = leg.knee.computeWorldMatrix(true);
      Vector3.TransformCoordinatesToRef(FOOT, shin, POINT);
    }
    const footDepth = penetration(POINT, 0.85 * COLOSSUS_SCALE, (0.18 + tuck * 0.75 + Math.abs(sweep) * 0.85) * COLOSSUS_SCALE, boxes);
    Vector3.TransformCoordinatesToRef(SHIN, shin, POINT);
    const depth = footDepth + penetration(POINT, 0.52 * COLOSSUS_SCALE, 0.94 * COLOSSUS_SCALE, boxes);
    if (!depth) return;
    if (depth < best) {
      best = depth;
      bestSwing = leg.hip.rotation.x;
      bestRoll = leg.hip.rotation.z;
      bestHeight = leg.hip.position.y;
    }
  }
  leg.hip.rotation.x = bestSwing;
  leg.hip.rotation.z = bestRoll;
  leg.hip.position.y = bestHeight;
}
