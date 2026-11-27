import type { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Blended, unlit effect materials never read the normal matrix (no lighting, no prepass normals), so their meshes can
 * ignore non-uniform scaling: pooled bolts, tracers, rings and decals are stretched per use, and each stretch flipped
 * the NONUNIFORMSCALING define (a shader variant compiled mid-fight, and a dirty mesh every time it toggled).
 */
export function flatEffectMaterial(mat: Material): boolean {
  if (!mat.needAlphaBlending()) return false;
  if (mat instanceof PBRMaterial) return mat.unlit;
  if (mat instanceof StandardMaterial) return mat.disableLighting && !mat.reflectionTexture && !mat.emissiveFresnelParameters && !mat.opacityFresnelParameters;
  return false;
}

/**
 * Compile the shaders of every pooled (disabled) mesh: effects, bolts, status marks, decals, ordnance, hidden
 * machinery. `scene.whenReadyAsync` skips disabled meshes, so without this each pool compiled its shader on first use
 * mid-fight (seconds in software GL, a hitch or pop-in on a GPU). One job per (material, geometry, instanced variant).
 * Called at arena build, before the first frame, so `ignoreNonUniformScaling` is set before any pooled mesh is used.
 */
export function warmPooledMeshes(scene: Scene): Promise<unknown>[] {
  const jobs: Promise<unknown>[] = [];
  const seen = new Set<string>();
  for (const m of scene.meshes) {
    if (m.isEnabled() || !m.material) continue;
    const inst = m instanceof InstancedMesh;
    const src = inst ? m.sourceMesh : m;
    if (flatEffectMaterial(m.material)) m.ignoreNonUniformScaling = src.ignoreNonUniformScaling = true;
    const key = `${m.material.uniqueId}:${src.uniqueId}:${inst ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(m.material.forceCompilationAsync(src, { useInstances: inst }).catch(() => {}));
  }
  return jobs;
}
