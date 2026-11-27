import { IntersectionInfo } from '@babylonjs/core/Collisions/intersectionInfo';
import type { Ray } from '@babylonjs/core/Culling/ray.core';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { TriangleBvh } from './triangleBvh';

/** Meshes below this many triangles are cheap enough for Babylon's brute-force loop. */
export const FAST_PICK_MIN_TRIANGLES = 512;

type SubIntersects = SubMesh['intersects'];

/**
 * Accelerate ray picks on a static mesh (geometry never edited after this call): each triangle submesh answers
 * `intersects` from a triangle BVH instead of testing every triangle. Picks keep Babylon's exact results (see
 * `triangleBvh.ts`); triangle predicates, non-triangle fill modes and unindexed meshes fall back to the original.
 * Returns the number of triangles indexed (0 when the mesh was skipped).
 */
export function accelerateStaticPicking(mesh: Mesh, minTriangles = FAST_PICK_MIN_TRIANGLES): number {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices || !indices.length || !mesh.subMeshes) return 0;
  let total = 0;
  for (const sm of mesh.subMeshes) {
    if (sm.indexCount / 3 < minTriangles) continue;
    // Built now (level build, behind the loading screen), not on the first pick mid-fight.
    const bvh = new TriangleBvh(positions, indices, sm.indexStart, sm.indexCount);
    const original: SubIntersects = sm.intersects.bind(sm);
    sm.intersects = (ray: Ray, pos, idx, fastCheck, trianglePredicate) => {
      // Fill modes other than triangles (wireframe/points/strips) and predicates keep Babylon's path.
      const fill = sm.getMaterial()?.fillMode ?? 0;
      if (trianglePredicate || fill !== 0) return original(ray, pos, idx, fastCheck, trianglePredicate);
      const o = ray.origin;
      const d = ray.direction;
      const hit = bvh.raycast(o.x, o.y, o.z, d.x, d.y, d.z, ray.length, ray.epsilon, fastCheck);
      if (!hit) return null;
      const info = new IntersectionInfo(hit.bu, hit.bv, hit.distance);
      info.faceId = hit.face;
      return info;
    };
    total += sm.indexCount / 3;
  }
  return total;
}
